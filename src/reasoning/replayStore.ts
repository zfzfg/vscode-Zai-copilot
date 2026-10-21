import { EndpointProfile } from '../config/endpointProfiles.js';

export const MAX_REPLAY_CACHE_BYTES = 32 * 1024 * 1024; // 32 MiB
export const MAX_REPLAY_ENTRIES = 100;
export const REPLAY_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ReplayRecord {
  readonly requestId: string;
  readonly modelId: string;
  readonly endpointProfile: EndpointProfile;
  readonly credentialGeneration: number;
  readonly configGeneration: number;
  readonly inputHistoryFingerprint: string;
  readonly assistantText: string | null;
  readonly callIds: readonly string[];
  readonly toolNames: readonly string[];
  readonly rawArguments: readonly string[];
  readonly reasoningContent: string;
  readonly timestamp: number;
  readonly byteSize: number;
  readonly status: 'completed' | 'aborted' | 'pending';
}

export class ReplayStore {
  // Using Map for O(1) key lookup and LRU ordering (oldest keys first)
  private readonly _records = new Map<string, ReplayRecord>();
  private _totalByteSize = 0;

  public get count(): number {
    return this._records.size;
  }

  public get totalBytes(): number {
    return this._totalByteSize;
  }

  public put(record: ReplayRecord): void {
    this.pruneExpired();

    // If an existing entry with same requestId exists, remove it first
    if (this._records.has(record.requestId)) {
      this.remove(record.requestId);
    }

    // Check size limit: reject single record larger than max cache
    if (record.byteSize > MAX_REPLAY_CACHE_BYTES) {
      throw new Error(
        `Replay record size (${record.byteSize} bytes) exceeds total allowable cache capacity (${MAX_REPLAY_CACHE_BYTES} bytes).`
      );
    }

    // Evict oldest until space and entry count constraints are met
    while (
      (this._records.size >= MAX_REPLAY_ENTRIES ||
        this._totalByteSize + record.byteSize > MAX_REPLAY_CACHE_BYTES) &&
      this._records.size > 0
    ) {
      const oldestKey = this._records.keys().next().value;
      if (oldestKey !== undefined) {
        this.remove(oldestKey);
      }
    }

    this._records.set(record.requestId, record);
    this._totalByteSize += record.byteSize;
  }

  public get(requestId: string): ReplayRecord | undefined {
    this.pruneExpired();

    const record = this._records.get(requestId);
    if (!record) {
      return undefined;
    }

    // Move to end (most recently used)
    this._records.delete(requestId);
    this._records.set(requestId, record);

    return record;
  }

  public getAll(): readonly ReplayRecord[] {
    this.pruneExpired();
    return Array.from(this._records.values());
  }

  public remove(requestId: string): void {
    const record = this._records.get(requestId);
    if (record) {
      this._records.delete(requestId);
      this._totalByteSize -= record.byteSize;
    }
  }

  public clear(): void {
    this._records.clear();
    this._totalByteSize = 0;
  }

  public invalidate(predicate: (record: ReplayRecord) => boolean): void {
    for (const [id, record] of this._records.entries()) {
      if (predicate(record)) {
        this.remove(id);
      }
    }
  }

  public pruneExpired(): void {
    const now = Date.now();
    for (const [id, record] of this._records.entries()) {
      if (now - record.timestamp > REPLAY_TTL_MS) {
        this.remove(id);
      }
    }
  }
}
