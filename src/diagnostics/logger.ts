import * as vscode from 'vscode';
import { LogLevel } from '../config/configuration.js';

export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly meta?: Record<string, string | number | boolean | undefined>;
}

export class Logger implements vscode.Disposable {
  private readonly _channel: vscode.OutputChannel;
  private readonly _recentLogs: LogEntry[] = [];
  private static readonly MAX_RECENT_LOGS = 100;

  private static readonly LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(private readonly getLogLevel: () => LogLevel) {
    this._channel = vscode.window.createOutputChannel('Z.ai Copilot');
  }

  public get recentLogs(): readonly LogEntry[] {
    return this._recentLogs;
  }

  public debug(message: string, meta?: Record<string, string | number | boolean | undefined>): void {
    this.log('debug', message, meta);
  }

  public info(message: string, meta?: Record<string, string | number | boolean | undefined>): void {
    this.log('info', message, meta);
  }

  public warn(message: string, meta?: Record<string, string | number | boolean | undefined>): void {
    this.log('warn', message, meta);
  }

  public error(message: string, meta?: Record<string, string | number | boolean | undefined>): void {
    this.log('error', message, meta);
  }

  private log(level: LogLevel, rawMessage: string, meta?: Record<string, string | number | boolean | undefined>): void {
    const currentLevel = this.getLogLevel();
    if (Logger.LEVEL_ORDER[level] < Logger.LEVEL_ORDER[currentLevel]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const redactedMessage = Logger.redact(rawMessage);
    const redactedMeta: Record<string, string | number | boolean | undefined> = {};

    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        if (typeof v === 'string') {
          redactedMeta[k] = Logger.redact(v);
        } else {
          redactedMeta[k] = v;
        }
      }
    }

    const entry: LogEntry = {
      timestamp,
      level,
      message: redactedMessage,
      meta: Object.keys(redactedMeta).length > 0 ? redactedMeta : undefined,
    };

    this._recentLogs.push(entry);
    if (this._recentLogs.length > Logger.MAX_RECENT_LOGS) {
      this._recentLogs.shift();
    }

    let line = `[${timestamp}] [${level.toUpperCase()}] ${redactedMessage}`;
    if (entry.meta) {
      line += ` ${JSON.stringify(entry.meta)}`;
    }

    this._channel.appendLine(line);
  }

  public show(): void {
    this._channel.show(true);
  }

  /**
   * Strictly redacts sensitive tokens, file paths, authorization headers, and API keys.
   */
  public static redact(text: string): string {
    if (!text) {
      return text;
    }

    return text
      // Redact Bearer tokens
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
      // Redact key= or apiKey= values
      .replace(/([?&]?(?:api[_-]?key|token|secret)\s*[:=]\s*)[A-Za-z0-9._~+/-]+/gi, '$1[REDACTED]')
      // Redact potential Z.ai key formats
      .replace(/[A-Za-z0-9]{32,}\.[A-Za-z0-9]{16,}/g, '[REDACTED_API_KEY]');
  }

  public dispose(): void {
    this._channel.dispose();
  }
}
