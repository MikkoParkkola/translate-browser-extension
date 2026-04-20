/**
 * Chrome Built-in Translation — orchestration seam
 *
 * Encapsulates tab-lookup, result-validation, and array-normalisation that
 * surround a `chrome.scripting.executeScript` main-world call.  The actual
 * `executeScript` invocation (which contains an inline `func` serialised into
 * the tab's MAIN world by Chrome) is kept in the service-worker entry module
 * and injected here as a dependency so this logic is unit-testable without a
 * real Chrome scripting API.
 */

export interface ChromeBuiltinTranslationDeps {
  /**
   * Returns the id of the currently active tab, or `undefined` when none
   * exists (e.g. in a headless / extension popup context).
   */
  getActiveTabId: () => Promise<number | undefined>;

  /**
   * Executes the Chrome Translator API inside the tab's MAIN world and returns
   * the translated strings, or `undefined` if the injection returned no result.
   *
   * Responsibility for calling `chrome.scripting.executeScript` (including any
   * v8 ignore fences around the inline serialised `func`) belongs to
   * the caller, not this module.
   */
  executeTranslationScript: (
    tabId: number,
    texts: string[],
    sourceLang: string,
    targetLang: string
  ) => Promise<string[] | undefined>;
}

/**
 * Creates a `runChromeBuiltinTranslation` function whose surrounding
 * orchestration (active-tab lookup, array normalisation, result validation) is
 * fully injectable and therefore unit-testable.
 *
 * @example
 * ```ts
 * const run = createChromeBuiltinTranslationRunner({
 *   getActiveTabId: ...,
 *   executeTranslationScript: ...,
 * });
 * const result = await run('Hello', 'en', 'fi');
 * ```
 */
export function createChromeBuiltinTranslationRunner({
  getActiveTabId,
  executeTranslationScript,
}: ChromeBuiltinTranslationDeps): (
  text: string | string[],
  sourceLang: string,
  targetLang: string
) => Promise<string | string[]> {
  return async function runChromeBuiltinTranslation(
    text: string | string[],
    sourceLang: string,
    targetLang: string
  ): Promise<string | string[]> {
    const tabId = await getActiveTabId();
    if (!tabId) {
      throw new Error('No active tab for Chrome Translator');
    }

    const texts = Array.isArray(text) ? text : [text];
    const translated = await executeTranslationScript(tabId, texts, sourceLang, targetLang);

    if (!translated) {
      throw new Error('Chrome Translator returned no result');
    }

    if (translated.length !== texts.length) {
      throw new Error(
        `Chrome Translator returned ${translated.length} result(s) for ${texts.length} input text(s)`
      );
    }

    if (!Array.isArray(text)) {
      const single = translated[0];
      if (single === undefined) {
        throw new Error('Chrome Translator returned an empty result array');
      }
      return single;
    }

    return translated;
  };
}
