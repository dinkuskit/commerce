import { WorkerdSandboxRunner } from '@emdash-cms/sandbox-workerd/sandbox';
import { fixtureFetch } from './transport.mjs';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The SDK's HTTP policy resolves allowed hosts before the injected transport.
// Match the existing compiled-runtime fixture: answer only its DNS requests.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.origin === 'https://cloudflare-dns.com' && u.pathname === '/dns-query') {
    const allowed = ['dinkuskit.com', 'payments.dinkuskit.com'].includes(u.searchParams.get('name'));
    return Promise.resolve(Response.json({ Status: 0, Answer: allowed ? [{ type: 1, data: '9.9.9.9' }] : [] }));
  }
  // Astro itself still needs loopback HTTP. Refuse external traffic in this test host.
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('External traffic disabled in local merchant fixture');
  return originalFetch(input, init);
};
export const createSandboxRunner = options => {
  const runner = new WorkerdSandboxRunner({ ...options, httpFetch: fixtureFetch, limits: { wallTimeMs: 15000 } });
  if (!runner.isAvailable()) throw new Error('Real workerd runner unavailable');
  const load = runner.load.bind(runner);
  runner.load = async (manifest, source) => {
    const instance = await load(manifest, source);
    writeFileSync(resolve(process.env.LOCAL_MERCHANT_DIRECTORY, 'loaded-' + manifest.id + '.json'), JSON.stringify({
      id: manifest.id, version: manifest.version, backendSha256: createHash('sha256').update(source).digest('hex'),
      runner: 'WorkerdSandboxRunner', available: true, loaded: true,
    }, null, 2));
    return instance;
  };
  return runner;
};
