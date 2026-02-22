import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@js': resolve(__dirname, 'src/js'),
            '@css': resolve(__dirname, 'src/css'),
            '@store': resolve(__dirname, 'src/js/store'),
            '@state': resolve(__dirname, 'src/js/state'),
            '@utils': resolve(__dirname, 'src/js/utilities'),
            '@tools': resolve(__dirname, 'src/js/tool_manager'),
            '@toolbar': resolve(__dirname, 'src/js/toolbar'),
            '@modals': resolve(__dirname, 'src/js/modals'),
            '@sidebar': resolve(__dirname, 'src/js/sidebar'),
            '@layers': resolve(__dirname, 'src/js/layers'),
            '@catalog': resolve(__dirname, 'src/js/catalog'),
            '@ui': resolve(__dirname, 'src/js/ui'),
            '@events': resolve(__dirname, 'src/js/events')
        }
    },
    test: {
        include: ['tests/**/*.test.js'],
        environment: 'node',
        globals: true
    }
});
