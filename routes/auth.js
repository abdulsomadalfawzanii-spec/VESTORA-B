import { Router } from 'express';
import { createAuthenticate } from '../middleware/auth.js';
import User from '../models/User.js';
import {
  createTokenPair,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../services/tokens.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordMinimumLength = 12;

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

function tokenResponse(response, tokens, user) {
  response.set('Cache-Control', 'no-store');
  return response.json({ ...tokens, user: publicUser(user) });
}

export function createAuthRouter({ jwtSecret }) {
  const router = Router();
  const authenticate = createAuthenticate(jwtSecret);

  router.post('/register', async (request, response) => {
    const { name, email, password, phone = '' } = request.body ?? {};
    if (
      typeof name !== 'string' ||
      name.trim().length < 2 ||
      name.trim().length > 120 ||
      typeof email !== 'string' ||
      !emailPattern.test(email.trim()) ||
      typeof password !== 'string' ||
      password.length < passwordMinimumLength ||
      password.length > 128 ||
      typeof phone !== 'string' ||
      phone.length > 32
    ) {
      return response.status(400).json({
        error: `Provide a name, valid email, and password between ${passwordMinimumLength} and 128 characters.`,
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.exists({ email: normalizedEmail });
    if (existing) {
      return response.status(409).json({ error: 'An account with that email already exists.' });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone.trim(),
      passwordHash: password,
      role: 'customer',
    });
    const tokens = await createTokenPair(user, jwtSecret);
    return tokenResponse(response.status(201), tokens, user);
  });

  router.post('/login', async (request, response) => {
    const { email, password } = request.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return response.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
    if (!user || !user.isActive || !(await user.comparePassword(password))) {
      return response.status(401).json({ error: 'Email or password is incorrect.' });
    }

    const tokens = await createTokenPair(user, jwtSecret);
    return tokenResponse(response, tokens, user);
  });

  router.post('/refresh', async (request, response) => {
    const result = await rotateRefreshToken(request.body?.refreshToken, jwtSecret);
    if (!result) {
      return response.status(401).json({ error: 'The refresh token is invalid or expired.' });
    }

    const { user, ...tokens } = result;
    return tokenResponse(response, tokens, user);
  });

  router.post('/logout', async (request, response) => {
    await revokeRefreshToken(request.body?.refreshToken);
    response.set('Cache-Control', 'no-store');
    return response.status(204).end();
  });

  router.get('/me', authenticate, (request, response) => {
    return response.json({ user: publicUser(request.user) });
  });

  router.patch('/me', authenticate, async (request, response) => {
    const { name, phone } = request.body ?? {};
    const updates = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120) {
        return response.status(400).json({ error: 'Name must be between 2 and 120 characters.' });
      }
      updates.name = name.trim();
    }

    if (phone !== undefined) {
      if (typeof phone !== 'string' || phone.length > 32) {
        return response.status(400).json({ error: 'Phone must be 32 characters or fewer.' });
      }
      updates.phone = phone.trim();
    }

    if (Object.keys(updates).length === 0) {
      return response.status(400).json({ error: 'Provide a name or phone to update.' });
    }

    const user = await User.findByIdAndUpdate(request.user._id, updates, {
      new: true,
      runValidators: true,
    });
    return response.json({ user: publicUser(user) });
  });

  return router;
}
