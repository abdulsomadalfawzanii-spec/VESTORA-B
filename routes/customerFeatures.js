import { Router } from 'express';
import mongoose from 'mongoose';
import { createAuthenticate, requireAdmin } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Review from '../models/Review.js';
import User from '../models/User.js';

function requireCustomer(request, response, next) {
  if (request.user?.role !== 'customer') {
    return response.status(403).json({ error: 'Customer access is required.' });
  }
  return next();
}

async function updateProductRating(productId) {
  const [summary] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId) } },
    { $group: { _id: '$product', average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        ratingAverage: summary ? Math.round(summary.average * 10) / 10 : 0,
        ratingCount: summary?.count ?? 0,
      },
    },
  );
}

export function createCustomerFeaturesRouter({ jwtSecret }) {
  const router = Router();
  const authenticate = createAuthenticate(jwtSecret);

  router.get('/favorites', authenticate, requireCustomer, async (request, response) => {
    const user = await User.findById(request.user._id)
      .populate({
        path: 'favorites',
        match: { isActive: true },
      })
      .select('favorites')
      .lean();
    return response.json({ products: user?.favorites ?? [] });
  });

  router.put('/favorites/:productId', authenticate, requireCustomer, async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.productId)) {
      return response.status(400).json({ error: 'Invalid product ID.' });
    }
    const productExists = await Product.exists({
      _id: request.params.productId,
      isActive: true,
    });
    if (!productExists) return response.status(404).json({ error: 'Product not found.' });
    await User.updateOne(
      { _id: request.user._id },
      { $addToSet: { favorites: request.params.productId } },
    );
    return response.status(204).end();
  });

  router.delete('/favorites/:productId', authenticate, requireCustomer, async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.productId)) {
      return response.status(400).json({ error: 'Invalid product ID.' });
    }
    await User.updateOne(
      { _id: request.user._id },
      { $pull: { favorites: request.params.productId } },
    );
    return response.status(204).end();
  });

  router.get('/reviews/product/:productId', async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.productId)) {
      return response.status(400).json({ error: 'Invalid product ID.' });
    }
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 10);
    if (
      !Number.isInteger(page) || page < 1 ||
      !Number.isInteger(limit) || limit < 1 || limit > 50
    ) {
      return response.status(400).json({ error: 'Invalid review pagination parameters.' });
    }
    const filter = { product: request.params.productId };
    const [reviews, totalItems] = await Promise.all([
      Review.find(filter)
        .populate('customer', 'name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
    ]);
    return response.json({ reviews, page, limit, totalItems });
  });

  router.post('/reviews', authenticate, requireCustomer, async (request, response) => {
    const { orderId, productId, rating, comment = '' } = request.body ?? {};
    if (
      !mongoose.isValidObjectId(orderId) ||
      !mongoose.isValidObjectId(productId) ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5 ||
      typeof comment !== 'string' ||
      comment.length > 1200
    ) {
      return response.status(400).json({ error: 'Provide a valid delivered order, product, rating, and comment.' });
    }
    const order = await Order.findOne({
      _id: orderId,
      customer: request.user._id,
      status: 'delivered',
      'items.product': productId,
    }).select('items');
    if (!order) {
      return response.status(403).json({ error: 'Reviews are available only for products in your delivered orders.' });
    }
    const item = order.items.find((entry) => entry.product.toString() === productId);
    const review = await Review.create({
      customer: request.user._id,
      order: order._id,
      product: productId,
      vendor: item.vendor ?? null,
      rating,
      comment: comment.trim(),
    });
    await updateProductRating(productId);
    return response.status(201).json({ review });
  });

  router.get('/reviews/mine', authenticate, requireCustomer, async (request, response) => {
    const reviews = await Review.find({ customer: request.user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return response.json({ reviews });
  });

  router.delete('/reviews/:id', authenticate, async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid review ID.' });
    }
    const isAdmin = request.user.role === 'admin';
    const filter = isAdmin
      ? { _id: request.params.id }
      : { _id: request.params.id, customer: request.user._id };
    const review = await Review.findOneAndDelete(filter);
    if (!review) return response.status(404).json({ error: 'Review not found.' });
    await updateProductRating(review.product);
    return response.status(204).end();
  });

  return router;
}

export function createAdminReviewRouter({ jwtSecret }) {
  const router = Router();
  router.use(createAuthenticate(jwtSecret), requireAdmin);

  router.get('/', async (request, response) => {
    const reviews = await Review.find()
      .populate('customer', 'name email')
      .populate('product', 'name')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return response.json({ reviews });
  });

  return router;
}
