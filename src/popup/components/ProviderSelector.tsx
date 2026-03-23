import { Component } from 'solid-js';
import type { TranslationProviderId } from '../../types';
import { PROVIDER_SELECTOR_OPTIONS } from '../../shared/provider-options';

interface Props {
  selected: TranslationProviderId;
  onChange: (provider: TranslationProviderId) => void;
}

export const ProviderSelector: Component<Props> = (props) => {
  return (
    <section class="provider-section">
      <div class="provider-label">Model</div>
      <div class="provider-buttons">
        {PROVIDER_SELECTOR_OPTIONS.map((p) => (
          <button
            class={`provider-button ${props.selected === p.id ? 'active' : ''}`}
            onClick={() => props.onChange(p.id)}
          >
            <span class="provider-button-name">{p.name}</span>
            <span class="provider-button-tag">{p.tag}</span>
          </button>
        ))}
      </div>
    </section>
  );
/* v8 ignore start */
};
/* v8 ignore stop */
