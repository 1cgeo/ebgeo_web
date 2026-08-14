// Path: js/tool_manager/tabbed_attribute_panel.js

/**
 * @fileoverview Tabbed panel stylesheet injector.
 * The panel builder itself was removed once `sidebar/components/feature-tabs.js`
 * took over building the feature panel; only the CSS injection is still wired.
 */

/**
 * Inject TabbedAttributePanel CSS styles.
 * Call once during initialization.
 */
export function injectTabbedPanelStyles() {
    if (document.getElementById('tabbed-panel-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'tabbed-panel-styles';
    styles.textContent = `
        .tabbed-attribute-panel {
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        .tabbed-panel-buttons {
            display: flex;
            border-bottom: 1px solid #e0e0e0;
            background: #f5f5f5;
            flex-shrink: 0;
        }

        .tabbed-panel-btn {
            flex: 1;
            padding: 10px 12px;
            border: none;
            background: transparent;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            color: #666;
            transition: all 0.2s ease;
            border-bottom: 2px solid transparent;
        }

        .tabbed-panel-btn:hover {
            background: #e8e8e8;
            color: #333;
        }

        .tabbed-panel-btn.active {
            color: #1976d2;
            border-bottom-color: #1976d2;
            background: #fff;
        }

        .tabbed-panel-content {
            display: none;
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }

        .tabbed-panel-content.active {
            display: block;
        }
    `;
    document.head.appendChild(styles);
}
