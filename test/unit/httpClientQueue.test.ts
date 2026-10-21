import { describe, it, expect, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { HttpClient, MAX_CONCURRENT_REQUESTS, MAX_QUEUE_SIZE } from '../../src/transport/httpClient.js';
import { ConcurrencyLimitExceededError } from '../../src/transport/errors.js';

describe('HttpClient Queueing, Concurrency & Cancellation', () => {
  let client: HttpClient;

  beforeEach(() => {
    client = new HttpClient();
  });

  it('allows up to 3 concurrent requests without queueing', async () => {
    expect(client.activeRequests).toBe(0);
    expect(client.queueLength).toBe(0);

    // Acquire 3 slots manually through internal mechanism
    const abort1 = new AbortController();
    const abort2 = new AbortController();
    const abort3 = new AbortController();

    await (client as any).acquireSlot(abort1.signal);
    await (client as any).acquireSlot(abort2.signal);
    await (client as any).acquireSlot(abort3.signal);

    expect(client.activeRequests).toBe(3);
    expect(client.queueLength).toBe(0);

    // Release slots
    (client as any).releaseSlot();
    (client as any).releaseSlot();
    (client as any).releaseSlot();

    expect(client.activeRequests).toBe(0);
  });

  it('queues 4th request in FIFO queue when 3 requests are active and resumes it upon release', async () => {
    const abort1 = new AbortController();
    const abort2 = new AbortController();
    const abort3 = new AbortController();
    const abort4 = new AbortController();

    await (client as any).acquireSlot(abort1.signal);
    await (client as any).acquireSlot(abort2.signal);
    await (client as any).acquireSlot(abort3.signal);

    expect(client.activeRequests).toBe(3);

    let request4Resolved = false;
    const p4 = (client as any).acquireSlot(abort4.signal).then(() => {
      request4Resolved = true;
    });

    // Request 4 should be queued
    expect(client.activeRequests).toBe(3);
    expect(client.queueLength).toBe(1);
    expect(request4Resolved).toBe(false);

    // Now release one active slot
    (client as any).releaseSlot();

    await p4;
    expect(request4Resolved).toBe(true);
    expect(client.activeRequests).toBe(3);
    expect(client.queueLength).toBe(0);

    // Clean up
    (client as any).releaseSlot();
    (client as any).releaseSlot();
    (client as any).releaseSlot();
    expect(client.activeRequests).toBe(0);
  });

  it('cancels queued request with CancellationError if abortSignal fires while waiting', async () => {
    const abort1 = new AbortController();
    const abort2 = new AbortController();
    const abort3 = new AbortController();
    const abort4 = new AbortController();

    await (client as any).acquireSlot(abort1.signal);
    await (client as any).acquireSlot(abort2.signal);
    await (client as any).acquireSlot(abort3.signal);

    const p4 = (client as any).acquireSlot(abort4.signal);
    expect(client.queueLength).toBe(1);

    // Abort request 4 while queued
    abort4.abort();

    await expect(p4).rejects.toThrow(vscode.CancellationError);
    expect(client.queueLength).toBe(0);
    expect(client.activeRequests).toBe(3);

    // Clean up
    (client as any).releaseSlot();
    (client as any).releaseSlot();
    (client as any).releaseSlot();
  });

  it('rejects immediately with CancellationError if abortSignal is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();

    await expect((client as any).acquireSlot(abort.signal)).rejects.toThrow(vscode.CancellationError);
    expect(client.activeRequests).toBe(0);
    expect(client.queueLength).toBe(0);
  });

  it('throws ConcurrencyLimitExceededError when queue capacity (10) is exceeded', async () => {
    // Fill 3 active requests
    const aborters: AbortController[] = [];
    for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) {
      const a = new AbortController();
      aborters.push(a);
      await (client as any).acquireSlot(a.signal);
    }
    expect(client.activeRequests).toBe(3);

    // Queue 10 requests (up to MAX_QUEUE_SIZE)
    const queuePromises: Promise<void>[] = [];
    for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
      const a = new AbortController();
      aborters.push(a);
      const p = (client as any).acquireSlot(a.signal);
      p.catch(() => {}); // prevent unhandled rejection during cleanup
      queuePromises.push(p);
    }
    expect(client.queueLength).toBe(10);

    // 11th queued request must immediately throw ConcurrencyLimitExceededError
    const extraAbort = new AbortController();
    await expect((client as any).acquireSlot(extraAbort.signal)).rejects.toThrow(
      ConcurrencyLimitExceededError
    );

    // Clean up
    for (const a of aborters) {
      a.abort();
    }
    for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) {
      (client as any).releaseSlot();
    }
  });

  it('redacts error detail in handleHttpError avoiding prompt echo and key leakage', async () => {
    // Create mock error response with prompt fragment and file path in JSON
    const errorBody = JSON.stringify({
      error: {
        message: 'Invalid prompt near file C:\\Users\\secret_user\\code.ts with key=secret1234567890',
        code: 'invalid_prompt',
      },
    });

    const mockResponse = new Response(errorBody, {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(
      (client as any).handleHttpError(mockResponse, 'standard', 'glm-5.3')
    ).rejects.toThrowError(
      /Z\.ai API error \(400\) \[invalid_prompt\]: Invalid prompt near file \[REDACTED_PATH\] with key=\[REDACTED\]/
    );
  });
});
