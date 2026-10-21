export type ZaiRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ZaiFunctionCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface ZaiMessage {
  readonly role: ZaiRole;
  readonly content: string | null;
  readonly name?: string;
  readonly tool_calls?: readonly ZaiFunctionCall[];
  readonly tool_call_id?: string;
  readonly reasoning_content?: string;
}

export interface ZaiTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface ZaiThinkingConfig {
  readonly type: 'enabled' | 'disabled';
  readonly clear_thinking?: boolean;
}

export interface ZaiChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly ZaiMessage[];
  readonly stream: boolean;
  readonly tools?: readonly ZaiTool[];
  readonly tool_choice?: 'auto';
  readonly max_tokens?: number;
  readonly thinking?: ZaiThinkingConfig;
  readonly reasoning_effort?: 'low' | 'high' | 'max';
}

export interface ZaiDeltaToolCall {
  readonly index: number;
  readonly id?: string;
  readonly type?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}

export interface ZaiStreamDelta {
  readonly role?: string;
  readonly content?: string | null;
  readonly reasoning_content?: string | null;
  readonly reasoning?: string | null;
  readonly tool_calls?: readonly ZaiDeltaToolCall[];
}

export interface ZaiStreamChoice {
  readonly index: number;
  readonly delta: ZaiStreamDelta;
  readonly finish_reason?: string | null;
}

export interface ZaiStreamUsage {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
}

export interface ZaiStreamChunk {
  readonly id?: string;
  readonly model?: string;
  readonly choices?: readonly ZaiStreamChoice[];
  readonly usage?: ZaiStreamUsage;
  readonly error?: {
    readonly message: string;
    readonly code?: string | number;
  };
}
