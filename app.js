import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { isDatabaseConnected } from './config/database.js';
import { createAuthRouter } from './routes/auth.js';
import { createAdminReviewRouter, createCustomerFeaturesRouter } from './routes/customerFeatures.js';
import { createAdminRouter } from './routes/admin.js';
import { createDeliveryRouter } from './routes/delivery.js';
import { createHealthRouter } from './routes/health.js';
import { createOrderRouter } from './routes/orders.js';
import { createPaymentRouter } from './routes/payments.js';
import { createProductRouter } from './routes/products.js';
import { createVendorRouter } from './routes/vendors.js';
import { createUploadRouter } from './routes/uploads.js';

export function createApp({
  databaseConnected = isDatabaseConnected,
  allowedOrigins = ['http://localhost:5173'],
  jwtSecret = process.env.JWT_SECRET,
  paystackSecretKey = process.env.PAYSTACK_SECRET_KEY,
  paystackCallbackUrl = process.env.PAYSTACK_CALLBACK_URL
    || 'http://localhost:5173/checkout/complete',
  cloudinaryConfig = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  commissionBps = Number(process.env.PLATFORM_COMMISSION_BPS ?? 1000),
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: allowedOrigins }));
  app.use(
    '/api/payments/webhook',
    express.raw({ type: 'application/json', limit: '20kb' }),
  );
  app.use(express.json({ limit: '20kb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );
  app.use(
    '/api/auth',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many authentication requests. Try again later.' },
    }),
  );
  app.use('/api/health', createHealthRouter(databaseConnected));
  app.use('/api/auth', createAuthRouter({ jwtSecret }));
  app.use('/api/delivery/register', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many delivery registration attempts. Try again later.' },
  }));
  app.use('/api/delivery', createDeliveryRouter({ jwtSecret }));
  app.use('/api/admin', createAdminRouter({ jwtSecret, defaultCommissionBps: commissionBps }));
  app.use('/api/admin/reviews', createAdminReviewRouter({ jwtSecret }));
  app.use('/api', createCustomerFeaturesRouter({ jwtSecret }));
  app.use('/api/products', createProductRouter({ jwtSecret }));
  app.use('/api/vendors', createVendorRouter({ jwtSecret }));
  app.use('/api/uploads', createUploadRouter({ jwtSecret, cloudinaryConfig }));
  app.use('/api/orders', createOrderRouter({ jwtSecret, commissionBps }));
  app.use('/api/payments', createPaymentRouter({
    jwtSecret,
    paystackSecretKey,
    callbackUrl: paystackCallbackUrl,
  }));

  app.use((_request, response) => {
    response.status(404).json({ error: 'Route not found.' });
  });

  app.use((error, _request, response, _next) => {
    if (error?.type === 'entity.parse.failed') {
      return response.status(400).json({ error: 'Invalid JSON request body.' });
    }
    if (error?.name === 'ValidationError') {
      return response.status(400).json({ error: error.message });
    }
    if (error?.code === 11000) {
      return response.status(409).json({ error: 'A record with that value already exists.' });
    }
    if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600) {
      return response.status(error.statusCode).json({ error: error.message });
    }

    console.error('Unhandled API error:', error?.message ?? 'Unknown error');
    return response.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}
