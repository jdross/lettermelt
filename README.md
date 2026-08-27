# LetterMelt

LetterMelt is a mobile-first word puzzle. Trace connected letters to find every
required word before the lava clock runs dry. The board melts as words are
solved, while every remaining word path stays intact.

Play at [lettermelt.com](https://lettermelt.com/).

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

For another device on the same network, open `http://<this-computer-ip>:5174/`;
the local multiplayer configuration follows the host address automatically.

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

Multiplayer is optional. The menu item stays hidden when the Supabase client
configuration is absent. For a configured build, set these Vercel environment
variables before running the build:

```sh
LETTER_MELT_SUPABASE_URL=https://your-project.supabase.co
LETTER_MELT_SUPABASE_KEY=sb_publishable_your_key
MULTIPLAYER_ENABLED=true
```

The URL and publishable key are embedded in `dist/client/index.html`; secret and
database keys are never shipped to the browser.

Vercel project settings:

- Framework Preset: `Other`
- Root Directory: `./`
- Build Command: `npm run build`
- Output Directory: `dist/client`
- Install Command: leave the default

## Multiplayer backend

Two-player mode uses Supabase Auth, Postgres, Realtime, Cron, and the `game`
Edge Function. Vercel continues to host only the static site.

1. Install the Supabase CLI and link a development project.
2. Enable anonymous sign-ins and email authentication.
3. Disable public Realtime channels so the migration's room policies are
   enforced.
4. Add `SUPABASE_DB_URL` (the transaction-pooler URL) and `SITE_ORIGINS` to the
   Edge Function secrets. Supabase provides the URL and service-role variables.
5. Apply and serve locally:

```sh
npm run supabase:start
npm run supabase:reset
npm run supabase:functions
```

For production, apply `supabase/migrations`, deploy the `game` function, add the
production and preview URLs to Auth redirect allowlists, and set the two public
Vercel build variables above. Waiting rooms expire after 24 hours; completed
games remain until account deletion. Opening the in-game menu pauses the shared
clock for both players; either player can close it to resume.

Supabase is connected to the GitHub repository with production deploys enabled
for `main`. Every push or merge to `main` that changes the `supabase/` directory
applies pending migrations and deploys the `game` function. Vercel handles the
static client deployment from the same branch using `vercel.json`.
