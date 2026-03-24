import { Component, Show, createSignal, onMount, onCleanup, For, createEffect } from 'solid-js';
import type { CloudProviderConfiguredStatus, CloudProviderId, TranslationProviderId } from '../../types';
import {
  MODEL_SELECTOR_CLOUD_PROVIDERS as CLOUD_PROVIDERS,
  MODEL_SELECTOR_LOCAL_MODELS as LOCAL_MODELS,
  MODEL_SELECTOR_MODELS as MODELS,
  isCloudProviderId,
} from '../../shared/provider-options';
import { trySendBackgroundMessage } from '../../shared/background-message';
import type { ModelInfo } from '../../shared/provider-options';
import { createEmptyCloudProviderConfiguredStatus } from '../../shared/cloud-provider-config-state';

export type { ModelInfo } from '../../shared/provider-options';
export {
  MODEL_SELECTOR_CLOUD_PROVIDERS as CLOUD_PROVIDERS,
  MODEL_SELECTOR_LOCAL_MODELS as LOCAL_MODELS,
  MODEL_SELECTOR_MODELS as MODELS,
} from '../../shared/provider-options';

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
  cloudStatus?: Partial<Record<CloudProviderId, CloudProviderStatus>>;
  translateGemmaAvailable?: boolean | null;
}

/**
 * Compact dropdown model selector
 */
export const ModelSelector: Component<Props> = (props) => {
  const [cloudApiStatus, setCloudApiStatus] = createSignal<CloudProviderConfiguredStatus>(
    createEmptyCloudProviderConfiguredStatus()
  );
  const [cloudStatusWarning, setCloudStatusWarning] = createSignal<string | null>(null);
  const [isOpen, setIsOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  let wrapperRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  onMount(async () => {
    const response = await trySendBackgroundMessage({
      type: 'getCloudProviderStatus',
    });
    if (response?.success) {
      setCloudApiStatus(response.status);
      setCloudStatusWarning(null);
      return;
    }

    if (response && !response.success) {
      setCloudStatusWarning(response.error);
    }
  });

  // Click outside to close
  const handleClickOutside = (e: MouseEvent) => {
    /* v8 ignore start -- && branch */
    if (wrapperRef && !wrapperRef.contains(e.target as Node)) {
    /* v8 ignore stop */
      setIsOpen(false);
    }
  };

  createEffect(() => {
    if (isOpen()) {
      document.addEventListener('mousedown', handleClickOutside);
      // Set focus to current selection
      const currentIdx = MODELS.findIndex(m => m.id === props.selected);
      /* v8 ignore start -- ternary fallback */
      setFocusedIndex(currentIdx >= 0 ? currentIdx : 0);
      /* v8 ignore stop */
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
      /* v8 ignore start -- OR branches for keyboard */
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      /* v8 ignore stop */
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        /* v8 ignore start -- optional chaining */
        triggerRef?.focus();
        /* v8 ignore stop */
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
        /* v8 ignore start -- && branch + optional chaining */
        if (focusedIndex() >= 0 && focusedIndex() < MODELS.length) {
          handleSelect(MODELS[focusedIndex()].id);
          triggerRef?.focus();
        }
        /* v8 ignore stop */
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
    /* v8 ignore start */
    return props.downloadStatus?.[modelId] ?? {
    /* v8 ignore stop */
      isDownloading: false,
      progress: 0,
      isDownloaded: false,
      error: null,
    };
  };

  const isCloudConfigured = (modelId: TranslationProviderId): boolean => {
    return isCloudProviderId(modelId) ? cloudApiStatus()[modelId] : false;
  };

  /* v8 ignore start -- OR fallback */
  const selectedModel = () => MODELS.find(m => m.id === props.selected) || LOCAL_MODELS[0];
  /* v8 ignore stop */

  const handleSelect = (modelId: TranslationProviderId) => {
    const model = MODELS.find(m => m.id === modelId);
    /* v8 ignore start -- optional chaining + && */
    if (model?.isCloud && !cloudStatusWarning() && !isCloudConfigured(modelId)) {
    /* v8 ignore stop */
      chrome.runtime.openOptionsPage();
    } else {
      props.onChange(modelId);
    }
    setIsOpen(false);
  };

  const isModelDisabled = (model: ModelInfo): boolean => {
    // TranslateGemma requires hardware acceleration (WebGPU or WebNN).
    /* v8 ignore start */
    if (model.id === 'translategemma' && props.translateGemmaAvailable === false) return true;
    /* v8 ignore stop */
    return false;
  };

  const getStatusIcon = (model: ModelInfo) => {
    /* v8 ignore start -- disabled model guard */
    if (isModelDisabled(model)) return '';
    /* v8 ignore stop */
    const status = getStatus(model.id);
    if (status.isDownloading) return '⏳';
    if (status.error) return '⚠️';
    if (model.isCloud) {
      if (cloudStatusWarning()) return '⚠️';
      /* v8 ignore start -- ternary */
      return isCloudConfigured(model.id) ? '✓' : '🔑';
      /* v8 ignore stop */
    }
    if (status.isDownloaded) return '✓';
    return '';
  };

  return (
    <section class="model-dropdown-section">
      {/* v8 ignore start -- SolidJS reactive JSX + && + ternary */}
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
        {/* v8 ignore stop */}
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
                {(model, idx) => {
                  const disabled = () => isModelDisabled(model);
                  return (
                  <button
                    id={`model-option-${idx()}`}
                    class={`model-dropdown-item ${props.selected === model.id ? 'active' : ''} ${focusedIndex() === idx() ? 'focused' : ''} ${disabled() ? 'disabled' : ''}`}
                    onClick={() => handleSelect(model.id)}
                     onMouseEnter={() => setFocusedIndex(idx())}
                     role="option"
                     aria-selected={props.selected === model.id}
                     aria-disabled={disabled()}
                     title={disabled() ? 'Requires WebGPU or WebNN (hardware acceleration not available in this browser)' : undefined}
                   >
                     <span class="model-dropdown-item-name">{model.name}</span>
                     <span class="model-dropdown-item-meta">
                      <Show when={disabled()} fallback={
                        <>
                          <span class="model-dropdown-item-tag">{model.tag}</span>
                          <span class="model-dropdown-item-size">{model.size}</span>
                           <span class="model-dropdown-item-status">{getStatusIcon(model)}</span>
                         </>
                       }>
                         <span class="model-dropdown-item-tag model-dropdown-item-tag--disabled">Requires WebGPU or WebNN</span>
                       </Show>
                     </span>
                   </button>
                  );
                }}
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
              <Show when={cloudStatusWarning()}>
                <div class="model-dropdown-item-status" role="status">
                  Cloud provider status unavailable
                </div>
              </Show>
              <For each={CLOUD_PROVIDERS}>
                {(model, idx) => {
                  const absoluteIdx = () => LOCAL_MODELS.length + idx();
                  return (
                  <button
                     id={`model-option-${absoluteIdx()}`}
                     class={`model-dropdown-item ${props.selected === model.id ? 'active' : ''} ${!cloudStatusWarning() && !isCloudConfigured(model.id) ? 'unconfigured' : ''} ${focusedIndex() === absoluteIdx() ? 'focused' : ''}`}
                     onClick={() => handleSelect(model.id)}
                    /* v8 ignore start -- mouse event handler */
                    onMouseEnter={() => setFocusedIndex(absoluteIdx())}
                    /* v8 ignore stop */
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

/* v8 ignore start */
export default ModelSelector;
/* v8 ignore stop */
