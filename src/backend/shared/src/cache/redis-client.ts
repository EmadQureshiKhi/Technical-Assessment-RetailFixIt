/**
 * Redis Cache Client
 *
 * Provides caching functionality for vendor profiles and ML feature data.
 * Implements TTL-based caching with automatic invalidation.
 *
 * @requirement Performance optimization - Caching layer for reduced latency
 * @property Property 6: Graceful ML Fallback - Cache supports fallback scenarios
 */

import { VendorProfile } from '../models/vendor.js';
import { ScoreFactors } from '../models/scoring.js';

/**
 * Cache configuration options
 */
export interface CacheConfig {
  /** Redis connection string */
  connectionString: string;
  /** Default TTL in seconds */
  defaultTtlSeconds: number;
  /** Vendor profile TTL in seconds (default: 300 = 5 minutes) */
  vendorProfileTtlSeconds: number;
  /** ML feature cache TTL in seconds (default: 60 = 1 minute) */
  mlFeatureTtlSeconds: number;
  /** Enable cache (can be disabled for testing) */
  enabled: boolean;
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  connectionString: process.env.REDIS_CONNECTION_STRING || '',
  defaultTtlSeconds: 300,
  vendorProfileTtlSeconds: 300, // 5 minutes
  mlFeatureTtlSeconds: 60, // 1 minute
  enabled: true,
};

/**
 * Cache key prefixes for different data types
 */
export const CACHE_KEY_PREFIX = {
  VENDOR_PROFILE: 'vendor:profile:',
  VENDOR_METRICS: 'vendor:metrics:',
  ML_FEATURES: 'ml:features:',
  RECOMMENDATION: 'recommendation:',
} as const;

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T> {
  data: T;
  cachedAt: Date;
  expiresAt: Date;
  version: string;
}

/**
 * In-memory cache implementation for development/testing
 * In production, this would be replaced with actual Redis client
 */
class InMemoryCache {
  private cache: Map<string, { value: string; expiresAt: number }> = new Map();

  async get(key: string): Promise<string | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async delPattern(pattern: string): Promise<number> {
    const prefix = pattern.replace('*', '');
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  async exists(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.cache.get(key);
    if (!entry) return -2;
    const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }
}

/**
 * Redis Cache Client
 *
 * Provides type-safe caching operations for the vendor dispatch system.
 * Uses in-memory cache for development, Redis for production.
 */
export class RedisCacheClient {
  private cache: InMemoryCache;
  private config: CacheConfig;
  private cacheVersion: string = '1.0.0';

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.cache = new InMemoryCache();
  }

  /**
   * Check if cache is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get vendor profile from cache
   *
   * @param vendorId - Vendor ID to look up
   * @returns Cached vendor profile or null if not found/expired
   */
  async getVendorProfile(vendorId: string): Promise<VendorProfile | null> {
    if (!this.config.enabled) return null;

    const key = `${CACHE_KEY_PREFIX.VENDOR_PROFILE}${vendorId}`;
    const cached = await this.cache.get(key);

    if (!cached) return null;

    try {
      const entry = JSON.parse(cached) as CacheEntry<VendorProfile>;
      return entry.data;
    } catch {
      return null;
    }
  }

  /**
   * Cache vendor profile
   *
   * @param vendorId - Vendor ID
   * @param profile - Vendor profile to cache
   * @param ttlSeconds - Optional TTL override
   */
  async setVendorProfile(
    vendorId: string,
    profile: VendorProfile,
    ttlSeconds?: number
  ): Promise<void> {
    if (!this.config.enabled) return;

    const key = `${CACHE_KEY_PREFIX.VENDOR_PROFILE}${vendorId}`;
    const ttl = ttlSeconds ?? this.config.vendorProfileTtlSeconds;

    const entry: CacheEntry<VendorProfile> = {
      data: profile,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + ttl * 1000),
      version: this.cacheVersion,
    };

    await this.cache.set(key, JSON.stringify(entry), ttl);
  }

  /**
   * Get multiple vendor profiles from cache
   *
   * @param vendorIds - Array of vendor IDs
   * @returns Map of vendorId to profile (only includes cached entries)
   */
  async getVendorProfiles(vendorIds: string[]): Promise<Map<string, VendorProfile>> {
    const result = new Map<string, VendorProfile>();

    if (!this.config.enabled) return result;

    await Promise.all(
      vendorIds.map(async (vendorId) => {
        const profile = await this.getVendorProfile(vendorId);
        if (profile) {
          result.set(vendorId, profile);
        }
      })
    );

    return result;
  }

  /**
   * Cache multiple vendor profiles
   *
   * @param profiles - Map of vendorId to profile
   */
  async setVendorProfiles(profiles: Map<string, VendorProfile>): Promise<void> {
    if (!this.config.enabled) return;

    await Promise.all(
      Array.from(profiles.entries()).map(([vendorId, profile]) =>
        this.setVendorProfile(vendorId, profile)
      )
    );
  }

  /**
   * Get ML features from cache
   *
   * @param jobId - Job ID
   * @param vendorId - Vendor ID
   * @returns Cached score factors or null
   */
  async getMLFeatures(jobId: string, vendorId: string): Promise<ScoreFactors | null> {
    if (!this.config.enabled) return null;

    const key = `${CACHE_KEY_PREFIX.ML_FEATURES}${jobId}:${vendorId}`;
    const cached = await this.cache.get(key);

    if (!cached) return null;

    try {
      const entry = JSON.parse(cached) as CacheEntry<ScoreFactors>;
      return entry.data;
    } catch {
      return null;
    }
  }

  /**
   * Cache ML features
   *
   * @param jobId - Job ID
   * @param vendorId - Vendor ID
   * @param features - Score factors to cache
   * @param ttlSeconds - Optional TTL override
   */
  async setMLFeatures(
    jobId: string,
    vendorId: string,
    features: ScoreFactors,
    ttlSeconds?: number
  ): Promise<void> {
    if (!this.config.enabled) return;

    const key = `${CACHE_KEY_PREFIX.ML_FEATURES}${jobId}:${vendorId}`;
    const ttl = ttlSeconds ?? this.config.mlFeatureTtlSeconds;

    const entry: CacheEntry<ScoreFactors> = {
      data: features,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + ttl * 1000),
      version: this.cacheVersion,
    };

    await this.cache.set(key, JSON.stringify(entry), ttl);
  }

  /**
   * Invalidate vendor profile cache
   *
   * Called when vendor profile is updated to ensure fresh data.
   *
   * @param vendorId - Vendor ID to invalidate
   */
  async invalidateVendorProfile(vendorId: string): Promise<void> {
    if (!this.config.enabled) return;

    const profileKey = `${CACHE_KEY_PREFIX.VENDOR_PROFILE}${vendorId}`;
    const metricsKey = `${CACHE_KEY_PREFIX.VENDOR_METRICS}${vendorId}`;

    await Promise.all([this.cache.del(profileKey), this.cache.del(metricsKey)]);
  }

  /**
   * Invalidate all ML features for a job
   *
   * @param jobId - Job ID to invalidate
   */
  async invalidateMLFeatures(jobId: string): Promise<void> {
    if (!this.config.enabled) return;

    const pattern = `${CACHE_KEY_PREFIX.ML_FEATURES}${jobId}:*`;
    await this.cache.delPattern(pattern);
  }

  /**
   * Check if a key exists in cache
   *
   * @param key - Full cache key
   * @returns true if key exists and is not expired
   */
  async exists(key: string): Promise<boolean> {
    if (!this.config.enabled) return false;
    return this.cache.exists(key);
  }

  /**
   * Get remaining TTL for a key
   *
   * @param key - Full cache key
   * @returns TTL in seconds, -2 if key doesn't exist
   */
  async getTTL(key: string): Promise<number> {
    if (!this.config.enabled) return -2;
    return this.cache.ttl(key);
  }

  /**
   * Generic get operation
   *
   * @param key - Cache key
   * @returns Cached value or null
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.config.enabled) return null;

    const cached = await this.cache.get(key);
    if (!cached) return null;

    try {
      const entry = JSON.parse(cached) as CacheEntry<T>;
      return entry.data;
    } catch {
      return null;
    }
  }

  /**
   * Generic set operation
   *
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlSeconds - TTL in seconds
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.config.enabled) return;

    const ttl = ttlSeconds ?? this.config.defaultTtlSeconds;

    const entry: CacheEntry<T> = {
      data: value,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + ttl * 1000),
      version: this.cacheVersion,
    };

    await this.cache.set(key, JSON.stringify(entry), ttl);
  }

  /**
   * Delete a key from cache
   *
   * @param key - Cache key to delete
   */
  async delete(key: string): Promise<void> {
    if (!this.config.enabled) return;
    await this.cache.del(key);
  }
}

/**
 * Singleton cache client instance
 */
let cacheClientInstance: RedisCacheClient | null = null;

/**
 * Get or create the cache client singleton
 *
 * @param config - Optional configuration override
 * @returns Cache client instance
 */
export function getCacheClient(config?: Partial<CacheConfig>): RedisCacheClient {
  if (!cacheClientInstance) {
    cacheClientInstance = new RedisCacheClient(config);
  }
  return cacheClientInstance;
}

/**
 * Reset the cache client singleton (for testing)
 */
export function resetCacheClient(): void {
  cacheClientInstance = null;
}
