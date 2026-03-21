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

  // -----------------------------------------------------------------------
  // formatChars: values below 1000 show raw number
  // -----------------------------------------------------------------------

  it('displays raw character count for values below 1000', () => {
    render(() => <UsageBar usage={makeUsage(0, 500)} />);
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('displays "k" suffix for characters at exactly 1000', () => {
    render(() => <UsageBar usage={makeUsage(0, 1000)} />);
    expect(screen.getByText(/1\.0k/)).toBeInTheDocument();
  });

  describe('formatChars branch coverage', () => {
    it('both request and char bars at zero width when usage is zero', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(0, 0)} />);
      const fills = container.querySelectorAll('.usage-bar-fill');
      expect(fills[0]).toHaveStyle({ width: '0%' });
      expect(fills[1]).toHaveStyle({ width: '0%' });
    });

    it('char limit is always formatted with k suffix (50000 chars = 50.0k)', () => {
      render(() => <UsageBar usage={makeUsage(0, 500)} />);
      // charLimit = 50000, so formatChars(50000) = "50.0k"
      expect(screen.getByText(/50\.0k/)).toBeInTheDocument();
    });

    it('today chars below 1000 show raw number while limit shows k suffix', () => {
      render(() => <UsageBar usage={makeUsage(0, 999)} />);
      // 999 < 1000 => "999", charLimit 50000 >= 1000 => "50.0k"
      expect(screen.getByText(/999/)).toBeInTheDocument();
      expect(screen.getByText(/50\.0k/)).toBeInTheDocument();
    });

    it('today chars at exactly 999 use raw number format', () => {
      render(() => <UsageBar usage={makeUsage(0, 999)} />);
      const summary = screen.getByText(/req,/);
      expect(summary.textContent).toContain('999');
      expect(summary.textContent).not.toMatch(/999.*k.*\/.*50/);
    });

    it('large character values format correctly in summary text', () => {
      render(() => <UsageBar usage={makeUsage(50, 25000)} />);
      expect(screen.getByText(/25\.0k/)).toBeInTheDocument();
    });

    it('edge case: exactly 10000 characters formats with 1 decimal', () => {
      render(() => <UsageBar usage={makeUsage(0, 10000)} />);
      expect(screen.getByText(/10\.0k/)).toBeInTheDocument();
    });

    it('edge case: 1500 characters formats as 1.5k', () => {
      render(() => <UsageBar usage={makeUsage(0, 1500)} />);
      expect(screen.getByText(/1\.5k/)).toBeInTheDocument();
    });

    it('very large character count still formats correctly', () => {
      render(() => <UsageBar usage={makeUsage(0, 49999)} />);
      expect(screen.getByText(/50\.0k/)).toBeInTheDocument();
    });
  });

  describe('percentage calculation edge cases', () => {
    it('calculates request percentage correctly at 50% capacity', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(50, 0)} />);
      const requestFill = container.querySelector('[data-type="requests"]') as HTMLElement;
      expect(requestFill.style.width).toBe('50%');
    });

    it('calculates character percentage correctly at 25% capacity', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(0, 12500)} />);
      const charFill = container.querySelector('[data-type="chars"]') as HTMLElement;
      expect(charFill.style.width).toBe('25%');
    });

    it('calculates request percentage at 1 request', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(1, 0)} />);
      const requestFill = container.querySelector('[data-type="requests"]') as HTMLElement;
      expect(requestFill.style.width).toBe('1%');
    });

    it('calculates character percentage at 1 character', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(0, 1)} />);
      const charFill = container.querySelector('[data-type="chars"]') as HTMLElement;
      const expectedPercent = (1 / 50000) * 100;
      expect(parseFloat(charFill.style.width)).toBeCloseTo(expectedPercent, 5);
    });

    it('request bar at 99% when at 99 requests', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(99, 0)} />);
      const requestFill = container.querySelector('[data-type="requests"]') as HTMLElement;
      expect(requestFill.style.width).toBe('99%');
    });

    it('character bar at 99% when at 49500 characters', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(0, 49500)} />);
      const charFill = container.querySelector('[data-type="chars"]') as HTMLElement;
      expect(charFill.style.width).toBe('99%');
    });
  });

  describe('summary text formatting', () => {
    it('displays correct format: "X/100 req, Y/50.0k chars"', () => {
      render(() => <UsageBar usage={makeUsage(25, 5000)} />);
      expect(screen.getByText(/25\/100 req, 5\.0k\/50\.0k chars/)).toBeInTheDocument();
    });

    it('shows zero values correctly', () => {
      render(() => <UsageBar usage={makeUsage(0, 0)} />);
      expect(screen.getByText(/0\/100 req, 0\/50\.0k chars/)).toBeInTheDocument();
    });

    it('shows mixed raw and formatted values', () => {
      render(() => <UsageBar usage={makeUsage(5, 500)} />);
      expect(screen.getByText(/5\/100 req, 500\/50\.0k chars/)).toBeInTheDocument();
    });

    it('handles max request count', () => {
      render(() => <UsageBar usage={makeUsage(100, 0)} />);
      expect(screen.getByText(/100\/100 req/)).toBeInTheDocument();
    });

    it('handles max character count', () => {
      render(() => <UsageBar usage={makeUsage(0, 50000)} />);
      expect(screen.getByText(/50\.0k\/50\.0k chars/)).toBeInTheDocument();
    });
  });

  describe('bar structure and styling', () => {
    it('renders two usage bars (request and character)', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(10, 5000)} />);
      const bars = container.querySelectorAll('.usage-bar');
      expect(bars.length).toBe(2);
    });

    it('each bar has track and fill elements', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(10, 5000)} />);
      const tracks = container.querySelectorAll('.usage-bar-track');
      const fills = container.querySelectorAll('.usage-bar-fill');
      expect(tracks.length).toBe(2);
      expect(fills.length).toBe(2);
    });

    it('fills have correct data-type attributes', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(10, 5000)} />);
      const requestFill = container.querySelector('[data-type="requests"]');
      const charFill = container.querySelector('[data-type="chars"]');
      expect(requestFill).toBeTruthy();
      expect(charFill).toBeTruthy();
    });
  });

  describe('Math.min capping at 100%', () => {
    it('request bar maxes at 100% when exceeding limit', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(150, 0)} />);
      const requestFill = container.querySelector('[data-type="requests"]') as HTMLElement;
      expect(requestFill.style.width).toBe('100%');
    });

    it('character bar maxes at 100% when exceeding limit', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(0, 75000)} />);
      const charFill = container.querySelector('[data-type="chars"]') as HTMLElement;
      expect(charFill.style.width).toBe('100%');
    });

    it('both bars at 100% when both exceed their limits', () => {
      const { container } = render(() => <UsageBar usage={makeUsage(200, 100000)} />);
      const fills = container.querySelectorAll('.usage-bar-fill');
      expect((fills[0] as HTMLElement).style.width).toBe('100%');
      expect((fills[1] as HTMLElement).style.width).toBe('100%');
    });
  });
});
