import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { UsageBar } from './UsageBar';

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

const makeUsage = (requests: number, characters: number) => ({
  today: { requests, characters, cost: 0 },
  budget: { monthly: 5, used: 0 },
});

describe('UsageBar', () => {
  describe('request count', () => {
    it('shows request count and limit', () => {
      render(() => <UsageBar usage={makeUsage(25, 5000)} />);
      expect(screen.getByText(/25\/100 req/)).toBeInTheDocument();
    });

    it('shows zero requests', () => {
      render(() => <UsageBar usage={makeUsage(0, 0)} />);
      expect(screen.getByText(/0\/100 req/)).toBeInTheDocument();
    });
  });

  describe('character count', () => {
    it('shows character count and limit', () => {
      render(() => <UsageBar usage={makeUsage(10, 500)} />);
      expect(screen.getByText(/500\/50.0k chars/)).toBeInTheDocument();
    });

    it('formats characters >= 1000 with k suffix', () => {
      render(() => <UsageBar usage={makeUsage(10, 2500)} />);
      expect(screen.getByText(/2.5k\/50.0k chars/)).toBeInTheDocument();
    });

    it('shows raw number for characters < 1000', () => {
      render(() => <UsageBar usage={makeUsage(10, 999)} />);
      expect(screen.getByText(/999\/50.0k chars/)).toBeInTheDocument();
    });

    it('formats exactly 1000 with k suffix', () => {
      render(() => <UsageBar usage={makeUsage(10, 1000)} />);
      expect(screen.getByText(/1.0k\/50.0k chars/)).toBeInTheDocument();
    });
  });

  describe('bar widths', () => {
    it('request bar has correct percentage width', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(50, 0)} />);
      const requestFill = container.querySelector('[data-type="requests"]') as HTMLElement;
      expect(requestFill.style.width).toBe('50%');
    });

    it('character bar has correct percentage width', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(0, 25000)} />);
      const charFill = container.querySelector('[data-type="chars"]') as HTMLElement;
      expect(charFill.style.width).toBe('50%');
    });

    it('request bar caps at 100% when over limit', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(150, 0)} />);
      const requestFill = container.querySelector('[data-type="requests"]') as HTMLElement;
      expect(requestFill.style.width).toBe('100%');
    });

    it('character bar caps at 100% when over limit', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(0, 60000)} />);
      const charFill = container.querySelector('[data-type="chars"]') as HTMLElement;
      expect(charFill.style.width).toBe('100%');
    });

    it('shows 0% for zero usage', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(0, 0)} />);
      const requestFill = container.querySelector('[data-type="requests"]') as HTMLElement;
      const charFill = container.querySelector('[data-type="chars"]') as HTMLElement;
      expect(requestFill.style.width).toBe('0%');
      expect(charFill.style.width).toBe('0%');
    });
  });

  it('shows "Today:" label', () => {
    render(() => <UsageBar usage={makeUsage(10, 5000)} />);
    expect(screen.getByText('Today:')).toBeInTheDocument();
  });
});
