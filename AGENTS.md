# Agent notes

Plain static JS (no TypeScript, no bundler, no runtime deps). Match existing
style. Do not change gameplay unless asked. Do not commit unless asked.

## Deployment boundary

Never access, modify, deploy to, or delete anything in the WithCoverage Vercel
organization. The only exception is when the user explicitly includes
`WITHCOVERAGE` in the request and confirms the specific WithCoverage action.

## Layout

| Path | Role |
|------|------|
| `index.html`, `styles.css` | Shell and look |
| `js/generator.js` | Puzzle construction, union board, enumeration |
| `js/engine.js` | Clock, stars, submit/judge a traced word |
| `js/render.js` | SVG board, melt animation |
| `js/input.js` | Pointer tracing (pure tracer + DOM attach) |
| `js/share.js` | Clipboard vs SMS share |
| `js/main.js` | Wiring, HUD, menu, tutorial |
| `data/lexicon.js` | Packed word lists (`window.LETTER_MELT_LEXICON`) |
| `data/prevalence-dict.csv` | Source for the lexicon build |
| `scripts/build_wordlists.js` | Rebuild `data/lexicon.js` |
| `tests/lettermelt.test.js` | Node test suite (`npm test`) |

Each `js/*.js` file is an IIFE that works in the browser and in Node. Script
order in `index.html` is lexicon → generator → engine → render → input → share
→ main. `engine.js` and `main.js` carry `?v=5e` cache-busts; bump those if you
change clock or wiring that browsers may have cached.

Press `d` during a game for the debug overlay (required words + common words
on the board).

## Do not reintroduce

- `CONFIG.timeBudgetMs` or any wall-clock generation budget. Share links are
  `?s=<seed>&m=<mode>`; the same seed must rebuild the same board. Search is
  bounded by `CONFIG.restarts` (80) and DFS step budgets only. A test asserts
  `timeBudgetMs === undefined`.
- Split `common.js` / `dict.js`, Zipf ranking, or extra promote/exclude lists.
  Familiarity is Brysbaert **Pknown** in `data/prevalence-dict.csv`.
- A lava difficulty switch. Mode is one menu row (`#modeToggle`).
- Concatenating `Generator.FALLBACK_*` onto real lists. Those lists substitute
  when data is missing; they contain sample plurals.

## Board model

The visible graph is exactly the union of remaining required words’ canonical
paths: a cell exists iff an unsolved word uses it; an edge exists iff an
unsolved word steps across it. Solving recomputes the union. Canonical paths
are never disturbed, so remaining words stay solvable.

- Fixed 4×4, gaps allowed, 10–16 required words, one 8–11 letter headline word.
- Required set is **derived**: every *common* word the finished board can spell
  is required. Extras are dictionary-only rares.
- Easy ⊂ hard. Hard required: Pknown ≥ 0.8; easy: ≥ 0.9. Hard is a 3:00
  clock; easy is 5:00. Difficulty also changes the word pool. Hard aims at
  ~13 required words, easy at 10.
- After trimming connections, **re-route every word through the enumerator**.
  Re-adding a constructed path can restore a cut edge and break the union.
- Cells store grid coordinates (`x,y` = column, row), not pixels. Edges are
  `[a, b]` arrays, not `{a, b}`.

Cascade Pack (in `generatePuzzle`): snake a readable base word, mine familiar
words that fit that letter palette (pass `familiar` = easy pools even on hard),
route hooks, saturate, enumerate/promote, trim. Quality scoring (`scorePuzzle`)
holds out for dense, familiar boards a reasonably smart player can finish in
under ~5 minutes — that estimate is a **generation target**, not the race clock.

## Clock

`STAR_SCHEDULES` in `js/engine.js` is the source of truth. Hard: 5 stars until
1:30, then 4 / 2:00, 3 / 2:30, 2 / 2:50, 1 until 3:00, loss at 3:00. Easy: 5
stars until 2:30, then 4 / 3:00, 3 / 4:00, 2 / 4:30, 1 until 5:00, loss at
5:00. Elapsed time counts up; the vial shows remaining `failMs`. The only win
is emptying the board. Extra words subtract elapsed time (clamped at zero) and
can buy a spent star back.

Star notches sit on the **floor** of the vial, not as full-height dividers
across the lava.

## Lexicon

`data/lexicon.js` is `{ w, f }`: one copy of each playable word plus flag
bytes. Prefixes are built at unpack (`PREFIX_DEPTH` = 11). Rebuild with
`npm run build:wordlists`. Plurals, -ed, -ing, and most -ly adverbs are
dropped at build time; `really` is in `STANDALONE_LY` (not treated as an adverb
of “real”). Do not add mature/offensive words.

`main.js` unpacks once, builds a lexicon per difficulty, and screens the
base-word pool on first use. `FALLBACK_*` in the generator are only for
missing data.

## UI traps

- Node ids restart at 1 each puzzle. `render.js` bumps `state.gen` in
  `setPuzzle`; deferred melt/tween work must capture that token and no-op when
  stale, or the new board’s tiles move.
- `main.js` holds `busy` through a hold-then-melt beat. Positions looking
  stable is not “ready for the next trace”; wait until `#currentText` is empty
  too if driving the UI from a harness.
- Sharing: desktop copies to the clipboard; mobile opens SMS. Keep that split
  even if a desktop browser exposes Web Share.
- Input walks the pointer **segment** between samples (flicks skip
  `pointermove` events) and uses a **tight** lock radius so in-between samples
  do not grab the wrong neighbor.

## Tests

`npm test` → `tests/lettermelt.test.js` (~52 tests). Structural cases use
`FAST = { minFunScore: 0, restarts: 40 }` so they check invariants, not hunt
quality. Real-data tests unpack `data/lexicon.js`; median generation must stay
under 400ms. Do not skip or weaken those gates to make a change “pass”.
