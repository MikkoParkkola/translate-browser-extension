/**
 * Barrel export tests for popup/components/index.ts
 *
 * Verifies all named exports are defined and correctly typed.
 */

import { describe, it, expect, vi } from 'vitest';

// Chrome API mock — required because some components reference chrome on import
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    openOptionsPage: vi.fn(),
  },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue({}),
  },
  scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
});

// Mock modules that do async work on import to avoid side effects
vi.mock('../../core/glossary', () => ({
  glossary: {
    getGlossary: vi.fn().mockResolvedValue({}),
    addTerm: vi.fn(),
    removeTerm: vi.fn(),
    clearGlossary: vi.fn(),
    exportGlossary: vi.fn(),
    importGlossary: vi.fn(),
  },
}));

vi.mock('../../core/site-rules', () => ({
  siteRules: {
    getAllRules: vi.fn().mockResolvedValue({}),
    getRules: vi.fn().mockResolvedValue(null),
    setRules: vi.fn(),
    clearRules: vi.fn(),
    exportRules: vi.fn(),
    importRules: vi.fn(),
  },
}));

vi.mock('../../shared/ConfirmDialog', () => ({
  ConfirmDialog: (__props: any) => null,
}));

import {
  ProviderStatus,
  LanguageSelector,
  StrategySelector,
  UsageBar,
  CostMonitor,
  ModelSelector,
  MODELS,
  ProviderSelector,
  SiteRulesManager,
  GlossaryManager,
  ApiKeyManager,
} from './index';

describe('popup/components barrel exports', () => {
  // -----------------------------------------------------------------------
  // All named exports are defined
  // -----------------------------------------------------------------------

  it('exports ProviderStatus', () => {
    expect(ProviderStatus).toBeTypeOf('function');
  });

  it('exports LanguageSelector', () => {
    expect(LanguageSelector).toBeTypeOf('function');
  });

  it('exports StrategySelector', () => {
    expect(StrategySelector).toBeTypeOf('function');
  });

  it('exports UsageBar', () => {
    expect(UsageBar).toBeTypeOf('function');
  });

  it('exports CostMonitor', () => {
    expect(CostMonitor).toBeTypeOf('function');
  });

  it('exports ModelSelector', () => {
    expect(ModelSelector).toBeTypeOf('function');
  });

  it('exports MODELS', () => {
    expect(Array.isArray(MODELS)).toBe(true);
  });

  it('exports ProviderSelector', () => {
    expect(ProviderSelector).toBeTypeOf('function');
  });

  it('exports SiteRulesManager', () => {
    expect(SiteRulesManager).toBeTypeOf('function');
  });

  it('exports GlossaryManager', () => {
    expect(GlossaryManager).toBeTypeOf('function');
  });

  it('exports ApiKeyManager', () => {
    expect(ApiKeyManager).toBeTypeOf('function');
  });

  // -----------------------------------------------------------------------
  // Components are functions
  // -----------------------------------------------------------------------

  it('ProviderStatus is a function', () => {
    expect(typeof ProviderStatus).toBe('function');
  });

  it('LanguageSelector is a function', () => {
    expect(typeof LanguageSelector).toBe('function');
  });

  it('StrategySelector is a function', () => {
    expect(typeof StrategySelector).toBe('function');
  });

  it('UsageBar is a function', () => {
    expect(typeof UsageBar).toBe('function');
  });

  it('CostMonitor is a function', () => {
    expect(typeof CostMonitor).toBe('function');
  });

  it('ModelSelector is a function', () => {
    expect(typeof ModelSelector).toBe('function');
  });

  it('ProviderSelector is a function', () => {
    expect(typeof ProviderSelector).toBe('function');
  });

  it('SiteRulesManager is a function', () => {
    expect(typeof SiteRulesManager).toBe('function');
  });

  it('GlossaryManager is a function', () => {
    expect(typeof GlossaryManager).toBe('function');
  });

  it('ApiKeyManager is a function', () => {
    expect(typeof ApiKeyManager).toBe('function');
  });

  // -----------------------------------------------------------------------
  // MODELS is an array
  // -----------------------------------------------------------------------

  it('MODELS is an array', () => {
    expect(Array.isArray(MODELS)).toBe(true);
  });

  it('MODELS has at least one entry', () => {
    expect(MODELS.length).toBeGreaterThan(0);
  });

  it('each MODELS entry has id and name', () => {
    for (const model of MODELS) {
      expect(model.id).toBeTypeOf('string');
      expect(model.name).toBeTypeOf('string');
    }
  });
});
