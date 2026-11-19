import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from '../services/paystack.js';

test('Paystack initialization sends server-calculated amount and currency', async () => {
  let request;
  const data = await initializePaystackTransaction(
    {
      email: 'customer@example.com',
      amountMinor: 125000,
      reference: 'vestora_test_reference',
      currency: 'NGN',
    },
    {
      secretKey: 'sk_test_not-a-real-key',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return Response.json({
          status: true,
          data: {
            authorization_url: 'https://checkout.paystack.com/example',
            reference: 'vestora_test_reference',
          },
        });
      },
    },
  );

  assert.equal(request.url, 'https://api.paystack.co/transaction/initialize');
  assert.equal(request.options.headers.Authorization, 'Bearer sk_test_not-a-real-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    email: 'customer@example.com',
    amount: 125000,
    reference: 'vestora_test_reference',
    currency: 'NGN',
  });
  assert.equal(data.reference, 'vestora_test_reference');
});

test('Paystack verification URL-encodes the transaction reference', async () => {
  let requestedUrl;
  await verifyPaystackTransaction('vestora/ref 1', {
    secretKey: 'sk_test_not-a-real-key',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return Response.json({ status: true, data: { status: 'success' } });
    },
  });

  test('Paystack initialization sends the configured order-verification callback URL', async () => {
    let requestBody;
    await initializePaystackTransaction(
      {
        email: 'customer@example.com',
        amountMinor: 125000,
        reference: 'vestora_test_reference',
        callbackUrl: 'http://localhost:5173/checkout/complete',
      },
      {
        secretKey: 'sk_test_not-a-real-key',
        fetchImpl: async (_url, options) => {
          requestBody = JSON.parse(options.body);
          return Response.json({
            status: true,
            data: {
              authorization_url: 'https://checkout.paystack.com/example',
              reference: 'vestora_test_reference',
            },
          });
        },
      },
    );

    assert.equal(requestBody.callback_url, 'http://localhost:5173/checkout/complete');
  });

  assert.equal(
    requestedUrl,
    'https://api.paystack.co/transaction/verify/vestora%2Fref%201',
  );
});

test('Paystack requests fail explicitly without a configured secret key', async () => {
  await assert.rejects(
    initializePaystackTransaction({
      email: 'customer@example.com',
      amountMinor: 100,
      reference: 'vestora_test_reference',
    }),
    { statusCode: 503 },
  );
});

test('Paystack provider failures are not presented as successful payments', async () => {
  await assert.rejects(
    verifyPaystackTransaction('vestora_test_reference', {
      secretKey: 'sk_test_not-a-real-key',
      fetchImpl: async () => Response.json(
        { status: false, message: 'Declined' },
        { status: 400 },
      ),
    }),
    { statusCode: 502 },
  );
});

test('Paystack network failures return an explicit gateway error', async () => {
  await assert.rejects(
    verifyPaystackTransaction('vestora_test_reference', {
      secretKey: 'sk_test_not-a-real-key',
      fetchImpl: async () => {
        throw new Error('Connection reset');
      },
    }),
    {
      statusCode: 502,
      message: 'Paystack is temporarily unavailable.',
    },
  );
});
