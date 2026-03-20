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
import { safeStorageGet } from '../core/storage';

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
