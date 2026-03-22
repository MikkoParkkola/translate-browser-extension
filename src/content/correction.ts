/**
 * Correction editing — learn from user corrections to translations
 */

import { MACHINE_TRANSLATION_ATTR, ORIGINAL_TEXT_ATTR, SOURCE_LANG_ATTR, TARGET_LANG_ATTR } from './content-types';
import { showInfoToast, showErrorToast } from './toast';
import { browserAPI } from '../core/browser-api';
import { safeStorageGet } from '../core/storage';
import { createLogger } from '../core/logger';

const log = createLogger('Content');

/**
 * Make a translated element editable for corrections
 * When the user clicks on a translated element, they can edit it
 * and the correction will be saved for future translations
 */
export function makeTranslatedElementEditable(element: HTMLElement): void {
  // Already set up for editing
  if (element.hasAttribute('data-correction-enabled')) return;

  element.setAttribute('data-correction-enabled', 'true');

  // Add hover indicator
  element.style.cursor = 'text';

  // Handle click to enable editing
  element.addEventListener('click', (e) => {
    // Only enable editing if not already editing
    if (element.getAttribute('contenteditable') === 'true') return;

    // Don't interfere with link clicks
    if ((e.target as Element).closest('a')) return;

    e.preventDefault();
    e.stopPropagation();

    enableCorrectionEditing(element);
  });
}

/**
 * Enable inline editing for a translated element
 */
function enableCorrectionEditing(element: HTMLElement): void {
  const machineTranslation = element.getAttribute(MACHINE_TRANSLATION_ATTR);
  const originalText = element.getAttribute(ORIGINAL_TEXT_ATTR);
  const sourceLang = element.getAttribute(SOURCE_LANG_ATTR);
  const targetLang = element.getAttribute(TARGET_LANG_ATTR);

  if (!machineTranslation || !originalText || !sourceLang || !targetLang) {
    log.warn('Missing data for correction editing');
    return;
  }

  // Store current state
  /* v8 ignore next */
  const currentText = element.textContent || '';

  // Make editable
  element.setAttribute('contenteditable', 'true');
  element.style.outline = '2px solid #3b82f6';
  element.style.outlineOffset = '2px';
  element.style.borderRadius = '2px';
  element.style.minWidth = '20px';
  element.focus();

  // Select all text for easy replacement
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);

  // Handle blur (finish editing)
  const handleBlur = async () => {
    element.removeAttribute('contenteditable');
    element.style.outline = '';
    element.style.outlineOffset = '';

    const newText = element.textContent?.trim() || '';

    // If user cleared the text, restore original
    if (!newText) {
      element.textContent = currentText;
      return;
    }

    // If text changed and is different from machine translation
    if (newText !== currentText && newText !== machineTranslation) {
      try {
        await browserAPI.runtime.sendMessage({
          type: 'addCorrection',
          original: originalText.trim(),
          machineTranslation: machineTranslation,
          userCorrection: newText,
          sourceLang,
          targetLang,
        });
        showInfoToast('Correction saved! Future translations will use your preference.');
        log.info('Correction saved:', { original: originalText.substring(0, 30), correction: newText.substring(0, 30) });
      } catch (error) {
        log.error('Failed to save correction:', error);
        showErrorToast('Failed to save correction');
      }
    /* v8 ignore next */
    } else if (newText === machineTranslation) {
      // User reverted to machine translation, no correction needed
      element.textContent = currentText;
    }
  };

  element.addEventListener('blur', handleBlur, { once: true });

  // Handle keyboard shortcuts
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      element.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Restore original text on escape
      element.textContent = currentText;
      element.blur();
    }
  };

  element.addEventListener('keydown', handleKeyDown);

  // Clean up keydown listener on blur
  element.addEventListener('blur', () => {
    element.removeEventListener('keydown', handleKeyDown);
  }, { once: true });
}

/**
 * Show a hint tooltip on first translated element hover
 */
let correctionHintShown = false;

export function showCorrectionHint(_element: HTMLElement): void {
  if (correctionHintShown) return;

  // Check if we've shown the hint before (use browserAPI for cross-browser compat)
  const hintKey = 'translate_correction_hint_shown';
  safeStorageGet<Record<string, boolean>>([hintKey]).then((result) => {
    if (result[hintKey]) {
      correctionHintShown = true;
      return;
    }

    // Show hint tooltip
    const hint = document.createElement('div');
    hint.id = 'translate-correction-hint';
    Object.assign(hint.style, {
      position: 'fixed',
      bottom: '60px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#1e40af',
      color: '#dbeafe',
      padding: '10px 16px',
      borderRadius: '8px',
      fontSize: '13px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      zIndex: '2147483647',
      maxWidth: '320px',
      textAlign: 'center',
      lineHeight: '1.4',
    });
    hint.textContent = 'Tip: Click on any translated text to edit it. Your corrections will be remembered for future translations!';

    document.body.appendChild(hint);
    correctionHintShown = true;

    // Mark as shown in storage (fire-and-forget)
    /* v8 ignore start -- fire-and-forget */
    browserAPI.storage?.local?.set({ [hintKey]: true }).catch(() => {});
    /* v8 ignore stop */

    // Remove after a few seconds
    setTimeout(() => {
      hint.style.opacity = '0';
      hint.style.transition = 'opacity 0.3s ease';
      setTimeout(() => hint.remove(), 300);
    }, 6000);
  }).catch(() => {
    // Storage not available, just mark as shown
    correctionHintShown = true;
  });
}
