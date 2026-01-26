/**
 * Health Check Endpoints
 *
 * Provides liveness, readiness, and dependency health check endpoints
 * for Kubernetes probes and monitoring.
 *
 * @requirement 10.3 - Expose health check endpoints for all services
 */

import { Router, Request, Response } from 'express';

/**
 * Health status enumeration
 */
export const HealthStatus = {
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  DEGRADED: 'degraded',
} as const;

export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

/**
 * Dependency health check result
 */
export interface DependencyHealth {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  lastChecked: string;
}

/**
 * Overall health check response
 */
export interface HealthCheckResponse {
  status: HealthStatus;
  version: string;
  timestamp: string;
  uptime: number;
  dependencies: DependencyHealth[];
}

/**
 * Liveness probe response
 */
export interface LivenessResponse {
  alive: boolean;
  timestamp: string;
}

/**
 * Readiness probe response
 */
export interface ReadinessResponse {
  ready: boolean;
  timestamp: string;
  checks: {
    database: boolean;
    mlEndpoint: boolean;
    cache: boolean;
  };
}

/**
 * Dependency checker interface
 */
export interface DependencyChecker {
  name: string;
  check(): Promise<DependencyHealth>;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  version: string;
  dependencyCheckers: DependencyChecker[];
  startTime: Date;
}

/**
 * Default health check configuration
 */
export const defaultHealthConfig: HealthCheckConfig = {
  version: '1.0.0',
  dependencyCheckers: [],
  startTime: new Date(),
};

/**
 * Database health checker
 */
export class DatabaseHealthChecker implements DependencyChecker {
  name = 'database';
  private checkFn: () => Promise<boolean>;

  constructor(checkFn?: () => Promise<boolean>) {
    this.checkFn = checkFn || (async () => true);
  }

  async check(): Promise<DependencyHealth> {
    const startTime = Date.now();
    try {
      const isHealthy = await this.checkFn();
      const latencyMs = Date.now() - startTime;

      return {
        name: this.name,
        status: isHealthy ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
        latencyMs,
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      return {
        name: this.name,
        status: HealthStatus.UNHEALTHY,
        latencyMs,
        message: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date().toISOString(),
      };
    }
  }
}

/**
 * ML Endpoint health checker
 */
export class MLEndpointHealthChecker implements DependencyChecker {
  name = 'mlEndpoint';
  private checkFn: () => Promise<boolean>;

  constructor(checkFn?: () => Promise<boolean>) {
    this.checkFn = checkFn || (async () => true);
  }

  async check(): Promise<DependencyHealth> {
    const startTime = Date.now();
    try {
      const isHealthy = await this.checkFn();
      const latencyMs = Date.now() - startTime;

      return {
        name: this.name,
        status: isHealthy ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
        latencyMs,
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      return {
        name: this.name,
        status: HealthStatus.DEGRADED,
        latencyMs,
        message: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date().toISOString(),
      };
    }
  }
}

/**
 * Cache health checker
 */
export class CacheHealthChecker implements DependencyChecker {
  name = 'cache';
  private checkFn: () => Promise<boolean>;

  constructor(checkFn?: () => Promise<boolean>) {
    this.checkFn = checkFn || (async () => true);
  }

  async check(): Promise<DependencyHealth> {
    const startTime = Date.now();
    try {
      const isHealthy = await this.checkFn();
      const latencyMs = Date.now() - startTime;

      return {
        name: this.name,
        status: isHealthy ? HealthStatus.HEALTHY : HealthStatus.DEGRADED,
        latencyMs,
        lastChecked: new Date().toISOString(),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      return {
        name: this.name,
        status: HealthStatus.DEGRADED,
        latencyMs,
        message: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date().toISOString(),
      };
    }
  }
}

/**
 * Health check service
 */
export class HealthCheckService {
  private config: HealthCheckConfig;

  constructor(config: Partial<HealthCheckConfig> = {}) {
    this.config = { ...defaultHealthConfig, ...config };
  }

  /**
   * Gets the uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.config.startTime.getTime()) / 1000);
  }

  /**
   * Performs liveness check
   * Returns true if the service is alive (can respond to requests)
   */
  async checkLiveness(): Promise<LivenessResponse> {
    return {
      alive: true,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Performs readiness check
   * Returns true if the service is ready to accept traffic
   */
  async checkReadiness(): Promise<ReadinessResponse> {
    const dependencyResults = await this.checkDependencies();

    const checks = {
      database: true,
      mlEndpoint: true,
      cache: true,
    };

    for (const dep of dependencyResults) {
      if (dep.name === 'database') {
        checks.database = dep.status === HealthStatus.HEALTHY;
      } else if (dep.name === 'mlEndpoint') {
        // ML endpoint can be degraded but service is still ready
        checks.mlEndpoint = dep.status !== HealthStatus.UNHEALTHY;
      } else if (dep.name === 'cache') {
        // Cache can be degraded but service is still ready
        checks.cache = dep.status !== HealthStatus.UNHEALTHY;
      }
    }

    // Service is ready if database is healthy
    // ML and cache can be degraded
    const ready = checks.database;

    return {
      ready,
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  /**
   * Checks all dependencies
   */
  async checkDependencies(): Promise<DependencyHealth[]> {
    const results: DependencyHealth[] = [];

    for (const checker of this.config.dependencyCheckers) {
      try {
        const result = await checker.check();
        results.push(result);
      } catch (error) {
        results.push({
          name: checker.name,
          status: HealthStatus.UNHEALTHY,
          message: error instanceof Error ? error.message : 'Unknown error',
          lastChecked: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  /**
   * Performs full health check
   */
  async checkHealth(): Promise<HealthCheckResponse> {
    const dependencies = await this.checkDependencies();

    // Determine overall status
    let status: HealthStatus = HealthStatus.HEALTHY;

    for (const dep of dependencies) {
      if (dep.status === HealthStatus.UNHEALTHY) {
        // Database unhealthy = overall unhealthy
        if (dep.name === 'database') {
          status = HealthStatus.UNHEALTHY;
          break;
        }
        // Other dependencies unhealthy = degraded
        status = HealthStatus.DEGRADED;
      } else if (dep.status === HealthStatus.DEGRADED && status === HealthStatus.HEALTHY) {
        status = HealthStatus.DEGRADED;
      }
    }

    return {
      status,
      version: this.config.version,
      timestamp: new Date().toISOString(),
      uptime: this.getUptime(),
      dependencies,
    };
  }
}

/**
 * Creates the health check router
 * @requirement 10.3 - Expose health check endpoints for all services
 */
export function createHealthRouter(config: Partial<HealthCheckConfig> = {}): Router {
  const router = Router();
  const healthService = new HealthCheckService(config);

  /**
   * GET /health
   * Full health check with dependency status
   */
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const health = await healthService.checkHealth();

      const statusCode =
        health.status === HealthStatus.HEALTHY
          ? 200
          : health.status === HealthStatus.DEGRADED
            ? 200
            : 503;

      res.status(statusCode).json(health);
    } catch (error) {
      res.status(503).json({
        status: HealthStatus.UNHEALTHY,
        version: config.version || '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: 0,
        dependencies: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /health/live
   * Liveness probe - is the service alive?
   */
  router.get('/live', async (_req: Request, res: Response) => {
    try {
      const liveness = await healthService.checkLiveness();
      res.status(200).json(liveness);
    } catch (error) {
      res.status(503).json({
        alive: false,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /health/ready
   * Readiness probe - is the service ready to accept traffic?
   */
  router.get('/ready', async (_req: Request, res: Response) => {
    try {
      const readiness = await healthService.checkReadiness();
      const statusCode = readiness.ready ? 200 : 503;
      res.status(statusCode).json(readiness);
    } catch (error) {
      res.status(503).json({
        ready: false,
        timestamp: new Date().toISOString(),
        checks: {
          database: false,
          mlEndpoint: false,
          cache: false,
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /health/dependencies
   * Detailed dependency health status
   */
  router.get('/dependencies', async (_req: Request, res: Response) => {
    try {
      const dependencies = await healthService.checkDependencies();
      res.status(200).json({
        timestamp: new Date().toISOString(),
        dependencies,
      });
    } catch (error) {
      res.status(503).json({
        timestamp: new Date().toISOString(),
        dependencies: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}

/**
 * Default health router with no dependency checkers
 */
export const healthRouter = createHealthRouter();
