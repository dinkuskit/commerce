import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('.', import.meta.url)), server: { host: '127.0.0.1', port: 47831, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } } });
await server.listen(); server.printUrls();
