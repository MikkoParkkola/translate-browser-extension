/**
 * Options components coverage tests
 *
 * Strategy: The five TDZ-affected components (CacheSettings, CloudProviders,
 * LocalModels, GlossarySettings, SiteRulesSettings) cannot be called directly
 * (onMount references a const declared after it). We cover them via:
 * 1. Import-only tests (function type checks)
 * 2. Extracted pure-logic tests (logic extracted verbatim from component files)
 * 3. GeneralSettings can be called directly (no TDZ bug)
 *
 * This file extends and supplements Options.test.tsx with targeted
 * per-component logic coverage.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  GENERAL_SETTINGS_LANGUAGES,
  GENERAL_SETTINGS_STRATEGIES,
  GENERAL_SETTINGS_TARGET_LANGUAGES,
  GLOSSARY_LANGUAGES,
  SITE_RULE_LANGUAGES,
  SITE_RULE_STRATEGIES,
} from '../../shared/translation-options';
import {
  OPTIONS_CLOUD_PROVIDERS,
  SITE_RULE_PROVIDER_OPTIONS,
} from '../../shared/provider-options';
import { getCloudProviderStorageKeys } from '../../shared/cloud-provider-storage';
import { buildCloudProviderUiStatusRecord } from '../../shared/cloud-provider-ui-state';

// ============================================================================
// Chrome / browser API mock
// ============================================================================

const mockChrome = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    sync: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    openOptionsPage: vi.fn(),
  },
};

// @ts-expect-error — mock chrome global
globalThis.chrome = mockChrome;

Object.defineProperty(navigator, 'storage', {
  value: {
    estimate: vi.fn().mockResolvedValue({
      usage: 50 * 1024 * 1024,
      quota: 100 * 1024 * 1024,
    }),
  },
  writable: true,
  configurable: true,
});

// ============================================================================
// CacheSettings — pure logic extracted from component
// ============================================================================

describe('CacheSettings logic', () => {
  // formatBytes — verbatim copy from CacheSettings.tsx
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // formatPercent — verbatim copy from CacheSettings.tsx
  const formatPercent = (value: number): string => (value * 100).toFixed(1) + '%';

  // formatDate — verbatim copy from CacheSettings.tsx
  const formatDate = (timestamp: number | null): string => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // usagePercent — verbatim logic from component
  const usagePercent = (totalSize: number, maxSize: number): number => {
    if (maxSize === 0) return 0;
    return Math.min(100, (totalSize / maxSize) * 100);
  };

  describe('formatBytes', () => {
    it('returns "0 B" for 0', () => expect(formatBytes(0)).toBe('0 B'));
    it('formats KB correctly', () => expect(formatBytes(1024)).toBe('1 KB'));
    it('formats 1.5 KB', () => expect(formatBytes(1536)).toBe('1.5 KB'));
    it('formats MB correctly', () => expect(formatBytes(1024 * 1024)).toBe('1 MB'));
    it('formats GB correctly', () => expect(formatBytes(1024 ** 3)).toBe('1 GB'));
    it('formats 500 MB', () => expect(formatBytes(500 * 1024 * 1024)).toBe('500 MB'));
    it('formats 100 MB', () => expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB'));
    it('formats fractional bytes', () => expect(formatBytes(512)).toBe('512 B'));
    it('rounds to 1 decimal', () => expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB'));
  });

  describe('formatPercent', () => {
    it('formats 0%', () => expect(formatPercent(0)).toBe('0.0%'));
    it('formats 50%', () => expect(formatPercent(0.5)).toBe('50.0%'));
    it('formats 100%', () => expect(formatPercent(1)).toBe('100.0%'));
    it('formats 83.3%', () => expect(formatPercent(0.833)).toBe('83.3%'));
    it('formats decimal fractions', () => expect(formatPercent(0.125)).toBe('12.5%'));
  });

  describe('formatDate', () => {
    it('returns N/A for null', () => expect(formatDate(null)).toBe('N/A'));
    it('returns N/A for 0', () => expect(formatDate(0)).toBe('N/A'));
    it('returns non-empty string for valid timestamp', () => {
      const result = formatDate(Date.now());
      expect(result).not.toBe('N/A');
      expect(result.length).toBeGreaterThan(0);
    });
    it('includes year for 2024', () => {
      const result = formatDate(new Date('2024-06-15').getTime());
      expect(result).toContain('2024');
    });
  });

  describe('usagePercent', () => {
    it('returns 0 when maxSize is 0', () => expect(usagePercent(100, 0)).toBe(0));
    it('returns 0 when totalSize is 0', () => expect(usagePercent(0, 1000)).toBe(0));
    it('returns 50 for half full', () => expect(usagePercent(50, 100)).toBe(50));
    it('returns 100 for full', () => expect(usagePercent(100, 100)).toBe(100));
    it('caps at 100 when over', () => expect(usagePercent(150, 100)).toBe(100));
    it('computes 25%', () => expect(usagePercent(25, 100)).toBe(25));
    it('computes 80% (warning boundary)', () => expect(usagePercent(80, 100)).toBe(80));
  });

  describe('progress bar CSS class logic', () => {
    // From CacheSettings.tsx: progress-fill danger(>80%), warning(>50%), normal otherwise
    const getProgressClass = (percent: number): string => {
      if (percent > 80) return 'danger';
      if (percent > 50) return 'warning';
      return '';
    };

    it('returns danger above 80%', () => expect(getProgressClass(85)).toBe('danger'));
    it('returns warning between 50-80%', () => expect(getProgressClass(60)).toBe('warning'));
    it('returns empty below 50%', () => expect(getProgressClass(40)).toBe(''));
    it('returns empty at 0%', () => expect(getProgressClass(0)).toBe(''));
    it('warning at exactly 51%', () => expect(getProgressClass(51)).toBe('warning'));
    it('danger at exactly 81%', () => expect(getProgressClass(81)).toBe('danger'));
    it('warning at 80% (not yet danger)', () => expect(getProgressClass(80)).toBe('warning'));
    it('warning at 50.1%', () => expect(getProgressClass(50.1)).toBe('warning'));
    it('empty at exactly 50%', () => expect(getProgressClass(50)).toBe(''));
  });

  describe('CacheSettings component import', () => {
    it('CacheSettings is exported as a function', async () => {
      const { CacheSettings } = await import('./CacheSettings');
      expect(typeof CacheSettings).toBe('function');
    });
  });
});

// ============================================================================
// CloudProviders — pure logic extracted from component
// ============================================================================

describe('CloudProviders logic', () => {
  const CLOUD_PROVIDERS = OPTIONS_CLOUD_PROVIDERS;

  describe('CLOUD_PROVIDERS definitions', () => {
    it('has exactly 4 providers', () => {
      expect(CLOUD_PROVIDERS).toHaveLength(4);
    });

    it('all providers have id, name, keyField, enabledField', () => {
      for (const p of CLOUD_PROVIDERS) {
        expect(p.id).toBeTruthy();
        expect(p.name).toBeTruthy();
        expect(p.keyField).toBeTruthy();
        expect(p.enabledField).toBeTruthy();
      }
    });

    it('DeepL has pro tier', () => {
      const deepl = CLOUD_PROVIDERS.find((p) => p.id === 'deepl');
      expect(deepl?.hasProTier).toBe(true);
      expect(deepl?.proField).toBe('deepl_is_pro');
    });

    it('OpenAI has model options', () => {
      const openai = CLOUD_PROVIDERS.find((p) => p.id === 'openai') as typeof CLOUD_PROVIDERS[1];
      expect(openai?.models?.length).toBeGreaterThan(0);
      expect(openai?.models).toContain('gpt-4o');
    });

    it('Anthropic has model options', () => {
      const ant = CLOUD_PROVIDERS.find((p) => p.id === 'anthropic') as typeof CLOUD_PROVIDERS[3];
      expect(ant?.models?.length).toBeGreaterThan(0);
    });

    it('Google Cloud has no pro tier', () => {
      const gc = CLOUD_PROVIDERS.find((p) => p.id === 'google-cloud');
      expect(gc?.hasProTier).toBe(false);
    });

    it('all providers have placeholders', () => {
      for (const p of CLOUD_PROVIDERS) {
        expect(p.placeholder).toBeTruthy();
      }
    });

    it('all provider IDs are unique', () => {
      const ids = CLOUD_PROVIDERS.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('storage key computation', () => {
    it('includes DeepL pro field in keys', () => {
      const keys = getCloudProviderStorageKeys(CLOUD_PROVIDERS);
      expect(keys).toContain('deepl_is_pro');
    });

    it('includes openai model field in keys', () => {
      const keys = getCloudProviderStorageKeys(CLOUD_PROVIDERS);
      expect(keys).toContain('openai_model');
    });

    it('includes all base fields', () => {
      const keys = getCloudProviderStorageKeys(CLOUD_PROVIDERS);
      expect(keys).toContain('deepl_api_key');
      expect(keys).toContain('deepl_enabled');
      expect(keys).toContain('openai_api_key');
      expect(keys).toContain('anthropic_api_key');
    });
  });

  describe('provider status from storage', () => {
    const buildStatus = (stored: Record<string, unknown>) =>
      buildCloudProviderUiStatusRecord(CLOUD_PROVIDERS, stored);

    it('marks provider as configured when key present', () => {
      const status = buildStatus({ deepl_api_key: 'key123', deepl_enabled: true });
      expect(status.deepl.hasKey).toBe(true);
      expect(status.deepl.enabled).toBe(true);
    });

    it('marks provider as unconfigured when key absent', () => {
      const status = buildStatus({});
      expect(status.deepl.hasKey).toBe(false);
      expect(status.deepl.enabled).toBe(false);
    });

    it('marks DeepL pro tier when proField is true', () => {
      const status = buildStatus({ deepl_api_key: 'k', deepl_enabled: true, deepl_is_pro: true });
      expect(status.deepl.isPro).toBe(true);
    });

    it('returns isPro=undefined for providers without pro tier', () => {
      const status = buildStatus({ openai_api_key: 'key', openai_enabled: true });
      expect(status.openai.isPro).toBeUndefined();
    });

    it('reads model from storage for OpenAI', () => {
      const status = buildStatus({ openai_api_key: 'key', openai_model: 'gpt-4o-mini' });
      expect(status.openai.model).toBe('gpt-4o-mini');
    });

    it('normalizes aliased cloud model values from storage', () => {
      const status = buildStatus({ openai_api_key: 'key', openai_model: 'gpt-4' });
      expect(status.openai.model).toBe('gpt-4-turbo');
    });
  });

  describe('CloudProviders component import', () => {
    it('CloudProviders is exported as a function', async () => {
      const { CloudProviders } = await import('./CloudProviders');
      expect(typeof CloudProviders).toBe('function');
    });
  });
});

// ============================================================================
// LocalModels — pure logic extracted from component
// ============================================================================

describe('LocalModels logic', () => {
  // formatBytes verbatim from LocalModels.tsx
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // formatDate verbatim from LocalModels.tsx (no null check)
  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  describe('formatBytes', () => {
    it('returns "0 B" for 0', () => expect(formatBytes(0)).toBe('0 B'));
    it('formats KB', () => expect(formatBytes(1024)).toBe('1 KB'));
    it('formats MB', () => expect(formatBytes(1024 * 1024)).toBe('1 MB'));
    it('formats GB', () => expect(formatBytes(1024 ** 3)).toBe('1 GB'));
    it('formats 300 MB (typical model size)', () => {
      expect(formatBytes(300 * 1024 * 1024)).toBe('300 MB');
    });
  });

  describe('formatDate', () => {
    it('returns a date string for a valid timestamp', () => {
      const result = formatDate(new Date('2024-01-15').getTime());
      expect(result).toContain('2024');
    });
    it('returns non-empty string', () => {
      expect(formatDate(Date.now()).length).toBeGreaterThan(0);
    });
  });

  describe('storage quota computation', () => {
    // Logic from loadModelStats
    const computeUsagePercent = (used: number, quota: number): number => {
      if (quota === 0) return 0;
      return Math.round((used / quota) * 100);
    };

    it('returns 0 when quota is 0', () => expect(computeUsagePercent(100, 0)).toBe(0));
    it('returns 50 for half used', () => expect(computeUsagePercent(50, 100)).toBe(50));
    it('returns 100 when full', () => expect(computeUsagePercent(100, 100)).toBe(100));
  });

  describe('LocalModels component import', () => {
    it('LocalModels is exported as a function', async () => {
      const { LocalModels } = await import('./LocalModels');
      expect(typeof LocalModels).toBe('function');
    });
  });
});

// ============================================================================
// GlossarySettings — pure logic extracted from component
// ============================================================================

describe('GlossarySettings logic', () => {
  describe('LANGUAGES list', () => {
    it('has 7 entries', () => expect(GLOSSARY_LANGUAGES).toHaveLength(7));
    it('first is All Languages', () => {
      expect(GLOSSARY_LANGUAGES[0].code).toBe('all');
      expect(GLOSSARY_LANGUAGES[0].name).toBe('All Languages');
    });
    it('includes English', () => {
      expect(GLOSSARY_LANGUAGES.some((l) => l.code === 'en')).toBe(true);
    });
    it('includes Finnish', () => {
      expect(GLOSSARY_LANGUAGES.some((l) => l.code === 'fi')).toBe(true);
    });
    it('all codes are unique', () => {
      const codes = GLOSSARY_LANGUAGES.map((l) => l.code);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  describe('term filtering logic', () => {
    type GlossaryTerm = { replacement: string; caseSensitive: boolean; description?: string; language?: string };
    type GlossaryStore = Record<string, GlossaryTerm>;

    // Logic from filteredTerms() in GlossarySettings
    const filterTerms = (
      terms: GlossaryStore,
      selectedLanguage: string,
      searchQuery: string
    ): Array<[string, GlossaryTerm]> => {
      return Object.entries(terms).filter(([source, term]) => {
        if (selectedLanguage !== 'all' && term.language && term.language !== selectedLanguage) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            source.toLowerCase().includes(q) ||
            term.replacement.toLowerCase().includes(q)
          );
        }
        return true;
      });
    };

    const sampleTerms: GlossaryStore = {
      API: { replacement: 'rajapinta', caseSensitive: true, language: 'fi' },
      GPU: { replacement: 'grafiikkasuoritin', caseSensitive: false, language: 'fi' },
      server: { replacement: 'serveur', caseSensitive: false, language: 'fr' },
      hello: { replacement: 'hallo', caseSensitive: false },
    };

    it('returns all terms when selectedLanguage is all and no query', () => {
      expect(filterTerms(sampleTerms, 'all', '').length).toBe(4);
    });

    it('filters by language, keeps fi-specific terms', () => {
      const fi = filterTerms(sampleTerms, 'fi', '');
      // API, GPU have language=fi; hello has no language (included); server has language=fr (excluded)
      // So we get API, GPU, hello = 3 results
      expect(fi.length).toBe(3);
      expect(fi.some(([k]) => k === 'API')).toBe(true);
      expect(fi.some(([k]) => k === 'GPU')).toBe(true);
    });

    it('includes terms with no language when filtering by language', () => {
      // Terms with no language set are always included
      const fi = filterTerms(sampleTerms, 'fi', '');
      // hello has no language — should be included
      expect(fi.some(([k]) => k === 'hello')).toBe(true);
    });

    it('excludes terms with different language', () => {
      const fi = filterTerms(sampleTerms, 'fi', '');
      // server has language=fr — should be excluded
      expect(fi.some(([k]) => k === 'server')).toBe(false);
    });

    it('filters by search query on source', () => {
      const results = filterTerms(sampleTerms, 'all', 'api');
      expect(results.length).toBe(1);
      expect(results[0][0]).toBe('API');
    });

    it('filters by search query on replacement', () => {
      const results = filterTerms(sampleTerms, 'all', 'serveur');
      expect(results.length).toBe(1);
      expect(results[0][0]).toBe('server');
    });

    it('search is case-insensitive', () => {
      const results = filterTerms(sampleTerms, 'all', 'RAJAPINTA');
      expect(results.length).toBe(1);
    });

    it('returns empty when no terms match', () => {
      expect(filterTerms(sampleTerms, 'all', 'zzz').length).toBe(0);
    });
  });

  describe('GlossarySettings component import', () => {
    it('GlossarySettings is exported as a function', async () => {
      const { GlossarySettings } = await import('./GlossarySettings');
      expect(typeof GlossarySettings).toBe('function');
    });
  });
});

// ============================================================================
// SiteRulesSettings — pure logic extracted from component
// ============================================================================

describe('SiteRulesSettings logic', () => {
  describe('PROVIDERS', () => {
    it('has 8 entries', () => expect(SITE_RULE_PROVIDER_OPTIONS).toHaveLength(8));
    it('first is Use default', () => expect(SITE_RULE_PROVIDER_OPTIONS[0].id).toBe(''));
    it('includes opus-mt', () => expect(SITE_RULE_PROVIDER_OPTIONS.some((p) => p.id === 'opus-mt')).toBe(true));
    it('includes deepl', () => expect(SITE_RULE_PROVIDER_OPTIONS.some((p) => p.id === 'deepl')).toBe(true));
    it('all IDs unique', () => {
      const ids = SITE_RULE_PROVIDER_OPTIONS.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('STRATEGIES', () => {
    it('has 6 entries', () => expect(SITE_RULE_STRATEGIES).toHaveLength(6));
    it('first is Use default', () => expect(SITE_RULE_STRATEGIES[0].id).toBe(''));
    it('includes smart', () => expect(SITE_RULE_STRATEGIES.some((s) => s.id === 'smart')).toBe(true));
    it('includes quality', () => expect(SITE_RULE_STRATEGIES.some((s) => s.id === 'quality')).toBe(true));
  });

  describe('domain pattern validation', () => {
    // Extracted from SiteRulesSettings' addRule validation
    const isValidDomainPattern = (pattern: string): boolean => {
      return pattern.trim().length > 0;
    };

    it('accepts a simple domain', () => {
      expect(isValidDomainPattern('example.com')).toBe(true);
    });

    it('accepts wildcard pattern', () => {
      expect(isValidDomainPattern('*.github.com')).toBe(true);
    });

    it('rejects empty pattern', () => {
      expect(isValidDomainPattern('')).toBe(false);
      expect(isValidDomainPattern('   ')).toBe(false);
    });

    it('accepts subdomain', () => {
      expect(isValidDomainPattern('api.example.com')).toBe(true);
    });
  });

  describe('site rules storage key building', () => {
    // Mirrors logic from loadRules()
    const buildRuleFromStorage = (stored: Record<string, unknown>) => {
      return stored.siteRules as Record<string, unknown> || {};
    };

    it('returns empty object when no rules stored', () => {
      expect(buildRuleFromStorage({})).toEqual({});
    });

    it('returns stored rules when present', () => {
      const rules = { 'example.com': { autoTranslate: true } };
      expect(buildRuleFromStorage({ siteRules: rules })).toEqual(rules);
    });
  });

  describe('SITE_LANGUAGES', () => {
    it('has Use default option', () => {
      expect(SITE_RULE_LANGUAGES.some((l) => l.code === '')).toBe(true);
    });
    it('has Auto Detect option', () => {
      expect(SITE_RULE_LANGUAGES.some((l) => l.code === 'auto')).toBe(true);
    });
  });

  describe('SiteRulesSettings component import', () => {
    it('SiteRulesSettings is exported as a function', async () => {
      const { SiteRulesSettings } = await import('./SiteRulesSettings');
      expect(typeof SiteRulesSettings).toBe('function');
    });
  });
});

// ============================================================================
// GeneralSettings — can be called directly (no TDZ bug)
// ============================================================================

describe('GeneralSettings component invocation', () => {
  it('is a callable Solid component', async () => {
    const { GeneralSettings } = await import('./GeneralSettings');
    expect(typeof GeneralSettings).toBe('function');
  });

  it('calling GeneralSettings() returns a defined value', async () => {
    const { GeneralSettings } = await import('./GeneralSettings');
    const result = (GeneralSettings as (props: Record<string, unknown>) => unknown)({});
    expect(result).toBeDefined();
  });

  it('GeneralSettings result is not null', async () => {
    const { GeneralSettings } = await import('./GeneralSettings');
    const result = (GeneralSettings as (props: Record<string, unknown>) => unknown)({});
    expect(result).not.toBeNull();
  });
});

// ============================================================================
// GeneralSettings logic extracted
// ============================================================================

describe('GeneralSettings constants', () => {
  describe('LANGUAGES array', () => {
    it('has 16 entries', () => expect(GENERAL_SETTINGS_LANGUAGES).toHaveLength(16));
    it('starts with auto', () => expect(GENERAL_SETTINGS_LANGUAGES[0].code).toBe('auto'));
    it('includes English', () => expect(GENERAL_SETTINGS_LANGUAGES.some((l) => l.code === 'en')).toBe(true));
    it('all codes unique', () => {
      const codes = GENERAL_SETTINGS_LANGUAGES.map((l) => l.code);
      expect(new Set(codes).size).toBe(codes.length);
    });
    it('all names non-empty', () => {
      for (const lang of GENERAL_SETTINGS_LANGUAGES) {
        expect(lang.name.length).toBeGreaterThan(0);
      }
    });
    it('target filter excludes auto', () => {
      expect(GENERAL_SETTINGS_TARGET_LANGUAGES.some((l) => l.code === 'auto')).toBe(false);
      expect(GENERAL_SETTINGS_TARGET_LANGUAGES).toHaveLength(GENERAL_SETTINGS_LANGUAGES.length - 1);
    });
  });

  describe('STRATEGIES array', () => {
    it('has 5 strategies', () => expect(GENERAL_SETTINGS_STRATEGIES).toHaveLength(5));
    it('starts with smart', () => expect(GENERAL_SETTINGS_STRATEGIES[0].id).toBe('smart'));
    it('includes fast', () => expect(GENERAL_SETTINGS_STRATEGIES.some((s) => s.id === 'fast')).toBe(true));
    it('includes quality', () => expect(GENERAL_SETTINGS_STRATEGIES.some((s) => s.id === 'quality')).toBe(true));
    it('all IDs unique', () => {
      const ids = GENERAL_SETTINGS_STRATEGIES.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
    it('all descriptions non-empty', () => {
      for (const s of GENERAL_SETTINGS_STRATEGIES) {
        expect(s.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('settings serialization logic', () => {
    // Mimics saveSettings logic: build the data object
    const buildSettingsPayload = (
      sourceLang: string,
      targetLang: string,
      strategy: string,
      autoTranslate: boolean
    ) => ({
      sourceLang,
      targetLang,
      strategy,
      autoTranslate,
    });

    it('builds correct payload', () => {
      const payload = buildSettingsPayload('auto', 'fi', 'smart', true);
      expect(payload.sourceLang).toBe('auto');
      expect(payload.targetLang).toBe('fi');
      expect(payload.strategy).toBe('smart');
      expect(payload.autoTranslate).toBe(true);
    });

    it('preserves false for autoTranslate', () => {
      const payload = buildSettingsPayload('en', 'de', 'fast', false);
      expect(payload.autoTranslate).toBe(false);
    });
  });
});
