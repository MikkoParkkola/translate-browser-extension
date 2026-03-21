import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { ProviderSelector } from './ProviderSelector';

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

describe('ProviderSelector', () => {
  it('renders two provider buttons', () => {
    render(() => <ProviderSelector selected="opus-mt" onChange={vi.fn()} />);
    expect(screen.getByText('OPUS-MT')).toBeInTheDocument();
    expect(screen.getByText('TranslateGemma')).toBeInTheDocument();
  });

  it('shows provider tags', () => {
    render(() => <ProviderSelector selected="opus-mt" onChange={vi.fn()} />);
    expect(screen.getByText('Fast')).toBeInTheDocument();
    expect(screen.getByText('Quality')).toBeInTheDocument();
  });

  describe('selected state', () => {
    it('applies "active" class to selected provider', () => {
      const { container } = render(() => (
        <ProviderSelector selected="opus-mt" onChange={vi.fn()} />
      ));
      const buttons = container.querySelectorAll('.provider-button');
      const opusMtBtn = Array.from(buttons).find((b) => b.textContent?.includes('OPUS-MT'));
      expect(opusMtBtn).toHaveClass('active');
    });

    it('does not apply "active" class to non-selected provider', () => {
      const { container } = render(() => (
        <ProviderSelector selected="opus-mt" onChange={vi.fn()} />
      ));
      const buttons = container.querySelectorAll('.provider-button');
      const gemmaBtn = Array.from(buttons).find((b) =>
        b.textContent?.includes('TranslateGemma'),
      );
      expect(gemmaBtn).not.toHaveClass('active');
    });

    it('switches active class when selected changes', () => {
      const { container } = render(() => (
        <ProviderSelector selected="translategemma" onChange={vi.fn()} />
      ));
      const buttons = container.querySelectorAll('.provider-button');
      const gemmaBtn = Array.from(buttons).find((b) =>
        b.textContent?.includes('TranslateGemma'),
      );
      const opusMtBtn = Array.from(buttons).find((b) => b.textContent?.includes('OPUS-MT'));
      expect(gemmaBtn).toHaveClass('active');
      expect(opusMtBtn).not.toHaveClass('active');
    });
  });

  describe('click behavior', () => {
    it('clicking OPUS-MT calls onChange with "opus-mt"', () => {
      const onChange = vi.fn();
      render(() => <ProviderSelector selected="translategemma" onChange={onChange} />);
      fireEvent.click(screen.getByText('OPUS-MT'));
      expect(onChange).toHaveBeenCalledWith('opus-mt');
    });

    it('clicking TranslateGemma calls onChange with "translategemma"', () => {
      const onChange = vi.fn();
      render(() => <ProviderSelector selected="opus-mt" onChange={onChange} />);
      fireEvent.click(screen.getByText('TranslateGemma'));
      expect(onChange).toHaveBeenCalledWith('translategemma');
    });
  });

  it('shows "Model" label', () => {
    render(() => <ProviderSelector selected="opus-mt" onChange={vi.fn()} />);
    expect(screen.getByText('Model')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Verify non-selected button gets empty active class
  // -----------------------------------------------------------------------

  it('non-selected provider button does not have "active" class', () => {
    const { container } = render(() => <ProviderSelector selected="opus-mt" onChange={vi.fn()} />);
    const buttons = container.querySelectorAll('.provider-button');
    // Second button is TranslateGemma, which is not selected
    expect(buttons[1].className).not.toContain('active');
  });

  it('selected provider button has "active" class', () => {
    const { container } = render(() => <ProviderSelector selected="translategemma" onChange={vi.fn()} />);
    const buttons = container.querySelectorAll('.provider-button');
    // Second button is TranslateGemma, which IS selected
    expect(buttons[1].className).toContain('active');
    // First button is OPUS-MT, not selected
    expect(buttons[0].className).not.toContain('active');
  });
});
