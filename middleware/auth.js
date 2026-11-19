import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export function createAuthenticate(jwtSecret) {
  return async function authenticate(request, response, next) {
    const token = request.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      return response.status(401).json({ error: 'Authentication is required.' });
    }

    try {
      const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
      const user = await User.findById(payload.sub);
      if (!user || !user.isActive) {
        return response.status(401).json({ error: 'The account is unavailable.' });
      }

      request.user = user;
      return next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
        return response.status(401).json({ error: 'The access token is invalid or expired.' });
      }
      return next(error);
    }
  };
}

export function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') {
    return response.status(403).json({ error: 'Administrator access is required.' });
  }
  return next();
}
