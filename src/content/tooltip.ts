/**
 * Selection translation tooltips (result + error)
 */

/** Data attribute used to identify the text-content span inside a tooltip. */
const TOOLTIP_TEXT_ATTR = 'data-translate-text';

/**
 * Show translation tooltip
 * @param streaming — when true, updates an existing tooltip in place rather than
 *   recreating it. This avoids flicker during progressive streaming updates.
 */
export function showTranslationTooltip(text: string, range: Range, streaming = false): void {
  // In streaming mode, reuse the existing tooltip element if present
  if (streaming) {
    const existing = document.getElementById('translate-tooltip');
    const textSpan = existing?.querySelector<HTMLSpanElement>(`[${TOOLTIP_TEXT_ATTR}]`);
    if (textSpan) {
      textSpan.textContent = text;
      return;
    }
  }

  removeTooltip();

  const rect = range.getBoundingClientRect();

  const tooltip = document.createElement('div');
  tooltip.id = 'translate-tooltip';
  tooltip.style.cssText = `
    position: fixed;
    top: ${Math.min(rect.bottom + 8, window.innerHeight - 100)}px;
    left: ${Math.max(8, Math.min(rect.left, window.innerWidth - 416))}px;
    max-width: 400px;
    padding: 12px 16px;
    background: #1e293b;
    color: white;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.5;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 999999;
    animation: translateFadeIn 0.2s ease;
    word-wrap: break-word;
  `;

  // Dedicated text span — streaming updates target this element
  const textSpan = document.createElement('span');
  textSpan.setAttribute(TOOLTIP_TEXT_ATTR, '');
  textSpan.textContent = text;
  tooltip.appendChild(textSpan);

  // Add close button
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `
    position: absolute;
    top: 4px;
    right: 8px;
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  `;
  closeBtn.onclick = () => removeTooltip();
  tooltip.appendChild(closeBtn);

  document.body.appendChild(tooltip);

  // Auto-remove after 10 seconds
  setTimeout(() => removeTooltip(), 10000);
}

/**
 * Show error tooltip
 */
export function showErrorTooltip(message: string, range: Range): void {
  removeTooltip();

  const rect = range.getBoundingClientRect();

  const tooltip = document.createElement('div');
  tooltip.id = 'translate-tooltip';
  tooltip.style.cssText = `
    position: fixed;
    top: ${Math.min(rect.bottom + 8, window.innerHeight - 100)}px;
    left: ${Math.max(8, Math.min(rect.left, window.innerWidth - 416))}px;
    max-width: 400px;
    padding: 12px 16px;
    background: #991b1b;
    color: white;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.5;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    z-index: 999999;
    animation: translateFadeIn 0.2s ease;
  `;

  tooltip.textContent = message;

  // Add close button
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = `
    position: absolute;
    top: 4px;
    right: 8px;
    background: none;
    border: none;
    color: #fca5a5;
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  `;
  closeBtn.onclick = () => removeTooltip();
  tooltip.appendChild(closeBtn);

  document.body.appendChild(tooltip);

  // Auto-remove after 5 seconds
  setTimeout(() => removeTooltip(), 5000);
}

/**
 * Remove tooltip
 */
export function removeTooltip(): void {
  const existing = document.getElementById('translate-tooltip');
  if (existing) existing.remove();
}
