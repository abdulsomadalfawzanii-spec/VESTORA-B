import mongoose from 'mongoose';

export async function connectToDatabase(uri) {
  mongoose.connection.on('error', (error) => {
    console.error('MongoDB runtime connection error:', error.message);
  });

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.info('MongoDB connected.');
}

export async function disconnectFromDatabase() {
  await mongoose.disconnect();
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}
