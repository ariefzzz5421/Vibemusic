import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const api = spawn(process.execPath, ['scripts/server.mjs'], { stdio: 'inherit' });
const vite = await createServer({ server: { host: '127.0.0.1' } });
await vite.listen();
const address = vite.httpServer?.address();
const port = typeof address === 'object' && address ? address.port : 5173;
console.log(`Vibe Music: http://localhost:${port}`);
const stop = async () => { await vite.close(); api.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', code => { if (code && code !== 0) { console.error(`SQLite API exited with code ${code}`); void stop(); } });
