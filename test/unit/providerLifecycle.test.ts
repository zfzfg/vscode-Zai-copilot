import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { resetMockConfig } from '../mocks/vscode.js';
import { ZaiChatProvider } from '../../src/provider/zaiProvider.js';
import { ConfigurationManager } from '../../src/config/configuration.js';
import { SecretStoreManager } from '../../src/auth/secretStore.js';
import { HttpClient } from '../../src/transport/httpClient.js';
import { ReplayStore } from '../../src/reasoning/replayStore.js';
import { HistoryMatcher } from '../../src/reasoning/historyMatcher.js';
import { Logger } from '../../src/diagnostics/logger.js';
import { findModelDescriptor } from '../../src/provider/modelCatalog.js';
import { toLanguageModelChatInformation } from '../../src/provider/vscodeAdapter.js';
import { RequestTimeoutError } from '../../src/transport/errors.js';

describe('ZaiChatProvider Lifecycle, Cancellation & Discovery UX', () => {
  let configManager: ConfigurationManager;
  let secretStore: SecretStoreManager;
  let httpClient: HttpClient;
  let replayStore: ReplayStore;
  let historyMatcher: HistoryMatcher;
  let logger: Logger;
  let mockSecrets: any;
  let mockSecretMap: Map<string, string>;

  beforeEach(async () => {
    resetMockConfig();
    mockSecretMap = new Map<string, string>();
    mockSecrets = {
      store: mockSecretMap,
      get: async (k: string) => mockSecretMap.get(k),
      storeKey: async (k: string, v: string) => mockSecretMap.set(k, v),
      delete: async (k: string) => mockSecretMap.delete(k),
    };

    configManager = new ConfigurationManager();
    secretStore = new SecretStoreManager(mockSecrets);
    httpClient = new HttpClient();
    replayStore = new ReplayStore();
    historyMatcher = new HistoryMatcher();
    logger = new Logger(() => 'debug');
  });

  it('throws vscode.CancellationError at entry when token is already cancelled', async () => {
    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const model = toLanguageModelChatInformation(descriptor);

    const cancelledToken: vscode.CancellationToken = {
      isCancellationRequested: true,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    await expect(
      provider.provideLanguageModelChatResponse(
        model,
        [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('Hi')], name: undefined }],
        { toolMode: vscode.LanguageModelChatToolMode.Auto },
        { report: () => {} },
        cancelledToken
      )
    ).rejects.toThrow(vscode.CancellationError);
  });

  it('throws vscode.CancellationError when cancelled mid-stream and rolls back replay state', async () => {
    mockSecretMap.set('zai.apiKey.standard', 'test-api-key');
    await configManager.setEndpointProfile('standard');

    let streamCancelled = false;
    // Mock postChatStream returning an active stream
    vi.spyOn(httpClient, 'postChatStream').mockImplementation(async () => {
      const encoder = new TextEncoder();
      const chunks = [
        encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n'),
        encoder.encode('data: {"choices":[{"index":0,"delta":{"content":" World"}}]}\n\n'),
      ];

      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunks.length > 0) {
            controller.enqueue(chunks.shift()!);
          } else {
            // Keep stream hanging until cancelled
          }
        },
        cancel() {
          streamCancelled = true;
        },
      });
    });

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const model = toLanguageModelChatInformation(descriptor);

    let isCancelled = false;
    let cancelCallback: (() => void) | undefined;
    const dynamicToken: vscode.CancellationToken = {
      get isCancellationRequested() {
        return isCancelled;
      },
      onCancellationRequested: (cb: any) => {
        cancelCallback = cb;
        return { dispose: () => {} };
      },
    } as any;

    let receivedParts = 0;
    const progress = {
      report: () => {
        receivedParts++;
        if (receivedParts === 1) {
          isCancelled = true;
          cancelCallback?.();
        }
      },
    };

    await expect(
      provider.provideLanguageModelChatResponse(
        model,
        [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('Hello')], name: undefined }],
        { toolMode: vscode.LanguageModelChatToolMode.Auto },
        progress,
        dynamicToken
      )
    ).rejects.toThrow(vscode.CancellationError);

    expect(streamCancelled).toBe(true);
    expect(replayStore.count).toBe(0);
  });

  it('breaks read loop early after receiving [DONE] event without waiting for stream EOF', async () => {
    mockSecretMap.set('zai.apiKey.standard', 'test-api-key');
    await configManager.setEndpointProfile('standard');

    let streamCancelled = false;

    vi.spyOn(httpClient, 'postChatStream').mockImplementation(async () => {
      const encoder = new TextEncoder();
      const events = [
        encoder.encode('data: {"choices":[{"index":0,"delta":{"content":"Fast response"}}]}\n\n'),
        encoder.encode('data: [DONE]\n\n'),
      ];

      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (events.length > 0) {
            controller.enqueue(events.shift()!);
          } else {
            // Never close stream to verify that early-break terminates without hanging
          }
        },
        cancel() {
          streamCancelled = true;
        },
      });
    });

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const model = toLanguageModelChatInformation(descriptor);

    const dummyToken: vscode.CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    const reportedText: string[] = [];
    await provider.provideLanguageModelChatResponse(
      model,
      [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('Hi')], name: undefined }],
      { toolMode: vscode.LanguageModelChatToolMode.Auto },
      { report: (p: any) => reportedText.push(p.value) },
      dummyToken
    );

    expect(reportedText.join('')).toBe('Fast response');
    // Must have broken loop and cancelled stream in finally without waiting for EOF
    expect(streamCancelled).toBe(true);
  });

  it('re-throws RequestTimeoutError on timeout during stream without converting to CancellationError', async () => {
    mockSecretMap.set('zai.apiKey.standard', 'test-api-key');
    await configManager.setEndpointProfile('standard');

    vi.spyOn(httpClient, 'postChatStream').mockImplementation(async () => {
      const err = new RequestTimeoutError('idle', 120000);
      throw err;
    });

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const model = toLanguageModelChatInformation(descriptor);

    const dummyToken: vscode.CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    await expect(
      provider.provideLanguageModelChatResponse(
        model,
        [{ role: vscode.LanguageModelChatMessageRole.User, content: [new vscode.LanguageModelTextPart('Hi')], name: undefined }],
        { toolMode: vscode.LanguageModelChatToolMode.Auto },
        { report: () => {} },
        dummyToken
      )
    ).rejects.toThrow(RequestTimeoutError);
  });

  it('coalesces discovery prompt notifications when provider is unconfigured or key is missing', async () => {
    const showInfoSpy = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined as any);

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger
    );

    const dummyToken: vscode.CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    // 1. Unconfigured provider - non-silent calls
    const res1 = await provider.provideLanguageModelChatInformation({ silent: false }, dummyToken);
    const res2 = await provider.provideLanguageModelChatInformation({ silent: false }, dummyToken);
    const res3 = await provider.provideLanguageModelChatInformation({ silent: true }, dummyToken);

    expect(res1).toEqual([]);
    expect(res2).toEqual([]);
    expect(res3).toEqual([]);
    // Must only prompt once across multiple non-silent discovery invocations
    expect(showInfoSpy).toHaveBeenCalledTimes(1);

    showInfoSpy.mockClear();

    // 2. Configure endpoint to standard, but without API key
    await configManager.setEndpointProfile('standard');

    const res4 = await provider.provideLanguageModelChatInformation({ silent: false }, dummyToken);
    const res5 = await provider.provideLanguageModelChatInformation({ silent: false }, dummyToken);
    const res6 = await provider.provideLanguageModelChatInformation({ silent: true }, dummyToken);

    expect(res4).toEqual([]);
    expect(res5).toEqual([]);
    expect(res6).toEqual([]);
    // Prompted once for missing key
    expect(showInfoSpy).toHaveBeenCalledTimes(1);
    expect(showInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining("No API key configured for Z.ai profile 'standard'"),
      'Set Key'
    );

    showInfoSpy.mockRestore();
  });
});
