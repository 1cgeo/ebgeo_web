import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({ ...base, testMatch: '**/release-interruption.scenario.js',
    retries: 0, timeout: 90000 });
