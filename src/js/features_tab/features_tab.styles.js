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
        /* Group container - design flat sem bordas */
        .group-container {
            background: transparent;
            overflow: hidden;
        }

        /* Group header - estilo similar ao models3d-category-header */
        .group-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            cursor: pointer;
            user-select: none;
            transition: background 0.15s ease;
        }

        .group-header:hover {
            background: #f8f9fa;
        }

        .group-header.group-hidden {
            opacity: 0.6;
        }

        .group-header.group-locked {
            background-color: #fffbf0;
        }

        .group-expand-icon {
            width: 16px;
            height: 16px;
            color: #666;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease;
        }

        .group-header:hover .group-expand-icon {
            color: #333;
        }

        .group-expand-icon.expanded {
            transform: rotate(0deg);
        }

        .group-expand-icon.collapsed {
            transform: rotate(-90deg);
        }

        .group-icon {
            width: 14px;
            height: 14px;
            color: #666;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .group-name {
            flex: 1;
            font-weight: 500;
            font-size: 13px;
            color: #333;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .group-count {
            padding: 1px 6px;
            background: #f0f0f0;
            border-radius: 9999px;
            font-size: 11px;
            color: #666;
        }

        .group-controls {
            display: flex;
            align-items: center;
            gap: 2px;
            margin-left: 4px;
        }

        .group-controls button {
            width: 22px;
            height: 22px;
            padding: 0;
            background: none;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            color: #666;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease, background 0.15s ease;
        }

        .group-controls button:hover {
            background: #f0f0f0;
            color: #28a745;
        }

        .group-controls .lock-toggle svg {
            color: #dc3545;
        }

        .group-features-list {
            display: flex;
            flex-direction: column;
            padding-left: 20px;
            overflow: hidden;
            transition: max-height 0.2s ease;
        }

        .group-features-list.expanded {
            max-height: 1000px;
        }

        /* Group feature item - design flat com linha cinza */
        .group-feature-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            cursor: pointer;
            border-left: 2px solid #e0e0e0;
            margin-left: 8px;
            transition: background 0.15s ease, border-left-color 0.15s ease;
        }

        .group-feature-item:hover {
            background: #f8f9fa;
            border-left-color: #28a745;
        }

        .group-feature-item.feature-hidden {
            opacity: 0.5;
        }

        .group-feature-main {
            display: flex;
            align-items: center;
            flex: 1;
            cursor: pointer;
            min-width: 0;
        }

        .group-feature-type-icon {
            width: 14px;
            height: 14px;
            margin-right: 8px;
            color: #28a745;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .group-feature-name {
            font-size: 13px;
            color: #333;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* Feature item - design flat com linha cinza */
        .feature-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            cursor: pointer;
            border-left: 2px solid #e0e0e0;
            margin-left: 8px;
            transition: background 0.15s ease, border-left-color 0.15s ease;
        }

        .feature-item:hover {
            background: #f8f9fa;
            border-left-color: #28a745;
        }

        .feature-item.feature-hidden {
            opacity: 0.5;
        }

        .feature-item.feature-locked {
            background-color: #fffbf0;
        }

        .feature-main {
            display: flex;
            align-items: center;
            flex: 1;
            cursor: pointer;
            min-width: 0;
        }

        .feature-type-icon {
            width: 14px;
            height: 14px;
            margin-right: 8px;
            color: #28a745;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .feature-name {
            font-size: 13px;
            color: #333;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .feature-controls {
            display: flex;
            align-items: center;
            gap: 2px;
        }

        .feature-controls button {
            width: 22px;
            height: 22px;
            padding: 0;
            background: none;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            color: #666;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease, background 0.15s ease;
        }

        .feature-controls button:hover {
            background: #f0f0f0;
            color: #28a745;
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
        /* Container de cada layer na lista - design flat como modelos 3D */
        .layer-container {
            background: white;
            border-radius: 6px;
            overflow: hidden;
        }

        .layer-container.layer-active .layer-header {
            border-left: 3px solid #28a745;
            padding-left: 9px;
        }

        .layer-container.layer-hidden {
            opacity: 0.6;
        }

        .layer-container.layer-locked .layer-header {
            background-color: #fffbf0;
        }

        /* Header da layer - estilo similar ao models3d-tileset-header */
        .layer-header {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background: transparent;
            cursor: pointer;
            user-select: none;
            gap: 8px;
            transition: background 0.15s ease;
        }

        .layer-header:hover {
            background: #f8f9fa;
        }

        .layer-header.active {
            background: transparent;
        }

        .layer-radio {
            margin: 0;
            cursor: pointer;
            accent-color: #28a745;
        }

        .layer-expand-icon {
            width: 28px;
            height: 28px;
            color: #666;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease;
        }

        .layer-expand-icon:hover {
            color: #333;
        }

        .layer-expand-icon svg {
            width: 18px;
            height: 18px;
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
            padding: 2px 8px;
            background: #f0f0f0;
            border-radius: 9999px;
            font-size: 11px;
            color: #666;
            flex-shrink: 0;
        }

        .layer-controls {
            display: flex;
            align-items: center;
            gap: 2px;
        }

        .layer-controls button {
            width: 24px;
            height: 24px;
            padding: 0;
            background: none;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            color: #666;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: color 0.15s ease, background 0.15s ease;
        }

        .layer-controls button:hover:not(:disabled) {
            color: #28a745;
            background: #f0f0f0;
        }

        .layer-controls button:disabled {
            cursor: not-allowed;
            opacity: 0.3;
        }

        .layer-delete-btn:hover:not(:disabled) {
            color: #dc3545 !important;
        }

        /* Layer content - design flat */
        .layer-content {
            display: flex;
            flex-direction: column;
            padding-left: 20px;
            overflow: hidden;
            transition: max-height 0.2s ease;
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
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: grab;
            color: #999;
            user-select: none;
            flex-shrink: 0;
            transition: color 0.15s ease;
        }

        .layer-drag-handle:hover {
            color: #28a745;
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

        /* Empty layer message */
        .layer-empty-message {
            padding: 8px 12px;
            text-align: center;
            color: #999;
            font-size: 13px;
            font-style: italic;
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
 * Injects CSS styles for 3D viewer mode (disabled sections).
 */
export function inject3DViewerModeStyles() {
    if (document.getElementById('features-3d-mode-styles')) return;

    const style = document.createElement('style');
    style.id = 'features-3d-mode-styles';
    style.textContent = `
        /* Disabled sections when 3D viewer is open */
        .disabled-3d-mode {
            pointer-events: none;
            opacity: 0.4;
            filter: grayscale(30%);
            position: relative;
        }

        .disabled-3d-mode::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255, 255, 255, 0.1);
            cursor: not-allowed;
        }

        /* Active 3D section highlight */
        .active-3d-mode {
            background: #f0f9f0;
            border-left: 3px solid #28a745;
            margin-left: -3px;
            padding-left: 3px;
        }

        .active-3d-mode .sidebar-section-header {
            color: #28a745;
            font-weight: 600;
        }

        /* Disabled section header tooltip */
        .disabled-3d-mode .sidebar-section-header::after {
            content: 'Desabilitado no modo 3D';
            position: absolute;
            bottom: -18px;
            left: 12px;
            font-size: 10px;
            color: #999;
            font-weight: normal;
            white-space: nowrap;
        }

        /* Make sure the features-list shows disabled message clearly */
        .features-list.disabled-3d-mode .layer-container,
        .features-list.disabled-3d-mode .feature-item,
        .features-list.disabled-3d-mode .group-container {
            opacity: 0.6;
        }

        /* Sidebar section header disabled state */
        .sidebar-section-header-with-action.disabled-3d-mode {
            position: relative;
        }

        .sidebar-section-header-with-action.disabled-3d-mode button {
            pointer-events: none;
            opacity: 0.3;
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
    inject3DViewerModeStyles();
}
