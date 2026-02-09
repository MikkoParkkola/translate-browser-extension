/**
 * Video Subtitle Translation Module
 *
 * Detects video elements with text tracks and translates captions in real-time.
 * Supports:
 * - Standard HTML5 <track> elements (TextTrack API)
 * - YouTube custom captions (.ytp-caption-segment)
 */

import type { TranslateResponse } from '../types';
import { browserAPI } from '../core/browser-api';
import { createLogger } from '../core/logger';

const log = createLogger('Subtitles');

interface SubtitleState {
  video: HTMLVideoElement;
  originalCues: Map<number, string>;  // startTime -> original text
  translatedCues: Map<number, string>; // startTime -> translated text
  overlay: HTMLDivElement | null;
  observer: MutationObserver | null;
  active: boolean;
}

const videoStates = new WeakMap<HTMLVideoElement, SubtitleState>();
let targetLang = 'en';
let pageObserver: MutationObserver | null = null;
let ytObserver: MutationObserver | null = null;
let ytRetryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Initialize subtitle translation for the page.
 * Called when page translation is triggered.
 */
export function initSubtitleTranslation(tgtLang: string): void {
  targetLang = tgtLang;

  // Find all videos on the page
  const videos = document.querySelectorAll('video');
  videos.forEach(setupVideoTranslation);

  // Watch for dynamically added videos
  pageObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLVideoElement) {
          setupVideoTranslation(node);
        }
        if (node instanceof HTMLElement) {
          node.querySelectorAll('video').forEach(setupVideoTranslation);
        }
      }
    }
  });
  pageObserver.observe(document.body, { childList: true, subtree: true });

  // YouTube-specific: watch for caption container
  if (isYouTube()) {
    setupYouTubeTranslation();
  }

  log.info('Subtitle translation initialized', { targetLang: tgtLang });
}

function isYouTube(): boolean {
  return window.location.hostname.includes('youtube.com');
}

/**
 * Set up translation for a standard HTML5 video with TextTrack
 */
function setupVideoTranslation(video: HTMLVideoElement): void {
  if (videoStates.has(video)) return;

  const tracks = video.textTracks;
  if (!tracks || tracks.length === 0) return;

  const state: SubtitleState = {
    video,
    originalCues: new Map(),
    translatedCues: new Map(),
    overlay: null,
    observer: null,
    active: true,
  };
  videoStates.set(video, state);

  // Create overlay for translated subtitles
  state.overlay = createSubtitleOverlay(video);

  // Listen for cue changes on all subtitle/caption tracks
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (track.kind === 'subtitles' || track.kind === 'captions') {
      track.addEventListener('cuechange', () => onCueChange(state, track));
    }
  }

  log.info('Video subtitle translation set up', { trackCount: tracks.length });
}

function createSubtitleOverlay(video: HTMLVideoElement): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'translate-subtitle-overlay';
  Object.assign(overlay.style, {
    position: 'absolute',
    bottom: '60px',
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: '80%',
    padding: '4px 12px',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    color: '#fff',
    fontSize: '16px',
    lineHeight: '1.4',
    textAlign: 'center',
    borderRadius: '4px',
    zIndex: '2147483645',
    pointerEvents: 'none',
    display: 'none',
    fontFamily: 'Arial, sans-serif',
  });

  // Position relative to video
  const container = video.parentElement;
  if (container) {
    const pos = getComputedStyle(container).position;
    if (pos === 'static') container.style.position = 'relative';
    container.appendChild(overlay);
  }

  return overlay;
}

async function onCueChange(state: SubtitleState, track: TextTrack): Promise<void> {
  if (!state.overlay || !state.active) return;

  const activeCues = track.activeCues;
  if (!activeCues || activeCues.length === 0) {
    state.overlay.style.display = 'none';
    return;
  }

  const cue = activeCues[0] as VTTCue;
  const originalText = cue.text;
  if (!originalText?.trim()) return;

  // Check cache first
  const cacheKey = Math.round(cue.startTime * 100);
  const cached = state.translatedCues.get(cacheKey);
  if (cached) {
    state.overlay.textContent = cached;
    state.overlay.style.display = 'block';
    return;
  }

  // Show original while translating
  state.overlay.textContent = originalText;
  state.overlay.style.display = 'block';

  try {
    const response = (await browserAPI.runtime.sendMessage({
      type: 'translate',
      text: originalText.replace(/<[^>]*>/g, ''), // Strip HTML tags from cues
      sourceLang: 'auto',
      targetLang,
    })) as TranslateResponse;

    if (response?.success && response.result) {
      const translated = (typeof response.result === 'string')
        ? response.result
        : response.result[0];
      state.translatedCues.set(cacheKey, translated);

      // Only update if this cue is still active
      if (track.activeCues?.[0] === cue) {
        state.overlay.textContent = translated;
      }
    }
  } catch {
    // Keep showing original on error
  }
}

/**
 * YouTube-specific subtitle translation.
 * YouTube uses custom caption renderer, not native TextTrack.
 */
function setupYouTubeTranslation(): void {
  // Watch for YouTube caption segments
  ytObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLElement) {
          const segments = node.classList?.contains('ytp-caption-segment')
            ? [node]
            : Array.from(node.querySelectorAll('.ytp-caption-segment'));

          segments.forEach(translateYouTubeSegment);
        }
      }
    }
  });

  // Observe the caption window container
  const startObserving = () => {
    const captionWindow = document.querySelector('.caption-window');
    if (captionWindow) {
      ytObserver!.observe(captionWindow, { childList: true, subtree: true });
      log.info('YouTube caption observer attached');
    } else {
      // Retry - caption container may not exist yet
      ytRetryTimer = setTimeout(startObserving, 2000);
    }
  };
  startObserving();
}

const ytTranslationCache = new Map<string, string>();

async function translateYouTubeSegment(segment: Element): Promise<void> {
  const text = segment.textContent?.trim();
  if (!text || segment.hasAttribute('data-translated')) return;

  // Mark to avoid double-translation
  segment.setAttribute('data-translated', 'true');
  segment.setAttribute('data-original-text', text);

  // Check cache
  const cached = ytTranslationCache.get(text);
  if (cached) {
    segment.textContent = cached;
    return;
  }

  try {
    const response = (await browserAPI.runtime.sendMessage({
      type: 'translate',
      text,
      sourceLang: 'auto',
      targetLang,
    })) as TranslateResponse;

    if (response?.success && response.result) {
      const translated = (typeof response.result === 'string')
        ? response.result
        : response.result[0];
      ytTranslationCache.set(text, translated);
      segment.textContent = translated;
    }
  } catch {
    // Keep original on error
  }
}

/**
 * Pre-translate upcoming cues for smoother playback
 */
export function pretranslateUpcomingCues(video: HTMLVideoElement, bufferSeconds = 10): void {
  const state = videoStates.get(video);
  if (!state) return;

  const currentTime = video.currentTime;
  const tracks = video.textTracks;

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (!track.cues) continue;

    for (let j = 0; j < track.cues.length; j++) {
      const cue = track.cues[j] as VTTCue;
      if (cue.startTime > currentTime && cue.startTime < currentTime + bufferSeconds) {
        const cacheKey = Math.round(cue.startTime * 100);
        if (!state.translatedCues.has(cacheKey)) {
          // Fire and forget - pre-translate
          browserAPI.runtime.sendMessage({
            type: 'translate',
            text: cue.text.replace(/<[^>]*>/g, ''),
            sourceLang: 'auto',
            targetLang,
          }).then((resp: unknown) => {
            const response = resp as TranslateResponse;
            if (response?.success && response.result) {
              const translated = (typeof response.result === 'string')
                ? response.result
                : response.result[0];
              state.translatedCues.set(cacheKey, translated);
            }
          }).catch(() => {
            // Silently ignore pre-translation failures
          });
        }
      }
    }
  }
}

/**
 * Cleanup subtitle translation - remove overlays, disconnect observers, clear caches
 */
export function cleanupSubtitleTranslation(): void {
  // Disconnect page observer
  if (pageObserver) {
    pageObserver.disconnect();
    pageObserver = null;
  }

  // Disconnect YouTube observer
  if (ytObserver) {
    ytObserver.disconnect();
    ytObserver = null;
  }

  // Clear YouTube retry timer
  if (ytRetryTimer !== null) {
    clearTimeout(ytRetryTimer);
    ytRetryTimer = null;
  }

  // YouTube cache cleanup
  ytTranslationCache.clear();

  // Remove all subtitle overlays from the DOM
  const overlays = document.querySelectorAll('.translate-subtitle-overlay');
  overlays.forEach((overlay) => overlay.remove());

  log.info('Subtitle translation cleaned up');
}
