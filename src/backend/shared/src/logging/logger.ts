/**
 * Structured Logging Module
 *
 * Provides structured logging with Application Insights integration,
 * PII masking, and correlation ID support.
 *
 * @requirement 10.1 - Log all scoring inputs, outputs, and intermediate calculations
 * @requirement 10.2 - Implement distributed tracing with correlation IDs
 * @requirement 11.4 - Mask or exclude PII from logs
 * @property Property 19: Comprehensive Logging
 * @property Property 22: PII Masking in Logs
 */

import { z } from 'zod';

/**
 * Log levels supported by the logger
 */
export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * PII field patterns for masking
 * @requirement 11.4 - Mask or exclude PII from logs
 * 
 * Note: These patterns are designed to match common PII formats while avoiding
 * false positives on UUIDs and other technical identifiers.
 * Phone patterns require specific formatting (parentheses, spaces, or leading +1)
 * to avoid matching UUID segments.
 */
export const PII_PATTERNS = {
  // Email: requires at least one alphanumeric before @, and valid domain
  email: /[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  // Phone: Only match clearly formatted phone numbers (with parentheses, +1 prefix, or spaces)
  // This avoids matching UUID segments like "9660-300000000000"
  phone: /(?:\+1[-.\s]?[2-9]\d{2}[-.\s]?[2-9]\d{2}[-.\s]?\d{4}|\([2-9]\d{2}\)[-.\s]?[2-9]\d{2}[-.\s]?\d{4})/g,
  // SSN: 3-2-4 digit format with required separators
  ssn: /\b[0-8]\d{2}[-\s]\d{2}[-\s]\d{4}\b/g,
  // Credit card: 4 groups of 4 digits with required separators (starting with 3-6 for valid card prefixes)
  creditCard: /\b[3-6]\d{3}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/g,
} as const;

/**
 * PII field names that should be masked in objects
 */
export const PII_FIELD_NAMES = [
  'email',
  'phone',
  'phoneNumber',
  'ssn',
  'socialSecurityNumber',
  'creditCard',
  'creditCardNumber',
  'cardNumber',
  'address',
  'streetAddress',
  'name',
  'firstName',
  'lastName',
  'fullName',
  'customerName',
  'primaryContact',
  'dateOfBirth',
  'dob',
  'password',
  'secret',
  'token',
  'apiKey',
] as const;

/**
 * Structured log entry schema
 */
export const LogEntrySchema = z.object({
  timestamp: z.string(),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  message: z.string(),
  correlationId: z.string().optional(),
  service: z.string(),
  operation: z.string().optional(),
  duration: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  error: z
    .object({
      name: z.string(),
      message: z.string(),
      stack: z.string().optional(),
    })
    .optional(),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;

/**
 * Scoring log entry for tracking scoring operations
 * @requirement 10.1 - Log all scoring inputs, outputs, and intermediate calculations
 */
export interface ScoringLogEntry {
  correlationId: string;
  jobId: string;
  inputPayload: Record<string, unknown>;
  intermediateScores?: Record<string, unknown>;
  finalRecommendation?: Record<string, unknown>;
  processingTimeMs: number;
  modelVersion?: string;
}

/**
 * Application Insights telemetry client interface
 */
export interface TelemetryClient {
  trackTrace(message: string, severity: number, properties?: Record<string, string>): void;
  trackException(exception: Error, properties?: Record<string, string>): void;
  trackMetric(name: string, value: number, properties?: Record<string, string>): void;
  trackDependency(
    name: string,
    data: string,
    duration: number,
    success: boolean,
    dependencyType: string,
    properties?: Record<string, string>
  ): void;
  flush(): void;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  serviceName: string;
  minLevel: LogLevel;
  enableConsole: boolean;
  enableAppInsights: boolean;
  telemetryClient?: TelemetryClient;
  maskPii: boolean;
}

/**
 * Default logger configuration
 */
export const defaultLoggerConfig: LoggerConfig = {
  serviceName: 'retailfixit',
  minLevel: LogLevel.INFO,
  enableConsole: true,
  enableAppInsights: false,
  maskPii: true,
};

/**
 * Masks PII in a string value
 * @requirement 11.4 - Mask or exclude PII from logs
 * @property Property 22: PII Masking in Logs
 */
export function maskPiiInString(value: string): string {
  let masked = value;

  // Mask email addresses
  masked = masked.replace(PII_PATTERNS.email, '[EMAIL_MASKED]');

  // Mask phone numbers
  masked = masked.replace(PII_PATTERNS.phone, '[PHONE_MASKED]');

  // Mask SSN
  masked = masked.replace(PII_PATTERNS.ssn, '[SSN_MASKED]');

  // Mask credit card numbers
  masked = masked.replace(PII_PATTERNS.creditCard, '[CARD_MASKED]');

  return masked;
}

/**
 * Checks if a field name is a PII field
 */
export function isPiiFieldName(fieldName: string): boolean {
  const lowerFieldName = fieldName.toLowerCase();
  return PII_FIELD_NAMES.some(
    (piiField) =>
      lowerFieldName === piiField.toLowerCase() || lowerFieldName.includes(piiField.toLowerCase())
  );
}

/**
 * Masks PII in an object recursively
 * @requirement 11.4 - Mask or exclude PII from logs
 * @property Property 22: PII Masking in Logs
 */
export function maskPiiInObject(obj: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) {
    return '[MAX_DEPTH_EXCEEDED]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return maskPiiInString(obj);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => maskPiiInObject(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (isPiiFieldName(key)) {
        // Mask the entire value for PII fields
        if (typeof value === 'string') {
          masked[key] = '[PII_MASKED]';
        } else if (value !== null && value !== undefined) {
          masked[key] = '[PII_MASKED]';
        } else {
          masked[key] = value;
        }
      } else {
        masked[key] = maskPiiInObject(value, depth + 1);
      }
    }
    return masked;
  }

  return obj;
}

/**
 * Converts log level to Application Insights severity
 */
function logLevelToSeverity(level: LogLevel): number {
  switch (level) {
    case LogLevel.DEBUG:
      return 0; // Verbose
    case LogLevel.INFO:
      return 1; // Information
    case LogLevel.WARN:
      return 2; // Warning
    case LogLevel.ERROR:
      return 3; // Error
    default:
      return 1;
  }
}

/**
 * Checks if a log level should be logged based on minimum level
 */
function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
  return levels.indexOf(level) >= levels.indexOf(minLevel);
}

/**
 * Structured Logger class
 *
 * @requirement 10.1 - Log all scoring inputs, outputs, and intermediate calculations
 * @requirement 10.2 - Implement distributed tracing with correlation IDs
 * @requirement 11.4 - Mask or exclude PII from logs
 */
export class Logger {
  private config: LoggerConfig;
  private correlationId?: string;
  private logEntries: LogEntry[] = [];

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...defaultLoggerConfig, ...config };
  }

  /**
   * Sets the correlation ID for all subsequent log entries
   * @requirement 10.2 - Implement distributed tracing with correlation IDs
   */
  setCorrelationId(correlationId: string): void {
    this.correlationId = correlationId;
  }

  /**
   * Gets the current correlation ID
   */
  getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  /**
   * Creates a child logger with a specific correlation ID
   */
  child(correlationId: string): Logger {
    const childLogger = new Logger(this.config);
    childLogger.setCorrelationId(correlationId);
    return childLogger;
  }

  /**
   * Gets all log entries (for testing)
   */
  getLogEntries(): LogEntry[] {
    return [...this.logEntries];
  }

  /**
   * Clears all log entries (for testing)
   */
  clearLogEntries(): void {
    this.logEntries = [];
  }

  /**
   * Creates a log entry
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.config.serviceName,
      correlationId: this.correlationId,
    };

    if (metadata) {
      entry.metadata = this.config.maskPii
        ? (maskPiiInObject(metadata) as Record<string, unknown>)
        : metadata;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: this.config.maskPii ? maskPiiInString(error.message) : error.message,
        stack: error.stack,
      };
    }

    return entry;
  }

  /**
   * Logs a message at the specified level
   */
  private log(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): void {
    if (!shouldLog(level, this.config.minLevel)) {
      return;
    }

    const entry = this.createLogEntry(level, message, metadata, error);
    this.logEntries.push(entry);

    // Console output
    if (this.config.enableConsole) {
      const logFn = level === LogLevel.ERROR ? console.error : console.log;
      logFn(JSON.stringify(entry));
    }

    // Application Insights
    if (this.config.enableAppInsights && this.config.telemetryClient) {
      const properties: Record<string, string> = {
        service: this.config.serviceName,
      };

      if (this.correlationId) {
        properties.correlationId = this.correlationId;
      }

      if (metadata) {
        const maskedMetadata = this.config.maskPii ? maskPiiInObject(metadata) : metadata;
        properties.metadata = JSON.stringify(maskedMetadata);
      }

      if (error) {
        this.config.telemetryClient.trackException(error, properties);
      } else {
        this.config.telemetryClient.trackTrace(message, logLevelToSeverity(level), properties);
      }
    }
  }

  /**
   * Logs a debug message
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  /**
   * Logs an info message
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Logs a warning message
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * Logs an error message
   */
  error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, metadata, error);
  }

  /**
   * Logs a scoring operation with all required fields
   * @requirement 10.1 - Log all scoring inputs, outputs, and intermediate calculations
   * @property Property 19: Comprehensive Logging
   */
  logScoring(entry: ScoringLogEntry): void {
    this.setCorrelationId(entry.correlationId);

    const metadata: Record<string, unknown> = {
      jobId: entry.jobId,
      inputPayload: entry.inputPayload,
      processingTimeMs: entry.processingTimeMs,
    };

    if (entry.intermediateScores) {
      metadata.intermediateScores = entry.intermediateScores;
    }

    if (entry.finalRecommendation) {
      metadata.finalRecommendation = entry.finalRecommendation;
    }

    if (entry.modelVersion) {
      metadata.modelVersion = entry.modelVersion;
    }

    this.info('Scoring operation completed', metadata);
  }

  /**
   * Logs a dependency call (for external services)
   */
  logDependency(
    name: string,
    data: string,
    duration: number,
    success: boolean,
    dependencyType: string
  ): void {
    const metadata: Record<string, unknown> = {
      dependencyName: name,
      dependencyData: data,
      duration,
      success,
      dependencyType,
    };

    if (success) {
      this.info(`Dependency call to ${name} succeeded`, metadata);
    } else {
      this.warn(`Dependency call to ${name} failed`, metadata);
    }

    if (this.config.enableAppInsights && this.config.telemetryClient) {
      const properties: Record<string, string> = {
        service: this.config.serviceName,
      };

      if (this.correlationId) {
        properties.correlationId = this.correlationId;
      }

      this.config.telemetryClient.trackDependency(
        name,
        data,
        duration,
        success,
        dependencyType,
        properties
      );
    }
  }

  /**
   * Flushes any pending telemetry
   */
  flush(): void {
    if (this.config.enableAppInsights && this.config.telemetryClient) {
      this.config.telemetryClient.flush();
    }
  }
}

/**
 * Creates a logger instance with the given configuration
 */
export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
  return new Logger(config);
}

/**
 * Default logger instance
 */
export const defaultLogger = createLogger();

/**
 * In-memory telemetry client for testing
 */
export class InMemoryTelemetryClient implements TelemetryClient {
  public traces: Array<{ message: string; severity: number; properties?: Record<string, string> }> =
    [];
  public exceptions: Array<{ exception: Error; properties?: Record<string, string> }> = [];
  public metrics: Array<{ name: string; value: number; properties?: Record<string, string> }> = [];
  public dependencies: Array<{
    name: string;
    data: string;
    duration: number;
    success: boolean;
    dependencyType: string;
    properties?: Record<string, string>;
  }> = [];

  trackTrace(message: string, severity: number, properties?: Record<string, string>): void {
    this.traces.push({ message, severity, properties });
  }

  trackException(exception: Error, properties?: Record<string, string>): void {
    this.exceptions.push({ exception, properties });
  }

  trackMetric(name: string, value: number, properties?: Record<string, string>): void {
    this.metrics.push({ name, value, properties });
  }

  trackDependency(
    name: string,
    data: string,
    duration: number,
    success: boolean,
    dependencyType: string,
    properties?: Record<string, string>
  ): void {
    this.dependencies.push({ name, data, duration, success, dependencyType, properties });
  }

  flush(): void {
    // No-op for in-memory client
  }

  clear(): void {
    this.traces = [];
    this.exceptions = [];
    this.metrics = [];
    this.dependencies = [];
  }
}


/**
 * Global logger instance
 */
let globalLogger: Logger | null = null;

/**
 * Gets the global logger instance
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = createLogger();
  }
  return globalLogger;
}

/**
 * Sets the global logger instance
 */
export function setLogger(logger: Logger): void {
  globalLogger = logger;
}

/**
 * Resets the global logger (for testing)
 */
export function resetLogger(): void {
  globalLogger = null;
}
