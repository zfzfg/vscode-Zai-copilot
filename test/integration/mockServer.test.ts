import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import * as vscode from 'vscode';
import { resetMockConfig } from '../mocks/vscode.js';
import { HttpClient, MAX_CONCURRENT_REQUESTS } from '../../src/transport/httpClient.js';
import { ConfigurationManager } from '../../src/config/configuration.js';
import { SecretStoreManager } from '../../src/auth/secretStore.js';
import { ReplayStore } from '../../src/reasoning/replayStore.js';
import { HistoryMatcher } from '../../src/reasoning/historyMatcher.js';
import { Logger } from '../../src/diagnostics/logger.js';
import { ZaiChatProvider } from '../../src/provider/zaiProvider.js';
import { findModelDescriptor } from '../../src/provider/modelCatalog.js';
import { toLanguageModelChatInformation } from '../../src/provider/vscodeAdapter.js';

describe('HTTP Client & Provider Mock Integration', () => {
  let server: http.Server;
  let serverPort: number;
  let serverBaseUrl: string;

  let lastReceivedHeaders: http.IncomingHttpHeaders | undefined;
  let lastReceivedPath: string | undefined;
  let lastReceivedBody: any;

  // Mock server response mode
  let responseMode:
    | 'standard_stream'
    | 'tool_call_stream'
    | 'http_400'
    | 'http_401'
    | 'http_403'
    | 'http_404'
    | 'http_429'
    | 'http_500'
    | 'redirect'
    | 'slow_stream'
    | 'premature_close' = 'standard_stream';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastReceivedHeaders = req.headers;
      lastReceivedPath = req.url;

      let bodyData = '';
      req.on('data', (c) => (bodyData += c.toString('utf8')));
      req.on('end', () => {
        try {
          lastReceivedBody = bodyData ? JSON.parse(bodyData) : undefined;
        } catch {
          lastReceivedBody = bodyData;
        }

        if (responseMode === 'redirect') {
          res.writeHead(302, { Location: `${serverBaseUrl}/redirected` });
          res.end();
          return;
        }

        if (responseMode === 'http_400') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid payload parameter', code: 'PARAM_ERROR' } }));
          return;
        }

        if (responseMode === 'http_401') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Authentication failed', code: 'UNAUTHORIZED' } }));
          return;
        }

        if (responseMode === 'http_403') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Plan does not permit this model', code: 'FORBIDDEN' } }));
          return;
        }

        if (responseMode === 'http_404') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Model not found', code: 'NOT_FOUND' } }));
          return;
        }

        if (responseMode === 'http_429') {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '30' });
          res.end(JSON.stringify({ error: { message: 'Rate limit exceeded', code: 1302 } }));
          return;
        }

        if (responseMode === 'http_500') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Internal server error', code: 'INTERNAL_ERROR' } }));
          return;
        }

        if (responseMode === 'premature_close') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          res.write('data: {"choices":[{"index":0,"delta":{"content":"Halfway"}}]}\n\n');
          // End response cleanly without sending [DONE]
          res.end();
          return;
        }

        if (responseMode === 'tool_call_stream') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          res.write(
            'data: {"choices":[{"index":0,"delta":{"reasoning_content":"Step 1: determine tool"}}]}\n\n'
          );
          res.write(
            'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"fetch_code","arguments":"{\\"file\\":\\"app.ts\\"}"}}]}}]}\n\n'
          );
          res.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        // Standard text completion stream
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write('data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n');
        res.write('data: {"choices":[{"index":0,"delta":{"content":" from Z.ai!"}}]}\n\n');
        res.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        serverBaseUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    resetMockConfig();
  });

  it('verifies request headers and payload format', async () => {
    responseMode = 'standard_stream';
    const client = new HttpClient();
    const abortCtrl = new AbortController();

    const stream = await client.postChatStream({
      profile: 'standard',
      apiKey: 'test-secret-key-12345',
      serializedPayload: JSON.stringify({ model: 'glm-5.3', messages: [] }),
      abortSignal: abortCtrl.signal,
      testUrlOverride: `${serverBaseUrl}/chat/completions`,
    });

    expect(stream).toBeDefined();
    expect(lastReceivedHeaders?.authorization).toBe('Bearer test-secret-key-12345');
    expect(lastReceivedHeaders?.['content-type']).toBe('application/json');
    expect(lastReceivedHeaders?.accept).toBe('text/event-stream');
    expect(lastReceivedHeaders?.['accept-language']).toBe('en-US,en');
    expect(lastReceivedPath).toBe('/chat/completions');
    expect(lastReceivedBody?.model).toBe('glm-5.3');
  });

  it('rejects HTTP 302 redirects per specification (redirect: error)', async () => {
    responseMode = 'redirect';
    const client = new HttpClient();
    const abortCtrl = new AbortController();

    await expect(
      client.postChatStream({
        profile: 'standard',
        apiKey: 'test-secret',
        serializedPayload: '{}',
        abortSignal: abortCtrl.signal,
        testUrlOverride: `${serverBaseUrl}/redirect`,
      })
    ).rejects.toThrow();
  });

  it('handles HTTP 400 Bad Request', async () => {
    responseMode = 'http_400';
    const client = new HttpClient();
    const abortCtrl = new AbortController();

    await expect(
      client.postChatStream({
        profile: 'standard',
        apiKey: 'test-secret',
        serializedPayload: '{}',
        abortSignal: abortCtrl.signal,
        testUrlOverride: `${serverBaseUrl}/400`,
      })
    ).rejects.toThrow(/Invalid payload parameter/);
  });

  it('handles HTTP 401 Unauthorized', async () => {
    responseMode = 'http_401';
    const client = new HttpClient();
    const abortCtrl = new AbortController();

    await expect(
      client.postChatStream({
        profile: 'standard',
        apiKey: 'test-secret',
        serializedPayload: '{}',
        abortSignal: abortCtrl.signal,
        testUrlOverride: `${serverBaseUrl}/401`,
      })
    ).rejects.toThrow(/Authentication failed/);
  });

  it('handles HTTP 403 Forbidden with plan advice', async () => {
    responseMode = 'http_403';
    const client = new HttpClient();
    const abortCtrl = new AbortController();

    await expect(
      client.postChatStream({
        profile: 'standard',
        apiKey: 'test-secret',
        serializedPayload: '{}',
        abortSignal: abortCtrl.signal,
        testUrlOverride: `${serverBaseUrl}/403`,
      })
    ).rejects.toThrow(/Plan does not permit this model/);
  });

  it('handles HTTP 429 Rate Limit with Retry-After header', async () => {
    responseMode = 'http_429';
    const client = new HttpClient();
    const abortCtrl = new AbortController();

    await expect(
      client.postChatStream({
        profile: 'standard',
        apiKey: 'test-secret',
        serializedPayload: '{}',
        abortSignal: abortCtrl.signal,
        testUrlOverride: `${serverBaseUrl}/429`,
      })
    ).rejects.toThrow(/Rate limit exceeded/);
  });

  it('enforces maximum concurrent requests limit (3 max)', async () => {
    responseMode = 'standard_stream';
    const client = new HttpClient();
    const abortCtrl = new AbortController();

    // Fill up to max concurrency
    (client as any)._activeRequests = MAX_CONCURRENT_REQUESTS;

    await expect(
      client.postChatStream({
        profile: 'standard',
        apiKey: 'test-secret',
        serializedPayload: '{}',
        abortSignal: abortCtrl.signal,
        testUrlOverride: `${serverBaseUrl}/concurrent`,
      })
    ).rejects.toThrow(/Concurrent request limit exceeded/);

    (client as any)._activeRequests = 0;
  });

  it('runs full end-to-end chat response through ZaiChatProvider and reports progress', async () => {
    responseMode = 'standard_stream';

    const mockSecrets: any = {
      store: new Map<string, string>([['zai.apiKey.standard', 'valid-test-key']]),
      get: async (k: string) => mockSecrets.store.get(k),
      storeKey: async (k: string, v: string) => mockSecrets.store.set(k, v),
      delete: async (k: string) => mockSecrets.store.delete(k),
    };

    const configManager = new ConfigurationManager();
    await configManager.setEndpointProfile('standard');

    const secretStore = new SecretStoreManager(mockSecrets);
    const httpClient = new HttpClient();
    const replayStore = new ReplayStore();
    const historyMatcher = new HistoryMatcher();
    const logger = new Logger(() => 'debug');

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger,
      `${serverBaseUrl}/chat/completions`
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const modelInfo = toLanguageModelChatInformation(descriptor);

    const reportedParts: any[] = [];
    const progress = {
      report: (part: any) => reportedParts.push(part),
    };

    const dummyToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    await provider.provideLanguageModelChatResponse(
      modelInfo,
      [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart('Hello!')],
          name: undefined,
        },
      ],
      { toolMode: vscode.LanguageModelChatToolMode.Auto },
      progress,
      dummyToken
    );

    expect(reportedParts.length).toBeGreaterThan(0);
    const combinedText = reportedParts.map((p) => p.value).join('');
    expect(combinedText).toBe('Hello from Z.ai!');
  });

  it('executes full tool calling roundtrip with batch validation and reasoning replay cache commit', async () => {
    responseMode = 'tool_call_stream';

    const mockSecrets: any = {
      store: new Map<string, string>([['zai.apiKey.standard', 'valid-test-key']]),
      get: async (k: string) => mockSecrets.store.get(k),
      storeKey: async (k: string, v: string) => mockSecrets.store.set(k, v),
      delete: async (k: string) => mockSecrets.store.delete(k),
    };

    const configManager = new ConfigurationManager();
    await configManager.setEndpointProfile('standard');

    const secretStore = new SecretStoreManager(mockSecrets);
    const httpClient = new HttpClient();
    const replayStore = new ReplayStore();
    const historyMatcher = new HistoryMatcher();
    const logger = new Logger(() => 'debug');

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger,
      `${serverBaseUrl}/chat/completions`
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const modelInfo = toLanguageModelChatInformation(descriptor);

    const reportedParts: any[] = [];
    const progress = {
      report: (part: any) => reportedParts.push(part),
    };

    const dummyToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    await provider.provideLanguageModelChatResponse(
      modelInfo,
      [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart('Show me the code in app.ts')],
          name: undefined,
        },
      ],
      {
        toolMode: vscode.LanguageModelChatToolMode.Auto,
        tools: [
          {
            name: 'fetch_code',
            description: 'Fetches code',
            inputSchema: { type: 'object', properties: { file: { type: 'string' } } },
          },
        ],
      },
      progress,
      dummyToken
    );

    expect(reportedParts).toHaveLength(1);
    expect(reportedParts[0]).toBeInstanceOf(vscode.LanguageModelToolCallPart);
    expect(reportedParts[0].callId).toBe('call_1');
    expect(reportedParts[0].name).toBe('fetch_code');
    expect(reportedParts[0].input).toEqual({ file: 'app.ts' });

    // Verify replay record was committed to ReplayStore atomically!
    expect(replayStore.count).toBe(1);
    const record = replayStore.getAll()[0];
    expect(record.reasoningContent).toBe('Step 1: determine tool');
    expect(record.callIds).toContain('call_1');
  });

  it('detects premature connection close without [DONE] marker and throws', async () => {
    responseMode = 'premature_close';

    const mockSecrets: any = {
      store: new Map<string, string>([['zai.apiKey.standard', 'valid-test-key']]),
      get: async (k: string) => mockSecrets.store.get(k),
      storeKey: async (k: string, v: string) => mockSecrets.store.set(k, v),
      delete: async (k: string) => mockSecrets.store.delete(k),
    };

    const configManager = new ConfigurationManager();
    await configManager.setEndpointProfile('standard');

    const secretStore = new SecretStoreManager(mockSecrets);
    const httpClient = new HttpClient();
    const replayStore = new ReplayStore();
    const historyMatcher = new HistoryMatcher();
    const logger = new Logger(() => 'debug');

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger,
      `${serverBaseUrl}/chat/completions`
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const modelInfo = toLanguageModelChatInformation(descriptor);

    const progress = { report: () => {} };
    const dummyToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    await expect(
      provider.provideLanguageModelChatResponse(
        modelInfo,
        [
          {
            role: vscode.LanguageModelChatMessageRole.User,
            content: [new vscode.LanguageModelTextPart('Hello')],
            name: undefined,
          },
        ],
        { toolMode: vscode.LanguageModelChatToolMode.Auto },
        progress,
        dummyToken
      )
    ).rejects.toThrow(/Stream terminated prematurely/);
  });

  it('handles multi-turn chat under experimental-strict without TDZ ReferenceError and matches replay', async () => {
    responseMode = 'standard_stream';

    const mockSecrets: any = {
      store: new Map<string, string>([['zai.apiKey.standard', 'valid-test-key']]),
      get: async (k: string) => mockSecrets.store.get(k),
      storeKey: async (k: string, v: string) => mockSecrets.store.set(k, v),
      delete: async (k: string) => mockSecrets.store.delete(k),
    };

    const configManager = new ConfigurationManager();
    await configManager.setEndpointProfile('standard');
    // Enable experimental-strict to trigger reasoning lookup across turns
    await vscode.workspace.getConfiguration('zai').update('preservedThinking', 'experimental-strict');

    const secretStore = new SecretStoreManager(mockSecrets);
    const httpClient = new HttpClient();
    const replayStore = new ReplayStore();
    const historyMatcher = new HistoryMatcher();
    const logger = new Logger(() => 'debug');

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger,
      `${serverBaseUrl}/chat/completions`
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const modelInfo = toLanguageModelChatInformation(descriptor);

    // Seed replay store with Turn 1 assistant reasoning
    const initialUserMsg = [{ role: 'user' as const, content: 'First question' }];
    const turn1Fingerprint = historyMatcher.computeFingerprint(initialUserMsg);

    replayStore.put({
      requestId: 'turn-1-req',
      modelId: 'glm-5.3',
      endpointProfile: 'standard',
      credentialGeneration: secretStore.getCredentialGeneration(),
      configGeneration: configManager.getSnapshot().configGeneration,
      inputHistoryFingerprint: turn1Fingerprint,
      assistantText: 'First answer',
      callIds: [],
      toolNames: [],
      rawArguments: [],
      reasoningContent: 'First turn thinking trace',
      timestamp: Date.now(),
      byteSize: 100,
      status: 'completed',
    });

    const reportedParts: any[] = [];
    const progress = { report: (part: any) => reportedParts.push(part) };
    const dummyToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    // Send multi-turn request: User -> Assistant -> User
    await provider.provideLanguageModelChatResponse(
      modelInfo,
      [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart('First question')],
          name: undefined,
        },
        {
          role: vscode.LanguageModelChatMessageRole.Assistant,
          content: [new vscode.LanguageModelTextPart('First answer')],
          name: undefined,
        },
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart('Second question')],
          name: undefined,
        },
      ],
      { toolMode: vscode.LanguageModelChatToolMode.Auto },
      progress,
      dummyToken
    );

    expect(reportedParts.length).toBeGreaterThan(0);
    // Verify that the assistant turn received matched reasoning_content in the request sent to server
    expect(lastReceivedBody?.messages[1]?.reasoning_content).toBe('First turn thinking trace');
  });

  it('restores interleaved thinking reasoning on tool continuation even when preservedThinking is off', async () => {
    responseMode = 'standard_stream';

    const mockSecrets: any = {
      store: new Map<string, string>([['zai.apiKey.standard', 'valid-test-key']]),
      get: async (k: string) => mockSecrets.store.get(k),
      storeKey: async (k: string, v: string) => mockSecrets.store.set(k, v),
      delete: async (k: string) => mockSecrets.store.delete(k),
    };

    const configManager = new ConfigurationManager();
    await configManager.setEndpointProfile('standard');
    // preservedThinking is default 'off'
    expect(configManager.getSnapshot().preservedThinking).toBe('off');

    const secretStore = new SecretStoreManager(mockSecrets);
    const httpClient = new HttpClient();
    const replayStore = new ReplayStore();
    const historyMatcher = new HistoryMatcher();
    const logger = new Logger(() => 'debug');

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger,
      `${serverBaseUrl}/chat/completions`
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const modelInfo = toLanguageModelChatInformation(descriptor);

    // Seed Turn 1 tool call into ReplayStore
    const turn1InputMessages = [{ role: 'user' as const, content: 'Read file foo.txt' }];
    const turn1Fingerprint = historyMatcher.computeFingerprint(turn1InputMessages);

    replayStore.put({
      requestId: 'turn-1-tool-req',
      modelId: 'glm-5.3',
      endpointProfile: 'standard',
      credentialGeneration: secretStore.getCredentialGeneration(),
      configGeneration: configManager.getSnapshot().configGeneration,
      inputHistoryFingerprint: turn1Fingerprint,
      assistantText: null,
      callIds: ['call_foo_1'],
      toolNames: ['read_file'],
      rawArguments: ['{"path":"foo.txt"}'],
      reasoningContent: 'Determined that read_file is needed for foo.txt',
      timestamp: Date.now(),
      byteSize: 150,
      status: 'completed',
    });

    const reportedParts: any[] = [];
    const progress = { report: (part: any) => reportedParts.push(part) };
    const dummyToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    // Send Tool Continuation: User -> Assistant (with tool call) -> User (with tool result)
    await provider.provideLanguageModelChatResponse(
      modelInfo,
      [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart('Read file foo.txt')],
          name: undefined,
        },
        {
          role: vscode.LanguageModelChatMessageRole.Assistant,
          content: [
            new vscode.LanguageModelToolCallPart('call_foo_1', 'read_file', { path: 'foo.txt' }),
          ],
          name: undefined,
        },
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [
            new vscode.LanguageModelToolResultPart('call_foo_1', [
              new vscode.LanguageModelTextPart('hello from foo.txt'),
            ]),
          ],
          name: undefined,
        },
      ],
      {
        toolMode: vscode.LanguageModelChatToolMode.Auto,
        tools: [
          {
            name: 'read_file',
            description: 'Reads file',
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          },
        ],
      },
      progress,
      dummyToken
    );

    // Verify reasoning was restored into the assistant message sent to upstream
    expect(lastReceivedBody?.messages[1]?.reasoning_content).toBe(
      'Determined that read_file is needed for foo.txt'
    );
  });

  it('safely aborts with ReplayMatchingError before network call when tool continuation reasoning is missing from cache', async () => {
    const mockSecrets: any = {
      store: new Map<string, string>([['zai.apiKey.standard', 'valid-test-key']]),
      get: async (k: string) => mockSecrets.store.get(k),
      storeKey: async (k: string, v: string) => mockSecrets.store.set(k, v),
      delete: async (k: string) => mockSecrets.store.delete(k),
    };

    const configManager = new ConfigurationManager();
    await configManager.setEndpointProfile('standard');

    const secretStore = new SecretStoreManager(mockSecrets);
    const httpClient = new HttpClient();
    const replayStore = new ReplayStore(); // Empty replay store (cache lost / restart)
    const historyMatcher = new HistoryMatcher();
    const logger = new Logger(() => 'debug');

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger,
      `${serverBaseUrl}/chat/completions`
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const modelInfo = toLanguageModelChatInformation(descriptor);

    const progress = { report: () => {} };
    const dummyToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    await expect(
      provider.provideLanguageModelChatResponse(
        modelInfo,
        [
          {
            role: vscode.LanguageModelChatMessageRole.User,
            content: [new vscode.LanguageModelTextPart('Do task')],
            name: undefined,
          },
          {
            role: vscode.LanguageModelChatMessageRole.Assistant,
            content: [new vscode.LanguageModelToolCallPart('call_x', 'do_task', {})],
            name: undefined,
          },
          {
            role: vscode.LanguageModelChatMessageRole.User,
            content: [new vscode.LanguageModelToolResultPart('call_x', ['Done'])],
            name: undefined,
          },
        ],
        { toolMode: vscode.LanguageModelChatToolMode.Auto },
        progress,
        dummyToken
      )
    ).rejects.toThrow(/Cannot continue tool execution: reasoning history for tool call/);
  });

  it('rolls back replay cache entry if request is cancelled before/during tool publishing', async () => {
    responseMode = 'tool_call_stream';

    const mockSecrets: any = {
      store: new Map<string, string>([['zai.apiKey.standard', 'valid-test-key']]),
      get: async (k: string) => mockSecrets.store.get(k),
      storeKey: async (k: string, v: string) => mockSecrets.store.set(k, v),
      delete: async (k: string) => mockSecrets.store.delete(k),
    };

    const configManager = new ConfigurationManager();
    await configManager.setEndpointProfile('standard');

    const secretStore = new SecretStoreManager(mockSecrets);
    const httpClient = new HttpClient();
    const replayStore = new ReplayStore();
    const historyMatcher = new HistoryMatcher();
    const logger = new Logger(() => 'debug');

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger,
      `${serverBaseUrl}/chat/completions`
    );

    const descriptor = findModelDescriptor('glm-5.3')!;
    const modelInfo = toLanguageModelChatInformation(descriptor);

    // Token that requests cancellation immediately when progress reports the first part
    let isCancelled = false;
    const dummyToken = {
      get isCancellationRequested() {
        return isCancelled;
      },
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    const progress = {
      report: () => {
        isCancelled = true;
      },
    };

    await provider.provideLanguageModelChatResponse(
      modelInfo,
      [
        {
          role: vscode.LanguageModelChatMessageRole.User,
          content: [new vscode.LanguageModelTextPart('Run code')],
          name: undefined,
        },
      ],
      {
        toolMode: vscode.LanguageModelChatToolMode.Auto,
        tools: [
          {
            name: 'fetch_code',
            description: 'Fetches code',
            inputSchema: { type: 'object', properties: { file: { type: 'string' } } },
          },
        ],
      },
      progress,
      dummyToken
    );

    // Replay record must have been rolled back / removed on cancellation!
    expect(replayStore.count).toBe(0);
  });

  it('rejects unsupported models for the active endpoint profile prior to network access (e.g. FlashX on coding-plan)', async () => {
    const mockSecrets: any = {
      store: new Map<string, string>([['zai.apiKey.coding-plan', 'valid-plan-key']]),
      get: async (k: string) => mockSecrets.store.get(k),
      storeKey: async (k: string, v: string) => mockSecrets.store.set(k, v),
      delete: async (k: string) => mockSecrets.store.delete(k),
    };

    const configManager = new ConfigurationManager();
    await configManager.setEndpointProfile('coding-plan');

    const secretStore = new SecretStoreManager(mockSecrets);
    const httpClient = new HttpClient();
    const replayStore = new ReplayStore();
    const historyMatcher = new HistoryMatcher();
    const logger = new Logger(() => 'debug');

    const provider = new ZaiChatProvider(
      configManager,
      secretStore,
      httpClient,
      replayStore,
      historyMatcher,
      logger,
      `${serverBaseUrl}/chat/completions`
    );

    // glm-5.3-flashx is unsupported on coding-plan per K05
    const flashxDescriptor = findModelDescriptor('glm-5.3-flashx')!;
    const flashxModelInfo = toLanguageModelChatInformation(flashxDescriptor);

    const progress = { report: () => {} };
    const dummyToken = {
      isCancellationRequested: false,
      onCancellationRequested: () => ({ dispose: () => {} }),
    } as any;

    await expect(
      provider.provideLanguageModelChatResponse(
        flashxModelInfo,
        [
          {
            role: vscode.LanguageModelChatMessageRole.User,
            content: [new vscode.LanguageModelTextPart('Hello')],
            name: undefined,
          },
        ],
        { toolMode: vscode.LanguageModelChatToolMode.Auto },
        progress,
        dummyToken
      )
    ).rejects.toThrow(/not found on endpoint profile 'coding-plan'/);
  });
});
