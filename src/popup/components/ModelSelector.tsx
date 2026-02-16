import { Component, Show, createSignal, onMount, onCleanup, For, createEffect } from 'solid-js';
import type { TranslationProviderId } from '../../types';

export interface ModelInfo {
  id: TranslationProviderId;
  name: string;
  tag: string;
  description: string;
  size: string;
  isCloud?: boolean;
  costEstimate?: string;
}

export interface ModelDownloadStatus {
  isDownloading: boolean;
  progress: number;
  isDownloaded: boolean;
  error: string | null;
}

export interface CloudProviderStatus {
  configured: boolean;
  usage?: {
    tokens: number;
    cost: number;
    limitReached?: boolean;
  };
}

interface Props {
  selected: TranslationProviderId;
  onChange: (provider: TranslationProviderId) => void;
  downloadStatus?: Record<TranslationProviderId, ModelDownloadStatus>;
  cloudStatus?: Record<string, CloudProviderStatus>;
}

// Local models (no API key required)
export const LOCAL_MODELS: ModelInfo[] = [
  {
    id: 'opus-mt',
    name: 'OPUS-MT',
    tag: 'Fast',
    description: 'Helsinki-NLP',
    size: '~170MB',
  },
  {
    id: 'translategemma',
    name: 'TranslateGemma',
    tag: 'Quality',
    description: 'Google 4B',
    size: '~3.6GB',
  },
  {
    id: 'chrome-builtin',
    name: 'Chrome Built-in',
    tag: 'Native',
    description: 'Chrome 138+',
    size: 'Built-in',
  },
];

// Cloud providers (API key required)
export const CLOUD_PROVIDERS: ModelInfo[] = [
  {
    id: 'deepl',
    name: 'DeepL',
    tag: 'Premium',
    description: 'Best quality',
    size: 'API',
    isCloud: true,
    costEstimate: '~$20/1M chars',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tag: 'OpenAI',
    description: 'AI translation',
    size: 'API',
    isCloud: true,
    costEstimate: '~$5/1M tokens',
  },
  {
    id: 'anthropic',
    name: 'Claude',
    tag: 'AI',
    description: 'Anthropic',
    size: 'API',
    isCloud: true,
    costEstimate: '~$3/1M tokens',
  },
  {
    id: 'google-cloud',
    name: 'Google',
    tag: 'Cloud',
    description: 'Google Cloud',
    size: 'API',
    isCloud: true,
    costEstimate: '~$20/1M chars',
  },
];

export const MODELS: ModelInfo[] = [...LOCAL_MODELS, ...CLOUD_PROVIDERS];

/**
 * Compact dropdown model selector
 */
export const ModelSelector: Component<Props> = (props) => {
  const [cloudApiStatus, setCloudApiStatus] = createSignal<Record<string, boolean>>({});
  const [isOpen, setIsOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  let wrapperRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  onMount(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getCloudProviderStatus' });
      if (response?.status) {
        setCloudApiStatus(response.status);
      }
    } catch {
      // Ignore
    }
  });

  // Click outside to close
  const handleClickOutside = (e: MouseEvent) => {
    if (wrapperRef && !wrapperRef.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  createEffect(() => {
    if (isOpen()) {
      document.addEventListener('mousedown', handleClickOutside);
      // Set focus to current selection
      const currentIdx = MODELS.findIndex(m => m.id === props.selected);
      setFocusedIndex(currentIdx >= 0 ? currentIdx : 0);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
      setFocusedIndex(-1);
    }
  });

  onCleanup(() => {
    document.removeEventListener('mousedown', handleClickOutside);
  });

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isOpen()) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        triggerRef?.focus();
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(i => Math.min(i + 1, MODELS.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex() >= 0 && focusedIndex() < MODELS.length) {
          handleSelect(MODELS[focusedIndex()].id);
          triggerRef?.focus();
        }
        break;
      case 'Home':
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusedIndex(MODELS.length - 1);
        break;
    }
  };

  const getStatus = (modelId: TranslationProviderId): ModelDownloadStatus => {
    return props.downloadStatus?.[modelId] ?? {
      isDownloading: false,
      progress: 0,
      isDownloaded: false,
      error: null,
    };
  };

  const isCloudConfigured = (modelId: TranslationProviderId): boolean => {
    return cloudApiStatus()[modelId] ?? false;
  };

  const selectedModel = () => MODELS.find(m => m.id === props.selected) || LOCAL_MODELS[0];

  const handleSelect = (modelId: TranslationProviderId) => {
    const model = MODELS.find(m => m.id === modelId);
    if (model?.isCloud && !isCloudConfigured(modelId)) {
      chrome.runtime.openOptionsPage();
    } else {
      props.onChange(modelId);
    }
    setIsOpen(false);
  };

  const getStatusIcon = (model: ModelInfo) => {
    const status = getStatus(model.id);
    if (status.isDownloading) return '⏳';
    if (status.error) return '⚠️';
    if (model.isCloud) {
      return isCloudConfigured(model.id) ? '✓' : '🔑';
    }
    if (status.isDownloaded) return '✓';
    return '';
  };

  return (
    <section class="model-dropdown-section">
      <div class="model-dropdown-wrapper" ref={wrapperRef} onKeyDown={handleKeyDown}>
        <button
          ref={triggerRef}
          class="model-dropdown-trigger"
          onClick={() => setIsOpen(!isOpen())}
          aria-expanded={isOpen()}
          aria-haspopup="listbox"
          aria-label={`Translation model: ${selectedModel().name}. Click to change.`}
          aria-activedescendant={isOpen() && focusedIndex() >= 0 ? `model-option-${focusedIndex()}` : undefined}
        >
          <div class="model-dropdown-selected">
            <span class="model-dropdown-name">{selectedModel().name}</span>
            <span class="model-dropdown-tag">{selectedModel().tag}</span>
          </div>
          <svg class="model-dropdown-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        <Show when={isOpen()}>
          <div class="model-dropdown-menu" role="listbox">
            <div class="model-dropdown-group">
              <div class="model-dropdown-group-label">Local Models</div>
              <For each={LOCAL_MODELS}>
                {(model, idx) => (
                  <button
                    id={`model-option-${idx()}`}
                    class={`model-dropdown-item ${props.selected === model.id ? 'active' : ''} ${focusedIndex() === idx() ? 'focused' : ''}`}
                    onClick={() => handleSelect(model.id)}
                    onMouseEnter={() => setFocusedIndex(idx())}
                    role="option"
                    aria-selected={props.selected === model.id}
                  >
                    <span class="model-dropdown-item-name">{model.name}</span>
                    <span class="model-dropdown-item-meta">
                      <span class="model-dropdown-item-tag">{model.tag}</span>
                      <span class="model-dropdown-item-size">{model.size}</span>
                      <span class="model-dropdown-item-status">{getStatusIcon(model)}</span>
                    </span>
                  </button>
                )}
              </For>
            </div>

            <div class="model-dropdown-group">
              <div class="model-dropdown-group-label">
                Cloud Providers
                <button
                  class="model-dropdown-configure"
                  onClick={(e) => {
                    e.stopPropagation();
                    chrome.runtime.openOptionsPage();
                  }}
                  aria-label="Configure cloud provider API keys"
                >
                  Configure
                </button>
              </div>
              <For each={CLOUD_PROVIDERS}>
                {(model, idx) => {
                  const absoluteIdx = () => LOCAL_MODELS.length + idx();
                  return (
                  <button
                    id={`model-option-${absoluteIdx()}`}
                    class={`model-dropdown-item ${props.selected === model.id ? 'active' : ''} ${!isCloudConfigured(model.id) ? 'unconfigured' : ''} ${focusedIndex() === absoluteIdx() ? 'focused' : ''}`}
                    onClick={() => handleSelect(model.id)}
                    onMouseEnter={() => setFocusedIndex(absoluteIdx())}
                    role="option"
                    aria-selected={props.selected === model.id}
                  >
                    <span class="model-dropdown-item-name">{model.name}</span>
                    <span class="model-dropdown-item-meta">
                      <span class="model-dropdown-item-tag">{model.tag}</span>
                      <span class="model-dropdown-item-cost">{model.costEstimate}</span>
                      <span class="model-dropdown-item-status">{getStatusIcon(model)}</span>
                    </span>
                  </button>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* Download progress overlay */}
        <Show when={getStatus(props.selected).isDownloading}>
          <div
            class="model-dropdown-progress"
            role="progressbar"
            aria-valuenow={Math.round(getStatus(props.selected).progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Downloading model: ${Math.round(getStatus(props.selected).progress)}%`}
          >
            <div
              class="model-dropdown-progress-fill"
              style={{ width: `${getStatus(props.selected).progress}%` }}
            />
          </div>
        </Show>
      </div>
    </section>
  );
};

export default ModelSelector;
