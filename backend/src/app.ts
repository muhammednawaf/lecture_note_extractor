import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './core/config.js';
import { connectDB, getIsMongoConnected } from './database/connection.js';
import {
  securityHeadersMiddleware,
  globalApiRateLimiter,
  sanitizeNoSqlPayload,
} from './core/security.middleware.js';

import jobsRoutes from './api/routes/jobs.routes.js';
import framesRoutes from './api/routes/frames.routes.js';
import pagesRoutes from './api/routes/pages.routes.js';
import exportRoutes from './api/routes/export.routes.js';
import authRoutes from './api/routes/auth.routes.js';
import { StorageCleanupService } from './services/storageCleanup.service.js';

const app = express();

// Trust first proxy hop (e.g. Nginx, Cloudflare, AWS ALB) for accurate client IP rate limiting
app.set('trust proxy', 1);

// 1. Security Headers (Defend against XSS, Clickjacking, MIME sniffing)
app.use(securityHeadersMiddleware);

// 2. Strict CORS Configuration
const isProduction = process.env.NODE_ENV === 'production';
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // In production, strictly enforce allowed origins
      if (config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      // In development, permit localhost/127.0.0.1 origins
      if (!isProduction && (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))) {
        return callback(null, true);
      }

      return callback(new Error(`Origin '${origin}' blocked by CORS security policy`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// 3. Body parsers with safe size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. NoSQL Operator Injection Sanitization
app.use(sanitizeNoSqlPayload);

// 5. Rate Limiting on API endpoints
app.use('/api', globalApiRateLimiter);

// 6. Static file serving with permissive cross-origin headers for previews
app.use(
  '/storage',
  (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(config.storageDir, {
    dotfiles: 'ignore',
    index: false,
    maxAge: isProduction ? '1d' : 0,
  })
);

// 7. Health check endpoint (for load balancers & monitoring)
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'Video2PDF Backend',
    database: getIsMongoConnected() ? 'mongodb' : 'memory-fallback',
    environment: isProduction ? 'production' : 'development',
    timestamp: new Date().toISOString(),
  });
});

// 8. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/jobs', framesRoutes);
app.use('/api', pagesRoutes);
app.use('/api', exportRoutes);

// 9. Centralized Error Handler (suppresses stack traces in production)
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Unhandled Error]:', err?.message || err);

  const status = err.status || 500;
  const message = isProduction
    ? status === 500
      ? 'An unexpected internal server error occurred'
      : err.message
    : err.message || 'Internal Server Error';

  res.status(status).json({
    error: message,
    ...(!isProduction && { stack: err.stack }),
  });
});

// Start server
async function startServer() {
  await connectDB();

  // Start automated 15-minute storage and database retention cleanup daemon
  StorageCleanupService.startScheduledCleanup();

  const server = app.listen(config.port, config.host, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Video2PDF Backend running on http://${config.host}:${config.port}`);
    console.log(`📂 Storage directory: ${config.storageDir}`);
    console.log(`🏥 Health check: http://${config.host}:${config.port}/health`);
    console.log(`🛡 Environment: ${isProduction ? 'PRODUCTION (Hardened)' : 'DEVELOPMENT'}`);
    console.log(`🧹 Storage Auto-Cleanup: 15-Minute Retention Daemon Active`);
    console.log(`=======================================================`);
  });

  // Graceful shutdown handling for containerized / production deployments
  const gracefulShutdown = (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    StorageCleanupService.stopScheduledCleanup();
    server.close(() => {
      console.log('[Server] HTTP server closed cleanly.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[Server] Forceful shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Global process error safety guards
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
});

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});

export default app;
