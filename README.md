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

Easy is a five-minute race; hard is three minutes with a larger word pool.

| Stars | Easy          | Hard |
|-------|---------------|------|
| 5     | 2:30          | 1:30 |
| 4     | 3:00          | 2:00 |
| 3     | 4:00          | 2:30 |
| 2     | 4:30          | 2:50 |
| 1     | 5:00          | 3:00 |

At the deadline the run is a loss. After a game you can review the board, then
challenge a friend to the same puzzle: desktop copies a link, mobile opens a
text message.

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

That writes `dist/client/`, which Vercel publishes.

Vercel project settings:

- Framework Preset: `Other`
- Root Directory: `./`
- Build Command: `npm run build`
- Output Directory: `dist/client`
- Install Command: leave the default
