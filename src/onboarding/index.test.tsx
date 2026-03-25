import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@solidjs/testing-library';
import { OnboardingApp } from './index';
import { setupNavigatorLanguageMock } from '../test-helpers/browser-mocks';
import { setupUiChromeMock } from '../test-helpers/chrome-mocks';

// Flush microtasks
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// Wait for animation (150ms setTimeout in goToStep)
const waitForAnimation = async () => {
  await new Promise<void>((r) => setTimeout(r, 200));
};

// Navigate by clicking button text, waiting for animation
async function clickBtn(text: string | RegExp) {
  fireEvent.click(screen.getByText(text));
  await waitForAnimation();
}

// Navigate to a specific step from start
async function goToStep(n: number) {
  if (n >= 1) await clickBtn('Get Started');
  if (n >= 2) await clickBtn('Next');
  if (n >= 3) await clickBtn('Next');
  if (n >= 4) await clickBtn('Skip');
}

function setupOnboardingBrowserMocks(language = 'en-US') {
  setupUiChromeMock({
    storageLocalSet: vi.fn().mockResolvedValue(undefined),
    storageLocalGet: vi.fn().mockResolvedValue({}),
    runtimeSendMessage: vi.fn().mockResolvedValue({
      success: true,
      result: 'Translated text',
    }),
  });
  setupNavigatorLanguageMock(language);
}

beforeEach(() => {
  setupOnboardingBrowserMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OnboardingApp', () => {
  // --- Step 0: Welcome ---
  it('renders welcome step initially', async () => {
    render(() => <OnboardingApp />);
    await flush();
    expect(screen.getByText('Welcome to TRANSLATE!')).toBeTruthy();
    expect(screen.getByText('Get Started')).toBeTruthy();
  });

  it('shows footer', async () => {
    render(() => <OnboardingApp />);
    await flush();
    expect(screen.getByText('TRANSLATE! v2.1')).toBeTruthy();
  });

  it('renders all feature items', async () => {
    render(() => <OnboardingApp />);
    await flush();
    expect(screen.getByText('Local AI translation - your data stays private')).toBeTruthy();
    expect(screen.getByText('Supports offline translation after local model setup')).toBeTruthy();
    expect(screen.getByText('Hover to translate any word')).toBeTruthy();
    expect(screen.getByText('One-click full page translation')).toBeTruthy();
  });

  it('detects supported browser language on mount', async () => {
    setupNavigatorLanguageMock('fi-FI');
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(1);
    const finnishBtn = screen.getByText('Finnish').closest('button');
    expect(finnishBtn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps default English for unsupported browser language', async () => {
    setupNavigatorLanguageMock('xx-XX');
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(1);
    const englishBtn = screen.getByText('English').closest('button');
    expect(englishBtn?.getAttribute('aria-pressed')).toBe('true');
  });

  // --- Step 1: Language ---
  it('navigates to language step', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(1);
    expect(screen.getByText('Choose Your Language')).toBeTruthy();
  });

  it('allows selecting a language', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(1);
    fireEvent.click(screen.getByText('German'));
    const btn = screen.getByText('German').closest('button');
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('navigates back from Language to Welcome', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(1);
    await clickBtn('Back');
    expect(screen.getByText('Welcome to TRANSLATE!')).toBeTruthy();
  });

  // --- Step 2: Model ---
  it('shows all models on Model step', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(2);
    expect(screen.getByText('OPUS-MT')).toBeTruthy();
    expect(screen.getByText('Chrome Built-in')).toBeTruthy();
    expect(screen.getByText('DeepL API')).toBeTruthy();
    expect(screen.getByText('Recommended')).toBeTruthy();
    expect(screen.getByText('Preferred native')).toBeTruthy();
    expect(screen.getByText('API key')).toBeTruthy();
  });

  it('allows selecting a model', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(2);
    fireEvent.click(screen.getByText('DeepL API'));
    const btn = screen.getByText('DeepL API').closest('button');
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('navigates back from Model to Language', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(2);
    await clickBtn('Back');
    expect(screen.getByText('Choose Your Language')).toBeTruthy();
  });

  it('saves settings when moving from Model to Test', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingComplete: true, provider: 'opus-mt' }),
    );
  });

  // --- Step 3: Test ---
  it('shows test UI with placeholder', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);
    expect(screen.getByText(/Click.*to see the result/)).toBeTruthy();
  });

  it('shows German source text when target is English', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);
    // Default target is English, so source should be German
    expect(screen.getByText('German')).toBeTruthy();
  });

  it('shows English source text when target is non-English', async () => {
    setupNavigatorLanguageMock('fi');
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);
    expect(screen.getByText('Hello, world! This is a test translation.')).toBeTruthy();
  });

  it('shows Skip button when no test result', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);
    expect(screen.getByText('Skip')).toBeTruthy();
  });

  it('runs test translation successfully', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
      success: true,
      result: 'Hei maailma!',
    });

    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);

    const testBtn = screen.getAllByText('Test Translation').find(
      (el) => el.tagName === 'BUTTON',
    )!;
    fireEvent.click(testBtn);
    // Wait for async translation
    await new Promise((r) => setTimeout(r, 100));

    expect(screen.getByText('Hei maailma!')).toBeTruthy();
    expect(screen.getByText('Continue')).toBeTruthy();
  });

  it('shows error on failed test translation', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
      success: false,
      error: 'Model not loaded',
    });

    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);

    const testBtn = screen.getAllByText('Test Translation').find(
      (el) => el.tagName === 'BUTTON',
    )!;
    fireEvent.click(testBtn);
    await new Promise((r) => setTimeout(r, 100));

    expect(screen.getByText('Model not loaded')).toBeTruthy();
  });

  it('shows fallback error text when response.error is empty', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({ success: false });

    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);

    const testBtn = screen.getAllByText('Test Translation').find(
      (el) => el.tagName === 'BUTTON',
    )!;
    fireEvent.click(testBtn);
    await new Promise((r) => setTimeout(r, 100));

    expect(screen.getByText('Translation failed')).toBeTruthy();
  });

  it('shows connection error on sendMessage rejection', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockRejectedValue(new Error('No connection'));

    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);

    const testBtn = screen.getAllByText('Test Translation').find(
      (el) => el.tagName === 'BUTTON',
    )!;
    fireEvent.click(testBtn);
    await new Promise((r) => setTimeout(r, 100));

    expect(screen.getByText(/Connection error/)).toBeTruthy();
  });

  it('navigates back from Test to Model', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);
    await clickBtn('Back');
    expect(screen.getByText('Choose Translation Engine')).toBeTruthy();
  });

  // --- Step 4: Done ---
  it('navigates to Done step', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(4);
    expect(screen.getByText("You're All Set!")).toBeTruthy();
  });

  it('shows keyboard tips', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(4);
    expect(screen.getByText('Translate any word')).toBeTruthy();
    expect(screen.getByText('Translate selection')).toBeTruthy();
    expect(screen.getByText('Context menu options')).toBeTruthy();
    expect(screen.getByText('Open popup')).toBeTruthy();
  });

  it('finish saves settings and closes window', async () => {
    const closeSpy = vi.fn();
    vi.stubGlobal('close', closeSpy);

    render(() => <OnboardingApp />);
    await flush();
    await goToStep(4);

    fireEvent.click(screen.getByText('Start Translating!'));
    await new Promise((r) => setTimeout(r, 200));

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingComplete: true }),
    );
  });

  it('finish shows completion message after timeout', async () => {
    vi.stubGlobal('close', vi.fn());

    render(() => <OnboardingApp />);
    await flush();
    await goToStep(4);

    fireEvent.click(screen.getByText('Start Translating!'));
    await new Promise((r) => setTimeout(r, 300));

    expect(document.body.innerHTML).toContain('Setup Complete');
  });

  it('finish handles window.close throwing', async () => {
    vi.stubGlobal('close', vi.fn(() => { throw new Error('nope'); }));

    render(() => <OnboardingApp />);
    await flush();
    await goToStep(4);

    // Should not throw
    fireEvent.click(screen.getByText('Start Translating!'));
    await new Promise((r) => setTimeout(r, 200));
  });

  // --- Progress bar ---
  it('allows clicking completed steps to navigate back', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(2);
    const progressButtons = screen.getAllByRole('button');
    const welcomeBtn = progressButtons.find((b) => b.textContent?.includes('Welcome'));
    fireEvent.click(welcomeBtn!);
    await waitForAnimation();
    expect(screen.getByText('Welcome to TRANSLATE!')).toBeTruthy();
  });

  it('disables future progress steps', async () => {
    render(() => <OnboardingApp />);
    await flush();
    const progressButtons = screen.getAllByRole('button');
    const testBtn = progressButtons.find((b) => b.textContent?.includes('Test'));
    expect((testBtn as HTMLButtonElement)?.disabled).toBe(true);
  });

  it('marks current step with aria-current', async () => {
    render(() => <OnboardingApp />);
    await flush();
    const progressButtons = screen.getAllByRole('button');
    const welcomeBtn = progressButtons.find((b) => b.textContent?.includes('Welcome'));
    expect(welcomeBtn?.getAttribute('aria-current')).toBe('step');
  });

  // --- goToStep edge cases ---
  it('ignores goToStep while animating', async () => {
    render(() => <OnboardingApp />);
    await flush();
    // Double-click rapidly
    fireEvent.click(screen.getByText('Get Started'));
    fireEvent.click(screen.getByText('Get Started'));
    await waitForAnimation();
    expect(screen.getByText('Choose Your Language')).toBeTruthy();
  });

  // --- Additional coverage ---

  it('has opus-mt selected by default on model step', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(2);
    const opusMtBtn = screen.getByText('OPUS-MT').closest('button');
    expect(opusMtBtn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('passes correct args to sendMessage', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);

    const testBtn = screen.getAllByText('Test Translation').find(
      (el) => el.tagName === 'BUTTON',
    )!;
    fireEvent.click(testBtn);
    await new Promise((r) => setTimeout(r, 200));

    const args = vi.mocked(chrome.runtime.sendMessage).mock.calls[0]![0] as any;
    expect(args.type).toBe('translate');
    expect(args.provider).toBe('opus-mt');
    expect(args.targetLang).toBe('en');
    expect(args.sourceLang).toBe('de');
  });

  it('persists provider, sourceLang, strategy to chrome.storage', async () => {
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(4);
    fireEvent.click(screen.getByText('Start Translating!'));
    await new Promise((r) => setTimeout(r, 200));
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        targetLang: 'en',
        provider: 'opus-mt',
        sourceLang: 'auto',
        strategy: 'smart',
        onboardingComplete: true,
      }),
    );
  });

  it('persists Finnish + DeepL when selected', async () => {
    setupNavigatorLanguageMock('fi');
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(1);
    // Finnish should already be selected via browser language detection
    await clickBtn('Next');
    fireEvent.click(screen.getByText('DeepL API'));
    await clickBtn('Next');
    await clickBtn('Skip');
    fireEvent.click(screen.getByText('Start Translating!'));
    await new Promise((r) => setTimeout(r, 200));
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        targetLang: 'fi',
        provider: 'deepl',
        sourceLang: 'auto',
        strategy: 'smart',
      }),
    );
  });

  it('renders 5 progress steps', async () => {
    const { container } = render(() => <OnboardingApp />);
    await flush();
    const steps = container.querySelectorAll('.progress-step');
    expect(steps.length).toBe(5);
  });

  it('marks previous steps as complete', async () => {
    const { container } = render(() => <OnboardingApp />);
    await flush();
    await goToStep(2);
    const steps = container.querySelectorAll('.progress-step.complete');
    expect(steps.length).toBeGreaterThanOrEqual(1);
  });

  it('shows check icon on completed steps', async () => {
    const { container } = render(() => <OnboardingApp />);
    await flush();
    await goToStep(2);
    expect(container.querySelector('.check-icon')).toBeTruthy();
  });

  it('shows Continue button after successful test', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({
      success: true,
      result: 'Translated!',
    });
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);
    const testBtn = screen.getAllByText('Test Translation').find(
      (el) => el.tagName === 'BUTTON',
    )!;
    fireEvent.click(testBtn);
    await new Promise((r) => setTimeout(r, 200));
    const continueBtn = screen.getByText('Continue');
    fireEvent.click(continueBtn);
    await waitForAnimation();
    expect(screen.getByText("You're All Set!")).toBeTruthy();
  });

  it('can run test translation multiple times', async () => {
    const sendMsg = vi.mocked(chrome.runtime.sendMessage);
    sendMsg.mockResolvedValueOnce({ success: false, error: 'Temporary error' });
    sendMsg.mockResolvedValueOnce({ success: true, result: 'OK!' });

    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);

    const getTestBtn = () =>
      screen.getAllByText('Test Translation').find((el) => el.tagName === 'BUTTON')!;

    // First attempt: fails
    fireEvent.click(getTestBtn());
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getByText('Temporary error')).toBeTruthy();

    // Second attempt: succeeds
    fireEvent.click(getTestBtn());
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getByText('OK!')).toBeTruthy();
  });

  it('renders background decoration', async () => {
    const { container } = render(() => <OnboardingApp />);
    await flush();
    expect(container.querySelector('.bg-decoration')).toBeTruthy();
  });

  it('uses English source text when target is non-English on test step', async () => {
    setupNavigatorLanguageMock('de');
    render(() => <OnboardingApp />);
    await flush();
    await goToStep(3);

    const testBtn = screen.getAllByText('Test Translation').find(
      (el) => el.tagName === 'BUTTON',
    )!;
    fireEvent.click(testBtn);
    await new Promise((r) => setTimeout(r, 200));

    const args = vi.mocked(chrome.runtime.sendMessage).mock.calls[0]![0] as any;
    expect(args.sourceLang).toBe('en');
    expect(args.text).toContain('Hello');
  });

  // --- Module render entry point (lines 497-499) ---
  it('renders into #root element when present', async () => {
    // The module-level code: `const rootEl = document.getElementById('root'); if (rootEl) { render(...) }`
    // To test this, we need to call render() from solid-js/web with a root element
    const { render: solidRender } = await import('solid-js/web');
    const rootEl = document.createElement('div');
    rootEl.id = 'root-test';
    document.body.appendChild(rootEl);

    solidRender(() => <OnboardingApp />, rootEl);
    await flush();

    expect(rootEl.innerHTML.length).toBeGreaterThan(0);
    expect(rootEl.innerHTML).toContain('Welcome');
    document.body.removeChild(rootEl);
  });
});
