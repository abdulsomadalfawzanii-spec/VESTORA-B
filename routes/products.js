import { Router } from 'express';
import mongoose from 'mongoose';
import { createAuthenticate } from '../middleware/auth.js';
import Product from '../models/Product.js';
import Vendor from '../models/Vendor.js';

const editableFields = [
  'name',
  'description',
  'category',
  'brand',
  'vendorName',
  'priceMinor',
  'sizes',
  'colors',
  'imageUrls',
  'stock',
  'isActive',
];

function validateProduct(input, partial = false) {
  const errors = [];
  const fields = {};

  for (const field of ['name', 'description', 'category', 'vendorName']) {
    if (input[field] === undefined && partial) continue;
    if (
      typeof input[field] !== 'string' ||
      input[field].trim().length === 0 ||
      input[field].length > (field === 'description' ? 4000 : 160)
    ) {
      errors.push(`${field} must be a non-empty string of an allowed length.`);
    } else {
      fields[field] = input[field].trim();
    }
  }

  if (input.brand !== undefined) {
    if (typeof input.brand !== 'string' || input.brand.trim().length > 120) {
      errors.push('brand must be a string of at most 120 characters.');
    } else {
      fields.brand = input.brand.trim();
    }
  }

  if (input.priceMinor !== undefined || !partial) {
    if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 1) {
      errors.push('priceMinor must be a positive integer in kobo.');
    } else {
      fields.priceMinor = input.priceMinor;
    }
  }

  if (input.stock !== undefined || !partial) {
    if (!Number.isSafeInteger(input.stock) || input.stock < 0) {
      errors.push('stock must be a non-negative integer.');
    } else {
      fields.stock = input.stock;
    }
  }

  for (const field of ['sizes', 'colors']) {
    if (input[field] === undefined && partial) continue;
    if (
      !Array.isArray(input[field]) ||
      input[field].length > 30 ||
      input[field].some((value) => typeof value !== 'string' || value.length > 50)
    ) {
      errors.push(`${field} must be an array of at most 30 short strings.`);
    } else {
      fields[field] = input[field].map((value) => value.trim()).filter(Boolean);
    }
  }

  if (input.imageUrls !== undefined || !partial) {
    if (
      !Array.isArray(input.imageUrls) ||
      input.imageUrls.length > 8 ||
      input.imageUrls.some((value) => {
        if (typeof value !== 'string') return true;
        try {
          return new URL(value).protocol !== 'https:';
        } catch {
          return true;
        }
      })
    ) {
      errors.push('imageUrls must contain at most 8 HTTPS image URLs.');
    } else {
      fields.imageUrls = input.imageUrls;
    }
  }

  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') errors.push('isActive must be a boolean.');
    else fields.isActive = input.isActive;
  }

  return { errors, fields };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createProductRouter({ jwtSecret }) {
  const router = Router();
  const authenticate = createAuthenticate(jwtSecret);

  router.get('/', async (request, response) => {
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 20);
    const {
      q,
      category,
      size,
      color,
      brand,
      minPriceMinor: rawMinPrice,
      maxPriceMinor: rawMaxPrice,
    } = request.query;
    const minPriceMinor = rawMinPrice === undefined
      ? null
      : typeof rawMinPrice === 'string' && /^\d+$/.test(rawMinPrice)
        ? Number(rawMinPrice)
        : NaN;
    const maxPriceMinor = rawMaxPrice === undefined
      ? null
      : typeof rawMaxPrice === 'string' && /^\d+$/.test(rawMaxPrice)
        ? Number(rawMaxPrice)
        : NaN;
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (typeof q === 'string' && q.length > 100)
      || (brand !== undefined && (
        typeof brand !== 'string' ||
        brand.trim().length > 120
      ))
      || (rawMinPrice !== undefined && (!Number.isSafeInteger(minPriceMinor) || minPriceMinor < 0))
      || (rawMaxPrice !== undefined && (!Number.isSafeInteger(maxPriceMinor) || maxPriceMinor < 0))
      || (minPriceMinor !== null && maxPriceMinor !== null && minPriceMinor > maxPriceMinor)
    ) {
      return response.status(400).json({ error: 'Invalid search or pagination parameters.' });
    }

    const filter = { isActive: true };
    if (typeof q === 'string' && q.trim()) filter.$text = { $search: q.trim() };
    if (typeof category === 'string' && category.length <= 80) {
      filter.category = category.trim().toLowerCase();
    }
    if (typeof size === 'string' && size.length <= 50) filter.sizes = size.trim();
    if (typeof color === 'string' && color.length <= 50) filter.colors = color.trim();
    if (typeof brand === 'string' && brand.trim()) {
      filter.brand = new RegExp(`^${escapeRegex(brand.trim())}$`, 'i');
    }
    if (minPriceMinor !== null || maxPriceMinor !== null) {
      filter.priceMinor = {
        ...(minPriceMinor !== null ? { $gte: minPriceMinor } : {}),
        ...(maxPriceMinor !== null ? { $lte: maxPriceMinor } : {}),
      };
    }

    const [items, totalItems, brands, sizes] = await Promise.all([
      Product.find(filter)
        .sort(q ? { score: { $meta: 'textScore' } } : { createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
      Product.distinct('brand', { isActive: true }),
      Product.distinct('sizes', { isActive: true }),
    ]);

    return response.json({
      items,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      brands: brands.filter((value) => typeof value === 'string' && value.trim()).sort((a, b) => a.localeCompare(b)),
      sizes: sizes.filter((value) => typeof value === 'string' && value.trim()).sort((a, b) => a.localeCompare(b)),
    });
  });

  router.get('/:id', async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid product ID.' });
    }
    const product = await Product.findOne({ _id: request.params.id, isActive: true }).lean();
    if (!product) return response.status(404).json({ error: 'Product not found.' });
    return response.json({ product });
  });

  router.post('/', authenticate, async (request, response) => {
    const isAdmin = request.user.role === 'admin';
    if (!isAdmin && request.user.role !== 'vendor') {
      return response.status(403).json({ error: 'Vendor or administrator access is required.' });
    }

    const vendor = isAdmin
      ? null
      : await Vendor.findOne({ user: request.user._id, status: 'approved' });
    if (!isAdmin && !vendor) {
      return response.status(403).json({ error: 'An active vendor shop is required.' });
    }

    const input = vendor
      ? { ...(request.body ?? {}), vendorName: vendor.shopName }
      : request.body ?? {};
    const { errors, fields } = validateProduct(input);
    if (errors.length) return response.status(400).json({ error: errors.join(' ') });

    const product = await Product.create({
      ...fields,
      currency: 'NGN',
      ...(vendor ? { vendor: vendor._id } : {}),
    });
    return response.status(201).json({ product });
  });

  router.patch('/:id', authenticate, async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid product ID.' });
    }
    const isAdmin = request.user.role === 'admin';
    if (!isAdmin && request.user.role !== 'vendor') {
      return response.status(403).json({ error: 'Vendor or administrator access is required.' });
    }
    const vendor = isAdmin
      ? null
      : await Vendor.findOne({ user: request.user._id, status: 'approved' });
    if (!isAdmin && !vendor) {
      return response.status(403).json({ error: 'An active vendor shop is required.' });
    }

    const input = request.body ?? {};
    if (
      Object.keys(input).some(
        (field) =>
          !editableFields.includes(field) ||
          (!isAdmin && field === 'vendorName'),
      )
    ) {
      return response.status(400).json({ error: 'One or more product fields cannot be changed.' });
    }

    const { errors, fields } = validateProduct(input, true);
    if (!Object.keys(fields).length) {
      errors.push('Provide at least one product field to update.');
    }
    if (errors.length) return response.status(400).json({ error: errors.join(' ') });

    const filter = isAdmin
      ? { _id: request.params.id }
      : { _id: request.params.id, vendor: vendor._id };
    const product = await Product.findOneAndUpdate(filter, fields, {
      new: true,
      runValidators: true,
    });
    if (!product) return response.status(404).json({ error: 'Product not found.' });
    return response.json({ product });
  });

  router.delete('/:id', authenticate, async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid product ID.' });
    }
    const isAdmin = request.user.role === 'admin';
    if (!isAdmin && request.user.role !== 'vendor') {
      return response.status(403).json({ error: 'Vendor or administrator access is required.' });
    }
    const vendor = isAdmin
      ? null
      : await Vendor.findOne({ user: request.user._id, status: 'approved' });
    if (!isAdmin && !vendor) {
      return response.status(403).json({ error: 'An active vendor shop is required.' });
    }
    const filter = isAdmin
      ? { _id: request.params.id }
      : { _id: request.params.id, vendor: vendor._id };
    const product = await Product.findOneAndUpdate(
      filter,
      { isActive: false },
      { new: true },
    );
    if (!product) return response.status(404).json({ error: 'Product not found.' });
    return response.json({ product });
  });

  return router;
}
