import { Router } from 'express';
import mongoose from 'mongoose';
import { createAuthenticate } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Payout from '../models/Payout.js';
import Product from '../models/Product.js';
import Review from '../models/Review.js';
import Vendor from '../models/Vendor.js';
import { getVendorFinancialSummary } from '../services/vendorFinancials.js';

const applicationFields = [
  'shopName',
  'description',
  'contactPhone',
  'pickupAddressLine',
  'pickupCity',
  'pickupState',
];

export function validateVendorApplication(input) {
  const errors = [];
  const fields = {};
  const limits = {
    shopName: 120,
    description: 1000,
    contactPhone: 32,
    pickupAddressLine: 240,
    pickupCity: 100,
    pickupState: 100,
  };

  for (const field of applicationFields) {
    const value = input[field];
    if (
      typeof value !== 'string' ||
      value.trim().length === 0 ||
      value.trim().length > limits[field]
    ) {
      errors.push(`${field} must be a non-empty string of at most ${limits[field]} characters.`);
    } else {
      fields[field] = value.trim();
    }
  }

  return { errors, fields };
}

async function ensureVendorAccess(vendor, user) {
  if (vendor.status === 'pending') {
    vendor.status = 'approved';
    vendor.reviewedAt = null;
    vendor.reviewedBy = null;
    vendor.rejectionReason = '';
    await vendor.save();
  }
  if (vendor.status === 'approved' && user.role !== 'vendor') {
    user.role = 'vendor';
    await user.save();
  }
}

export function createVendorRouter({ jwtSecret }) {
  const router = Router();
  const authenticate = createAuthenticate(jwtSecret);

  router.get('/me', authenticate, async (request, response) => {
    const vendor = await Vendor.findOne({ user: request.user._id });
    if (vendor) await ensureVendorAccess(vendor, request.user);
    return response.json({ vendor });
  });

  router.post('/apply', authenticate, async (request, response) => {
    if (request.user.role !== 'customer') {
      return response.status(403).json({ error: 'Only customer accounts can apply to become a vendor.' });
    }

    const { errors, fields } = validateVendorApplication(request.body ?? {});
    if (errors.length) return response.status(400).json({ error: errors.join(' ') });

    let vendor = await Vendor.findOne({ user: request.user._id });
    if (vendor && vendor.status !== 'rejected') {
      return response.status(409).json({ error: 'A vendor application already exists for this account.' });
    }

    if (vendor) {
      Object.assign(vendor, fields, {
        status: 'approved',
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: '',
      });
      await vendor.save();
    } else {
      vendor = await Vendor.create({ ...fields, user: request.user._id, status: 'approved' });
    }
    await ensureVendorAccess(vendor, request.user);

    return response.status(201).json({ vendor });
  });

  router.patch('/me', authenticate, async (request, response) => {
    if (request.user.role !== 'vendor') {
      return response.status(403).json({ error: 'Vendor access is required.' });
    }
    const vendor = await Vendor.findOne({ user: request.user._id, status: 'approved' });
    if (!vendor) return response.status(404).json({ error: 'Active vendor shop not found.' });
    const { errors, fields } = validateVendorApplication(request.body ?? {});
    if (errors.length) return response.status(400).json({ error: errors.join(' ') });
    Object.assign(vendor, fields);
    await vendor.save();
    return response.json({ vendor });
  });

  router.get('/me/products', authenticate, async (request, response) => {
    const vendor = await Vendor.findOne({ user: request.user._id });
    if (!vendor || vendor.status === 'rejected') {
      return response.status(403).json({ error: 'An active vendor shop is required.' });
    }
    await ensureVendorAccess(vendor, request.user);

    const products = await Product.find({ vendor: vendor._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return response.json({ products });
  });

  router.get('/me/orders', authenticate, async (request, response) => {
    if (request.user.role !== 'vendor') {
      return response.status(403).json({ error: 'Vendor access is required.' });
    }
    const vendor = await Vendor.findOne({ user: request.user._id, status: 'approved' });
    if (!vendor) return response.status(403).json({ error: 'An active vendor shop is required.' });

    const orders = await Order.find({ 'vendorFulfillments.vendor': vendor._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return response.json({
      orders: orders.map((order) => ({
        ...order,
        items: order.items.filter((item) => item.vendor?.toString() === vendor._id.toString()),
        vendorFulfillment: order.vendorFulfillments.find(
          (entry) => entry.vendor.toString() === vendor._id.toString(),
        ),
      })),
    });
  });

  router.get('/me/summary', authenticate, async (request, response) => {
    if (request.user.role !== 'vendor') {
      return response.status(403).json({ error: 'Vendor access is required.' });
    }
    const vendor = await Vendor.findOne({ user: request.user._id, status: 'approved' });
    if (!vendor) return response.status(403).json({ error: 'An active vendor shop is required.' });

    const [summary, ratings] = await Promise.all([
      getVendorFinancialSummary(vendor._id),
      Review.aggregate([
        { $match: { vendor: vendor._id } },
        { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
    ]);
    summary.paidOutMinor = vendor.payoutTotalMinor ?? 0;
    summary.outstandingMinor = Math.max(0, summary.earningsMinor - summary.paidOutMinor);
    summary.ratingAverage = ratings[0] ? Math.round(ratings[0].average * 10) / 10 : 0;
    summary.ratingCount = ratings[0]?.count ?? 0;

    return response.json({ summary });
  });

  router.get('/me/payouts', authenticate, async (request, response) => {
    if (request.user.role !== 'vendor') {
      return response.status(403).json({ error: 'Vendor access is required.' });
    }
    const vendor = await Vendor.findOne({ user: request.user._id, status: 'approved' });
    if (!vendor) return response.status(403).json({ error: 'An active vendor shop is required.' });
    const payouts = await Payout.find({ vendor: vendor._id })
      .sort({ paidAt: -1 })
      .limit(100)
      .lean();
    return response.json({ payouts });
  });

  router.patch('/me/orders/:orderId/status', authenticate, async (request, response) => {
    if (request.user.role !== 'vendor') {
      return response.status(403).json({ error: 'Vendor access is required.' });
    }
    if (!mongoose.isValidObjectId(request.params.orderId)) {
      return response.status(400).json({ error: 'Invalid order ID.' });
    }
    const vendor = await Vendor.findOne({ user: request.user._id, status: 'approved' });
    if (!vendor) return response.status(403).json({ error: 'An active vendor shop is required.' });

    const { status } = request.body ?? {};
    if (!['accepted', 'preparing', 'ready_for_pickup', 'rejected'].includes(status)) {
      return response.status(400).json({ error: 'Invalid vendor order status.' });
    }
    const order = await Order.findOne({
      _id: request.params.orderId,
      'vendorFulfillments.vendor': vendor._id,
    });
    if (!order) return response.status(404).json({ error: 'Order not found.' });

    const fulfillment = order.vendorFulfillments.find(
      (entry) => entry.vendor.toString() === vendor._id.toString(),
    );
    const nextStatuses = {
      new: ['accepted', 'rejected'],
      accepted: ['preparing'],
      preparing: ['ready_for_pickup'],
    };
    if (
      !['paid', 'processing'].includes(order.status) ||
      !nextStatuses[fulfillment.status]?.includes(status)
    ) {
      return response.status(409).json({ error: 'That order status transition is not allowed.' });
    }
    if (
      status === 'ready_for_pickup' &&
      (!vendor.pickupAddressLine || !vendor.pickupCity || !vendor.pickupState)
    ) {
      return response.status(409).json({ error: 'Add a complete shop pickup address before marking orders ready.' });
    }

    fulfillment.status = status;
    fulfillment.updatedAt = new Date();
    if (status === 'rejected') {
      order.status = 'cancelled';
      order.refundStatus = order.paidAt ? 'required' : 'not_required';
      await Promise.all(order.items.map((item) => (
        Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } })
      )));
    } else if (status === 'ready_for_pickup') {
      order.status = order.vendorFulfillments.every((entry) => entry.status === 'ready_for_pickup')
        ? 'ready_for_pickup'
        : 'processing';
    } else {
      order.status = 'processing';
    }
    order.statusHistory.push({
      status,
      actor: request.user._id,
      note: status === 'rejected' && order.paidAt
        ? 'Vendor rejected the order; administrator refund action is required.'
        : `Vendor ${vendor.shopName} updated fulfillment.`,
    });
    await order.save();

    return response.json({ order });
  });

  return router;
}
