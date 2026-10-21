import * as vscode from 'vscode';
import { ConfigurationManager } from './config/configuration.js';
import { SecretStoreManager } from './auth/secretStore.js';
import { HttpClient } from './transport/httpClient.js';
import { ReplayStore } from './reasoning/replayStore.js';
import { HistoryMatcher } from './reasoning/historyMatcher.js';
import { Logger } from './diagnostics/logger.js';
import { ZaiChatProvider } from './provider/zaiProvider.js';
import { registerManagementCommands } from './auth/managementCommands.js';
import { registerDiagnosticsCommand } from './diagnostics/diagnosticsCommand.js';

let extensionReplayStore: ReplayStore | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 1. Initialize Configuration
  const configManager = new ConfigurationManager();
  context.subscriptions.push(configManager);

  // 2. Initialize Secrets & Storage
  const secretStore = new SecretStoreManager(context.secrets);
  context.subscriptions.push(secretStore);

  // Run idempotent migration from legacy settings if present
  try {
    await secretStore.migrateLegacyIfNeeded();
  } catch {
    // Migration is best-effort and non-blocking
  }

  // 3. Initialize Logger
  const logger = new Logger(() => configManager.getSnapshot().logLevel);
  context.subscriptions.push(logger);
  logger.info('Z.ai Language Model Provider activating...');

  // 4. Initialize Transport & Reasoning
  const httpClient = new HttpClient();
  const replayStore = new ReplayStore();
  extensionReplayStore = replayStore;
  const historyMatcher = new HistoryMatcher();

  // Invalidate replay store on secret rotation or deletion
  context.subscriptions.push(
    secretStore.onDidRotateSecret((e) => {
      replayStore.invalidate((r) => r.endpointProfile === e.profile);
    }),
    secretStore.onDidDeleteSecret((e) => {
      replayStore.invalidate((r) => r.endpointProfile === e.profile);
    })
  );

  // 5. Initialize Provider & Register under Vendor ID 'zai'
  const zaiProvider = new ZaiChatProvider(
    configManager,
    secretStore,
    httpClient,
    replayStore,
    historyMatcher,
    logger
  );
  context.subscriptions.push(zaiProvider);

  const providerDisposable = vscode.lm.registerLanguageModelChatProvider('zai', zaiProvider);
  context.subscriptions.push(providerDisposable);

  // 6. Register Commands
  const managementCommands = registerManagementCommands(
    configManager,
    secretStore,
    replayStore,
    httpClient,
    logger
  );
  for (const cmd of managementCommands) {
    context.subscriptions.push(cmd);
  }

  const diagCommand = registerDiagnosticsCommand(
    configManager,
    secretStore,
    replayStore,
    logger
  );
  context.subscriptions.push(diagCommand);

  logger.info('Z.ai Language Model Provider successfully registered with vendor ID "zai".');
}

export function deactivate(): void {
  if (extensionReplayStore) {
    extensionReplayStore.clear();
  }
}
