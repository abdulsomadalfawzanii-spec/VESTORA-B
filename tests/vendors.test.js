import assert from 'node:assert/strict';
import { once } from 'node:events';
import jwt from 'jsonwebtoken';
import test from 'node:test';
import { createApp } from '../app.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Vendor from '../models/Vendor.js';
import { validateVendorApplication } from '../routes/vendors.js';

test('vendor applications normalize valid shop information', () => {
  const result = validateVendorApplication({
    shopName: '  Studio Ada  ',
    description: '  Contemporary pieces made in Lagos.  ',
    contactPhone: '  +2348012345678  ',
    pickupAddressLine: '  12 Marina Road  ',
    pickupCity: ' Lagos ',
    pickupState: ' Lagos ',
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.fields, {
    shopName: 'Studio Ada',
    description: 'Contemporary pieces made in Lagos.',
    contactPhone: '+2348012345678',
    pickupAddressLine: '12 Marina Road',
    pickupCity: 'Lagos',
    pickupState: 'Lagos',
  });
});

test('vendor applications reject missing and oversized fields', () => {
  const result = validateVendorApplication({
    shopName: ' ',
    description: 'x'.repeat(1001),
    contactPhone: '+2348012345678',
    pickupAddressLine: 'x'.repeat(241),
    pickupCity: 'Lagos',
    pickupState: 'Lagos',
  });

  assert.match(result.errors.join(' '), /shopName/);
  assert.match(result.errors.join(' '), /description/);
});

test('vendor role and product ownership are represented in the schemas', () => {
  assert.deepEqual(User.schema.path('role').enumValues, ['admin', 'customer', 'vendor', 'delivery']);
  assert.equal(Product.schema.path('vendor').options.ref, 'Vendor');
  assert.deepEqual(Vendor.schema.path('status').enumValues, ['pending', 'approved', 'rejected']);
  assert.equal(Vendor.schema.path('status').defaultValue, 'approved');
});

test('vendor applications activate seller access immediately', async () => {
  const methods = {
    findById: User.findById,
    findOne: Vendor.findOne,
    create: Vendor.create,
  };
  let userSaved = false;
  const user = {
    _id: '111111111111111111111111',
    role: 'customer',
    isActive: true,
    async save() { userSaved = true; },
  };
  let createdVendor;
  User.findById = async () => user;
  Vendor.findOne = async () => null;
  Vendor.create = async (input) => {
    createdVendor = {
      _id: '222222222222222222222222',
      ...input,
    };
    return createdVendor;
  };

  const app = createApp({ jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const token = jwt.sign(
    { sub: user._id },
    'test-secret-that-is-at-least-thirty-two-characters',
    { algorithm: 'HS256' },
  );

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/vendors/apply`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        shopName: 'Studio Ada',
        description: 'Contemporary pieces made in Lagos.',
        contactPhone: '+2348012345678',
        pickupAddressLine: '12 Marina Road',
        pickupCity: 'Lagos',
        pickupState: 'Lagos',
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(createdVendor.status, 'approved');
    assert.equal(user.role, 'vendor');
    assert.equal(userSaved, true);
  } finally {
    User.findById = methods.findById;
    Vendor.findOne = methods.findOne;
    Vendor.create = methods.create;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('legacy pending vendor applications are activated automatically', async () => {
  const methods = {
    findById: User.findById,
    findOne: Vendor.findOne,
  };
  let userSaved = false;
  let vendorSaved = false;
  const user = {
    _id: '111111111111111111111111',
    role: 'customer',
    isActive: true,
    async save() { userSaved = true; },
  };
  const vendor = {
    _id: '222222222222222222222222',
    user: user._id,
    status: 'pending',
    async save() { vendorSaved = true; },
  };
  User.findById = async () => user;
  Vendor.findOne = async () => vendor;

  const app = createApp({ jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const token = jwt.sign(
    { sub: user._id },
    'test-secret-that-is-at-least-thirty-two-characters',
    { algorithm: 'HS256' },
  );

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/vendors/me`, {
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(response.status, 200);
    assert.equal(vendor.status, 'approved');
    assert.equal(user.role, 'vendor');
    assert.equal(vendorSaved, true);
    assert.equal(userSaved, true);
  } finally {
    User.findById = methods.findById;
    Vendor.findOne = methods.findOne;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('vendor product creation uses the shop name and updates are scoped to that vendor', async () => {
  const methods = {
    findById: User.findById,
    findOne: Vendor.findOne,
    create: Product.create,
    findOneAndUpdate: Product.findOneAndUpdate,
  };
  const user = { _id: '111111111111111111111111', role: 'vendor', isActive: true };
  const vendor = { _id: '222222222222222222222222', shopName: 'Studio Ada' };
  let createdProduct;
  let updateFilter;
  User.findById = async () => user;
  Vendor.findOne = async () => vendor;
  Product.create = async (input) => {
    createdProduct = { _id: '333333333333333333333333', ...input };
    return createdProduct;
  };
  Product.findOneAndUpdate = async (filter) => {
    updateFilter = filter;
    return null;
  };

  const app = createApp({ jwtSecret: 'test-secret-that-is-at-least-thirty-two-characters' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const token = jwt.sign(
    { sub: user._id },
    'test-secret-that-is-at-least-thirty-two-characters',
    { algorithm: 'HS256' },
  );

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/products`;
    const createdResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Linen dress',
        description: 'A lightweight summer dress.',
        category: 'Dresses',
        vendorName: 'Impersonated shop',
        priceMinor: 125000,
        stock: 5,
        sizes: ['S', 'M'],
        colors: ['Ivory'],
        imageUrls: ['https://images.example.test/dress.jpg'],
      }),
    });

    assert.equal(createdResponse.status, 201);
    assert.equal(createdProduct.vendorName, vendor.shopName);
    assert.equal(createdProduct.vendor, vendor._id);

    const updateResponse = await fetch(`${baseUrl}/444444444444444444444444`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stock: 1 }),
    });

    assert.equal(updateResponse.status, 404);
    assert.deepEqual(updateFilter, {
      _id: '444444444444444444444444',
      vendor: vendor._id,
    });
  } finally {
    User.findById = methods.findById;
    Vendor.findOne = methods.findOne;
    Product.create = methods.create;
    Product.findOneAndUpdate = methods.findOneAndUpdate;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
