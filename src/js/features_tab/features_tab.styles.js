// Path: js/features_tab/features_tab.styles.js

/**
 * @fileoverview Style injection for features tab components.
 */

/**
 * Injects CSS styles for analysis layers control.
 */
export function injectAnalysisLayersStyles() {
    if (document.getElementById('analysis-layers-styles')) return;

    const style = document.createElement('style');
    style.id = 'analysis-layers-styles';
    style.textContent = `
        .analysis-layers-header {
            padding: 8px 12px 4px 12px;
            font-weight: 500;
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .analysis-layer-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 12px 4px 24px;
            gap: 8px;
        }

        .analysis-layer-label {
            display: flex;
            align-items: center;
            font-size: 12px;
            cursor: pointer;
            flex: 1;
        }

        .analysis-layer-label input {
            margin-right: 6px;
        }

        .analysis-layer-zoom {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            color: #666;
            transition: color 0.2s ease;
            border-radius: 3px;
            display: flex;
            align-items: center;
            justify-content: center;
            min-width: 22px;
            height: 22px;
        }

        .analysis-layer-zoom:hover {
            color: #007bff;
            background-color: #f8f9fa;
        }

        .analysis-layer-zoom:active {
            transform: scale(0.95);
        }
    `;
    document.head.appendChild(style);
}

/**
 * Injects CSS styles for group items.
 */
export function injectGroupStyles() {
    if (document.getElementById('group-styles')) return;

    const style = document.createElement('style');
    style.id = 'group-styles';
    style.textContent = `
        .group-container {
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            background-color: #f8f9fa;
            overflow: hidden;
        }

        .group-header {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background-color: #f0f0f0;
            border-bottom: 1px solid #e0e0e0;
            cursor: pointer;
            user-select: none;
        }

        .group-header:hover {
            background-color: #e9ecef;
        }

        .group-header.group-hidden {
            opacity: 0.6;
        }

        .group-header.group-locked {
            background-color: #ffeaa7;
        }

        .group-expand-icon {
            margin-right: 8px;
            color: #666;
            transition: transform 0.2s ease;
        }

        .group-expand-icon.expanded {
            transform: rotate(0deg);
        }

        .group-expand-icon.collapsed {
            transform: rotate(-90deg);
        }

        .group-icon {
            margin-right: 8px;
            color: #007bff;
        }

        .group-name {
            flex: 1;
            font-weight: 500;
            font-size: 14px;
            color: #333;
        }

        .group-count {
            margin-left: 8px;
            font-size: 12px;
            color: #666;
            background-color: #e9ecef;
            padding: 2px 6px;
            border-radius: 10px;
        }

        .group-controls {
            display: flex;
            align-items: center;
            gap: 4px;
            margin-left: 8px;
        }

        .group-controls button {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            border-radius: 3px;
            color: #666;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .group-controls button:hover {
            background-color: #ffffff;
            color: #007bff;
        }

        .group-controls .lock-toggle svg {
            color: #dc3545;
        }

        .group-features-list {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease;
            background-color: #ffffff;
        }

        .group-features-list.expanded {
            max-height: 500px;
        }

        .group-feature-item {
            display: flex;
            align-items: center;
            padding: 6px 12px 6px 32px;
            border-bottom: 1px solid #f0f0f0;
            background-color: #ffffff;
        }

        .group-feature-item:last-child {
            border-bottom: none;
        }

        .group-feature-item:hover {
            background-color: #f8f9fa;
        }

        .group-feature-item.feature-hidden {
            opacity: 0.5;
        }

        .group-feature-main {
            display: flex;
            align-items: center;
            flex: 1;
            cursor: pointer;
        }

        .group-feature-type-icon {
            width: 16px;
            height: 16px;
            margin-right: 8px;
        }

        .group-feature-name {
            font-size: 13px;
            color: #555;
        }

        .feature-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            border-bottom: 1px solid #f0f0f0;
            background-color: #ffffff;
            transition: background-color 0.2s ease;
        }

        .feature-item:hover {
            background-color: #f8f9fa;
        }

        .feature-item.feature-hidden {
            opacity: 0.5;
        }

        .feature-item.feature-locked {
            background-color: #ffeaa7;
        }

        .feature-main {
            display: flex;
            align-items: center;
            flex: 1;
            cursor: pointer;
        }

        .feature-type-icon {
            width: 16px;
            height: 16px;
            margin-right: 8px;
        }

        .feature-name {
            font-size: 14px;
            color: #333;
        }

        .feature-controls {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .feature-controls button {
            background: none;
            border: none;
            cursor: pointer;
            padding: 4px;
            border-radius: 3px;
            color: #666;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .feature-controls button:hover {
            background-color: #e9ecef;
            color: #007bff;
        }

        .feature-controls .lock-toggle svg {
            color: #dc3545;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Injects CSS styles for layer items.
 */
export function injectLayerStyles() {
    if (document.getElementById('layer-styles')) return;

    const style = document.createElement('style');
    style.id = 'layer-styles';
    style.textContent = `
        /* Add layer button in header */
        .layer-add-btn {
            background: none;
            border: 1px solid #ccc;
            border-radius: 3px;
            cursor: pointer;
            padding: 2px 6px;
            color: #666;
            display: flex;
            align-items: center;
            transition: all 0.2s;
        }

        .layer-add-btn:hover {
            background-color: #e9ecef;
            border-color: #007bff;
            color: #007bff;
        }

        /* Container de cada layer na lista */
        .layer-container {
            margin-bottom: 2px;
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            overflow: hidden;
            background-color: #fff;
        }

        .layer-container.layer-active {
            border-color: #28a745;
            border-left: 3px solid #28a745;
        }

        .layer-container.layer-hidden {
            opacity: 0.6;
        }

        .layer-container.layer-locked {
            background-color: #fffbf0;
        }

        /* Header da layer */
        .layer-header {
            display: flex;
            align-items: center;
            padding: 6px 8px;
            background-color: #f5f5f5;
            cursor: pointer;
            user-select: none;
            gap: 4px;
        }

        .layer-header:hover {
            background-color: #e9ecef;
        }

        .layer-header.active {
            background-color: #d4edda;
        }

        .layer-radio {
            margin: 0;
            cursor: pointer;
        }

        .layer-expand-icon {
            color: #666;
            display: flex;
            align-items: center;
            transition: transform 0.2s ease;
        }

        .layer-expand-icon.collapsed {
            transform: rotate(-90deg);
        }

        .layer-icon {
            color: #666;
            display: flex;
            align-items: center;
        }

        .layer-name {
            flex: 1;
            font-size: 13px;
            font-weight: 500;
            color: #333;
            cursor: pointer;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .layer-count {
            font-size: 11px;
            color: #666;
            background-color: #e9ecef;
            padding: 1px 6px;
            border-radius: 10px;
            margin-right: 4px;
        }

        .layer-controls {
            display: flex;
            align-items: center;
            gap: 2px;
        }

        .layer-controls button {
            background: none;
            border: none;
            cursor: pointer;
            padding: 3px;
            border-radius: 3px;
            color: #666;
            display: flex;
            align-items: center;
            transition: all 0.2s;
        }

        .layer-controls button:hover:not(:disabled) {
            background-color: #fff;
            color: #007bff;
        }

        .layer-controls button:disabled {
            cursor: not-allowed;
            opacity: 0.3;
        }

        .layer-delete-btn:hover:not(:disabled) {
            color: #dc3545 !important;
        }

        /* Layer content (features and groups) */
        .layer-content {
            padding: 4px 4px 4px 16px;
            background-color: #fff;
        }

        .layer-content.collapsed {
            display: none;
        }

        /* Indicador de grupo split (cross-layer) */
        .group-split-indicator {
            color: #fd7e14;
            font-style: italic;
        }

        /* Drag handle for layer reordering */
        .layer-drag-handle {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            cursor: grab;
            color: #999;
            user-select: none;
            flex-shrink: 0;
            transition: color 0.2s ease;
            padding: 0 2px;
        }

        .layer-drag-handle:hover {
            color: #007bff;
        }

        .layer-drag-handle:active {
            cursor: grabbing;
        }

        /* Estados do Sortable para layers */
        .layer-sortable-ghost {
            opacity: 0.4;
            background-color: rgba(0, 123, 255, 0.1) !important;
        }

        .layer-sortable-chosen {
            background-color: rgba(0, 123, 255, 0.15) !important;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15) !important;
        }

        .layer-sortable-drag {
            opacity: 1 !important;
            background-color: white !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
        }
    `;
    document.head.appendChild(style);
}

/**
 * Injects CSS styles for loading spinner.
 */
export function injectSpinnerStyles() {
    if (document.getElementById('features-spinner-styles')) return;

    const style = document.createElement('style');
    style.id = 'features-spinner-styles';
    style.textContent = `
        .features-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            background-color: #ffffff;
        }

        .spinner {
            width: 24px;
            height: 24px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #007bff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 12px;
        }

        .loading-text {
            color: #666;
            font-size: 14px;
            font-weight: 500;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
}

/**
 * Injects all features tab styles.
 * Call once during initialization.
 */
export function injectAllFeaturesTabStyles() {
    injectAnalysisLayersStyles();
    injectGroupStyles();
    injectLayerStyles();
    injectSpinnerStyles();
}
