/**
 * Translation Batcher - Responsible for batching and queueing translation requests
 * 
 * Handles text node batching, token counting, queue management, and translation
 * request coordination for optimal API usage.
 */

class TranslationBatcher {
  constructor(logger, config) {
    this.logger = logger;
    this.config = config;
    
    // Queue management
    this.batchQueue = [];
    this.pending = new Map();
    this.processing = false;
    
    // Timing and scheduling
    this.flushTimer = null;
    this.flushDelay = 100; // ms
    
    // Token and batch configuration
    this.defaultTokenBudget = 6000;
    this.maxTokenBudget = 12000;
    this.minBatchSize = 1;
    this.maxBatchSize = 50;
  }

  /**
   * Get dynamic token budget based on configuration
   * @returns {number} - Token budget for batching
   */
  getTokenBudget() {
    const configBudget = this.config?.tokenBudget;
    const dynamicBudget = window.qwenTranslateBatch?._getTokenBudget?.();
    
    return Math.min(
      configBudget || dynamicBudget || this.defaultTokenBudget,
      this.maxTokenBudget
    );
  }

  /**
   * Approximate token count for text
   * @param {string} text - Text to count tokens for
   * @returns {number} - Approximate token count
   */
  approxTokens(text) {
    if (window.qwenThrottle?.approxTokens) {
      return window.qwenThrottle.approxTokens(text);
    }
    
    // Fallback: roughly 4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Batch text nodes by token budget
   * @param {Node[]} nodes - Array of text nodes to batch
   * @returns {Node[][]} - Array of batches
   */
  batchNodes(nodes) {
    const maxTokens = this.getTokenBudget();
    const batches = [];
    let current = [];
    let tokens = 0;
    const textMap = new Map(); // Deduplication
    
    for (const node of nodes) {
      const text = node.textContent?.trim();
      if (!text) continue;
      
      // Skip if we've seen this text before in current batch
      if (textMap.has(text)) {
        textMap.get(text).push(node);
        continue;
      }
      
      const nodeTokens = this.approxTokens(text);
      
      // Start new batch if adding this node would exceed budget
      if (tokens + nodeTokens > maxTokens && current.length > 0) {
        batches.push(current);
        current = [];
        tokens = 0;
        textMap.clear();
      }
      
      // Add node to current batch
      current.push(node);
      textMap.set(text, [node]);
      tokens += nodeTokens;
      
      // Create batch if we've reached max size
      if (current.length >= this.maxBatchSize) {
        batches.push(current);
        current = [];
        tokens = 0;
        textMap.clear();
      }
    }
    
    // Add final batch if not empty
    if (current.length > 0) {
      batches.push(current);
    }
    
    this.logger?.debug(`Batched ${nodes.length} nodes into ${batches.length} batches`, {
      totalNodes: nodes.length,
      batchCount: batches.length,
      tokenBudget: maxTokens,
      avgBatchSize: batches.length > 0 ? nodes.length / batches.length : 0,
    });
    
    return batches;
  }

  /**
   * Enqueue batch for processing
   * @param {Node[]} batch - Batch of nodes to enqueue
   */
  enqueueBatch(batch) {
    if (!batch || batch.length === 0) return;
    
    const batchItem = {
      nodes: batch,
      enqueued: Date.now(),
      id: this.generateBatchId(),
    };
    
    this.batchQueue.push(batchItem);
    
    this.logger?.debug(`Enqueued batch ${batchItem.id} with ${batch.length} nodes`);
    
    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * Generate unique batch ID
   * @returns {string} - Unique batch identifier
   */
  generateBatchId() {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add nodes to pending queue with debounced flush
   * @param {Node[]} nodes - Nodes to add to pending queue
   */
  addToPending(nodes) {
    for (const node of nodes) {
      const text = node.textContent?.trim();
      if (text) {
        if (!this.pending.has(text)) {
          this.pending.set(text, []);
        }
        this.pending.get(text).push(node);
      }
    }
    
    // Schedule flush
    this.scheduleFlush();
  }

  /**
   * Schedule pending queue flush
   */
  scheduleFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    
    this.flushTimer = setTimeout(() => {
      this.flushPending();
      this.flushTimer = null;
    }, this.flushDelay);
  }

  /**
   * Flush pending nodes into batches
   */
  flushPending() {
    if (this.pending.size === 0) return;
    
    // Convert pending map to flat array of nodes
    const allNodes = [];
    for (const nodeList of this.pending.values()) {
      allNodes.push(...nodeList);
    }
    
    // Clear pending
    this.pending.clear();
    
    // Create batches and enqueue them
    const batches = this.batchNodes(allNodes);
    for (const batch of batches) {
      this.enqueueBatch(batch);
    }
    
    this.logger?.debug(`Flushed ${allNodes.length} pending nodes into ${batches.length} batches`);
  }

  /**
   * Process the batch queue
   * @returns {Promise<void>}
   */
  async processQueue() {
    if (this.processing) return;
    
    this.processing = true;
    this.logger?.debug('Starting batch queue processing');
    
    while (this.batchQueue.length > 0) {
      const batchItem = this.batchQueue.shift();
      const queueLatency = Date.now() - batchItem.enqueued;
      
      this.logger?.debug(`Processing batch ${batchItem.id}, queue latency: ${queueLatency}ms`);
      
      try {
        // This would be handled by TranslationProcessor
        await this.processBatch(batchItem);
      } catch (error) {
        this.logger?.error(`Batch ${batchItem.id} failed:`, error);
        
        // Re-queue batch with exponential backoff
        batchItem.retryCount = (batchItem.retryCount || 0) + 1;
        if (batchItem.retryCount < 3) {
          const delay = Math.pow(2, batchItem.retryCount) * 1000;
          setTimeout(() => {
            batchItem.enqueued = Date.now();
            this.batchQueue.push(batchItem);
          }, delay);
        } else {
          this.logger?.error(`Batch ${batchItem.id} exceeded retry limit, dropping`);
        }
      }
    }
    
    this.processing = false;
    this.logger?.debug('Batch queue processing complete');
  }

  /**
   * Process individual batch (placeholder for TranslationProcessor integration)
   * @param {Object} batchItem - Batch item to process
   * @returns {Promise<void>}
   */
  async processBatch(batchItem) {
    // This will be implemented by TranslationProcessor
    // For now, just log the batch
    this.logger?.debug(`Processing batch ${batchItem.id} with ${batchItem.nodes.length} nodes`);
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Stop processing and clear queues
   */
  stop() {
    this.processing = false;
    this.batchQueue.length = 0;
    this.pending.clear();
    
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    this.logger?.debug('Translation batcher stopped');
  }

  /**
   * Get queue statistics
   * @returns {Object} - Queue statistics
   */
  getStats() {
    return {
      queueLength: this.batchQueue.length,
      pendingNodes: Array.from(this.pending.values()).flat().length,
      processing: this.processing,
      tokenBudget: this.getTokenBudget(),
      flushDelay: this.flushDelay,
    };
  }

  /**
   * Update configuration
   * @param {Object} newConfig - New configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    if (newConfig.flushDelay !== undefined) {
      this.flushDelay = newConfig.flushDelay;
    }
    
    this.logger?.debug('Translation batcher config updated', newConfig);
  }
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TranslationBatcher;
} else {
  self.qwenTranslationBatcher = TranslationBatcher;
}