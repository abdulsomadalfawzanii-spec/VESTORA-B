import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

export function loadConfig() {
  const port = Number(process.env.PORT ?? 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required. Set it in backend/.env.');
  }

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters.');
  }

  const frontendOrigins = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (frontendOrigins.length === 0) {
    throw new Error('FRONTEND_ORIGIN must contain at least one allowed origin.');
  }

  const commissionBps = Number(process.env.PLATFORM_COMMISSION_BPS ?? 1000);
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10000) {
    throw new Error('PLATFORM_COMMISSION_BPS must be an integer from 0 to 10000.');
  }

  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port,
    mongoUri,
    frontendOrigins,
    jwtSecret,
    paystackSecretKey: process.env.PAYSTACK_SECRET_KEY?.trim() || null,
    cloudinaryConfig: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() || null,
      apiKey: process.env.CLOUDINARY_API_KEY?.trim() || null,
      apiSecret: process.env.CLOUDINARY_API_SECRET?.trim() || null,
    },
    commissionBps,
    currency: 'NGN',
  };
}
