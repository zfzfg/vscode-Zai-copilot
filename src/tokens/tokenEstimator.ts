import * as vscode from 'vscode';
import { ModelDescriptor } from '../provider/modelCatalog.js';
import { ZaiChatCompletionRequest, ZaiMessage } from '../protocol/types.js';
import { PreflightBudgetExceededError } from '../transport/errors.js';

export class TokenEstimator {
  private static readonly MESSAGE_OVERHEAD_TOKENS = 4;
  private static readonly TOOL_CALL_OVERHEAD_TOKENS = 8;
  private static readonly REQUEST_BASE_TOKENS = 3;

  /**
   * Fast, conservative token estimation for raw strings across Western and CJK text.
   * Standard heuristic:
   * - ASCII / whitespace: ~3.5 to 4 characters per token
   * - Multi-byte UTF-8 (CJK, accented, Cyrillic, emoji): ~1.5 to 2 bytes per token
   */
  public static estimateStringTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    let asciiCount = 0;
    let nonAsciiCount = 0;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 128) {
        asciiCount++;
      } else {
        nonAsciiCount++;
      }
    }

    const asciiTokens = Math.ceil(asciiCount / 3.5);
    const nonAsciiTokens = Math.ceil(nonAsciiCount * 1.5);

    return Math.max(1, asciiTokens + nonAsciiTokens);
  }

  /**
   * Estimates tokens for a VS Code LanguageModelChatRequestMessage or string as provided to provideTokenCount.
   */
  public static estimateHostItemTokens(
    textOrMessage: string | vscode.LanguageModelChatRequestMessage
  ): number {
    if (typeof textOrMessage === 'string') {
      return this.estimateStringTokens(textOrMessage);
    }

    let tokens = this.MESSAGE_OVERHEAD_TOKENS;

    if (textOrMessage.name) {
      tokens += this.estimateStringTokens(textOrMessage.name);
    }

    if (Array.isArray(textOrMessage.content)) {
      for (const part of textOrMessage.content) {
        if (part instanceof vscode.LanguageModelTextPart || (typeof part === 'object' && part !== null && 'value' in part && typeof (part as any).value === 'string' && !('callId' in part))) {
          tokens += this.estimateStringTokens((part as vscode.LanguageModelTextPart).value);
        } else if (part instanceof vscode.LanguageModelToolCallPart || (typeof part === 'object' && part !== null && 'callId' in part && 'name' in part && 'input' in part)) {
          const tc = part as vscode.LanguageModelToolCallPart;
          tokens += this.TOOL_CALL_OVERHEAD_TOKENS;
          tokens += this.estimateStringTokens(tc.name);
          tokens += this.estimateStringTokens(JSON.stringify(tc.input ?? {}));
        } else if (part instanceof vscode.LanguageModelToolResultPart || (typeof part === 'object' && part !== null && 'callId' in part && 'content' in part)) {
          const tr = part as vscode.LanguageModelToolResultPart;
          tokens += this.estimateStringTokens(tr.callId);
          if (Array.isArray(tr.content)) {
            for (const sub of tr.content) {
              if (sub instanceof vscode.LanguageModelTextPart || (typeof sub === 'object' && sub !== null && 'value' in sub && typeof (sub as any).value === 'string')) {
                tokens += this.estimateStringTokens((sub as vscode.LanguageModelTextPart).value);
              } else {
                tokens += this.estimateStringTokens(JSON.stringify(sub));
              }
            }
          } else {
            tokens += this.estimateStringTokens(String(tr.content ?? ''));
          }
        } else {
          tokens += 10; // Fallback overhead
        }
      }
    }

    return tokens;
  }

  /**
   * Estimates tokens for a mapped ZaiMessage.
   */
  public static estimateZaiMessageTokens(msg: ZaiMessage): number {
    let tokens = this.MESSAGE_OVERHEAD_TOKENS;
    if (msg.name) {
      tokens += this.estimateStringTokens(msg.name);
    }
    if (msg.content) {
      tokens += this.estimateStringTokens(msg.content);
    }
    if (msg.tool_call_id) {
      tokens += this.estimateStringTokens(msg.tool_call_id);
    }
    if (msg.reasoning_content) {
      tokens += this.estimateStringTokens(msg.reasoning_content);
    }
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        tokens += this.TOOL_CALL_OVERHEAD_TOKENS;
        tokens += this.estimateStringTokens(tc.function.name);
        tokens += this.estimateStringTokens(tc.function.arguments);
      }
    }
    return tokens;
  }

  /**
   * Estimates total prompt tokens for an entire ZaiChatCompletionRequest.
   */
  public static estimateRequestTokens(request: ZaiChatCompletionRequest): number {
    let total = this.REQUEST_BASE_TOKENS;

    for (const msg of request.messages) {
      total += this.estimateZaiMessageTokens(msg);
    }

    if (request.tools) {
      for (const tool of request.tools) {
        total += this.TOOL_CALL_OVERHEAD_TOKENS;
        total += this.estimateStringTokens(tool.function.name);
        total += this.estimateStringTokens(tool.function.description);
        total += this.estimateStringTokens(JSON.stringify(tool.function.parameters));
      }
    }

    return total;
  }

  /**
   * Performs preflight budget check. Throws PreflightBudgetExceededError if request exceeds maxInputTokens.
   */
  public static validatePreflightBudget(
    model: ModelDescriptor,
    request: ZaiChatCompletionRequest
  ): number {
    const estimatedTokens = this.estimateRequestTokens(request);
    const maxInputTokens =
      model.providerContextBudget - model.providerMaxOutputTokens - model.inputSafetyMarginTokens;

    if (estimatedTokens > maxInputTokens) {
      throw new PreflightBudgetExceededError(estimatedTokens, maxInputTokens);
    }

    return estimatedTokens;
  }
}
