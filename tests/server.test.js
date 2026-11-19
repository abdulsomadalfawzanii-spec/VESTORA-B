import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

async function getAvailablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API server exited unexpectedly with code ${child.exitCode}.`);
    }

    try {
      return await fetch(url);
    } catch {
      await delay(50);
    }
  }

  throw new Error('API server did not start listening in time.');
}

test('API listens and reports degraded readiness when MongoDB is unavailable', async () => {
  const port = await getAvailablePort();
  const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      MONGODB_URI: 'mongodb://127.0.0.1:1/vestora',
      PORT: String(port),
      NODE_ENV: 'test',
      FRONTEND_ORIGIN: 'http://localhost:5173',
      JWT_SECRET: 'test-secret-that-is-at-least-thirty-two-characters',
    },
    stdio: 'ignore',
  });

  try {
    const response = await waitForHealth(
      `http://127.0.0.1:${port}/api/health`,
      child,
    );

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: 'degraded',
      service: 'available',
      database: 'disconnected',
    });
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
});
