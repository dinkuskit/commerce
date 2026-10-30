import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

// The manifest's listing file references must survive both prebundle staging
// and the clean directory passed to the official release preparer.
export async function stageRegistryListing(source, destination) {
  const root = resolve(source);
  const manifest = JSON.parse(await readFile(resolve(root, 'emdash-plugin.jsonc'), 'utf8'));
  const artifacts = manifest.release?.artifacts;
  const references = [
    ...Object.values(manifest.sections ?? {}),
    artifacts?.icon,
    artifacts?.banner,
    ...(artifacts?.screenshots ?? []),
  ];
  for (const file of new Set(references.flatMap(ref => ref?.file ? [ref.file] : []))) {
    const input = resolve(root, file);
    const path = relative(root, input);
    if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(file)) {
      throw new Error(`Listing file must remain inside the plugin directory: ${file}`);
    }
    const target = resolve(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(input, target);
  }
}
