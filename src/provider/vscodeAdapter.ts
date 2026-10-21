import * as vscode from 'vscode';
import { ModelDescriptor, calculateMaxInputTokens } from './modelCatalog.js';

/**
 * Converts internal ModelDescriptor to VS Code's public LanguageModelChatInformation.
 */
export function toLanguageModelChatInformation(
  descriptor: ModelDescriptor
): vscode.LanguageModelChatInformation {
  const maxInputTokens = calculateMaxInputTokens(descriptor);

  return {
    id: descriptor.apiModelId,
    name: descriptor.displayName,
    family: descriptor.family,
    version: descriptor.version,
    maxInputTokens,
    maxOutputTokens: descriptor.providerMaxOutputTokens,
    tooltip: `Z.ai ${descriptor.displayName} (${descriptor.version})`,
    detail: `Z.ai ${descriptor.displayName}`,
    capabilities: {
      imageInput: descriptor.implementedCapabilities.images,
      toolCalling: descriptor.implementedCapabilities.tools ? 128 : false,
    },
  };
}

export function createTextResponsePart(text: string): vscode.LanguageModelTextPart {
  return new vscode.LanguageModelTextPart(text);
}

export function createToolCallResponsePart(
  callId: string,
  name: string,
  input: object
): vscode.LanguageModelToolCallPart {
  return new vscode.LanguageModelToolCallPart(callId, name, input);
}
