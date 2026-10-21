export class ZaiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly userAdvice?: string
  ) {
    const formattedMessage =
      userAdvice && !message.includes(userAdvice)
        ? `${message} — ${userAdvice}`
        : message;
    super(formattedMessage);
    this.name = 'ZaiError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnconfiguredProviderError extends ZaiError {
  constructor(message = 'Z.ai Copilot provider is unconfigured. Please configure an endpoint profile and API key.') {
    super(message, 'UNCONFIGURED_PROVIDER', undefined, 'Run command "Z.ai: Manage Provider Profile and API Keys" to set up your provider.');
  }
}

export class AuthenticationError extends ZaiError {
  constructor(message = 'Z.ai API authentication failed (HTTP 401).', userAdvice?: string) {
    super(
      message,
      'AUTHENTICATION_FAILED',
      401,
      userAdvice ?? 'Verify that your API key is valid for the selected profile using "Z.ai: Manage Provider Profile and API Keys".'
    );
  }
}

export class PermissionDeniedError extends ZaiError {
  constructor(message = 'Access forbidden for this model or endpoint (HTTP 403).', userAdvice?: string) {
    super(
      message,
      'PERMISSION_DENIED',
      403,
      userAdvice ?? 'Check if your Z.ai plan supports this model. Note that FlashX is not available on Coding Plan subscriptions.'
    );
  }
}

export class ModelNotFoundError extends ZaiError {
  constructor(modelId: string, profile: string) {
    super(
      `Model '${modelId}' not found on endpoint profile '${profile}' (HTTP 404).`,
      'MODEL_NOT_FOUND',
      404,
      'Ensure the model ID exists on this endpoint profile.'
    );
  }
}

export class RateLimitError extends ZaiError {
  constructor(message = 'Z.ai API rate limit or quota exceeded (HTTP 429).', retryAfter?: string) {
    const advice = retryAfter ? `Rate limit exceeded. Please retry after ${retryAfter} seconds.` : 'Please wait before sending new requests or check your quota balance.';
    super(message, 'RATE_LIMIT_EXCEEDED', 429, advice);
  }
}

export class ProviderServerError extends ZaiError {
  constructor(status: number, message = `Z.ai server encountered an error (HTTP ${status}).`) {
    super(message, 'PROVIDER_SERVER_ERROR', status, 'The upstream Z.ai service is temporarily unavailable. Please retry later.');
  }
}

export class RequestTimeoutError extends ZaiError {
  constructor(public readonly timeoutType: 'firstEvent' | 'idle' | 'total', timeoutMs: number) {
    let msg = '';
    let advice = '';
    switch (timeoutType) {
      case 'firstEvent':
        msg = `Timeout waiting for initial model response event (${timeoutMs}ms).`;
        advice = 'The model took too long to produce initial reasoning or output. Try setting reasoningEffort to "low" or increasing timeouts in Settings.';
        break;
      case 'idle':
        msg = `Timeout: Stream remained inactive for longer than allowable limit (${timeoutMs}ms).`;
        advice = 'Network or provider streaming was interrupted. Please retry.';
        break;
      case 'total':
        msg = `Total request execution deadline exceeded (${timeoutMs}ms).`;
        advice = 'The request exceeded the maximum allowed run time. You can increase zai.timeouts.totalMs in Settings.';
        break;
    }
    super(msg, `TIMEOUT_${timeoutType.toUpperCase()}`, undefined, advice);
  }
}

export class ConcurrencyLimitExceededError extends ZaiError {
  constructor(limit: number) {
    super(
      `Concurrent request limit exceeded: maximum ${limit} active requests allowed.`,
      'CONCURRENCY_LIMIT_EXCEEDED',
      undefined,
      'Please wait for pending chat requests to finish before starting new requests.'
    );
  }
}

export class PreflightBudgetExceededError extends ZaiError {
  constructor(estimatedTokens: number, maxAllowed: number) {
    super(
      `Preflight context budget exceeded: request requires ~${estimatedTokens} tokens, but maximum budget is ${maxAllowed}.`,
      'BUDGET_EXCEEDED',
      undefined,
      'Please reduce conversation history or start a new chat turn.'
    );
  }
}

export class ReplayMatchingError extends ZaiError {
  constructor(message: string, advice = 'Start a fresh conversation turn or prompt the model again.') {
    super(message, 'REPLAY_MATCHING_FAILED', undefined, advice);
  }
}
