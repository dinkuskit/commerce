import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Every Commerce route must say whether it is public or admin (issue #79).
// This manifest is generated from the built plugins, outside the sandbox
// bundle, so stores can open only the exact public paths in Cloudflare Access.
export const PLUGIN_ID = 'dinkus-commerce';
export const ROUTE_PREFIX = `/_emdash/api/plugins/${PLUGIN_ID}/`;

export function describeRoutes(routes, label) {
  return Object.entries(routes).map(([name, route]) => {
    if (typeof route.public !== 'boolean') throw new Error(`${label} route ${name} lacks an explicit public/admin declaration`);
    if (!route.public && !route.permission) throw new Error(`${label} admin route ${name} must name an EmDash permission`);
    if (route.public && route.permission) throw new Error(`${label} public route ${name} must not name a permission`);
    if (route.public && !(route.methods?.length > 0)) throw new Error(`${label} public route ${name} must name explicit methods`);
    return {
      name,
      path: ROUTE_PREFIX + name,
      public: route.public,
      methods: route.methods ?? [],
      surface: 'registry',
      auth: route.public ? 'public' : 'emdash',
      ...(route.permission ? { permission: route.permission } : {}),
    };
  });
}

export async function loadRouteManifest(root, backend) {
  const sandbox = (await import(pathToFileURL(resolve(root, 'dist/sandbox/plugin.mjs')).href)).default;
  const { createPlugin } = await import(pathToFileURL(resolve(root, 'dist/index.js')).href);
  const routes = describeRoutes(sandbox.routes, 'sandbox');
  const native = describeRoutes(createPlugin().routes, 'native');
  return {
    schema: 'dinkus-commerce/route-manifest@1',
    plugin: PLUGIN_ID,
    artifact: backend,
    routes,
    publicRoutes: routes.filter(route => route.public).map(route => route.path),
    native: { routes: native, publicRoutes: native.filter(route => route.public).map(route => route.path) },
  };
}

export async function writeRouteManifest(root, backend) {
  const manifest = await loadRouteManifest(root, backend);
  await writeFile(resolve(root, 'dist/sandbox/route-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
