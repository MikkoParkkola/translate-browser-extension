import { Component, For } from 'solid-js';
import { POPUP_SOURCE_LANGUAGES, POPUP_TARGET_LANGUAGES } from '../../shared/translation-options';

interface Props {
  sourceLang: string;
  targetLang: string;
  onSourceChange: (lang: string) => void;
  onTargetChange: (lang: string) => void;
  onSwap: () => void;
}

export const LanguageSelector: Component<Props> = (props) => {
  return (
    <section class="language-section" aria-label="Language selection">
      <div class="language-inputs">
        <div class="language-group">
          <div class="select-wrapper">
            <select
              class="language-select"
              value={props.sourceLang}
              onChange={(e) => props.onSourceChange(e.target.value)}
              aria-label="Source language"
            >
              <For each={POPUP_SOURCE_LANGUAGES}>
                {(lang) => (
                  <option value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                )}
              </For>
            </select>
            <svg class="select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
        </div>

        <button class="swap-button" onClick={props.onSwap} aria-label="Swap languages">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M17 17H7l4 4m-4-14h10l-4-4"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>

        <div class="language-group">
          <div class="select-wrapper">
            <select
              class="language-select"
              value={props.targetLang}
              onChange={(e) => props.onTargetChange(e.target.value)}
              aria-label="Target language"
            >
              <For each={POPUP_TARGET_LANGUAGES}>
                {(lang) => (
                  <option value={lang.code}>
                    {lang.flag} {lang.name}
                  </option>
                )}
              </For>
            </select>
            <svg class="select-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
/* v8 ignore start */
};
/* v8 ignore stop */
