#!/usr/bin/env node

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const sharp = require('sharp');
const { minify: minifyJavaScript } = require('terser');
const CleanCSS = require('clean-css');

const projectDir = path.resolve(__dirname, '..');
const outputDir = path.resolve(process.argv[2] || path.join(projectDir, 'dist', 'client'));
const GAME_SCRIPTS = [
  'generator.js',
  'engine.js',
  'render.js',
  'input.js',
  'share.js',
  'history.js',
  'main.js'
];

function writeMinifiedJavaScript(sourcePath, outputPath) {
  return minifyJavaScript(fs.readFileSync(sourcePath, 'utf8'), {
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false }
  }).then(result => {
    if (result.error) throw result.error;
    fs.writeFileSync(outputPath, `${result.code}\n`);
  });
}

async function bundleGameScripts() {
  const outputJs = path.join(outputDir, 'js');
  const source = GAME_SCRIPTS
    .map(name => fs.readFileSync(path.join(outputJs, name), 'utf8'))
    .join('\n');
  const result = await minifyJavaScript(source, {
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false }
  });
  if (result.error) throw result.error;

  const code = `${result.code}\n`;
  fs.writeFileSync(path.join(outputJs, 'app.js'), code);
  for (const name of GAME_SCRIPTS) {
    fs.rmSync(path.join(outputJs, name), { force: true });
  }
  return crypto.createHash('sha256').update(code).digest('hex').slice(0, 8);
}

async function optimizeLogo() {
  const source = path.join(projectDir, 'assets', 'lettermelt-logo.png');
  const outputAssets = path.join(outputDir, 'assets');
  const resized = sharp(source).resize({ width: 332, withoutEnlargement: true });

  await Promise.all([
    resized.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(path.join(outputAssets, 'lettermelt-logo.png')),
    resized.clone().webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(path.join(outputAssets, 'lettermelt-logo.webp')),
    resized.clone().avif({ quality: 50, effort: 6 }).toFile(path.join(outputAssets, 'lettermelt-logo.avif'))
  ]);
}

async function optimizeShareCard() {
  const source = path.join(projectDir, 'assets', 'lettermelt-share-card.png');
  const outputAssets = path.join(outputDir, 'assets');

  await sharp(source)
    .jpeg({ quality: 86, progressive: true, mozjpeg: true })
    .toFile(path.join(outputAssets, 'lettermelt-share-card.jpg'));

  fs.rmSync(path.join(outputAssets, 'lettermelt-share-card.png'), { force: true });
}

async function optimizeBackground() {
  const source = path.join(projectDir, 'assets', 'lettermelt-game-background.png');
  const outputAssets = path.join(outputDir, 'assets');
  const mobile = sharp(source).resize(900, 1500, { fit: 'cover', position: 'center' });

  await Promise.all([
    sharp(source).avif({ quality: 50, effort: 6 }).toFile(path.join(outputAssets, 'lettermelt-game-background.avif')),
    sharp(source).webp({ quality: 82, effort: 6 }).toFile(path.join(outputAssets, 'lettermelt-game-background.webp')),
    mobile.clone().avif({ quality: 48, effort: 6 }).toFile(path.join(outputAssets, 'lettermelt-game-background-mobile.avif')),
    mobile.clone().webp({ quality: 80, effort: 6 }).toFile(path.join(outputAssets, 'lettermelt-game-background-mobile.webp'))
  ]);
}

function updateShareCardReferences() {
  const indexPath = path.join(outputDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  fs.writeFileSync(indexPath, html.replaceAll(
    'assets/lettermelt-share-card.png',
    'assets/lettermelt-share-card.jpg'
  ));
}

function updateScriptReferences(appHash) {
  const indexPath = path.join(outputDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptPattern = /<script src="js\/([^"?]+)(?:\?[^\"]*)?" defer><\/script>/g;
  const tagsByName = new Map(
    Array.from(html.matchAll(scriptPattern), match => [match[1], match[0]])
  );
  const scriptTags = GAME_SCRIPTS.map(name => tagsByName.get(name));
  const positions = scriptTags.map(tag => tag ? html.indexOf(tag) : -1);
  const inOrder = positions.every((position, index) => (
    position >= 0 && (index === 0 || position > positions[index - 1])
  ));
  if (!inOrder) {
    throw new Error('Could not find the expected gameplay script tags in index.html');
  }
  let updated = html.replace(scriptTags[0], `<script src="js/app.js?v=${appHash}" defer></script>`);
  for (const tag of scriptTags.slice(1)) updated = updated.replace(tag, '');
  fs.writeFileSync(indexPath, updated);
}

async function main() {
  const outputAssets = path.join(outputDir, 'assets');
  const outputData = path.join(outputDir, 'data');
  const outputJs = path.join(outputDir, 'js');
  const cssPath = path.join(outputDir, 'styles.css');

  await optimizeLogo();
  await optimizeShareCard();
  await optimizeBackground();
  updateShareCardReferences();
  const appHash = await bundleGameScripts();
  updateScriptReferences(appHash);

  const css = new CleanCSS({ level: 2 }).minify(fs.readFileSync(cssPath, 'utf8'));
  if (css.errors.length) throw new Error(css.errors.join('\n'));
  fs.writeFileSync(cssPath, `${css.styles}\n`);

  const jsTargets = fs.readdirSync(outputData)
    .filter(name => name.endsWith('.js'))
    .map(name => path.join(outputData, name));
  await Promise.all(jsTargets.map(file => writeMinifiedJavaScript(file, file)));

  console.log('Optimized production assets:');
  console.log(`  logo: ${path.join(outputAssets, 'lettermelt-logo.avif')} / ${path.join(outputAssets, 'lettermelt-logo.webp')}`);
  console.log(`  share card: ${path.join(outputAssets, 'lettermelt-share-card.jpg')}`);
  console.log(`  css: ${cssPath}`);
  console.log(`  javascript: ${path.join(outputJs, 'app.js')} + ${jsTargets.length} data file`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
