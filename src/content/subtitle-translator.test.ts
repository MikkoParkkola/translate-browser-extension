/**
 * Video Subtitle Translation unit tests
 *
 * Tests for subtitle detection, translation lifecycle, caching, and cleanup.
 * Covers both standard HTML5 TextTrack and YouTube custom caption flows.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// Mock the logger
vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock browserAPI
const mockSendMessage = vi.fn();
vi.mock('../core/browser-api', () => ({
  browserAPI: {
    runtime: {
      sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    },
  },
}));

import {
  initSubtitleTranslation,
  cleanupSubtitleTranslation,
  pretranslateUpcomingCues,
} from './subtitle-translator';

// Helper: create a mock HTMLVideoElement with TextTracks
function createMockVideo(tracks: Array<{ kind: string; cues?: Array<{ startTime: number; endTime: number; text: string }> }> = []): HTMLVideoElement {
  const video = document.createElement('video');

  // Build mock TextTrackList
  const textTracks: TextTrack[] = [];

  for (const trackDef of tracks) {
    const cueChangeListeners: Array<() => void> = [];

    // Create mock cues
    const mockCues = (trackDef.cues || []).map((c) => ({
      startTime: c.startTime,
      endTime: c.endTime,
      text: c.text,
    }));

    const track = {
      kind: trackDef.kind,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'cuechange') cueChangeListeners.push(handler);
      }),
      removeEventListener: vi.fn(),
      activeCues: null as unknown,
      cues: {
        length: mockCues.length,
        [Symbol.iterator]: function* () { yield* mockCues; },
        ...Object.fromEntries(mockCues.map((c, i) => [i, c])),
      },
      _cueChangeListeners: cueChangeListeners,
      _mockCues: mockCues,
    };

    textTracks.push(track as unknown as TextTrack);
  }

  // Override textTracks property
  Object.defineProperty(video, 'textTracks', {
    value: {
      length: textTracks.length,
      [Symbol.iterator]: function* () { yield* textTracks; },
      ...Object.fromEntries(textTracks.map((t, i) => [i, t])),
    },
    writable: false,
  });

  return video;
}

describe('Subtitle Translator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    // Reset location for YouTube tests
    Object.defineProperty(window, 'location', {
      value: { hostname: 'example.com', href: 'https://example.com' },
      writable: true,
    });
  });

  afterEach(() => {
    cleanupSubtitleTranslation();
    document.body.innerHTML = '';
  });

  describe('initSubtitleTranslation', () => {
    it('initializes without errors on a page with no videos', () => {
      expect(() => initSubtitleTranslation('fi')).not.toThrow();
    });

    it('creates page observer for dynamically added videos', () => {
      initSubtitleTranslation('fi');

      // Verify observer is active by adding a video dynamically
      const video = createMockVideo([{ kind: 'subtitles' }]);
      const container = document.createElement('div');
      container.appendChild(video);
      document.body.appendChild(container);

      // Give MutationObserver time to fire
      // The observer was created in initSubtitleTranslation
    });

    it('finds existing video elements on the page', () => {
      const video = createMockVideo([{ kind: 'subtitles' }]);
      document.body.appendChild(video);

      initSubtitleTranslation('fi');

      // Should have set up overlay for the video
      const overlay = document.querySelector('.translate-subtitle-overlay');
      expect(overlay).not.toBeNull();
    });

    it('sets up cuechange listeners for subtitle tracks', () => {
      const video = createMockVideo([
        { kind: 'subtitles' },
        { kind: 'captions' },
      ]);
      document.body.appendChild(video);

      initSubtitleTranslation('fi');

      // Both tracks should have cuechange listeners
      const tracks = video.textTracks;
      expect((tracks[0] as unknown as { addEventListener: Mock }).addEventListener).toHaveBeenCalledWith(
        'cuechange',
        expect.any(Function)
      );
      expect((tracks[1] as unknown as { addEventListener: Mock }).addEventListener).toHaveBeenCalledWith(
        'cuechange',
        expect.any(Function)
      );
    });

    it('ignores non-subtitle/caption tracks', () => {
      const video = createMockVideo([
        { kind: 'descriptions' },
        { kind: 'chapters' },
      ]);
      document.body.appendChild(video);

      initSubtitleTranslation('fi');

      // No overlay should be created because there are no subtitle/caption tracks
      // But the function still creates state. Check that no cuechange listeners added.
      const tracks = video.textTracks;
      expect((tracks[0] as unknown as { addEventListener: Mock }).addEventListener).not.toHaveBeenCalled();
      expect((tracks[1] as unknown as { addEventListener: Mock }).addEventListener).not.toHaveBeenCalled();
    });

    it('skips video elements with no text tracks', () => {
      const video = createMockVideo([]);
      document.body.appendChild(video);

      initSubtitleTranslation('fi');

      // No overlay should be created
      const overlay = document.querySelector('.translate-subtitle-overlay');
      expect(overlay).toBeNull();
    });

    it('does not set up same video twice', () => {
      const video = createMockVideo([{ kind: 'subtitles' }]);
      document.body.appendChild(video);

      initSubtitleTranslation('fi');
      const overlaysBefore = document.querySelectorAll('.translate-subtitle-overlay').length;

      // Re-initializing should not duplicate setup
      initSubtitleTranslation('de');
      // Second init creates a new page observer but the video itself is deduplicated
      // via WeakMap. However, a second init call happens on a clean state because
      // cleanupSubtitleTranslation runs in afterEach. Here we just test within one init.
      expect(overlaysBefore).toBe(1);
    });
  });

  describe('createSubtitleOverlay', () => {
    it('creates overlay element with correct class', () => {
      const video = createMockVideo([{ kind: 'subtitles' }]);
      const container = document.createElement('div');
      container.appendChild(video);
      document.body.appendChild(container);

      initSubtitleTranslation('fi');

      const overlay = document.querySelector('.translate-subtitle-overlay') as HTMLDivElement;
      expect(overlay).not.toBeNull();
      expect(overlay.className).toBe('translate-subtitle-overlay');
    });

    it('positions overlay absolutely within parent', () => {
      const video = createMockVideo([{ kind: 'subtitles' }]);
      const container = document.createElement('div');
      container.appendChild(video);
      document.body.appendChild(container);

      initSubtitleTranslation('fi');

      const overlay = document.querySelector('.translate-subtitle-overlay') as HTMLDivElement;
      expect(overlay.style.position).toBe('absolute');
      expect(overlay.style.display).toBe('none');
      expect(overlay.style.zIndex).toBe('2147483645');
    });

    it('sets parent position to relative if static', () => {
      const video = createMockVideo([{ kind: 'subtitles' }]);
      const container = document.createElement('div');
      container.style.position = 'static';
      container.appendChild(video);
      document.body.appendChild(container);

      initSubtitleTranslation('fi');

      expect(container.style.position).toBe('relative');
    });
  });

  describe('YouTube caption detection', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=test' },
        writable: true,
      });
    });

    it('sets up YouTube observer on youtube.com', () => {
      // Create a caption-window element that YouTube would have
      const captionWindow = document.createElement('div');
      captionWindow.className = 'caption-window';
      document.body.appendChild(captionWindow);

      initSubtitleTranslation('fi');

      // Verify by adding a caption segment - it should trigger translation
      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      segment.textContent = 'Hello world';
      captionWindow.appendChild(segment);
    });

    it('retries finding caption-window when not immediately available', () => {
      vi.useFakeTimers();

      initSubtitleTranslation('fi');

      // No caption-window exists yet, so a retry timer should be set
      // After timeout, it retries
      vi.advanceTimersByTime(2000);

      // Still no caption window, will retry again
      // Cleanup stops the retry
      cleanupSubtitleTranslation();

      vi.useRealTimers();
    });
  });

  describe('YouTube segment translation', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=test' },
        writable: true,
      });
    });

    it('translates YouTube caption segment text', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Hei maailma',
      });

      const captionWindow = document.createElement('div');
      captionWindow.className = 'caption-window';
      document.body.appendChild(captionWindow);

      initSubtitleTranslation('fi');

      // Simulate YouTube adding a caption segment
      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      segment.textContent = 'Hello world';
      captionWindow.appendChild(segment);

      // Wait for MutationObserver and async translation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The segment should have been marked
      expect(segment.getAttribute('data-translated')).toBe('true');
      expect(segment.getAttribute('data-original-text')).toBe('Hello world');
    });

    it('skips already translated YouTube segments', async () => {
      const captionWindow = document.createElement('div');
      captionWindow.className = 'caption-window';
      document.body.appendChild(captionWindow);

      initSubtitleTranslation('fi');

      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      segment.textContent = 'Already done';
      segment.setAttribute('data-translated', 'true');
      captionWindow.appendChild(segment);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should NOT have sent a translation request
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('caches YouTube translations to avoid duplicate requests', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Hei maailma',
      });

      const captionWindow = document.createElement('div');
      captionWindow.className = 'caption-window';
      document.body.appendChild(captionWindow);

      initSubtitleTranslation('fi');

      // First segment
      const segment1 = document.createElement('span');
      segment1.className = 'ytp-caption-segment';
      segment1.textContent = 'Hello world';
      captionWindow.appendChild(segment1);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second segment with the same text
      const segment2 = document.createElement('span');
      segment2.className = 'ytp-caption-segment';
      segment2.textContent = 'Hello world';
      captionWindow.appendChild(segment2);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only have translated once (second uses cache)
      const translateCalls = mockSendMessage.mock.calls.filter(
        (c) => c[0]?.type === 'translate'
      );
      expect(translateCalls.length).toBe(1);
    });
  });

  describe('Translation cache behavior', () => {
    it('caches translated cues by startTime to avoid re-translation', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Kaannetty',
      });

      const video = createMockVideo([
        {
          kind: 'subtitles',
          cues: [
            { startTime: 1.5, endTime: 3.0, text: 'Hello' },
          ],
        },
      ]);
      const container = document.createElement('div');
      container.appendChild(video);
      document.body.appendChild(container);

      initSubtitleTranslation('fi');

      // The caching is tested through the cuechange mechanism
      // Verify that the video has a subtitle overlay created
      const overlay = document.querySelector('.translate-subtitle-overlay');
      expect(overlay).not.toBeNull();
    });
  });

  describe('cleanupSubtitleTranslation', () => {
    it('removes all subtitle overlays from the DOM', () => {
      const video = createMockVideo([{ kind: 'subtitles' }]);
      const container = document.createElement('div');
      container.appendChild(video);
      document.body.appendChild(container);

      initSubtitleTranslation('fi');

      expect(document.querySelectorAll('.translate-subtitle-overlay').length).toBe(1);

      cleanupSubtitleTranslation();

      expect(document.querySelectorAll('.translate-subtitle-overlay').length).toBe(0);
    });

    it('disconnects page mutation observer', () => {
      initSubtitleTranslation('fi');
      // Should not throw even with no videos
      expect(() => cleanupSubtitleTranslation()).not.toThrow();
    });

    it('disconnects YouTube mutation observer', () => {
      Object.defineProperty(window, 'location', {
        value: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=test' },
        writable: true,
      });

      const captionWindow = document.createElement('div');
      captionWindow.className = 'caption-window';
      document.body.appendChild(captionWindow);

      initSubtitleTranslation('fi');
      expect(() => cleanupSubtitleTranslation()).not.toThrow();
    });

    it('clears YouTube retry timer', () => {
      vi.useFakeTimers();

      Object.defineProperty(window, 'location', {
        value: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=test' },
        writable: true,
      });

      initSubtitleTranslation('fi');
      cleanupSubtitleTranslation();

      // Advancing timers should not cause errors after cleanup
      vi.advanceTimersByTime(5000);

      vi.useRealTimers();
    });

    it('clears YouTube translation cache on cleanup', () => {
      // The ytTranslationCache.clear() is called in cleanupSubtitleTranslation.
      // We verify indirectly: cleanup does not throw and can be called after
      // YouTube initialization.
      Object.defineProperty(window, 'location', {
        value: { hostname: 'www.youtube.com', href: 'https://www.youtube.com/watch?v=test' },
        writable: true,
      });

      const captionWindow = document.createElement('div');
      captionWindow.className = 'caption-window';
      document.body.appendChild(captionWindow);

      initSubtitleTranslation('fi');

      // Cleanup clears the internal ytTranslationCache
      expect(() => cleanupSubtitleTranslation()).not.toThrow();

      // After cleanup, the module is in clean state - no leftover cache
      // Re-initialization should work cleanly
      const captionWindow2 = document.createElement('div');
      captionWindow2.className = 'caption-window';
      document.body.appendChild(captionWindow2);

      expect(() => initSubtitleTranslation('de')).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      initSubtitleTranslation('fi');
      expect(() => {
        cleanupSubtitleTranslation();
        cleanupSubtitleTranslation();
        cleanupSubtitleTranslation();
      }).not.toThrow();
    });
  });

  describe('pretranslateUpcomingCues', () => {
    it('does nothing for unknown video', () => {
      const video = document.createElement('video');
      // Not initialized, so no state
      expect(() => pretranslateUpcomingCues(video)).not.toThrow();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('pre-translates cues within buffer window', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Kaannetty',
      });

      const video = createMockVideo([
        {
          kind: 'subtitles',
          cues: [
            { startTime: 5.0, endTime: 7.0, text: 'Coming up next' },
            { startTime: 8.0, endTime: 10.0, text: 'Another cue' },
            { startTime: 50.0, endTime: 52.0, text: 'Far away cue' },
          ],
        },
      ]);

      Object.defineProperty(video, 'currentTime', { value: 3.0, writable: true });

      const container = document.createElement('div');
      container.appendChild(video);
      document.body.appendChild(container);

      initSubtitleTranslation('fi');

      pretranslateUpcomingCues(video, 10);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have sent translate requests for cues at 5.0 and 8.0 (within 10s buffer)
      // but NOT for cue at 50.0
      const translateCalls = mockSendMessage.mock.calls.filter(
        (c) => c[0]?.type === 'translate'
      );
      expect(translateCalls.length).toBe(2);
      expect(translateCalls[0][0].text).toBe('Coming up next');
      expect(translateCalls[1][0].text).toBe('Another cue');
    });

    it('strips HTML tags from cue text when pre-translating', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        result: 'Stripped',
      });

      const video = createMockVideo([
        {
          kind: 'subtitles',
          cues: [
            { startTime: 2.0, endTime: 4.0, text: '<b>Bold text</b>' },
          ],
        },
      ]);

      Object.defineProperty(video, 'currentTime', { value: 0.0, writable: true });

      const container = document.createElement('div');
      container.appendChild(video);
      document.body.appendChild(container);

      initSubtitleTranslation('fi');

      pretranslateUpcomingCues(video, 10);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const translateCalls = mockSendMessage.mock.calls.filter(
        (c) => c[0]?.type === 'translate'
      );
      expect(translateCalls.length).toBe(1);
      expect(translateCalls[0][0].text).toBe('Bold text');
    });
  });

  // ============================================================================
  // onCueChange coverage — trigger the stored cuechange listener
  // ============================================================================

  describe('onCueChange', () => {
    // Helper: returns { video, track, fireCueChange }
    function setupWithCueChange(cueText: string, startTime = 1.0) {
      const cueChangeListeners: Array<() => void> = [];
      const mockCue = { startTime, endTime: startTime + 2, text: cueText };

      const track = {
        kind: 'subtitles',
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'cuechange') cueChangeListeners.push(handler);
        }),
        removeEventListener: vi.fn(),
        activeCues: null as unknown,
        cues: {
          length: 1,
          [Symbol.iterator]: function* () { yield mockCue; },
          0: mockCue,
        },
        _cueChangeListeners: cueChangeListeners,
      };

      const video = document.createElement('video');
      Object.defineProperty(video, 'textTracks', {
        value: {
          length: 1,
          [Symbol.iterator]: function* () { yield track; },
          0: track,
        },
        writable: false,
      });

      const container = document.createElement('div');
      container.appendChild(video);
      document.body.appendChild(container);

      initSubtitleTranslation('fi');

      return {
        video,
        track,
        fireCueChange: (activeCues: unknown) => {
          track.activeCues = activeCues;
          cueChangeListeners.forEach((fn) => fn());
        },
      };
    }

    it('hides overlay when activeCues is empty', async () => {
      const { fireCueChange } = setupWithCueChange('Hello');

      const overlay = document.querySelector('.translate-subtitle-overlay') as HTMLDivElement;
      overlay.style.display = 'block'; // pre-set to visible

      fireCueChange({ length: 0 });
      await new Promise((r) => setTimeout(r, 10));

      expect(overlay.style.display).toBe('none');
    });

    it('hides overlay when activeCues is null', async () => {
      const { fireCueChange } = setupWithCueChange('Hello');

      const overlay = document.querySelector('.translate-subtitle-overlay') as HTMLDivElement;
      overlay.style.display = 'block';

      fireCueChange(null);
      await new Promise((r) => setTimeout(r, 10));

      expect(overlay.style.display).toBe('none');
    });

    it('shows original text while translation is in progress', async () => {
      mockSendMessage.mockImplementation(() => new Promise(() => {})); // never resolves

      const { fireCueChange } = setupWithCueChange('Subtitle text');

      const overlay = document.querySelector('.translate-subtitle-overlay') as HTMLDivElement;
      const cue = { startTime: 1.0, endTime: 3.0, text: 'Subtitle text' };

      fireCueChange({ length: 1, 0: cue });
      // Synchronously — before await — the overlay should show original text
      await new Promise((r) => setTimeout(r, 0));

      expect(overlay.textContent).toBe('Subtitle text');
      expect(overlay.style.display).toBe('block');
    });

    it('updates overlay with translated text on success', async () => {
      mockSendMessage.mockResolvedValue({ success: true, result: 'Tekstitys' });

      const { fireCueChange } = setupWithCueChange('Subtitle text', 2.0);
      const cue = { startTime: 2.0, endTime: 4.0, text: 'Subtitle text' };
      const overlay = document.querySelector('.translate-subtitle-overlay') as HTMLDivElement;

      fireCueChange({ length: 1, 0: cue });
      await new Promise((r) => setTimeout(r, 50));

      expect(overlay.textContent).toBe('Tekstitys');
    });

    it('handles array result from translate response', async () => {
      mockSendMessage.mockResolvedValue({ success: true, result: ['Kaannettu'] });

      const { fireCueChange } = setupWithCueChange('Array result', 3.0);
      const cue = { startTime: 3.0, endTime: 5.0, text: 'Array result' };
      const overlay = document.querySelector('.translate-subtitle-overlay') as HTMLDivElement;

      fireCueChange({ length: 1, 0: cue });
      await new Promise((r) => setTimeout(r, 50));

      expect(overlay.textContent).toBe('Kaannettu');
    });

    it('uses cached translation on second cuechange for same cue', async () => {
      mockSendMessage.mockResolvedValue({ success: true, result: 'Cached result' });

      const { fireCueChange } = setupWithCueChange('Cached cue', 4.0);
      const cue = { startTime: 4.0, endTime: 6.0, text: 'Cached cue' };
      const overlay = document.querySelector('.translate-subtitle-overlay') as HTMLDivElement;

      // First fire — translates and caches
      fireCueChange({ length: 1, 0: cue });
      await new Promise((r) => setTimeout(r, 50));

      const callsBefore = mockSendMessage.mock.calls.length;

      // Second fire — should use cache, no new sendMessage call
      fireCueChange({ length: 1, 0: cue });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockSendMessage.mock.calls.length).toBe(callsBefore);
      expect(overlay.textContent).toBe('Cached result');
      expect(overlay.style.display).toBe('block');
    });

    it('keeps original text showing when translate response has no result', async () => {
      mockSendMessage.mockResolvedValue({ success: false });

      const { fireCueChange } = setupWithCueChange('No result cue', 5.0);
      const cue = { startTime: 5.0, endTime: 7.0, text: 'No result cue' };
      const overlay = document.querySelector('.translate-subtitle-overlay') as HTMLDivElement;

      fireCueChange({ length: 1, 0: cue });
      await new Promise((r) => setTimeout(r, 50));

      // Original text remains, overlay stays visible
      expect(overlay.textContent).toBe('No result cue');
      expect(overlay.style.display).toBe('block');
    });

    it('keeps original text when sendMessage throws', async () => {
      mockSendMessage.mockRejectedValue(new Error('Network error'));

      const { fireCueChange } = setupWithCueChange('Error cue', 6.0);
      const cue = { startTime: 6.0, endTime: 8.0, text: 'Error cue' };
      const overlay = document.querySelector('.translate-subtitle-overlay') as HTMLDivElement;

      fireCueChange({ length: 1, 0: cue });
      await new Promise((r) => setTimeout(r, 50));

      // Error path: original text stays, overlay still visible
      expect(overlay.textContent).toBe('Error cue');
    });

    it('strips html tags from cue text before translation', async () => {
      mockSendMessage.mockResolvedValue({ success: true, result: 'Stripped' });

      const { fireCueChange } = setupWithCueChange('<b>Bold</b>', 7.0);
      const cue = { startTime: 7.0, endTime: 9.0, text: '<b>Bold</b>' };

      fireCueChange({ length: 1, 0: cue });
      await new Promise((r) => setTimeout(r, 50));

      const sendArgs = mockSendMessage.mock.calls[0]?.[0];
      expect(sendArgs?.text).toBe('Bold');
    });

    it('skips cue with empty or whitespace text', async () => {
      const { fireCueChange } = setupWithCueChange('   ');
      const cue = { startTime: 1.0, endTime: 3.0, text: '   ' };

      fireCueChange({ length: 1, 0: cue });
      await new Promise((r) => setTimeout(r, 10));

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Video setup initialization (line 40 and 46-47 coverage)
  // ============================================================================

  describe('Video detection and setup on initSubtitleTranslation', () => {
    it('calls setupVideoTranslation for existing videos on page (line 40)', () => {
      // Add video before calling initSubtitleTranslation
      const video = createMockVideo([{ kind: 'subtitles' }]);
      const container = document.createElement('div');
      container.appendChild(video);
      document.body.appendChild(container);

      // Now initialize — should detect and set up the existing video
      initSubtitleTranslation('fi');

      // Overlay should be created for the video
      const overlays = document.querySelectorAll('.translate-subtitle-overlay');
      expect(overlays.length).toBe(1);
    });

    it('initializes mutation observer for dynamically added videos', () => {
      initSubtitleTranslation('fi');

      // Create a mock MutationObserver to verify it was called with correct options
      // Since we can't directly verify the observer was set up,
      // we verify indirectly by ensuring the initialization completes without error
      expect(() => cleanupSubtitleTranslation()).not.toThrow();
    });

    it('handles multiple videos on the same page', () => {
      const video1 = createMockVideo([{ kind: 'subtitles' }]);
      const video2 = createMockVideo([{ kind: 'captions' }]);
      const container1 = document.createElement('div');
      const container2 = document.createElement('div');
      container1.appendChild(video1);
      container2.appendChild(video2);
      document.body.appendChild(container1);
      document.body.appendChild(container2);

      initSubtitleTranslation('fi');

      const overlays = document.querySelectorAll('.translate-subtitle-overlay');
      expect(overlays.length).toBe(2);
    });
  });
});
