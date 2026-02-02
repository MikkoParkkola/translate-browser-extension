import { Component } from 'solid-js';
import type { UsageStats } from '../../types';

interface Props {
  usage: UsageStats;
}

export const CostMonitor: Component<Props> = (props) => {
  const formatCost = (cost: number) => {
    return `$${cost.toFixed(2)}`;
  };

  const budgetPercent = () => {
    if (props.usage.budget.monthly === 0) return 0;
    return Math.min((props.usage.budget.used / props.usage.budget.monthly) * 100, 100);
  };

  const isOverBudget = () => props.usage.budget.used > props.usage.budget.monthly;

  return (
    <section class="cost-section">
      <div class="cost-monitor">
        <span class="cost-label">
          Cost: <span class="cost-today">{formatCost(props.usage.today.cost)}</span>
        </span>
        <span class={`budget-label ${isOverBudget() ? 'over-budget' : ''}`}>
          (Budget: <span class="budget-monthly">{formatCost(props.usage.budget.monthly)}</span>/month)
        </span>
      </div>
      <div class="budget-bar">
        <div class="budget-bar-track">
          <div
            class={`budget-bar-fill ${isOverBudget() ? 'over-budget' : ''}`}
            style={{ width: `${budgetPercent()}%` }}
          />
        </div>
      </div>
    </section>
  );
};
