# LetterMelt

LetterMelt is a mobile-first word puzzle. Trace connected letters to find every
required word before the lava clock runs dry. The board melts as words are
solved, while every remaining word path stays intact.

Play at [lettermelt.vercel.app](https://lettermelt.vercel.app/).

## How to play

Drag through adjacent letters (including diagonals) to make words of four or
more letters, then release to submit. A tile cannot be reused in one word.

Required words count toward the puzzle. Bonus dictionary words shave time off
the clock. Find every required word before the vial empties.

Easy and hard share the same three-minute race; hard uses a larger word pool.

| Stars | Finish before |
|-------|---------------|
| 5     | 1:30          |
| 4     | 2:00          |
| 3     | 2:30          |
| 2     | 2:50          |
| 1     | 3:00          |

At 3:00 the run is a loss. After a game you can challenge a friend to the same
board: desktop copies a link, mobile opens a text message.

## Run locally

Node.js for tests; Python 3 for the local web server. There are no runtime
dependencies.

```sh
npm run dev
```

Open <http://localhost:5174/>.

```sh
npm test
```

## Word lists

`data/lexicon.js` is generated from `data/prevalence-dict.csv` and checked in.
To rebuild it:

```sh
npm run build:wordlists
```

## Build and deploy

```sh
npm run build
```

That writes `dist/client/`, which Vercel publishes. `npm run build:pages` is
the GitHub Pages build (`site/`).

Vercel project settings:

- Framework Preset: `Other`
- Root Directory: `./`
- Build Command: `npm run build`
- Output Directory: `dist/client`
- Install Command: leave the default
