import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const screenshots = ['native', 'registry'].flatMap(host =>
  ['unconfigured', 'saved', 'invalid-input', 'failure'].map(state => `${host}-${state}.png`));
const statuses = new Set(['passed', 'failed', 'timedOut', 'timedout', 'skipped', 'interrupted']);
export function collectSettingsEvidence(source, destination, root = resolve('.')) {
  const sourceRoot = realpathSync(source);
  mkdirSync(destination, { recursive: true });
  if (readdirSync(destination).length) throw new Error("Evidence destination must be empty");
  const safeFile = name => {
    const path = resolve(source, name);
    if (!existsSync(path)) return null;
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile() ||
      !realpathSync(path).startsWith(sourceRoot + sep)) throw new Error('Unsafe evidence path');
    return path;
  };
  const copied = [];
  for (const name of screenshots) {
    const path = safeFile(name);
    if (!path) continue;
    const bytes = readFileSync(path);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Invalid screenshot');
    copyFileSync(path, resolve(destination, name));
    copied.push(name);
  }
  const outcomesPath = safeFile('outcomes.json');
  let outcomes = { status: 'interrupted', outcomes: [] };
  if (outcomesPath) {
    const raw = JSON.parse(readFileSync(outcomesPath));
    if (!statuses.has(raw.status) || !Array.isArray(raw.outcomes)) throw new Error('Invalid outcomes');
    outcomes = { status: raw.status, outcomes: raw.outcomes.map(row => {
      if (!['native', 'registry'].includes(row.project) || !statuses.has(row.status) ||
        !statuses.has(row.expectedStatus) || !Number.isFinite(row.durationMs) || row.durationMs < 0 ||
        !Number.isInteger(row.retry) || row.retry < 0) throw new Error('Invalid outcome');
      return { project: row.project, status: row.status, expectedStatus: row.expectedStatus,
        durationMs: row.durationMs, retry: row.retry };
    }) };
  }
  writeFileSync(resolve(destination, 'outcomes.json'), JSON.stringify(outcomes, null, 2));
  const files = ['package.json', 'package-lock.json', 'dist/index.js', 'dist/sandbox/plugin.mjs'];
  const digests = files.filter(name => existsSync(resolve(root, name))).map(name => ({ file: name,
    sha256: createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex') }));
  writeFileSync(resolve(destination, 'digests.json'), JSON.stringify({ schema: 'commerce-settings-evidence/v1',
    package: '@dinkuskit/commerce', files: digests, screenshots: copied,
    omitted: ['traces', 'HAR', 'cookies', 'storage state', 'databases', 'raw errors and logs'] }, null, 2));
  return outcomes;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) collectSettingsEvidence(process.argv[2], process.argv[3]);
