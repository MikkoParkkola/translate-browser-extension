import { Component, Show } from 'solid-js';

interface Props {
  isLoading: boolean;
  progress: number;
  isCached: boolean;
  modelId: string | null;
  currentFile: string | null;
}

// Extract short model name from full ID (e.g., "Xenova/opus-mt-en-fi" -> "en-fi")
function getShortModelName(modelId: string | null): string {
  if (!modelId) return 'Model';
  const match = modelId.match(/opus-mt-(.+)$/);
  return match ? match[1].toUpperCase() : modelId;
}

// Format file name for display
function getShortFileName(file: string | null): string {
  if (!file) return '';
  // Extract just the filename from paths like "onnx/model.onnx"
  const parts = file.split('/');
  return parts[parts.length - 1];
}

// Estimate download size for first-time users
function getEstimatedSize(): string {
  return '~50-100 MB'; // OPUS-MT models are typically in this range
}

export const ModelStatus: Component<Props> = (props) => {
  return (
    <Show when={props.isLoading || props.isCached}>
      <div class="model-status">
        <Show when={props.isLoading}>
          <div class="model-loading">
            <div class="model-loading-header">
              <span class="model-loading-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="spinning">
                  <path
                    d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </span>
              <span class="model-loading-text">
                {props.progress < 100
                  ? `Downloading ${getShortModelName(props.modelId)}...`
                  : 'Initializing model...'}
              </span>
            </div>
            <div class="model-progress-container">
              <div class="model-progress-bar">
                <div
                  class="model-progress-fill"
                  style={{ width: `${props.progress}%` }}
                />
              </div>
              <span class="model-progress-percent">{Math.round(props.progress)}%</span>
            </div>
            <Show when={props.currentFile}>
              <div class="model-file-info">
                {getShortFileName(props.currentFile)}
              </div>
            </Show>
            <Show when={props.progress === 0}>
              <div class="model-first-time">
                First-time download: {getEstimatedSize()}
              </div>
            </Show>
          </div>
        </Show>

        <Show when={!props.isLoading && props.isCached}>
          <div class="model-cached">
            <span class="model-cached-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M20 6L9 17l-5-5"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span class="model-cached-text">
              {getShortModelName(props.modelId)} ready
            </span>
          </div>
        </Show>
      </div>
    </Show>
  );
};
