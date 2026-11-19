import { loadConfig } from '../config/env.js';
import { connectToDatabase, disconnectFromDatabase } from '../config/database.js';
import User from '../models/User.js';

try {
  const config = loadConfig();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password || password.length < 12) {
    throw new Error('Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters.');
  }

  await connectToDatabase(config.mongoUri);
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error('That email already has an account; refusing to promote or overwrite it.');
  }

  await User.create({
    name: 'VESTORA Administrator',
    email,
    passwordHash: password,
    role: 'admin',
  });
  console.info('Administrator account created.');
} catch (error) {
  console.error('Failed to create administrator:', error.message);
  process.exitCode = 1;
} finally {
  await disconnectFromDatabase();
}
