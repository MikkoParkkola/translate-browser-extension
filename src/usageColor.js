;(function(root){
  function usageColor(ratio){
    const r = Math.max(0, Math.min(1, ratio || 0));
    if (r > 0.8){
      const t = Math.min((r - 0.8) / 0.2, 1);
      return `hsl(0, 70%, ${45 - t * 10}%)`;
    }
    if (r > 0.5){
      const t = (r - 0.5) / 0.3;
      return `hsl(60, 80%, ${40 + t * 10}%)`;
    }
    const t = r / 0.5;
    return `hsl(120, 70%, ${35 + t * 10}%)`;
  }
  if (typeof module !== 'undefined') {
    module.exports = usageColor;
  }
  root.qwenUsageColor = usageColor;
})(typeof self !== 'undefined' ? self : this);
