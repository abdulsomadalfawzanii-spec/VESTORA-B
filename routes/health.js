import { Router } from 'express';

export function createHealthRouter(isDatabaseConnected) {
  const router = Router();

  router.get('/', (_request, response) => {
    const databaseConnected = isDatabaseConnected();

    response.status(databaseConnected ? 200 : 503).json({
      status: databaseConnected ? 'ok' : 'degraded',
      service: 'available',
      database: databaseConnected ? 'connected' : 'disconnected',
    });
  });

  return router;
}
