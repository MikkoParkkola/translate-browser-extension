/**
 * Bilingual reading mode — shows original text alongside translations
 */

import { TRANSLATED_ATTR, ORIGINAL_TEXT_ATTR } from './content-types';
import { showInfoToast } from './toast';
import { createLogger } from '../core/logger';

const log = createLogger('Content');

let bilingualModeEnabled = false;

/**
 * Apply bilingual display to a single translated element.
 * Appends a small original-text annotation after the translated text
 * WITHOUT destroying DOM nodes, event listeners, or text node references.
 */
export function applyBilingualToElement(el: Element): void {
  const originalText = el.getAttribute(ORIGINAL_TEXT_ATTR);
  if (!originalText) return;

  // Skip if already has bilingual annotation
  if (el.querySelector('.translate-bilingual-original')) return;

  // Append a subtle original-text annotation (non-destructive)
  const annotation = document.createElement('span');
  annotation.className = 'translate-bilingual-original';
  annotation.textContent = originalText;
  annotation.setAttribute('aria-hidden', 'true'); // Screen readers skip the duplicate

  el.appendChild(annotation);
  el.classList.add('translate-bilingual');
}

/**
 * Remove bilingual annotation from a single element
 */
export function removeBilingualFromElement(el: Element): void {
  const annotation = el.querySelector('.translate-bilingual-original');
  if (annotation) annotation.remove();
  el.classList.remove('translate-bilingual');
}

/**
 * Enable bilingual mode - shows original text below translations.
 * Non-destructive: appends annotation spans without touching existing DOM structure.
 */
export function enableBilingualMode(): void {
  bilingualModeEnabled = true;

  const translated = document.querySelectorAll(`[${TRANSLATED_ATTR}]`);
  translated.forEach((el) => applyBilingualToElement(el));

  log.info('Bilingual mode enabled');
  showInfoToast('Bilingual mode: showing originals');
}

/**
 * Disable bilingual mode - remove original text annotations
 */
export function disableBilingualMode(): void {
  bilingualModeEnabled = false;

  const bilingualElements = document.querySelectorAll('.translate-bilingual');
  bilingualElements.forEach((el) => removeBilingualFromElement(el));

  log.info('Bilingual mode disabled');
  showInfoToast('Bilingual mode off');
}

/**
 * Toggle bilingual mode
 */
export function toggleBilingualMode(): boolean {
  if (bilingualModeEnabled) {
    disableBilingualMode();
  } else {
    enableBilingualMode();
  }
  return bilingualModeEnabled;
}

/**
 * Get current bilingual mode state
 */
export function getBilingualModeState(): boolean {
  return bilingualModeEnabled;
}
