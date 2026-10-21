export type EndpointProfile = 'standard' | 'coding-plan';
export type ConfiguredProfile = 'unconfigured' | EndpointProfile;
export type Verification = 'documented' | 'verified' | 'experimental' | 'unsupported';

export const ALLOWED_ENDPOINTS: Readonly<Record<EndpointProfile, string>> = Object.freeze({
  'standard': 'https://api.z.ai/api/paas/v4',
  'coding-plan': 'https://api.z.ai/api/coding/paas/v4',
});

export const CHAT_COMPLETIONS_PATH = '/chat/completions';

/**
 * Validates and constructs the full URL for the chat completions endpoint.
 * Ensures the allowlisted base URL is strictly used and path segments are preserved.
 */
export function buildCompletionsUrl(profile: EndpointProfile): string {
  const baseUrl = ALLOWED_ENDPOINTS[profile];
  if (!baseUrl) {
    throw new Error(`Unsupported or unallowlisted endpoint profile: ${profile}`);
  }
  // Strip trailing slashes from base and leading slashes from path to avoid double slashes or accidental segment replacement
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = CHAT_COMPLETIONS_PATH.replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const standardParsed = new URL(ALLOWED_ENDPOINTS['standard']);
    const codingParsed = new URL(ALLOWED_ENDPOINTS['coding-plan']);

    return (
      (parsed.origin === standardParsed.origin && parsed.pathname.startsWith(standardParsed.pathname)) ||
      (parsed.origin === codingParsed.origin && parsed.pathname.startsWith(codingParsed.pathname))
    );
  } catch {
    return false;
  }
}
