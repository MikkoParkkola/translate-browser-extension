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
});
