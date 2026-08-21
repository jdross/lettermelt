#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { minify: minifyJavaScript } = require('terser');
const CleanCSS = require('clean-css');

const projectDir = path.resolve(__dirname, '..');
const outputDir = path.resolve(process.argv[2] || path.join(projectDir, 'dist', 'client'));

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

async function optimizeLogo() {
  const source = path.join(projectDir, 'assets', 'lettermelt-logo.png');
  const outputAssets = path.join(outputDir, 'assets');
  const resized = sharp(source).resize({ width: 332, withoutEnlargement: true });

  await Promise.all([
    resized.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(path.join(outputAssets, 'lettermelt-logo.png')),
    resized.clone().webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(path.join(outputAssets, 'lettermelt-logo.webp'))
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

function updateShareCardReferences() {
  const indexPath = path.join(outputDir, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  fs.writeFileSync(indexPath, html.replaceAll(
    'assets/lettermelt-share-card.png',
    'assets/lettermelt-share-card.jpg'
  ));
}

async function main() {
  const outputAssets = path.join(outputDir, 'assets');
  const outputData = path.join(outputDir, 'data');
  const outputJs = path.join(outputDir, 'js');
  const cssPath = path.join(outputDir, 'styles.css');

  await optimizeLogo();
  await optimizeShareCard();
  updateShareCardReferences();

  const css = new CleanCSS({ level: 2 }).minify(fs.readFileSync(cssPath, 'utf8'));
  if (css.errors.length) throw new Error(css.errors.join('\n'));
  fs.writeFileSync(cssPath, `${css.styles}\n`);

  const jsTargets = [
    ...fs.readdirSync(outputJs).filter(name => name.endsWith('.js')).map(name => path.join(outputJs, name)),
    ...fs.readdirSync(outputData).filter(name => name.endsWith('.js')).map(name => path.join(outputData, name))
  ];
  await Promise.all(jsTargets.map(file => writeMinifiedJavaScript(file, file)));

  console.log('Optimized production assets:');
  console.log(`  logo: ${path.join(outputAssets, 'lettermelt-logo.webp')}`);
  console.log(`  share card: ${path.join(outputAssets, 'lettermelt-share-card.jpg')}`);
  console.log(`  css: ${cssPath}`);
  console.log(`  javascript: ${jsTargets.length} files`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
