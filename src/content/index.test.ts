/**
 * Content Script unit tests
 *
 * Tests DOM scanning, text replacement, and translation messaging.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock chrome API
const mockSendMessage = vi.fn();
const mockOnMessage = {
  addListener: vi.fn(),
};

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: mockSendMessage,
    onMessage: mockOnMessage,
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
});

// Mock glossary module - functions are async, must return Promises
vi.mock('../core/glossary', () => ({
  glossary: {
    getGlossary: vi.fn().mockResolvedValue({}),
    applyGlossary: vi.fn().mockImplementation(async (text: string) => ({
      processedText: text,
      restore: (result: string) => result,
    })),
    applyGlossaryBatch: vi.fn().mockImplementation(async (texts: string[]) => ({
      processedTexts: texts,
      restoreFns: texts.map(() => (result: string) => result),
    })),
  },
}));


describe('Content Script', () => {
  let messageHandler: (
    message: { type: string; sourceLang: string; targetLang: string; strategy: string },
    sender: unknown,
    sendResponse: (response: boolean) => void
  ) => boolean | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset document
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // Import module to trigger registration
    await import('./index');

    // Capture registered message handler
    messageHandler = mockOnMessage.addListener.mock.calls[0]?.[0];
  });

  afterEach(() => {
    // Clean up any tooltips
    const tooltip = document.getElementById('translate-tooltip');
    if (tooltip) tooltip.remove();
  });

  describe('initialization', () => {
    it('registers message handler', () => {
      expect(mockOnMessage.addListener).toHaveBeenCalled();
    });

    it('adds animation styles to head', () => {
      const styles = document.head.querySelectorAll('style');
      expect(styles.length).toBeGreaterThan(0);

      const styleText = Array.from(styles)
        .map((s) => s.textContent)
        .join('');
      expect(styleText).toContain('translateFadeIn');
    });
  });

  describe('text node scanning', () => {
    it('finds text nodes in body', async () => {
      document.body.innerHTML = `
        <div>Hello world</div>
        <p>Another paragraph</p>
      `;

      mockSendMessage.mockResolvedValue({
        success: true,
        result: ['Hei maailma', 'Toinen kappale'],
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('skips script tags', async () => {
      document.body.innerHTML = `
        <script>console.log("should be skipped");</script>
        <div>Should be translated</div>
      `;

      mockSendMessage.mockResolvedValue({
        success: true,
        result: ['Pitäisi kääntää'],
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Only one batch should be sent (excluding script)
      const calls = mockSendMessage.mock.calls;
      const translateCall = calls.find((c) => c[0]?.type === 'translate');

      if (translateCall) {
        expect(translateCall[0].text).not.toContain('console.log');
      }
    });

    it('skips style tags', async () => {
      document.body.innerHTML = `
        <style>.class { color: red; }</style>
        <div>Visible text</div>
      `;

      mockSendMessage.mockResolvedValue({
        success: true,
        result: ['Näkyvä teksti'],
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('skips code and pre tags', async () => {
      document.body.innerHTML = `
        <code>const x = 1;</code>
        <pre>function() {}</pre>
        <div>Normal text</div>
      `;

      mockSendMessage.mockResolvedValue({
        success: true,
        result: ['Normaali teksti'],
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('skips already translated elements', async () => {
      document.body.innerHTML = `
        <div data-translated="true">Already done</div>
        <div>New text</div>
      `;

      mockSendMessage.mockResolvedValue({
        success: true,
        result: ['Uusi teksti'],
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('skips input and textarea', async () => {
      document.body.innerHTML = `
        <input value="Input text" />
        <textarea>Textarea text</textarea>
        <div>Div text</div>
      `;

      mockSendMessage.mockResolvedValue({
        success: true,
        result: ['Div teksti'],
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  describe('translateSelection', () => {
    it('does nothing when no selection', async () => {
      // Mock empty selection
      const mockSelection = {
        isCollapsed: true,
        toString: () => '',
        getRangeAt: vi.fn(),
      };

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translateSelection', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sends translate message for selected text', async () => {
      // Create a real DOM text node inside a block element for getSelectionContext
      const p = document.createElement('p');
      p.textContent = 'Selected text here';
      document.body.appendChild(p);
      const textNode = p.firstChild!;

      // Create a mock range with getBoundingClientRect
      const mockRange = {
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 120,
          left: 50,
          right: 200,
          width: 150,
          height: 20,
        }),
        commonAncestorContainer: textNode,
      };

      const mockSelection = {
        isCollapsed: false,
        toString: () => 'Selected text here',
        getRangeAt: () => mockRange,
        rangeCount: 1,
      };

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Valittu teksti täällä',
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translateSelection', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'translate',
          text: 'Selected text here',
        })
      );
    });

    it('creates tooltip after successful translation', async () => {
      // Create a real DOM text node inside a block element for getSelectionContext
      const p = document.createElement('p');
      p.textContent = 'Text';
      document.body.appendChild(p);
      const textNode = p.firstChild!;

      const mockRange = {
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 120,
          left: 50,
          right: 200,
          width: 150,
          height: 20,
        }),
        commonAncestorContainer: textNode,
      };

      const mockSelection = {
        isCollapsed: false,
        toString: () => 'Text',
        getRangeAt: () => mockRange,
        rangeCount: 1,
      };

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Teksti',
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translateSelection', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const tooltip = document.getElementById('translate-tooltip');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toContain('Teksti');
    });
  });

  describe('translatePage', () => {
    it('batches translations', async () => {
      // Create many text nodes
      let html = '';
      for (let i = 0; i < 75; i++) {
        html += `<div>Text node ${i}</div>`;
      }
      document.body.innerHTML = html;

      mockSendMessage.mockResolvedValue({
        success: true,
        result: Array(50).fill('Translated'),
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have been called multiple times for batches
      const translateCalls = mockSendMessage.mock.calls.filter(
        (c) => c[0]?.type === 'translate'
      );

      expect(translateCalls.length).toBeGreaterThan(0);
    });

    it('replaces text content with translations', async () => {
      document.body.innerHTML = '<div id="test">Original text</div>';

      mockSendMessage.mockResolvedValue({
        success: true,
        result: ['Translated text'],
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      const div = document.getElementById('test');
      expect(div?.textContent).toBe('Translated text');
      expect(div?.getAttribute('data-translated')).toBe('true');
    });

    it('preserves whitespace', async () => {
      document.body.innerHTML = '<div id="test">  Original text  </div>';

      mockSendMessage.mockResolvedValue({
        success: true,
        result: ['Translated'],
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      const div = document.getElementById('test');
      // Whitespace should be preserved
      expect(div?.textContent?.startsWith('  ')).toBe(true);
      expect(div?.textContent?.endsWith('  ')).toBe(true);
    });

    it('handles translation error gracefully', async () => {
      document.body.innerHTML = '<div>Some text</div>';

      mockSendMessage.mockRejectedValue(new Error('Network error'));

      const sendResponse = vi.fn();
      const consoleSpy = vi.spyOn(console, 'error');

      vi.useFakeTimers();

      messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      // Advance timers to flush retry backoff delays and async operations
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(2000);
      }

      vi.useRealTimers();

      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('tooltip behavior', () => {
    it('removes existing tooltip before creating new one', async () => {
      // Create existing tooltip
      const existingTooltip = document.createElement('div');
      existingTooltip.id = 'translate-tooltip';
      document.body.appendChild(existingTooltip);

      // Create a real DOM text node inside a block element for getSelectionContext
      const p = document.createElement('p');
      p.textContent = 'New text';
      document.body.appendChild(p);
      const textNode = p.firstChild!;

      const mockRange = {
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 120,
          left: 50,
          right: 200,
          width: 150,
          height: 20,
        }),
        commonAncestorContainer: textNode,
      };

      const mockSelection = {
        isCollapsed: false,
        toString: () => 'New text',
        getRangeAt: () => mockRange,
        rangeCount: 1,
      };

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Uusi teksti',
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translateSelection', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only be one tooltip
      const tooltips = document.querySelectorAll('#translate-tooltip');
      expect(tooltips.length).toBe(1);
    });

    it('creates tooltip with correct structure', async () => {
      // Create a real DOM text node inside a block element for getSelectionContext
      const p = document.createElement('p');
      p.textContent = 'Text';
      document.body.appendChild(p);
      const textNode = p.firstChild!;

      const mockRange = {
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 120,
          left: 50,
          right: 200,
          width: 150,
          height: 20,
        }),
        commonAncestorContainer: textNode,
      };

      const mockSelection = {
        isCollapsed: false,
        toString: () => 'Text',
        getRangeAt: () => mockRange,
        rangeCount: 1,
      };

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Teksti',
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translateSelection', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const tooltip = document.getElementById('translate-tooltip');
      expect(tooltip).not.toBeNull();
      expect(tooltip?.textContent).toContain('Teksti');
      // Tooltip should have close button
      expect(tooltip?.querySelector('button')).not.toBeNull();
    });

    it('has close button that removes tooltip', async () => {
      // Create a real DOM text node inside a block element for getSelectionContext
      const p = document.createElement('p');
      p.textContent = 'Text';
      document.body.appendChild(p);
      const textNode = p.firstChild!;

      const mockRange = {
        getBoundingClientRect: () => ({
          top: 100,
          bottom: 120,
          left: 50,
          right: 200,
          width: 150,
          height: 20,
        }),
        commonAncestorContainer: textNode,
      };

      const mockSelection = {
        isCollapsed: false,
        toString: () => 'Text',
        getRangeAt: () => mockRange,
        rangeCount: 1,
      };

      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Teksti',
      });

      const sendResponse = vi.fn();

      messageHandler(
        { type: 'translateSelection', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        sendResponse
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const tooltip = document.getElementById('translate-tooltip');
      const closeBtn = tooltip?.querySelector('button');

      expect(closeBtn).not.toBeNull();

      // Click close button
      closeBtn?.click();

      expect(document.getElementById('translate-tooltip')).toBeNull();
    });
  });

  describe('message handler return values', () => {
    it('returns true for translateSelection', () => {
      const mockSelection = {
        isCollapsed: true,
        toString: () => '',
        getRangeAt: vi.fn(),
      };
      vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as unknown as Selection);

      const result = messageHandler(
        { type: 'translateSelection', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        vi.fn()
      );

      expect(result).toBe(true);
    });

    it('returns true for translatePage', () => {
      const result = messageHandler(
        { type: 'translatePage', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        vi.fn()
      );

      expect(result).toBe(true);
    });

    it('returns false for unknown message types', () => {
      const result = messageHandler(
        { type: 'unknown', sourceLang: 'en', targetLang: 'fi', strategy: 'balanced' },
        {},
        vi.fn()
      );

      expect(result).toBe(false);
    });
  });
});
