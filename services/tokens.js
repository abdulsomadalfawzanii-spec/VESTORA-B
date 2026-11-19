import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import Session from '../models/Session.js';
import User from '../models/User.js';

const refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000;

function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createTokenPair(user, jwtSecret) {
  const accessToken = jwt.sign(
    { role: user.role },
    jwtSecret,
    { subject: user.id, expiresIn: '15m', algorithm: 'HS256' },
  );
  const refreshToken = randomBytes(48).toString('base64url');

  await Session.create({
    user: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + refreshLifetimeMs),
  });

  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(token, jwtSecret) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 200) {
    return null;
  }

  const now = new Date();
  const oldSession = await Session.findOneAndUpdate(
    {
      tokenHash: hashRefreshToken(token),
      revokedAt: null,
      expiresAt: { $gt: now },
    },
    { $set: { revokedAt: now } },
    { new: false },
  );

  if (!oldSession) {
    return null;
  }

  const user = await User.findById(oldSession.user);
  if (!user || !user.isActive) {
    return null;
  }

  const tokens = await createTokenPair(user, jwtSecret);
  return { ...tokens, user };
}

export async function revokeRefreshToken(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 200) {
    return;
  }

  await Session.updateOne(
    { tokenHash: hashRefreshToken(token), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}
