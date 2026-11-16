#!/usr/bin/env node
/**
 * Writes saved data samples with a release's own code (backlog saved-data-samples).
 *
 *   node scripts/saved-data/generate.mjs v2.2.10          add the sample for a new release
 *   node scripts/saved-data/generate.mjs v2.2.8 v2.2.9    regenerate these two
 *   node scripts/saved-data/generate.mjs --all            regenerate every sample in the fixtures folder
 *
 * For each tag this checks the tag out into a temporary git worktree,
 * points it at this repo's node_modules, copies generator.ts in as a
 * vitest file and runs it there. The output goes to
 * src/test/fixtures/saved-data/<version>/ and the worktree is removed.
 * The working tree and the current branch are not touched.
 *
 * discrub-core is the one dependency taken at the tag's own locked
 * version (from the npm registry when it differs from the installed
 * one), because stored values such as the Has filter names come from it.
 *
 * Run it once per release, after the tag exists, and commit the new
 * folder. src/services/savedDataSamples.test.ts finds the folder by
 * itself. Set SAVED_DATA_WORKTREES to choose where the worktrees go.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const fixtures = path.join(repo, 'src', 'test', 'fixtures', 'saved-data');
const generatorName = 'savedDataGenerator.test.ts';

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...options });
const git = (...args) => run('git', ['-C', repo, ...args]);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function tagsFromArgs(args) {
  if (args.includes('--all')) {
    if (!existsSync(fixtures)) return [];
    return readdirSync(fixtures, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `v${entry.name}`);
  }
  return args.filter((arg) => !arg.startsWith('--'));
}

/** node_modules for the worktree: links to this repo's packages, and the tag's own discrub-core. */
function linkNodeModules(worktree, scratch) {
  const source = path.join(repo, 'node_modules');
  const target = path.join(worktree, 'node_modules');
  mkdirSync(target);
  const lock = readJson(path.join(worktree, 'package-lock.json'));
  const lockedCore = lock.packages?.['node_modules/discrub-core']?.version;
  const installedCore = readJson(path.join(source, 'discrub-core', 'package.json')).version;
  const fetchCore = lockedCore && lockedCore !== installedCore;

  for (const name of readdirSync(source)) {
    if (name.startsWith('.') && name !== '.bin') continue;
    if (name === 'discrub-core' && fetchCore) continue;
    symlinkSync(path.join(source, name), path.join(target, name));
  }
  if (fetchCore) {
    console.log(`[saved-data] discrub-core ${lockedCore} from the registry (installed is ${installedCore})`);
    run('npm', ['pack', `discrub-core@${lockedCore}`, '--pack-destination', scratch, '--silent'], { cwd: scratch });
    const core = path.join(target, 'discrub-core');
    mkdirSync(core);
    run('tar', ['-xzf', path.join(scratch, `discrub-core-${lockedCore}.tgz`), '-C', core, '--strip-components=1']);
    // The packages discrub-core keeps to itself (its own date-fns) come from the installed copy.
    const nested = path.join(source, 'discrub-core', 'node_modules');
    if (existsSync(nested)) symlinkSync(nested, path.join(core, 'node_modules'));
  }
  const declared = Object.keys(readJson(path.join(worktree, 'package.json')).dependencies ?? {});
  const missing = declared.filter((name) => !existsSync(path.join(target, name)));
  if (missing.length > 0) console.warn(`[saved-data] not installed here, the run fails if the generator needs them: ${missing.join(', ')}`);
}

function generate(tag, base) {
  const version = tag.replace(/^v/, '');
  const worktree = path.join(base, version);
  const scratch = path.join(base, `${version}-scratch`);
  const out = path.join(fixtures, version);
  mkdirSync(scratch, { recursive: true });
  console.log(`[saved-data] ${tag} -> ${path.relative(repo, out)}`);
  git('worktree', 'add', '--detach', worktree, tag);
  try {
    linkNodeModules(worktree, scratch);
    cpSync(path.join(here, 'generator.ts'), path.join(worktree, 'src', 'services', generatorName));
    rmSync(out, { recursive: true, force: true });
    run(process.execPath, [path.join(repo, 'node_modules', 'vitest', 'vitest.mjs'), 'run', `src/services/${generatorName}`], {
      cwd: worktree,
      // UTC, because a zip entry's date is written in local time.
      env: { ...process.env, TZ: 'UTC', SAVED_DATA_OUT: out, SAVED_DATA_TAG: tag },
    });
  } finally {
    git('worktree', 'remove', '--force', worktree);
    rmSync(scratch, { recursive: true, force: true });
  }
}

const tags = tagsFromArgs(process.argv.slice(2));
if (tags.length === 0) {
  console.error('Usage: node scripts/saved-data/generate.mjs <tag> [<tag> ...] | --all');
  process.exit(1);
}
const base = process.env.SAVED_DATA_WORKTREES
  ? path.resolve(process.env.SAVED_DATA_WORKTREES)
  : mkdtempSync(path.join(os.tmpdir(), 'discrub-saved-data-'));
mkdirSync(base, { recursive: true });
try {
  for (const tag of tags) generate(tag, base);
} finally {
  git('worktree', 'prune');
}
console.log(`[saved-data] done: ${tags.join(', ')}. Now run: npx vitest run src/services/savedDataSamples.test.ts`);
