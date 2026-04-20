import type { TranslationProviderId } from '../types';

export const TEST_PROVIDERS: Array<{ id: TranslationProviderId; name: string }> = [
  { id: 'opus-mt', name: 'OPUS-MT' },
  { id: 'deepl', name: 'DeepL' },
  { id: 'openai', name: 'OpenAI' },
];

export const TEST_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fi', name: 'Finnish' },
  { code: 'de', name: 'German' },
];

export const TEST_GLOSSARY_TERMS = {
  API: { replacement: 'rajapinta', caseSensitive: true, description: 'Technical term' },
  cloud: { replacement: 'pilvi', caseSensitive: false },
  server: { replacement: 'palvelin', caseSensitive: false, description: 'Backend server' },
};

export const TEST_SITE_RULES = {
  'example.com': {
    autoTranslate: true,
    preferredProvider: 'deepl' as TranslationProviderId,
    targetLang: 'fi',
  },
  '*.wikipedia.org': { autoTranslate: false },
};

export function makeUsage(overrides: {
  cost?: number;
  monthly?: number;
  used?: number;
  requests?: number;
  characters?: number;
} = {}) {
  return {
    today: {
      requests: overrides.requests ?? 10,
      characters: overrides.characters ?? 5000,
      cost: overrides.cost ?? 0.42,
    },
    budget: {
      monthly: overrides.monthly ?? 5.0,
      used: overrides.used ?? 2.5,
    },
  };
}
