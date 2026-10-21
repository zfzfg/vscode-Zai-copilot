import { describe, it, expect } from 'vitest';
import { SseStreamDecoder, MAX_SSE_EVENT_BYTES } from '../../src/protocol/streamDecoder.js';

describe('SseStreamDecoder', () => {
  it('parses standard SSE chunks with content and reasoning', () => {
    const rawSse =
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n' +
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":" World"}}]}\n\n' +
      'data: [DONE]\n\n';

    const decoder = new SseStreamDecoder();
    const events = decoder.feedChunk(Buffer.from(rawSse, 'utf8'));

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      type: 'chunk',
      chunk: {
        id: '1',
        choices: [{ index: 0, delta: { content: 'Hello' } }],
      },
    });
    expect(events[1]).toEqual({
      type: 'chunk',
      chunk: {
        id: '1',
        choices: [{ index: 0, delta: { content: ' World' } }],
      },
    });
    expect(events[2]).toEqual({ type: 'done' });
    expect(decoder.isDone).toBe(true);
  });

  it('correctly decodes multi-byte UTF-8 characters split across chunk boundaries', () => {
    // Unicode character '🚀' (rocket) is 4 bytes in UTF-8: 0xF0, 0x9F, 0x9A, 0x80
    // German umlauts 'ä' is 2 bytes: 0xC3, 0xA4
    const fullJson = JSON.stringify({
      choices: [{ index: 0, delta: { content: 'Grüße 🚀 Welt' } }],
    });
    const sseText = `data: ${fullJson}\n\ndata: [DONE]\n\n`;
    const sseBytes = Buffer.from(sseText, 'utf8');

    // Feed byte-by-byte (1-byte split test) across the entire stream!
    const decoder = new SseStreamDecoder();
    const collectedEvents: any[] = [];

    for (let i = 0; i < sseBytes.length; i++) {
      const singleByteChunk = new Uint8Array([sseBytes[i]]);
      const evs = decoder.feedChunk(singleByteChunk);
      collectedEvents.push(...evs);
    }
    const finalEvs = decoder.end();
    collectedEvents.push(...finalEvs);

    expect(collectedEvents).toHaveLength(2);
    expect(collectedEvents[0].type).toBe('chunk');
    expect(collectedEvents[0].chunk.choices[0].delta.content).toBe('Grüße 🚀 Welt');
    expect(collectedEvents[1].type).toBe('done');
  });

  it('correctly handles CRLF (\\r\\n) split across chunk boundaries', () => {
    const json1 = '{"choices":[{"index":0,"delta":{"content":"A"}}]}';
    const json2 = '{"choices":[{"index":0,"delta":{"content":"B"}}]}';

    // Chunk 1 ends with \r, Chunk 2 begins with \n
    const chunk1 = Buffer.from(`data: ${json1}\r`, 'utf8');
    const chunk2 = Buffer.from(`\n\r\ndata: ${json2}\r\n\r\n`, 'utf8');

    const decoder = new SseStreamDecoder();
    const ev1 = decoder.feedChunk(chunk1);
    expect(ev1).toHaveLength(0); // Still waiting for \n

    const ev2 = decoder.feedChunk(chunk2) as any[];
    expect(ev2).toHaveLength(2);
    expect(ev2[0].chunk.choices[0].delta.content).toBe('A');
    expect(ev2[1].chunk.choices[0].delta.content).toBe('B');
  });

  it('handles multiple events arriving in a single large chunk', () => {
    let sseText = '';
    for (let i = 0; i < 5; i++) {
      sseText += `data: {"id":"${i}","choices":[{"index":0,"delta":{"content":"#${i}"}}]}\n\n`;
    }
    sseText += 'data: [DONE]\n\n';

    const decoder = new SseStreamDecoder();
    const events = decoder.feedChunk(Buffer.from(sseText, 'utf8')) as any[];

    expect(events).toHaveLength(6);
    expect(events[0].chunk.choices[0].delta.content).toBe('#0');
    expect(events[4].chunk.choices[0].delta.content).toBe('#4');
    expect(events[5].type).toBe('done');
  });

  it('merges multiple consecutive data: lines within one SSE event with newlines', () => {
    const sse =
      'data: {"id":"multi",\n' +
      'data: "choices":[{"index":0,"delta":{"content":"multiline"}}]}\n\n' +
      'data: [DONE]\n\n';

    const decoder = new SseStreamDecoder();
    const events = decoder.feedChunk(Buffer.from(sse, 'utf8')) as any[];

    expect(events).toHaveLength(2);
    expect(events[0].chunk.choices[0].delta.content).toBe('multiline');
  });

  it('dispatches heartbeat comments without breaking event stream', () => {
    const sse =
      ': heartbeat ping\n' +
      'data: {"choices":[{"index":0,"delta":{"content":"alive"}}]}\n\n' +
      ': another comment\n' +
      'data: [DONE]\n\n';

    const decoder = new SseStreamDecoder();
    const events = decoder.feedChunk(Buffer.from(sse, 'utf8')) as any[];

    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({ type: 'heartbeat', comment: 'heartbeat ping' });
    expect(events[1].type).toBe('chunk');
    expect(events[2]).toEqual({ type: 'heartbeat', comment: 'another comment' });
    expect(events[3].type).toBe('done');
  });

  it('processes usage-only event without choices array', () => {
    const sse =
      'data: {"id":"123","usage":{"prompt_tokens":10,"completion_tokens":25,"total_tokens":35}}\n\n' +
      'data: [DONE]\n\n';

    const decoder = new SseStreamDecoder();
    const events = decoder.feedChunk(Buffer.from(sse, 'utf8')) as any[];

    expect(events).toHaveLength(2);
    expect(events[0].chunk.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 25,
      total_tokens: 35,
    });
  });

  it('detects provider error in HTTP 200 stream and throws', () => {
    const sse = 'data: {"error":{"message":"Quota exceeded","code":1301}}\n\n';

    const decoder = new SseStreamDecoder();
    expect(() => decoder.feedChunk(Buffer.from(sse, 'utf8'))).toThrow(
      /Z\.ai API returned error in stream: \[1301\] Quota exceeded/
    );
  });

  it('rejects an individual SSE event exceeding maximum allowable byte limit', () => {
    const hugePadding = 'x'.repeat(MAX_SSE_EVENT_BYTES + 10);
    const sse = `data: ${hugePadding}\n\n`;

    const decoder = new SseStreamDecoder();
    expect(() => decoder.feedChunk(Buffer.from(sse, 'utf8'))).toThrow(
      /SSE Event size limit exceeded/
    );
  });

  it('correctly decodes line terminating in lone CR when stream ends (EOF)', () => {
    const decoder = new SseStreamDecoder();
    // Feed chunk ending in lone \r
    const ev1 = decoder.feedChunk(Buffer.from('data: [DONE]\r', 'utf8'));
    expect(ev1).toHaveLength(0); // Waiting for potential \n

    // Stream ends (EOF) without further chunks
    const ev2 = decoder.end();
    expect(ev2).toHaveLength(1);
    expect(ev2[0]).toEqual({ type: 'done' });
    expect(decoder.isDone).toBe(true);
  });
});
