import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@solidjs/testing-library';
import { ModelStatus } from './ModelStatus';

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

const baseProps = {
  isLoading: false,
  progress: 0,
  isCached: false,
  modelId: null as string | null,
  currentFile: null as string | null,
};

describe('ModelStatus', () => {
  describe('hidden state', () => {
    it('renders nothing when not loading and not cached', () => {
      const { container } = render(() => <ModelStatus {...baseProps} />);
      expect(container.querySelector('.model-status')).toBeNull();
    });
  });

  describe('loading state', () => {
    it('shows download progress when isLoading=true', () => {
      render(() => (
        <ModelStatus {...baseProps} isLoading={true} progress={45} modelId="Xenova/opus-mt-en-fi" />
      ));
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('shows correct percentage in progress bar', () => {
      render(() => (
        <ModelStatus {...baseProps} isLoading={true} progress={45} modelId="Xenova/opus-mt-en-fi" />
      ));
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '45');
      expect(screen.getByText('45%')).toBeInTheDocument();
    });

    it('rounds fractional progress', () => {
      render(() => (
        <ModelStatus {...baseProps} isLoading={true} progress={67.8} modelId="Xenova/opus-mt-en-fi" />
      ));
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar).toHaveAttribute('aria-valuenow', '68');
      expect(screen.getByText('68%')).toBeInTheDocument();
    });

    it('shows "Downloading EN-FI..." for modelId "Xenova/opus-mt-en-fi"', () => {
      render(() => (
        <ModelStatus {...baseProps} isLoading={true} progress={30} modelId="Xenova/opus-mt-en-fi" />
      ));
      expect(screen.getByText('Downloading EN-FI...')).toBeInTheDocument();
    });

    it('shows "Initializing model..." when progress=100 and still loading', () => {
      render(() => (
        <ModelStatus {...baseProps} isLoading={true} progress={100} modelId="Xenova/opus-mt-en-fi" />
      ));
      expect(screen.getByText('Initializing model...')).toBeInTheDocument();
    });

    it('shows file info when currentFile is provided', () => {
      render(() => (
        <ModelStatus
          {...baseProps}
          isLoading={true}
          progress={50}
          modelId="Xenova/opus-mt-en-fi"
          currentFile="onnx/model.onnx"
        />
      ));
      expect(screen.getByText('model.onnx')).toBeInTheDocument();
    });

    it('shows estimated size when progress=0 (first-time download)', () => {
      render(() => (
        <ModelStatus {...baseProps} isLoading={true} progress={0} modelId="Xenova/opus-mt-en-fi" />
      ));
      expect(screen.getByText(/First-time download/)).toBeInTheDocument();
      expect(screen.getByText(/~50-100 MB/)).toBeInTheDocument();
    });

    it('does not show estimated size when progress > 0', () => {
      render(() => (
        <ModelStatus {...baseProps} isLoading={true} progress={10} modelId="Xenova/opus-mt-en-fi" />
      ));
      expect(screen.queryByText(/First-time download/)).toBeNull();
    });

    it('does not show file info when currentFile is null', () => {
      const { container } = render(() => (
        <ModelStatus {...baseProps} isLoading={true} progress={50} modelId="Xenova/opus-mt-en-fi" />
      ));
      expect(container.querySelector('.model-file-info')).toBeNull();
    });

    describe('progress bar aria attributes', () => {
      it('has correct aria-valuemin and aria-valuemax', () => {
        render(() => (
          <ModelStatus {...baseProps} isLoading={true} progress={50} modelId="test" />
        ));
        const progressbar = screen.getByRole('progressbar');
        expect(progressbar).toHaveAttribute('aria-valuemin', '0');
        expect(progressbar).toHaveAttribute('aria-valuemax', '100');
      });

      it('has descriptive aria-label', () => {
        render(() => (
          <ModelStatus {...baseProps} isLoading={true} progress={75} modelId="test" />
        ));
        const progressbar = screen.getByRole('progressbar');
        expect(progressbar).toHaveAttribute('aria-label', 'Model download progress: 75%');
      });
    });
  });

  describe('cached (ready) state', () => {
    it('shows ready state when isCached=true and not loading', () => {
      const { container } = render(() => (
        <ModelStatus {...baseProps} isCached={true} modelId="Xenova/opus-mt-en-fi" />
      ));
      expect(container.querySelector('.model-cached')).toBeInTheDocument();
    });

    it('shows short model name with "ready"', () => {
      render(() => (
        <ModelStatus {...baseProps} isCached={true} modelId="Xenova/opus-mt-en-fi" />
      ));
      expect(screen.getByText('EN-FI ready')).toBeInTheDocument();
    });

    it('shows "Model ready" when modelId is null', () => {
      render(() => (
        <ModelStatus {...baseProps} isCached={true} modelId={null} />
      ));
      expect(screen.getByText('Model ready')).toBeInTheDocument();
    });

    it('does not show progress bar', () => {
      render(() => (
        <ModelStatus {...baseProps} isCached={true} modelId="Xenova/opus-mt-en-fi" />
      ));
      expect(screen.queryByRole('progressbar')).toBeNull();
    });
  });

  it('has role="status" and aria-live="polite" on wrapper', () => {
    render(() => (
      <ModelStatus {...baseProps} isCached={true} modelId="test" />
    ));
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });

  // -----------------------------------------------------------------------
  // isLoading + isCached both true — cached section should NOT render
  // -----------------------------------------------------------------------

  it('does not show cached section when both isLoading and isCached are true', () => {
    const { container } = render(() => (
      <ModelStatus {...baseProps} isLoading={true} isCached={true} progress={50} modelId="Xenova/opus-mt-en-fi" />
    ));
    expect(container.querySelector('.model-loading')).toBeInTheDocument();
    expect(container.querySelector('.model-cached')).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Non-opus-mt modelId in getShortModelName returns modelId directly
  // -----------------------------------------------------------------------

  it('shows raw modelId in cached state for non-opus-mt models', () => {
    render(() => (
      <ModelStatus {...baseProps} isCached={true} modelId="some-other-model" />
    ));
    expect(screen.getByText('some-other-model ready')).toBeInTheDocument();
  });

  it('shows file info with simple filename (no slashes)', () => {
    render(() => (
      <ModelStatus {...baseProps} isLoading={true} progress={50} modelId="test" currentFile="model.onnx" />
    ));
    expect(screen.getByText('model.onnx')).toBeInTheDocument();
  });

  describe('getShortFileName edge cases', () => {
    it('shows only the filename part from a nested path', () => {
      render(() => (
        <ModelStatus {...baseProps} isLoading={true} progress={50} modelId="test" currentFile="onnx/quantized/model.onnx" />
      ));
      expect(screen.getByText('model.onnx')).toBeInTheDocument();
    });

    it('does not render file info section when currentFile is null during loading', () => {
      const { container } = render(() => (
        <ModelStatus {...baseProps} isLoading={true} progress={50} modelId="test" currentFile={null} />
      ));
      expect(container.querySelector('.model-file-info')).toBeNull();
    });
  });

  describe('outer Show condition edge cases', () => {
    it('renders nothing when isLoading=false and isCached=false', () => {
      const { container } = render(() => (
        <ModelStatus isLoading={false} progress={0} isCached={false} modelId={null} currentFile={null} />
      ));
      expect(container.querySelector('.model-status')).toBeNull();
    });

    it('renders when only isCached=true (not loading)', () => {
      const { container } = render(() => (
        <ModelStatus isLoading={false} progress={0} isCached={true} modelId="Xenova/opus-mt-en-fi" currentFile={null} />
      ));
      expect(container.querySelector('.model-cached')).toBeTruthy();
    });

    it('shows loading section but not cached section when both isLoading and isCached are true', () => {
      const { container } = render(() => (
        <ModelStatus isLoading={true} progress={50} isCached={true} modelId="Xenova/opus-mt-en-fi" currentFile={null} />
      ));
      expect(container.querySelector('.model-loading')).toBeTruthy();
      expect(container.querySelector('.model-cached')).toBeNull();
    });

    it('getShortModelName returns full modelId for non-opus-mt model in loading state', () => {
      render(() => (
        <ModelStatus isLoading={true} progress={50} isCached={false} modelId="some-custom-model" currentFile={null} />
      ));
      expect(screen.getByText(/Downloading some-custom-model/)).toBeInTheDocument();
    });
  });
});
