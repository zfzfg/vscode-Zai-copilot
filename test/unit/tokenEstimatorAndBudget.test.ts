import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { TokenEstimator } from '../../src/tokens/tokenEstimator.js';
import { ModelDescriptor } from '../../src/provider/modelCatalog.js';

describe('TokenEstimator & Context Budgeting', () => {
  it('estimates string tokens accurately for ASCII and CJK text', () => {
    const asciiText = 'The quick brown fox jumps over the lazy dog.';
    const asciiTokens = TokenEstimator.estimateStringTokens(asciiText);
    expect(asciiTokens).toBeGreaterThan(5);
    expect(asciiTokens).toBeLessThan(20);

    const cjkText = '你好，世界！这是一段中文测试。';
    const cjkTokens = TokenEstimator.estimateStringTokens(cjkText);
    expect(cjkTokens).toBeGreaterThan(10);
  });

  it('estimates host items accurately for string and LanguageModelChatRequestMessage', () => {
    const strCount = TokenEstimator.estimateHostItemTokens('Simple test string');
    expect(strCount).toBeGreaterThan(0);

    const userMsg: vscode.LanguageModelChatRequestMessage = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [new vscode.LanguageModelTextPart('Hello Z.ai')],
      name: 'user1',
    };
    const userMsgCount = TokenEstimator.estimateHostItemTokens(userMsg);
    expect(userMsgCount).toBeGreaterThan(strCount);

    const toolCallMsg: vscode.LanguageModelChatRequestMessage = {
      role: vscode.LanguageModelChatMessageRole.Assistant,
      content: [
        new vscode.LanguageModelToolCallPart('c1', 'get_weather', { city: 'Tokyo' }),
      ],
      name: undefined,
    };
    const toolCallCount = TokenEstimator.estimateHostItemTokens(toolCallMsg);
    expect(toolCallCount).toBeGreaterThan(10);
  });

  it('validates preflight budget and throws PreflightBudgetExceededError if budget exceeded', () => {
    const testModel: ModelDescriptor = {
      apiModelId: 'test-small-model',
      displayName: 'Small',
      family: 'test',
      version: '1.0',
      providerContextBudget: 100, // Small context for test
      providerMaxOutputTokens: 20,
      defaultRequestMaxOutputTokens: 20,
      inputSafetyMarginTokens: 10,
      supportsThinkingDisable: false,
      reasoningEfforts: [],
      endpointStatus: { standard: 'verified', 'coding-plan': 'verified' },
      implementedCapabilities: { text: true, tools: true, images: false },
    };

    // Valid within budget
    const validRequest = {
      model: 'test-small-model',
      messages: [{ role: 'user' as const, content: 'Hi' }],
      stream: true,
    };
    const tokens = TokenEstimator.validatePreflightBudget(testModel, validRequest);
    expect(tokens).toBeLessThan(70);

    // Exceeds budget (100 - 20 - 10 = 70 maxInputTokens)
    const largeRequest = {
      model: 'test-small-model',
      messages: [
        {
          role: 'user' as const,
          content: 'x'.repeat(1000), // Huge content
        },
      ],
      stream: true,
    };
    expect(() => TokenEstimator.validatePreflightBudget(testModel, largeRequest)).toThrow(
      /Preflight context budget exceeded/
    );
  });
});
