import { Router } from 'express';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { createAuthenticate } from '../middleware/auth.js';
import Vendor from '../models/Vendor.js';

const maximumImageSize = 5 * 1024 * 1024;
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maximumImageSize, files: 1, fields: 0, parts: 1 },
});

function parseUpload(request, response) {
  return new Promise((resolve, reject) => {
    upload.single('image')(request, response, (error) => {
      if (error) reject(error);
      else resolve(request.file);
    });
  });
}

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'vestora/products',
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto' }],
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          const failure = new Error('Image storage is temporarily unavailable.');
          failure.statusCode = 502;
          reject(failure);
          return;
        }
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

export function createUploadRouter({ jwtSecret, cloudinaryConfig }) {
  const router = Router();
  const authenticate = createAuthenticate(jwtSecret);

  router.post('/images', authenticate, async (request, response, next) => {
    try {
      if (request.user.role !== 'admin') {
        if (request.user.role !== 'vendor') {
          return response.status(403).json({ error: 'An active vendor shop is required.' });
        }
        const vendor = await Vendor.exists({ user: request.user._id, status: 'approved' });
        if (!vendor) {
          return response.status(403).json({ error: 'An active vendor shop is required.' });
        }
      }

      const { cloudName, apiKey, apiSecret } = cloudinaryConfig;
      if (!cloudName || !apiKey || !apiSecret) {
        return response.status(503).json({ error: 'Product image storage is not configured.' });
      }
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });

      let file;
      try {
        file = await parseUpload(request, response);
      } catch (error) {
        if (error instanceof multer.MulterError) {
          const message = error.code === 'LIMIT_FILE_SIZE'
            ? 'Images must be 5 MB or smaller.'
            : 'Provide one image file at a time.';
          return response.status(400).json({ error: message });
        }
        throw error;
      }
      if (!file) return response.status(400).json({ error: 'An image file is required.' });
      if (!allowedImageTypes.has(file.mimetype)) {
        return response.status(415).json({ error: 'Use a JPEG, PNG, or WebP image.' });
      }

      const imageUrl = await uploadToCloudinary(file.buffer);
      return response.status(201).json({ imageUrl });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
