import * as vscode from 'vscode';
import { ZaiFunctionCall, ZaiMessage } from './types.js';
import { ToolNameMapper } from './toolMapper.js';

export interface MessageMappingOptions {
  readonly nameMapper?: ToolNameMapper;
  /**
   * Optional lookup to supply reasoning_content for an assistant turn if available from ReplayStore.
   * Receives:
   * - turnIndex: index of the message in the input messages array
   * - assistantText: the visible text content of the assistant message (or null)
   * - precedingMessages: all mapped ZaiMessages preceding this assistant turn
   * - toolCallIds: callIds of any tool calls issued in this assistant turn
   */
  readonly getReasoningForTurn?: (
    turnIndex: number,
    assistantText: string | null,
    precedingMessages: readonly ZaiMessage[],
    toolCallIds: readonly string[]
  ) => string | undefined;
}

/**
 * Maps VS Code LanguageModelChatRequestMessage[] to Z.ai Chat API message format.
 * Follows strict invariants from Section 8 of the project plan.
 */
export function mapHostMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options?: MessageMappingOptions
): readonly ZaiMessage[] {
  if (!messages || messages.length === 0) {
    throw new Error('Message mapping failed: Request message list cannot be empty.');
  }

  const nameMapper = options?.nameMapper;
  const getReasoningForTurn = options?.getReasoningForTurn;

  const result: ZaiMessage[] = [];
  const knownToolCallIds = new Set<string>();

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];

    if (msg.role === vscode.LanguageModelChatMessageRole.User) {
      if (!msg.content || msg.content.length === 0) {
        throw new Error('Invalid message: User message content array cannot be empty.');
      }

      // A VS Code user message can contain text parts and/or tool result parts.
      // We must preserve exact ordering.
      // If text parts and tool result parts are consecutive or mixed:
      // In Z.ai / OpenAI protocol, tool results are individual messages with role: 'tool'.
      // Text parts belong to role: 'user'.
      let currentTextBuffer = '';

      const flushText = () => {
        if (currentTextBuffer.length > 0) {
          result.push({
            role: 'user',
            content: currentTextBuffer,
            name: msg.name,
          });
          currentTextBuffer = '';
        }
      };

      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart || (typeof part === 'object' && part !== null && 'value' in part && typeof (part as any).value === 'string' && !('callId' in part))) {
          const val = (part as vscode.LanguageModelTextPart).value;
          currentTextBuffer += val;
        } else if (part instanceof vscode.LanguageModelToolResultPart || (typeof part === 'object' && part !== null && 'callId' in part && 'content' in part)) {
          // Flush any pending user text first
          flushText();

          const trPart = part as vscode.LanguageModelToolResultPart;
          const callId = trPart.callId;

          if (!callId) {
            throw new Error('Tool result part is missing callId.');
          }

          // Verify that this tool call was indeed previously issued
          if (!knownToolCallIds.has(callId)) {
            throw new Error(
              `Tool result for callId '${callId}' does not have a matching preceding tool call in conversation history.`
            );
          }

          // Extract content of tool result
          let resultContent = '';
          if (Array.isArray(trPart.content)) {
            for (const subPart of trPart.content) {
              if (subPart instanceof vscode.LanguageModelTextPart || (typeof subPart === 'object' && subPart !== null && 'value' in subPart && typeof (subPart as any).value === 'string')) {
                resultContent += (subPart as vscode.LanguageModelTextPart).value;
              } else if (typeof subPart === 'string') {
                resultContent += subPart;
              } else if (typeof subPart === 'object' && subPart !== null) {
                // If PromptTsx or other object
                try {
                  resultContent += JSON.stringify(subPart);
                } catch {
                  resultContent += String(subPart);
                }
              } else {
                resultContent += String(subPart ?? '');
              }
            }
          } else if (typeof trPart.content === 'string') {
            resultContent = trPart.content;
          } else {
            resultContent = JSON.stringify(trPart.content ?? '');
          }

          result.push({
            role: 'tool',
            content: resultContent,
            tool_call_id: callId,
          });
        } else {
          throw new Error(
            `UNSUPPORTED_MESSAGE_PART: Encountered unknown or unmappable content part in user message: ${JSON.stringify(part)}`
          );
        }
      }

      flushText();

    } else if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
      if (!msg.content || msg.content.length === 0) {
        throw new Error('Invalid message: Assistant message content array cannot be empty.');
      }

      // Assistant message can contain text parts and/or tool call parts
      let textContent = '';
      const toolCalls: ZaiFunctionCall[] = [];

      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart || (typeof part === 'object' && part !== null && 'value' in part && typeof (part as any).value === 'string' && !('callId' in part))) {
          textContent += (part as vscode.LanguageModelTextPart).value;
        } else if (part instanceof vscode.LanguageModelToolCallPart || (typeof part === 'object' && part !== null && 'callId' in part && 'name' in part && 'input' in part)) {
          const tc = part as vscode.LanguageModelToolCallPart;
          const mappedName = nameMapper ? nameMapper.mapToZai(tc.name) : tc.name;
          const callId = tc.callId;

          if (!callId || !callId.trim()) {
            throw new Error(`Tool call part for '${tc.name}' is missing a valid callId.`);
          }

          let argsString: string;
          try {
            argsString = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input ?? {});
          } catch (err: any) {
            throw new Error(`Failed to serialize tool call arguments for '${tc.name}': ${err?.message}`);
          }

          knownToolCallIds.add(callId);
          toolCalls.push({
            id: callId,
            type: 'function',
            function: {
              name: mappedName,
              arguments: argsString,
            },
          });
        } else {
          throw new Error(
            `UNSUPPORTED_MESSAGE_PART: Encountered unknown or unmappable content part in assistant message: ${JSON.stringify(part)}`
          );
        }
      }

      const content = textContent.length > 0 ? textContent : null;
      if (content === null && toolCalls.length === 0) {
        throw new Error('Invalid message: Assistant message must contain either text content or tool calls.');
      }

      const toolCallIds = toolCalls.map((tc) => tc.id);
      const reasoning = getReasoningForTurn
        ? getReasoningForTurn(msgIdx, content, [...result], toolCallIds)
        : undefined;

      const assistantMsg: ZaiMessage = {
        role: 'assistant',
        content,
        name: msg.name,
        tool_calls: toolCalls.length > 0 ? Object.freeze(toolCalls) : undefined,
        reasoning_content: reasoning,
      };

      result.push(assistantMsg);
    } else {
      throw new Error(`Unsupported message role in request: ${String(msg.role)}`);
    }
  }

  // Z.ai constraint: A request cannot consist purely of assistant, tool, or system messages
  const hasUserMessage = result.some((m) => m.role === 'user');
  if (!hasUserMessage) {
    throw new Error(
      'Invalid conversation history: Z.ai API requires at least one user message in the conversation.'
    );
  }

  return Object.freeze(result);
}
