import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { connectToDatabase, disconnectFromDatabase } from './config/database.js';

let server;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.info(`Received ${signal}; shutting down.`);

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await disconnectFromDatabase();
  } catch (error) {
    console.error('Error during shutdown:', error.message);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  const config = loadConfig();
  const app = createApp({
    allowedOrigins: config.frontendOrigins,
    jwtSecret: config.jwtSecret,
    paystackSecretKey: config.paystackSecretKey,
    cloudinaryConfig: config.cloudinaryConfig,
    commissionBps: config.commissionBps,
  });
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(config.port);
    listener.once('listening', () => resolve(listener));
    listener.once('error', reject);
  });

  console.info(`VESTORA API listening on port ${config.port} (${config.nodeEnv}).`);
  try {
    await connectToDatabase(config.mongoUri);
  } catch (error) {
    console.error(
      'MongoDB is unavailable; the API is running with degraded readiness:',
      error.message,
    );
  }
} catch (error) {
  console.error('Failed to start VESTORA API:', error.message);
  await disconnectFromDatabase();
  process.exitCode = 1;
}
