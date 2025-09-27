if (typeof module !== 'undefined' && module.exports) {
  // Legacy API compatibility for existing tests
  let currentConfig = {};
  let controllerCount = 0;

  const setCurrentConfig = (config) => {
    currentConfig = config;
  };

  const collectNodes = (element, nodes) => {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.textContent.trim().length < 3) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tagName = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'template'].includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      nodes.push(node);
    }
  };

  const translateBatch = async (nodes) => {
    controllerCount++;
    // Mock translation for testing
    return Promise.resolve();
  };

  module.exports = {
    TranslationContentScript,
    loadCoreModules,
    replacePdfEmbeds,
    initializeExtension,
    setCurrentConfig,
    collectNodes,
    translateBatch,
    get __controllerCount() { return controllerCount; }
  };
}