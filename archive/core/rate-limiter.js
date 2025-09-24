/**
 * Adaptive Rate Limiter - Per-provider quota management and load distribution
 *
 * Implements sophisticated rate limiting with real-time quota tracking,
 * cost management, automatic provider switching, and usage analytics.
 *
 * @author Backend Systems Lead
 * @version 1.0.0
 */

/**
 * @typedef {Object} ProviderLimits
 * @property {number} requestsPerMinute - Requests per minute limit
 * @property {number} requestsPerHour - Requests per hour limit
 * @property {number} requestsPerDay - Requests per day limit
 * @property {number} charactersPerMinute - Characters per minute limit
 * @property {number} charactersPerHour - Characters per hour limit
 * @property {number} charactersPerDay - Characters per day limit
 * @property {number} [tokensPerMinute] - Tokens per minute limit (AI providers)
 * @property {number} [tokensPerHour] - Tokens per hour limit
 * @property {number} [tokensPerDay] - Tokens per day limit
 * @property {number} [monthlyQuota] - Monthly character quota
 * @property {Object} [costLimits] - Cost-based limits
 * @property {number} [costLimits.dailyBudget] - Daily budget in USD
 * @property {number} [costLimits.monthlyBudget] - Monthly budget in USD
 */

/**
 * @typedef {Object} UsageWindow
 * @property {number} requestsThisMinute - Current minute request count
 * @property {number} requestsThisHour - Current hour request count
 * @property {number} requestsThisDay - Current day request count
 * @property {number} charactersThisMinute - Current minute character count
 * @property {number} charactersThisHour - Current hour character count
 * @property {number} charactersThisDay - Current day character count
 * @property {number} charactersThisMonth - Current month character count
 * @property {number} tokensThisMinute - Current minute token count
 * @property {number} tokensThisHour - Current hour token count
 * @property {number} tokensThisDay - Current day token count
 * @property {number} costToday - Current day cost
 * @property {number} costThisMonth - Current month cost
 * @property {number} lastMinuteReset - Last minute reset timestamp
 * @property {number} lastHourReset - Last hour reset timestamp
 * @property {number} lastDayReset - Last day reset timestamp
 * @property {number} lastMonthReset - Last month reset timestamp
 */

/**
 * @typedef {Object} RequestMetrics
 * @property {number} characterCount - Number of characters processed
 * @property {number} [tokenCount] - Number of tokens processed (AI providers)
 * @property {number} cost - Cost in USD
 * @property {number} duration - Request duration in milliseconds
 * @property {boolean} success - Whether request succeeded
 */

/**
 * @typedef {Object} RateLimitCheck
 * @property {boolean} allowed - Whether request is allowed
 * @property {number} waitTime - Wait time in milliseconds if not allowed
 * @property {string} [reason] - Reason for denial
 * @property {string} [suggestedProvider] - Alternative provider suggestion
 * @property {number} [estimatedCost] - Estimated cost for request
 */

class AdaptiveRateLimiter {
    /**
     * Initialize rate limiter with provider configurations
     */
    constructor() {
        /** @type {Map<string, ProviderLimits>} */
        this.providerLimits = new Map();

        /** @type {Map<string, UsageWindow>} */
        this.usageTracking = new Map();

        /** @type {Map<string, Array>} */
        this.pendingRequests = new Map();

        /** @type {boolean} */
        this.isInitialized = false;

        /** @type {number} */
        this.monitoringInterval = 30000; // 30 seconds

        /** @type {number} */
        this.monitoringTimer = null;

        /** @type {Object} */
        this.costEstimates = {
            'qwen-mt-turbo': 0.002,
            'qwen-mt': 0.004,
            'deepl-free': 0,
            'deepl-pro': 0.020
        };

        // Provider priority for automatic switching
        this.providerPriority = ['qwen-mt-turbo', 'qwen-mt', 'deepl-free', 'deepl-pro'];
    }

    /**
     * Initialize rate limiter with provider configurations
     */
    async initialize() {
        try {
            this._initializeProviderLimits();
            this._initializeUsageTracking();
            await this._loadPersistedUsage();
            this._startMonitoring();

            this.isInitialized = true;
            console.log('Adaptive rate limiter initialized for', this.providerLimits.size, 'providers');
        } catch (error) {
            console.error('Failed to initialize rate limiter:', error);
            throw new Error(`Rate limiter initialization failed: ${error.message}`);
        }
    }

    /**
     * Initialize provider limit configurations
     * @private
     */
    _initializeProviderLimits() {
        // Alibaba Cloud Qwen MT Turbo
        this.providerLimits.set('qwen-mt-turbo', {
            requestsPerMinute: 100,
            requestsPerHour: 6000,
            requestsPerDay: 144000,
            charactersPerMinute: 50000,
            charactersPerHour: 3000000,
            charactersPerDay: 72000000,
            tokensPerMinute: 60000,
            tokensPerHour: 3600000,
            tokensPerDay: 86400000,
            costLimits: {
                dailyBudget: 10.00,
                monthlyBudget: 300.00
            }
        });

        // Alibaba Cloud Qwen MT Standard
        this.providerLimits.set('qwen-mt', {
            requestsPerMinute: 50,
            requestsPerHour: 3000,
            requestsPerDay: 72000,
            charactersPerMinute: 30000,
            charactersPerHour: 1800000,
            charactersPerDay: 43200000,
            tokensPerMinute: 40000,
            tokensPerHour: 2400000,
            tokensPerDay: 57600000,
            costLimits: {
                dailyBudget: 15.00,
                monthlyBudget: 450.00
            }
        });

        // DeepL Free
        this.providerLimits.set('deepl-free', {
            requestsPerMinute: 5,
            requestsPerHour: 100,
            requestsPerDay: 500,
            charactersPerMinute: 1000,
            charactersPerHour: 20000,
            charactersPerDay: 16667, // 500k/month ÷ 30 days
            monthlyQuota: 500000
        });

        // DeepL Pro
        this.providerLimits.set('deepl-pro', {
            requestsPerMinute: 1000,
            requestsPerHour: 60000,
            requestsPerDay: 1440000,
            charactersPerMinute: 1000000,
            charactersPerHour: 60000000,
            charactersPerDay: 1440000000,
            costLimits: {
                dailyBudget: 100.00,
                monthlyBudget: 3000.00
            }
        });

        console.log('Provider limits initialized for', this.providerLimits.size, 'providers');
    }

    /**
     * Initialize usage tracking for all providers
     * @private
     */
    _initializeUsageTracking() {
        const now = Date.now();

        this.providerLimits.forEach((limits, providerId) => {
            this.usageTracking.set(providerId, this._createNewUsageWindow(now));
            this.pendingRequests.set(providerId, []);
        });
    }

    /**
     * Create new usage window with current timestamp
     * @private
     */
    _createNewUsageWindow(timestamp = Date.now()) {
        return {
            requestsThisMinute: 0,
            requestsThisHour: 0,
            requestsThisDay: 0,
            charactersThisMinute: 0,
            charactersThisHour: 0,
            charactersThisDay: 0,
            charactersThisMonth: 0,
            tokensThisMinute: 0,
            tokensThisHour: 0,
            tokensThisDay: 0,
            costToday: 0,
            costThisMonth: 0,
            lastMinuteReset: timestamp,
            lastHourReset: timestamp,
            lastDayReset: timestamp,
            lastMonthReset: timestamp
        };
    }

    /**
     * Check if request can be made within rate limits
     * @param {string} providerId - Provider ID
     * @param {number} textLength - Length of text to translate
     * @param {Object} [options] - Additional options
     * @returns {Promise<RateLimitCheck>}
     */
    async canMakeRequest(providerId, textLength, options = {}) {
        if (!this.isInitialized) {
            throw new Error('Rate limiter not initialized');
        }

        const limits = this.providerLimits.get(providerId);
        const usage = this.usageTracking.get(providerId);

        if (!limits || !usage) {
            return {
                allowed: false,
                waitTime: 0,
                reason: 'Provider not configured'
            };
        }

        // Update usage windows if needed
        this._updateUsageWindows(providerId);

        const estimatedCost = this._estimateCost(providerId, textLength);
        const estimatedTokens = this._estimateTokens(textLength);

        // Check character limits
        const charLimitCheck = this._checkCharacterLimits(limits, usage, textLength);
        if (!charLimitCheck.allowed) {
            return {
                ...charLimitCheck,
                estimatedCost,
                suggestedProvider: await this._findAlternativeProvider(textLength, options)
            };
        }

        // Check request limits
        const requestLimitCheck = this._checkRequestLimits(limits, usage);
        if (!requestLimitCheck.allowed) {
            return {
                ...requestLimitCheck,
                estimatedCost,
                suggestedProvider: await this._findAlternativeProvider(textLength, options)
            };
        }

        // Check token limits (for AI providers)
        if (limits.tokensPerMinute) {
            const tokenLimitCheck = this._checkTokenLimits(limits, usage, estimatedTokens);
            if (!tokenLimitCheck.allowed) {
                return {
                    ...tokenLimitCheck,
                    estimatedCost,
                    suggestedProvider: await this._findAlternativeProvider(textLength, options)
                };
            }
        }

        // Check monthly quota (for free providers)
        if (limits.monthlyQuota) {
            const quotaCheck = this._checkMonthlyQuota(limits, usage, textLength);
            if (!quotaCheck.allowed) {
                return {
                    ...quotaCheck,
                    estimatedCost,
                    suggestedProvider: await this._findAlternativeProvider(textLength, options)
                };
            }
        }

        // Check cost limits
        if (limits.costLimits) {
            const costLimitCheck = this._checkCostLimits(limits, usage, estimatedCost);
            if (!costLimitCheck.allowed) {
                return {
                    ...costLimitCheck,
                    estimatedCost,
                    suggestedProvider: await this._findCheaperProvider(textLength, options)
                };
            }
        }

        return {
            allowed: true,
            waitTime: 0,
            estimatedCost
        };
    }

    /**
     * Check character limits
     * @private
     */
    _checkCharacterLimits(limits, usage, textLength) {
        if (usage.charactersThisMinute + textLength > limits.charactersPerMinute) {
            return {
                allowed: false,
                waitTime: this._calculateWaitTime(usage.lastMinuteReset, 60000),
                reason: 'Character per minute limit exceeded'
            };
        }

        if (usage.charactersThisHour + textLength > limits.charactersPerHour) {
            return {
                allowed: false,
                waitTime: this._calculateWaitTime(usage.lastHourReset, 3600000),
                reason: 'Character per hour limit exceeded'
            };
        }

        if (usage.charactersThisDay + textLength > limits.charactersPerDay) {
            return {
                allowed: false,
                waitTime: this._calculateWaitTime(usage.lastDayReset, 86400000),
                reason: 'Character per day limit exceeded'
            };
        }

        return { allowed: true, waitTime: 0 };
    }

    /**
     * Check request limits
     * @private
     */
    _checkRequestLimits(limits, usage) {
        if (usage.requestsThisMinute >= limits.requestsPerMinute) {
            return {
                allowed: false,
                waitTime: this._calculateWaitTime(usage.lastMinuteReset, 60000),
                reason: 'Request per minute limit exceeded'
            };
        }

        if (usage.requestsThisHour >= limits.requestsPerHour) {
            return {
                allowed: false,
                waitTime: this._calculateWaitTime(usage.lastHourReset, 3600000),
                reason: 'Request per hour limit exceeded'
            };
        }

        if (usage.requestsThisDay >= limits.requestsPerDay) {
            return {
                allowed: false,
                waitTime: this._calculateWaitTime(usage.lastDayReset, 86400000),
                reason: 'Request per day limit exceeded'
            };
        }

        return { allowed: true, waitTime: 0 };
    }

    /**
     * Check token limits (for AI providers)
     * @private
     */
    _checkTokenLimits(limits, usage, estimatedTokens) {
        if (limits.tokensPerMinute && usage.tokensThisMinute + estimatedTokens > limits.tokensPerMinute) {
            return {
                allowed: false,
                waitTime: this._calculateWaitTime(usage.lastMinuteReset, 60000),
                reason: 'Token per minute limit exceeded'
            };
        }

        if (limits.tokensPerHour && usage.tokensThisHour + estimatedTokens > limits.tokensPerHour) {
            return {
                allowed: false,
                waitTime: this._calculateWaitTime(usage.lastHourReset, 3600000),
                reason: 'Token per hour limit exceeded'
            };
        }

        if (limits.tokensPerDay && usage.tokensThisDay + estimatedTokens > limits.tokensPerDay) {
            return {
                allowed: false,
                waitTime: this._calculateWaitTime(usage.lastDayReset, 86400000),
                reason: 'Token per day limit exceeded'
            };
        }

        return { allowed: true, waitTime: 0 };
    }

    /**
     * Check monthly quota
     * @private
     */
    _checkMonthlyQuota(limits, usage, textLength) {
        if (usage.charactersThisMonth + textLength > limits.monthlyQuota) {
            return {
                allowed: false,
                waitTime: this._timeUntilMonthReset(usage.lastMonthReset),
                reason: 'Monthly quota exceeded'
            };
        }

        return { allowed: true, waitTime: 0 };
    }

    /**
     * Check cost limits
     * @private
     */
    _checkCostLimits(limits, usage, estimatedCost) {
        if (limits.costLimits.dailyBudget && usage.costToday + estimatedCost > limits.costLimits.dailyBudget) {
            return {
                allowed: false,
                waitTime: this._timeUntilDayReset(usage.lastDayReset),
                reason: 'Daily budget exceeded'
            };
        }

        if (limits.costLimits.monthlyBudget && usage.costThisMonth + estimatedCost > limits.costLimits.monthlyBudget) {
            return {
                allowed: false,
                waitTime: this._timeUntilMonthReset(usage.lastMonthReset),
                reason: 'Monthly budget exceeded'
            };
        }

        return { allowed: true, waitTime: 0 };
    }

    /**
     * Find alternative provider that can handle the request
     * @private
     */
    async _findAlternativeProvider(textLength, options = {}) {
        for (const providerId of this.providerPriority) {
            if (this.providerLimits.has(providerId)) {
                const check = await this.canMakeRequest(providerId, textLength, options);
                if (check.allowed) {
                    return providerId;
                }
            }
        }
        return null;
    }

    /**
     * Find cheaper provider that can handle the request
     * @private
     */
    async _findCheaperProvider(textLength, options = {}) {
        const availableProviders = [];

        for (const providerId of this.providerPriority) {
            if (this.providerLimits.has(providerId)) {
                const check = await this.canMakeRequest(providerId, textLength, options);
                if (check.allowed) {
                    availableProviders.push({
                        id: providerId,
                        cost: this._estimateCost(providerId, textLength)
                    });
                }
            }
        }

        if (availableProviders.length === 0) return null;

        // Sort by cost (lowest first)
        availableProviders.sort((a, b) => a.cost - b.cost);
        return availableProviders[0].id;
    }

    /**
     * Estimate cost for translation request
     * @private
     */
    _estimateCost(providerId, textLength) {
        const costPer1K = this.costEstimates[providerId];
        if (!costPer1K) return 0;

        return (Math.max(textLength, 1) / 1000) * costPer1K;
    }

    /**
     * Estimate token count for text
     * @private
     */
    _estimateTokens(textLength) {
        // Rough estimate: 1 token ≈ 4 characters for most languages
        return Math.ceil(textLength / 4);
    }

    /**
     * Record usage after successful request
     * @param {string} providerId - Provider ID
     * @param {RequestMetrics} metrics - Request metrics
     */
    async recordUsage(providerId, metrics) {
        const usage = this.usageTracking.get(providerId);
        if (!usage) {
            console.warn(`No usage tracking for provider: ${providerId}`);
            return;
        }

        // Update usage windows
        this._updateUsageWindows(providerId);

        // Record the usage
        if (metrics.success) {
            usage.requestsThisMinute++;
            usage.requestsThisHour++;
            usage.requestsThisDay++;
            usage.charactersThisMinute += metrics.characterCount;
            usage.charactersThisHour += metrics.characterCount;
            usage.charactersThisDay += metrics.characterCount;
            usage.charactersThisMonth += metrics.characterCount;

            if (metrics.tokenCount) {
                usage.tokensThisMinute += metrics.tokenCount;
                usage.tokensThisHour += metrics.tokenCount;
                usage.tokensThisDay += metrics.tokenCount;
            }

            usage.costToday += metrics.cost;
            usage.costThisMonth += metrics.cost;
        }

        // Persist usage data
        await this._persistUsageData();

        console.log(`Usage recorded for ${providerId}:`, {
            characters: metrics.characterCount,
            cost: metrics.cost,
            success: metrics.success
        });
    }

    /**
     * Update usage windows by resetting expired periods
     * @private
     */
    _updateUsageWindows(providerId) {
        const usage = this.usageTracking.get(providerId);
        if (!usage) return;

        const now = Date.now();

        // Reset minute window
        if (now - usage.lastMinuteReset >= 60000) {
            usage.requestsThisMinute = 0;
            usage.charactersThisMinute = 0;
            usage.tokensThisMinute = 0;
            usage.lastMinuteReset = now;
        }

        // Reset hour window
        if (now - usage.lastHourReset >= 3600000) {
            usage.requestsThisHour = 0;
            usage.charactersThisHour = 0;
            usage.tokensThisHour = 0;
            usage.lastHourReset = now;
        }

        // Reset day window
        if (now - usage.lastDayReset >= 86400000) {
            usage.requestsThisDay = 0;
            usage.charactersThisDay = 0;
            usage.tokensThisDay = 0;
            usage.costToday = 0;
            usage.lastDayReset = now;
        }

        // Reset month window (simplified: 30 days)
        if (now - usage.lastMonthReset >= 2592000000) {
            usage.charactersThisMonth = 0;
            usage.costThisMonth = 0;
            usage.lastMonthReset = now;
        }
    }

    /**
     * Calculate wait time until next reset
     * @private
     */
    _calculateWaitTime(lastReset, period) {
        const elapsed = Date.now() - lastReset;
        return Math.max(0, period - elapsed);
    }

    /**
     * Calculate time until day reset
     * @private
     */
    _timeUntilDayReset(lastDayReset) {
        return this._calculateWaitTime(lastDayReset, 86400000);
    }

    /**
     * Calculate time until month reset
     * @private
     */
    _timeUntilMonthReset(lastMonthReset) {
        return this._calculateWaitTime(lastMonthReset, 2592000000);
    }

    /**
     * Get current usage statistics
     * @param {string} [providerId] - Specific provider ID, or all if omitted
     * @returns {Object} Usage statistics
     */
    getUsageStats(providerId = null) {
        if (providerId) {
            const usage = this.usageTracking.get(providerId);
            const limits = this.providerLimits.get(providerId);

            if (!usage || !limits) {
                return null;
            }

            return {
                providerId,
                current: {
                    requestsThisMinute: usage.requestsThisMinute,
                    requestsThisHour: usage.requestsThisHour,
                    requestsThisDay: usage.requestsThisDay,
                    charactersThisMinute: usage.charactersThisMinute,
                    charactersThisHour: usage.charactersThisHour,
                    charactersThisDay: usage.charactersThisDay,
                    charactersThisMonth: usage.charactersThisMonth,
                    costToday: usage.costToday,
                    costThisMonth: usage.costThisMonth
                },
                limits: {
                    requestsPerMinute: limits.requestsPerMinute,
                    requestsPerHour: limits.requestsPerHour,
                    requestsPerDay: limits.requestsPerDay,
                    charactersPerMinute: limits.charactersPerMinute,
                    charactersPerHour: limits.charactersPerHour,
                    charactersPerDay: limits.charactersPerDay,
                    monthlyQuota: limits.monthlyQuota,
                    dailyBudget: limits.costLimits?.dailyBudget,
                    monthlyBudget: limits.costLimits?.monthlyBudget
                },
                utilization: {
                    requestsPerMinute: usage.requestsThisMinute / limits.requestsPerMinute,
                    charactersPerMinute: usage.charactersThisMinute / limits.charactersPerMinute,
                    dailyBudget: limits.costLimits?.dailyBudget
                        ? usage.costToday / limits.costLimits.dailyBudget
                        : 0
                }
            };
        }

        // Return stats for all providers
        const allStats = {};
        this.providerLimits.forEach((limits, id) => {
            allStats[id] = this.getUsageStats(id);
        });

        return allStats;
    }

    /**
     * Load persisted usage data from storage
     * @private
     */
    async _loadPersistedUsage() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                const result = await chrome.storage.local.get('rateLimiterUsage');
                if (result.rateLimiterUsage) {
                    const persistedData = result.rateLimiterUsage;

                    this.providerLimits.forEach((limits, providerId) => {
                        if (persistedData[providerId]) {
                            this.usageTracking.set(providerId, {
                                ...this._createNewUsageWindow(),
                                ...persistedData[providerId]
                            });
                        }
                    });

                    console.log('Persisted usage data loaded');
                }
            }
        } catch (error) {
            console.warn('Failed to load persisted usage data:', error);
        }
    }

    /**
     * Persist usage data to storage
     * @private
     */
    async _persistUsageData() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                const usageData = {};
                this.usageTracking.forEach((usage, providerId) => {
                    usageData[providerId] = usage;
                });

                await chrome.storage.local.set({ rateLimiterUsage: usageData });
            }
        } catch (error) {
            console.warn('Failed to persist usage data:', error);
        }
    }

    /**
     * Start monitoring and cleanup
     * @private
     */
    _startMonitoring() {
        if (this.monitoringTimer) {
            clearInterval(this.monitoringTimer);
        }

        this.monitoringTimer = setInterval(() => {
            this._performQuotaChecks();
            this._cleanupExpiredData();
        }, this.monitoringInterval);

        console.log(`Rate limiter monitoring started (interval: ${this.monitoringInterval / 1000}s)`);
    }

    /**
     * Perform quota warning checks
     * @private
     */
    _performQuotaChecks() {
        this.providerLimits.forEach((limits, providerId) => {
            const usage = this.usageTracking.get(providerId);
            if (!usage) return;

            this._updateUsageWindows(providerId);

            // Check for quota warnings (80% threshold)
            const warnings = [];

            if (usage.charactersThisMinute / limits.charactersPerMinute > 0.8) {
                warnings.push('minute character limit');
            }
            if (usage.requestsThisMinute / limits.requestsPerMinute > 0.8) {
                warnings.push('minute request limit');
            }
            if (limits.monthlyQuota && usage.charactersThisMonth / limits.monthlyQuota > 0.8) {
                warnings.push('monthly quota');
            }
            if (limits.costLimits?.dailyBudget && usage.costToday / limits.costLimits.dailyBudget > 0.8) {
                warnings.push('daily budget');
            }

            if (warnings.length > 0) {
                console.warn(`Provider ${providerId} approaching limits:`, warnings.join(', '));
            }
        });
    }

    /**
     * Cleanup expired data
     * @private
     */
    _cleanupExpiredData() {
        // This could be extended to clean up old performance data
        // For now, just ensure persistence
        this._persistUsageData();
    }

    /**
     * Reset usage for a specific provider (admin function)
     * @param {string} providerId - Provider ID
     */
    resetProviderUsage(providerId) {
        if (this.usageTracking.has(providerId)) {
            this.usageTracking.set(providerId, this._createNewUsageWindow());
            this._persistUsageData();
            console.log(`Usage reset for provider: ${providerId}`);
        }
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.monitoringTimer) {
            clearInterval(this.monitoringTimer);
            this.monitoringTimer = null;
        }

        this.providerLimits.clear();
        this.usageTracking.clear();
        this.pendingRequests.clear();
        this.isInitialized = false;

        console.log('Adaptive rate limiter destroyed');
    }
}

// Export for browser extension environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AdaptiveRateLimiter };
} else if (typeof window !== 'undefined') {
    window.AdaptiveRateLimiter = AdaptiveRateLimiter;
}