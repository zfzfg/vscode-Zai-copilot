import { describe, it, expect } from 'vitest';
import { Logger } from '../../src/diagnostics/logger.js';
import { ZaiError } from '../../src/transport/errors.js';

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

  it('redacts Windows user profile paths (both backslash and forward slash)', () => {
    const rawBackslash = 'Error reading file at C:\\Users\\alice\\Documents\\secret\\key.txt';
    const redactedBackslash = Logger.redact(rawBackslash);
    expect(redactedBackslash).not.toContain('alice');
    expect(redactedBackslash).toBe('Error reading file at [REDACTED_PATH]');

    const rawForwardSlash = 'File opened: D:/Users/bob/project/main.ts:25';
    const redactedForwardSlash = Logger.redact(rawForwardSlash);
    expect(redactedForwardSlash).not.toContain('bob');
    expect(redactedForwardSlash).toBe('File opened: [REDACTED_PATH]:25');
  });

  it('redacts POSIX and macOS user home directory paths', () => {
    const rawLinux = 'Trace in /home/developer/workspace/app.py:50';
    const redactedLinux = Logger.redact(rawLinux);
    expect(redactedLinux).not.toContain('developer');
    expect(redactedLinux).toBe('Trace in [REDACTED_PATH]:50');

    const rawMac = 'Config saved to /Users/admin/Library/Preferences/app.json.';
    const redactedMac = Logger.redact(rawMac);
    expect(redactedMac).not.toContain('admin');
    expect(redactedMac).toBe('Config saved to [REDACTED_PATH].');
  });

  it('preserves system paths that do not expose user home names', () => {
    const rawSystemWin = 'Loaded driver C:\\Windows\\System32\\drivers\\etc\\hosts';
    expect(Logger.redact(rawSystemWin)).toBe(rawSystemWin);

    const rawSystemLinux = 'Executable at /usr/local/bin/node or /var/log/syslog';
    expect(Logger.redact(rawSystemLinux)).toBe(rawSystemLinux);
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

describe('ZaiError & User Advice formatting', () => {
  it('appends userAdvice to error message if present', () => {
    const err = new ZaiError('Failed to authenticate', 'AUTH_ERROR', 401, 'Please check your API key.');
    expect(err.message).toBe('Failed to authenticate — Please check your API key.');
    expect(err.userAdvice).toBe('Please check your API key.');
  });

  it('does not duplicate advice if already present in message', () => {
    const err = new ZaiError('Failed: check your key', 'AUTH_ERROR', 401, 'check your key');
    expect(err.message).toBe('Failed: check your key');
  });

  it('keeps original message if no user advice is provided', () => {
    const err = new ZaiError('Simple error', 'SIMPLE');
    expect(err.message).toBe('Simple error');
    expect(err.userAdvice).toBeUndefined();
  });
});
