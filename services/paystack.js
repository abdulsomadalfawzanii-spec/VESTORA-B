const paystackBaseUrl = 'https://api.paystack.co';

async function paystackRequest(path, { method = 'GET', body, secretKey, fetchImpl = fetch }) {
  if (!secretKey) {
    const error = new Error('Paystack is not configured. Set PAYSTACK_SECRET_KEY.');
    error.statusCode = 503;
    throw error;
  }

  let response;
  try {
    response = await fetchImpl(`${paystackBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    const error = new Error('Paystack is temporarily unavailable.');
    error.statusCode = 502;
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error('Paystack returned an invalid response.');
    error.statusCode = 502;
    throw error;
  }

  if (!response.ok || payload?.status !== true || !payload.data) {
    const error = new Error('Paystack could not process the payment request.');
    error.statusCode = 502;
    throw error;
  }

  return payload.data;
}

export function initializePaystackTransaction(
  { email, amountMinor, reference, currency = 'NGN', callbackUrl },
  { secretKey, fetchImpl } = {},
) {
  return paystackRequest('/transaction/initialize', {
    method: 'POST',
    secretKey,
    fetchImpl,
    body: {
      email,
      amount: amountMinor,
      reference,
      currency,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    },
  });
}

export function verifyPaystackTransaction(reference, { secretKey, fetchImpl } = {}) {
  return paystackRequest(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { secretKey, fetchImpl },
  );
}
