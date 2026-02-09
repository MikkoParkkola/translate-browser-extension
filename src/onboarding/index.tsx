import { render } from 'solid-js/web';
import { createSignal, Show, For, onMount } from 'solid-js';
import './styles.css';

const LANGUAGES = [
  { code: 'en', name: 'English', flag: 'GB' },
  { code: 'fi', name: 'Finnish', flag: 'FI' },
  { code: 'sv', name: 'Swedish', flag: 'SE' },
  { code: 'de', name: 'German', flag: 'DE' },
  { code: 'fr', name: 'French', flag: 'FR' },
  { code: 'es', name: 'Spanish', flag: 'ES' },
  { code: 'nl', name: 'Dutch', flag: 'NL' },
  { code: 'it', name: 'Italian', flag: 'IT' },
  { code: 'pt', name: 'Portuguese', flag: 'PT' },
  { code: 'pl', name: 'Polish', flag: 'PL' },
  { code: 'ru', name: 'Russian', flag: 'RU' },
  { code: 'ja', name: 'Japanese', flag: 'JP' },
  { code: 'zh', name: 'Chinese', flag: 'CN' },
  { code: 'ko', name: 'Korean', flag: 'KR' },
  { code: 'ar', name: 'Arabic', flag: 'SA' },
  { code: 'hi', name: 'Hindi', flag: 'IN' },
  { code: 'tr', name: 'Turkish', flag: 'TR' },
  { code: 'uk', name: 'Ukrainian', flag: 'UA' },
];

const MODELS = [
  {
    id: 'opus-mt',
    name: 'OPUS-MT',
    desc: 'Fast local translation',
    size: '~170MB per language pair',
    speed: 'Fast',
    quality: 'Good',
    recommended: true
  },
  {
    id: 'chrome-builtin',
    name: 'Chrome Built-in',
    desc: "Uses Chrome's translation API",
    size: 'No download',
    speed: 'Instant',
    quality: 'Good',
    recommended: false
  },
  {
    id: 'deepl',
    name: 'DeepL API',
    desc: 'Highest quality (requires API key)',
    size: 'Cloud-based',
    speed: 'Fast',
    quality: 'Excellent',
    recommended: false
  },
];

interface Step {
  title: string;
  icon: string;
}

function OnboardingApp() {
  const [step, setStep] = createSignal(0);
  const [targetLang, setTargetLang] = createSignal('en');
  const [model, setModel] = createSignal('opus-mt');
  const [testResult, setTestResult] = createSignal<string | null>(null);
  const [testing, setTesting] = createSignal(false);
  const [testError, setTestError] = createSignal<string | null>(null);
  const [animating, setAnimating] = createSignal(false);

  const steps: Step[] = [
    { title: 'Welcome', icon: 'W' },
    { title: 'Language', icon: 'L' },
    { title: 'Model', icon: 'M' },
    { title: 'Test', icon: 'T' },
    { title: 'Done', icon: 'D' },
  ];

  // Detect browser language on mount
  onMount(() => {
    const browserLang = navigator.language.split('-')[0];
    const supported = LANGUAGES.find(l => l.code === browserLang);
    if (supported) {
      setTargetLang(browserLang);
    }
  });

  const goToStep = (newStep: number) => {
    if (newStep === step() || animating()) return;
    setAnimating(true);
    setTimeout(() => {
      setStep(newStep);
      setAnimating(false);
    }, 150);
  };

  const saveSettings = async () => {
    await chrome.storage.local.set({
      targetLang: targetLang(),
      provider: model(),
      sourceLang: 'auto',
      strategy: 'smart',
      onboardingComplete: true,
    });
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);

    try {
      // First save settings so the background knows which provider to use
      await saveSettings();

      // If target is English, translate FROM German to English
      // Otherwise translate FROM English to target language
      const isEnglishTarget = targetLang() === 'en';
      const testText = isEnglishTarget
        ? 'Hallo Welt! Dies ist eine Testbersetzung.'
        : 'Hello, world! This is a test translation.';
      const sourceLang = isEnglishTarget ? 'de' : 'en';

      const response = await chrome.runtime.sendMessage({
        type: 'translate',
        text: testText,
        sourceLang: sourceLang,
        targetLang: targetLang(),
        provider: model(),
      });

      if (response.success) {
        setTestResult(response.result as string);
      } else {
        setTestError(response.error || 'Translation failed');
      }
    } catch (e) {
      setTestError(`Connection error: ${e}`);
    }

    setTesting(false);
  };

  const finish = async () => {
    await saveSettings();
    // Try to close the tab (only works if opened by script)
    // If that fails, show a completion message
    try {
      window.close();
      // If window.close() didn't work, we'll still be here after a brief delay
      setTimeout(() => {
        // Redirect to a simple "setup complete" indication
        document.body.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui;background:#0f172a;color:#f1f5f9;">
            <div style="font-size:48px;margin-bottom:16px;">✓</div>
            <h1 style="margin:0 0 8px 0;">Setup Complete!</h1>
            <p style="color:#94a3b8;margin:0;">You can close this tab and start translating.</p>
          </div>
        `;
      }, 100);
    } catch {
      // Silently handle any errors
    }
  };

  const getLanguageName = (code: string) => {
    return LANGUAGES.find(l => l.code === code)?.name || code;
  };

  return (
    <div class="onboarding">
      {/* Background decoration */}
      <div class="bg-decoration">
        <div class="bg-circle bg-circle-1" />
        <div class="bg-circle bg-circle-2" />
        <div class="bg-circle bg-circle-3" />
      </div>

      {/* Progress bar */}
      <nav class="progress" aria-label="Onboarding progress">
        <For each={steps}>
          {(s, i) => (
            <button
              class={`progress-step ${i() <= step() ? 'active' : ''} ${i() < step() ? 'complete' : ''}`}
              onClick={() => i() < step() && goToStep(i())}
              disabled={i() > step()}
              aria-current={i() === step() ? 'step' : undefined}
            >
              <span class="step-indicator">
                <Show when={i() < step()} fallback={<span class="step-number">{i() + 1}</span>}>
                  <svg class="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </Show>
              </span>
              <span class="step-title">{s.title}</span>
            </button>
          )}
        </For>
      </nav>

      {/* Step content */}
      <main class={`content ${animating() ? 'animating' : ''}`}>
        <Show when={step() === 0}>
          <div class="step-content welcome">
            <div class="logo-container">
              <div class="logo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
            </div>
            <h1>Welcome to TRANSLATE!</h1>
            <p class="subtitle">The privacy-first translation extension that works offline.</p>

            <ul class="features">
              <li>
                <span class="feature-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </span>
                <span>Local AI translation - your data stays private</span>
              </li>
              <li>
                <span class="feature-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
                  </svg>
                </span>
                <span>Works offline after initial setup</span>
              </li>
              <li>
                <span class="feature-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </span>
                <span>Hover to translate any word</span>
              </li>
              <li>
                <span class="feature-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18M9 21V9" />
                  </svg>
                </span>
                <span>One-click full page translation</span>
              </li>
            </ul>

            <button class="btn primary large" onClick={() => goToStep(1)}>
              Get Started
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </Show>

        <Show when={step() === 1}>
          <div class="step-content">
            <h2>Choose Your Language</h2>
            <p class="subtitle">What language do you want to translate TO?</p>

            <div class="language-grid">
              <For each={LANGUAGES}>
                {(lang) => (
                  <button
                    class={`lang-btn ${targetLang() === lang.code ? 'selected' : ''}`}
                    onClick={() => setTargetLang(lang.code)}
                    aria-pressed={targetLang() === lang.code}
                  >
                    <span class="lang-name">{lang.name}</span>
                    <span class="lang-code">{lang.code.toUpperCase()}</span>
                  </button>
                )}
              </For>
            </div>

            <div class="nav-buttons">
              <button class="btn secondary" onClick={() => goToStep(0)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <button class="btn primary" onClick={() => goToStep(2)}>
                Next
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </Show>

        <Show when={step() === 2}>
          <div class="step-content">
            <h2>Choose Translation Engine</h2>
            <p class="subtitle">Select how you want to translate text</p>

            <div class="model-list">
              <For each={MODELS}>
                {(m) => (
                  <button
                    class={`model-btn ${model() === m.id ? 'selected' : ''}`}
                    onClick={() => setModel(m.id)}
                    aria-pressed={model() === m.id}
                  >
                    <div class="model-header">
                      <span class="model-name">{m.name}</span>
                      <Show when={m.recommended}>
                        <span class="badge">Recommended</span>
                      </Show>
                    </div>
                    <div class="model-desc">{m.desc}</div>
                    <div class="model-specs">
                      <span class="spec">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        </svg>
                        {m.size}
                      </span>
                      <span class="spec">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        {m.speed}
                      </span>
                      <span class="spec">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                        {m.quality}
                      </span>
                    </div>
                  </button>
                )}
              </For>
            </div>

            <div class="nav-buttons">
              <button class="btn secondary" onClick={() => goToStep(1)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <button class="btn primary" onClick={() => { saveSettings(); goToStep(3); }}>
                Next
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </Show>

        <Show when={step() === 3}>
          <div class="step-content">
            <h2>Test Translation</h2>
            <p class="subtitle">Let's make sure everything works!</p>

            <div class="test-area">
              <div class="test-card source">
                <div class="test-label">{targetLang() === 'en' ? 'German' : 'English'}</div>
                <div class="test-text">
                  {targetLang() === 'en'
                    ? 'Hallo Welt! Dies ist ein Übersetzungstest.'
                    : 'Hello, world! This is a test translation.'}
                </div>
              </div>

              <div class="test-arrow">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
              </div>

              <div class="test-card result">
                <div class="test-label">{getLanguageName(targetLang())}</div>
                <div class="test-text">
                  <Show when={testing()}>
                    <span class="loading">
                      <span class="loading-dot" />
                      <span class="loading-dot" />
                      <span class="loading-dot" />
                    </span>
                  </Show>
                  <Show when={testResult() && !testing()}>
                    <span class="success-text">{testResult()}</span>
                  </Show>
                  <Show when={testError() && !testing()}>
                    <span class="error-text">{testError()}</span>
                  </Show>
                  <Show when={!testResult() && !testError() && !testing()}>
                    <span class="placeholder">Click "Test Translation" to see the result</span>
                  </Show>
                </div>
              </div>
            </div>

            <div class="nav-buttons">
              <button class="btn secondary" onClick={() => goToStep(2)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <button class="btn primary" onClick={runTest} disabled={testing()}>
                {testing() ? 'Translating...' : 'Test Translation'}
              </button>
              <button class="btn primary" onClick={() => goToStep(4)}>
                {testResult() ? 'Continue' : 'Skip'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </Show>

        <Show when={step() === 4}>
          <div class="step-content done">
            <div class="success-animation">
              <div class="success-circle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>

            <h2>You're All Set!</h2>
            <p class="subtitle">Here's how to use TRANSLATE!:</p>

            <div class="tips">
              <div class="tip">
                <div class="tip-keys">
                  <kbd>Alt</kbd>
                  <span class="tip-plus">+</span>
                  <span class="tip-action">Hover</span>
                </div>
                <span class="tip-desc">Translate any word</span>
              </div>

              <div class="tip">
                <div class="tip-keys">
                  <kbd>Cmd</kbd>
                  <span class="tip-plus">+</span>
                  <kbd>Shift</kbd>
                  <span class="tip-plus">+</span>
                  <kbd>T</kbd>
                </div>
                <span class="tip-desc">Translate selection</span>
              </div>

              <div class="tip">
                <div class="tip-keys">
                  <span class="tip-action">Right-click</span>
                </div>
                <span class="tip-desc">Context menu options</span>
              </div>

              <div class="tip">
                <div class="tip-keys">
                  <kbd>Alt</kbd>
                  <span class="tip-plus">+</span>
                  <kbd>T</kbd>
                </div>
                <span class="tip-desc">Open popup</span>
              </div>
            </div>

            <button class="btn primary large" onClick={finish}>
              Start Translating!
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </Show>
      </main>

      {/* Footer */}
      <footer class="footer">
        <span>TRANSLATE! v2.1</span>
        <span class="separator">|</span>
        <span>Privacy-first translation</span>
      </footer>
    </div>
  );
}

render(() => <OnboardingApp />, document.getElementById('root')!);
