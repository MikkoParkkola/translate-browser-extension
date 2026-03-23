import { Component, For } from 'solid-js';
import type { Strategy } from '../../types';
import { POPUP_STRATEGIES } from '../../shared/translation-options';

interface Props {
  selected: Strategy;
  onChange: (strategy: Strategy) => void;
}

export const StrategySelector: Component<Props> = (props) => {
  return (
    <section class="strategy-section" aria-label="Translation strategy">
      <div class="strategy-buttons" role="group" aria-label="Strategy selection">
        <For each={POPUP_STRATEGIES}>
          {(strategy) => (
            <button
              class={`strategy-button ${props.selected === strategy.id ? 'active' : ''}`}
              data-strategy={strategy.id}
              title={strategy.title}
              aria-pressed={props.selected === strategy.id}
              onClick={() => props.onChange(strategy.id)}
            >
              {strategy.label}
            </button>
          )}
        </For>
      </div>
    </section>
  );
/* v8 ignore start */
};
/* v8 ignore stop */
