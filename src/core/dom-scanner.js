/**
 * DOM Scanner - Responsible for scanning DOM and collecting translatable nodes
 * 
 * Handles node collection, visibility checking, translation eligibility,
 * and Shadow DOM traversal for the content script.
 */

class DOMScanner {
  constructor(logger, security) {
    this.logger = logger;
    this.security = security;
    this.visibilityMap = new Map();
    
    // Constants
    this.SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
    this.STRUCTURAL_TAGS = new Set(['HTML', 'HEAD', 'BODY', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'SECTION', 'ARTICLE', 'ASIDE', 'DIV', 'SPAN']);
    this.TRANSLATABLE_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BUTTON', 'LABEL', 'OPTION', 'A']);
  }

  /**
   * Check if element is visible on screen
   * @param {Element} el - Element to check
   * @returns {boolean} - Whether element is visible
   */
  isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    
    // Check cache first
    if (this.visibilityMap.has(el)) {
      return this.visibilityMap.get(el);
    }
    
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    
    const visible = !(
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      rect.width === 0 ||
      rect.height === 0
    );
    
    // Cache result
    this.visibilityMap.set(el, visible);
    return visible;
  }

  /**
   * Check if node should be translated
   * @param {Node} node - Text node to check
   * @returns {boolean} - Whether node should be translated
   */
  shouldTranslate(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    
    const text = node.textContent?.trim();
    if (!text || text.length < 2) return false;
    
    const parent = node.parentElement;
    if (!parent) return false;
    
    // Skip certain tags
    if (this.SKIP_TAGS.has(parent.tagName)) return false;
    
    // Skip if parent is not visible
    if (!this.isVisible(parent)) return false;
    
    // Skip if already marked as translated
    if (this.isMarked(node)) return false;
    
    // Skip if marked as untranslatable
    if (parent.hasAttribute('data-qwen-no-translate')) return false;
    
    // Skip pure whitespace, numbers, or single characters
    if (/^\s*$/.test(text) || /^[\d\s\p{P}]+$/u.test(text)) return false;
    
    // Security check
    if (this.security && this.security.validateInput) {
      const validation = this.security.validateInput(text);
      if (!validation.valid) {
        this.security.logSecurityEvent('malicious_content_blocked', {
          issues: validation.issues,
          text: text.substring(0, 100),
        });
        return false;
      }
    }
    
    return true;
  }

  /**
   * Check if node is marked as translated
   * @param {Node} node - Node to check
   * @returns {boolean} - Whether node is marked
   */
  isMarked(node) {
    if (!node) return false;
    
    const parent = node.parentElement;
    if (!parent) return false;
    
    return parent.hasAttribute('data-qwen-translated') ||
           parent.classList.contains('qwen-translated');
  }

  /**
   * Mark node as translated
   * @param {Node} node - Node to mark
   */
  mark(node) {
    if (!node || !node.parentElement) return;
    
    const parent = node.parentElement;
    parent.setAttribute('data-qwen-translated', 'true');
    parent.classList.add('qwen-translated');
  }

  /**
   * Mark element as untranslatable
   * @param {Element} element - Element to mark
   */
  markUntranslatable(element) {
    if (!element) return;
    
    element.setAttribute('data-qwen-no-translate', 'true');
    element.classList.add('qwen-no-translate');
  }

  /**
   * Collect translatable text nodes from DOM tree
   * @param {Element} root - Root element to scan
   * @param {Node[]} out - Output array for collected nodes
   */
  collectNodes(root, out) {
    if (!root) return;
    
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          return this.shouldTranslate(node) ? 
            NodeFilter.FILTER_ACCEPT : 
            NodeFilter.FILTER_REJECT;
        }
      }
    );
    
    let node;
    while (node = walker.nextNode()) {
      out.push(node);
    }
  }

  /**
   * Scan DOM for translatable nodes
   * @param {Element} root - Root element to scan (defaults to document.body)
   * @returns {Node[]} - Array of translatable text nodes
   */
  scan(root = document.body) {
    const nodes = [];
    this.collectNodes(root, nodes);
    
    this.logger?.debug(`DOM scan found ${nodes.length} translatable nodes`);
    return nodes;
  }

  /**
   * Clear visibility cache
   */
  clearCache() {
    this.visibilityMap.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} - Cache stats
   */
  getCacheStats() {
    return {
      visibilityCacheSize: this.visibilityMap.size,
    };
  }
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOMScanner;
} else {
  self.qwenDOMScanner = DOMScanner;
}