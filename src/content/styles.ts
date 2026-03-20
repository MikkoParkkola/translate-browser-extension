// Content-script CSS styles injected into the page for translation UI elements.
// Covers hover highlights, bilingual reading mode, image translation overlays, and animations.

export function injectContentStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
  @keyframes translateFadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes hoverFadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .hover-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid #475569;
    border-top-color: #60a5fa;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .hover-original { color: #94a3b8; }
  .hover-arrow { color: #60a5fa; font-weight: bold; }
  .hover-translation { color: #f1f5f9; font-weight: 500; }

  /* Bilingual Reading Mode - non-destructive annotation */
  .translate-bilingual {
    position: relative;
  }
  .translate-bilingual-original {
    display: block;
    font-size: 0.8em;
    line-height: 1.3;
    color: #6b7280;
    font-style: italic;
    opacity: 0.7;
    margin-top: 1px;
    pointer-events: none;
    user-select: none;
  }
  /* Inline elements (span, a, em, strong) — keep annotation inline-block to avoid breaking flow */
  span.translate-bilingual > .translate-bilingual-original,
  a.translate-bilingual > .translate-bilingual-original,
  em.translate-bilingual > .translate-bilingual-original,
  strong.translate-bilingual > .translate-bilingual-original {
    display: inline-block;
    margin-top: 0;
    margin-left: 4px;
    vertical-align: baseline;
  }
  /* Inline elements: parenthesized format for compact display */
  span.translate-bilingual > .translate-bilingual-original::before { content: '('; }
  span.translate-bilingual > .translate-bilingual-original::after { content: ')'; }
  a.translate-bilingual > .translate-bilingual-original::before { content: '('; }
  a.translate-bilingual > .translate-bilingual-original::after { content: ')'; }
  em.translate-bilingual > .translate-bilingual-original::before { content: '('; }
  em.translate-bilingual > .translate-bilingual-original::after { content: ')'; }
  strong.translate-bilingual > .translate-bilingual-original::before { content: '('; }
  strong.translate-bilingual > .translate-bilingual-original::after { content: ')'; }
  @media (prefers-color-scheme: dark) {
    .translate-bilingual-original {
      color: #9ca3af;
    }
  }

  /* Image Translation Overlay */
  .translate-image-overlay {
    pointer-events: none;
  }
  .translate-image-block {
    pointer-events: auto;
    cursor: help;
    transition: transform 0.1s ease;
  }
  .translate-image-block:hover {
    transform: scale(1.02);
    z-index: 1;
  }
`;
  document.head.appendChild(style);
}
