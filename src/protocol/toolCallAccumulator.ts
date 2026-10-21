import { ToolNameMapper } from './toolMapper.js';
import { ZaiDeltaToolCall } from './types.js';

export const MAX_SINGLE_TOOL_ARGUMENTS_BYTES = 1 * 1024 * 1024; // 1 MiB
export const MAX_TOTAL_TOOL_ARGUMENTS_BYTES = 4 * 1024 * 1024; // 4 MiB
export const MAX_STREAM_TOOL_NAME_LENGTH = 64;

export interface ValidatedToolCall {
  readonly callId: string;
  readonly originalName: string;
  readonly zaiName: string;
  readonly input: Record<string, unknown>;
  readonly rawArguments: string;
}

interface AccumulatedToolCallState {
  id?: string;
  name?: string;
  argumentsFragments: string[];
  argumentsBytes: number;
}

export class ToolCallAccumulator {
  private readonly _calls = new Map<number, AccumulatedToolCallState>();
  private _totalArgumentsBytes = 0;

  public feedDeltaToolCall(choiceIndex: number, deltaCall: ZaiDeltaToolCall): void {
    if (choiceIndex !== 0) {
      throw new Error(`Multiple choices encountered (choice.index: ${choiceIndex}). MVP strictly supports only choice 0.`);
    }

    const index = deltaCall.index;
    let state = this._calls.get(index);
    if (!state) {
      state = {
        argumentsFragments: [],
        argumentsBytes: 0,
      };
      this._calls.set(index, state);
    }

    // Process ID
    if (deltaCall.id) {
      if (state.id && state.id !== deltaCall.id) {
        throw new Error(
          `Conflicting tool call ID in stream for tool index ${index}: existing '${state.id}', received '${deltaCall.id}'.`
        );
      }
      state.id = deltaCall.id;
    }

    // Process Name
    if (deltaCall.function?.name) {
      const incomingName = deltaCall.function.name;
      if (!state.name) {
        if (incomingName.length > MAX_STREAM_TOOL_NAME_LENGTH) {
          throw new Error(
            `Tool function name at index ${index} exceeds maximum length of ${MAX_STREAM_TOOL_NAME_LENGTH} characters.`
          );
        }
        state.name = incomingName;
      } else if (state.name === incomingName) {
        // Stream repeated the full name; idempotent, do not double-append
      } else if (incomingName.startsWith(state.name)) {
        // Stream repeated prefix with full name
        if (incomingName.length > MAX_STREAM_TOOL_NAME_LENGTH) {
          throw new Error(
            `Tool function name at index ${index} exceeds maximum length of ${MAX_STREAM_TOOL_NAME_LENGTH} characters.`
          );
        }
        state.name = incomingName;
      } else {
        throw new Error(
          `Conflicting or oversized tool function name in stream for tool index ${index}: existing '${state.name}', received '${incomingName}'.`
        );
      }
    }

    // Process Arguments
    if (deltaCall.function?.arguments) {
      const fragment = deltaCall.function.arguments;
      const fragmentBytes = Buffer.byteLength(fragment, 'utf8');

      state.argumentsBytes += fragmentBytes;
      this._totalArgumentsBytes += fragmentBytes;

      if (state.argumentsBytes > MAX_SINGLE_TOOL_ARGUMENTS_BYTES) {
        throw new Error(
          `Tool call argument size limit exceeded for tool index ${index} (${state.argumentsBytes} bytes > ${MAX_SINGLE_TOOL_ARGUMENTS_BYTES} bytes).`
        );
      }

      if (this._totalArgumentsBytes > MAX_TOTAL_TOOL_ARGUMENTS_BYTES) {
        throw new Error(
          `Total tool calls arguments limit exceeded across response (${this._totalArgumentsBytes} bytes > ${MAX_TOTAL_TOOL_ARGUMENTS_BYTES} bytes).`
        );
      }

      state.argumentsFragments.push(fragment);
    }
  }

  public hasToolCalls(): boolean {
    return this._calls.size > 0;
  }

  /**
   * Validates the entire batch of accumulated tool calls.
   * If any tool call fails validation (JSON syntax, unknown name, truncated finish reason),
   * throws an error before publishing any tool call to VS Code.
   */
  public validateAndComplete(
    nameMapper: ToolNameMapper,
    allowedHostToolNames: ReadonlySet<string>,
    finishReason: string | null | undefined
  ): ValidatedToolCall[] {
    if (this._calls.size === 0) {
      return [];
    }

    // Check finish reason: truncation or content filtering forbids executing tool calls
    if (finishReason === 'length') {
      throw new Error(
        'Tool calls batch rejected: Generation stopped due to token limit truncation (finish_reason: length).'
      );
    }
    if (finishReason === 'sensitive' || finishReason === 'content_filter') {
      throw new Error(
        `Tool calls batch rejected: Generation blocked by safety filter (finish_reason: ${finishReason}).`
      );
    }

    const sortedIndices = Array.from(this._calls.keys()).sort((a, b) => a - b);
    const validated: ValidatedToolCall[] = [];
    const seenCallIds = new Set<string>();

    for (const idx of sortedIndices) {
      const state = this._calls.get(idx)!;

      if (!state.id || state.id.trim().length === 0) {
        throw new Error(`Tool call at index ${idx} is missing a valid callId.`);
      }

      if (seenCallIds.has(state.id)) {
        throw new Error(`Duplicate tool call ID '${state.id}' encountered at index ${idx}.`);
      }
      seenCallIds.add(state.id);

      if (!state.name || state.name.trim().length === 0) {
        throw new Error(`Tool call at index ${idx} (id: ${state.id}) is missing a function name.`);
      }

      const originalName = nameMapper.mapToOriginal(state.name);

      if (!allowedHostToolNames.has(originalName)) {
        throw new Error(
          `Tool call specifies unrecognized or forbidden tool '${originalName}' (zaiName: '${state.name}').`
        );
      }

      const rawArguments = state.argumentsFragments.join('');
      let parsedInput: unknown;

      if (!rawArguments.trim()) {
        parsedInput = {};
      } else {
        try {
          parsedInput = JSON.parse(rawArguments);
        } catch (err: any) {
          throw new Error(
            `Malformed JSON arguments in tool call '${originalName}' (id: ${state.id}): ${err?.message}`
          );
        }
      }

      if (typeof parsedInput !== 'object' || parsedInput === null || Array.isArray(parsedInput)) {
        throw new Error(
          `Tool call '${originalName}' (id: ${state.id}) arguments must be a JSON object, but received ${Array.isArray(parsedInput) ? 'array' : typeof parsedInput}.`
        );
      }

      validated.push({
        callId: state.id,
        originalName,
        zaiName: state.name,
        input: parsedInput as Record<string, unknown>,
        rawArguments,
      });
    }

    return validated;
  }
}
