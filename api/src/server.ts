import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { config, isDev } from './config.js';
import { registerErrorHandler } from './errors.js';
import { logger } from './logger.js';
import authPlugin from './plugins/auth.js';
import metricsPlugin from './plugins/metrics.js';
import rbacPlugin from './plugins/rbac.js';
import requestId from './plugins/request-id.js';
import adminRoutes from './routes/admin.js';
import approvalRoutes from './routes/approvals.js';
import auditRoutes from './routes/audit.js';
import authRoutes from './routes/auth.js';
import customerRoutes from './routes/customers.js';
import cycleCountRoutes from './routes/cycle-counts.js';
import healthRoutes from './routes/health.js';
import invoiceRoutes from './routes/invoices.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes from './routes/payments.js';
import paymentTermRoutes from './routes/payment-terms.js';
import priceListRoutes from './routes/price-lists.js';
import productRoutes from './routes/products.js';
import routeRoutes from './routes/routes.js';
import stockRoutes from './routes/stock.js';
import userRoutes from './routes/users.js';
import warehouseRoutes from './routes/warehouses.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.API_LOG_LEVEL,
      ...(isDev()
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
            },
          }
        : {}),
    },
    disableRequestLogging: false,
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  // Global plugins
  await app.register(requestId);
  await app.register(metricsPlugin);
  await app.register(helmet, { contentSecurityPolicy: isDev() ? false : undefined });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(sensible);

  registerErrorHandler(app);

  // Health (no auth)
  await app.register(healthRoutes);

  // Auth + RBAC plugins (decorates req.user and req.rbacScope)
  await app.register(authPlugin);
  await app.register(rbacPlugin);

  // Versioned API
  await app.register(
    async (api) => {
      api.get('/', { config: { public: true } }, async () => ({
        name: 'liquor-os',
        version: '0.1.0',
      }));

      // Auth routes (public)
      await api.register(authRoutes);

      // Protected routes
      await api.register(userRoutes);
      await api.register(customerRoutes);
      await api.register(routeRoutes);
      await api.register(warehouseRoutes);
      await api.register(productRoutes);
      await api.register(priceListRoutes);
      await api.register(stockRoutes);
      await api.register(cycleCountRoutes);
      await api.register(auditRoutes);
      await api.register(approvalRoutes);
      await api.register(orderRoutes);
      await api.register(invoiceRoutes);
      await api.register(paymentRoutes);
      await api.register(paymentTermRoutes);
      await api.register(adminRoutes);
    },
    { prefix: '/v1' },
  );

  logger.info({ port: config.API_PORT, env: config.NODE_ENV }, 'server initialized');
  return app;
}
