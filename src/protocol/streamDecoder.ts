import { ZaiStreamChunk } from './types.js';

export const MAX_SSE_EVENT_BYTES = 4 * 1024 * 1024; // 4 MiB

export type SseEvent =
  | { readonly type: 'chunk'; readonly chunk: ZaiStreamChunk }
  | { readonly type: 'done' }
  | { readonly type: 'heartbeat'; readonly comment: string };

export class SseStreamDecoder {
  private readonly _textDecoder = new TextDecoder('utf-8', { fatal: false });
  private _buffer = '';
  private _currentDataLines: string[] = [];
  private _eventBytes = 0;
  private _isDone = false;
  private _eventCount = 0;
  private _totalBytes = 0;

  public get isDone(): boolean {
    return this._isDone;
  }

  public get eventCount(): number {
    return this._eventCount;
  }

  public get totalBytes(): number {
    return this._totalBytes;
  }

  /**
   * Feed a raw network byte chunk into the decoder.
   * Returns all fully-formed SSE events found in the chunk.
   */
  public feedChunk(chunk: Uint8Array): SseEvent[] {
    this._totalBytes += chunk.byteLength;
    const text = this._textDecoder.decode(chunk, { stream: true });
    this._buffer += text;

    return this.processBuffer(false);
  }

  /**
   * Finalize the stream. Decodes any remaining stream buffer.
   */
  public end(): SseEvent[] {
    const remainingText = this._textDecoder.decode(new Uint8Array(), { stream: false });
    this._buffer += remainingText;

    const events = this.processBuffer(true);

    // If there is any trailing buffer that didn't have a newline delimiter at all
    if (this._buffer.length > 0) {
      const line = this._buffer;
      this._buffer = '';
      const parsedEvent = this.processLine(line);
      if (parsedEvent) {
        events.push(parsedEvent);
      }
    }

    // If there is any uncommitted event data remaining when stream closes
    if (this._currentDataLines.length > 0) {
      const dispatched = this.dispatchEvent();
      if (dispatched) {
        events.push(dispatched);
      }
    }

    return events;
  }

  private processBuffer(isFinal = false): SseEvent[] {
    const events: SseEvent[] = [];

    while (true) {
      // Find newline: \r\n or \n or \r
      const nlMatch = this._buffer.match(/\r\n|\r|\n/);
      if (!nlMatch || nlMatch.index === undefined) {
        break;
      }

      const lineEndIndex = nlMatch.index;
      const delimiterLength = nlMatch[0].length;

      // If line ends with \r at the very end of current buffer, wait for potential \n in next chunk unless this is the final stream buffer
      if (!isFinal && nlMatch[0] === '\r' && lineEndIndex + 1 === this._buffer.length) {
        break;
      }

      const line = this._buffer.substring(0, lineEndIndex);
      this._buffer = this._buffer.substring(lineEndIndex + delimiterLength);

      const parsedEvent = this.processLine(line);
      if (parsedEvent) {
        events.push(parsedEvent);
      }
    }

    return events;
  }

  private processLine(line: string): SseEvent | null {
    // SSE Comment or Heartbeat: starts with ':'
    if (line.startsWith(':')) {
      const comment = line.substring(1).trim();
      return { type: 'heartbeat', comment };
    }

    // Empty line indicates event boundary in SSE
    if (line.length === 0) {
      if (this._currentDataLines.length > 0) {
        return this.dispatchEvent();
      }
      return null;
    }

    if (line.startsWith('data:')) {
      // Strip leading 'data:' and optional single space
      let content = line.substring(5);
      if (content.startsWith(' ')) {
        content = content.substring(1);
      }

      const lineBytes = Buffer.byteLength(content, 'utf8');
      this._eventBytes += lineBytes;

      if (this._eventBytes > MAX_SSE_EVENT_BYTES) {
        throw new Error(
          `SSE Event size limit exceeded: single event exceeds ${MAX_SSE_EVENT_BYTES} bytes.`
        );
      }

      this._currentDataLines.push(content);
    }

    // Other SSE fields (event, id, retry) can be ignored for OpenAI/Z.ai chat completions
    return null;
  }

  private dispatchEvent(): SseEvent | null {
    const rawData = this._currentDataLines.join('\n');
    this._currentDataLines = [];
    this._eventBytes = 0;

    const trimmed = rawData.trim();
    if (!trimmed) {
      return null;
    }

    this._eventCount++;

    if (trimmed === '[DONE]') {
      this._isDone = true;
      return { type: 'done' };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err: any) {
      throw new Error(`Invalid SSE JSON payload received from Z.ai: ${err?.message ?? String(err)}`);
    }

    if (parsed && typeof parsed === 'object') {
      if (parsed.error) {
        const errorMsg =
          typeof parsed.error === 'object' && parsed.error.message
            ? parsed.error.message
            : JSON.stringify(parsed.error);
        const errorCode = parsed.error.code ?? 'PROVIDER_ERROR';
        throw new Error(`Z.ai API returned error in stream: [${errorCode}] ${errorMsg}`);
      }

      return {
        type: 'chunk',
        chunk: parsed as ZaiStreamChunk,
      };
    }

    return null;
  }
}
