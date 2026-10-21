import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ZaiTool } from './types.js';

const MAX_TOOLS_LIMIT = 128;
const MAX_TOOL_NAME_LENGTH = 64;
const VALID_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export class ToolNameMapper {
  private readonly _forwardMap = new Map<string, string>(); // original -> zai
  private readonly _reverseMap = new Map<string, string>(); // zai -> original

  public mapToZai(originalName: string): string {
    const existing = this._forwardMap.get(originalName);
    if (existing) {
      return existing;
    }

    let zaiName = originalName;

    const isValid =
      originalName.length > 0 &&
      originalName.length <= MAX_TOOL_NAME_LENGTH &&
      VALID_NAME_REGEX.test(originalName);

    if (!isValid) {
      // Deterministically sanitize: replace forbidden characters with '_'
      const sanitized = originalName.replace(/[^a-zA-Z0-9_-]/g, '_');
      // Hash original name to guarantee collision-free uniqueness
      const hash = crypto.createHash('sha256').update(originalName).digest('hex').substring(0, 8);
      const prefixMax = MAX_TOOL_NAME_LENGTH - 1 - hash.length;
      const truncated = sanitized.substring(0, Math.max(1, prefixMax));
      zaiName = `${truncated}_${hash}`;
    }

    // Ensure no collision in reverse map
    if (this._reverseMap.has(zaiName) && this._reverseMap.get(zaiName) !== originalName) {
      // Collision with an existing mapped name: append another hash segment
      const hash2 = crypto.createHash('sha256').update(originalName + '_col').digest('hex').substring(0, 8);
      const prefixMax = MAX_TOOL_NAME_LENGTH - 1 - hash2.length;
      zaiName = `${zaiName.substring(0, prefixMax)}_${hash2}`;
    }

    this._forwardMap.set(originalName, zaiName);
    this._reverseMap.set(zaiName, originalName);
    return zaiName;
  }

  public mapToOriginal(zaiName: string): string {
    return this._reverseMap.get(zaiName) ?? zaiName;
  }

  public hasZaiName(zaiName: string): boolean {
    return this._reverseMap.has(zaiName);
  }
}

export interface MappedToolsResult {
  readonly tools?: readonly ZaiTool[];
  readonly tool_choice?: 'auto';
  readonly nameMapper: ToolNameMapper;
}

export function mapHostTools(
  tools: readonly vscode.LanguageModelChatTool[] | undefined,
  toolMode: vscode.LanguageModelChatToolMode | undefined
): MappedToolsResult {
  const nameMapper = new ToolNameMapper();

  if (!tools || tools.length === 0) {
    return { nameMapper };
  }

  if (tools.length > MAX_TOOLS_LIMIT) {
    throw new Error(
      `Tool count exceeded: host provided ${tools.length} tools, but maximum supported by Z.ai is ${MAX_TOOLS_LIMIT}.`
    );
  }

  if (toolMode === vscode.LanguageModelChatToolMode.Required) {
    throw new Error(
      'Unsupported tool mode: Required tool calling mode is not supported by Z.ai API (only auto mode is supported).'
    );
  }

  const seenNames = new Set<string>();
  const zaiTools: ZaiTool[] = [];

  for (const tool of tools) {
    if (seenNames.has(tool.name)) {
      throw new Error(`Duplicate tool definition encountered: ${tool.name}`);
    }
    seenNames.add(tool.name);

    const zaiName = nameMapper.mapToZai(tool.name);

    // Validate parameters schema
    let parameters: Record<string, unknown>;
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
      parameters = {
        type: 'object',
        properties: {},
      };
    } else {
      // Validate JSON serializability
      try {
        JSON.stringify(tool.inputSchema);
      } catch (err: any) {
        throw new Error(
          `Tool schema for '${tool.name}' is not JSON-serializable: ${err?.message ?? String(err)}`
        );
      }
      parameters = tool.inputSchema as Record<string, unknown>;
    }

    const description =
      typeof tool.description === 'string' && tool.description.trim().length > 0
        ? tool.description.trim()
        : 'Tool function';

    zaiTools.push({
      type: 'function',
      function: {
        name: zaiName,
        description,
        parameters,
      },
    });
  }

  return {
    tools: Object.freeze(zaiTools),
    tool_choice: 'auto',
    nameMapper,
  };
}
