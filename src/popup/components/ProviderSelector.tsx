import { Component } from 'solid-js';
import type { TranslationProviderId } from '../../types';

interface Props {
  selected: TranslationProviderId;
  onChange: (provider: TranslationProviderId) => void;
}

const PROVIDERS = [
  {
    id: 'opus-mt' as TranslationProviderId,
    name: 'OPUS-MT',
    tag: 'Fast',
    desc: '~170MB per pair',
  },
  {
    id: 'translategemma' as TranslationProviderId,
    name: 'TranslateGemma',
    tag: 'Quality',
    desc: '~3.6GB one model',
  },
];

export const ProviderSelector: Component<Props> = (props) => {
  return (
    <section class="provider-section">
      <div class="provider-label">Model</div>
      <div class="provider-buttons">
        {PROVIDERS.map((p) => (
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
};
