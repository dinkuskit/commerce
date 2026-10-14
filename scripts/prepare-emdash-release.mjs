import { execFileSync } from 'node:child_process';
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep official release preparation, but give it Commerce's already audited
// prebundle. A directory inside this Git checkout would be rediscovered from
// the repository root and collide with the raw-source manifest.
const root = process.cwd();
const selector = process.argv[2];
const manifestSource = await readFile(resolve(root, 'emdash-plugin.jsonc'), 'utf8');
const packageSource = await readFile(resolve(root, 'package.json'), 'utf8');
const manifest = JSON.parse(manifestSource);
const pkg = JSON.parse(packageSource);
if (pkg.version !== manifest.version || selector !== `${manifest.slug}@${manifest.version}`) {
  throw new Error('Release selector must match the package and plugin version');
}
const staged = resolve(root, '.tmp/sandbox-source');
if (await readFile(join(staged, 'emdash-plugin.jsonc'), 'utf8') !== manifestSource ||
    await readFile(join(staged, 'package.json'), 'utf8') !== packageSource) {
  throw new Error('Prebundle metadata is stale; run npm run build before release preparation');
}

const directory = await mkdtemp(join(tmpdir(), 'commerce-release-'));
try {
  await mkdir(join(directory, 'src'));
  for (const name of ['package.json', 'emdash-plugin.jsonc', 'src/plugin.ts']) {
    await copyFile(join(staged, name), join(directory, name));
  }
  const receipt = join(directory, 'github-output');
  const cli = fileURLToPath(new URL('../node_modules/@emdash-cms/plugin-cli/dist/index.mjs', import.meta.url));
  execFileSync(process.execPath, [cli, 'release', 'prepare', selector, '--dir', directory, '--out-dir', '.emdash-release'], {
    cwd: directory,
    env: { ...process.env, GITHUB_OUTPUT: receipt },
    stdio: 'inherit',
  });
  const fields = Object.fromEntries((await readFile(receipt, 'utf8')).trim().split('\n').map(line => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  const bundle = `.emdash-release/${manifest.slug}-${manifest.version}.tar.gz`;
  if (fields['package-slug'] !== manifest.slug || fields.version !== manifest.version ||
      fields['publisher-did'] !== manifest.publisher || fields['plugin-directory'] !== '.' ||
      fields['bundle-file'] !== bundle) {
    throw new Error('Official release preparation returned unexpected metadata');
  }
  const output = resolve(root, '.emdash-release', basename(bundle));
  await mkdir(resolve(root, '.emdash-release'), { recursive: true });
  await copyFile(join(directory, bundle), output);
  fields['bundle-file'] = output;
  if (Object.values(fields).some(value => /[\r\n]/.test(value))) throw new Error('Invalid release output');
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(fields).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  console.log(`Prepared ${selector}: ${output}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
