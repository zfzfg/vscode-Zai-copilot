import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { mapHostMessages } from '../../src/protocol/messageMapper.js';
import { mapHostTools, ToolNameMapper } from '../../src/protocol/toolMapper.js';

function mockMsg(
  role: vscode.LanguageModelChatMessageRole,
  content: Array<vscode.LanguageModelInputPart | any>,
  name?: string
): vscode.LanguageModelChatRequestMessage {
  return { role, content, name };
}

describe('Message & Tool Mapper', () => {
  describe('mapHostMessages', () => {
    it('maps simple user text message faithfully', () => {
      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(
          vscode.LanguageModelChatMessageRole.User,
          [new vscode.LanguageModelTextPart('Hello Z.ai!')],
          'alice'
        ),
      ];

      const mapped = mapHostMessages(messages);
      expect(mapped).toHaveLength(1);
      expect(mapped[0]).toEqual({
        role: 'user',
        content: 'Hello Z.ai!',
        name: 'alice',
      });
    });

    it('preserves multiple contiguous text parts without loss of content', () => {
      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(vscode.LanguageModelChatMessageRole.User, [
          new vscode.LanguageModelTextPart('Part 1: '),
          new vscode.LanguageModelTextPart('Part 2.'),
        ]),
      ];

      const mapped = mapHostMessages(messages);
      expect(mapped).toHaveLength(1);
      expect(mapped[0].content).toBe('Part 1: Part 2.');
    });

    it('maps assistant with text and tool calls, preserving IDs and serializing input', () => {
      const nameMapper = new ToolNameMapper();
      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(vscode.LanguageModelChatMessageRole.User, [
          new vscode.LanguageModelTextPart('Run weather check'),
        ]),
        mockMsg(vscode.LanguageModelChatMessageRole.Assistant, [
          new vscode.LanguageModelTextPart('I will check the weather.'),
          new vscode.LanguageModelToolCallPart('call_123', 'get_weather', { location: 'Berlin' }),
          new vscode.LanguageModelToolCallPart('call_456', 'get_weather', { location: 'Munich' }),
        ]),
      ];

      const mapped = mapHostMessages(messages, { nameMapper });
      expect(mapped).toHaveLength(2);
      expect(mapped[1].role).toBe('assistant');
      expect(mapped[1].content).toBe('I will check the weather.');
      expect(mapped[1].tool_calls).toHaveLength(2);
      expect(mapped[1].tool_calls![0]).toEqual({
        id: 'call_123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"Berlin"}',
        },
      });
      expect(mapped[1].tool_calls![1]).toEqual({
        id: 'call_456',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"location":"Munich"}',
        },
      });
    });

    it('maps tool results to individual tool messages referencing correct callId in order', () => {
      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(vscode.LanguageModelChatMessageRole.User, [
          new vscode.LanguageModelTextPart('Check files'),
        ]),
        mockMsg(vscode.LanguageModelChatMessageRole.Assistant, [
          new vscode.LanguageModelToolCallPart('call_abc', 'read_file', { path: 'a.txt' }),
          new vscode.LanguageModelToolCallPart('call_def', 'read_file', { path: 'b.txt' }),
        ]),
        mockMsg(vscode.LanguageModelChatMessageRole.User, [
          new vscode.LanguageModelToolResultPart('call_abc', [
            new vscode.LanguageModelTextPart('Content of A'),
          ]),
          new vscode.LanguageModelToolResultPart('call_def', [
            new vscode.LanguageModelTextPart('Content of B'),
          ]),
        ]),
      ];

      const mapped = mapHostMessages(messages);
      expect(mapped).toHaveLength(4);
      expect(mapped[2]).toEqual({
        role: 'tool',
        content: 'Content of A',
        tool_call_id: 'call_abc',
      });
      expect(mapped[3]).toEqual({
        role: 'tool',
        content: 'Content of B',
        tool_call_id: 'call_def',
      });
    });

    it('preserves order of mixed text and tool results within user message', () => {
      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(vscode.LanguageModelChatMessageRole.User, [
          new vscode.LanguageModelTextPart('Initial query'),
        ]),
        mockMsg(vscode.LanguageModelChatMessageRole.Assistant, [
          new vscode.LanguageModelToolCallPart('call_1', 'tool_a', {}),
        ]),
        mockMsg(vscode.LanguageModelChatMessageRole.User, [
          new vscode.LanguageModelTextPart('Leading comment'),
          new vscode.LanguageModelToolResultPart('call_1', [
            new vscode.LanguageModelTextPart('Result of tool_a'),
          ]),
          new vscode.LanguageModelTextPart('Trailing follow-up question'),
        ]),
      ];

      const mapped = mapHostMessages(messages);
      expect(mapped).toHaveLength(5);
      expect(mapped[2].role).toBe('user');
      expect(mapped[2].content).toBe('Leading comment');
      expect(mapped[3].role).toBe('tool');
      expect(mapped[3].tool_call_id).toBe('call_1');
      expect(mapped[4].role).toBe('user');
      expect(mapped[4].content).toBe('Trailing follow-up question');
    });

    it('rejects empty messages array before network call', () => {
      expect(() => mapHostMessages([])).toThrow(/Request message list cannot be empty/);
    });

    it('rejects history containing only assistant messages', () => {
      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(vscode.LanguageModelChatMessageRole.Assistant, [
          new vscode.LanguageModelTextPart('Only assistant talking'),
        ]),
      ];
      expect(() => mapHostMessages(messages)).toThrow(/requires at least one user message/);
    });

    it('rejects tool result if corresponding tool call was never issued', () => {
      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(vscode.LanguageModelChatMessageRole.User, [
          new vscode.LanguageModelToolResultPart('orphan_call_id', [
            new vscode.LanguageModelTextPart('Result'),
          ]),
        ]),
      ];
      expect(() => mapHostMessages(messages)).toThrow(/matching preceding tool call/);
    });

    it('rejects unknown content parts with UNSUPPORTED_MESSAGE_PART', () => {
      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(vscode.LanguageModelChatMessageRole.User, [{ unexpectedType: 12345 } as any]),
      ];
      expect(() => mapHostMessages(messages)).toThrow(/UNSUPPORTED_MESSAGE_PART/);
    });

    it('rejects empty user message or user message without content', () => {
      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(vscode.LanguageModelChatMessageRole.User, []),
      ];
      expect(() => mapHostMessages(messages)).toThrow(/User message content array cannot be empty/);
    });

    it('rejects empty assistant message or assistant message without text and tool calls', () => {
      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('Hi')]),
        mockMsg(vscode.LanguageModelChatMessageRole.Assistant, []),
      ];
      expect(() => mapHostMessages(messages)).toThrow(/Assistant message content array cannot be empty/);
    });

    it('passes precedingMessages and toolCallIds correctly to getReasoningForTurn callback', () => {
      let capturedPreceding: any[] = [];
      let capturedCallIds: readonly string[] = [];

      const messages: vscode.LanguageModelChatRequestMessage[] = [
        mockMsg(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('Ping')]),
        mockMsg(vscode.LanguageModelChatMessageRole.Assistant, [
          new vscode.LanguageModelToolCallPart('call_test', 'my_tool', {}),
        ]),
        mockMsg(vscode.LanguageModelChatMessageRole.User, [
          new vscode.LanguageModelToolResultPart('call_test', ['Pong']),
        ]),
      ];

      const mapped = mapHostMessages(messages, {
        getReasoningForTurn: (_idx, _text, preceding, callIds) => {
          capturedPreceding = [...preceding];
          capturedCallIds = callIds;
          return 'restored-reasoning';
        },
      });

      expect(capturedPreceding).toHaveLength(1);
      expect(capturedPreceding[0].role).toBe('user');
      expect(capturedCallIds).toEqual(['call_test']);
      expect(mapped[1].reasoning_content).toBe('restored-reasoning');
    });
  });

  describe('mapHostTools', () => {
    it('preserves existing schema and supplies default object schema for missing schema', () => {
      const hostTools: vscode.LanguageModelChatTool[] = [
        {
          name: 'tool_with_schema',
          description: 'A tool',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
        {
          name: 'tool_without_schema',
          description: 'No schema tool',
          inputSchema: undefined,
        },
      ];

      const result = mapHostTools(hostTools, vscode.LanguageModelChatToolMode.Auto);
      expect(result.tools).toHaveLength(2);
      expect(result.tools![0].function.parameters).toEqual({
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      });
      expect(result.tools![1].function.parameters).toEqual({
        type: 'object',
        properties: {},
      });
    });

    it('allows up to 128 tools, rejects 129 tools', () => {
      const tools128: vscode.LanguageModelChatTool[] = Array.from({ length: 128 }, (_, i) => ({
        name: `tool_${i}`,
        description: `desc ${i}`,
      }));

      const res128 = mapHostTools(tools128, vscode.LanguageModelChatToolMode.Auto);
      expect(res128.tools).toHaveLength(128);

      const tools129 = [...tools128, { name: 'tool_128', description: 'one too many' }];
      expect(() => mapHostTools(tools129, vscode.LanguageModelChatToolMode.Auto)).toThrow(
        /Tool count exceeded/
      );
    });

    it('rejects Required toolMode because Z.ai only supports auto', () => {
      const hostTools: vscode.LanguageModelChatTool[] = [{ name: 'test_tool', description: 'test' }];
      expect(() => mapHostTools(hostTools, vscode.LanguageModelChatToolMode.Required)).toThrow(
        /Unsupported tool mode: Required/
      );
    });

    it('sanitizes invalid tool names with deterministic collision-free hash and supports reverse mapping', () => {
      const toolName = 'vscode.workbench.action.findInFiles'; // contains dots forbidden by Z.ai
      const mapper = new ToolNameMapper();
      const zaiName = mapper.mapToZai(toolName);

      expect(zaiName).not.toContain('.');
      expect(/^[a-zA-Z0-9_-]{1,64}$/.test(zaiName)).toBe(true);

      // Verify reverse mapping recovers exact original name
      expect(mapper.mapToOriginal(zaiName)).toBe(toolName);
    });

    it('detects duplicate tool names and throws error', () => {
      const hostTools: vscode.LanguageModelChatTool[] = [
        { name: 'duplicate_name', description: 'first' },
        { name: 'duplicate_name', description: 'second' },
      ];
      expect(() => mapHostTools(hostTools, vscode.LanguageModelChatToolMode.Auto)).toThrow(
        /Duplicate tool definition/
      );
    });

    it('rejects non-serializable circular tool schemas', () => {
      const circularSchema: any = { type: 'object' };
      circularSchema.self = circularSchema;

      const hostTools: vscode.LanguageModelChatTool[] = [
        { name: 'circular_tool', description: 'circular', inputSchema: circularSchema },
      ];
      expect(() => mapHostTools(hostTools, vscode.LanguageModelChatToolMode.Auto)).toThrow(
        /not JSON-serializable/
      );
    });
  });
});
