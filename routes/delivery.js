import { Router } from 'express';
import mongoose from 'mongoose';
import { createAuthenticate } from '../middleware/auth.js';
import DeliveryProfile from '../models/DeliveryProfile.js';
import Order from '../models/Order.js';
import User from '../models/User.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordMinimumLength = 12;

function requireDelivery(request, response, next) {
  if (request.user?.role !== 'delivery') {
    return response.status(403).json({ error: 'Delivery personnel access is required.' });
  }
  return next();
}

export function createDeliveryRouter({ jwtSecret }) {
  const router = Router();
  const authenticate = createAuthenticate(jwtSecret);

  router.post('/register', async (request, response) => {
    const {
      name,
      email,
      password,
      phone,
      vehicleType,
      vehicleDescription = '',
      licenseNumber = '',
    } = request.body ?? {};
    if (
      typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120 ||
      typeof email !== 'string' || !emailPattern.test(email.trim()) ||
      typeof password !== 'string' || password.length < passwordMinimumLength || password.length > 128 ||
      typeof phone !== 'string' || !phone.trim() || phone.length > 32 ||
      typeof vehicleType !== 'string' || !vehicleType.trim() || vehicleType.length > 60 ||
      typeof vehicleDescription !== 'string' || vehicleDescription.length > 120 ||
      typeof licenseNumber !== 'string' || licenseNumber.length > 80
    ) {
      return response.status(400).json({ error: 'Provide valid account, contact, and vehicle details.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) {
      return response.status(409).json({ error: 'An account with that email already exists.' });
    }
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone.trim(),
      passwordHash: password,
      role: 'delivery',
    });
    try {
      const deliveryProfile = await DeliveryProfile.create({
        user: user._id,
        phone: phone.trim(),
        vehicleType: vehicleType.trim(),
        vehicleDescription: vehicleDescription.trim(),
        licenseNumber: licenseNumber.trim(),
      });
      return response.status(201).json({
        deliveryProfile,
        message: 'Your profile is registered and waiting for administrator verification.',
      });
    } catch (error) {
      await User.deleteOne({ _id: user._id });
      throw error;
    }
  });

  router.use(authenticate, requireDelivery);

  router.get('/me', async (request, response) => {
    const deliveryProfile = await DeliveryProfile.findOne({ user: request.user._id }).lean();
    if (!deliveryProfile) return response.status(404).json({ error: 'Delivery profile not found.' });
    return response.json({ deliveryProfile });
  });

  router.patch('/me/profile', async (request, response) => {
    const allowedFields = ['phone', 'vehicleType', 'vehicleDescription', 'licenseNumber'];
    const input = request.body ?? {};
    if (Object.keys(input).some((field) => !allowedFields.includes(field))) {
      return response.status(400).json({ error: 'One or more profile fields cannot be changed.' });
    }
    const updates = {};
    for (const [field, maxLength] of [
      ['phone', 32],
      ['vehicleType', 60],
      ['vehicleDescription', 120],
      ['licenseNumber', 80],
    ]) {
      if (input[field] === undefined) continue;
      if (
        typeof input[field] !== 'string' ||
        input[field].trim().length > maxLength ||
        (['phone', 'vehicleType'].includes(field) && !input[field].trim())
      ) {
        return response.status(400).json({ error: `Provide a valid ${field}.` });
      }
      updates[field] = input[field].trim();
    }
    if (!Object.keys(updates).length) {
      return response.status(400).json({ error: 'Provide at least one profile field to update.' });
    }
    const profile = await DeliveryProfile.findOneAndUpdate(
      { user: request.user._id },
      { $set: updates },
      { new: true, runValidators: true },
    );
    if (!profile) return response.status(404).json({ error: 'Delivery profile not found.' });
    return response.json({ deliveryProfile: profile });
  });

  router.patch('/me/availability', async (request, response) => {
    const { isAvailable } = request.body ?? {};
    if (typeof isAvailable !== 'boolean') {
      return response.status(400).json({ error: 'isAvailable must be a boolean.' });
    }
    const profile = await DeliveryProfile.findOne({ user: request.user._id });
    if (!profile) return response.status(404).json({ error: 'Delivery profile not found.' });
    if (profile.verificationStatus !== 'verified') {
      return response.status(403).json({ error: 'Administrator verification is required before accepting deliveries.' });
    }
    if (!isAvailable) {
      const activeAssignment = await Order.exists({
        deliveryPerson: request.user._id,
        status: { $in: ['ready_for_pickup', 'picked_up'] },
      });
      if (activeAssignment) {
        return response.status(409).json({ error: 'Complete your assigned delivery before going offline.' });
      }
    }
    profile.isAvailable = isAvailable;
    await profile.save();
    return response.json({ deliveryProfile: profile });
  });

  router.get('/orders', async (request, response) => {
    const orders = await Order.find({
      deliveryPerson: request.user._id,
      status: { $in: ['ready_for_pickup', 'picked_up'] },
    })
      .populate('customer', 'name email phone')
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    return response.json({ orders });
  });

  router.post('/orders/:id/accept', async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid order ID.' });
    }
    const order = await Order.findOneAndUpdate(
      {
        _id: request.params.id,
        deliveryPerson: request.user._id,
        status: 'ready_for_pickup',
        deliveryAcceptedAt: null,
      },
      {
        $set: { deliveryAcceptedAt: new Date() },
        $push: {
          statusHistory: {
            status: 'ready_for_pickup',
            actor: request.user._id,
            note: 'Delivery assignment accepted.',
          },
        },
      },
      { new: true },
    );
    if (!order) return response.status(409).json({ error: 'This delivery assignment is no longer available.' });
    return response.json({ order });
  });

  router.patch('/orders/:id/status', async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      return response.status(400).json({ error: 'Invalid order ID.' });
    }
    const { status } = request.body ?? {};
    if (!['picked_up', 'delivered'].includes(status)) {
      return response.status(400).json({ error: 'Choose picked_up or delivered.' });
    }
    const order = await Order.findOne({
      _id: request.params.id,
      deliveryPerson: request.user._id,
    });
    if (!order) return response.status(404).json({ error: 'Assigned order not found.' });
    if (!order.deliveryAcceptedAt) {
      return response.status(409).json({ error: 'Accept the delivery assignment first.' });
    }
    const allowedNext = {
      ready_for_pickup: 'picked_up',
      picked_up: 'delivered',
    };
    if (allowedNext[order.status] !== status) {
      return response.status(409).json({ error: 'That delivery status transition is not allowed.' });
    }
    order.status = status;
    if (status === 'delivered') order.deliveredAt = new Date();
    order.statusHistory.push({
      status,
      actor: request.user._id,
      note: status === 'delivered' ? 'Delivery completed.' : 'Order picked up from vendor.',
    });
    await order.save();
    if (status === 'delivered') {
      await DeliveryProfile.updateOne({ user: request.user._id }, { $set: { isAvailable: true } });
    }
    return response.json({ order });
  });

  router.get('/history', async (request, response) => {
    const orders = await Order.find({
      deliveryPerson: request.user._id,
      status: { $in: ['delivered', 'cancelled'] },
    })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    return response.json({
      completedDeliveryCount: orders.filter((order) => order.status === 'delivered').length,
      orders,
    });
  });

  return router;
}
