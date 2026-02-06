import { Component, Show, createSignal, onMount, For } from 'solid-js';
import type { TranslationProviderId } from '../../types';

export interface ModelInfo {
  id: TranslationProviderId;
  name: string;
  tag: string;
  description: string;
  size: string;
  isCloud?: boolean;
  costEstimate?: string; // e.g., "~$0.02/1K chars"
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
    size: '~170MB per pair',
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
    size: 'No download',
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
    tag: 'GPT-4',
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

// Combined list for backward compatibility
export const MODELS: ModelInfo[] = [...LOCAL_MODELS, ...CLOUD_PROVIDERS];

/**
 * Cloud icon SVG component
 */
const CloudIcon: Component = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" class="cloud-icon">
    <path
      d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

/**
 * Model selector component with download status indicators.
 * Shows available translation models with their characteristics and current status.
 * Includes cloud providers with API key status.
 */
export const ModelSelector: Component<Props> = (props) => {
  // Track cloud provider availability from storage
  const [cloudApiStatus, setCloudApiStatus] = createSignal<Record<string, boolean>>({});

  onMount(async () => {
    // Check which cloud providers have API keys configured
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getCloudProviderStatus' });
      if (response?.status) {
        setCloudApiStatus(response.status);
      }
    } catch {
      // Ignore errors - cloud providers just won't show as configured
    }
  });

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

  const isCloudConfigured = (modelId: TranslationProviderId): boolean => {
    return cloudApiStatus()[modelId] ?? false;
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const renderModelButton = (model: ModelInfo) => {
    const status = () => getStatus(model.id);
    const isActive = () => props.selected === model.id;
    const isCloud = model.isCloud ?? false;
    const configured = () => isCloud ? isCloudConfigured(model.id) : true;

    return (
      <button
        class={`model-selector-button ${isActive() ? 'active' : ''} ${getStatusClass(model.id)} ${isCloud ? 'cloud-provider' : ''} ${isCloud && !configured() ? 'unconfigured' : ''}`}
        onClick={() => {
          if (isCloud && !configured()) {
            openOptions();
          } else {
            props.onChange(model.id);
          }
        }}
        disabled={status().isDownloading}
        aria-pressed={isActive()}
        aria-label={`Select ${model.name} - ${model.tag} - ${model.size}`}
      >
        <div class="model-selector-header">
          <span class="model-selector-name">
            <Show when={isCloud}>
              <CloudIcon />
            </Show>
            {model.name}
          </span>
          <span class="model-selector-tag">{model.tag}</span>
        </div>

        <div class="model-selector-meta">
          <Show when={isCloud && !configured()}>
            <span class="model-selector-api-required" title="Click to configure API key">
              API Key Required
            </span>
          </Show>
          <Show when={isCloud && configured()}>
            <span class="model-selector-cost" title={`Estimated cost: ${model.costEstimate}`}>
              {model.costEstimate}
            </span>
          </Show>
          <Show when={!isCloud}>
            <span class="model-selector-size">{model.size}</span>
          </Show>
          <Show when={status().isDownloaded && !status().isDownloading && !isCloud}>
            <span class="model-selector-status model-status-ready" title="Model ready">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </Show>
          <Show when={isCloud && configured()}>
            <span class="model-selector-status model-status-ready" title="API configured">
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
  };

  return (
    <section class="model-selector-section">
      {/* Local Models */}
      <div class="model-selector-label">Local Models</div>
      <div class="model-selector-buttons">
        <For each={LOCAL_MODELS}>
          {(model) => renderModelButton(model)}
        </For>
      </div>

      {/* Cloud Providers */}
      <div class="model-selector-label cloud-label">
        Cloud Providers
        <button class="configure-link" onClick={openOptions} title="Configure API keys">
          Configure
        </button>
      </div>
      <div class="model-selector-buttons cloud-buttons">
        <For each={CLOUD_PROVIDERS}>
          {(model) => renderModelButton(model)}
        </For>
      </div>
    </section>
  );
};

export default ModelSelector;
