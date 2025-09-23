/**
 * @fileoverview Production test runner with coverage validation
 * Orchestrates existing test suites and validates quality gates
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class TestRunner {
  constructor() {
    this.coverageThresholds = {
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80
    };

    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      coverage: null,
      errors: []
    };
  }

  /**
   * Run all test suites
   */
  async runAll(options = {}) {
    console.log('🚀 Starting production test validation...\n');

    const startTime = Date.now();

    try {
      // Run Jest tests with coverage
      await this.runJestTests(options);

      // Run E2E tests if requested
      if (options.includeE2E) {
        await this.runE2ETests(options);
      }

      // Validate quality gates
      await this.validateQualityGates();

      const duration = Date.now() - startTime;
      this.printSummary(duration);

      return this.results;

    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
      this.results.errors.push(error);
      throw error;
    }
  }

  /**
   * Run Jest tests with coverage
   */
  async runJestTests(options = {}) {
    console.log('🔬 Running Jest test suite with coverage...');

    try {
      const result = execSync('npm test -- --coverage --passWithNoTests', {
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });

      // Parse Jest output for results
      const testResults = this.parseJestOutput(result);
      this.aggregateResults(testResults);

      console.log('✅ Jest tests completed\n');
    } catch (error) {
      console.error('❌ Jest tests failed:', error.message);
      // Still try to parse results from stderr
      const testResults = this.parseJestOutput(error.stdout || error.message);
      this.aggregateResults(testResults);

      if (!options.continueOnFailure) {
        throw error;
      }
    }
  }

  /**
   * Run E2E tests with Playwright
   */
  async runE2ETests(options = {}) {
    console.log('🌐 Running E2E tests...');

    try {
      const result = execSync('npx playwright test', {
        encoding: 'utf-8',
        timeout: 120000
      });

      console.log(result);
      console.log('✅ E2E tests completed\n');
    } catch (error) {
      console.error('❌ E2E tests failed:', error.message);
      if (!options.continueOnE2EFailure) {
        throw error;
      }
    }
  }

  /**
   * Parse Jest output for test results
   */
  parseJestOutput(output) {
    const results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      coverage: null
    };

    // Parse test results
    const testMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
    if (testMatch) {
      results.failed = parseInt(testMatch[1]);
      results.passed = parseInt(testMatch[2]);
      results.total = parseInt(testMatch[3]);
    } else {
      const passMatch = output.match(/Tests:\s+(\d+)\s+passed,\s+(\d+)\s+total/);
      if (passMatch) {
        results.passed = parseInt(passMatch[1]);
        results.total = parseInt(passMatch[2]);
      }
    }

    // Parse coverage if present
    const coverageMatch = output.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
    if (coverageMatch) {
      results.coverage = {
        statements: parseFloat(coverageMatch[1]),
        branches: parseFloat(coverageMatch[2]),
        functions: parseFloat(coverageMatch[3]),
        lines: parseFloat(coverageMatch[4])
      };
    }

    return results;
  }

  /**
   * Aggregate test results
   */
  aggregateResults(testResult) {
    this.results.total += testResult.total;
    this.results.passed += testResult.passed;
    this.results.failed += testResult.failed;
    this.results.skipped += testResult.skipped || 0;

    if (testResult.coverage) {
      if (!this.results.coverage) {
        this.results.coverage = testResult.coverage;
      } else {
        // Merge coverage results (simplified)
        Object.keys(testResult.coverage).forEach(key => {
          this.results.coverage[key] = Math.min(
            this.results.coverage[key],
            testResult.coverage[key]
          );
        });
      }
    }
  }


  /**
   * Validate quality gates
   */
  async validateQualityGates() {
    console.log('🚪 Validating quality gates...');

    const failures = [];

    // Check test pass rate
    const passRate = this.results.total > 0 ? (this.results.passed / this.results.total * 100) : 0;
    if (passRate < 85) {
      failures.push(`Test pass rate too low: ${passRate.toFixed(1)}% (required: 85%)`);
    }

    // Check coverage thresholds
    if (this.results.coverage) {
      Object.keys(this.coverageThresholds).forEach(metric => {
        const actual = this.results.coverage[metric];
        const required = this.coverageThresholds[metric];

        if (actual < required) {
          failures.push(`${metric} coverage too low: ${actual.toFixed(1)}% (required: ${required}%)`);
        }
      });
    } else {
      failures.push('Coverage data not available');
    }

    // Check for critical errors
    if (this.results.failed > 0) {
      failures.push(`${this.results.failed} tests failed`);
    }

    if (failures.length > 0) {
      console.error('❌ Quality gate validation failed:');
      failures.forEach(failure => console.error(`  - ${failure}`));
      throw new Error('Quality gates not met');
    }

    console.log('✅ All quality gates passed\n');
  }

  /**
   * Print test summary
   */
  printSummary(duration) {
    console.log('📋 Test Summary');
    console.log('================');
    console.log(`Total Tests: ${this.results.total}`);
    console.log(`Passed: ${this.results.passed} ✅`);
    console.log(`Failed: ${this.results.failed} ${this.results.failed > 0 ? '❌' : '✅'}`);
    console.log(`Skipped: ${this.results.skipped} ⏭️`);
    console.log(`Duration: ${(duration / 1000).toFixed(1)}s ⏱️`);

    if (this.results.coverage) {
      console.log('\n📊 Coverage Summary');
      console.log('===================');
      console.log(`Statements: ${this.results.coverage.statements.toFixed(1)}%`);
      console.log(`Branches: ${this.results.coverage.branches.toFixed(1)}%`);
      console.log(`Functions: ${this.results.coverage.functions.toFixed(1)}%`);
      console.log(`Lines: ${this.results.coverage.lines.toFixed(1)}%`);
    }

    const passRate = this.results.total > 0 ? (this.results.passed / this.results.total * 100) : 0;
    console.log(`\nPass Rate: ${passRate.toFixed(1)}%`);

    if (this.results.failed === 0 && passRate >= 85) {
      console.log('\n🎉 Quality gates passed! Extension meets production standards.');
    } else {
      console.log('\n⚠️ Quality gates failed. Please review and fix issues before deployment.');
    }
  }

  /**
   * Generate detailed test report
   */
  generateDetailedReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: this.results,
      thresholds: this.coverageThresholds,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        ci: !!process.env.CI
      }
    };

    const reportPath = path.join(process.cwd(), 'coverage/test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`📄 Detailed report saved to: ${reportPath}`);
    return report;
  }
}

/**
 * CLI interface
 */
if (require.main === module) {
  const runner = new TestRunner();

  const options = {
    includeE2E: process.argv.includes('--e2e'),
    includePerformance: process.argv.includes('--performance'),
    continueOnE2EFailure: process.argv.includes('--continue-on-e2e-failure'),
    continueOnPerformanceFailure: process.argv.includes('--continue-on-performance-failure')
  };

  runner.runAll(options)
    .then((results) => {
      runner.generateDetailedReport();
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Test runner failed:', error);
      process.exit(1);
    });
}

module.exports = TestRunner;