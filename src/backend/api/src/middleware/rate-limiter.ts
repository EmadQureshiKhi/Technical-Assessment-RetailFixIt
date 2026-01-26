/**
 * Rate Limiting Middleware
 *
 * Implements sliding window rate limiting to prevent API abuse.
 *
 * @requirement 11.5 - API rate limiting to prevent abuse
 * @property Property 23: Rate Limiting Enforcement
 * @tested tests/property/rate-limiting.property.test.ts
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Key generator function to identify clients */
  keyGenerator?: (req: Request) => string;
  /** Whether to skip rate limiting for certain requests */
  skip?: (req: Request) => boolean;
  /** Custom message for rate limit exceeded */
  message?: string;
}

/**
 * Default rate limit configuration
 */
export const defaultRateLimitConfig: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
};

/**
 * Rate limit entry for tracking requests
 */
interface RateLimitEntry {
  /** Timestamps of requests in the current window */
  timestamps: number[];
  /** When this entry was last accessed */
  lastAccess: number;
}

/**
 * In-memory rate limit store
 * In production, this would use Redis for distributed rate limiting
 */
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Cleanup interval for expired entries (5 minutes)
 */
const CLEANUP_INTERVAL = 5 * 60 * 1000;

/**
 * Cleans up expired rate limit entries
 */
function cleanupExpiredEntries(windowMs: number): void {
  const now = Date.now();
  const cutoff = now - windowMs * 2; // Keep entries for 2x window size

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.lastAccess < cutoff) {
      rateLimitStore.delete(key);
    }
  }
}

// Start cleanup interval
let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * Starts the cleanup timer
 */
export function startCleanupTimer(windowMs: number = defaultRateLimitConfig.windowMs): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  cleanupTimer = setInterval(() => cleanupExpiredEntries(windowMs), CLEANUP_INTERVAL);
}

/**
 * Stops the cleanup timer
 */
export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Clears the rate limit store (for testing)
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Gets the current rate limit status for a key
 */
export function getRateLimitStatus(key: string, config: RateLimitConfig = defaultRateLimitConfig): {
  remaining: number;
  reset: number;
  total: number;
} {
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const entry = rateLimitStore.get(key);

  if (!entry) {
    return {
      remaining: config.maxRequests,
      reset: Math.ceil((now + config.windowMs) / 1000),
      total: config.maxRequests,
    };
  }

  // Count requests in current window
  const requestsInWindow = entry.timestamps.filter((ts) => ts > windowStart).length;
  const remaining = Math.max(0, config.maxRequests - requestsInWindow);

  // Calculate reset time (when oldest request in window expires)
  const oldestInWindow = entry.timestamps.find((ts) => ts > windowStart);
  const reset = oldestInWindow
    ? Math.ceil((oldestInWindow + config.windowMs) / 1000)
    : Math.ceil((now + config.windowMs) / 1000);

  return {
    remaining,
    reset,
    total: config.maxRequests,
  };
}

/**
 * Default key generator - uses IP address
 */
export function defaultKeyGenerator(req: Request): string {
  // Try to get real IP from proxy headers
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
    return ips.trim();
  }

  // Fall back to direct IP
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Key generator that uses user ID if authenticated, otherwise IP
 */
export function userOrIpKeyGenerator(req: Request): string {
  const user = (req as any).user;
  if (user?.userId) {
    return `user:${user.userId}`;
  }
  return `ip:${defaultKeyGenerator(req)}`;
}

/**
 * Records a request for rate limiting
 */
function recordRequest(key: string, config: RateLimitConfig): {
  allowed: boolean;
  remaining: number;
  reset: number;
} {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let entry = rateLimitStore.get(key);

  if (!entry) {
    entry = { timestamps: [], lastAccess: now };
    rateLimitStore.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
  entry.lastAccess = now;

  // Check if limit exceeded
  if (entry.timestamps.length >= config.maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    const reset = Math.ceil((oldestInWindow + config.windowMs) / 1000);
    return {
      allowed: false,
      remaining: 0,
      reset,
    };
  }

  // Record this request
  entry.timestamps.push(now);

  const remaining = config.maxRequests - entry.timestamps.length;
  const reset = Math.ceil((entry.timestamps[0] + config.windowMs) / 1000);

  return {
    allowed: true,
    remaining,
    reset,
  };
}

/**
 * Rate limiting middleware factory
 *
 * Implements sliding window rate limiting.
 *
 * @requirement 11.5 - API rate limiting to prevent abuse
 * @property Property 23: Rate Limiting Enforcement - exceeding limits returns 429
 */
export function rateLimiter(config: Partial<RateLimitConfig> = {}) {
  const fullConfig: RateLimitConfig = {
    ...defaultRateLimitConfig,
    ...config,
  };

  const keyGenerator = fullConfig.keyGenerator || defaultKeyGenerator;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Check if rate limiting should be skipped
    if (fullConfig.skip?.(req)) {
      next();
      return;
    }

    // Generate key for this client
    const key = keyGenerator(req);

    // Record request and check limit
    const result = recordRequest(key, fullConfig);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', fullConfig.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.reset);

    if (!result.allowed) {
      // @property Property 23: Rate Limiting Enforcement - return 429
      const retryAfter = result.reset - Math.floor(Date.now() / 1000);
      res.setHeader('Retry-After', Math.max(1, retryAfter));

      res.status(429).json({
        error: 'RateLimited',
        message: fullConfig.message || 'Too many requests. Please try again later.',
        retryAfter: Math.max(1, retryAfter),
        correlationId: req.headers['x-correlation-id'],
      });
      return;
    }

    next();
  };
}

/**
 * Creates a rate limiter with custom limits per endpoint
 */
export function createEndpointRateLimiter(limits: Record<string, RateLimitConfig>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Find matching endpoint config
    const path = req.path;
    const method = req.method;
    const key = `${method}:${path}`;

    const config = limits[key] || limits[path] || limits['*'] || defaultRateLimitConfig;

    // Use the rate limiter with the specific config
    rateLimiter(config)(req, res, next);
  };
}

/**
 * Stricter rate limiter for sensitive endpoints
 */
export const strictRateLimiter = rateLimiter({
  maxRequests: 10,
  windowMs: 60 * 1000, // 10 requests per minute
  message: 'Rate limit exceeded for this sensitive endpoint. Please wait before retrying.',
});

/**
 * Lenient rate limiter for read-only endpoints
 */
export const lenientRateLimiter = rateLimiter({
  maxRequests: 200,
  windowMs: 60 * 1000, // 200 requests per minute
});

export default rateLimiter;
