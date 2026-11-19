import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import { createAuthenticate } from '../middleware/auth.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import {
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from '../services/paystack.js';

const initializationLeaseMs = 60_000;

function isValidPaystackSignature(body, signature, secretKey) {
  if (!Buffer.isBuffer(body) || typeof signature !== 'string' || !secretKey) return false;
  const expected = createHmac('sha512', secretKey).update(body).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function confirmPayment(reference, secretKey) {
  const payment = await Payment.findOne({ reference });
  if (!payment) return { error: 'Payment reference not found.', status: 404 };
  if (payment.status === 'success') return { payment, order: await Order.findById(payment.order) };

  const order = await Order.findById(payment.order);
  if (!order) return { error: 'Order not found.', status: 404 };

  const transaction = await verifyPaystackTransaction(reference, { secretKey });
  if (
    transaction.reference !== reference ||
    transaction.status !== 'success' ||
    transaction.amount !== payment.amountMinor ||
    transaction.currency !== 'NGN' ||
    transaction.customer?.email?.toLowerCase() !== order.customerEmail
  ) {
    payment.status = 'failed';
    await payment.save();
    return { error: 'Paystack could not verify the expected payment.', status: 409 };
  }

  const updatedPayment = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $ne: 'success' } },
    {
      $set: {
        status: 'success',
        transactionId: transaction.id,
        channel: transaction.channel ?? '',
        paidAt: transaction.paid_at ? new Date(transaction.paid_at) : new Date(),
      },
    },
    { new: true },
  );
  if (updatedPayment) {
    const paidOrder = await Order.updateOne(
      { _id: order._id, status: 'pending_payment' },
      {
        $set: { status: 'paid', paidAt: updatedPayment.paidAt },
        $push: {
          statusHistory: {
            status: 'paid',
            note: 'Paystack payment verified.',
            createdAt: updatedPayment.paidAt,
          },
        },
      },
    );
    if (paidOrder.modifiedCount === 0) {
      await Order.updateOne(
        { _id: order._id, status: 'cancelled', refundStatus: 'not_required' },
        {
          $set: { refundStatus: 'required', paidAt: updatedPayment.paidAt },
          $push: {
            statusHistory: {
              status: 'cancelled',
              note: 'Payment completed after cancellation; administrator refund action is required.',
              createdAt: updatedPayment.paidAt,
            },
          },
        },
      );
    }
  }

  return {
    payment: updatedPayment ?? await Payment.findById(payment._id),
    order: await Order.findById(order._id),
  };
}

export function createPaymentRouter({ jwtSecret, paystackSecretKey, callbackUrl }) {
  const router = Router();
  const authenticate = createAuthenticate(jwtSecret);

  router.post('/webhook', async (request, response) => {
    const signature = request.get('x-paystack-signature');
    if (!isValidPaystackSignature(request.body, signature, paystackSecretKey)) {
      return response.status(401).json({ error: 'Invalid Paystack signature.' });
    }

    let event;
    try {
      event = JSON.parse(request.body.toString('utf8'));
    } catch {
      return response.status(400).json({ error: 'Invalid webhook payload.' });
    }

    if (event.event !== 'charge.success' || typeof event.data?.reference !== 'string') {
      return response.status(200).json({ received: true });
    }

    const payment = await Payment.findOne({ reference: event.data.reference });
    if (!payment) return response.status(200).json({ received: true });

    const result = await confirmPayment(payment.reference, paystackSecretKey);
    if (result.error) {
      return response.status(result.status).json({ error: result.error });
    }
    return response.status(200).json({ received: true });
  });

  router.post('/initialize', authenticate, async (request, response) => {
    if (request.user.role !== 'customer') {
      return response.status(403).json({ error: 'Customer access is required to pay for an order.' });
    }
    const { orderId } = request.body ?? {};
    if (!mongoose.isValidObjectId(orderId)) {
      return response.status(400).json({ error: 'A valid orderId is required.' });
    }

    const orderFilter = {
      _id: orderId,
      status: 'pending_payment',
      customer: request.user._id,
    };
    const order = await Order.findOne(orderFilter);
    if (!order) return response.status(404).json({ error: 'Payable order not found.' });

    let payment = await Payment.findOne({ order: order._id });
    if (payment?.status === 'success') {
      return response.status(409).json({ error: 'This order has already been paid.' });
    }
    if (payment?.status === 'initialized' && payment.authorizationUrl) {
      return response.json({
        reference: payment.reference,
        authorizationUrl: payment.authorizationUrl,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      });
    }
    if (payment?.status === 'initializing') {
      const age = Date.now() - new Date(payment.updatedAt).getTime();
      if (age < initializationLeaseMs) {
        return response.status(409).json({ error: 'Payment initialization is already in progress.' });
      }
      payment.status = 'failed';
      await payment.save();
    }

    const reference = `vestora_${randomUUID().replaceAll('-', '')}`;
    if (payment) {
      payment.reference = reference;
      payment.amountMinor = order.totalMinor;
      payment.status = 'initializing';
      payment.authorizationUrl = '';
      await payment.save();
    } else {
      payment = await Payment.create({
        order: order._id,
        customer: request.user._id,
        reference,
        amountMinor: order.totalMinor,
        currency: 'NGN',
        status: 'initializing',
      });
    }

    try {
      const transaction = await initializePaystackTransaction(
        {
          email: order.customerEmail,
          amountMinor: order.totalMinor,
          reference,
          currency: 'NGN',
          callbackUrl,
        },
        { secretKey: paystackSecretKey },
      );
      const authorizationUrl = new URL(transaction.authorization_url);
      if (
        authorizationUrl.protocol !== 'https:' ||
        authorizationUrl.hostname !== 'checkout.paystack.com'
      ) {
        throw new Error('Paystack returned an invalid checkout URL.');
      }

      payment.authorizationUrl = authorizationUrl.toString();
      payment.status = 'initialized';
      await payment.save();
      return response.status(201).json({
        reference,
        authorizationUrl: payment.authorizationUrl,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      });
    } catch (error) {
      payment.status = 'failed';
      await payment.save();
      throw error;
    }
  });

  router.post('/verify', authenticate, async (request, response) => {
    const { reference } = request.body ?? {};
    if (typeof reference !== 'string' || reference.length > 100) {
      return response.status(400).json({ error: 'A valid payment reference is required.' });
    }

    const payment = await Payment.findOne({ reference });
    if (!payment) return response.status(404).json({ error: 'Payment not found.' });
    if (
      request.user.role !== 'admin' &&
      payment.customer.toString() !== request.user._id.toString()
    ) {
      return response.status(404).json({ error: 'Payment not found.' });
    }

    const result = await confirmPayment(reference, paystackSecretKey);
    if (result.error) {
      return response.status(result.status).json({ error: result.error });
    }

    return response.json({
      payment: {
        reference: result.payment.reference,
        status: result.payment.status,
        amountMinor: result.payment.amountMinor,
        currency: result.payment.currency,
      },
      order: result.order,
    });
  });

  return router;
}
