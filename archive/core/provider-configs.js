/**
 * @fileoverview Provider-specific configuration definitions and defaults
 * Centralizes provider configuration schemas and default values
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenProviderConfigs = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Qwen/DashScope provider configuration
   */
  const QWEN_CONFIG = {
    name: 'qwen',
    label: 'Alibaba Qwen MT',
    defaults: {
      apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
      model: 'qwen-mt-turbo',
      requestLimit: 60,
      tokenLimit: 100000,
      charLimit: 0,
      strategy: 'balanced',
      costPerInputToken: 0.0002 / 1000,  // $0.0002 per 1K tokens
      costPerOutputToken: 0.0002 / 1000,
      weight: 1.0
    },
    models: [
      { id: 'qwen-mt-turbo', name: 'Qwen MT Turbo', tokenLimit: 31980 },
      { id: 'qwen-mt-plus', name: 'Qwen MT Plus', tokenLimit: 23797 }
    ],
    capabilities: ['streaming', 'batch', 'language_detection'],
    validation: {
      apiKey: { pattern: /^[a-zA-Z0-9_-]+$/, minLength: 20 },
      apiEndpoint: { pattern: /^https:\/\/dashscope.*\.aliyuncs\.com/ }
    }
  };

  /**
   * OpenAI provider configuration
   */
  const OPENAI_CONFIG = {
    name: 'openai',
    label: 'OpenAI GPT',
    defaults: {
      apiEndpoint: 'https://api.openai.com/v1',
      model: 'gpt-3.5-turbo',
      requestLimit: 3500,
      tokenLimit: 90000,
      charLimit: 0,
      strategy: 'quality',
      costPerInputToken: 0.0005 / 1000,  // $0.0005 per 1K tokens
      costPerOutputToken: 0.0015 / 1000,  // $0.0015 per 1K tokens
      weight: 0.8
    },
    models: [
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', tokenLimit: 4096 },
      { id: 'gpt-4', name: 'GPT-4', tokenLimit: 8192 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', tokenLimit: 128000 },
      { id: 'gpt-4o', name: 'GPT-4o', tokenLimit: 128000 }
    ],
    capabilities: ['streaming', 'multiple_models', 'custom_prompts'],
    validation: {
      apiKey: { pattern: /^sk-/, minLength: 20 },
      apiEndpoint: { pattern: /^https:\/\/api\.openai\.com/ }
    }
  };

  /**
   * Anthropic Claude provider configuration
   */
  const ANTHROPIC_CONFIG = {
    name: 'anthropic',
    label: 'Anthropic Claude',
    defaults: {
      apiEndpoint: 'https://api.anthropic.com/v1',
      model: 'claude-3-haiku-20240307',
      requestLimit: 1000,
      tokenLimit: 40000,
      charLimit: 0,
      strategy: 'quality',
      costPerInputToken: 0.00025 / 1000,  // $0.00025 per 1K tokens (Haiku)
      costPerOutputToken: 0.00125 / 1000,  // $0.00125 per 1K tokens (Haiku)
      weight: 0.7
    },
    models: [
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', tokenLimit: 200000 },
      { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', tokenLimit: 200000 },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', tokenLimit: 200000 },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', tokenLimit: 200000 }
    ],
    capabilities: ['streaming', 'multiple_models', 'custom_prompts'],
    validation: {
      apiKey: { pattern: /^sk-ant-[a-zA-Z0-9_-]+$/, minLength: 50 },
      apiEndpoint: { pattern: /^https:\/\/api\.anthropic\.com/ }
    }
  };

  /**
   * Google Translate provider configuration
   */
  const GOOGLE_CONFIG = {
    name: 'google',
    label: 'Google Translate',
    defaults: {
      apiEndpoint: 'https://translation.googleapis.com/language/translate/v2',
      requestLimit: 100,
      tokenLimit: 0, // Character-based pricing
      charLimit: 500000, // ~500K characters per month free tier
      strategy: 'fast',
      costPerInputToken: 0, // Different pricing model
      costPerOutputToken: 0,
      weight: 0.6
    },
    models: [
      { id: 'nmt', name: 'Neural Machine Translation', tokenLimit: 0 }
    ],
    capabilities: ['batch', 'language_detection'],
    validation: {
      apiKey: { pattern: /^[a-zA-Z0-9_-]+$/, minLength: 30 },
      apiEndpoint: { pattern: /^https:\/\/translation\.googleapis\.com/ }
    }
  };

  /**
   * DeepL provider configuration
   */
  const DEEPL_CONFIG = {
    name: 'deepl',
    label: 'DeepL Translator',
    defaults: {
      apiEndpoint: 'https://api-free.deepl.com/v2/translate',
      requestLimit: 500,
      tokenLimit: 0, // Character-based pricing
      charLimit: 500000, // Free tier limit
      strategy: 'quality',
      costPerInputToken: 0, // Different pricing model
      costPerOutputToken: 0,
      weight: 0.9
    },
    models: [
      { id: 'deepl', name: 'DeepL Neural Network', tokenLimit: 0 }
    ],
    capabilities: ['batch', 'high_quality'],
    validation: {
      apiKey: { pattern: /^[a-zA-Z0-9_-]+:fx$/, minLength: 30 },
      apiEndpoint: { pattern: /^https:\/\/api.*\.deepl\.com/ }
    }
  };

  /**
   * Provider registry mapping
   */
  const PROVIDER_CONFIGS = {
    qwen: QWEN_CONFIG,
    openai: OPENAI_CONFIG,
    anthropic: ANTHROPIC_CONFIG,
    google: GOOGLE_CONFIG,
    deepl: DEEPL_CONFIG
  };

  /**
   * Get provider configuration by ID
   */
  function getProviderConfig(providerId) {
    return PROVIDER_CONFIGS[providerId] || null;
  }

  /**
   * Get all available provider configurations
   */
  function getAllProviderConfigs() {
    return { ...PROVIDER_CONFIGS };
  }

  /**
   * Get provider default configuration
   */
  function getProviderDefaults(providerId) {
    const config = getProviderConfig(providerId);
    return config ? config.defaults : {};
  }

  /**
   * Get supported models for provider
   */
  function getProviderModels(providerId) {
    const config = getProviderConfig(providerId);
    return config ? config.models : [];
  }

  /**
   * Get provider capabilities
   */
  function getProviderCapabilities(providerId) {
    const config = getProviderConfig(providerId);
    return config ? config.capabilities : [];
  }

  /**
   * Validate provider-specific field
   */
  function validateProviderField(providerId, fieldName, value) {
    const config = getProviderConfig(providerId);
    if (!config || !config.validation || !config.validation[fieldName]) {
      return true; // No validation rule, assume valid
    }

    const validation = config.validation[fieldName];
    
    if (validation.pattern && !validation.pattern.test(value)) {
      return false;
    }
    
    if (validation.minLength && value.length < validation.minLength) {
      return false;
    }
    
    if (validation.maxLength && value.length > validation.maxLength) {
      return false;
    }
    
    return true;
  }

  /**
   * Get recommended provider order based on capabilities and cost
   */
  function getRecommendedProviderOrder() {
    return [
      'qwen',      // Primary - cost-effective, fast
      'deepl',     // High quality for European languages
      'google',    // Fast, broad language support
      'openai',    // High quality, higher cost
      'anthropic'  // Premium quality, highest cost
    ];
  }

  /**
   * Get provider by strategy preference
   */
  function getProvidersByStrategy(strategy) {
    const providers = Object.values(PROVIDER_CONFIGS);
    
    switch (strategy) {
      case 'cheap':
        return providers.sort((a, b) => 
          (a.defaults.costPerInputToken + a.defaults.costPerOutputToken) - 
          (b.defaults.costPerInputToken + b.defaults.costPerOutputToken)
        ).map(p => p.name);
        
      case 'fast':
        return providers
          .filter(p => p.capabilities.includes('streaming') || p.capabilities.includes('batch'))
          .sort((a, b) => b.defaults.requestLimit - a.defaults.requestLimit)
          .map(p => p.name);
          
      case 'quality':
        return providers
          .sort((a, b) => b.defaults.weight - a.defaults.weight)
          .map(p => p.name);
          
      case 'balanced':
      default:
        return getRecommendedProviderOrder();
    }
  }

  return {
    PROVIDER_CONFIGS,
    QWEN_CONFIG,
    OPENAI_CONFIG,
    ANTHROPIC_CONFIG,
    GOOGLE_CONFIG,
    DEEPL_CONFIG,
    getProviderConfig,
    getAllProviderConfigs,
    getProviderDefaults,
    getProviderModels,
    getProviderCapabilities,
    validateProviderField,
    getRecommendedProviderOrder,
    getProvidersByStrategy
  };

}));