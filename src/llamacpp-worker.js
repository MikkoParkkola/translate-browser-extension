/**
 * Web Worker for running llama.cpp model inference
 * Handles model loading and translation in separate thread to avoid blocking UI
 */

// Import llama.cpp WASM module (we'll need to include this)
importScripts('llama.cpp.js');

class LlamaCppWorker {
  constructor() {
    this.model = null;
    this.isModelLoaded = false;
    this.context = null;
  }

  async loadModel(modelData) {
    try {
      // Initialize llama.cpp with the model data
      const Module = await createLlamaModule();

      // Convert model data to format expected by llama.cpp
      const modelFile = new Uint8Array(modelData);

      // Mount the model file in the WASM filesystem
      Module.FS.writeFile('/model.gguf', modelFile);

      // Initialize model parameters
      const modelParams = Module.llama_model_default_params();
      modelParams.n_gpu_layers = 0; // CPU-only for browser compatibility

      // Load model
      this.model = Module.llama_load_model_from_file('/model.gguf', modelParams);

      if (!this.model) {
        throw new Error('Failed to load model');
      }

      // Initialize context parameters
      const contextParams = Module.llama_context_default_params();
      contextParams.seed = -1; // Random seed
      contextParams.n_ctx = 2048; // Context size
      contextParams.n_threads = Math.min(navigator.hardwareConcurrency || 4, 4); // Limit threads for browser

      // Create context
      this.context = Module.llama_new_context_with_model(this.model, contextParams);

      if (!this.context) {
        throw new Error('Failed to create context');
      }

      this.isModelLoaded = true;
      console.log('[Worker] Model loaded successfully');

      postMessage({ type: 'modelLoaded' });

    } catch (error) {
      console.error('[Worker] Failed to load model:', error);
      postMessage({
        type: 'error',
        message: `Failed to load model: ${error.message}`
      });
    }
  }

  async translate(prompt, maxTokens, requestId) {
    if (!this.isModelLoaded) {
      postMessage({
        type: 'error',
        requestId: requestId,
        message: 'Model not loaded'
      });
      return;
    }

    try {
      const Module = this.getModule();

      // Tokenize the prompt
      const tokens = Module.llama_tokenize(this.context, prompt, true, true);

      if (tokens.length === 0) {
        throw new Error('Failed to tokenize prompt');
      }

      // Start generation
      let generatedText = '';
      let totalTokens = 0;

      // Process existing tokens
      const n_past = 0;
      const result = Module.llama_decode(this.context, Module.llama_batch_get_one(tokens, n_past, 0));

      if (result !== 0) {
        throw new Error(`Failed to process prompt: ${result}`);
      }

      // Generate tokens one by one
      for (let i = 0; i < maxTokens; i++) {
        // Sample next token
        const token = Module.llama_sample_token_greedy(this.context, null);

        // Check for end of generation
        if (Module.llama_token_is_eog(this.model, token)) {
          break;
        }

        // Convert token to text
        const tokenStr = Module.llama_token_to_piece(this.context, token);
        generatedText += tokenStr;

        // Check if we've reached a natural stopping point (sentence end)
        if (tokenStr.includes('.') || tokenStr.includes('!') || tokenStr.includes('?')) {
          // Check if we have reasonable length translation
          if (generatedText.trim().length > 10) {
            break;
          }
        }

        // Prepare for next iteration
        const nextTokens = [token];
        const nextResult = Module.llama_decode(this.context, Module.llama_batch_get_one(nextTokens, tokens.length + i, 0));

        if (nextResult !== 0) {
          console.warn('[Worker] Decode warning:', nextResult);
          break;
        }

        totalTokens++;

        // Prevent runaway generation
        if (totalTokens > maxTokens * 2) {
          break;
        }
      }

      // Clean up the generated text
      const cleanedText = this.cleanTranslationOutput(generatedText);

      postMessage({
        type: 'translationComplete',
        requestId: requestId,
        translatedText: cleanedText,
        tokensGenerated: totalTokens
      });

    } catch (error) {
      console.error('[Worker] Translation failed:', error);
      postMessage({
        type: 'error',
        requestId: requestId,
        message: `Translation failed: ${error.message}`
      });
    }
  }

  cleanTranslationOutput(text) {
    // Remove common artifacts from model output
    let cleaned = text.trim();

    // Remove any remaining prompt artifacts
    cleaned = cleaned.replace(/^.*<\|im_start\|>.*<\|im_end\|>/s, '');
    cleaned = cleaned.replace(/^.*assistant\s*/i, '');

    // Remove trailing incomplete sentences
    const sentences = cleaned.split(/[.!?]/);
    if (sentences.length > 1 && sentences[sentences.length - 1].trim().length < 5) {
      sentences.pop();
      cleaned = sentences.join('.') + (sentences.length > 0 ? '.' : '');
    }

    // Remove excessive whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }

  getModule() {
    // Access the llama.cpp module instance
    return Module || window.Module;
  }

  cleanup() {
    if (this.context) {
      const Module = this.getModule();
      Module.llama_free(this.context);
      this.context = null;
    }

    if (this.model) {
      const Module = this.getModule();
      Module.llama_free_model(this.model);
      this.model = null;
    }

    this.isModelLoaded = false;
  }
}

// Worker message handler
const worker = new LlamaCppWorker();

self.onmessage = async function(event) {
  const { type, requestId } = event.data;

  try {
    switch (type) {
      case 'loadModel':
        await worker.loadModel(event.data.modelData);
        break;

      case 'translate':
        await worker.translate(event.data.prompt, event.data.maxTokens, requestId);
        break;

      case 'cleanup':
        worker.cleanup();
        postMessage({ type: 'cleanupComplete', requestId });
        break;

      default:
        postMessage({
          type: 'error',
          requestId: requestId,
          message: `Unknown message type: ${type}`
        });
    }
  } catch (error) {
    console.error('[Worker] Error handling message:', error);
    postMessage({
      type: 'error',
      requestId: requestId,
      message: error.message
    });
  }
};

// Handle worker termination
self.onclose = function() {
  worker.cleanup();
};