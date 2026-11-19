import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../app.js';
import Product from '../models/Product.js';

async function withProductApi(callback) {
  const methods = {
    countDocuments: Product.countDocuments,
    distinct: Product.distinct,
    find: Product.find,
  };
  let capturedFilter;
  Product.find = (filter) => {
    capturedFilter = filter;
    return {
      sort() { return this; },
      skip() { return this; },
      limit() { return this; },
      lean: async () => [],
    };
  };
  Product.countDocuments = async () => 0;
  Product.distinct = async (field) => (
    field === 'brand' ? ['Zulu Studio', 'Ada Studio'] : ['M', 'S']
  );

  const app = createApp({
    jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters',
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await callback(`http://127.0.0.1:${server.address().port}`, () => capturedFilter);
  } finally {
    Product.countDocuments = methods.countDocuments;
    Product.distinct = methods.distinct;
    Product.find = methods.find;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('public product listing filters by brand, size and price and returns facets', async () => {
  await withProductApi(async (baseUrl, getFilter) => {
    const response = await fetch(
      `${baseUrl}/api/products?brand=Ada%20%5BStudio%5D&size=M&minPriceMinor=1000&maxPriceMinor=2500`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(getFilter(), {
      isActive: true,
      brand: /^Ada \[Studio\]$/i,
      sizes: 'M',
      priceMinor: { $gte: 1000, $lte: 2500 },
    });
    assert.deepEqual(await response.json(), {
      items: [],
      page: 1,
      limit: 20,
      totalItems: 0,
      totalPages: 0,
      brands: ['Ada Studio', 'Zulu Studio'],
      sizes: ['M', 'S'],
    });
  });
});

test('public product listing rejects invalid price ranges before querying products', async () => {
  await withProductApi(async (baseUrl, getFilter) => {
    const response = await fetch(
      `${baseUrl}/api/products?minPriceMinor=2500&maxPriceMinor=1000`,
    );

    assert.equal(response.status, 400);
    assert.equal(getFilter(), undefined);
  });
});
