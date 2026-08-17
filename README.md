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

## Build the site

The production site is a static build. The canonical build command creates
`dist/client/`, which contains the files to publish:

```sh
npm run build
```

`npm run build:site` runs the same build directly. `npm run build:pages` is the
separate GitHub Pages build.

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

## Deploy to Vercel

Import the GitHub repository and set the project to deploy the `main` branch.
Use these project settings:

- Framework Preset: `Other`
- Root Directory: `./`
- Build Command: `npm run build`
- Output Directory: `dist/client`
- Install Command: leave the default; this project has no runtime dependencies

Vercel will deploy the current `main` branch to production and create previews
for other branches.

See `HANDOFF.md` for the generator invariants, game rules, and implementation
notes that must be preserved.
