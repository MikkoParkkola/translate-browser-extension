/**
 * Provider Manager - Intelligent provider selection and management system
 *
 * Handles provider registration, health monitoring, load balancing, and smart
 * selection based on cost, speed, quality, and availability requirements.
 *
 * @author Backend Systems Lead
 * @version 1.0.0
 */

import { Logger } from '../lib/logger.js';

/**
 * @typedef {Object} Provider
 * @property {string} id - Unique provider identifier
 * @property {string} name - Human-readable provider name
 * @property {'ai-mt'|'traditional-mt'} type - Provider type
 * @property {string} endpoint - API endpoint URL
 * @property {string[]} features - Supported features
 * @property {Object} limits - Rate limits and quotas
 * @property {string[]} languages - Supported language codes
 * @property {number} priority - Selection priority (1=highest)
 * @property {boolean} enabled - Whether provider is enabled
 * @property {Function} translate - Translation function
 * @property {Function} [translateBatch] - Batch translation function
 * @property {boolean} [supportsBatch] - Whether batch translation is supported
 */

/**
 * @typedef {Object} ProviderHealth
 * @property {string} id - Provider ID
 * @property {boolean} healthy - Whether provider is healthy
 * @property {number} responseTime - Average response time in ms
 * @property {number} successRate - Success rate (0-1)
 * @property {string} [error] - Last error message if unhealthy
 * @property {number} lastChecked - Last health check timestamp
 */

/**
 * @typedef {Object} SelectionCriteria
 * @property {number} textLength - Length of text to translate
 * @property {'smart'|'fast'|'quality'} strategy - Selection strategy
 * @property {string} [sourceLanguage] - Source language code
 * @property {string} targetLanguage - Target language code
 * @property {number} [batchSize] - Number of texts in batch
 * @property {number} [maxCost] - Maximum acceptable cost
 * @property {number} [maxResponseTime] - Maximum acceptable response time
 */

class ProviderManager {
    /**
     * Initialize provider manager
     */
    constructor() {
        this.logger = Logger.create('provider-manager');

        /** @type {Map<string, Provider>} */
        this.providers = new Map();

        /** @type {Map<string, ProviderHealth>} */
        this.healthStatus = new Map();

        /** @type {Map<string, Array>} */
        this.performanceHistory = new Map();

        /** @type {boolean} */
        this.isInitialized = false;

        /** @type {number} */
        this.healthCheckInterval = 300000; // 5 minutes

        /** @type {number} */
        this.healthCheckTimer = null;

        // Provider selection weights
        this.selectionWeights = {
            health: 0.3,
            cost: 0.25,
            speed: 0.25,
            quality: 0.2
        };

        // Strategy-specific weight adjustments
        this.strategyWeights = {
            fast: { speed: 0.5, health: 0.3, cost: 0.1, quality: 0.1 },
            quality: { quality: 0.5, health: 0.3, speed: 0.1, cost: 0.1 },
            smart: { health: 0.3, cost: 0.25, speed: 0.25, quality: 0.2 }
        };
    }

    /**
     * Initialize provider manager and start health monitoring
     */
    async initialize() {
        try {
            await this._loadProviderConfigurations();
            await this._performInitialHealthChecks();
            this._startHealthMonitoring();

            this.isInitialized = true;
            this.logger.info('Provider manager initialized', { providerCount: this.providers.size });
        } catch (error) {
            this.logger.error('Failed to initialize provider manager', { error: error.message });
            throw new Error(`Provider manager initialization failed: ${error.message}`);
        }
    }

    /**
     * Register a translation provider
     * @param {Provider} provider - Provider configuration
     */
    registerProvider(provider) {
        if (!provider || !provider.id || !provider.translate) {
            throw new Error('Invalid provider configuration');
        }

        // Validate required properties
        const requiredProps = ['id', 'name', 'type', 'endpoint', 'features', 'limits', 'languages', 'priority'];
        for (const prop of requiredProps) {
            if (!(prop in provider)) {
                throw new Error(`Provider missing required property: ${prop}`);
            }
        }

        // Set default values
        const providerConfig = {
            enabled: true,
            supportsBatch: false,
            ...provider
        };

        this.providers.set(provider.id, providerConfig);

        // Initialize health status
        this.healthStatus.set(provider.id, {
            id: provider.id,
            healthy: true,
            responseTime: 0,
            successRate: 1,
            lastChecked: Date.now()
        });

        // Initialize performance history
        this.performanceHistory.set(provider.id, []);

        this.logger.info('Provider registered', { name: provider.name, id: provider.id });
    }

    /**
     * Get provider by ID
     * @param {string} providerId - Provider ID
     * @returns {Provider|null}
     */
    getProvider(providerId) {
        return this.providers.get(providerId) || null;
    }

    /**
     * Get all registered providers
     * @returns {Provider[]}
     */
    getAllProviders() {
        return Array.from(this.providers.values());
    }

    /**
     * Get enabled providers only
     * @returns {Provider[]}
     */
    getEnabledProviders() {
        return Array.from(this.providers.values()).filter(provider => provider.enabled);
    }

    /**
     * Select optimal provider based on criteria and strategy
     * @param {SelectionCriteria} criteria - Selection criteria
     * @returns {Promise<Provider|null>}
     */
    async selectProvider(criteria) {
        if (!this.isInitialized) {
            throw new Error('Provider manager not initialized');
        }

        const enabledProviders = this.getEnabledProviders();
        if (enabledProviders.length === 0) {
            return null;
        }

        // Filter providers by capability
        const capableProviders = enabledProviders.filter(provider =>
            this._isProviderCapable(provider, criteria)
        );

        if (capableProviders.length === 0) {
            this.logger.warn('No capable providers found for criteria', { criteria });
            return null;
        }

        // Get strategy-specific weights
        const weights = this.strategyWeights[criteria.strategy] || this.selectionWeights;

        // Score each provider
        const providerScores = await Promise.all(
            capableProviders.map(async provider => {
                const score = await this._scoreProvider(provider, criteria, weights);
                return { provider, score };
            })
        );

        // Sort by score (highest first)
        providerScores.sort((a, b) => b.score - a.score);

        const selectedProvider = providerScores[0]?.provider;

        if (selectedProvider) {
            this.logger.info('Selected provider', { name: selectedProvider.name, score: providerScores[0].score.toFixed(3) });
        }

        return selectedProvider;
    }

    /**
     * Check if provider is capable of handling the request
     * @private
     */
    _isProviderCapable(provider, criteria) {
        // Check language support
        if (criteria.sourceLanguage && criteria.sourceLanguage !== 'auto') {
            if (!provider.languages.includes(criteria.sourceLanguage)) {
                return false;
            }
        }

        if (!provider.languages.includes(criteria.targetLanguage)) {
            return false;
        }

        // Check health status
        const health = this.healthStatus.get(provider.id);
        if (!health?.healthy) {
            return false;
        }

        // Check basic availability
        return provider.enabled;
    }

    /**
     * Score provider based on criteria and weights
     * @private
     */
    async _scoreProvider(provider, criteria, weights) {
        const health = this.healthStatus.get(provider.id);
        const history = this.performanceHistory.get(provider.id) || [];

        // Health score (0-1)
        const healthScore = health.healthy ? Math.min(health.successRate, 1) : 0;

        // Speed score (0-1, lower response time = higher score)
        const avgResponseTime = history.length > 0
            ? history.reduce((sum, record) => sum + record.responseTime, 0) / history.length
            : health.responseTime || 1000;
        const speedScore = Math.max(0, 1 - (avgResponseTime / 10000)); // Normalize to 10s max

        // Cost score (0-1, lower cost = higher score)
        const estimatedCost = this._estimateCost(provider, criteria.textLength);
        const maxExpectedCost = 0.1; // $0.10 per request maximum
        const costScore = Math.max(0, 1 - (estimatedCost / maxExpectedCost));

        // Quality score (0-1, based on provider type and features)
        const qualityScore = this._calculateQualityScore(provider);

        // Priority bonus (higher priority = higher score)
        const priorityBonus = (5 - Math.min(provider.priority, 5)) * 0.1;

        // Calculate weighted score
        const weightedScore =
            (healthScore * weights.health) +
            (speedScore * weights.speed) +
            (costScore * weights.cost) +
            (qualityScore * weights.quality) +
            priorityBonus;

        return Math.max(0, Math.min(1, weightedScore));
    }

    /**
     * Calculate quality score based on provider characteristics
     * @private
     */
    _calculateQualityScore(provider) {
        let score = 0.5; // Base score

        // AI-based models typically have higher quality
        if (provider.type === 'ai-mt') {
            score += 0.2;
        }

        // Certain features indicate higher quality
        if (provider.features.includes('high-quality')) {
            score += 0.2;
        }
        if (provider.features.includes('highest-quality')) {
            score += 0.3;
        }

        // More languages often indicate better general capability
        if (provider.languages.length > 50) {
            score += 0.1;
        }

        return Math.min(1, score);
    }

    /**
     * Estimate cost for translation request
     * @private
     */
    _estimateCost(provider, textLength) {
        const limits = provider.limits;

        if (!limits.costPer1K) {
            return 0; // Free provider
        }

        const charCount = Math.max(textLength, 1);
        const cost = (charCount / 1000) * limits.costPer1K;

        return cost;
    }

    /**
     * Record provider performance for learning
     * @param {string} providerId - Provider ID
     * @param {Object} performance - Performance metrics
     */
    recordPerformance(providerId, performance) {
        const history = this.performanceHistory.get(providerId) || [];

        // Add new performance record
        history.push({
            timestamp: Date.now(),
            responseTime: performance.duration || 0,
            success: performance.success || false,
            cost: performance.cost || 0,
            textLength: performance.textLength || 0
        });

        // Keep only last 100 records
        if (history.length > 100) {
            history.splice(0, history.length - 100);
        }

        this.performanceHistory.set(providerId, history);

        // Update health status
        this._updateHealthFromPerformance(providerId, history);
    }

    /**
     * Update provider health based on performance history
     * @private
     */
    _updateHealthFromPerformance(providerId, history) {
        if (history.length === 0) return;

        const recent = history.slice(-20); // Last 20 requests
        const successCount = recent.filter(record => record.success).length;
        const successRate = successCount / recent.length;

        const avgResponseTime = recent.reduce((sum, record) => sum + record.responseTime, 0) / recent.length;

        const health = this.healthStatus.get(providerId);
        if (health) {
            health.successRate = successRate;
            health.responseTime = avgResponseTime;
            health.healthy = successRate >= 0.8 && avgResponseTime < 30000; // 80% success, <30s response
            health.lastChecked = Date.now();
        }
    }

    /**
     * Perform health checks on all providers
     * @returns {Promise<ProviderHealth[]>}
     */
    async checkHealth() {
        const healthPromises = Array.from(this.providers.values()).map(async provider => {
            if (!provider.enabled) {
                return {
                    id: provider.id,
                    healthy: false,
                    responseTime: 0,
                    successRate: 0,
                    error: 'Provider disabled',
                    lastChecked: Date.now()
                };
            }

            try {
                const startTime = Date.now();

                // Perform a minimal health check translation
                await provider.translate('test', {
                    sourceLanguage: 'en',
                    targetLanguage: 'es',
                    timeout: 10000 // 10s timeout for health check
                });

                const responseTime = Date.now() - startTime;
                const health = {
                    id: provider.id,
                    healthy: true,
                    responseTime,
                    successRate: this.healthStatus.get(provider.id)?.successRate || 1,
                    lastChecked: Date.now()
                };

                this.healthStatus.set(provider.id, health);
                return health;

            } catch (error) {
                const health = {
                    id: provider.id,
                    healthy: false,
                    responseTime: 0,
                    successRate: 0,
                    error: error.message,
                    lastChecked: Date.now()
                };

                this.healthStatus.set(provider.id, health);
                return health;
            }
        });

        return await Promise.allSettled(healthPromises).then(results =>
            results.map(result => result.status === 'fulfilled' ? result.value : {
                id: 'unknown',
                healthy: false,
                responseTime: 0,
                successRate: 0,
                error: 'Health check failed',
                lastChecked: Date.now()
            })
        );
    }

    /**
     * Load provider configurations (placeholder for future config loading)
     * @private
     */
    async _loadProviderConfigurations() {
        // This will be implemented when provider classes are available
        this.logger.info('Provider configurations will be loaded when provider classes are registered');
    }

    /**
     * Perform initial health checks
     * @private
     */
    async _performInitialHealthChecks() {
        if (this.providers.size > 0) {
            this.logger.info('Performing initial health checks...');
            await this.checkHealth();
        }
    }

    /**
     * Start automated health monitoring
     * @private
     */
    _startHealthMonitoring() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }

        this.healthCheckTimer = setInterval(async () => {
            try {
                await this.checkHealth();
                this.logger.info('Automated health check completed');
            } catch (error) {
                this.logger.error('Automated health check failed', { error: error.message });
            }
        }, this.healthCheckInterval);

        this.logger.info('Health monitoring started', { intervalSeconds: this.healthCheckInterval / 1000 });
    }

    /**
     * Enable or disable a provider
     * @param {string} providerId - Provider ID
     * @param {boolean} enabled - Whether to enable the provider
     */
    setProviderEnabled(providerId, enabled) {
        const provider = this.providers.get(providerId);
        if (provider) {
            provider.enabled = enabled;
            this.logger.info('Provider status changed', { providerId, enabled });
        } else {
            throw new Error(`Provider not found: ${providerId}`);
        }
    }

    /**
     * Update provider selection weights
     * @param {Object} newWeights - New weight configuration
     */
    updateSelectionWeights(newWeights) {
        this.selectionWeights = { ...this.selectionWeights, ...newWeights };
        this.logger.info('Provider selection weights updated', { weights: this.selectionWeights });
    }

    /**
     * Get current provider statistics
     * @returns {Object} Provider statistics
     */
    getStatistics() {
        const stats = {
            totalProviders: this.providers.size,
            enabledProviders: this.getEnabledProviders().length,
            healthyProviders: Array.from(this.healthStatus.values()).filter(h => h.healthy).length,
            providerDetails: {}
        };

        this.providers.forEach((provider, id) => {
            const health = this.healthStatus.get(id);
            const history = this.performanceHistory.get(id) || [];

            stats.providerDetails[id] = {
                name: provider.name,
                type: provider.type,
                enabled: provider.enabled,
                healthy: health?.healthy || false,
                successRate: health?.successRate || 0,
                avgResponseTime: health?.responseTime || 0,
                totalRequests: history.length
            };
        });

        return stats;
    }

    /**
     * Cleanup resources and stop monitoring
     */
    destroy() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        this.providers.clear();
        this.healthStatus.clear();
        this.performanceHistory.clear();
        this.isInitialized = false;

        this.logger.info('Provider manager destroyed');
    }
}

// Export for browser extension environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ProviderManager };
} else if (typeof window !== 'undefined') {
    window.ProviderManager = ProviderManager;
}