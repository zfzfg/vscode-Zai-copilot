import * as vscode from 'vscode';
import { EndpointProfile, buildCompletionsUrl, isAllowedUrl } from '../config/endpointProfiles.js';
import { Logger } from '../diagnostics/logger.js';
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
export const MAX_QUEUE_SIZE = 10;
export const MAX_ERROR_BODY_BYTES = 64 * 1024; // 64 KiB

export interface RequestStreamParams {
  readonly profile: EndpointProfile;
  readonly apiKey: string;
  readonly serializedPayload: string;
  readonly abortSignal: AbortSignal;
  readonly testUrlOverride?: string;
  readonly modelId?: string;
}

interface QueuedRequest {
  resolve: () => void;
  reject: (err: any) => void;
  abortSignal: AbortSignal;
  cleanup: () => void;
}

export class HttpClient {
  private _activeRequests = 0;
  private readonly _queue: QueuedRequest[] = [];

  public get activeRequests(): number {
    return this._activeRequests;
  }

  public get queueLength(): number {
    return this._queue.length;
  }

  private acquireSlot(abortSignal: AbortSignal): Promise<void> {
    if (abortSignal.aborted) {
      return Promise.reject(new vscode.CancellationError());
    }

    if (this._activeRequests < MAX_CONCURRENT_REQUESTS && this._queue.length === 0) {
      this._activeRequests++;
      return Promise.resolve();
    }

    if (this._queue.length >= MAX_QUEUE_SIZE) {
      return Promise.reject(new ConcurrencyLimitExceededError(MAX_CONCURRENT_REQUESTS));
    }

    return new Promise<void>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const cleanup = () => {
        if (onAbort) {
          abortSignal.removeEventListener('abort', onAbort);
          onAbort = undefined;
        }
      };

      onAbort = () => {
        cleanup();
        const idx = this._queue.findIndex((entry) => entry.cleanup === cleanup);
        if (idx !== -1) {
          this._queue.splice(idx, 1);
        }
        reject(new vscode.CancellationError());
      };

      abortSignal.addEventListener('abort', onAbort, { once: true });

      this._queue.push({
        resolve: () => {
          cleanup();
          this._activeRequests++;
          resolve();
        },
        reject: (err) => {
          cleanup();
          reject(err);
        },
        abortSignal,
        cleanup,
      });
    });
  }

  private releaseSlot(): void {
    this._activeRequests = Math.max(0, this._activeRequests - 1);
    while (this._activeRequests < MAX_CONCURRENT_REQUESTS && this._queue.length > 0) {
      const next = this._queue.shift()!;
      if (next.abortSignal.aborted) {
        next.reject(new vscode.CancellationError());
        continue;
      }
      next.resolve();
      break;
    }
  }

  public async postChatStream(params: RequestStreamParams): Promise<ReadableStream<Uint8Array>> {
    await this.acquireSlot(params.abortSignal);

    let slotTransferredToStream = false;
    try {
      const url = params.testUrlOverride ?? buildCompletionsUrl(params.profile);

      // Security check: ensure URL is allowlisted (or a localhost test URL if testUrlOverride is set)
      if (!params.testUrlOverride && !isAllowedUrl(url)) {
        throw new Error(`Forbidden endpoint URL: ${url} is not in the Z.ai endpoint allowlist.`);
      }

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

      let slotReleased = false;
      const release = () => {
        if (!slotReleased) {
          slotReleased = true;
          this.releaseSlot();
        }
      };

      const originalBody = response.body as ReadableStream<Uint8Array>;
      const reader = originalBody.getReader();

      const wrappedStream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              release();
            } else {
              controller.enqueue(value);
            }
          } catch (err) {
            controller.error(err);
            release();
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            release();
          }
        },
      });

      params.abortSignal.addEventListener('abort', () => release(), { once: true });

      slotTransferredToStream = true;
      return wrappedStream;
    } catch (err: any) {
      if (!slotTransferredToStream) {
        this.releaseSlot();
      }
      if (err instanceof vscode.CancellationError) {
        throw err;
      }
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

    if (errorDetail) {
      errorDetail = Logger.redact(errorDetail);
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
