import { describe, it, expect } from 'vitest';
import { Logger } from '../../src/diagnostics/logger.js';

describe('Logger & Strict Redaction', () => {
  it('redacts Bearer tokens and authorization strings', () => {
    const raw = 'Sending request with Authorization: Bearer secret-token-xyz-1234567890';
    const redacted = Logger.redact(raw);
    expect(redacted).not.toContain('secret-token-xyz-1234567890');
    expect(redacted).toContain('Bearer [REDACTED]');
  });

  it('redacts explicit apiKey and secret parameters in strings', () => {
    const raw = 'Connection failed for apiKey=abcd1234efgh5678ijkl9012mnop3456';
    const redacted = Logger.redact(raw);
    expect(redacted).not.toContain('abcd1234efgh5678ijkl9012mnop3456');
    expect(redacted).toContain('apiKey=[REDACTED]');
  });

  it('filters log messages based on configured log level', () => {
    let currentLevel: 'error' | 'warn' | 'info' | 'debug' = 'warn';
    const logger = new Logger(() => currentLevel);

    logger.debug('Debug message');
    logger.info('Info message');
    logger.warn('Warning message');
    logger.error('Error message');

    expect(logger.recentLogs).toHaveLength(2);
    expect(logger.recentLogs[0].level).toBe('warn');
    expect(logger.recentLogs[1].level).toBe('error');

    currentLevel = 'debug';
    logger.debug('New debug message');
    expect(logger.recentLogs).toHaveLength(3);
    expect(logger.recentLogs[2].level).toBe('debug');
  });
});
