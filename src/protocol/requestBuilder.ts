import { ModelDescriptor } from '../provider/modelCatalog.js';
import { ConfigurationSnapshot } from '../config/configuration.js';
import { ZaiChatCompletionRequest, ZaiMessage, ZaiThinkingConfig, ZaiTool } from './types.js';

export const MAX_REQUEST_PAYLOAD_BYTES = 16 * 1024 * 1024; // 16 MiB

export interface RequestBuilderParams {
  readonly model: ModelDescriptor;
  readonly messages: readonly ZaiMessage[];
  readonly tools?: readonly ZaiTool[];
  readonly tool_choice?: 'auto';
  readonly config: ConfigurationSnapshot;
  readonly clearThinkingOverride?: boolean;
}

export interface BuildResult {
  readonly request: ZaiChatCompletionRequest;
  readonly serialized: string;
  readonly byteLength: number;
}

export function buildChatCompletionRequest(params: RequestBuilderParams): BuildResult {
  const { model, messages, tools, tool_choice, config, clearThinkingOverride } = params;

  let thinking: ZaiThinkingConfig | undefined;
  let reasoningEffort: 'low' | 'high' | 'max' | undefined;

  if (!model.supportsThinkingDisable) {
    // 5.3 series: thinking is forced, cannot be disabled
    const clearThinking =
      clearThinkingOverride !== undefined
        ? clearThinkingOverride
        : config.preservedThinking !== 'experimental-strict';

    thinking = {
      type: 'enabled',
      clear_thinking: clearThinking,
    };
    reasoningEffort = config.reasoningEffort;
  } else {
    // Optional / legacy thinking models (e.g. GLM-5.2)
    thinking = undefined;
    reasoningEffort = undefined;
  }

  const maxTokens = Math.min(model.providerMaxOutputTokens, config.maxOutputTokens);

  const request: ZaiChatCompletionRequest = {
    model: model.apiModelId,
    messages,
    stream: true,
    ...(tools && tools.length > 0 ? { tools, tool_choice } : {}),
    max_tokens: maxTokens,
    ...(thinking ? { thinking } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };

  const serialized = JSON.stringify(request);
  const byteLength = Buffer.byteLength(serialized, 'utf8');

  if (byteLength > MAX_REQUEST_PAYLOAD_BYTES) {
    throw new Error(
      `Request payload size (${byteLength} bytes) exceeds maximum allowable limit (${MAX_REQUEST_PAYLOAD_BYTES} bytes).`
    );
  }

  return {
    request,
    serialized,
    byteLength,
  };
}
