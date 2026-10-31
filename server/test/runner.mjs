#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, '../src/index.js');
const smokePath = path.resolve(__dirname, 'smoke.mjs');
const BASE = process.env.API_BASE || `http://localhost:${process.env.PORT || 4000}/api`;

let spawnedServer = null;

async function isServerReady() {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

try {
  let ready = await isServerReady();
  if (!ready) {
    console.log('[test-runner] Server not detected; launching test server instance...');
    spawnedServer = spawn(process.execPath, [serverPath], {
      stdio: 'ignore',
      env: { ...process.env, PORT: process.env.PORT || '4000' },
    });

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (await isServerReady()) {
        ready = true;
        break;
      }
    }

    if (!ready) {
      console.error('[test-runner] Error: Server failed to start within timeout.');
      if (spawnedServer) spawnedServer.kill();
      process.exit(1);
    }
  }

  const smoke = spawn(process.execPath, [smokePath], {
    stdio: 'inherit',
    env: process.env,
  });

  smoke.on('exit', (code) => {
    if (spawnedServer) {
      try {
        spawnedServer.kill('SIGTERM');
      } catch {}
    }
    process.exit(code || 0);
  });
} catch (err) {
  if (spawnedServer) {
    try {
      spawnedServer.kill('SIGTERM');
    } catch {}
  }
  console.error('[test-runner] Unexpected error:', err);
  process.exit(1);
}

