/**
 * Rebuilds the bundled Discrub Classic (1.x) apps at public/classic-chrome and
 * public/classic-firefox from source, so the shipped main.js is never a hand-made
 * artifact. Classic lives in its own repo (pratherbytecraft/discrub-ext); each
 * flavor is pinned to an exact commit below.
 *
 * Source resolution, per flavor:
 *   1. classic-source/<flavor>/   (vendored copy, present in the AMO source bundle)
 *   2. .classic-src/<flavor>/     (local checkout made by this script from GitHub)
 *
 * Usage: node scripts/build-classic.mjs [chrome|firefox]   (default: both)
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/pratherbytecraft/discrub-ext.git';

export const CLASSIC_PINS = {
  chrome: { branch: 'development', sha: 'c580eeb60e9d57a6fe70f636a9bc46c37601d5d4' },
  firefox: { branch: 'firefox-port', sha: 'bdc6745ef06b2e7c713a425f57fd5293eec4cd62' },
};

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

export function resolveSource(flavor) {
  const vendored = path.join(rootDir, 'classic-source', flavor);
  if (fs.existsSync(path.join(vendored, 'package.json'))) return vendored;

  const { sha } = CLASSIC_PINS[flavor];
  const checkout = path.join(rootDir, '.classic-src', flavor);
  if (!fs.existsSync(path.join(checkout, '.git'))) {
    fs.rmSync(checkout, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(checkout), { recursive: true });
    run(`git clone --quiet ${REPO} "${checkout}"`, rootDir);
  }
  run(`git checkout --quiet ${sha} 2>/dev/null || (git fetch --quiet origin && git checkout --quiet ${sha})`, checkout);
  return checkout;
}

function cleanManifest(distDir) {
  // Mirrors discrub-ext's `clean_prod_manifest` npm script without needing jq.
  const file = path.join(distDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete manifest.use_dynamic_url;
  for (const entry of manifest.web_accessible_resources ?? []) delete entry.use_dynamic_url;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}

export function buildClassic(flavor) {
  if (!CLASSIC_PINS[flavor]) throw new Error(`Unknown Classic flavor "${flavor}"`);
  const src = resolveSource(flavor);
  console.log(`\nBuilding Discrub Classic (${flavor}) from ${path.relative(rootDir, src)} ...`);
  run('npm ci --no-audit --no-fund', src);
  run('npx tsc', src);
  run('npx vite build', src);
  const dist = path.join(src, 'dist');
  cleanManifest(dist);

  const dest = path.join(rootDir, 'public', `classic-${flavor}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(dist, dest, { recursive: true });
  console.log(`  -> public/classic-${flavor}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const wanted = process.argv[2] ? [process.argv[2]] : Object.keys(CLASSIC_PINS);
  for (const flavor of wanted) buildClassic(flavor);
}
