/**
 * Toast notification UI for the content script
 */

/** Active progress toast reference (for live updates during translation) */
let activeProgressToast: HTMLElement | null = null;

/**
 * Show a brief info toast message to the user
 */
export function showInfoToast(message: string, durationMs = 3000): void {
  // Remove any existing toast (but not an active progress toast mid-translation)
  const existing = document.getElementById('translate-ext-toast');
  if (existing && existing !== activeProgressToast) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'translate-ext-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%) translateY(8px)',
    background: 'rgba(30, 41, 59, 0.85)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    color: '#f1f5f9',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    zIndex: '2147483647',
    opacity: '0',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
  });

  document.body.appendChild(toast);

  // Slide up + fade in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Fade out + slide down and remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(8px)';
    setTimeout(() => toast.remove(), 250);
  }, durationMs);
}

/**
 * Show a persistent progress toast that updates in-place during translation.
 * Returns the toast element for live updates. Call removeProgressToast() when done.
 *
 * XSS-safe: message is inserted via textContent, not innerHTML.
 */
export function showProgressToast(message: string): HTMLElement {
  // Remove previous progress toast
  removeProgressToast();

  const toast = document.createElement('div');
  toast.id = 'translate-ext-progress-toast';
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#1e293b',
    color: '#f1f5f9',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    zIndex: '2147483647',
    opacity: '0',
    transition: 'opacity 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: '200px',
  });

  // Build spinner + message via DOM API (not innerHTML) to prevent XSS
  const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spinner.setAttribute('width', '16');
  spinner.setAttribute('height', '16');
  spinner.setAttribute('viewBox', '0 0 24 24');
  spinner.setAttribute('fill', 'none');
  spinner.style.flexShrink = '0';
  spinner.style.animation = 'translate-spin 1s linear infinite';
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '10');
  circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '2');
  circle.setAttribute('stroke-dasharray', '31.4 31.4');
  circle.setAttribute('stroke-linecap', 'round');
  spinner.appendChild(circle);

  const textSpan = document.createElement('span');
  textSpan.className = 'translate-progress-text';
  textSpan.textContent = message;

  const spinStyle = document.createElement('style');
  spinStyle.textContent = '@keyframes translate-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';

  toast.appendChild(spinner);
  toast.appendChild(textSpan);
  toast.appendChild(spinStyle);

  document.body.appendChild(toast);
  activeProgressToast = toast;

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  return toast;
}

/**
 * Update the text of the active progress toast
 */
export function updateProgressToast(message: string): void {
  if (!activeProgressToast) return;
  const textEl = activeProgressToast.querySelector('.translate-progress-text');
  if (textEl) textEl.textContent = message;
}

/**
 * Remove the progress toast with a fade-out
 */
export function removeProgressToast(): void {
  if (activeProgressToast) {
    const toast = activeProgressToast;
    activeProgressToast = null;
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }
  // Also remove by ID in case reference was lost
  const existing = document.getElementById('translate-ext-progress-toast');
  if (existing) {
    existing.style.opacity = '0';
    setTimeout(() => existing.remove(), 200);
  }
}

/**
 * Show an error toast message to the user
 */
export function showErrorToast(message: string, durationMs = 6000): void {
  // Remove any existing toast
  const existing = document.getElementById('translate-ext-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'translate-ext-toast';
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%) translateY(8px)',
    background: 'rgba(153, 27, 27, 0.88)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    color: '#fef2f2',
    padding: '12px 20px',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
    zIndex: '2147483647',
    opacity: '0',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
    maxWidth: '400px',
    textAlign: 'center',
    lineHeight: '1.4',
  });

  // Add icon and message (use textContent for message to prevent XSS)
  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, { display: 'flex', alignItems: 'flex-start', gap: '10px' });
  wrapper.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="flex-shrink: 0; margin-top: 2px;">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
      <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="12" cy="16" r="1" fill="currentColor"/>
    </svg>
  `;
  const msgSpan = document.createElement('span');
  msgSpan.textContent = message;
  wrapper.appendChild(msgSpan);
  toast.appendChild(wrapper);

  document.body.appendChild(toast);

  // Slide up + fade in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Fade out + slide down and remove
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(8px)';
    setTimeout(() => toast.remove(), 250);
  }, durationMs);
}
