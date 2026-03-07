// Path: js/tool_manager/helpers/common-config.helpers.js

/**
 * @fileoverview Common configurations for attribute panel helpers.
 */

/**
 * Default configuration for sliders.
 * @constant {Object}
 */
export const DEFAULT_SLIDER_CONFIG = {
    width: 70,
    fontSize: 11,
    padding: '6px 4px',
    gap: 6,
    debounceMs: 300,
    minHeight: 28
};

/**
 * Common configurations for different property types.
 * @constant {Object}
 */
export const COMMON_CONFIGS = {
    complete_opacity: {
        min: 0,
        max: 100,
        step: 1
    },
    opacity: {
        min: 10,
        max: 100,
        step: 1
    },
    lineWidth: {
        min: 1,
        max: 10,
        step: 1
    },
    size: {
        min: 0.1,
        max: 10,
        step: 0.1
    },
    rotation: {
        min: -180,
        max: 180,
        step: 1
    }
};

/**
 * Returns common configuration with default value and optional overrides.
 *
 * @param {string} type - Config type ('opacity', 'lineWidth', 'size', 'rotation')
 * @param {number} defaultValue - Default value for the control
 * @param {Object} [overrides={}] - Override values
 * @returns {Object} Merged configuration
 */
export function getCommonConfig(type, defaultValue, overrides = {}) {
    const baseConfig = COMMON_CONFIGS[type] || {};
    return {
        ...baseConfig,
        value: defaultValue,
        ...overrides
    };
}
