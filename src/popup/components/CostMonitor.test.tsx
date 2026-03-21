import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { CostMonitor } from './CostMonitor';

// Mock chrome global for components that reference it
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    openOptionsPage: vi.fn(),
  },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue({}),
  },
  scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
});

const makeUsage = (overrides: {
  cost?: number;
  monthly?: number;
  used?: number;
  requests?: number;
  characters?: number;
} = {}) => ({
  today: {
    requests: overrides.requests ?? 10,
    characters: overrides.characters ?? 5000,
    cost: overrides.cost ?? 0.42,
  },
  budget: {
    monthly: overrides.monthly ?? 5.0,
    used: overrides.used ?? 2.5,
  },
});

describe('CostMonitor', () => {
  it('renders today\'s cost formatted as $X.XX', () => {
    const { container } = render(() => <CostMonitor usage={makeUsage({ cost: 1.5 })} />);
    const costEl = container.querySelector('.cost-today');
    expect(costEl).toHaveTextContent('$1.50');
  });

  it('shows $0.00 for zero cost', () => {
    const { container } = render(() => <CostMonitor usage={makeUsage({ cost: 0 })} />);
    const costEl = container.querySelector('.cost-today');
    expect(costEl).toHaveTextContent('$0.00');
  });

  it('shows monthly budget', () => {
    const { container } = render(() => <CostMonitor usage={makeUsage({ monthly: 10 })} />);
    const budgetEl = container.querySelector('.budget-monthly');
    expect(budgetEl).toHaveTextContent('$10.00');
  });

  describe('budget bar', () => {
    it('shows correct percentage width', () => {
      const { container } = render(() => (
        <CostMonitor usage={makeUsage({ monthly: 10, used: 5 })} />
      ));
      const fill = container.querySelector('.budget-bar-fill') as HTMLElement;
      expect(fill.style.width).toBe('50%');
    });

    it('shows 100% when budget used >= monthly', () => {
      const { container } = render(() => (
        <CostMonitor usage={makeUsage({ monthly: 5, used: 7 })} />
      ));
      const fill = container.querySelector('.budget-bar-fill') as HTMLElement;
      expect(fill.style.width).toBe('100%');
    });

    it('shows 0% when monthly budget is 0', () => {
      const { container } = render(() => (
        <CostMonitor usage={makeUsage({ monthly: 0, used: 0 })} />
      ));
      const fill = container.querySelector('.budget-bar-fill') as HTMLElement;
      expect(fill.style.width).toBe('0%');
    });
  });

  describe('over-budget state', () => {
    it('applies over-budget class when used > monthly', () => {
      const { container } = render(() => (
        <CostMonitor usage={makeUsage({ monthly: 5, used: 6 })} />
      ));
      const label = container.querySelector('.budget-label');
      expect(label).toHaveClass('over-budget');
      const fill = container.querySelector('.budget-bar-fill');
      expect(fill).toHaveClass('over-budget');
    });

    it('does not apply over-budget class when within budget', () => {
      const { container } = render(() => (
        <CostMonitor usage={makeUsage({ monthly: 10, used: 3 })} />
      ));
      const label = container.querySelector('.budget-label');
      expect(label).not.toHaveClass('over-budget');
      const fill = container.querySelector('.budget-bar-fill');
      expect(fill).not.toHaveClass('over-budget');
    });

    it('does not apply over-budget class when exactly at budget', () => {
      const { container } = render(() => (
        <CostMonitor usage={makeUsage({ monthly: 5, used: 5 })} />
      ));
      const label = container.querySelector('.budget-label');
      expect(label).not.toHaveClass('over-budget');
    });
  });

  it('formats cost with two decimal places', () => {
    const { container } = render(() => <CostMonitor usage={makeUsage({ cost: 3.1 })} />);
    const costEl = container.querySelector('.cost-today');
    expect(costEl).toHaveTextContent('$3.10');
  });

  // -----------------------------------------------------------------------
  // Budget percent capping at 100
  // -----------------------------------------------------------------------

  it('caps budget bar at 100% when used exceeds monthly', () => {
    const { container } = render(() => (
      <CostMonitor usage={makeUsage({ monthly: 5, used: 15 })} />
    ));
    const fill = container.querySelector('.budget-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('shows budget percent proportionally when under budget', () => {
    const { container } = render(() => (
      <CostMonitor usage={makeUsage({ monthly: 100, used: 25 })} />
    ));
    const fill = container.querySelector('.budget-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('25%');
  });

  describe('budget zero edge cases', () => {
    it('budget bar fill is 0% when monthly budget is 0 and used is 0', () => {
      const { container } = render(() => (
        <CostMonitor usage={makeUsage({ monthly: 0, used: 0 })} />
      ));
      const fill = container.querySelector('.budget-bar-fill') as HTMLElement;
      expect(fill.style.width).toBe('0%');
    });

    it('budget-label does not have over-budget class when used equals monthly', () => {
      const { container } = render(() => (
        <CostMonitor usage={makeUsage({ monthly: 5, used: 5 })} />
      ));
      const label = container.querySelector('.budget-label');
      expect(label?.className).not.toContain('over-budget');
    });

    it('budget-bar-fill does not have over-budget class when within budget', () => {
      const { container } = render(() => (
        <CostMonitor usage={makeUsage({ monthly: 10, used: 3 })} />
      ));
      const fill = container.querySelector('.budget-bar-fill');
      expect(fill?.className).not.toContain('over-budget');
    });

    it('both budget-label and budget-bar-fill have over-budget class when over', () => {
      const { container } = render(() => (
        <CostMonitor usage={makeUsage({ monthly: 5, used: 10 })} />
      ));
      const label = container.querySelector('.budget-label');
      const fill = container.querySelector('.budget-bar-fill');
      expect(label?.className).toContain('over-budget');
      expect(fill?.className).toContain('over-budget');
    });
  });
});
