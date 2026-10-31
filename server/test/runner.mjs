#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, '../src/index.js');
const smokePath = path.resolve(__dirname, 'smoke.mjs');
const PORT = process.env.PORT || '4000';
const BASE = process.env.API_BASE || `http://127.0.0.1:${PORT}/api`;

let spawnedServer = null;

async function isServerReady() {
  for (const host of ['127.0.0.1', 'localhost']) {
    try {
      const res = await fetch(`http://${host}:${PORT}/api/health`);
      if (res.ok) return true;
    } catch {}
  }
  return false;
}

try {
  let ready = await isServerReady();
  if (!ready) {
    console.log('[test-runner] Server not detected; launching test server instance...');
    let serverOutput = [];
    spawnedServer = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT },
    });

    spawnedServer.stdout?.on('data', (d) => serverOutput.push(d.toString()));
    spawnedServer.stderr?.on('data', (d) => serverOutput.push(d.toString()));

    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (await isServerReady()) {
        ready = true;
        break;
      }
    }

    if (!ready) {
      console.error('[test-runner] Error: Server failed to start within timeout.');
      if (serverOutput.length > 0) {
        console.error('[server output]\n' + serverOutput.join(''));
      }
      if (spawnedServer) {
        try { spawnedServer.kill(); } catch {}
      }
      process.exit(1);
    }
  }

  const smoke = spawn(process.execPath, [smokePath], {
    stdio: 'inherit',
    env: { ...process.env, API_BASE: BASE },
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
