import * as crypto from 'crypto';
import { EndpointProfile } from '../config/endpointProfiles.js';
import { ReplayMatchingError } from '../transport/errors.js';
import { ReplayRecord, ReplayStore } from './replayStore.js';
import { ZaiMessage } from '../protocol/types.js';

export class HistoryMatcher {
  private readonly _hostNamespace: string;

  constructor(hostNamespace?: string) {
    this._hostNamespace = hostNamespace ?? crypto.randomBytes(16).toString('hex');
  }

  public get hostNamespace(): string {
    return this._hostNamespace;
  }

  /**
   * Computes a canonical, tamper-evident fingerprint of a conversation sequence.
   * Salted by the extension host instance namespace to prevent cross-session collisions.
   */
  public computeFingerprint(messages: readonly ZaiMessage[]): string {
    const hash = crypto.createHash('sha256');
    hash.update(`ns:${this._hostNamespace}\n`);

    for (const msg of messages) {
      hash.update(`role:${msg.role}|name:${msg.name ?? ''}|content:${msg.content ?? ''}\n`);
      if (msg.tool_call_id) {
        hash.update(`tool_call_id:${msg.tool_call_id}\n`);
      }
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          hash.update(`tc_id:${tc.id}|name:${tc.function.name}|args:${tc.function.arguments}\n`);
        }
      }
    }

    return hash.digest('hex');
  }

  /**
   * Attempts to strictly match a preceding assistant turn's reasoning record from the ReplayStore.
   */
  public matchReplayRecord(
    store: ReplayStore,
    params: {
      readonly modelId: string;
      readonly endpointProfile: EndpointProfile;
      readonly credentialGeneration: number;
      readonly configGeneration: number;
      readonly inputHistoryFingerprint: string;
      readonly expectedCallIds?: readonly string[];
    }
  ): ReplayRecord | undefined {
    const candidates: ReplayRecord[] = [];

    for (const record of store.getAll()) {
      if (record.status !== 'completed') {
        continue;
      }

      // Check generations & environment isolation
      if (
        record.modelId !== params.modelId ||
        record.endpointProfile !== params.endpointProfile ||
        record.credentialGeneration !== params.credentialGeneration ||
        record.configGeneration !== params.configGeneration
      ) {
        continue;
      }

      // Check input history fingerprint match
      if (record.inputHistoryFingerprint !== params.inputHistoryFingerprint) {
        continue;
      }

      // If matching tool continuation, verify callIds
      if (params.expectedCallIds && params.expectedCallIds.length > 0) {
        if (record.callIds.length !== params.expectedCallIds.length) {
          continue;
        }
        const setA = new Set(record.callIds);
        const matchesAll = params.expectedCallIds.every((id) => setA.has(id));
        if (!matchesAll) {
          continue;
        }
      }

      candidates.push(record);
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    if (candidates.length > 1) {
      throw new ReplayMatchingError(
        `Ambiguous reasoning replay candidates: found ${candidates.length} matching conversation paths. Aborting reasoning replay to prevent cross-chat leakage.`
      );
    }

    // Fallback: If host compacted or reformatted earlier history during multi-step tool calls,
    // match directly by unique expectedCallIds for the same endpoint profile.
    if (params.expectedCallIds && params.expectedCallIds.length > 0) {
      const callIdCandidates: ReplayRecord[] = [];
      const expectedSet = new Set(params.expectedCallIds);

      for (const record of store.getAll()) {
        if (
          record.status !== 'completed' ||
          record.endpointProfile !== params.endpointProfile
        ) {
          continue;
        }

        if (
          record.callIds.length === params.expectedCallIds.length &&
          record.callIds.every((id) => expectedSet.has(id))
        ) {
          callIdCandidates.push(record);
        }
      }

      if (callIdCandidates.length > 0) {
        // If multiple records matched the callIds, select the most recent one
        callIdCandidates.sort((a, b) => b.timestamp - a.timestamp);
        return callIdCandidates[0];
      }
    }

    return undefined;
  }
}
