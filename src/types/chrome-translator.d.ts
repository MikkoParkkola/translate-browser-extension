/**
 * Chrome Built-in Translator API (Chrome 138+)
 *
 * Chrome injects `Translator` on the global scope in the page's main world.
 * The extension accesses it via chrome.scripting.executeScript with world: 'MAIN'.
 */

interface ChromeTranslatorAvailability {
  available: 'no' | 'readily' | 'after-download';
}

interface ChromeTranslatorInstance {
  translate(text: string): Promise<string>;
  destroy(): void;
}

interface ChromeTranslatorAPI {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<ChromeTranslatorAvailability>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<ChromeTranslatorInstance>;
}

declare global {
  // eslint-disable-next-line no-var
  var Translator: ChromeTranslatorAPI | undefined;
}

export {};
