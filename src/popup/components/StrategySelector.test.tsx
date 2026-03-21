import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { StrategySelector } from './StrategySelector';

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

describe('StrategySelector', () => {
  it('renders three strategy buttons', () => {
    render(() => <StrategySelector selected="smart" onChange={vi.fn()} />);
    expect(screen.getByText('Smart')).toBeInTheDocument();
    expect(screen.getByText('Fast')).toBeInTheDocument();
    expect(screen.getByText('Quality')).toBeInTheDocument();
  });

  describe('selected state', () => {
    it('applies "active" class to the selected button', () => {
      render(() => <StrategySelector selected="fast" onChange={vi.fn()} />);
      const fastBtn = screen.getByText('Fast');
      expect(fastBtn).toHaveClass('active');
    });

    it('does not apply "active" class to non-selected buttons', () => {
      render(() => <StrategySelector selected="fast" onChange={vi.fn()} />);
      expect(screen.getByText('Smart')).not.toHaveClass('active');
      expect(screen.getByText('Quality')).not.toHaveClass('active');
    });

    it('sets aria-pressed="true" on selected button', () => {
      render(() => <StrategySelector selected="quality" onChange={vi.fn()} />);
      expect(screen.getByText('Quality')).toHaveAttribute('aria-pressed', 'true');
    });

    it('sets aria-pressed="false" on non-selected buttons', () => {
      render(() => <StrategySelector selected="quality" onChange={vi.fn()} />);
      expect(screen.getByText('Smart')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Fast')).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('click behavior', () => {
    it.each([
      ['Smart', 'smart'],
      ['Fast', 'fast'],
      ['Quality', 'quality'],
    ] as const)('clicking "%s" calls onChange with "%s"', (label, expectedId) => {
      const onChange = vi.fn();
      render(() => <StrategySelector selected="smart" onChange={onChange} />);
      fireEvent.click(screen.getByText(label));
      expect(onChange).toHaveBeenCalledWith(expectedId);
    });
  });

  describe('button attributes', () => {
    it.each([
      ['Smart', 'Intelligent provider selection', 'smart'],
      ['Fast', 'Optimize for speed', 'fast'],
      ['Quality', 'Optimize for quality', 'quality'],
    ])('"%s" button has title="%s" and data-strategy="%s"', (label, title, strategy) => {
      render(() => <StrategySelector selected="smart" onChange={vi.fn()} />);
      const btn = screen.getByText(label);
      expect(btn).toHaveAttribute('title', title);
      expect(btn).toHaveAttribute('data-strategy', strategy);
    });
  });

  it('wraps buttons in a group with aria-label', () => {
    render(() => <StrategySelector selected="smart" onChange={vi.fn()} />);
    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-label', 'Strategy selection');
  });

  // -----------------------------------------------------------------------
  // Verify non-selected buttons don't have active class
  // -----------------------------------------------------------------------

  it('non-selected buttons do not have "active" class', () => {
    const { container } = render(() => <StrategySelector selected="fast" onChange={vi.fn()} />);
    const buttons = container.querySelectorAll('.strategy-button');
    const smartBtn = Array.from(buttons).find(b => b.textContent === 'Smart');
    const qualityBtn = Array.from(buttons).find(b => b.textContent === 'Quality');
    expect(smartBtn?.className).not.toContain('active');
    expect(qualityBtn?.className).not.toContain('active');
  });

  it('sets aria-pressed=false on non-selected strategies', () => {
    render(() => <StrategySelector selected="quality" onChange={vi.fn()} />);
    const smartBtn = screen.getByText('Smart');
    const fastBtn = screen.getByText('Fast');
    expect(smartBtn).toHaveAttribute('aria-pressed', 'false');
    expect(fastBtn).toHaveAttribute('aria-pressed', 'false');
  });

  describe('branch coverage for each selected strategy', () => {
    it('with fast selected, only Fast has active class', () => {
      render(() => <StrategySelector selected="fast" onChange={vi.fn()} />);
      const smart = screen.getByText('Smart');
      const fast = screen.getByText('Fast');
      const quality = screen.getByText('Quality');
      expect(fast.className).toContain('active');
      expect(smart.className).not.toContain('active');
      expect(quality.className).not.toContain('active');
    });

    it('with quality selected, only Quality has active class', () => {
      render(() => <StrategySelector selected="quality" onChange={vi.fn()} />);
      const smart = screen.getByText('Smart');
      const fast = screen.getByText('Fast');
      const quality = screen.getByText('Quality');
      expect(quality.className).toContain('active');
      expect(smart.className).not.toContain('active');
      expect(fast.className).not.toContain('active');
    });

    it('with fast selected, aria-pressed is true only for Fast', () => {
      render(() => <StrategySelector selected="fast" onChange={vi.fn()} />);
      expect(screen.getByText('Fast')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Smart')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Quality')).toHaveAttribute('aria-pressed', 'false');
    });

    it('with quality selected, aria-pressed is true only for Quality', () => {
      render(() => <StrategySelector selected="quality" onChange={vi.fn()} />);
      expect(screen.getByText('Quality')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('Smart')).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Fast')).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
