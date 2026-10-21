import { describe, it, expect } from 'vitest';
import { ReplayStore, ReplayRecord, MAX_REPLAY_ENTRIES } from '../../src/reasoning/replayStore.js';
import { HistoryMatcher } from '../../src/reasoning/historyMatcher.js';

describe('ReplayStore & HistoryMatcher', () => {
  describe('ReplayStore', () => {
    it('stores and retrieves records by requestId', () => {
      const store = new ReplayStore();
      const record: ReplayRecord = {
        requestId: 'req-1',
        modelId: 'glm-5.3',
        endpointProfile: 'standard',
        credentialGeneration: 1,
        configGeneration: 1,
        inputHistoryFingerprint: 'fp-123',
        assistantText: 'Thinking result',
        callIds: ['c1'],
        toolNames: ['search'],
        rawArguments: ['{}'],
        reasoningContent: 'Reasoning step 1',
        timestamp: Date.now(),
        byteSize: 100,
        status: 'completed',
      };

      store.put(record);
      expect(store.count).toBe(1);
      expect(store.totalBytes).toBe(100);

      const retrieved = store.get('req-1');
      expect(retrieved?.reasoningContent).toBe('Reasoning step 1');
    });

    it('enforces MAX_REPLAY_ENTRIES via LRU eviction', () => {
      const store = new ReplayStore();

      for (let i = 0; i < MAX_REPLAY_ENTRIES + 5; i++) {
        store.put({
          requestId: `req-${i}`,
          modelId: 'glm-5.3',
          endpointProfile: 'standard',
          credentialGeneration: 1,
          configGeneration: 1,
          inputHistoryFingerprint: `fp-${i}`,
          assistantText: `text ${i}`,
          callIds: [],
          toolNames: [],
          rawArguments: [],
          reasoningContent: `reasoning ${i}`,
          timestamp: Date.now(),
          byteSize: 10,
          status: 'completed',
        });
      }

      expect(store.count).toBe(MAX_REPLAY_ENTRIES);
      // First 5 entries should have been evicted
      expect(store.get('req-0')).toBeUndefined();
      expect(store.get('req-4')).toBeUndefined();
      // Latest entries must be present
      expect(store.get(`req-${MAX_REPLAY_ENTRIES + 4}`)).toBeDefined();
    });

    it('invalidates records by predicate (e.g. on profile or secret rotation)', () => {
      const store = new ReplayStore();
      store.put({
        requestId: 'req-std',
        modelId: 'glm-5.3',
        endpointProfile: 'standard',
        credentialGeneration: 1,
        configGeneration: 1,
        inputHistoryFingerprint: 'fp1',
        assistantText: null,
        callIds: [],
        toolNames: [],
        rawArguments: [],
        reasoningContent: '...',
        timestamp: Date.now(),
        byteSize: 50,
        status: 'completed',
      });
      store.put({
        requestId: 'req-plan',
        modelId: 'glm-5.3',
        endpointProfile: 'coding-plan',
        credentialGeneration: 1,
        configGeneration: 1,
        inputHistoryFingerprint: 'fp2',
        assistantText: null,
        callIds: [],
        toolNames: [],
        rawArguments: [],
        reasoningContent: '...',
        timestamp: Date.now(),
        byteSize: 50,
        status: 'completed',
      });

      expect(store.count).toBe(2);

      // Invalidate standard only
      store.invalidate((r) => r.endpointProfile === 'standard');
      expect(store.count).toBe(1);
      expect(store.get('req-std')).toBeUndefined();
      expect(store.get('req-plan')).toBeDefined();
    });
  });

  describe('HistoryMatcher', () => {
    it('computes deterministic canonical fingerprint for conversation history', () => {
      const matcher = new HistoryMatcher('fixed-test-namespace');
      const messages = [
        { role: 'user' as const, content: 'What is 2+2?' },
        { role: 'assistant' as const, content: '4' },
      ];

      const fp1 = matcher.computeFingerprint(messages);
      const fp2 = matcher.computeFingerprint(messages);

      expect(fp1).toBe(fp2);
      expect(typeof fp1).toBe('string');
      expect(fp1.length).toBe(64); // SHA-256 hex
    });

    it('strictly matches single candidate record with identical fingerprint and callIds', () => {
      const store = new ReplayStore();
      const matcher = new HistoryMatcher('test-namespace');

      store.put({
        requestId: 'req-success',
        modelId: 'glm-5.3',
        endpointProfile: 'standard',
        credentialGeneration: 1,
        configGeneration: 1,
        inputHistoryFingerprint: 'canonical-fp-abc',
        assistantText: 'Let me search',
        callIds: ['call_1'],
        toolNames: ['search'],
        rawArguments: ['{"q":"test"}'],
        reasoningContent: 'Deep reasoning here',
        timestamp: Date.now(),
        byteSize: 200,
        status: 'completed',
      });

      const matched = matcher.matchReplayRecord(store, {
        modelId: 'glm-5.3',
        endpointProfile: 'standard',
        credentialGeneration: 1,
        configGeneration: 1,
        inputHistoryFingerprint: 'canonical-fp-abc',
        expectedCallIds: ['call_1'],
      });

      expect(matched).toBeDefined();
      expect(matched?.requestId).toBe('req-success');
      expect(matched?.reasoningContent).toBe('Deep reasoning here');
    });

    it('refuses match if credential generation differs', () => {
      const store = new ReplayStore();
      const matcher = new HistoryMatcher('test-namespace');

      store.put({
        requestId: 'req-old-gen',
        modelId: 'glm-5.3',
        endpointProfile: 'standard',
        credentialGeneration: 1,
        configGeneration: 1,
        inputHistoryFingerprint: 'canonical-fp-abc',
        assistantText: '...',
        callIds: [],
        toolNames: [],
        rawArguments: [],
        reasoningContent: 'old reasoning',
        timestamp: Date.now(),
        byteSize: 100,
        status: 'completed',
      });

      const matched = matcher.matchReplayRecord(store, {
        modelId: 'glm-5.3',
        endpointProfile: 'standard',
        credentialGeneration: 2, // Rotated generation
        configGeneration: 1,
        inputHistoryFingerprint: 'canonical-fp-abc',
      });

      expect(matched).toBeUndefined();
    });

    it('aborts safely with ReplayMatchingError when multiple ambiguous candidates match', () => {
      const store = new ReplayStore();
      const matcher = new HistoryMatcher('test-namespace');

      // Two different requests on the same conversation turn (e.g. branch or regeneration)
      store.put({
        requestId: 'req-branch-1',
        modelId: 'glm-5.3',
        endpointProfile: 'standard',
        credentialGeneration: 1,
        configGeneration: 1,
        inputHistoryFingerprint: 'branch-fp',
        assistantText: 'answer 1',
        callIds: [],
        toolNames: [],
        rawArguments: [],
        reasoningContent: 'reasoning path 1',
        timestamp: Date.now() - 1000,
        byteSize: 100,
        status: 'completed',
      });

      store.put({
        requestId: 'req-branch-2',
        modelId: 'glm-5.3',
        endpointProfile: 'standard',
        credentialGeneration: 1,
        configGeneration: 1,
        inputHistoryFingerprint: 'branch-fp',
        assistantText: 'answer 2',
        callIds: [],
        toolNames: [],
        rawArguments: [],
        reasoningContent: 'reasoning path 2',
        timestamp: Date.now(),
        byteSize: 100,
        status: 'completed',
      });

      expect(() =>
        matcher.matchReplayRecord(store, {
          modelId: 'glm-5.3',
          endpointProfile: 'standard',
          credentialGeneration: 1,
          configGeneration: 1,
          inputHistoryFingerprint: 'branch-fp',
        })
      ).toThrow(/Ambiguous reasoning replay candidates/);
    });
  });
});
