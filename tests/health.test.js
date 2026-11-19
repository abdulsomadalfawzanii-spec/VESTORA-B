import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../app.js';

async function requestHealth(databaseConnected) {
  const app = createApp({ databaseConnected: () => databaseConnected });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();
    return await fetch(`http://127.0.0.1:${port}/api/health`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('health endpoint reports API and database readiness', async () => {
  const response = await requestHealth(true);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'available',
    database: 'connected',
  });
});

test('health endpoint returns 503 when the database is disconnected', async () => {
  const response = await requestHealth(false);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    status: 'degraded',
    service: 'available',
    database: 'disconnected',
  });
});

test('unknown API routes return JSON 404 responses', async () => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/not-found`);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Route not found.' });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('malformed JSON receives a client error response', async () => {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Invalid JSON request body.',
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
