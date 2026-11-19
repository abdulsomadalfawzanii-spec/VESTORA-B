import { Router } from 'express';
import mongoose from 'mongoose';
import { createAuthenticate, requireAdmin } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import DeliveryProfile from '../models/DeliveryProfile.js';
import Vendor from '../models/Vendor.js';
import PlatformSettings from '../models/PlatformSettings.js';

const allowedOrderTransitions = {
  pending_payment: ['cancelled'],
  paid: ['cancelled'],
  processing: ['cancelled'],
};

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) return null;

  const quantities = new Map();
  for (const item of items) {
    if (
      !item ||
      typeof item.productId !== 'string' ||
      !mongoose.isValidObjectId(item.productId) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 20
    ) {
      return null;
    }
    const size = typeof item.size === 'string' ? item.size.trim() : '';
    const color = typeof item.color === 'string' ? item.color.trim() : '';
    if (size.length > 50 || color.length > 50) return null;
    const key = `${item.productId}\u0000${size}\u0000${color}`;
    const quantity = (quantities.get(key)?.quantity ?? 0) + item.quantity;
    if (quantity > 20) return null;
    quantities.set(key, { productId: item.productId, quantity, size, color });
  }

  return [...quantities.values()];
}

function normalizeAddress(address) {
  const fields = ['recipient', 'phone', 'addressLine', 'city', 'state'];
  if (!address || fields.some((field) => typeof address[field] !== 'string')) return null;

  const result = {};
  for (const field of fields) {
    const value = address[field].trim();
    const maxLength = field === 'addressLine' ? 240 : field === 'phone' ? 32 : 120;
    if (!value || value.length > maxLength) return null;
    result[field] = value;
  }
  return result;
}

async function releaseReservations(reservations) {
  await Promise.all(
    reservations.map(({ _id, quantity }) =>
      Product.updateOne({ _id }, { $inc: { stock: quantity } }),
    ),
  );
}

export function createOrderRouter({ jwtSecret, commissionBps }) {
  const router = Router();
  const authenticate = createAuthenticate(jwtSecret);

  router.post('/', authenticate, async (request, response) => {
    if (request.user.role !== 'customer') {
      return response.status(403).json({ error: 'Customer access is required to place an order.' });
    }
    const items = normalizeItems(request.body?.items);
    const deliveryAddress = normalizeAddress(request.body?.deliveryAddress);
    if (!items || !deliveryAddress) {
      return response.status(400).json({
        error: 'Provide valid items and a complete delivery address.',
      });
    }

    const products = await Product.find({
      _id: { $in: [...new Set(items.map((item) => item.productId))] },
      isActive: true,
    }).lean();
    if (products.length !== new Set(items.map((item) => item.productId)).size) {
      return response.status(409).json({ error: 'One or more products are unavailable.' });
    }
    const vendors = await Vendor.find({
      _id: { $in: products.map((product) => product.vendor).filter(Boolean) },
      status: 'approved',
    })
      .select('shopName pickupAddressLine pickupCity pickupState')
      .lean();
    const vendorMap = new Map(vendors.map((vendor) => [vendor._id.toString(), vendor]));
    const settings = await PlatformSettings.findOne({ key: 'platform' }).select('commissionBps').lean();
    const activeCommissionBps = settings?.commissionBps ?? commissionBps;
    if (!Number.isInteger(activeCommissionBps) || activeCommissionBps < 0 || activeCommissionBps > 5000) {
      return response.status(503).json({ error: 'Marketplace commission is not configured correctly.' });
    }

    const reservations = [];
    const orderItems = [];
    const vendorFulfillments = new Map();
    let subtotalMinor = 0;

    for (const item of items) {
      const product = products.find((entry) => entry._id.toString() === item.productId);
      if (product?.vendor && !vendorMap.has(product.vendor.toString())) {
        await releaseReservations(reservations);
        return response.status(409).json({ error: 'A vendor shop in this order is unavailable.' });
      }
      if (!product || !Number.isSafeInteger(product.priceMinor * item.quantity)) {
        await releaseReservations(reservations);
        return response.status(400).json({ error: 'The order total is invalid.' });
      }
      if (
        (product.sizes.length && !product.sizes.includes(item.size)) ||
        (product.colors.length && !product.colors.includes(item.color))
      ) {
        await releaseReservations(reservations);
        return response.status(400).json({ error: `Choose a valid size and colour for ${product.name}.` });
      }

      const reservation = await Product.updateOne(
        { _id: product._id, isActive: true, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
      );
      if (reservation.modifiedCount !== 1) {
        await releaseReservations(reservations);
        return response.status(409).json({ error: `${product.name} is out of stock.` });
      }
      reservations.push({ _id: product._id, quantity: item.quantity });

      const lineTotalMinor = product.priceMinor * item.quantity;
      const commissionMinor = Math.floor((lineTotalMinor * activeCommissionBps) / 10000);
      subtotalMinor += lineTotalMinor;
      if (!Number.isSafeInteger(subtotalMinor)) {
        await releaseReservations(reservations);
        return response.status(400).json({ error: 'The order total is invalid.' });
      }

      orderItems.push({
        product: product._id,
        vendor: product.vendor ?? null,
        name: product.name,
        vendorName: product.vendorName,
        size: item.size,
        color: item.color,
        unitPriceMinor: product.priceMinor,
        quantity: item.quantity,
        lineTotalMinor,
        commissionMinor,
        vendorEarningsMinor: lineTotalMinor - commissionMinor,
      });
      if (product.vendor) {
        const vendor = vendorMap.get(product.vendor.toString());
        vendorFulfillments.set(product.vendor.toString(), {
          vendor: product.vendor,
          vendorName: vendor.shopName,
          pickupAddressLine: vendor.pickupAddressLine,
          pickupCity: vendor.pickupCity,
          pickupState: vendor.pickupState,
          status: 'new',
        });
      }
    }

    const commissionMinor = orderItems.reduce((sum, item) => sum + item.commissionMinor, 0);
    try {
      const order = await Order.create({
        customer: request.user._id,
        customerEmail: request.user.email,
        items: orderItems,
        vendorFulfillments: [...vendorFulfillments.values()],
        subtotalMinor,
        commissionMinor,
        totalMinor: subtotalMinor,
        currency: 'NGN',
        deliveryAddress,
        statusHistory: [{
          status: 'pending_payment',
          actor: request.user._id,
          note: 'Order created.',
        }],
      });
      return response.status(201).json({ order });
    } catch (error) {
      await releaseReservations(reservations);
      throw error;
    }
  });

  router.get('/', authenticate, async (request, response) => {
    if (!['customer', 'admin'].includes(request.user.role)) {
      return response.status(403).json({ error: 'Customer or administrator access is required.' });
    }
    const filter = request.user.role === 'admin' ? {} : { customer: request.user._id };
    const orders = await Order.find(filter).sort({ createdAt: -1 }).lean();
    return response.json({ orders });
  });

  router.get('/:id', authenticate, async (request, response) => {
    if (!['customer', 'admin'].includes(request.user.role)) {
      return response.status(403).json({ error: 'Customer or administrator access is required.' });
    }
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid order ID.' });
    }
    const filter = { _id: request.params.id };
    if (request.user.role !== 'admin') filter.customer = request.user._id;
    const order = await Order.findOne(filter).lean();
    if (!order) return response.status(404).json({ error: 'Order not found.' });
    return response.json({ order });
  });

  router.patch('/:id/status', authenticate, requireAdmin, async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid order ID.' });
    }
    const { status } = request.body ?? {};
    if (!Object.values(allowedOrderTransitions).some((next) => next.includes(status))) {
      return response.status(400).json({ error: 'Invalid order status transition.' });
    }
    const order = await Order.findById(request.params.id);
    if (!order) return response.status(404).json({ error: 'Order not found.' });
    if (!allowedOrderTransitions[order.status]?.includes(status)) {
      return response.status(409).json({ error: 'That order status transition is not allowed.' });
    }
    order.status = status;
    if (status === 'cancelled') {
      order.refundStatus = order.paidAt ? 'required' : 'not_required';
      await Promise.all(order.items.map((item) => (
        Product.updateOne({ _id: item.product }, { $inc: { stock: item.quantity } })
      )));
      if (order.deliveryPerson) {
        await DeliveryProfile.updateOne(
          { user: order.deliveryPerson },
          { $set: { isAvailable: true } },
        );
        order.deliveryPerson = null;
        order.deliveryAcceptedAt = null;
      }
    }
    order.statusHistory.push({
      status,
      actor: request.user._id,
      note: 'Order status updated by an administrator.',
    });
    await order.save();
    return response.json({ order });
  });

  return router;
}
