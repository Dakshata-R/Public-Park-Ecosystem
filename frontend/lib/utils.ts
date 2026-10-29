import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The name to greet someone by: the first word, skipping a leading title such as "Dr." or "Mrs.". */
export function firstName(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  const titled = words.length > 1 && /^(dr|mr|mrs|ms|miss|prof|shri|smt)\.?$/i.test(words[0]);
  return titled ? words[1] : words[0];
}

/** Display names of the server's language-model providers (see backend llm-provider.service). */
const LLM_PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  groq: 'Groq',
  'openai-compatible': 'Local model',
  anthropic: 'Claude',
};

/**
 * The provider's display name for a stored record or API response: the
 * server's own label when it sent one, otherwise one derived from the provider
 * key — and "Claude" for records written before providers were pluggable
 * (engine `claude` / `claude-vision`).
 */
export function llmProviderName(
  { provider, providerLabel, engine }: { provider?: string | null; providerLabel?: string | null; engine?: string | null },
  fallback = 'AI'
): string {
  if (providerLabel) return providerLabel;
  if (provider && LLM_PROVIDER_LABELS[provider]) return LLM_PROVIDER_LABELS[provider];
  if (engine === 'claude' || engine === 'claude-vision') return 'Claude';
  return fallback;
}
