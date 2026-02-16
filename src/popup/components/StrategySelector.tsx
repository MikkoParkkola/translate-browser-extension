import { Component, For } from 'solid-js';
import type { Strategy } from '../../types';

interface Props {
  selected: Strategy;
  onChange: (strategy: Strategy) => void;
}

const STRATEGIES: Array<{ id: Strategy; label: string; title: string }> = [
  { id: 'smart', label: 'Smart', title: 'Intelligent provider selection' },
  { id: 'fast', label: 'Fast', title: 'Optimize for speed' },
  { id: 'quality', label: 'Quality', title: 'Optimize for quality' },
];

export const StrategySelector: Component<Props> = (props) => {
  return (
    <section class="strategy-section" aria-label="Translation strategy">
      <div class="strategy-buttons" role="group" aria-label="Strategy selection">
        <For each={STRATEGIES}>
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
};
