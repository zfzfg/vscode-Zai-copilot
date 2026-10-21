import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ConfigurationManager } from '../config/configuration.js';
import { SecretStoreManager } from '../auth/secretStore.js';
import { HttpClient } from '../transport/httpClient.js';
import { ReplayStore } from '../reasoning/replayStore.js';
import { HistoryMatcher } from '../reasoning/historyMatcher.js';
import { Logger } from '../diagnostics/logger.js';
import {
  findModelDescriptor,
  getModelsForProfile,
} from './modelCatalog.js';
import {
  createTextResponsePart,
  createToolCallResponsePart,
  toLanguageModelChatInformation,
} from './vscodeAdapter.js';
import { mapHostTools } from '../protocol/toolMapper.js';
import { mapHostMessages } from '../protocol/messageMapper.js';
import { buildChatCompletionRequest } from '../protocol/requestBuilder.js';
import { SseStreamDecoder } from '../protocol/streamDecoder.js';
import { ToolCallAccumulator } from '../protocol/toolCallAccumulator.js';
import { TimeoutController } from '../transport/timeouts.js';
import { TokenEstimator } from '../tokens/tokenEstimator.js';
import {
  AuthenticationError,
  ModelNotFoundError,
  ReplayMatchingError,
  UnconfiguredProviderError,
  ZaiError,
} from '../transport/errors.js';
import { EndpointProfile } from '../config/endpointProfiles.js';

export class ZaiChatProvider
  implements vscode.LanguageModelChatProvider<vscode.LanguageModelChatInformation>, vscode.Disposable
{
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;
  private readonly _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly configManager: ConfigurationManager,
    private readonly secretStore: SecretStoreManager,
    private readonly httpClient: HttpClient,
    private readonly replayStore: ReplayStore,
    private readonly historyMatcher: HistoryMatcher,
    private readonly logger: Logger,
    private readonly testUrlOverride?: string
  ) {
    this._disposables.push(
      this.configManager.onDidChange(() => {
        this._onDidChange.fire();
      }),
      this.secretStore.onDidRotateSecret(() => {
        this._onDidChange.fire();
      }),
      this.secretStore.onDidDeleteSecret(() => {
        this._onDidChange.fire();
      })
    );
  }

  public async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const config = this.configManager.getSnapshot();

    if (config.endpointProfile === 'unconfigured') {
      if (!options.silent) {
        // Non-silent discovery: prompt user to configure provider
        vscode.window
          .showInformationMessage(
            'Z.ai Copilot Provider is not yet configured. Would you like to select a profile and configure an API key?',
            'Configure'
          )
          .then((sel) => {
            if (sel === 'Configure') {
              vscode.commands.executeCommand('zai.manageProvider');
            }
          });
      }
      return [];
    }

    const hasKey = await this.secretStore.hasApiKey(config.endpointProfile);
    if (!hasKey) {
      if (!options.silent) {
        vscode.window
          .showInformationMessage(
            `No API key configured for Z.ai profile '${config.endpointProfile}'. Please set an API key.`,
            'Set Key'
          )
          .then((sel) => {
            if (sel === 'Set Key') {
              vscode.commands.executeCommand('zai.manageProvider');
            }
          });
      }
      return [];
    }

    const descriptors = getModelsForProfile(config.endpointProfile, config.experimentalModels);
    return descriptors.map((d) => toLanguageModelChatInformation(d));
  }

  public async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    return TokenEstimator.estimateHostItemTokens(text);
  }

  public async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (token.isCancellationRequested) {
      return;
    }

    const config = this.configManager.getSnapshot();
    if (config.endpointProfile === 'unconfigured') {
      throw new UnconfiguredProviderError();
    }

    const profile: EndpointProfile = config.endpointProfile;
    const apiKey = await this.secretStore.getApiKey(profile);
    if (!apiKey) {
      throw new AuthenticationError(
        `No API key configured for Z.ai endpoint profile '${profile}'.`
      );
    }

    const descriptor = findModelDescriptor(model.id);
    if (!descriptor) {
      throw new Error(`Model '${model.id}' is not recognized in the Z.ai model catalog.`);
    }

    const endpointStatus = descriptor.endpointStatus[profile];
    if (
      endpointStatus === 'unsupported' ||
      (endpointStatus === 'experimental' && !config.experimentalModels)
    ) {
      throw new ModelNotFoundError(descriptor.apiModelId, profile);
    }

    const requestId = crypto.randomUUID();
    const abortController = new AbortController();

    const cancellationListener = token.onCancellationRequested(() => {
      this.logger.info('Chat request cancelled by host/user', { requestId });
      abortController.abort(new Error('Request cancelled by user.'));
    });

    this.logger.info('Initiating chat completion request', {
      requestId,
      model: descriptor.apiModelId,
      profile,
      messageCount: messages.length,
      toolCount: options.tools?.length ?? 0,
    });

    // 1. Map tools
    const mappedTools = mapHostTools(options.tools, options.toolMode);
    const allowedHostToolNames = new Set(options.tools?.map((t) => t.name) ?? []);

    // 2. Map messages and match reasoning replay if applicable
    let allHistoricalThinkingMatched = true;

    const mappedMessages = mapHostMessages(messages, {
      nameMapper: mappedTools.nameMapper,
      getReasoningForTurn: (_turnIndex, _assistantText, precedingMessages, toolCallIds) => {
        const isToolContinuationTurn = toolCallIds.length > 0;
        const isStrictReplayEnabled = config.preservedThinking === 'experimental-strict';

        // Replay is required for tool continuations (Interleaved Thinking) OR if experimental-strict is enabled
        if (!isToolContinuationTurn && !isStrictReplayEnabled) {
          return undefined;
        }

        const inputFingerprint = this.historyMatcher.computeFingerprint(precedingMessages);

        const match = this.historyMatcher.matchReplayRecord(this.replayStore, {
          modelId: descriptor.apiModelId,
          endpointProfile: profile,
          credentialGeneration: this.secretStore.getCredentialGeneration(),
          configGeneration: config.configGeneration,
          inputHistoryFingerprint: inputFingerprint,
          expectedCallIds: isToolContinuationTurn ? toolCallIds : undefined,
        });

        if (match) {
          return match.reasoningContent;
        }

        // If this was a tool continuation turn on a thinking-enforced model (5.3 series),
        // missing reasoning means the tool continuation cannot be safely reconstructed.
        // PLANNING.md Section 10.2 & 13.1 requires aborting before sending the request.
        if (isToolContinuationTurn && !descriptor.supportsThinkingDisable) {
          throw new ReplayMatchingError(
            `Cannot continue tool execution: reasoning history for tool call [${toolCallIds.join(', ')}] was not found in the local reasoning cache. This happens after editor restarts or if the 30-minute cache TTL expired. Please start a new conversation turn.`
          );
        }

        // For plain text turns under experimental-strict, mark that not all turns were matched
        allHistoricalThinkingMatched = false;
        return undefined;
      },
    });

    const currentInputFingerprint = this.historyMatcher.computeFingerprint(mappedMessages);

    // 3. Build request payload
    // If experimental-strict is enabled and all historical turns had matched thinking, clear_thinking: false
    // Otherwise clear_thinking: true
    const clearThinkingOverride =
      config.preservedThinking === 'experimental-strict'
        ? !allHistoricalThinkingMatched
        : undefined;

    const buildRes = buildChatCompletionRequest({
      model: descriptor,
      messages: mappedMessages,
      tools: mappedTools.tools,
      tool_choice: mappedTools.tool_choice,
      config,
      clearThinkingOverride,
    });

    // 4. Preflight context budget check
    TokenEstimator.validatePreflightBudget(descriptor, buildRes.request);

    // 5. Setup timeouts and execution
    let timeoutError: Error | undefined;
    const timeoutController = new TimeoutController(config.timeouts, (err) => {
      timeoutError = err;
      abortController.abort(err);
    });

    const streamDecoder = new SseStreamDecoder();
    const toolAccumulator = new ToolCallAccumulator();

    let accumulatedVisibleText = '';
    let accumulatedReasoningText = '';
    let responseFinishReason: string | null = null;
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let committedReplayRecord = false;

    try {
      const responseStream = await this.httpClient.postChatStream({
        profile,
        apiKey,
        serializedPayload: buildRes.serialized,
        abortSignal: abortController.signal,
        testUrlOverride: this.testUrlOverride,
        modelId: descriptor.apiModelId,
      });

      streamReader = responseStream.getReader();

      while (true) {
        if (token.isCancellationRequested || abortController.signal.aborted) {
          break;
        }

        const { done, value } = await streamReader.read();

        if (done) {
          // Process any trailing bytes in decoder
          const finalEvents = streamDecoder.end();
          for (const ev of finalEvents) {
            this.handleStreamEvent(
              ev,
              progress,
              toolAccumulator,
              (chunk) => {
                timeoutController.notifyActivity(true);
                if (chunk.choices?.[0]?.delta?.content) {
                  accumulatedVisibleText += chunk.choices[0].delta.content;
                }
                if (chunk.choices?.[0]?.delta?.reasoning_content) {
                  accumulatedReasoningText += chunk.choices[0].delta.reasoning_content;
                }
                if (chunk.choices?.[0]?.delta?.reasoning) {
                  accumulatedReasoningText += chunk.choices[0].delta.reasoning;
                }
                if (chunk.choices?.[0]?.finish_reason) {
                  responseFinishReason = chunk.choices[0].finish_reason;
                }
              },
              () => timeoutController.notifyActivity(false)
            );
          }
          break;
        }

        if (value) {
          const events = streamDecoder.feedChunk(value);
          for (const ev of events) {
            this.handleStreamEvent(
              ev,
              progress,
              toolAccumulator,
              (chunk) => {
                timeoutController.notifyActivity(true);
                if (chunk.choices?.[0]?.delta?.content) {
                  accumulatedVisibleText += chunk.choices[0].delta.content;
                }
                if (chunk.choices?.[0]?.delta?.reasoning_content) {
                  accumulatedReasoningText += chunk.choices[0].delta.reasoning_content;
                }
                if (chunk.choices?.[0]?.delta?.reasoning) {
                  accumulatedReasoningText += chunk.choices[0].delta.reasoning;
                }
                if (chunk.choices?.[0]?.finish_reason) {
                  responseFinishReason = chunk.choices[0].finish_reason;
                }
              },
              () => timeoutController.notifyActivity(false)
            );
          }
        }
      }

      // Check for timeout or cancellation
      if (timeoutError) {
        throw timeoutError;
      }
      if (token.isCancellationRequested) {
        return;
      }

      // Validate stream completion
      if (!streamDecoder.isDone) {
        throw new ZaiError(
          'Stream terminated prematurely: connection closed before [DONE] event was received.',
          'INCOMPLETE_STREAM'
        );
      }

      // 6. Handle tool calls batch validation and replay store commit
      if (toolAccumulator.hasToolCalls()) {
        const validatedCalls = toolAccumulator.validateAndComplete(
          mappedTools.nameMapper,
          allowedHostToolNames,
          responseFinishReason
        );

        // Pre-commit replay record atomically before publishing tool calls
        if (accumulatedReasoningText.length > 0) {
          const recordByteSize =
            Buffer.byteLength(accumulatedReasoningText, 'utf8') +
            Buffer.byteLength(accumulatedVisibleText, 'utf8') +
            validatedCalls.reduce((acc, c) => acc + Buffer.byteLength(c.rawArguments, 'utf8'), 0);

          this.replayStore.put({
            requestId,
            modelId: descriptor.apiModelId,
            endpointProfile: profile,
            credentialGeneration: this.secretStore.getCredentialGeneration(),
            configGeneration: config.configGeneration,
            inputHistoryFingerprint: currentInputFingerprint,
            assistantText: accumulatedVisibleText || null,
            callIds: Object.freeze(validatedCalls.map((c) => c.callId)),
            toolNames: Object.freeze(validatedCalls.map((c) => c.originalName)),
            rawArguments: Object.freeze(validatedCalls.map((c) => c.rawArguments)),
            reasoningContent: accumulatedReasoningText,
            timestamp: Date.now(),
            byteSize: recordByteSize,
            status: 'completed',
          });
          committedReplayRecord = true;
        }

        // Publish validated tool calls
        for (const call of validatedCalls) {
          if (token.isCancellationRequested) {
            if (committedReplayRecord) {
              this.replayStore.remove(requestId);
            }
            break;
          }
          progress.report(
            createToolCallResponsePart(call.callId, call.originalName, call.input)
          );
        }

        if (token.isCancellationRequested) {
          if (committedReplayRecord) {
            this.replayStore.remove(requestId);
          }
          return;
        }
      } else if (accumulatedReasoningText.length > 0 && config.preservedThinking === 'experimental-strict') {
        // Record replay record for plain text turn if reasoning was captured
        const recordByteSize =
          Buffer.byteLength(accumulatedReasoningText, 'utf8') +
          Buffer.byteLength(accumulatedVisibleText, 'utf8');

        this.replayStore.put({
          requestId,
          modelId: descriptor.apiModelId,
          endpointProfile: profile,
          credentialGeneration: this.secretStore.getCredentialGeneration(),
          configGeneration: config.configGeneration,
          inputHistoryFingerprint: currentInputFingerprint,
          assistantText: accumulatedVisibleText || null,
          callIds: Object.freeze([]),
          toolNames: Object.freeze([]),
          rawArguments: Object.freeze([]),
          reasoningContent: accumulatedReasoningText,
          timestamp: Date.now(),
          byteSize: recordByteSize,
          status: 'completed',
        });
        committedReplayRecord = true;
      }

      this.logger.info('Chat completion finished successfully', {
        requestId,
        events: streamDecoder.eventCount,
        bytes: streamDecoder.totalBytes,
        finishReason: responseFinishReason ?? 'stop',
      });
    } catch (err: any) {
      if (committedReplayRecord) {
        this.replayStore.remove(requestId);
      }
      if (token.isCancellationRequested || abortController.signal.aborted) {
        this.logger.info('Chat completion was aborted', { requestId });
        return;
      }
      this.logger.error('Chat completion failed', {
        requestId,
        error: err?.message,
        code: err?.code,
      });
      throw err;
    } finally {
      timeoutController.dispose();
      cancellationListener.dispose();
      if (streamReader) {
        try {
          await streamReader.cancel();
          streamReader.releaseLock();
        } catch {
          // Ignore cleanup error
        }
      }
    }
  }

  private handleStreamEvent(
    ev: import('../protocol/streamDecoder.js').SseEvent,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    toolAccumulator: ToolCallAccumulator,
    onChunk: (chunk: import('../protocol/types.js').ZaiStreamChunk) => void,
    onHeartbeat: () => void
  ): void {
    if (ev.type === 'heartbeat') {
      onHeartbeat();
      return;
    }

    if (ev.type === 'chunk') {
      onChunk(ev.chunk);
      const choice = ev.chunk.choices?.[0];
      if (!choice) {
        return;
      }

      // Stream visible text immediately
      if (choice.delta.content) {
        progress.report(createTextResponsePart(choice.delta.content));
      }

      // Buffer tool calls in accumulator (never report prematurely)
      if (choice.delta.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          toolAccumulator.feedDeltaToolCall(choice.index, tc);
        }
      }
    }
  }

  public dispose(): void {
    this._onDidChange.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
  }
}
