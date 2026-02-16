import { Component } from 'solid-js';

interface Props {
  name: string;
  status: 'ready' | 'loading' | 'error';
}

export const ProviderStatus: Component<Props> = (props) => {
  const statusIndicator = () => {
    switch (props.status) {
      case 'ready':
        return { icon: '', text: 'Ready', class: 'status--ready' };
      case 'loading':
        return { icon: '', text: 'Loading...', class: 'status--loading' };
      case 'error':
        return { icon: '', text: 'Error', class: 'status--error' };
    }
  };

  return (
    <div class="provider-status" role="status" aria-live="polite" aria-label={`Provider: ${props.name}, ${statusIndicator().text}`}>
      <div class="provider-info">
        <span class="provider-name">{props.name}</span>
        <span class={`status-indicator ${statusIndicator().class}`} aria-hidden="true">
          <span class="status-icon">{statusIndicator().icon}</span>
          <span class="status-text">{statusIndicator().text}</span>
        </span>
      </div>
    </div>
  );
};
