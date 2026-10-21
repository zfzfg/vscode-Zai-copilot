import * as vscode from 'vscode';
import { ConfiguredProfile } from './endpointProfiles.js';

export type ReasoningEffort = 'low' | 'high' | 'max';
export type PreservedThinkingPolicy = 'off' | 'experimental-strict';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface TimeoutsConfig {
  readonly firstEventMs: number;
  readonly idleMs: number;
  readonly totalMs: number;
}

export interface ConfigurationSnapshot {
  readonly endpointProfile: ConfiguredProfile;
  readonly reasoningEffort: ReasoningEffort;
  readonly maxOutputTokens: number;
  readonly preservedThinking: PreservedThinkingPolicy;
  readonly timeouts: TimeoutsConfig;
  readonly logLevel: LogLevel;
  readonly experimentalModels: boolean;
  readonly configGeneration: number;
}

export class ConfigurationManager implements vscode.Disposable {
  private _generation = 1;
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<ConfigurationSnapshot>();
  public readonly onDidChange = this._onDidChange.event;

  constructor() {
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('zai')) {
          this._generation++;
          this._onDidChange.fire(this.getSnapshot());
        }
      })
    );
  }

  public getSnapshot(): ConfigurationSnapshot {
    const config = vscode.workspace.getConfiguration('zai');

    const rawProfile = config.get<string>('endpointProfile', 'unconfigured');
    let endpointProfile: ConfiguredProfile = 'unconfigured';
    if (rawProfile === 'standard' || rawProfile === 'coding-plan') {
      endpointProfile = rawProfile;
    }

    const rawReasoning = config.get<string>('reasoningEffort', 'high');
    const reasoningEffort: ReasoningEffort =
      rawReasoning === 'low' || rawReasoning === 'max' ? rawReasoning : 'high';

    const maxOutputTokens = Math.max(
      1,
      Math.min(128000, config.get<number>('maxOutputTokens', 16384))
    );

    const rawPreserved = config.get<string>('preservedThinking', 'off');
    const preservedThinking: PreservedThinkingPolicy =
      rawPreserved === 'experimental-strict' ? 'experimental-strict' : 'off';

    const timeouts: TimeoutsConfig = {
      firstEventMs: Math.max(1000, config.get<number>('timeouts.firstEventMs', 180000)),
      idleMs: Math.max(1000, config.get<number>('timeouts.idleMs', 120000)),
      totalMs: Math.max(5000, config.get<number>('timeouts.totalMs', 900000)),
    };

    const rawLogLevel = config.get<string>('logLevel', 'warn');
    const logLevel: LogLevel =
      rawLogLevel === 'error' || rawLogLevel === 'info' || rawLogLevel === 'debug'
        ? rawLogLevel
        : 'warn';

    const experimentalModels = config.get<boolean>('experimentalModels', false);

    return Object.freeze({
      endpointProfile,
      reasoningEffort,
      maxOutputTokens,
      preservedThinking,
      timeouts: Object.freeze(timeouts),
      logLevel,
      experimentalModels,
      configGeneration: this._generation,
    });
  }

  public async setEndpointProfile(profile: ConfiguredProfile): Promise<void> {
    const config = vscode.workspace.getConfiguration('zai');
    await config.update('endpointProfile', profile, vscode.ConfigurationTarget.Global);
  }

  public dispose(): void {
    this._onDidChange.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }
}
