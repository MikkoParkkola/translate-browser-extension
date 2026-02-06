import { Component, Show } from 'solid-js';
import type { TranslationProviderId } from '../../types';

export interface ModelInfo {
  id: TranslationProviderId;
  name: string;
  tag: string;
  description: string;
  size: string;
}

export interface ModelDownloadStatus {
  isDownloading: boolean;
  progress: number;
  isDownloaded: boolean;
  error: string | null;
}

interface Props {
  selected: TranslationProviderId;
  onChange: (provider: TranslationProviderId) => void;
  downloadStatus?: Record<TranslationProviderId, ModelDownloadStatus>;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'opus-mt',
    name: 'OPUS-MT',
    tag: 'Fast',
    description: 'Helsinki-NLP',
    size: '~170MB per pair',
  },
  {
    id: 'translategemma',
    name: 'TranslateGemma',
    tag: 'Quality',
    description: 'Google 4B',
    size: '~3.6GB',
  },
];

/**
 * Model selector component with download status indicators.
 * Shows available translation models with their characteristics and current status.
 */
export const ModelSelector: Component<Props> = (props) => {
  const getStatus = (modelId: TranslationProviderId): ModelDownloadStatus => {
    return props.downloadStatus?.[modelId] ?? {
      isDownloading: false,
      progress: 0,
      isDownloaded: false,
      error: null,
    };
  };

  const getStatusClass = (modelId: TranslationProviderId): string => {
    const status = getStatus(modelId);
    if (status.error) return 'model-error';
    if (status.isDownloading) return 'model-downloading';
    if (status.isDownloaded) return 'model-ready';
    return '';
  };

  return (
    <section class="model-selector-section">
      <div class="model-selector-label">Model</div>
      <div class="model-selector-buttons">
        {MODELS.map((model) => {
          const status = () => getStatus(model.id);
          const isActive = () => props.selected === model.id;

          return (
            <button
              class={`model-selector-button ${isActive() ? 'active' : ''} ${getStatusClass(model.id)}`}
              onClick={() => props.onChange(model.id)}
              disabled={status().isDownloading}
              aria-pressed={isActive()}
              aria-label={`Select ${model.name} - ${model.tag} - ${model.size}`}
            >
              <div class="model-selector-header">
                <span class="model-selector-name">{model.name}</span>
                <span class="model-selector-tag">{model.tag}</span>
              </div>

              <div class="model-selector-meta">
                <span class="model-selector-size">{model.size}</span>
                <Show when={status().isDownloaded && !status().isDownloading}>
                  <span class="model-selector-status model-status-ready" title="Model ready">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </span>
                </Show>
                <Show when={status().error}>
                  <span class="model-selector-status model-status-error" title={status().error || 'Error'}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" />
                      <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                  </span>
                </Show>
              </div>

              <Show when={status().isDownloading}>
                <div class="model-selector-progress">
                  <div class="model-selector-progress-bar">
                    <div
                      class="model-selector-progress-fill"
                      style={{ width: `${status().progress}%` }}
                    />
                  </div>
                  <span class="model-selector-progress-text">
                    {Math.round(status().progress)}%
                  </span>
                </div>
              </Show>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default ModelSelector;
