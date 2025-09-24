/**
 * Local Model Manager for Hunyuan-MT-7B using llama.cpp
 * Handles model download, loading, and translation with memory efficiency
 */

class LocalModelManager {
  constructor() {
    this.isInitialized = false;
    this.modelLoaded = false;
    this.llamaCppInstance = null;
    this.modelPath = null;
    this.downloadProgress = 0;
    this.isDownloading = false;
    this.modelWorker = null;
    this.requestQueue = [];
    this.isProcessing = false;

    // Memory management
    this.maxConcurrentRequests = 1; // Process one request at a time to save memory
    this.lastUsed = Date.now();
    this.unloadTimeout = 5 * 60 * 1000; // Unload model after 5 minutes of inactivity
    this.unloadTimer = null;

    this.init();
  }

  async init() {
    try {
      // Check if model exists in storage
      const modelStatus = await this.getModelStatus();
      if (modelStatus.downloaded) {
        console.log('[LocalModel] Model already downloaded');
        this.modelPath = modelStatus.path;
      }

      this.isInitialized = true;
    } catch (error) {
      console.error('[LocalModel] Initialization failed:', error);
    }
  }

  async getModelStatus() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['localModel'], (result) => {
        const modelData = result.localModel || {};
        resolve({
          downloaded: modelData.downloaded || false,
          path: modelData.path || null,
          size: modelData.size || 0,
          downloadedAt: modelData.downloadedAt || null
        });
      });
    });
  }

  async downloadModel(onProgress = null) {
    if (this.isDownloading) {
      throw new Error('Model download already in progress');
    }

    this.isDownloading = true;
    this.downloadProgress = 0;

    try {
      const provider = PROVIDERS['hunyuan-local'];
      const response = await fetch(provider.downloadUrl);

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      const contentLength = parseInt(response.headers.get('content-length'), 10);
      const reader = response.body.getReader();

      // Create array to store chunks
      const chunks = [];
      let receivedLength = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        chunks.push(value);
        receivedLength += value.length;

        this.downloadProgress = (receivedLength / contentLength) * 100;

        if (onProgress) {
          onProgress(this.downloadProgress, receivedLength, contentLength);
        }
      }

      // Combine chunks into single Uint8Array
      const modelData = new Uint8Array(receivedLength);
      let position = 0;
      for (const chunk of chunks) {
        modelData.set(chunk, position);
        position += chunk.length;
      }

      // Store model in IndexedDB for persistence
      await this.storeModel(modelData);

      // Save model status
      await new Promise((resolve) => {
        chrome.storage.local.set({
          localModel: {
            downloaded: true,
            path: 'indexeddb://hunyuan-mt-model',
            size: receivedLength,
            downloadedAt: new Date().toISOString()
          }
        }, resolve);
      });

      this.modelPath = 'indexeddb://hunyuan-mt-model';
      console.log('[LocalModel] Model downloaded successfully');

    } catch (error) {
      console.error('[LocalModel] Download failed:', error);
      throw error;
    } finally {
      this.isDownloading = false;
    }
  }

  async storeModel(modelData) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('LocalModelDB', 1);

      request.onerror = () => reject(request.error);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('models')) {
          db.createObjectStore('models', { keyPath: 'name' });
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['models'], 'readwrite');
        const store = transaction.objectStore('models');

        store.put({
          name: 'hunyuan-mt-model',
          data: modelData,
          timestamp: Date.now()
        });

        transaction.oncomplete = () => {
          db.close();
          resolve();
        };

        transaction.onerror = () => reject(transaction.error);
      };
    });
  }

  async loadModel() {
    if (this.modelLoaded) return;

    if (!this.modelPath) {
      throw new Error('Model not downloaded. Please download the model first.');
    }

    try {
      // Load model data from IndexedDB
      const modelData = await this.retrieveModel();

      // Initialize llama.cpp in a worker to avoid blocking main thread
      this.modelWorker = new Worker(chrome.runtime.getURL('llamacpp-worker.js'));

      // Load model in worker
      await new Promise((resolve, reject) => {
        this.modelWorker.onmessage = (event) => {
          if (event.data.type === 'modelLoaded') {
            this.modelLoaded = true;
            this.lastUsed = Date.now();
            this.scheduleUnload();
            resolve();
          } else if (event.data.type === 'error') {
            reject(new Error(event.data.message));
          }
        };

        this.modelWorker.postMessage({
          type: 'loadModel',
          modelData: modelData
        });
      });

      console.log('[LocalModel] Model loaded successfully');
    } catch (error) {
      console.error('[LocalModel] Failed to load model:', error);
      throw error;
    }
  }

  async retrieveModel() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('LocalModelDB', 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['models'], 'readonly');
        const store = transaction.objectStore('models');
        const getRequest = store.get('hunyuan-mt-model');

        getRequest.onsuccess = () => {
          if (getRequest.result) {
            resolve(getRequest.result.data);
          } else {
            reject(new Error('Model not found in storage'));
          }
        };

        getRequest.onerror = () => reject(getRequest.error);
      };
    });
  }

  async translate(text, sourceLanguage, targetLanguage) {
    if (!this.modelLoaded) {
      await this.loadModel();
    }

    this.lastUsed = Date.now();
    this.scheduleUnload();

    return new Promise((resolve, reject) => {
      const requestId = Date.now() + Math.random();

      const timeout = setTimeout(() => {
        reject(new Error('Translation request timed out'));
      }, 30000); // 30 second timeout

      this.modelWorker.onmessage = (event) => {
        if (event.data.requestId === requestId) {
          clearTimeout(timeout);

          if (event.data.type === 'translationComplete') {
            resolve({
              text: event.data.translatedText,
              sourceLanguage: sourceLanguage,
              targetLanguage: targetLanguage
            });
          } else if (event.data.type === 'error') {
            reject(new Error(event.data.message));
          }
        }
      };

      // Create translation prompt for Hunyuan-MT
      const prompt = this.createTranslationPrompt(text, sourceLanguage, targetLanguage);

      this.modelWorker.postMessage({
        type: 'translate',
        requestId: requestId,
        prompt: prompt,
        maxTokens: Math.min(2048, text.length * 2) // Reasonable max tokens based on input length
      });
    });
  }

  createTranslationPrompt(text, sourceLanguage, targetLanguage) {
    const srcLang = sourceLanguage === 'auto' ? 'automatically detected language' : sourceLanguage;

    // Optimized prompt for Hunyuan-MT model
    return `<|im_start|>user
Translate the following text from ${srcLang} to ${targetLanguage}. Return only the translated text without any explanations or additional content.

Text to translate: ${text}<|im_end|>
<|im_start|>assistant
`;
  }

  scheduleUnload() {
    // Clear existing timer
    if (this.unloadTimer) {
      clearTimeout(this.unloadTimer);
    }

    // Schedule model unload after period of inactivity
    this.unloadTimer = setTimeout(() => {
      this.unloadModel();
    }, this.unloadTimeout);
  }

  async unloadModel() {
    if (!this.modelLoaded) return;

    try {
      if (this.modelWorker) {
        this.modelWorker.terminate();
        this.modelWorker = null;
      }

      this.modelLoaded = false;
      console.log('[LocalModel] Model unloaded to free memory');
    } catch (error) {
      console.error('[LocalModel] Error unloading model:', error);
    }
  }

  async deleteModel() {
    await this.unloadModel();

    // Clear from IndexedDB
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('LocalModelDB', 1);

      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['models'], 'readwrite');
        const store = transaction.objectStore('models');

        store.delete('hunyuan-mt-model');

        transaction.oncomplete = () => {
          // Clear storage
          chrome.storage.local.remove(['localModel'], () => {
            this.modelPath = null;
            console.log('[LocalModel] Model deleted successfully');
            resolve();
          });
        };

        transaction.onerror = () => reject(transaction.error);
      };
    });
  }

  getDownloadProgress() {
    return {
      isDownloading: this.isDownloading,
      progress: this.downloadProgress
    };
  }

  isModelAvailable() {
    return this.modelPath !== null;
  }

  isModelReady() {
    return this.modelLoaded;
  }
}

// Create singleton instance
const localModelManager = new LocalModelManager();

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocalModelManager;
} else if (typeof window !== 'undefined') {
  window.LocalModelManager = LocalModelManager;
  window.localModelManager = localModelManager;
}