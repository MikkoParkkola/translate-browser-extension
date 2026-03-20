/**
 * HTML sanitization utilities (security-critical)
 */

/**
 * Escape HTML special characters to prevent XSS.
 * Uses the browser's built-in textContent → innerHTML encoding.
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
