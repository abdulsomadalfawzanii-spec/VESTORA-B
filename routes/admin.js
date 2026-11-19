import { Router } from 'express';
import mongoose from 'mongoose';
import { createAuthenticate, requireAdmin } from '../middleware/auth.js';
import DeliveryProfile from '../models/DeliveryProfile.js';
import Order from '../models/Order.js';
import Payout from '../models/Payout.js';
import PlatformSettings from '../models/PlatformSettings.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Vendor from '../models/Vendor.js';
import { getVendorFinancialSummary } from '../services/vendorFinancials.js';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createAdminRouter({ jwtSecret, defaultCommissionBps = 1000 }) {
  const router = Router();
  const authenticate = createAuthenticate(jwtSecret);
  router.use(authenticate, requireAdmin);

  router.get('/overview', async (_request, response) => {
    const [
      customerCount,
      vendorCount,
      deliveryCount,
      activeDeliveryCount,
      orderCount,
      openOrderCount,
      orderTotals,
      recentOrders,
    ] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      User.countDocuments({ role: 'vendor', isActive: true }),
      User.countDocuments({ role: 'delivery' }),
      DeliveryProfile.countDocuments({ verificationStatus: 'verified', isAvailable: true }),
      Order.countDocuments(),
      Order.countDocuments({ status: { $in: ['paid', 'processing', 'ready_for_pickup', 'picked_up'] } }),
      Order.aggregate([
        { $match: { paidAt: { $ne: null }, status: { $ne: 'cancelled' }, refundStatus: 'not_required' } },
        {
          $group: {
            _id: null,
            revenueMinor: { $sum: '$totalMinor' },
            commissionMinor: { $sum: '$commissionMinor' },
          },
        },
      ]),
      Order.find()
        .select('customerEmail totalMinor currency status createdAt refundStatus')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    return response.json({
      overview: {
        customerCount,
        vendorCount,
        deliveryCount,
        activeDeliveryCount,
        orderCount,
        openOrderCount,
        revenueMinor: orderTotals[0]?.revenueMinor ?? 0,
        commissionMinor: orderTotals[0]?.commissionMinor ?? 0,
      },
      recentOrders,
    });
  });

  router.get('/settings', async (_request, response) => {
    const settings = await PlatformSettings.findOne({ key: 'platform' }).lean();
    return response.json({
      settings: {
        commissionBps: settings?.commissionBps ?? defaultCommissionBps,
        currency: 'NGN',
      },
    });
  });

  router.patch('/settings', async (request, response) => {
    const { commissionBps } = request.body ?? {};
    if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 5000) {
      return response.status(400).json({ error: 'commissionBps must be a whole number between 0 and 5000.' });
    }
    const settings = await PlatformSettings.findOneAndUpdate(
      { key: 'platform' },
      { $set: { commissionBps, updatedBy: request.user._id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return response.json({ settings: { commissionBps: settings.commissionBps, currency: 'NGN' } });
  });

  router.get('/users', async (request, response) => {
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 25);
    const role = request.query.role;
    const search = request.query.q;
    const validRoles = ['admin', 'customer', 'vendor', 'delivery'];
    if (
      !Number.isInteger(page) || page < 1 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      (role !== undefined && !validRoles.includes(role)) ||
      (search !== undefined && (typeof search !== 'string' || search.length > 100))
    ) {
      return response.status(400).json({ error: 'Invalid user search or pagination parameters.' });
    }

    const filter = {};
    if (role) filter.role = role;
    if (typeof search === 'string' && search.trim()) {
      const matcher = new RegExp(escapeRegex(search.trim()), 'i');
      filter.$or = [{ name: matcher }, { email: matcher }];
    }
    const [users, totalItems] = await Promise.all([
      User.find(filter)
        .select('name email phone role isActive createdAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);
    return response.json({ users, page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) });
  });

  router.patch('/users/:id/status', async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid user ID.' });
    }
    const { isActive } = request.body ?? {};
    if (typeof isActive !== 'boolean') {
      return response.status(400).json({ error: 'isActive must be a boolean.' });
    }
    const user = await User.findById(request.params.id);
    if (!user) return response.status(404).json({ error: 'User not found.' });
    if (!isActive && user._id.equals(request.user._id)) {
      return response.status(409).json({ error: 'You cannot suspend your own administrator account.' });
    }
    if (!isActive && user.role === 'admin' && user.isActive) {
      const activeAdmins = await User.countDocuments({ role: 'admin', isActive: true });
      if (activeAdmins <= 1) {
        return response.status(409).json({ error: 'The final active administrator cannot be suspended.' });
      }
    }
    if (!isActive && user.role === 'delivery') {
      const activeDelivery = await Order.exists({
        deliveryPerson: user._id,
        status: { $in: ['ready_for_pickup', 'picked_up'] },
      });
      if (activeDelivery) {
        return response.status(409).json({ error: 'Reassign or complete the active delivery before suspending this account.' });
      }
    }
    user.isActive = isActive;
    await user.save();
    if (!isActive && user.role === 'delivery') {
      await DeliveryProfile.updateOne({ user: user._id }, { $set: { isAvailable: false } });
    }
    if (!isActive && user.role === 'vendor') {
      const vendor = await Vendor.findOne({ user: user._id });
      if (vendor) await Product.updateMany({ vendor: vendor._id }, { $set: { isActive: false } });
    }
    return response.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
      },
    });
  });

  router.get('/delivery-personnel', async (_request, response) => {
    const deliveryPersonnel = await DeliveryProfile.find()
      .populate('user', 'name email phone isActive')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return response.json({ deliveryPersonnel });
  });

  router.get('/vendors', async (_request, response) => {
    const vendors = await Vendor.find({ status: 'approved' })
      .populate('user', 'name email isActive')
      .sort({ shopName: 1 })
      .limit(500)
      .lean();
    return response.json({ vendors });
  });

  router.get('/vendor-payouts', async (_request, response) => {
    const payouts = await Payout.find()
      .populate('vendor', 'shopName')
      .populate('processedBy', 'name email')
      .sort({ paidAt: -1 })
      .limit(200)
      .lean();
    return response.json({ payouts });
  });

  router.post('/vendor-payouts', async (request, response) => {
    const { vendorId, amountMinor, reference, note = '' } = request.body ?? {};
    if (
      !mongoose.isValidObjectId(vendorId) ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor < 1 ||
      typeof reference !== 'string' ||
      reference.trim().length < 3 ||
      reference.trim().length > 120 ||
      typeof note !== 'string' ||
      note.length > 300
    ) {
      return response.status(400).json({ error: 'Provide a valid vendor, payout amount, reference, and note.' });
    }

    const vendor = await Vendor.findOne({ _id: vendorId, status: 'approved' });
    if (!vendor) return response.status(404).json({ error: 'Active vendor shop not found.' });
    const financialSummary = await getVendorFinancialSummary(vendor._id);
    const payoutLimit = financialSummary.earningsMinor - amountMinor;
    if (payoutLimit < 0) {
      return response.status(409).json({ error: 'The payout exceeds this vendor’s delivered-order earnings.' });
    }
    const updatedVendor = await Vendor.findOneAndUpdate(
      {
        _id: vendor._id,
        $or: [
          { payoutTotalMinor: { $lte: payoutLimit } },
          { payoutTotalMinor: { $exists: false } },
        ],
      },
      { $inc: { payoutTotalMinor: amountMinor } },
      { new: true },
    );
    if (!updatedVendor) {
      return response.status(409).json({ error: 'The payout exceeds the remaining vendor balance.' });
    }

    try {
      const payout = await Payout.create({
        vendor: vendor._id,
        amountMinor,
        reference: reference.trim(),
        note: note.trim(),
        processedBy: request.user._id,
      });
      return response.status(201).json({ payout, vendorPayoutTotalMinor: updatedVendor.payoutTotalMinor });
    } catch (error) {
      await Vendor.updateOne(
        { _id: vendor._id },
        { $inc: { payoutTotalMinor: -amountMinor } },
      );
      throw error;
    }
  });

  router.patch('/delivery-personnel/:userId/verification', async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.userId)) {
      return response.status(400).json({ error: 'Invalid user ID.' });
    }
    const { verificationStatus } = request.body ?? {};
    if (!['verified', 'rejected'].includes(verificationStatus)) {
      return response.status(400).json({ error: 'Choose verified or rejected.' });
    }
    const user = await User.findOne({ _id: request.params.userId, role: 'delivery', isActive: true });
    if (!user) return response.status(404).json({ error: 'Active delivery account not found.' });
    if (verificationStatus === 'rejected') {
      const activeDelivery = await Order.exists({
        deliveryPerson: user._id,
        status: { $in: ['ready_for_pickup', 'picked_up'] },
      });
      if (activeDelivery) {
        return response.status(409).json({ error: 'Complete or reassign this delivery before rejecting the profile.' });
      }
    }
    const activeDeliveryUser = await User.exists({
      _id: deliveryPersonId,
      role: 'delivery',
      isActive: true,
    });
    if (!activeDeliveryUser) {
      return response.status(404).json({ error: 'Active delivery account not found.' });
    }

    const profile = await DeliveryProfile.findOneAndUpdate(
      { user: user._id },
      {
        $set: {
          verificationStatus,
          reviewedAt: new Date(),
          reviewedBy: request.user._id,
          ...(verificationStatus === 'rejected' ? { isAvailable: false } : {}),
        },
      },
      { new: true, runValidators: true },
    );
    if (!profile) return response.status(404).json({ error: 'Delivery profile not found.' });
    return response.json({ deliveryProfile: profile });
  });

  router.get('/orders', async (request, response) => {
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 25);
    const status = request.query.status;
    const allowedStatuses = [
      'pending_payment', 'paid', 'processing', 'ready_for_pickup',
      'picked_up', 'delivered', 'cancelled',
    ];
    if (
      !Number.isInteger(page) || page < 1 ||
      !Number.isInteger(limit) || limit < 1 || limit > 100 ||
      (status !== undefined && !allowedStatuses.includes(status))
    ) {
      return response.status(400).json({ error: 'Invalid order search or pagination parameters.' });
    }
    const filter = status ? { status } : {};
    const [orders, totalItems] = await Promise.all([
      Order.find(filter)
        .populate('customer', 'name email phone')
        .populate('deliveryPerson', 'name email phone')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    return response.json({ orders, page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) });
  });

  router.post('/orders/:id/assign-delivery', async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid order ID.' });
    }
    const { deliveryPersonId } = request.body ?? {};
    if (!mongoose.isValidObjectId(deliveryPersonId)) {
      return response.status(400).json({ error: 'A valid deliveryPersonId is required.' });
    }

    const readyOrder = await Order.findOne({
      _id: request.params.id,
      status: 'ready_for_pickup',
      deliveryPerson: null,
    }).select('vendorFulfillments');
    if (!readyOrder) {
      return response.status(409).json({ error: 'Order is not ready for a delivery assignment.' });
    }
    if (!readyOrder.vendorFulfillments.length || readyOrder.vendorFulfillments.some((entry) => (
      !entry.pickupAddressLine || !entry.pickupCity || !entry.pickupState
    ))) {
      return response.status(409).json({ error: 'A vendor must provide a complete pickup address before assignment.' });
    }

    const profile = await DeliveryProfile.findOneAndUpdate(
      {
        user: deliveryPersonId,
        verificationStatus: 'verified',
        isAvailable: true,
      },
      { $set: { isAvailable: false } },
      { new: true },
    );
    if (!profile) {
      return response.status(409).json({ error: 'Choose an available, verified delivery person.' });
    }

    const order = await Order.findOneAndUpdate(
      {
        _id: request.params.id,
        status: 'ready_for_pickup',
        deliveryPerson: null,
      },
      {
        $set: { deliveryPerson: deliveryPersonId, deliveryAcceptedAt: null },
        $push: {
          statusHistory: {
            status: 'ready_for_pickup',
            actor: request.user._id,
            note: 'Delivery person assigned.',
          },
        },
      },
      { new: true },
    );
    if (!order) {
      await DeliveryProfile.updateOne(
        { _id: profile._id, isAvailable: false },
        { $set: { isAvailable: true } },
      );
      return response.status(409).json({ error: 'Order is not ready for a delivery assignment.' });
    }
    return response.json({ order });
  });

  router.patch('/orders/:id/refund', async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid order ID.' });
    }
    const { refundReference } = request.body ?? {};
    if (
      typeof refundReference !== 'string' ||
      refundReference.trim().length < 3 ||
      refundReference.trim().length > 120
    ) {
      return response.status(400).json({ error: 'Provide the completed refund reference.' });
    }
    const order = await Order.findOneAndUpdate(
      { _id: request.params.id, status: 'cancelled', refundStatus: 'required' },
      {
        $set: { refundStatus: 'refunded', refundReference: refundReference.trim() },
        $push: {
          statusHistory: {
            status: 'cancelled',
            actor: request.user._id,
            note: 'Administrator recorded completed refund.',
          },
        },
      },
      { new: true },
    );
    if (!order) return response.status(409).json({ error: 'This order is not awaiting a refund.' });
    return response.json({ order });
  });

  return router;
}
