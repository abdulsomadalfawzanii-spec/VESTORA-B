import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../app.js';

async function withApi(callback) {
  const app = createApp({
    jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters',
    paystackSecretKey: 'sk_test_not-a-real-key',
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('protected API endpoints reject requests without an access token', async () => {
  await withApi(async (baseUrl) => {
    const requests = [
      fetch(`${baseUrl}/api/auth/me`),
      fetch(`${baseUrl}/api/orders`, { method: 'POST' }),
      fetch(`${baseUrl}/api/products`, { method: 'POST' }),
    ];
    const responses = await Promise.all(requests);

    assert.deepEqual(responses.map((response) => response.status), [401, 401, 401]);
  });
});

test('vendor and image upload APIs require authentication', async () => {
  await withApi(async (baseUrl) => {
    const responses = await Promise.all([
      fetch(`${baseUrl}/api/vendors/me`),
      fetch(`${baseUrl}/api/vendors/apply`, { method: 'POST' }),
      fetch(`${baseUrl}/api/vendors/me/products`),
      fetch(`${baseUrl}/api/uploads/images`, { method: 'POST' }),
      fetch(`${baseUrl}/api/delivery/me`),
      fetch(`${baseUrl}/api/favorites`),
      fetch(`${baseUrl}/api/admin/overview`),
      fetch(`${baseUrl}/api/reviews/mine`),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status),
      [401, 401, 401, 401, 401, 401, 401, 401],
    );
  });
});

test('delivery registration validates required profile fields before database access', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/delivery/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Provide valid account, contact, and vehicle details.',
    });
  });
});

test('vendor moderation remains unavailable and admin routes are protected', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/vendors`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Authentication is required.' });
  });
});

test('Paystack webhook rejects an invalid signature before parsing payment data', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/payments/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': 'invalid',
      },
      body: JSON.stringify({ event: 'charge.success', data: { reference: 'unknown' } }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Invalid Paystack signature.' });
  });
});

test('registration rejects invalid input before touching the database', async () => {
  await withApi(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', role: 'admin' }),
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valid email/);
  });
});

test('authentication endpoints have a stricter rate limit than the general API', async () => {
  await withApi(async (baseUrl) => {
    let response;
    for (let attempt = 0; attempt < 31; attempt += 1) {
      response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
    }

    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), {
      error: 'Too many authentication requests. Try again later.',
    });
  });
});
