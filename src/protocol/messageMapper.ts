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

    const isUserRole =
      msg.role === vscode.LanguageModelChatMessageRole.User ||
      (msg.role as any) === 1 ||
      String(msg.role).toLowerCase() === 'user';

    const isAssistantRole =
      msg.role === vscode.LanguageModelChatMessageRole.Assistant ||
      (msg.role as any) === 2 ||
      String(msg.role).toLowerCase() === 'assistant';

    const isSystemRole =
      (msg.role as any) === 3 ||
      String(msg.role).toLowerCase() === 'system' ||
      ((vscode.LanguageModelChatMessageRole as any).System !== undefined &&
        msg.role === (vscode.LanguageModelChatMessageRole as any).System);

    const isToolRole =
      (msg.role as any) === 4 ||
      String(msg.role).toLowerCase() === 'tool';

    if (isUserRole) {
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
        } else if (typeof part === 'string') {
          currentTextBuffer += part;
        } else if (
          typeof part === 'object' &&
          part !== null &&
          'text' in part &&
          typeof (part as any).text === 'string'
        ) {
          currentTextBuffer += (part as any).text;
        } else if (
          typeof part === 'object' &&
          part !== null &&
          'value' in part &&
          typeof (part as any).value === 'object' &&
          (part as any).value !== null &&
          !('callId' in part)
        ) {
          const val = (part as any).value;
          currentTextBuffer += typeof val.text === 'string' ? val.text : JSON.stringify(val);
        } else if (
          typeof part === 'object' &&
          part !== null &&
          'data' in part &&
          (part as any).data instanceof Uint8Array
        ) {
          try {
            currentTextBuffer += new TextDecoder().decode((part as any).data);
          } catch {
            // ignore binary decode error
          }
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

    } else if (isAssistantRole) {
      if (!msg.content || msg.content.length === 0) {
        throw new Error('Invalid message: Assistant message content array cannot be empty.');
      }

      // Assistant message can contain text parts and/or tool call parts
      let textContent = '';
      const toolCalls: ZaiFunctionCall[] = [];

      for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart || (typeof part === 'object' && part !== null && 'value' in part && typeof (part as any).value === 'string' && !('callId' in part))) {
          textContent += (part as vscode.LanguageModelTextPart).value;
        } else if (typeof part === 'string') {
          textContent += part;
        } else if (
          typeof part === 'object' &&
          part !== null &&
          'text' in part &&
          typeof (part as any).text === 'string'
        ) {
          textContent += (part as any).text;
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
    } else if (isSystemRole) {
      if (!msg.content || (Array.isArray(msg.content) && msg.content.length === 0)) {
        continue;
      }

      let systemText = '';
      if (typeof (msg as any).content === 'string') {
        systemText = (msg as any).content;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (
            part instanceof vscode.LanguageModelTextPart ||
            (typeof part === 'object' && part !== null && 'value' in part && typeof (part as any).value === 'string' && !('callId' in part))
          ) {
            systemText += (part as vscode.LanguageModelTextPart).value;
          } else if (typeof part === 'string') {
            systemText += part;
          } else if (
            typeof part === 'object' &&
            part !== null &&
            'text' in part &&
            typeof (part as any).text === 'string'
          ) {
            systemText += (part as any).text;
          } else if (
            typeof part === 'object' &&
            part !== null &&
            'value' in part &&
            typeof (part as any).value === 'object' &&
            (part as any).value !== null
          ) {
            const val = (part as any).value;
            systemText += typeof val.text === 'string' ? val.text : JSON.stringify(val);
          } else if (
            typeof part === 'object' &&
            part !== null &&
            'data' in part &&
            (part as any).data instanceof Uint8Array
          ) {
            try {
              systemText += new TextDecoder().decode((part as any).data);
            } catch {
              // ignore binary decode error
            }
          } else {
            throw new Error(
              `UNSUPPORTED_MESSAGE_PART: Encountered unknown or unmappable content part in system message: ${JSON.stringify(part)}`
            );
          }
        }
      }

      if (systemText.trim().length > 0) {
        result.push({
          role: 'system',
          content: systemText,
          name: msg.name,
        });
      }
    } else if (isToolRole) {
      if (!msg.content || (Array.isArray(msg.content) && msg.content.length === 0)) {
        throw new Error('Invalid message: Tool message content cannot be empty.');
      }
      let toolText = '';
      let callId = (msg as any).toolCallId ?? (msg as any).callId;

      if (typeof (msg as any).content === 'string') {
        toolText = (msg as any).content;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (
            part instanceof vscode.LanguageModelToolResultPart ||
            (typeof part === 'object' && part !== null && 'callId' in part)
          ) {
            callId = (part as any).callId || callId;
            const content = (part as any).content;
            if (Array.isArray(content)) {
              for (const sub of content) {
                if (
                  sub instanceof vscode.LanguageModelTextPart ||
                  (typeof sub === 'object' && sub !== null && 'value' in sub && typeof (sub as any).value === 'string')
                ) {
                  toolText += (sub as vscode.LanguageModelTextPart).value;
                } else if (typeof sub === 'string') {
                  toolText += sub;
                } else {
                  try {
                    toolText += JSON.stringify(sub);
                  } catch {
                    toolText += String(sub);
                  }
                }
              }
            } else if (typeof content === 'string') {
              toolText += content;
            } else {
              toolText += JSON.stringify(content ?? '');
            }
          } else if (typeof part === 'string') {
            toolText += part;
          } else if (
            part instanceof vscode.LanguageModelTextPart ||
            (typeof part === 'object' && part !== null && 'value' in part && typeof (part as any).value === 'string')
          ) {
            toolText += (part as vscode.LanguageModelTextPart).value;
          } else {
            throw new Error(
              `UNSUPPORTED_MESSAGE_PART: Encountered unknown content part in tool message: ${JSON.stringify(part)}`
            );
          }
        }
      }

      if (!callId) {
        throw new Error('Tool message is missing tool_call_id.');
      }

      result.push({
        role: 'tool',
        content: toolText,
        tool_call_id: callId,
      });
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
