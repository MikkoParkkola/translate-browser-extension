import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import { LanguageSelector } from './LanguageSelector';

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

const defaultProps = () => ({
  sourceLang: 'auto',
  targetLang: 'fi',
  onSourceChange: vi.fn(),
  onTargetChange: vi.fn(),
  onSwap: vi.fn(),
});

describe('LanguageSelector', () => {
  it('renders two select elements', () => {
    render(() => <LanguageSelector {...defaultProps()} />);
    const sourceSelect = screen.getByLabelText('Source language');
    const targetSelect = screen.getByLabelText('Target language');
    expect(sourceSelect).toBeInTheDocument();
    expect(targetSelect).toBeInTheDocument();
  });

  describe('source select', () => {
    it('includes "Auto Detect" option', () => {
      render(() => <LanguageSelector {...defaultProps()} />);
      const sourceSelect = screen.getByLabelText('Source language') as HTMLSelectElement;
      const options = Array.from(sourceSelect.options);
      const autoOption = options.find((o) => o.value === 'auto');
      expect(autoOption).toBeDefined();
      expect(autoOption!.textContent).toContain('Auto Detect');
    });

    it('includes all 12 languages', () => {
      render(() => <LanguageSelector {...defaultProps()} />);
      const sourceSelect = screen.getByLabelText('Source language') as HTMLSelectElement;
      expect(sourceSelect.options.length).toBe(12);
    });

    it('reflects sourceLang prop value', () => {
      render(() => <LanguageSelector {...defaultProps()} />);
      const sourceSelect = screen.getByLabelText('Source language') as HTMLSelectElement;
      expect(sourceSelect.value).toBe('auto');
    });

    it('reflects a non-default sourceLang prop', () => {
      const props = { ...defaultProps(), sourceLang: 'en' };
      render(() => <LanguageSelector {...props} />);
      const sourceSelect = screen.getByLabelText('Source language') as HTMLSelectElement;
      expect(sourceSelect.value).toBe('en');
    });

    it('calls onSourceChange when value changes', () => {
      const props = defaultProps();
      render(() => <LanguageSelector {...props} />);
      const sourceSelect = screen.getByLabelText('Source language');
      fireEvent.change(sourceSelect, { target: { value: 'en' } });
      expect(props.onSourceChange).toHaveBeenCalledWith('en');
    });

    it('has correct aria-label', () => {
      render(() => <LanguageSelector {...defaultProps()} />);
      const sourceSelect = screen.getByLabelText('Source language');
      expect(sourceSelect).toHaveAttribute('aria-label', 'Source language');
    });
  });

  describe('target select', () => {
    it('excludes "Auto Detect" option', () => {
      render(() => <LanguageSelector {...defaultProps()} />);
      const targetSelect = screen.getByLabelText('Target language') as HTMLSelectElement;
      const options = Array.from(targetSelect.options);
      const autoOption = options.find((o) => o.value === 'auto');
      expect(autoOption).toBeUndefined();
    });

    it('has 11 languages (12 minus auto)', () => {
      render(() => <LanguageSelector {...defaultProps()} />);
      const targetSelect = screen.getByLabelText('Target language') as HTMLSelectElement;
      expect(targetSelect.options.length).toBe(11);
    });

    it('reflects targetLang prop value', () => {
      render(() => <LanguageSelector {...defaultProps()} />);
      const targetSelect = screen.getByLabelText('Target language') as HTMLSelectElement;
      expect(targetSelect.value).toBe('fi');
    });

    it('calls onTargetChange when value changes', () => {
      const props = defaultProps();
      render(() => <LanguageSelector {...props} />);
      const targetSelect = screen.getByLabelText('Target language');
      fireEvent.change(targetSelect, { target: { value: 'de' } });
      expect(props.onTargetChange).toHaveBeenCalledWith('de');
    });

    it('has correct aria-label', () => {
      render(() => <LanguageSelector {...defaultProps()} />);
      const targetSelect = screen.getByLabelText('Target language');
      expect(targetSelect).toHaveAttribute('aria-label', 'Target language');
    });
  });

  describe('swap button', () => {
    it('renders a swap button', () => {
      render(() => <LanguageSelector {...defaultProps()} />);
      const swapBtn = screen.getByLabelText('Swap languages');
      expect(swapBtn).toBeInTheDocument();
    });

    it('calls onSwap when clicked', () => {
      const props = defaultProps();
      render(() => <LanguageSelector {...props} />);
      const swapBtn = screen.getByLabelText('Swap languages');
      fireEvent.click(swapBtn);
      expect(props.onSwap).toHaveBeenCalledTimes(1);
    });
  });

  it('wraps in a section with aria-label "Language selection"', () => {
    const { container } = render(() => <LanguageSelector {...defaultProps()} />);
    const section = container.querySelector('section');
    expect(section).toHaveAttribute('aria-label', 'Language selection');
  });
});
