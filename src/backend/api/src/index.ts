/**
 * API Layer Entry Point
 *
 * Main entry point for the RetailFixIt REST API.
 * Configures Express with middleware, routes, and OpenAPI documentation.
 *
 * @requirement 7.4 - RESTful APIs with OpenAPI/Swagger documentation
 * @requirement 11.1 - Azure AD authentication for all API endpoints
 * @requirement 11.2 - Role-based access control
 * @requirement 11.5 - API rate limiting
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';

// Routes
import { recommendationsRouter } from './routes/recommendations.js';
import { overridesRouter } from './routes/overrides.js';

// Middleware
import { authMiddleware, type AuthConfig } from './middleware/auth.js';
import { requirePermission } from './middleware/rbac.js';
import { rateLimiter, startCleanupTimer } from './middleware/rate-limiter.js';

export const VERSION = '1.0.0';

/**
 * API configuration
 */
export interface ApiConfig {
  port: number;
  auth: AuthConfig;
  enableSwagger: boolean;
  enableRateLimiting: boolean;
}

/**
 * Default API configuration
 */
export const defaultApiConfig: ApiConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  auth: {
    tenantId: process.env.AZURE_AD_TENANT_ID || 'default-tenant',
    clientId: process.env.AZURE_AD_CLIENT_ID || 'default-client',
    audience: process.env.AZURE_AD_AUDIENCE || 'api://retailfixit',
    skipAuth: process.env.SKIP_AUTH === 'true',
  },
  enableSwagger: process.env.ENABLE_SWAGGER !== 'false',
  enableRateLimiting: process.env.ENABLE_RATE_LIMITING !== 'false',
};

/**
 * Creates and configures the Express application
 */
export function createApp(config: Partial<ApiConfig> = {}): Express {
  const fullConfig: ApiConfig = { ...defaultApiConfig, ...config };
  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // CORS headers (configure as needed for production)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-ID');
    next();
  });

  // Handle preflight requests
  app.options('*', (_req: Request, res: Response) => {
    res.sendStatus(204);
  });

  // Rate limiting (if enabled)
  if (fullConfig.enableRateLimiting) {
    startCleanupTimer();
    app.use('/api', rateLimiter());
  }

  // Health check endpoint (no auth required)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      version: VERSION,
      timestamp: new Date().toISOString(),
      dependencies: {
        database: 'healthy',
        mlEndpoint: 'healthy',
        cache: 'healthy',
      },
    });
  });

  // Readiness probe
  app.get('/ready', (_req: Request, res: Response) => {
    res.json({
      ready: true,
      timestamp: new Date().toISOString(),
    });
  });

  // Liveness probe
  app.get('/live', (_req: Request, res: Response) => {
    res.json({
      alive: true,
      timestamp: new Date().toISOString(),
    });
  });

  // OpenAPI/Swagger documentation (if enabled)
  if (fullConfig.enableSwagger) {
    try {
      // Use process.cwd() for path resolution in both ESM and CJS
      const openapiPath = path.join(process.cwd(), 'src/backend/api/src/openapi.yaml');
      const swaggerDocument = YAML.load(openapiPath);
      app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
      app.get('/api-docs.json', (_req: Request, res: Response) => {
        res.json(swaggerDocument);
      });
    } catch (error) {
      console.warn('Failed to load OpenAPI spec:', error);
    }
  }

  // API routes with authentication
  const apiRouter = express.Router();

  // Apply authentication middleware to all API routes
  apiRouter.use(authMiddleware(fullConfig.auth));

  // Recommendations routes
  apiRouter.use(
    '/recommendations',
    requirePermission('view:recommendations'),
    recommendationsRouter
  );

  // Overrides routes
  apiRouter.use(
    '/overrides',
    requirePermission('create:overrides'),
    overridesRouter
  );

  // Mount API router
  app.use('/api/v1', apiRouter);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'NotFound',
      message: 'The requested resource was not found',
    });
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'InternalError',
      message: 'An unexpected error occurred',
      correlationId: req.headers['x-correlation-id'],
    });
  });

  return app;
}

/**
 * Starts the API server
 */
export function startServer(config: Partial<ApiConfig> = {}): void {
  const fullConfig: ApiConfig = { ...defaultApiConfig, ...config };
  const app = createApp(fullConfig);

  app.listen(fullConfig.port, () => {
    console.log(`RetailFixIt API server running on port ${fullConfig.port}`);
    console.log(`Health check: http://localhost:${fullConfig.port}/health`);
    if (fullConfig.enableSwagger) {
      console.log(`API docs: http://localhost:${fullConfig.port}/api-docs`);
    }
  });
}

// Export routes and middleware for testing
export { recommendationsRouter } from './routes/recommendations.js';
export { overridesRouter } from './routes/overrides.js';
export { authMiddleware, type AuthenticatedRequest, type AuthenticatedUser } from './middleware/auth.js';
export { requirePermission, requireRole, type Action } from './middleware/rbac.js';
export type { UserRole } from './middleware/auth.js';
export { rateLimiter } from './middleware/rate-limiter.js';

// Start server if run directly
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startServer();
}
