import { describe, it, expect } from 'vitest';
import {
  ToolCallAccumulator,
  MAX_SINGLE_TOOL_ARGUMENTS_BYTES,
} from '../../src/protocol/toolCallAccumulator.js';
import { ToolNameMapper } from '../../src/protocol/toolMapper.js';

describe('ToolCallAccumulator', () => {
  it('accumulates streamed argument fragments for multiple tool calls in order', () => {
    const acc = new ToolCallAccumulator();
    const nameMapper = new ToolNameMapper();
    const allowedTools = new Set(['search_docs', 'read_file']);

    // Chunk 1: Tool 0 starts
    acc.feedDeltaToolCall(0, {
      index: 0,
      id: 'call_1',
      type: 'function',
      function: { name: 'search_docs', arguments: '{"que' },
    });

    // Chunk 2: Tool 1 starts in parallel or interleaved
    acc.feedDeltaToolCall(0, {
      index: 1,
      id: 'call_2',
      type: 'function',
      function: { name: 'read_file', arguments: '{"pa' },
    });

    // Chunk 3: Tool 0 continuation
    acc.feedDeltaToolCall(0, {
      index: 0,
      function: { arguments: 'ry":"AI"}' },
    });

    // Chunk 4: Tool 1 continuation
    acc.feedDeltaToolCall(0, {
      index: 1,
      function: { arguments: 'th":"README.md"}' },
    });

    expect(acc.hasToolCalls()).toBe(true);

    const validated = acc.validateAndComplete(nameMapper, allowedTools, 'tool_calls');
    expect(validated).toHaveLength(2);

    expect(validated[0]).toEqual({
      callId: 'call_1',
      originalName: 'search_docs',
      zaiName: 'search_docs',
      input: { query: 'AI' },
      rawArguments: '{"query":"AI"}',
    });

    expect(validated[1]).toEqual({
      callId: 'call_2',
      originalName: 'read_file',
      zaiName: 'read_file',
      input: { path: 'README.md' },
      rawArguments: '{"path":"README.md"}',
    });
  });

  it('rejects multiple choices in stream (choice.index > 0)', () => {
    const acc = new ToolCallAccumulator();
    expect(() =>
      acc.feedDeltaToolCall(1, {
        index: 0,
        id: 'call_x',
      })
    ).toThrow(/Multiple choices encountered/);
  });

  it('handles backend repeating the complete function name idempotently', () => {
    const acc = new ToolCallAccumulator();
    const nameMapper = new ToolNameMapper();

    acc.feedDeltaToolCall(0, {
      index: 0,
      id: 'call_1',
      function: { name: 'lookup', arguments: '{"id":1}' },
    });

    // Backend repeats 'lookup' in next chunk
    acc.feedDeltaToolCall(0, {
      index: 0,
      function: { name: 'lookup' },
    });

    const validated = acc.validateAndComplete(nameMapper, new Set(['lookup']), 'stop');
    expect(validated[0].originalName).toBe('lookup');
  });

  it('rejects batch if finish_reason indicates truncation (length)', () => {
    const acc = new ToolCallAccumulator();
    acc.feedDeltaToolCall(0, {
      index: 0,
      id: 'call_trunc',
      function: { name: 'run_cmd', arguments: '{"cmd":"ls' },
    });

    expect(() =>
      acc.validateAndComplete(new ToolNameMapper(), new Set(['run_cmd']), 'length')
    ).toThrow(/token limit truncation \(finish_reason: length\)/);
  });

  it('rejects batch if finish_reason indicates content filtering (sensitive)', () => {
    const acc = new ToolCallAccumulator();
    acc.feedDeltaToolCall(0, {
      index: 0,
      id: 'call_filter',
      function: { name: 'run_cmd', arguments: '{"cmd":"rm"}' },
    });

    expect(() =>
      acc.validateAndComplete(new ToolNameMapper(), new Set(['run_cmd']), 'sensitive')
    ).toThrow(/safety filter/);
  });

  it('rejects if a tool specifies a name not in host allowed tools', () => {
    const acc = new ToolCallAccumulator();
    acc.feedDeltaToolCall(0, {
      index: 0,
      id: 'call_forbidden',
      function: { name: 'unauthorized_tool', arguments: '{}' },
    });

    expect(() =>
      acc.validateAndComplete(new ToolNameMapper(), new Set(['allowed_tool_only']), 'tool_calls')
    ).toThrow(/unrecognized or forbidden tool/);
  });

  it('rejects if arguments are malformed JSON', () => {
    const acc = new ToolCallAccumulator();
    acc.feedDeltaToolCall(0, {
      index: 0,
      id: 'call_bad_json',
      function: { name: 'my_tool', arguments: '{ broken json' },
    });

    expect(() =>
      acc.validateAndComplete(new ToolNameMapper(), new Set(['my_tool']), 'tool_calls')
    ).toThrow(/Malformed JSON arguments/);
  });

  it('rejects if arguments parse to non-object (e.g. array or primitive)', () => {
    const acc = new ToolCallAccumulator();
    acc.feedDeltaToolCall(0, {
      index: 0,
      id: 'call_array_json',
      function: { name: 'my_tool', arguments: '["not", "an", "object"]' },
    });

    expect(() =>
      acc.validateAndComplete(new ToolNameMapper(), new Set(['my_tool']), 'tool_calls')
    ).toThrow(/arguments must be a JSON object, but received array/);
  });

  it('enforces size limit on single tool call arguments (1 MiB)', () => {
    const acc = new ToolCallAccumulator();
    const oversizedChunk = 'a'.repeat(MAX_SINGLE_TOOL_ARGUMENTS_BYTES + 10);

    expect(() =>
      acc.feedDeltaToolCall(0, {
        index: 0,
        id: 'call_huge',
        function: { name: 'my_tool', arguments: oversizedChunk },
      })
    ).toThrow(/Tool call argument size limit exceeded/);
  });

  it('rejects conflicting tool call ID for the same tool index', () => {
    const acc = new ToolCallAccumulator();
    acc.feedDeltaToolCall(0, { index: 0, id: 'call_alpha' });
    expect(() =>
      acc.feedDeltaToolCall(0, { index: 0, id: 'call_beta' })
    ).toThrow(/Conflicting tool call ID in stream/);
  });

  it('rejects conflicting or contradictory tool names for the same tool index', () => {
    const acc = new ToolCallAccumulator();
    acc.feedDeltaToolCall(0, {
      index: 0,
      id: 'call_1',
      function: { name: 'fetch_user' },
    });
    expect(() =>
      acc.feedDeltaToolCall(0, {
        index: 0,
        function: { name: 'delete_database' },
      })
    ).toThrow(/Conflicting or oversized tool function name/);
  });
});
