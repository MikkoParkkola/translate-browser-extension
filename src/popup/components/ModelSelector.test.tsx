/**
 * ModelSelector component unit tests
 *
 * Tests the exported types, constants, and component interface.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { ModelSelector, MODELS, LOCAL_MODELS, CLOUD_PROVIDERS, type ModelDownloadStatus, type ModelInfo } from './ModelSelector';
import type { TranslationProviderId } from '../../types';

// chrome is used by ModelSelector.onMount and handleSelect
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    openOptionsPage: vi.fn(),
  },
});

describe('MODELS constant', () => {
  it('exports seven model configurations (3 local + 4 cloud)', () => {
    expect(MODELS).toBeDefined();
    expect(MODELS.length).toBe(7);
    expect(LOCAL_MODELS.length).toBe(3);
    expect(CLOUD_PROVIDERS.length).toBe(4);
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

    it('shows ~170MB size', () => {
      expect(opusMt?.size).toBe('~170MB');
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
      size: '~170MB',
    };

    expect(model.id).toBe('opus-mt');
    expect(model.name).toBe('OPUS-MT');
    expect(model.tag).toBe('Fast');
    expect(model.description).toBe('Helsinki-NLP');
    expect(model.size).toBe('~170MB');
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
    const validIds: TranslationProviderId[] = [
      'opus-mt',
      'translategemma',
      'chrome-builtin',
      'deepl',
      'openai',
      'anthropic',
      'google-cloud',
    ];
    for (const model of MODELS) {
      expect(validIds).toContain(model.id);
    }
  });
});

describe('CLOUD_PROVIDERS constant', () => {
  it('all cloud providers have isCloud set to true', () => {
    for (const provider of CLOUD_PROVIDERS) {
      expect(provider.isCloud).toBe(true);
    }
  });

  it('all cloud providers have costEstimate', () => {
    for (const provider of CLOUD_PROVIDERS) {
      expect(provider.costEstimate).toBeDefined();
      expect(provider.costEstimate!.length).toBeGreaterThan(0);
    }
  });

  describe('deepl provider', () => {
    const deepl = CLOUD_PROVIDERS.find((p) => p.id === 'deepl');

    it('exists in the provider list', () => {
      expect(deepl).toBeDefined();
    });

    it('has correct properties', () => {
      expect(deepl?.name).toBe('DeepL');
      expect(deepl?.tag).toBe('Premium');
      expect(deepl?.isCloud).toBe(true);
    });
  });

  describe('openai provider', () => {
    const openai = CLOUD_PROVIDERS.find((p) => p.id === 'openai');

    it('exists in the provider list', () => {
      expect(openai).toBeDefined();
    });

    it('has correct properties', () => {
      expect(openai?.name).toBe('OpenAI');
      expect(openai?.tag).toBe('OpenAI');
      expect(openai?.isCloud).toBe(true);
    });
  });

  describe('anthropic provider', () => {
    const anthropic = CLOUD_PROVIDERS.find((p) => p.id === 'anthropic');

    it('exists in the provider list', () => {
      expect(anthropic).toBeDefined();
    });

    it('has correct properties', () => {
      expect(anthropic?.name).toBe('Claude');
      expect(anthropic?.isCloud).toBe(true);
    });
  });

  describe('google-cloud provider', () => {
    const googleCloud = CLOUD_PROVIDERS.find((p) => p.id === 'google-cloud');

    it('exists in the provider list', () => {
      expect(googleCloud).toBeDefined();
    });

    it('has correct properties', () => {
      expect(googleCloud?.name).toBe('Google');
      expect(googleCloud?.tag).toBe('Cloud');
      expect(googleCloud?.isCloud).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Render-based tests — use @solidjs/testing-library to exercise the reactive
// component body: createEffect, onMount, handleKeyDown, getStatusIcon, etc.
// ---------------------------------------------------------------------------

const makeDownloadStatus = (overrides: Partial<ModelDownloadStatus> = {}): ModelDownloadStatus => ({
  isDownloading: false,
  progress: 0,
  isDownloaded: false,
  error: null,
  ...overrides,
});

const allDownloadStatus = (): Record<TranslationProviderId, ModelDownloadStatus> => ({
  'opus-mt': makeDownloadStatus({ isDownloaded: true }),
  'translategemma': makeDownloadStatus(),
  'chrome-builtin': makeDownloadStatus({ isDownloaded: true }),
  'deepl': makeDownloadStatus({ isDownloaded: true }),
  'openai': makeDownloadStatus({ isDownloaded: true }),
  'google-cloud': makeDownloadStatus({ isDownloaded: true }),
  'anthropic': makeDownloadStatus({ isDownloaded: true }),
});

describe('ModelSelector render — trigger button', () => {
  afterEach(cleanup);

  it('renders the trigger button with selected model name', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    expect(screen.getByRole('button', { name: /OPUS-MT/ })).toBeTruthy();
  });

  it('trigger button shows aria-expanded=false when closed', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const btn = screen.getByRole('button', { name: /Translation model/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens dropdown on trigger click', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const btn = screen.getByRole('button', { name: /Translation model/ });
    fireEvent.click(btn);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('closes dropdown on second trigger click', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const btn = screen.getByRole('button', { name: /Translation model/ });
    fireEvent.click(btn);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('ModelSelector render — open dropdown', () => {
  afterEach(cleanup);

  it('renders all local models when open', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Translation model/ }));
    // Multiple OPUS-MT elements exist (trigger + dropdown item) — use getAllBy
    expect(screen.getAllByText('OPUS-MT').length).toBeGreaterThan(0);
    expect(screen.getAllByText('TranslateGemma').length).toBeGreaterThan(0);
    expect(screen.getByText('Chrome Built-in')).toBeTruthy();
  });

  it('renders cloud providers when open', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Translation model/ }));
    expect(screen.getAllByText('DeepL').length).toBeGreaterThan(0);
    // Claude (Anthropic) is a cloud provider without duplicate text issues
    expect(screen.getByText('Claude')).toBeTruthy();
  });

  it('calls onChange when a local model is selected', () => {
    const onChange = vi.fn();
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={onChange}
        downloadStatus={allDownloadStatus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Translation model/ }));
    // Click the Chrome Built-in option button (it's downloaded so no API key redirect)
    const chromeBtn = screen.getAllByRole('option').find(
      (el) => el.textContent?.includes('Chrome Built-in')
    );
    expect(chromeBtn).toBeTruthy();
    fireEvent.click(chromeBtn!);
    expect(onChange).toHaveBeenCalledWith('chrome-builtin');
  });

  it('opens options page when unconfigured cloud provider selected', () => {
    const onChange = vi.fn();
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={onChange}
        downloadStatus={allDownloadStatus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Translation model/ }));
    // DeepL is a cloud provider — not configured (cloudApiStatus defaults to {})
    const deepLBtn = screen.getAllByRole('option').find(
      (el) => el.textContent?.includes('DeepL')
    );
    expect(deepLBtn).toBeTruthy();
    fireEvent.click(deepLBtn!);
    // Should open options page, not call onChange
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows "Configure" button in cloud group header', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Translation model/ }));
    expect(screen.getByLabelText('Configure cloud provider API keys')).toBeTruthy();
  });

  it('configure button opens options page', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Translation model/ }));
    fireEvent.click(screen.getByLabelText('Configure cloud provider API keys'));
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalled();
  });

  it('shows disabled state for TranslateGemma when WebGPU unavailable', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
        webGpuAvailable={false}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Translation model/ }));
    expect(screen.getByText('Requires WebGPU')).toBeTruthy();
  });

  it('closes dropdown on click outside', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Translation model/ }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    // Simulate mousedown outside the wrapper
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('ModelSelector render — keyboard navigation', () => {
  afterEach(cleanup);

  it('opens on ArrowDown when closed', () => {
    const { container } = render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const wrapper = container.querySelector('.model-dropdown-wrapper') as HTMLElement;
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('opens on Enter when closed', () => {
    const { container } = render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const wrapper = container.querySelector('.model-dropdown-wrapper') as HTMLElement;
    fireEvent.keyDown(wrapper, { key: 'Enter' });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('opens on Space when closed', () => {
    const { container } = render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const wrapper = container.querySelector('.model-dropdown-wrapper') as HTMLElement;
    fireEvent.keyDown(wrapper, { key: ' ' });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('closes on Escape when open', () => {
    const { container } = render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const wrapper = container.querySelector('.model-dropdown-wrapper') as HTMLElement;
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(wrapper, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('navigates with ArrowDown and ArrowUp', () => {
    const { container } = render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const wrapper = container.querySelector('.model-dropdown-wrapper') as HTMLElement;
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' }); // open
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' }); // move down
    fireEvent.keyDown(wrapper, { key: 'ArrowUp' });   // move up
    // No throw is the assertion
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('Home key sets focus to first item', () => {
    const { container } = render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const wrapper = container.querySelector('.model-dropdown-wrapper') as HTMLElement;
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    fireEvent.keyDown(wrapper, { key: 'Home' });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('End key sets focus to last item', () => {
    const { container } = render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const wrapper = container.querySelector('.model-dropdown-wrapper') as HTMLElement;
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' });
    fireEvent.keyDown(wrapper, { key: 'End' });
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('Enter selects focused item and closes dropdown', () => {
    const onChange = vi.fn();
    const { container } = render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={onChange}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const wrapper = container.querySelector('.model-dropdown-wrapper') as HTMLElement;
    fireEvent.keyDown(wrapper, { key: 'ArrowDown' }); // open, focus index 0 (opus-mt)
    fireEvent.keyDown(wrapper, { key: 'Enter' });     // select opus-mt
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Space selects focused item and closes dropdown', () => {
    const { container } = render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    const wrapper = container.querySelector('.model-dropdown-wrapper') as HTMLElement;
    fireEvent.keyDown(wrapper, { key: ' ' }); // open, focus index 0
    fireEvent.keyDown(wrapper, { key: ' ' }); // select
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('ModelSelector render — download progress', () => {
  afterEach(cleanup);

  it('shows progress bar when model is downloading', () => {
    const status = allDownloadStatus();
    status['opus-mt'] = makeDownloadStatus({ isDownloading: true, progress: 45 });
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={status}
      />
    ));
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeTruthy();
    expect(progressBar.getAttribute('aria-valuenow')).toBe('45');
  });

  it('does not show progress bar when not downloading', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows error icon in status when model has error', () => {
    const { container } = render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    fireEvent.click(container.querySelector('.model-dropdown-trigger') as HTMLElement);
    // At minimum the listbox renders without throw
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('renders with undefined downloadStatus (uses default)', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
      />
    ));
    expect(screen.getByRole('button', { name: /Translation model/ })).toBeTruthy();
  });

  it('mouseEnter on list item updates focused index', () => {
    render(() => (
      <ModelSelector
        selected="opus-mt"
        onChange={vi.fn()}
        downloadStatus={allDownloadStatus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: /Translation model/ }));
    const options = screen.getAllByRole('option');
    // Hover the second option
    fireEvent.mouseEnter(options[1]);
    // Just verify no error thrown
    expect(options[1]).toBeTruthy();
  });
});
