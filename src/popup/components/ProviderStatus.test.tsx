import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { ProviderStatus } from './ProviderStatus';

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

describe('ProviderStatus', () => {
  describe('ready status', () => {
    it('renders provider name and "Ready" text', () => {
      render(() => <ProviderStatus name="OPUS-MT" status="ready" />);
      expect(screen.getByText('OPUS-MT')).toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();
    });

    it('applies status--ready CSS class', () => {
      const { container } = render(() => <ProviderStatus name="OPUS-MT" status="ready" />);
      const indicator = container.querySelector('.status-indicator');
      expect(indicator).toHaveClass('status--ready');
    });

    it('has correct aria-label', () => {
      render(() => <ProviderStatus name="OPUS-MT" status="ready" />);
      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        'Provider: OPUS-MT, Ready',
      );
    });
  });

  describe('loading status', () => {
    it('renders "Loading..." text', () => {
      render(() => <ProviderStatus name="DeepL" status="loading" />);
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('applies status--loading CSS class', () => {
      const { container } = render(() => <ProviderStatus name="DeepL" status="loading" />);
      const indicator = container.querySelector('.status-indicator');
      expect(indicator).toHaveClass('status--loading');
    });

    it('has correct aria-label', () => {
      render(() => <ProviderStatus name="DeepL" status="loading" />);
      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        'Provider: DeepL, Loading...',
      );
    });
  });

  describe('error status', () => {
    it('renders "Error" text', () => {
      render(() => <ProviderStatus name="Google" status="error" />);
      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('applies status--error CSS class', () => {
      const { container } = render(() => <ProviderStatus name="Google" status="error" />);
      const indicator = container.querySelector('.status-indicator');
      expect(indicator).toHaveClass('status--error');
    });

    it('has correct aria-label', () => {
      render(() => <ProviderStatus name="Google" status="error" />);
      expect(screen.getByRole('status')).toHaveAttribute(
        'aria-label',
        'Provider: Google, Error',
      );
    });
  });

  it('has aria-live="polite" for accessibility', () => {
    render(() => <ProviderStatus name="Test" status="ready" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  it('marks status indicator as aria-hidden', () => {
    const { container } = render(() => <ProviderStatus name="Test" status="ready" />);
    const indicator = container.querySelector('.status-indicator');
    expect(indicator).toHaveAttribute('aria-hidden', 'true');
  });

  // -----------------------------------------------------------------------
  // Verify all three status variants are distinct
  // -----------------------------------------------------------------------

  it('each status variant produces a different class', () => {
    const { container: c1 } = render(() => <ProviderStatus name="A" status="ready" />);
    const { container: c2 } = render(() => <ProviderStatus name="B" status="loading" />);
    const { container: c3 } = render(() => <ProviderStatus name="C" status="error" />);
    const class1 = c1.querySelector('.status-indicator')?.className;
    const class2 = c2.querySelector('.status-indicator')?.className;
    const class3 = c3.querySelector('.status-indicator')?.className;
    expect(class1).not.toBe(class2);
    expect(class2).not.toBe(class3);
  });

  describe('statusIndicator branch exhaustion', () => {
    it('ready status returns distinct icon, text, and class', () => {
      const { container } = render(() => <ProviderStatus name="TestReady" status="ready" />);
      expect(container.querySelector('.status--ready')).toBeTruthy();
      expect(container.querySelector('.status-text')?.textContent).toBe('Ready');
    });

    it('loading status returns distinct icon, text, and class', () => {
      const { container } = render(() => <ProviderStatus name="TestLoad" status="loading" />);
      expect(container.querySelector('.status--loading')).toBeTruthy();
      expect(container.querySelector('.status-text')?.textContent).toBe('Loading...');
    });

    it('error status returns distinct icon, text, and class', () => {
      const { container } = render(() => <ProviderStatus name="TestErr" status="error" />);
      expect(container.querySelector('.status--error')).toBeTruthy();
      expect(container.querySelector('.status-text')?.textContent).toBe('Error');
    });

    it('provider name appears in aria-label for all statuses', () => {
      for (const status of ['ready', 'loading', 'error'] as const) {
        const { container, unmount } = render(() => <ProviderStatus name={`P-${status}`} status={status} />);
        const el = container.querySelector('.provider-status');
        expect(el?.getAttribute('aria-label')).toContain(`P-${status}`);
        unmount();
      }
    });

    it('status indicator icon is rendered for all statuses', () => {
      const statuses: Array<'ready' | 'loading' | 'error'> = ['ready', 'loading', 'error'];
      
      for (const status of statuses) {
        const { container, unmount } = render(() => <ProviderStatus name="Test" status={status} />);
        const icon = container.querySelector('.status-icon');
        expect(icon).toBeTruthy();
        unmount();
      }
    });
  });

  describe('accessibility attributes', () => {
    it('uses correct aria-live for status updates', () => {
      const { container } = render(() => <ProviderStatus name="Test" status="ready" />);
      const el = container.querySelector('[aria-live]');
      expect(el?.getAttribute('aria-live')).toBe('polite');
    });

    it('provides descriptive aria-label combining provider name and status', () => {
      const { container } = render(() => <ProviderStatus name="CustomProvider" status="loading" />);
      const el = container.querySelector('.provider-status');
      expect(el?.getAttribute('aria-label')).toBe('Provider: CustomProvider, Loading...');
    });

    it('status text is not hidden from screen readers', () => {
      const { container } = render(() => <ProviderStatus name="Test" status="ready" />);
      const statusText = container.querySelector('.status-text');
      // Status text should be visible to screen readers (not aria-hidden)
      expect(statusText?.getAttribute('aria-hidden')).not.toBe('true');
    });
  });

  describe('component name prop', () => {
    it('renders provider name correctly', () => {
      render(() => <ProviderStatus name="Custom Provider" status="ready" />);
      expect(screen.getByText('Custom Provider')).toBeTruthy();
    });

    it('displays long provider names', () => {
      const longName = 'Very Long Provider Name With Many Words';
      render(() => <ProviderStatus name={longName} status="ready" />);
      expect(screen.getByText(longName)).toBeTruthy();
    });

    it('includes provider name in aria-label with status text', () => {
      render(() => <ProviderStatus name="MyProvider" status="error" />);
      const el = screen.getByRole('status');
      expect(el.getAttribute('aria-label')).toMatch('MyProvider');
      expect(el.getAttribute('aria-label')).toMatch('Error');
    });
  });

  describe('switch statement branch exhaustion', () => {
    it('switch covers all three status cases: ready, loading, error', () => {
      const statuses: Array<'ready' | 'loading' | 'error'> = ['ready', 'loading', 'error'];
      const results = statuses.map((status) => {
        const { container } = render(() => <ProviderStatus name="Test" status={status} />);
        const indicator = container.querySelector('.status-indicator');
        return {
          status,
          hasClass: (cls: string) => indicator?.className.includes(cls),
        };
      });

      expect(results[0].hasClass('status--ready')).toBe(true);
      expect(results[1].hasClass('status--loading')).toBe(true);
      expect(results[2].hasClass('status--error')).toBe(true);
    });

    it('each branch returns distinct status text', () => {
      const { container: c1 } = render(() => <ProviderStatus name="A" status="ready" />);
      const { container: c2 } = render(() => <ProviderStatus name="B" status="loading" />);
      const { container: c3 } = render(() => <ProviderStatus name="C" status="error" />);

      const text1 = c1.querySelector('.status-text')?.textContent;
      const text2 = c2.querySelector('.status-text')?.textContent;
      const text3 = c3.querySelector('.status-text')?.textContent;

      expect(text1).toBe('Ready');
      expect(text2).toBe('Loading...');
      expect(text3).toBe('Error');
      expect(new Set([text1, text2, text3]).size).toBe(3);
    });
  });
});
