/**
 * ModelSelector component unit tests
 *
 * Tests the exported types, constants, and component interface.
 */

import { describe, it, expect, vi } from 'vitest';
import { ModelSelector, MODELS, type ModelDownloadStatus, type ModelInfo } from './ModelSelector';
import type { TranslationProviderId } from '../../types';

describe('MODELS constant', () => {
  it('exports two model configurations', () => {
    expect(MODELS).toBeDefined();
    expect(MODELS.length).toBe(2);
  });

  describe('opus-mt model', () => {
    const opusMt = MODELS.find((m) => m.id === 'opus-mt');

    it('exists in the model list', () => {
      expect(opusMt).toBeDefined();
    });

    it('has correct id', () => {
      expect(opusMt?.id).toBe('opus-mt');
    });

    it('has correct name', () => {
      expect(opusMt?.name).toBe('OPUS-MT');
    });

    it('has Fast tag', () => {
      expect(opusMt?.tag).toBe('Fast');
    });

    it('indicates Helsinki-NLP description', () => {
      expect(opusMt?.description).toBe('Helsinki-NLP');
    });

    it('shows ~170MB per pair size', () => {
      expect(opusMt?.size).toBe('~170MB per pair');
    });
  });

  describe('translategemma model', () => {
    const gemma = MODELS.find((m) => m.id === 'translategemma');

    it('exists in the model list', () => {
      expect(gemma).toBeDefined();
    });

    it('has correct id', () => {
      expect(gemma?.id).toBe('translategemma');
    });

    it('has correct name', () => {
      expect(gemma?.name).toBe('TranslateGemma');
    });

    it('has Quality tag', () => {
      expect(gemma?.tag).toBe('Quality');
    });

    it('indicates Google 4B description', () => {
      expect(gemma?.description).toBe('Google 4B');
    });

    it('shows ~3.6GB size', () => {
      expect(gemma?.size).toBe('~3.6GB');
    });
  });
});

describe('ModelDownloadStatus type', () => {
  it('has correct shape for idle state', () => {
    const status: ModelDownloadStatus = {
      isDownloading: false,
      progress: 0,
      isDownloaded: false,
      error: null,
    };

    expect(status.isDownloading).toBe(false);
    expect(status.progress).toBe(0);
    expect(status.isDownloaded).toBe(false);
    expect(status.error).toBeNull();
  });

  it('has correct shape for downloading state', () => {
    const status: ModelDownloadStatus = {
      isDownloading: true,
      progress: 45,
      isDownloaded: false,
      error: null,
    };

    expect(status.isDownloading).toBe(true);
    expect(status.progress).toBe(45);
    expect(status.isDownloaded).toBe(false);
  });

  it('has correct shape for completed state', () => {
    const status: ModelDownloadStatus = {
      isDownloading: false,
      progress: 100,
      isDownloaded: true,
      error: null,
    };

    expect(status.isDownloading).toBe(false);
    expect(status.progress).toBe(100);
    expect(status.isDownloaded).toBe(true);
  });

  it('has correct shape for error state', () => {
    const status: ModelDownloadStatus = {
      isDownloading: false,
      progress: 0,
      isDownloaded: false,
      error: 'Network error',
    };

    expect(status.isDownloading).toBe(false);
    expect(status.error).toBe('Network error');
  });
});

describe('ModelInfo type', () => {
  it('matches expected structure', () => {
    const model: ModelInfo = {
      id: 'opus-mt',
      name: 'OPUS-MT',
      tag: 'Fast',
      description: 'Helsinki-NLP',
      size: '~170MB per pair',
    };

    expect(model.id).toBe('opus-mt');
    expect(model.name).toBe('OPUS-MT');
    expect(model.tag).toBe('Fast');
    expect(model.description).toBe('Helsinki-NLP');
    expect(model.size).toBe('~170MB per pair');
  });
});

describe('ModelSelector component', () => {
  it('exports ModelSelector as a function', () => {
    expect(typeof ModelSelector).toBe('function');
  });

  it('is a Solid component (accepts props)', () => {
    // Verify the function signature by calling it with expected props
    // This tests that the component can be constructed without errors
    const props = {
      selected: 'opus-mt' as TranslationProviderId,
      onChange: vi.fn(),
      downloadStatus: undefined,
    };

    // The component should be callable (Solid.js components are functions)
    expect(() => {
      // We just verify the component is callable with the right props
      // Actual rendering would require Solid's testing utilities
      const result = ModelSelector(props);
      expect(result).toBeDefined();
    }).not.toThrow();
  });

  it('accepts downloadStatus prop with all providers', () => {
    const downloadStatus: Record<TranslationProviderId, ModelDownloadStatus> = {
      'opus-mt': {
        isDownloading: false,
        progress: 0,
        isDownloaded: false,
        error: null,
      },
      'translategemma': {
        isDownloading: true,
        progress: 50,
        isDownloaded: false,
        error: null,
      },
      // Chrome Built-in Translator (Chrome 138+) - no download needed
      'chrome-builtin': { isDownloading: false, progress: 100, isDownloaded: true, error: null },
      // Cloud providers - always "ready" (no download needed)
      'deepl': { isDownloading: false, progress: 100, isDownloaded: true, error: null },
      'openai': { isDownloading: false, progress: 100, isDownloaded: true, error: null },
      'google-cloud': { isDownloading: false, progress: 100, isDownloaded: true, error: null },
      'anthropic': { isDownloading: false, progress: 100, isDownloaded: true, error: null },
    };

    const props = {
      selected: 'opus-mt' as TranslationProviderId,
      onChange: vi.fn(),
      downloadStatus,
    };

    expect(() => {
      const result = ModelSelector(props);
      expect(result).toBeDefined();
    }).not.toThrow();
  });
});

describe('model validation', () => {
  it('all models have unique ids', () => {
    const ids = MODELS.map((m) => m.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all models have non-empty names', () => {
    for (const model of MODELS) {
      expect(model.name.length).toBeGreaterThan(0);
    }
  });

  it('all models have non-empty tags', () => {
    for (const model of MODELS) {
      expect(model.tag.length).toBeGreaterThan(0);
    }
  });

  it('all models have non-empty sizes', () => {
    for (const model of MODELS) {
      expect(model.size.length).toBeGreaterThan(0);
    }
  });

  it('model ids match TranslationProviderId type', () => {
    const validIds: TranslationProviderId[] = ['opus-mt', 'translategemma'];
    for (const model of MODELS) {
      expect(validIds).toContain(model.id);
    }
  });
});
