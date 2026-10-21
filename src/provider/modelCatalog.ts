import { ConfiguredProfile, EndpointProfile, Verification } from '../config/endpointProfiles.js';

export interface ModelDescriptor {
  readonly apiModelId: string;
  readonly displayName: string;
  readonly family: string;
  readonly version: string;
  readonly providerContextBudget: number;
  readonly providerMaxOutputTokens: number;
  readonly defaultRequestMaxOutputTokens: number;
  readonly inputSafetyMarginTokens: number;
  readonly supportsThinkingDisable: boolean;
  readonly reasoningEfforts: readonly string[];
  readonly endpointStatus: Readonly<Record<EndpointProfile, Verification>>;
  readonly implementedCapabilities: {
    readonly text: boolean;
    readonly tools: boolean;
    readonly images: boolean;
  };
}

export const MODEL_CATALOG: readonly ModelDescriptor[] = Object.freeze([
  {
    apiModelId: 'glm-5.3',
    displayName: 'GLM-5.3',
    family: 'glm-5.3',
    version: '5.3',
    providerContextBudget: 1_000_000,
    providerMaxOutputTokens: 16_384,
    defaultRequestMaxOutputTokens: 16_384,
    inputSafetyMarginTokens: 8_192,
    supportsThinkingDisable: false,
    reasoningEfforts: Object.freeze(['low', 'high', 'max']),
    endpointStatus: Object.freeze({
      'standard': 'verified',
      'coding-plan': 'verified',
    }),
    implementedCapabilities: Object.freeze({
      text: true,
      tools: true,
      images: false,
    }),
  },
  {
    apiModelId: 'glm-5.3-flash',
    displayName: 'GLM-5.3-Flash',
    family: 'glm-5.3-flash',
    version: '5.3-flash',
    providerContextBudget: 1_000_000,
    providerMaxOutputTokens: 16_384,
    defaultRequestMaxOutputTokens: 16_384,
    inputSafetyMarginTokens: 8_192,
    supportsThinkingDisable: false,
    reasoningEfforts: Object.freeze(['low', 'high', 'max']),
    endpointStatus: Object.freeze({
      'standard': 'verified',
      'coding-plan': 'verified',
    }),
    implementedCapabilities: Object.freeze({
      text: true,
      tools: true,
      images: false,
    }),
  },
  {
    apiModelId: 'glm-5.3-flashx',
    displayName: 'GLM-5.3-FlashX',
    family: 'glm-5.3-flashx',
    version: '5.3-flashx',
    providerContextBudget: 1_000_000,
    providerMaxOutputTokens: 16_384,
    defaultRequestMaxOutputTokens: 16_384,
    inputSafetyMarginTokens: 8_192,
    supportsThinkingDisable: false,
    reasoningEfforts: Object.freeze(['low', 'high', 'max']),
    endpointStatus: Object.freeze({
      'standard': 'verified',
      'coding-plan': 'unsupported',
    }),
    implementedCapabilities: Object.freeze({
      text: true,
      tools: true,
      images: false,
    }),
  },
  {
    apiModelId: 'glm-5.2',
    displayName: 'GLM-5.2',
    family: 'glm-5.2',
    version: '5.2',
    providerContextBudget: 128_000,
    providerMaxOutputTokens: 16_384,
    defaultRequestMaxOutputTokens: 16_384,
    inputSafetyMarginTokens: 8_192,
    supportsThinkingDisable: true,
    reasoningEfforts: Object.freeze([]),
    endpointStatus: Object.freeze({
      'standard': 'experimental',
      'coding-plan': 'unsupported',
    }),
    implementedCapabilities: Object.freeze({
      text: true,
      tools: false,
      images: false,
    }),
  },
]);

export function findModelDescriptor(apiModelId: string): ModelDescriptor | undefined {
  return MODEL_CATALOG.find((m) => m.apiModelId === apiModelId);
}

export function getModelsForProfile(
  profile: ConfiguredProfile,
  includeExperimental = false
): readonly ModelDescriptor[] {
  if (profile === 'unconfigured') {
    return Object.freeze([]);
  }

  return Object.freeze(
    MODEL_CATALOG.filter((model) => {
      const status = model.endpointStatus[profile];
      if (status === 'verified') {
        return true;
      }
      if (status === 'experimental' && includeExperimental) {
        return true;
      }
      return false;
    })
  );
}

/**
 * Calculates the maximum input tokens for VS Code model information.
 * Formula from Section 12.1:
 * maxInputTokens = contextBudget - providerMaxOutputTokens - safetyMargin
 */
export function calculateMaxInputTokens(descriptor: ModelDescriptor): number {
  return Math.max(
    1024,
    descriptor.providerContextBudget -
      descriptor.providerMaxOutputTokens -
      descriptor.inputSafetyMarginTokens
  );
}
