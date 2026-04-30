import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@solidjs/testing-library';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

// Mock chrome global
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    openOptionsPage: vi.fn(),
  },
  storage: {
    local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) },
  },
  tabs: {
    query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
    sendMessage: vi.fn().mockResolvedValue({}),
  },
  scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
});

// Mock navigator.gpu for WebGPU checks
vi.stubGlobal('navigator', {
  ...globalThis.navigator,
  language: 'en-US',
  gpu: undefined,
});

vi.mock('../core/storage', () => ({
  safeStorageGet: vi.fn().mockResolvedValue({}),
  safeStorageSet: vi.fn().mockResolvedValue(true),
}));

vi.mock('../core/browser-api', () => {
  const runtimeSendMessage = vi.fn().mockResolvedValue({});
  return {
    browserAPI: {
      runtime: {
        sendMessage: runtimeSendMessage,
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        openOptionsPage: vi.fn(),
      },
      storage: {
        local: { get: vi.fn().mockResolvedValue({}) },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
        sendMessage: vi.fn().mockResolvedValue({}),
      },
      scripting: { executeScript: vi.fn().mockResolvedValue(undefined) },
    },
    sendMessage: runtimeSendMessage,
  };
});

vi.mock('../core/version', () => ({
  checkVersion: vi.fn().mockResolvedValue({ isUpdate: false, current: '1.0.0' }),
  dismissUpdateNotice: vi.fn(),
  isUpdateDismissed: vi.fn().mockResolvedValue(false),
}));

vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Subject under test — imported AFTER mocks are wired
// ---------------------------------------------------------------------------
import App from './App';
import { browserAPI } from '../core/browser-api';
import { safeStorageGet, safeStorageSet } from '../core/storage';
import { checkVersion, dismissUpdateNotice, isUpdateDismissed } from '../core/version';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush microtasks so Solid's onMount effects resolve. */
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('App component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-set default resolved values after resetAllMocks
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  it('renders without crashing', async () => {
    expect(() => render(() => <App />)).not.toThrow();
    await flush();
  });

  it('shows TRANSLATE! title', async () => {
    render(() => <App />);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('shows brand author text', async () => {
    render(() => <App />);
    await flush();
    expect(screen.getByText('by Mikko')).toBeTruthy();
  });

  it('renders settings button', async () => {
    render(() => <App />);
    await flush();
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });

  it('renders language selector section', async () => {
    render(() => <App />);
    await flush();
    expect(screen.getByLabelText('Language selection')).toBeTruthy();
  });

  it('renders strategy selector section', async () => {
    render(() => <App />);
    await flush();
    expect(screen.getByLabelText('Translation strategy')).toBeTruthy();
  });

  it('renders translation action buttons', async () => {
    render(() => <App />);
    await flush();
    expect(screen.getByText('Page')).toBeTruthy();
    expect(screen.getByText('Selection')).toBeTruthy();
    expect(screen.getByText('Undo')).toBeTruthy();
  });

  it('renders auto-translate toggle', async () => {
    render(() => <App />);
    await flush();
    expect(screen.getByLabelText('Auto-translate pages')).toBeTruthy();
  });

  it('renders bilingual mode toggle', async () => {
    render(() => <App />);
    await flush();
    expect(screen.getByLabelText('Bilingual mode')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('App action buttons', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.scripting.executeScript as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  it('Translate Page button triggers translation', async () => {
    render(() => <App />);
    await flush();

    const pageBtn = screen.getByLabelText('Translate entire page');
    fireEvent.click(pageBtn);

    await vi.waitFor(() => {
      expect(browserAPI.tabs.query).toHaveBeenCalled();
    });
  });

  it('Translate Selection button triggers selection translation', async () => {
    render(() => <App />);
    await flush();

    const selBtn = screen.getByLabelText('Translate selected text');
    fireEvent.click(selBtn);

    await vi.waitFor(() => {
      expect(browserAPI.tabs.query).toHaveBeenCalled();
    });
  });

  it('Undo button sends undo message', async () => {
    render(() => <App />);
    await flush();

    const undoBtn = screen.getByLabelText('Undo translation');
    fireEvent.click(undoBtn);

    await vi.waitFor(() => {
      expect(browserAPI.tabs.query).toHaveBeenCalled();
    });
  });

  it('Page button shows translating state when clicked', async () => {
    // Make the tab message hang so isTranslating stays true briefly
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    render(() => <App />);
    await flush();

    const pageBtn = screen.getByLabelText('Translate entire page');
    fireEvent.click(pageBtn);

    await vi.waitFor(() => {
      // While translating the button should be disabled or show the spinner label
      const btn = screen.getByLabelText('Translating page...');
      expect(btn).toBeTruthy();
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------

describe('App error handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  it('shows error banner when translation fails', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Something went wrong'),
    );

    render(() => <App />);
    await flush();

    const pageBtn = screen.getByLabelText('Translate entire page');
    fireEvent.click(pageBtn);

    await vi.waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeTruthy();
    });
  });

  it('error banner has dismiss button', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Something went wrong'),
    );

    render(() => <App />);
    await flush();

    const pageBtn = screen.getByLabelText('Translate entire page');
    fireEvent.click(pageBtn);

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Dismiss error')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------

describe('App settings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  it('settings button opens options page', async () => {
    render(() => <App />);
    await flush();

    const settingsBtn = screen.getByLabelText('Settings');
    fireEvent.click(settingsBtn);

    expect(browserAPI.runtime.openOptionsPage).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe('App initialization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  it('loads saved preferences on mount', async () => {
    render(() => <App />);
    await flush();

    await vi.waitFor(() => {
      expect(safeStorageGet).toHaveBeenCalledWith([
        'sourceLang',
        'targetLang',
        'strategy',
        'autoTranslate',
        'provider',
      ]);
    });
  });

  it('checks chrome translator availability on mount', async () => {
    render(() => <App />);
    await flush();

    await vi.waitFor(() => {
      expect(browserAPI.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'checkChromeTranslator',
      });
    });
  });
});

// ---------------------------------------------------------------------------

describe('App handleError branches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  const rejectTranslateCommand = (error: unknown) => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (_tabId: number, message: { type?: string }) => {
        if (message?.type === 'ping') {
          return Promise.resolve({});
        }
        return Promise.reject(error);
      },
    );
  };

  it('shows "Cannot access" error for restricted page errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Cannot access this page'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Cannot translate this page');
    });
  });

  it('shows settings action for "not configured" errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('API key not configured'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Open Settings')).toBeTruthy();
    });
  });

  it('shows settings action for "api key" errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Invalid api key provided'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Open Settings')).toBeTruthy();
    });
  });

  it('shows OPUS-MT action for "no network" errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('No network available'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Use OPUS-MT')).toBeTruthy();
    });
  });

  it('shows OPUS-MT action for "offline" errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('You are offline'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Use OPUS-MT')).toBeTruthy();
    });
  });

  it('shows error for "language pair" errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Language pair en-xx not supported'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Language pair');
    });
  });

  it('shows error for "not available" errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Translation not available for this language'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('not available');
    });
  });

  it('shows error for "unsupported" errors', async () => {
    rejectTranslateCommand(new Error('unsupported language direction'));
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('unsupported');
    });
  });

  it('shows retry action for "network" errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network request failed'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Retry')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toContain('Connection error');
    });
  });

  it('shows retry action for "connection" errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('connection refused'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Retry')).toBeTruthy();
    });
  });

  it('shows retry action for fetch errors (not model)', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('fetch failed'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Retry')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toContain('Connection error');
    });
  });

  it('shows retry action for rate limit errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Rate limit exceeded'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Rate limited');
    });
  });

  it('shows retry action for timeout errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Request timed out'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('timed out');
    });
  });

  it('shows retry action for "timeout" errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('timeout after 30s'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('timeout');
    });
  });

  it('shows switch provider action for model errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('model not loaded yet'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Switch Provider')).toBeTruthy();
    });
  });

  it('shows switch provider action for pipeline errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('pipeline initialization failed'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Switch Provider')).toBeTruthy();
    });
  });

  it('shows switch provider action for load errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Failed to load weights'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Switch Provider')).toBeTruthy();
    });
  });

  it('shows memory error without action button', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Out of memory'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Out of memory');
    });
  });

  it('shows OOM error without action button', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('OOM: allocation failed'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('OOM');
    });
  });

  it('shows generic error with retry for unknown errors', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Some totally unknown error'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Some totally unknown error');
    });
  });

  it('handles non-Error thrown values', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue('string error');
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });

  it('handles structured error response from content script', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
      error: 'Content script error',
    });
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });

  it('dismiss button clears the error', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Some error'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Dismiss error'));
    await vi.waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------

describe('App onMount branches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('loads stored preferences when present', async () => {
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceLang: 'fi',
      targetLang: 'en',
      strategy: 'quality',
      autoTranslate: true,
      provider: 'deepl',
    });
    render(() => <App />);
    await flush();
    // Just verify the component renders successfully after loading prefs
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('checks TranslateGemma hardware acceleration on mount', async () => {
    render(() => <App />);
    await flush();
    await vi.waitFor(() => {
      expect(browserAPI.runtime.sendMessage).toHaveBeenCalledWith({ type: 'checkWebGPU' });
      expect(browserAPI.runtime.sendMessage).toHaveBeenCalledWith({ type: 'checkWebNN' });
    });
  });

  it('treats TranslateGemma as available when WebGPU is supported', async () => {
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>)
      .mockImplementation((msg: { type: string }) => {
        if (msg.type === 'checkWebGPU') return Promise.resolve({ supported: true });
        if (msg.type === 'checkWebNN') return Promise.resolve({ supported: false });
        return Promise.resolve({});
      });
    render(() => <App />);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles hardware acceleration checks failure gracefully', async () => {
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>)
      .mockImplementation((msg: { type: string }) => {
        if (msg.type === 'checkWebGPU') return Promise.reject(new Error('GPU unavailable'));
        if (msg.type === 'checkWebNN') return Promise.reject(new Error('WebNN unavailable'));
        return Promise.resolve({});
      });
    render(() => <App />);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles chrome translator available=true response', async () => {
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>)
      .mockImplementation((msg: { type: string }) => {
        if (msg.type === 'checkChromeTranslator') return Promise.resolve({ available: true });
        return Promise.resolve({});
      });
    render(() => <App />);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles chrome translator check failure', async () => {
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>)
      .mockImplementation((msg: { type: string }) => {
        if (msg.type === 'checkChromeTranslator') return Promise.reject(new Error('blocked'));
        return Promise.resolve({});
      });
    render(() => <App />);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('shows update badge when version update detected', async () => {
    (checkVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      isUpdate: true,
      current: '2.0.0',
    });
    (isUpdateDismissed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    render(() => <App />);
    await flush();
    await vi.waitFor(() => {
      expect(screen.getByText('v2.0.0')).toBeTruthy();
    });
  });

  it('does not show update badge when dismissed', async () => {
    (checkVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      isUpdate: true,
      current: '2.0.0',
    });
    (isUpdateDismissed as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    render(() => <App />);
    await flush();
    expect(screen.queryByText('v2.0.0')).toBeNull();
  });

  it('does not show update badge when no update', async () => {
    (checkVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      isUpdate: false,
      current: '1.0.0',
    });
    render(() => <App />);
    await flush();
    expect(screen.queryByText('v1.0.0')).toBeNull();
  });

  it('handles version check failure gracefully', async () => {
    (checkVersion as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('version check failed'));
    render(() => <App />);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('App restricted URL handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  it('shows error for chrome:// URLs on translate page', async () => {
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'chrome://settings' },
    ]);
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Cannot translate browser pages');
    });
  });

  it('shows error for about: URLs on translate page', async () => {
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'about:blank' },
    ]);
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Cannot translate browser pages');
    });
  });

  it('shows error when no tab id on translate page', async () => {
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([{ url: 'https://x.com' }]);
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('No active tab');
    });
  });

  it('shows error when no tab id on translate selection', async () => {
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([{ url: 'https://x.com' }]);
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate selected text'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('No active tab');
    });
  });

  it('shows error for restricted URL on translate selection', async () => {
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'chrome://extensions' },
    ]);
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate selected text'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Cannot translate browser pages');
    });
  });
});

// ---------------------------------------------------------------------------

describe('App provider management', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('toggles auto-translate and persists to storage', async () => {
    render(() => <App />);
    await flush();
    const toggle = screen.getByLabelText('Auto-translate pages');
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(safeStorageSet).toHaveBeenCalled();
    });
  });

  it('update badge click dismisses it', async () => {
    (checkVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      isUpdate: true,
      current: '2.0.0',
    });
    (isUpdateDismissed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    render(() => <App />);
    await flush();
    await vi.waitFor(() => {
      expect(screen.getByText('v2.0.0')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('v2.0.0'));
    await vi.waitFor(() => {
      expect(screen.queryByText('v2.0.0')).toBeNull();
    });
  });

  it('handleTranslatePage handles inject failure', async () => {
    // First sendMessage (ping) rejects, then executeScript also rejects
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not loaded'));
    (browserAPI.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cannot inject'));
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Cannot access');
    });
  });
});

// ---------------------------------------------------------------------------

describe('App model progress handling', () => {
  let capturedListener: ((msg: Record<string, unknown>) => void) | null = null;

  beforeEach(() => {
    vi.resetAllMocks();
    capturedListener = null;
    (browserAPI.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (msg: Record<string, unknown>) => void) => { capturedListener = cb; },
    );
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('ignores messages with type !== modelProgress', async () => {
    render(() => <App />);
    await flush();
    expect(capturedListener).toBeTruthy();
    // Should not throw
    capturedListener!({ type: 'somethingElse' });
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles initiate status for opus-mt model', async () => {
    render(() => <App />);
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'initiate',
      modelId: 'Xenova/opus-mt-en-fi',
      file: 'model.onnx',
      progress: 0,
    });
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles download/progress status for opus-mt model', async () => {
    render(() => <App />);
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'download',
      modelId: 'Xenova/opus-mt-en-fi',
      file: 'model.onnx',
      progress: 50,
    });
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles progress status', async () => {
    render(() => <App />);
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'progress',
      modelId: 'Xenova/opus-mt-en-fi',
      progress: 75,
    });
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles done status', async () => {
    render(() => <App />);
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'done',
      modelId: 'Xenova/opus-mt-en-fi',
      progress: 100,
    });
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles ready status', async () => {
    render(() => <App />);
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'ready',
      modelId: 'Xenova/opus-mt-en-fi',
      progress: 100,
    });
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles error status with error message', async () => {
    render(() => <App />);
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'error',
      modelId: 'Xenova/opus-mt-en-fi',
      error: 'Download failed',
    });
    await flush();
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Model error: Download failed');
    });
  });

  it('handles error status without error message', async () => {
    render(() => <App />);
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'error',
      modelId: 'Xenova/opus-mt-en-fi',
    });
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles translategemma model progress', async () => {
    render(() => <App />);
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'initiate',
      modelId: 'google/translategemma-4b',
      file: 'model.safetensors',
      progress: 0,
    });
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'ready',
      modelId: 'google/translategemma-4b',
      progress: 100,
    });
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles model with unknown provider ID', async () => {
    render(() => <App />);
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'initiate',
      modelId: 'unknown/some-model',
      progress: 0,
    });
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles progress without progress field (defaults to 0)', async () => {
    render(() => <App />);
    await flush();
    capturedListener!({
      type: 'modelProgress',
      status: 'download',
      modelId: 'Xenova/opus-mt-en-fi',
    });
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('messageListener catches errors in handleModelProgress', async () => {
    render(() => <App />);
    await flush();
    // Send a message that will cause an internal issue but not crash
    // The try/catch in messageListener should catch it
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    capturedListener!({ type: 'modelProgress', status: 'initiate', modelId: null as unknown as string });
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------

describe('App language and strategy wrappers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('setSourceLang persists to storage when source language changed', async () => {
    render(() => <App />);
    await flush();
    const sourceSelect = screen.getByLabelText('Source language');
    fireEvent.change(sourceSelect, { target: { value: 'fi' } });
    await vi.waitFor(() => {
      expect(safeStorageSet).toHaveBeenCalledWith(expect.objectContaining({ sourceLang: 'fi' }));
    });
  });

  it('setTargetLang persists to storage when target language changed', async () => {
    render(() => <App />);
    await flush();
    const targetSelect = screen.getByLabelText('Target language');
    fireEvent.change(targetSelect, { target: { value: 'de' } });
    await vi.waitFor(() => {
      expect(safeStorageSet).toHaveBeenCalledWith(expect.objectContaining({ targetLang: 'de' }));
    });
  });

  it('setStrategy persists to storage when strategy changed', async () => {
    render(() => <App />);
    await flush();
    const strategySection = screen.getByLabelText('Translation strategy');
    const fastBtn = within(strategySection).getByText('Fast');
    fireEvent.click(fastBtn);
    await vi.waitFor(() => {
      expect(safeStorageSet).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'fast' }));
    });
  });

  it('swapLanguages swaps source and target when source is not auto', async () => {
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      sourceLang: 'fi',
      targetLang: 'en',
    });
    render(() => <App />);
    await flush();
    const swapBtn = screen.getByLabelText('Swap languages');
    fireEvent.click(swapBtn);
    await vi.waitFor(() => {
      // After swap, source should be 'en' and target should be 'fi'
      expect(safeStorageSet).toHaveBeenCalledWith(expect.objectContaining({ sourceLang: 'en' }));
      expect(safeStorageSet).toHaveBeenCalledWith(expect.objectContaining({ targetLang: 'fi' }));
    });
  });

  it('swapLanguages does nothing when source is auto', async () => {
    render(() => <App />);
    await flush();
    // Default sourceLang is 'auto', so swap should do nothing
    const swapBtn = screen.getByLabelText('Swap languages');
    fireEvent.click(swapBtn);
    // safeStorageSet should not be called with sourceLang (only called during init toggles)
    await flush();
    // Verify no storage calls for language swap
    const setCalls = (safeStorageSet as ReturnType<typeof vi.fn>).mock.calls;
    const swapCalls = setCalls.filter(
      (c: unknown[]) => c[0] && typeof c[0] === 'object' && 'sourceLang' in (c[0] as Record<string, unknown>),
    );
    expect(swapCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('App handleProviderChange', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('changes provider via model selector', async () => {
    render(() => <App />);
    await flush();
    // Open the model selector dropdown
    const trigger = screen.getByLabelText(/Translation model:.*Click to change/);
    fireEvent.click(trigger);
    await flush();
    // Find and click the Chrome Built-in option
    const chromeOption = screen.getByText('Chrome Built-in');
    fireEvent.click(chromeOption);
    await vi.waitFor(() => {
      expect(safeStorageSet).toHaveBeenCalledWith(expect.objectContaining({ provider: 'chrome-builtin' }));
      expect(browserAPI.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'setProvider', provider: 'chrome-builtin' }),
      );
    });
  });

  it('blocks TranslateGemma when WebGPU unavailable', async () => {
    // WebGPU check returns not supported
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (msg: { type: string }) => {
        if (msg.type === 'checkWebGPU') return Promise.resolve({ supported: false });
        return Promise.resolve({});
      },
    );
    render(() => <App />);
    await flush();
    // Open model selector and try to select TranslateGemma
    const trigger = screen.getByLabelText(/Translation model:.*Click to change/);
    fireEvent.click(trigger);
    await flush();
    const gemmaOption = screen.getByText('TranslateGemma');
    fireEvent.click(gemmaOption);
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('WebGPU');
      expect(screen.getByLabelText('Use OPUS-MT')).toBeTruthy();
    });
  });

  it('Use OPUS-MT action button switches provider from TranslateGemma error', async () => {
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (msg: { type: string }) => {
        if (msg.type === 'checkWebGPU') return Promise.resolve({ supported: false });
        return Promise.resolve({});
      },
    );
    render(() => <App />);
    await flush();
    const trigger = screen.getByLabelText(/Translation model:.*Click to change/);
    fireEvent.click(trigger);
    await flush();
    const gemmaOption = screen.getByText('TranslateGemma');
    fireEvent.click(gemmaOption);
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Use OPUS-MT')).toBeTruthy();
    });
    // Click the action button
    fireEvent.click(screen.getByLabelText('Use OPUS-MT'));
    await vi.waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('handleProviderChange catches sendMessage failure', async () => {
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (msg: { type: string }) => {
        if (msg.type === 'setProvider') return Promise.reject(new Error('send failed'));
        return Promise.resolve({});
      },
    );
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(() => <App />);
    await flush();
    const trigger = screen.getByLabelText(/Translation model:.*Click to change/);
    fireEvent.click(trigger);
    await flush();
    const chromeOption = screen.getByText('Chrome Built-in');
    fireEvent.click(chromeOption);
    await flush();
    // Should not crash
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------

describe('App bilingual mode toggle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('toggles bilingual mode on success', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ enabled: true });
    render(() => <App />);
    await flush();
    const toggle = screen.getByLabelText('Bilingual mode');
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(browserAPI.tabs.sendMessage).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ type: 'toggleBilingualMode' }),
      );
    });
  });

  it('handles no tab id for bilingual toggle', async () => {
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([{ url: 'https://x.com' }]);
    render(() => <App />);
    await flush();
    const toggle = screen.getByLabelText('Bilingual mode');
    fireEvent.click(toggle);
    await flush();
    // Should not crash
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles content script inject failure for bilingual toggle', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not loaded'));
    (browserAPI.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cannot inject'));
    render(() => <App />);
    await flush();
    const toggle = screen.getByLabelText('Bilingual mode');
    fireEvent.click(toggle);
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Cannot access');
    });
  });

  it('handles bilingual toggle error gracefully', async () => {
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('query failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(() => <App />);
    await flush();
    const toggle = screen.getByLabelText('Bilingual mode');
    fireEvent.click(toggle);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
    consoleSpy.mockRestore();
  });

  it('handles bilingual toggle with undefined response', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(() => <App />);
    await flush();
    const toggle = screen.getByLabelText('Bilingual mode');
    fireEvent.click(toggle);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('App handleTranslateSelection edge cases', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  it('handles inject failure on translate selection', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not loaded'));
    (browserAPI.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cannot inject'));
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate selected text'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Cannot access');
    });
  });

  it('handles structured error from content script on selection', async () => {
    // First call (ping) succeeds, second call returns structured error
    let callCount = 0;
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({}); // ping
      return Promise.resolve({ success: false, error: 'Selection translation error' });
    });
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate selected text'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });

  it('handles thrown error on translate selection', async () => {
    // ping succeeds, translate throws
    let callCount = 0;
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve({}); // ping
      return Promise.reject(new Error('Network failure'));
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate selected text'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    consoleSpy.mockRestore();
  });

  it('handles structured error without error field on page translate', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
    });
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });

  it('handles structured error without error field on selection translate', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false,
    });
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate selected text'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------

describe('App handleUndo edge cases', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  it('handles undo with no tab id', async () => {
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([{ url: 'https://x.com' }]);
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Undo translation'));
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles undo inject failure', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not loaded'));
    (browserAPI.scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cannot inject'));
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Undo translation'));
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles undo sendMessage error', async () => {
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('query failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Undo translation'));
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------

describe('App WebGPU + TranslateGemma auto-switch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('auto-switches from TranslateGemma when no hardware acceleration is available', async () => {
    vi.useFakeTimers();
    try {
      // Load with translategemma as saved provider
      (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
        provider: 'translategemma',
      });
      (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
        (msg: { type: string }) => {
          if (msg.type === 'checkWebGPU') return Promise.resolve({ supported: false });
          if (msg.type === 'checkWebNN') return Promise.resolve({ supported: false });
          return Promise.resolve({});
        },
      );
      render(() => <App />);
      // Advance enough for promises to settle but NOT past the 8000ms clearError timer
      await vi.advanceTimersByTimeAsync(500);
      await vi.waitFor(() => {
        const alert = screen.queryByRole('alert');
        expect(alert?.textContent).toContain('TranslateGemma requires WebGPU or WebNN');
      });
      // The setTimeout to clear error should fire after 8000ms
      await vi.advanceTimersByTimeAsync(8000);
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not auto-switch when WebNN is available without WebGPU', async () => {
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: 'translategemma',
    });
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (msg: { type: string }) => {
        if (msg.type === 'checkWebGPU') return Promise.resolve({ supported: false, fp16: false });
        if (msg.type === 'checkWebNN') return Promise.resolve({ supported: true });
        return Promise.resolve({});
      },
    );
    render(() => <App />);
    await flush();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('handles chrome translator available=false response', async () => {
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (msg: { type: string }) => {
        if (msg.type === 'checkChromeTranslator') return Promise.resolve({ available: false });
        return Promise.resolve({});
      },
    );
    render(() => <App />);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('App error action button handlers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('Open Settings action button opens options page', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('API key not configured'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Open Settings')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Open Settings'));
    await vi.waitFor(() => {
      expect(browserAPI.runtime.openOptionsPage).toHaveBeenCalled();
    });
  });

  it('Use OPUS-MT action switches to opus-mt provider', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('No network connection'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Use OPUS-MT')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Use OPUS-MT'));
    await vi.waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('Retry action retries translation', async () => {
    let callCount = 0;
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return Promise.reject(new Error('connection refused'));
      return Promise.resolve({});
    });
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Retry')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Retry'));
    await vi.waitFor(() => {
      expect(browserAPI.tabs.query).toHaveBeenCalledTimes(2);
    });
  });

  it('Retry action retries selection translation', async () => {
    let selectionAttempts = 0;
    const sendMessage = browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>;
    sendMessage.mockImplementation((_tabId: number, message: { type: string }) => {
      if (message.type === 'ping') return Promise.resolve({});
      if (message.type === 'translateSelection') {
        selectionAttempts++;
        if (selectionAttempts === 1) {
          return Promise.reject(new Error('connection refused'));
        }
      }
      return Promise.resolve({});
    });

    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate selected text'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Retry')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Retry'));
    await vi.waitFor(() => {
      const selectionCalls = sendMessage.mock.calls.filter(([, msg]) => msg?.type === 'translateSelection');
      expect(selectionCalls).toHaveLength(2);
    });
  });

  it('Switch Provider action switches to chrome-builtin', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('model loading failed'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Switch Provider')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Switch Provider'));
    await vi.waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('Retry action for timeout errors', async () => {
    let callCount = 0;
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return Promise.reject(new Error('Request timed out'));
      return Promise.resolve({});
    });
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Retry')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Retry'));
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('Retry action for rate limit errors', async () => {
    let callCount = 0;
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      if (callCount <= 2) return Promise.reject(new Error('Rate limit exceeded'));
      return Promise.resolve({});
    });
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('Retry')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Retry'));
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('App providerName computed', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('shows TranslateGemma 4B for translategemma provider', async () => {
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: 'translategemma',
    });
    // checkWebGPU must report supported so onMount doesn't auto-switch away
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (msg: { type: string }) => {
        if (msg.type === 'checkWebGPU') return Promise.resolve({ supported: true, fp16: true });
        return Promise.resolve({});
      },
    );
    render(() => <App />);
    await flush();
    await vi.waitFor(() => {
      expect(screen.getByText('TranslateGemma 4B')).toBeTruthy();
    });
  });

  it('shows Chrome Built-in for chrome-builtin provider', async () => {
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: 'chrome-builtin',
    });
    render(() => <App />);
    await flush();
    await vi.waitFor(() => {
      // ProviderStatus and ModelSelector both render "Chrome Built-in";
      // scope to the provider-status element
      const status = screen.getByRole('status');
      expect(within(status).getByText('Chrome Built-in')).toBeTruthy();
    });
  });

  it('shows DeepL for deepl provider', async () => {
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: 'deepl',
    });
    render(() => <App />);
    await flush();
    await vi.waitFor(() => {
      const status = screen.getByRole('status');
      expect(within(status).getByText('DeepL')).toBeTruthy();
    });
  });

  it('shows Helsinki-NLP OPUS-MT for default provider', async () => {
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    render(() => <App />);
    await flush();
    expect(screen.getByText('Helsinki-NLP OPUS-MT')).toBeTruthy();
  });

  it('falls back to OPUS-MT when stored provider is invalid', async () => {
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: 'invalid-provider',
    });
    render(() => <App />);
    await flush();
    expect(screen.getByText('Helsinki-NLP OPUS-MT')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('App update badge and cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('update badge click calls dismissUpdateNotice', async () => {
    (checkVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
      isUpdate: true,
      current: '3.0.0',
    });
    (isUpdateDismissed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    render(() => <App />);
    await flush();
    await vi.waitFor(() => {
      expect(screen.getByText('v3.0.0')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('v3.0.0'));
    expect(dismissUpdateNotice).toHaveBeenCalled();
  });

  it('registers and cleans up message listener', async () => {
    const { unmount } = render(() => <App />);
    await flush();
    expect(browserAPI.runtime.onMessage.addListener).toHaveBeenCalled();
    unmount();
    expect(browserAPI.runtime.onMessage.removeListener).toHaveBeenCalled();
  });

  it('handles empty error message in handleError', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error(''),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Translation failed');
    });
  });

  it('error banner auto-clears after timeout', async () => {
    vi.useFakeTimers();
    try {
      (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Some error'),
      );
      render(() => <App />);
      await vi.advanceTimersByTimeAsync(500);
      fireEvent.click(screen.getByLabelText('Translate entire page'));
      await vi.advanceTimersByTimeAsync(500);
      expect(screen.getByRole('alert')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(12000);
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads stored autoTranslate=false preference', async () => {
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      autoTranslate: false,
    });
    render(() => <App />);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles "fetch" in model-related error without triggering connection branch', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('model fetch failed'),
    );
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      // "model" keyword matches first, so this should be a model error, not connection error
      expect(screen.getByLabelText('Switch Provider')).toBeTruthy();
    });
  });

  it('ensureContentScript returns true when ping succeeds', async () => {
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    render(() => <App />);
    await flush();
    fireEvent.click(screen.getByLabelText('Translate entire page'));
    await vi.waitFor(() => {
      // ping succeeded, so no inject was needed
      expect(browserAPI.scripting.executeScript).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------

describe('App model error without providerId', () => {
  let capturedListener: ((msg: Record<string, unknown>) => void) | null = null;

  beforeEach(() => {
    vi.resetAllMocks();
    capturedListener = null;
    (browserAPI.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (msg: Record<string, unknown>) => void) => { capturedListener = cb; },
    );
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('handles error status when modelId does not match any provider', async () => {
    render(() => <App />);
    await flush();
    expect(capturedListener).toBeTruthy();

    // Send error with modelId that getProviderFromModelId can't match → providerId is null
    capturedListener!({
      type: 'modelProgress',
      status: 'error',
      modelId: 'unknown/model',
      error: 'Test error without provider',
    });

    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Model error: Test error without provider');
    });
  });
});

// ---------------------------------------------------------------------------

describe('App toggleAutoTranslate save failure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    // safeStorageSet returns undefined (falsy) to exercise the `if (saved)` false branch
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('toggleAutoTranslate handles storage set returning falsy gracefully', async () => {
    render(() => <App />);
    await flush();

    const toggle = screen.getByLabelText('Auto-translate pages');
    fireEvent.click(toggle);

    await vi.waitFor(() => {
      expect(safeStorageSet).toHaveBeenCalled();
    });

    // Should not crash even when save returns falsy
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Model progress handler with null providerId (uncovered paths)
// ---------------------------------------------------------------------------

describe('App model progress with null providerId', () => {
  let capturedListener: ((msg: Record<string, unknown>) => void) | null = null;

  beforeEach(() => {
    vi.resetAllMocks();
    capturedListener = null;
    (browserAPI.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (msg: Record<string, unknown>) => void) => { capturedListener = cb; },
    );
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageSet as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('handles download progress with unknown modelId (null providerId)', async () => {
    render(() => <App />);
    await flush();
    expect(capturedListener).toBeTruthy();

    capturedListener!({
      type: 'modelProgress',
      status: 'download',
      modelId: 'unknown/model-that-does-not-match',
      progress: 45,
      file: 'model.bin',
    });

    await vi.waitFor(() => {
      // Model progress should still be updated locally
      expect(screen.queryByText('TRANSLATE!')).toBeTruthy();
    });
  });

  it('handles done status with unknown modelId (null providerId)', async () => {
    render(() => <App />);
    await flush();
    expect(capturedListener).toBeTruthy();

    capturedListener!({
      type: 'modelProgress',
      status: 'done',
      modelId: 'unknown/model',
      progress: 100,
    });

    await vi.waitFor(() => {
      expect(screen.queryByText('TRANSLATE!')).toBeTruthy();
    });
  });

  it('handles ready status with unknown modelId (null providerId)', async () => {
    render(() => <App />);
    await flush();
    expect(capturedListener).toBeTruthy();

    capturedListener!({
      type: 'modelProgress',
      status: 'ready',
      modelId: 'unknown/model',
    });

    await vi.waitFor(() => {
      expect(screen.queryByText('TRANSLATE!')).toBeTruthy();
    });
  });

  it('handles error status with unknown modelId (null providerId)', async () => {
    render(() => <App />);
    await flush();
    expect(capturedListener).toBeTruthy();

    capturedListener!({
      type: 'modelProgress',
      status: 'error',
      modelId: 'unknown/model',
      error: 'Failed to initialize model',
    });

    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });

  it('handles initiate status with unknown modelId (null providerId)', async () => {
    render(() => <App />);
    await flush();
    expect(capturedListener).toBeTruthy();

    capturedListener!({
      type: 'modelProgress',
      status: 'initiate',
      modelId: 'unknown/model',
      file: 'model.zip',
    });

    await vi.waitFor(() => {
      expect(screen.queryByText('TRANSLATE!')).toBeTruthy();
    });
  });

  it('handles progress status with unknown modelId (null providerId)', async () => {
    render(() => <App />);
    await flush();
    expect(capturedListener).toBeTruthy();

    capturedListener!({
      type: 'modelProgress',
      status: 'progress',
      modelId: 'unknown/model',
      progress: 65,
    });

    await vi.waitFor(() => {
      expect(screen.queryByText('TRANSLATE!')).toBeTruthy();
    });
  });

  it('handles download status with null providerId', async () => {
    render(() => <App />);
    await flush();
    expect(capturedListener).toBeTruthy();

    capturedListener!({
      type: 'modelProgress',
      status: 'download',
      modelId: 'unknown/unknown-model',
      progress: 30,
    });

    // Should render without crashing
    expect(screen.queryByText('TRANSLATE!')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Snapshot tests
// ---------------------------------------------------------------------------

describe('App Snapshot', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

  it('renders default state correctly', async () => {
    const { container } = render(() => <App />);
    await flush();
    expect(container.innerHTML).toMatchSnapshot();
  });
});
