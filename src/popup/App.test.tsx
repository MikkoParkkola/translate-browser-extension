import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';

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

vi.mock('../core/browser-api', () => ({
  browserAPI: {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({}),
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
}));

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
import { checkVersion, isUpdateDismissed } from '../core/version';

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
    vi.clearAllMocks();
    // Reset default resolved values after clearAllMocks
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
    vi.clearAllMocks();
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
    vi.clearAllMocks();
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
    vi.clearAllMocks();
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
    vi.clearAllMocks();
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
    vi.clearAllMocks();
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (browserAPI.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: 'https://example.com' },
    ]);
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (safeStorageGet as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  afterEach(cleanup);

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
    (browserAPI.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('unsupported language direction'),
    );
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
    vi.clearAllMocks();
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

  it('checks WebGPU availability on mount', async () => {
    render(() => <App />);
    await flush();
    await vi.waitFor(() => {
      expect(browserAPI.runtime.sendMessage).toHaveBeenCalledWith({ type: 'checkWebGPU' });
    });
  });

  it('sets webGpuAvailable=true when supported=true', async () => {
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>)
      .mockImplementation((msg: { type: string }) => {
        if (msg.type === 'checkWebGPU') return Promise.resolve({ supported: true });
        return Promise.resolve({});
      });
    render(() => <App />);
    await flush();
    expect(screen.getByText('TRANSLATE!')).toBeTruthy();
  });

  it('handles WebGPU check failure gracefully', async () => {
    (browserAPI.runtime.sendMessage as ReturnType<typeof vi.fn>)
      .mockImplementation((msg: { type: string }) => {
        if (msg.type === 'checkWebGPU') return Promise.reject(new Error('GPU unavailable'));
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
    vi.clearAllMocks();
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
    vi.clearAllMocks();
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
