import * as vscode from 'vscode';
import { ConfigurationManager } from '../config/configuration.js';
import { SecretStoreManager } from '../auth/secretStore.js';
import { ReplayStore } from '../reasoning/replayStore.js';
import { Logger } from './logger.js';
import { getModelsForProfile } from '../provider/modelCatalog.js';

export function registerDiagnosticsCommand(
  configManager: ConfigurationManager,
  secretStore: SecretStoreManager,
  replayStore: ReplayStore,
  logger: Logger
): vscode.Disposable {
  return vscode.commands.registerCommand('zai.showDiagnostics', async () => {
    logger.show();

    const config = configManager.getSnapshot();
    const hasStandardKey = await secretStore.hasApiKey('standard');
    const hasCodingPlanKey = await secretStore.hasApiKey('coding-plan');
    const availableModels = getModelsForProfile(config.endpointProfile, config.experimentalModels);

    const diagnostics = [
      '================ Z.ai Copilot Diagnostics ================\n',
      `Timestamp: ${new Date().toISOString()}`,
      `Endpoint Profile: ${config.endpointProfile}`,
      `Reasoning Effort: ${config.reasoningEffort}`,
      `Max Output Tokens: ${config.maxOutputTokens}`,
      `Preserved Thinking Policy: ${config.preservedThinking}`,
      `Experimental Models Enabled: ${config.experimentalModels}`,
      `Timeouts: firstEvent=${config.timeouts.firstEventMs}ms, idle=${config.timeouts.idleMs}ms, total=${config.timeouts.totalMs}ms`,
      '',
      '--- Credential Status ---',
      `Standard Key Configured: ${hasStandardKey ? 'YES' : 'NO'}`,
      `Coding Plan Key Configured: ${hasCodingPlanKey ? 'YES' : 'NO'}`,
      `Credential Generation: ${secretStore.getCredentialGeneration()}`,
      `Config Generation: ${config.configGeneration}`,
      '',
      '--- Replay Store (In-Memory Reasoning Cache) ---',
      `Cached Entries: ${replayStore.count}`,
      `Memory Footprint: ${(replayStore.totalBytes / (1024 * 1024)).toFixed(2)} MiB`,
      '',
      '--- Available Models for Active Profile ---',
      ...(availableModels.length > 0
        ? availableModels.map(
            (m) =>
              `- ${m.displayName} (${m.apiModelId}) [Context: ${m.providerContextBudget}, Tools: ${m.implementedCapabilities.tools}]`
          )
        : ['(None - provider is either unconfigured or profile has no supported models)']),
      '',
      '--- Recent Activity Logs ---',
      ...logger.recentLogs.slice(-20).map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`),
      '\n==========================================================',
    ].join('\n');

    logger.info('Diagnostics generated.');
    vscode.window.showInformationMessage(
      `Z.ai Status: Profile=${config.endpointProfile}, Models=${availableModels.length}, ReplayCache=${replayStore.count} entries.`
    );

    // Also write full report to output channel
    const doc = await vscode.workspace.openTextDocument({
      content: diagnostics,
      language: 'text',
    });
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  });
}
