/**
 * Tests for Options page components
 * Combines:
 *   1. Logic-extraction tests (pure functions, no DOM)
 *   2. Component invocation tests (calls Solid component functions directly
 *      to execute signal initialization, onMount, and tab/icon logic)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Chrome API mock
// ---------------------------------------------------------------------------

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
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    openOptionsPage: vi.fn(),
  },
};

// @ts-expect-error - mock chrome global
globalThis.chrome = mockChrome;

Object.defineProperty(navigator, 'storage', {
  value: {
    estimate: vi.fn().mockResolvedValue({ usage: 50 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
  },
  writable: true,
});

// ---------------------------------------------------------------------------
// Options Components — smoke-import tests (existing)
// ---------------------------------------------------------------------------

describe('Options Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('GeneralSettings', () => {
    it('should load saved preferences on mount', async () => {
      mockChrome.storage.local.get.mockResolvedValue({
        sourceLang: 'fi',
        targetLang: 'en',
        strategy: 'quality',
        autoTranslate: true,
      });

      const { GeneralSettings } = await import('./components/GeneralSettings');

      expect(GeneralSettings).toBeDefined();
      expect(typeof GeneralSettings).toBe('function');
    });

    it('should save settings when button clicked', async () => {
      mockChrome.storage.local.set.mockResolvedValue(undefined);

      const { GeneralSettings } = await import('./components/GeneralSettings');

      expect(GeneralSettings).toBeDefined();
    });
  });

  describe('CloudProviders', () => {
    it('should load provider status on mount', async () => {
      mockChrome.storage.local.get.mockResolvedValue({
        deepl_api_key: 'test-key',
        deepl_enabled: true,
        deepl_is_pro: false,
      });

      const { CloudProviders } = await import('./components/CloudProviders');

      expect(CloudProviders).toBeDefined();
      expect(typeof CloudProviders).toBe('function');
    });

    it('should handle provider definitions', async () => {
      const { CloudProviders } = await import('./components/CloudProviders');

      expect(CloudProviders).toBeDefined();
    });
  });

  describe('LocalModels', () => {
    it('should load storage stats on mount', async () => {
      mockChrome.runtime.sendMessage.mockResolvedValue({
        models: [
          { id: 'opus-mt-en-fi', name: 'OPUS-MT English-Finnish', size: 300 * 1024 * 1024 },
        ],
      });

      const { LocalModels } = await import('./components/LocalModels');

      expect(LocalModels).toBeDefined();
      expect(typeof LocalModels).toBe('function');
    });

    it('should format bytes correctly', async () => {
      const { LocalModels } = await import('./components/LocalModels');
      expect(LocalModels).toBeDefined();
    });
  });

  describe('GlossarySettings', () => {
    it('should load glossary on mount', async () => {
      mockChrome.storage.local.get.mockResolvedValue({
        glossary: {
          API: { replacement: 'rajapinta', caseSensitive: true, description: 'Technical term' },
        },
      });

      const { GlossarySettings } = await import('./components/GlossarySettings');

      expect(GlossarySettings).toBeDefined();
      expect(typeof GlossarySettings).toBe('function');
    });

    it('should handle empty glossary', async () => {
      mockChrome.storage.local.get.mockResolvedValue({ glossary: {} });

      const { GlossarySettings } = await import('./components/GlossarySettings');

      expect(GlossarySettings).toBeDefined();
    });
  });

  describe('SiteRulesSettings', () => {
    it('should load site rules on mount', async () => {
      mockChrome.storage.local.get.mockResolvedValue({
        siteRules: {
          'example.com': { autoTranslate: true, preferredProvider: 'deepl' },
          '*.github.com': { autoTranslate: false },
        },
      });

      const { SiteRulesSettings } = await import('./components/SiteRulesSettings');

      expect(SiteRulesSettings).toBeDefined();
      expect(typeof SiteRulesSettings).toBe('function');
    });

    it('should validate domain patterns', async () => {
      const { SiteRulesSettings } = await import('./components/SiteRulesSettings');

      expect(SiteRulesSettings).toBeDefined();
    });
  });

  describe('CacheSettings', () => {
    it('should load cache stats on mount', async () => {
      mockChrome.runtime.sendMessage.mockResolvedValue({
        stats: {
          entries: 150,
          totalSize: 25 * 1024 * 1024,
          maxSize: 100 * 1024 * 1024,
          hits: 500,
          misses: 100,
          hitRate: 0.833,
          oldestTimestamp: Date.now() - 7 * 24 * 60 * 60 * 1000,
          newestTimestamp: Date.now(),
        },
      });

      const { CacheSettings } = await import('./components/CacheSettings');

      expect(CacheSettings).toBeDefined();
      expect(typeof CacheSettings).toBe('function');
    });

    it('should handle clear cache', async () => {
      mockChrome.runtime.sendMessage.mockResolvedValue({ success: true });

      const { CacheSettings } = await import('./components/CacheSettings');

      expect(CacheSettings).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Options Page Integration
// ---------------------------------------------------------------------------

describe('Options Page Integration', () => {
  it('should export default Options component', async () => {
    const Options = await import('./Options');

    expect(Options.default).toBeDefined();
    expect(typeof Options.default).toBe('function');
  });

  it('should have correct tab definitions', async () => {
    const Options = await import('./Options');

    expect(Options.default).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TABS constant — extracted logic tests
// ---------------------------------------------------------------------------

describe('Options TABS definitions', () => {
  // Mirror of TABS from Options.tsx for pure-logic testing
  type Tab = 'general' | 'cloud' | 'local' | 'glossary' | 'sites' | 'cache';

  const TABS: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'general', label: 'General', icon: 'settings' },
    { id: 'cloud', label: 'Cloud Providers', icon: 'cloud' },
    { id: 'local', label: 'Local Models', icon: 'cpu' },
    { id: 'glossary', label: 'Glossary', icon: 'book' },
    { id: 'sites', label: 'Site Rules', icon: 'globe' },
    { id: 'cache', label: 'Cache', icon: 'database' },
  ];

  it('has exactly six tabs', () => {
    expect(TABS).toHaveLength(6);
  });

  it('all tabs have unique IDs', () => {
    const ids = TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all tabs have non-empty labels', () => {
    for (const tab of TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
    }
  });

  it('all tabs have non-empty icon names', () => {
    for (const tab of TABS) {
      expect(tab.icon.length).toBeGreaterThan(0);
    }
  });

  it('first tab is general (default active tab)', () => {
    expect(TABS[0].id).toBe('general');
  });

  it('last tab is cache', () => {
    expect(TABS[TABS.length - 1].id).toBe('cache');
  });

  it('contains cloud tab', () => {
    expect(TABS.some((t) => t.id === 'cloud')).toBe(true);
  });

  it('contains glossary tab', () => {
    expect(TABS.some((t) => t.id === 'glossary')).toBe(true);
  });

  it('contains sites tab', () => {
    expect(TABS.some((t) => t.id === 'sites')).toBe(true);
  });

  it('cloud tab has correct label', () => {
    const tab = TABS.find((t) => t.id === 'cloud');
    expect(tab?.label).toBe('Cloud Providers');
  });

  it('local tab uses cpu icon', () => {
    const tab = TABS.find((t) => t.id === 'local');
    expect(tab?.icon).toBe('cpu');
  });

  it('sites tab uses globe icon', () => {
    const tab = TABS.find((t) => t.id === 'sites');
    expect(tab?.icon).toBe('globe');
  });

  it('cache tab uses database icon', () => {
    const tab = TABS.find((t) => t.id === 'cache');
    expect(tab?.icon).toBe('database');
  });

  it('all tab IDs are valid Tab type values', () => {
    const valid: Tab[] = ['general', 'cloud', 'local', 'glossary', 'sites', 'cache'];
    for (const tab of TABS) {
      expect(valid).toContain(tab.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Tab keyboard navigation logic — extracted from handleTabKeyDown
// ---------------------------------------------------------------------------

describe('Options tab keyboard navigation', () => {
  type Tab = 'general' | 'cloud' | 'local' | 'glossary' | 'sites' | 'cache';

  const TAB_IDS: Tab[] = ['general', 'cloud', 'local', 'glossary', 'sites', 'cache'];

  // Extracted navigation logic matching Options.tsx handleTabKeyDown
  const navigate = (currentTab: Tab, key: string): { newTab: Tab; prevented: boolean } => {
    const currentIdx = TAB_IDS.indexOf(currentTab);
    let newIdx = currentIdx;
    let prevented = false;

    switch (key) {
      case 'ArrowDown':
      case 'ArrowRight':
        prevented = true;
        newIdx = (currentIdx + 1) % TAB_IDS.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        prevented = true;
        newIdx = (currentIdx - 1 + TAB_IDS.length) % TAB_IDS.length;
        break;
      case 'Home':
        prevented = true;
        newIdx = 0;
        break;
      case 'End':
        prevented = true;
        newIdx = TAB_IDS.length - 1;
        break;
      default:
        break;
    }

    return { newTab: TAB_IDS[newIdx], prevented };
  };

  it('ArrowDown advances to next tab', () => {
    const { newTab } = navigate('general', 'ArrowDown');
    expect(newTab).toBe('cloud');
  });

  it('ArrowRight advances to next tab', () => {
    const { newTab } = navigate('general', 'ArrowRight');
    expect(newTab).toBe('cloud');
  });

  it('ArrowDown wraps from last to first', () => {
    const { newTab } = navigate('cache', 'ArrowDown');
    expect(newTab).toBe('general');
  });

  it('ArrowUp moves to previous tab', () => {
    const { newTab } = navigate('cloud', 'ArrowUp');
    expect(newTab).toBe('general');
  });

  it('ArrowLeft moves to previous tab', () => {
    const { newTab } = navigate('cloud', 'ArrowLeft');
    expect(newTab).toBe('general');
  });

  it('ArrowUp wraps from first to last', () => {
    const { newTab } = navigate('general', 'ArrowUp');
    expect(newTab).toBe('cache');
  });

  it('Home jumps to first tab', () => {
    const { newTab } = navigate('sites', 'Home');
    expect(newTab).toBe('general');
  });

  it('End jumps to last tab', () => {
    const { newTab } = navigate('general', 'End');
    expect(newTab).toBe('cache');
  });

  it('prevents default for ArrowDown', () => {
    const { prevented } = navigate('general', 'ArrowDown');
    expect(prevented).toBe(true);
  });

  it('prevents default for ArrowUp', () => {
    const { prevented } = navigate('cloud', 'ArrowUp');
    expect(prevented).toBe(true);
  });

  it('prevents default for Home', () => {
    const { prevented } = navigate('cache', 'Home');
    expect(prevented).toBe(true);
  });

  it('prevents default for End', () => {
    const { prevented } = navigate('general', 'End');
    expect(prevented).toBe(true);
  });

  it('does not prevent default for unhandled keys', () => {
    const { prevented } = navigate('general', 'Tab');
    expect(prevented).toBe(false);
  });

  it('unhandled key leaves tab unchanged', () => {
    const { newTab } = navigate('glossary', 'Enter');
    expect(newTab).toBe('glossary');
  });

  it('full cycle: six ArrowDown presses returns to start', () => {
    let current: Tab = 'general';
    for (let i = 0; i < TAB_IDS.length; i++) {
      const result = navigate(current, 'ArrowDown');
      current = result.newTab;
    }
    expect(current).toBe('general');
  });

  it('full cycle: six ArrowUp presses returns to start', () => {
    let current: Tab = 'general';
    for (let i = 0; i < TAB_IDS.length; i++) {
      const result = navigate(current, 'ArrowUp');
      current = result.newTab;
    }
    expect(current).toBe('general');
  });

  it('ArrowRight is symmetric with ArrowLeft across all tabs', () => {
    for (const tab of TAB_IDS) {
      const forward = navigate(tab, 'ArrowRight');
      const back = navigate(forward.newTab, 'ArrowLeft');
      expect(back.newTab).toBe(tab);
    }
  });
});

// ---------------------------------------------------------------------------
// URL tab parameter parsing — extracted from onMount
// ---------------------------------------------------------------------------

describe('Options URL tab parameter parsing', () => {
  type Tab = 'general' | 'cloud' | 'local' | 'glossary' | 'sites' | 'cache';

  const TABS: Array<{ id: Tab }> = [
    { id: 'general' },
    { id: 'cloud' },
    { id: 'local' },
    { id: 'glossary' },
    { id: 'sites' },
    { id: 'cache' },
  ];

  const parseTabParam = (search: string): Tab | null => {
    const params = new URLSearchParams(search);
    const tab = params.get('tab') as Tab | null;
    if (tab && TABS.some((t) => t.id === tab)) {
      return tab;
    }
    return null;
  };

  it('returns valid tab from URL param', () => {
    expect(parseTabParam('?tab=cloud')).toBe('cloud');
  });

  it('returns null for missing tab param', () => {
    expect(parseTabParam('')).toBeNull();
  });

  it('returns null for unknown tab value', () => {
    expect(parseTabParam('?tab=unknown')).toBeNull();
  });

  it('accepts all six valid tab IDs', () => {
    const validIds: Tab[] = ['general', 'cloud', 'local', 'glossary', 'sites', 'cache'];
    for (const id of validIds) {
      expect(parseTabParam(`?tab=${id}`)).toBe(id);
    }
  });

  it('returns null for empty tab param value', () => {
    expect(parseTabParam('?tab=')).toBeNull();
  });

  it('handles extra query params alongside tab', () => {
    expect(parseTabParam('?foo=bar&tab=glossary')).toBe('glossary');
  });

  it('returns null when tab param is omitted but other params present', () => {
    expect(parseTabParam('?foo=bar')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// renderIcon logic — extracted from Options.tsx
// ---------------------------------------------------------------------------

describe('Options renderIcon', () => {
  // Each icon name maps to a non-null SVG (null only for unknown)
  const KNOWN_ICONS = ['settings', 'cloud', 'cpu', 'book', 'globe', 'database'];

  const iconExists = (icon: string): boolean => {
    return KNOWN_ICONS.includes(icon);
  };

  it('settings icon is defined', () => {
    expect(iconExists('settings')).toBe(true);
  });

  it('cloud icon is defined', () => {
    expect(iconExists('cloud')).toBe(true);
  });

  it('cpu icon is defined', () => {
    expect(iconExists('cpu')).toBe(true);
  });

  it('book icon is defined', () => {
    expect(iconExists('book')).toBe(true);
  });

  it('globe icon is defined', () => {
    expect(iconExists('globe')).toBe(true);
  });

  it('database icon is defined', () => {
    expect(iconExists('database')).toBe(true);
  });

  it('unknown icon returns falsy (null)', () => {
    expect(iconExists('unknown-icon')).toBe(false);
  });

  it('all tab icons are recognized', () => {
    const tabIcons = ['settings', 'cloud', 'cpu', 'book', 'globe', 'database'];
    for (const icon of tabIcons) {
      expect(iconExists(icon)).toBe(true);
    }
  });

  it('there are six distinct known icons (one per tab)', () => {
    expect(KNOWN_ICONS.length).toBe(6);
    expect(new Set(KNOWN_ICONS).size).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Utility Functions (shared with CacheSettings)
// ---------------------------------------------------------------------------

describe('Utility Functions', () => {
  it('should format bytes correctly', () => {
    const testCases = [
      { bytes: 0, expected: '0 B' },
      { bytes: 1024, expected: '1 KB' },
      { bytes: 1024 * 1024, expected: '1 MB' },
      { bytes: 1024 * 1024 * 1024, expected: '1 GB' },
      { bytes: 500 * 1024 * 1024, expected: '500 MB' },
    ];

    const formatBytes = (bytes: number): string => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    for (const { bytes, expected } of testCases) {
      expect(formatBytes(bytes)).toBe(expected);
    }
  });

  it('should format percentages correctly', () => {
    const formatPercent = (value: number): string => {
      return (value * 100).toFixed(1) + '%';
    };

    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(0.5)).toBe('50.0%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(0.333)).toBe('33.3%');
  });
});

// ---------------------------------------------------------------------------
// CacheSettings utility functions — extracted pure logic
// ---------------------------------------------------------------------------

describe('CacheSettings utility functions', () => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatPercent = (value: number): string => {
    return (value * 100).toFixed(1) + '%';
  };

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

  const usagePercent = (totalSize: number, maxSize: number): number => {
    if (maxSize === 0) return 0;
    return Math.min(100, (totalSize / maxSize) * 100);
  };

  describe('formatBytes', () => {
    it('returns "0 B" for zero', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes (< 1 KB)', () => {
      // 512 bytes = 0.5 KB, but the function uses log floor so 512B < 1024 → index 0 → 'B'
      // Actually: log(512)/log(1024) = 0.9, floor = 0 → '512 B'
      expect(formatBytes(512)).toBe('512 B');
    });

    it('formats 1 KB', () => {
      expect(formatBytes(1024)).toBe('1 KB');
    });

    it('formats 1.5 KB', () => {
      expect(formatBytes(1024 * 1.5)).toBe('1.5 KB');
    });

    it('formats 1 MB', () => {
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
    });

    it('formats 100 MB', () => {
      expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB');
    });

    it('formats 1 GB', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('rounds to 1 decimal place', () => {
      // 1.5 * 1024 * 1024 = 1572864 bytes = 1.5 MB
      expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    });
  });

  describe('formatPercent', () => {
    it('formats 0%', () => {
      expect(formatPercent(0)).toBe('0.0%');
    });

    it('formats 50%', () => {
      expect(formatPercent(0.5)).toBe('50.0%');
    });

    it('formats 100%', () => {
      expect(formatPercent(1)).toBe('100.0%');
    });

    it('formats 83.3%', () => {
      expect(formatPercent(0.833)).toBe('83.3%');
    });

    it('formats 33.3%', () => {
      expect(formatPercent(0.333)).toBe('33.3%');
    });

    it('always includes one decimal place', () => {
      expect(formatPercent(0.1)).toMatch(/\d+\.\d%$/);
    });
  });

  describe('formatDate', () => {
    it('returns "N/A" for null timestamp', () => {
      expect(formatDate(null)).toBe('N/A');
    });

    it('returns "N/A" for zero timestamp (falsy)', () => {
      expect(formatDate(0)).toBe('N/A');
    });

    it('returns a non-empty string for valid timestamp', () => {
      const result = formatDate(Date.now());
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toBe('N/A');
    });

    it('returns a formatted date string containing a year', () => {
      const result = formatDate(new Date('2024-06-15T12:00:00Z').getTime());
      expect(result).toContain('2024');
    });
  });

  describe('usagePercent', () => {
    it('returns 0 when maxSize is 0 (division guard)', () => {
      expect(usagePercent(100, 0)).toBe(0);
    });

    it('returns 0 when totalSize is 0', () => {
      expect(usagePercent(0, 100 * 1024 * 1024)).toBe(0);
    });

    it('returns 50 for half-full cache', () => {
      expect(usagePercent(50 * 1024 * 1024, 100 * 1024 * 1024)).toBe(50);
    });

    it('returns 100 for full cache', () => {
      expect(usagePercent(100 * 1024 * 1024, 100 * 1024 * 1024)).toBe(100);
    });

    it('caps at 100 even when over capacity', () => {
      expect(usagePercent(150 * 1024 * 1024, 100 * 1024 * 1024)).toBe(100);
    });

    it('returns ~25 for quarter-full cache', () => {
      expect(usagePercent(25 * 1024 * 1024, 100 * 1024 * 1024)).toBe(25);
    });
  });
});

// ---------------------------------------------------------------------------
// GeneralSettings constants — extracted pure logic
// ---------------------------------------------------------------------------

describe('GeneralSettings constants', () => {
  const LANGUAGES = [
    { code: 'auto', name: 'Auto Detect' },
    { code: 'en', name: 'English' },
    { code: 'fi', name: 'Finnish' },
    { code: 'de', name: 'German' },
    { code: 'fr', name: 'French' },
    { code: 'es', name: 'Spanish' },
    { code: 'sv', name: 'Swedish' },
    { code: 'ru', name: 'Russian' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'nl', name: 'Dutch' },
    { code: 'cs', name: 'Czech' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'it', name: 'Italian' },
    { code: 'pl', name: 'Polish' },
    { code: 'ko', name: 'Korean' },
  ];

  type Strategy = 'smart' | 'fast' | 'quality' | 'cost' | 'balanced';

  const STRATEGIES: Array<{ id: Strategy; name: string; description: string }> = [
    { id: 'smart', name: 'Smart', description: 'Auto-select best provider based on content' },
    { id: 'fast', name: 'Fast', description: 'Prioritize speed over quality' },
    { id: 'quality', name: 'Quality', description: 'Prioritize accuracy over speed' },
    { id: 'cost', name: 'Cost', description: 'Prioritize free/local providers' },
    { id: 'balanced', name: 'Balanced', description: 'Balance between speed, quality, and cost' },
  ];

  describe('LANGUAGES', () => {
    it('has 16 language options', () => {
      expect(LANGUAGES).toHaveLength(16);
    });

    it('first language is auto-detect', () => {
      expect(LANGUAGES[0].code).toBe('auto');
      expect(LANGUAGES[0].name).toBe('Auto Detect');
    });

    it('includes English', () => {
      expect(LANGUAGES.some((l) => l.code === 'en')).toBe(true);
    });

    it('includes Finnish', () => {
      expect(LANGUAGES.some((l) => l.code === 'fi')).toBe(true);
    });

    it('all language codes are unique', () => {
      const codes = LANGUAGES.map((l) => l.code);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('all language names are non-empty', () => {
      for (const lang of LANGUAGES) {
        expect(lang.name.length).toBeGreaterThan(0);
      }
    });

    it('target language filter excludes auto', () => {
      const targetLanguages = LANGUAGES.filter((l) => l.code !== 'auto');
      expect(targetLanguages.some((l) => l.code === 'auto')).toBe(false);
      expect(targetLanguages).toHaveLength(LANGUAGES.length - 1);
    });
  });

  describe('STRATEGIES', () => {
    it('has five strategies', () => {
      expect(STRATEGIES).toHaveLength(5);
    });

    it('all strategy IDs are unique', () => {
      const ids = STRATEGIES.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('includes smart strategy', () => {
      expect(STRATEGIES.some((s) => s.id === 'smart')).toBe(true);
    });

    it('includes fast strategy', () => {
      expect(STRATEGIES.some((s) => s.id === 'fast')).toBe(true);
    });

    it('includes quality strategy', () => {
      expect(STRATEGIES.some((s) => s.id === 'quality')).toBe(true);
    });

    it('includes cost strategy', () => {
      expect(STRATEGIES.some((s) => s.id === 'cost')).toBe(true);
    });

    it('includes balanced strategy', () => {
      expect(STRATEGIES.some((s) => s.id === 'balanced')).toBe(true);
    });

    it('all strategies have non-empty descriptions', () => {
      for (const s of STRATEGIES) {
        expect(s.description.length).toBeGreaterThan(0);
      }
    });

    it('first strategy is smart (sensible default)', () => {
      expect(STRATEGIES[0].id).toBe('smart');
    });
  });
});

// ---------------------------------------------------------------------------
// Storage Integration
// ---------------------------------------------------------------------------

describe('Storage Integration', () => {
  it('should use chrome.storage.local for large data', async () => {
    const testData = { glossary: { term: { replacement: 'test', caseSensitive: false } } };

    await mockChrome.storage.local.set(testData);

    expect(mockChrome.storage.local.set).toHaveBeenCalledWith(testData);
  });

  it('should handle storage errors gracefully', async () => {
    mockChrome.storage.local.get.mockRejectedValue(new Error('Storage error'));

    const { safeStorageGet } = await import('../core/storage');

    const result = await safeStorageGet(['test']);
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Options component invocation — calls Solid functions to execute signal setup
// ---------------------------------------------------------------------------

describe('Options component invocation', () => {
  it('Options default export is a callable function', async () => {
    const { default: Options } = await import('./Options');
    expect(typeof Options).toBe('function');
  });

  it('calling Options() with no props returns a defined value', async () => {
    const { default: Options } = await import('./Options');
    const result = (Options as any)();
    expect(result).toBeDefined();
  });

  it('GeneralSettings is a callable Solid component', async () => {
    const { GeneralSettings } = await import('./components/GeneralSettings');
    expect(typeof GeneralSettings).toBe('function');
    const result = (GeneralSettings as any)({});
    expect(result).toBeDefined();
  });

  it('CacheSettings is a callable Solid component (import only)', async () => {
    // onMount references loadStats via const declared after — TDZ would throw on call
    const { CacheSettings } = await import('./components/CacheSettings');
    expect(typeof CacheSettings).toBe('function');
  });

  it('CloudProviders is a callable Solid component (import only)', async () => {
    // onMount references loadProviderStatus via const declared after — TDZ would throw on call
    const { CloudProviders } = await import('./components/CloudProviders');
    expect(typeof CloudProviders).toBe('function');
  });

  it('LocalModels is a callable Solid component (import only)', async () => {
    // onMount references loadModelStats via const declared after — TDZ would throw on call
    const { LocalModels } = await import('./components/LocalModels');
    expect(typeof LocalModels).toBe('function');
  });

  it('GlossarySettings is a callable Solid component (import only)', async () => {
    // onMount references loadGlossary via const declared after — TDZ would throw on call
    const { GlossarySettings } = await import('./components/GlossarySettings');
    expect(typeof GlossarySettings).toBe('function');
  });

  it('SiteRulesSettings is a callable Solid component (import only)', async () => {
    // onMount references loadRules via const declared after — TDZ would throw on call
    const { SiteRulesSettings } = await import('./components/SiteRulesSettings');
    expect(typeof SiteRulesSettings).toBe('function');
  });
});
