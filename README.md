# LetterMelt

LetterMelt is a mobile-first word puzzle. Trace connected letters to find every
required word before the lava clock runs dry. The board melts as words are
solved while preserving every remaining word path.

## Run locally

Requirements: Node.js for tests and Python 3 for the zero-dependency local web
server.

```sh
npm run dev
```

Open <http://localhost:5174/>.

## Test

```sh
npm test
```

## Rebuild word lists

The generated files in `data/` are checked in. To regenerate them from the
source dictionaries configured by the build script:

```sh
npm run build:wordlists
```

See `HANDOFF.md` for the generator invariants, game rules, and implementation
notes that must be preserved.
