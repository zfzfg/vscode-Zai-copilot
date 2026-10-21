import { EndpointProfile, buildCompletionsUrl, isAllowedUrl } from '../config/endpointProfiles.js';
import {
  AuthenticationError,
  ConcurrencyLimitExceededError,
  ModelNotFoundError,
  PermissionDeniedError,
  ProviderServerError,
  RateLimitError,
  ZaiError,
} from './errors.js';

export const MAX_CONCURRENT_REQUESTS = 3;
export const MAX_ERROR_BODY_BYTES = 64 * 1024; // 64 KiB

export interface RequestStreamParams {
  readonly profile: EndpointProfile;
  readonly apiKey: string;
  readonly serializedPayload: string;
  readonly abortSignal: AbortSignal;
  readonly testUrlOverride?: string;
  readonly modelId?: string;
}

export class HttpClient {
  private _activeRequests = 0;

  public get activeRequests(): number {
    return this._activeRequests;
  }

  public async postChatStream(params: RequestStreamParams): Promise<ReadableStream<Uint8Array>> {
    if (this._activeRequests >= MAX_CONCURRENT_REQUESTS) {
      throw new ConcurrencyLimitExceededError(MAX_CONCURRENT_REQUESTS);
    }

    const url = params.testUrlOverride ?? buildCompletionsUrl(params.profile);

    // Security check: ensure URL is allowlisted (or a localhost test URL if testUrlOverride is set)
    if (!params.testUrlOverride && !isAllowedUrl(url)) {
      throw new Error(`Forbidden endpoint URL: ${url} is not in the Z.ai endpoint allowlist.`);
    }

    this._activeRequests++;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Accept-Language': 'en-US,en',
        },
        body: params.serializedPayload,
        redirect: 'error',
        signal: params.abortSignal,
      });

      if (!response.ok) {
        await this.handleHttpError(response, params.profile, params.modelId ?? 'unknown');
      }

      if (!response.body) {
        throw new ZaiError('Response body is empty from Z.ai streaming endpoint.', 'EMPTY_RESPONSE_BODY', response.status);
      }

      return response.body as ReadableStream<Uint8Array>;
    } catch (err: any) {
      if (err instanceof ZaiError) {
        throw err;
      }
      if (err.name === 'AbortError' || params.abortSignal.aborted) {
        throw err;
      }
      // Wrap network or TLS failure safely without leaking sensitive information
      throw new ZaiError(
        `Network transport failure: ${err?.message ?? 'Failed to connect to Z.ai API'}`,
        'NETWORK_FAILURE',
        undefined,
        'Please check your internet connection, proxy settings, or firewall.'
      );
    } finally {
      this._activeRequests = Math.max(0, this._activeRequests - 1);
    }
  }

  private async handleHttpError(response: Response, profile: EndpointProfile, modelId: string): Promise<never> {
    const status = response.status;
    let errorDetail = '';
    let errorCode = '';

    try {
      // Read at most MAX_ERROR_BODY_BYTES to prevent memory bloat on large HTML error pages
      const reader = response.body?.getReader();
      if (reader) {
        let bytesRead = 0;
        const chunks: Uint8Array[] = [];
        while (bytesRead < MAX_ERROR_BODY_BYTES) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
          bytesRead += value.byteLength;
        }
        await reader.cancel();
        const total = Buffer.concat(chunks);
        const text = total.toString('utf8');

        // Try JSON parsing
        try {
          const json = JSON.parse(text);
          if (json?.error) {
            errorDetail = json.error.message ?? JSON.stringify(json.error);
            errorCode = String(json.error.code ?? '');
          } else {
            errorDetail = text.substring(0, 500);
          }
        } catch {
          errorDetail = text.substring(0, 500);
        }
      }
    } catch {
      // Ignore reader failure
    }

    const codeSuffix = errorCode ? ` [${errorCode}]` : '';
    const message = errorDetail ? `Z.ai API error (${status})${codeSuffix}: ${errorDetail}` : `Z.ai API returned HTTP ${status}.`;

    switch (status) {
      case 400:
        throw new ZaiError(message, 'BAD_REQUEST', 400, 'Please verify your model parameters and conversation history.');
      case 401:
        throw new AuthenticationError(message);
      case 403:
        throw new PermissionDeniedError(message);
      case 404:
        throw new ModelNotFoundError(modelId, profile);
      case 429: {
        const retryAfter = response.headers.get('Retry-After') ?? undefined;
        throw new RateLimitError(message, retryAfter);
      }
      default:
        if (status >= 500) {
          throw new ProviderServerError(status, message);
        }
        throw new ZaiError(message, `HTTP_${status}`, status);
    }
  }
}
