import * as vscode from 'vscode';
import { ConfigurationManager } from '../config/configuration.js';
import { SecretStoreManager } from '../auth/secretStore.js';
import { ReplayStore } from '../reasoning/replayStore.js';
import { Logger } from '../diagnostics/logger.js';
import { HttpClient } from '../transport/httpClient.js';
import { getModelsForProfile } from '../provider/modelCatalog.js';
import { buildChatCompletionRequest } from '../protocol/requestBuilder.js';
import { SseStreamDecoder } from '../protocol/streamDecoder.js';
import { EndpointProfile } from '../config/endpointProfiles.js';

export function registerManagementCommands(
  configManager: ConfigurationManager,
  secretStore: SecretStoreManager,
  replayStore: ReplayStore,
  httpClient: HttpClient,
  logger: Logger
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Command: zai.manageProvider
  disposables.push(
    vscode.commands.registerCommand('zai.manageProvider', async () => {
      if (!secretStore.acquireDialogLock()) {
        vscode.window.showWarningMessage('A Z.ai configuration dialog is already active.');
        return;
      }

      try {
        const config = configManager.getSnapshot();
        const activeProfile = config.endpointProfile;
        const hasKey =
          activeProfile !== 'unconfigured' ? await secretStore.hasApiKey(activeProfile) : false;

        const options = [
          {
            label: '$(gear) Select Endpoint Profile',
            description: `Current: ${activeProfile}`,
            action: 'profile',
          },
          {
            label: '$(key) Set or Update API Key',
            description:
              activeProfile !== 'unconfigured'
                ? `Key status for '${activeProfile}': ${hasKey ? 'Configured' : 'NOT set'}`
                : 'Select a profile first',
            action: 'setKey',
          },
          {
            label: '$(trash) Clear API Key',
            description:
              activeProfile !== 'unconfigured' && hasKey
                ? `Remove stored key for '${activeProfile}'`
                : 'No key stored',
            action: 'clearKey',
          },
          {
            label: '$(pulse) Run Connection Test',
            description: 'Send lightweight verification request',
            action: 'test',
          },
          {
            label: '$(history) Clear Reasoning Cache',
            description: `Purge in-memory thinking replays (${replayStore.count} entries)`,
            action: 'clearCache',
          },
          {
            label: '$(output) Show Diagnostics',
            description: 'View provider configuration, credential status, and logs',
            action: 'showDiag',
          },
        ];

        const selected = await vscode.window.showQuickPick(options, {
          placeHolder: 'Manage Z.ai Language Model Provider',
        });

        if (!selected) {
          return;
        }

        if (selected.action === 'profile') {
          const profileChoice = await vscode.window.showQuickPick(
            [
              {
                label: 'standard',
                description: 'Official PaaS v4 (https://api.z.ai/api/paas/v4) - General Accounts',
              },
              {
                label: 'coding-plan',
                description:
                  'Dedicated Coding Plan (https://api.z.ai/api/coding/paas/v4) - Subscription Accounts',
              },
              {
                label: 'unconfigured',
                description: 'Disable Z.ai provider until configured',
              },
            ],
            { placeHolder: 'Select Z.ai endpoint profile' }
          );

          if (profileChoice) {
            await configManager.setEndpointProfile(profileChoice.label as any);
            logger.info('Endpoint profile updated', { profile: profileChoice.label });
            vscode.window.showInformationMessage(
              `Z.ai endpoint profile updated to: ${profileChoice.label}`
            );
          }
        } else if (selected.action === 'setKey') {
          if (activeProfile === 'unconfigured') {
            vscode.window.showErrorMessage(
              'Please select an endpoint profile (standard or coding-plan) before configuring an API key.'
            );
            return;
          }

          const apiKey = await vscode.window.showInputBox({
            title: `Enter Z.ai API Key for '${activeProfile}'`,
            prompt: 'Your API key is securely stored in OS SecretStorage and never logged.',
            password: true,
            ignoreFocusOut: true,
            validateInput: (val) => {
              if (!val || !val.trim()) {
                return 'API key cannot be empty.';
              }
              return null;
            },
          });

          if (apiKey) {
            await secretStore.setApiKey(activeProfile, apiKey);
            logger.info('API key updated for profile', { profile: activeProfile });
            vscode.window.showInformationMessage(
              `Z.ai API key successfully saved for profile '${activeProfile}'.`
            );
          }
        } else if (selected.action === 'clearKey') {
          if (activeProfile === 'unconfigured') {
            return;
          }
          const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the API key for '${activeProfile}'?`,
            { modal: true },
            'Delete'
          );
          if (confirm === 'Delete') {
            await secretStore.deleteApiKey(activeProfile);
            replayStore.invalidate((r) => r.endpointProfile === activeProfile);
            logger.info('API key removed for profile', { profile: activeProfile });
            vscode.window.showInformationMessage(`API key cleared for profile '${activeProfile}'.`);
          }
        } else if (selected.action === 'test') {
          await vscode.commands.executeCommand('zai.testConnection');
        } else if (selected.action === 'clearCache') {
          await vscode.commands.executeCommand('zai.clearReasoningCache');
        } else if (selected.action === 'showDiag') {
          await vscode.commands.executeCommand('zai.showDiagnostics');
        }
      } finally {
        secretStore.releaseDialogLock();
      }
    })
  );

  // Command: zai.testConnection
  disposables.push(
    vscode.commands.registerCommand('zai.testConnection', async () => {
      const config = configManager.getSnapshot();
      if (config.endpointProfile === 'unconfigured') {
        vscode.window.showErrorMessage(
          'Cannot test connection: Z.ai provider is unconfigured. Please configure a profile first.'
        );
        return;
      }

      const profile = config.endpointProfile as EndpointProfile;
      const apiKey = await secretStore.getApiKey(profile);
      if (!apiKey) {
        vscode.window.showErrorMessage(
          `Cannot test connection: No API key found for profile '${profile}'.`
        );
        return;
      }

      const availableModels = getModelsForProfile(profile, config.experimentalModels);
      if (availableModels.length === 0) {
        vscode.window.showErrorMessage(
          `No models available for profile '${profile}'.`
        );
        return;
      }

      const testModel = availableModels[0];

      const proceed = await vscode.window.showInformationMessage(
        `Test Z.ai connection for profile '${profile}' using model '${testModel.displayName}'? This sends a minimal prompt and may consume a minimal number of API tokens.`,
        'Proceed',
        'Cancel'
      );

      if (proceed !== 'Proceed') {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Testing Z.ai connection (${profile} / ${testModel.displayName})...`,
          cancellable: true,
        },
        async (_progress, token) => {
          const abortController = new AbortController();
          token.onCancellationRequested(() => abortController.abort());

          try {
            const buildRes = buildChatCompletionRequest({
              model: testModel,
              messages: [{ role: 'user', content: 'Ping. Respond with "Pong".' }],
              config,
            });

            logger.info('Starting connection test', {
              profile,
              model: testModel.apiModelId,
            });

            const stream = await httpClient.postChatStream({
              profile,
              apiKey,
              serializedPayload: buildRes.serialized,
              abortSignal: abortController.signal,
              modelId: testModel.apiModelId,
            });

            const decoder = new SseStreamDecoder();
            const reader = stream.getReader();
            let receivedText = '';

            try {
              while (true) {
                if (token.isCancellationRequested || abortController.signal.aborted) {
                  break;
                }
                const { done, value } = await reader.read();
                if (done) {
                  break;
                }
                if (value) {
                  const events = decoder.feedChunk(value);
                  for (const ev of events) {
                    if (ev.type === 'chunk' && ev.chunk.choices?.[0]?.delta?.content) {
                      receivedText += ev.chunk.choices[0].delta.content;
                    }
                  }
                }
              }
            } finally {
              reader.releaseLock();
            }

            if (token.isCancellationRequested || abortController.signal.aborted) {
              logger.info('Connection test cancelled by user', { profile });
              return;
            }

            logger.info('Connection test succeeded', {
              profile,
              model: testModel.apiModelId,
              eventsReceived: decoder.eventCount,
            });
            logger.debug('Connection test ping output', { preview: receivedText.substring(0, 50) });

            vscode.window.showInformationMessage(
              `Connection test successful! Text chat verified with model '${testModel.displayName}' on '${profile}'. Note: Tool-calling was not executed in this minimal ping test.`
            );
          } catch (err: any) {
            if (token.isCancellationRequested || abortController.signal.aborted) {
              logger.info('Connection test cancelled by user', { profile });
              return;
            }
            logger.error('Connection test failed', { error: err?.message });
            vscode.window.showErrorMessage(`Z.ai connection test failed: ${err?.message}`);
          }
        }
      );
    })
  );

  // Command: zai.clearReasoningCache
  disposables.push(
    vscode.commands.registerCommand('zai.clearReasoningCache', () => {
      const count = replayStore.count;
      replayStore.clear();
      logger.info('Reasoning cache cleared manually', { purgedEntries: count });
      vscode.window.showInformationMessage(`Z.ai reasoning cache cleared (${count} entries removed).`);
    })
  );

  return disposables;
}
