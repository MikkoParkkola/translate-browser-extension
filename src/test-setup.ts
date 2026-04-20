/// <reference types="@testing-library/jest-dom/vitest" />
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanupGlobalFixtures } from './test-helpers/global-fixture-registry';

afterEach(() => {
  cleanupGlobalFixtures();
});
