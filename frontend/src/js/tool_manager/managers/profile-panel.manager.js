// Path: js/tool_manager/managers/profile-panel.manager.js

/**
 * @fileoverview Gerenciador de painel de perfil de terreno.
 * Cria gráficos de elevação e linha de visada usando Chart.js.
 * Extraído de ui_manager.js para separação de responsabilidades.
 *
 * @module tool_manager/managers/profile-panel.manager
 */

import {
    Chart,
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Filler,
    Tooltip,
    Legend
} from 'chart.js';

// Register Chart.js components (tree-shaking friendly)
Chart.register(
    LineController,
    LineElement,
    PointElement,
    CategoryScale,
    LinearScale,
    Filler,
    Tooltip,
    Legend
);

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default slope threshold for cavalry mobility alerts (percentage).
 * Above this threshold, slopes are considered critical for vehicle movement.
 * Based on Brazilian Army mobility standards.
 */
const SLOPE_THRESHOLD = 30;

// ============================================================================
// PROFILE PANEL MANAGER
// ============================================================================

export class ProfilePanelManager {
    /**
     * @param {Object} selectionManager - Selection manager instance
     */
    constructor(selectionManager) {
        this.selectionManager = selectionManager;

        /** @type {Chart|null} Active Chart.js instance */
        this.activeChart = null;
    }

    /**
     * Get the slope threshold constant.
     * @returns {number}
     */
    static get SLOPE_THRESHOLD() {
        return SLOPE_THRESHOLD;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Show profile panel for selected features.
     * Only shows for single line/LOS features with profile data.
     * @param {Array<Object>} selectedFeatures
     */
    showProfilePanel(selectedFeatures) {
        if (selectedFeatures.length !== 1) {
            this.hideProfilePanel();
            return;
        }

        const feature = selectedFeatures[0];

        if (!('properties' in feature) || !('geometry' in feature)) {
            this.hideProfilePanel();
            return;
        }

        const { source } = feature.properties;
        const isLineFeature = feature.geometry.type === 'LineString';
        const hasProfileData = feature.properties.profileData && feature.properties.profile;

        if (source === 'los' && hasProfileData) {
            this.createProfilePanel(feature.properties.profileData, true, feature);
        } else if (source === 'line' && isLineFeature && hasProfileData) {
            this.createProfilePanel(feature.properties.profileData, false, feature);
        } else {
            this.hideProfilePanel();
        }
    }

    /**
     * Hide and cleanup profile panel.
     */
    hideProfilePanel() {
        if (this.activeChart) {
            try {
                this.activeChart.destroy();
            } catch (error) {
                console.warn('Error destroying chart:', error);
            }
            this.activeChart = null;
        }

        const panel = document.querySelector('.profile-panel');
        if (panel) {
            panel.remove();
        }
    }

    /**
     * Create elevation profile panel with chart.
     * @param {string} profileData - JSON string of profile data
     * @param {boolean} [linkFirstLast=false] - Show line of sight overlay
     * @param {Object} [_feature=null] - The feature for coordinate display
     */
    createProfilePanel(profileData, linkFirstLast = false, _feature = null) {
        let panel = document.querySelector('.profile-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'profile-panel';
            document.body.appendChild(panel);
        }

        // Cleanup previous chart
        if (this.activeChart) {
            try {
                this.activeChart.destroy();
            } catch (error) {
                console.warn('Error destroying previous chart:', error);
            }
            this.activeChart = null;
        }

        panel.innerHTML = '';

        // Build header
        this._buildPanelHeader(panel, linkFirstLast);

        // Parse data
        const profileDataParsed = JSON.parse(profileData);

        // Check for empty data (terrain not enabled)
        if (this._isProfileDataEmpty(profileDataParsed)) {
            this._showEmptyMessage(panel);
            return;
        }

        // Extract data
        const labels = profileDataParsed.map(d => d.distance.toFixed(0));
        const elevation = profileDataParsed.map(d => d.elevation);
        const slopes = profileDataParsed.map(d => d.slope ?? 0);
        const losElevation = profileDataParsed.map(d => d.losElevation);

        // Build slope info and toggle
        const maxSlope = Math.max(...slopes.map(s => Math.abs(s)));
        this._buildSlopeInfo(panel, maxSlope);
        this._buildSlopeToggle(panel);

        // Build chart
        this._buildChart(panel, labels, elevation, slopes, linkFirstLast, losElevation);
    }

    // ========================================================================
    // PRIVATE - UI BUILDING
    // ========================================================================

    /**
     * Build panel header with title and buttons.
     * @private
     */
    _buildPanelHeader(panel, isLOS) {
        const header = document.createElement('div');
        header.className = 'profile-panel-header';

        const title = document.createElement('h3');
        title.textContent = isLOS ? 'Linha de Visada' : 'Perfil do Terreno';
        header.appendChild(title);

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'profile-panel-buttons';

        // Save button
        const saveButton = document.createElement('button');
        saveButton.className = 'profile-save-button';
        saveButton.title = 'Salvar como imagem';
        saveButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        saveButton.addEventListener('click', () => this._saveChartAsImage(isLOS));
        buttonGroup.appendChild(saveButton);

        // Close button
        const closeButton = document.createElement('button');
        closeButton.className = 'close-button';
        closeButton.title = 'Fechar';
        closeButton.innerHTML = '×';
        closeButton.addEventListener('click', () => this._closeProfileAndUpdateFeature());
        buttonGroup.appendChild(closeButton);

        header.appendChild(buttonGroup);
        panel.appendChild(header);
    }

    /**
     * Show empty message when terrain data not available.
     * @private
     */
    _showEmptyMessage(panel) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'profile-empty-message';
        emptyMessage.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p>Dados de elevação não disponíveis</p>
            <span>Habilite o terreno 3D para visualizar o perfil de elevação</span>
        `;
        panel.appendChild(emptyMessage);
    }

    /**
     * Build slope info display.
     * @private
     */
    _buildSlopeInfo(panel, maxSlope) {
        const isCritical = maxSlope > SLOPE_THRESHOLD;
        const color = this._getSlopeAlertColor(maxSlope);

        const slopeInfoDiv = document.createElement('div');
        slopeInfoDiv.className = `profile-slope-info ${color}`;
        slopeInfoDiv.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                ${isCritical ?
                    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' :
                    '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'
                }
            </svg>
            <span>Inclinação máxima: ${maxSlope.toFixed(1)}%</span>
        `;
        panel.appendChild(slopeInfoDiv);
    }

    /**
     * Build slope toggle control.
     * @private
     */
    _buildSlopeToggle(panel) {
        const toggleContainer = document.createElement('div');
        toggleContainer.className = 'profile-slope-toggle';
        toggleContainer.innerHTML = `
            <label class="profile-toggle-label">
                <input type="checkbox" id="slopeToggle">
                <span class="profile-toggle-text">Mostrar inclinação</span>
            </label>
        `;
        panel.appendChild(toggleContainer);
    }

    /**
     * Build Chart.js chart.
     * @private
     */
    _buildChart(panel, labels, elevation, slopes, linkFirstLast, losElevation = []) {
        const chartContainer = document.createElement('div');
        chartContainer.className = 'profile-chart-container';
        panel.appendChild(chartContainer);

        const canvas = document.createElement('canvas');
        canvas.id = 'profileChart';
        chartContainer.appendChild(canvas);

        // Build datasets
        const datasets = [
            {
                label: 'Elevação',
                data: elevation,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.1)',
                fill: true,
                tension: 0.1,
                pointRadius: 3,
                pointHoverRadius: 6,
                yAxisID: 'y'
            }
        ];

        // Add line of sight if needed
        if (linkFirstLast) {
            const losDataset = this._buildLineOfSightDataset(labels, elevation, losElevation);
            datasets.push(losDataset);
        }

        // Create slope dataset for toggle
        const slopeDataset = this._buildSlopeDataset(slopes);

        this.activeChart = new Chart(canvas, {
            type: 'line',
            data: { labels, datasets },
            options: this._getChartOptions()
        });

        // Setup slope toggle
        this._setupSlopeToggle(slopeDataset);
    }

    /**
     * Build line of sight dataset.
     * Uses pre-calculated losElevation (includes observerHeight/targetHeight) when available,
     * otherwise falls back to linear interpolation between terrain endpoints.
     * @private
     */
    _buildLineOfSightDataset(labels, elevation, losElevation = []) {
        const hasLosElevation = losElevation.length === labels.length &&
            losElevation.some(v => v != null && !isNaN(v));

        let lineElevations;
        let intersectionIndex = -1;

        if (hasLosElevation) {
            // Use pre-calculated LOS elevations (accounts for observerHeight & targetHeight)
            lineElevations = losElevation;
            for (let i = 1; i < lineElevations.length - 1; i++) {
                if (intersectionIndex === -1 && elevation[i] >= lineElevations[i]) {
                    intersectionIndex = i;
                }
            }
        } else {
            // Fallback: linear interpolation between terrain endpoints (for line profiles)
            const firstElevation = elevation[0];
            const lastElevation = elevation[elevation.length - 1];
            const firstDistance = parseFloat(labels[0]);
            const lastDistance = parseFloat(labels[labels.length - 1]);
            const slopeLine = (lastElevation - firstElevation) / (lastDistance - firstDistance);

            lineElevations = labels.map((distance, i) => {
                const dist = parseFloat(distance);
                const lineElevation = slopeLine * (dist - firstDistance) + firstElevation;

                if (i !== 0 && i !== labels.length - 1 && intersectionIndex === -1 && elevation[i] >= lineElevation) {
                    intersectionIndex = i;
                }

                return lineElevation;
            });
        }

        return {
            label: 'Linha de visada',
            data: lineElevations,
            fill: false,
            tension: 0.1,
            pointRadius: 0,
            yAxisID: 'y',
            segment: {
                borderColor: ctx => ctx.p0DataIndex < intersectionIndex || intersectionIndex === -1 ? 'rgb(0, 255, 0)' : 'rgb(255, 0, 0)'
            }
        };
    }

    /**
     * Build slope dataset.
     * @private
     */
    _buildSlopeDataset(slopes) {
        return {
            label: 'Inclinação (%)',
            data: slopes,
            borderColor: 'rgba(156, 39, 176, 0.8)',
            backgroundColor: slopes.map(s => this._getSlopeColor(s)),
            fill: false,
            tension: 0.1,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: slopes.map(s => this._getSlopeColor(s)),
            pointBorderColor: slopes.map(s => this._getSlopeColor(s)),
            yAxisID: 'y1',
            segment: {
                borderColor: ctx => {
                    const slope = slopes[ctx.p1DataIndex];
                    return this._getSlopeColor(slope);
                }
            }
        };
    }

    /**
     * Get Chart.js options.
     * @private
     */
    _getChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: { size: 12 },
                    bodyFont: { size: 11 },
                    padding: 10,
                    cornerRadius: 4,
                    callbacks: {
                        title: (context) => `Distância: ${context[0].label} m`,
                        label: (context) => {
                            const value = context.parsed.y;
                            const datasetLabel = context.dataset.label;
                            if (datasetLabel === 'Inclinação (%)') {
                                const absValue = Math.abs(value);
                                const direction = value >= 0 ? 'subida' : 'descida';
                                const warning = absValue > SLOPE_THRESHOLD ? ' ⚠️' : '';
                                return `${datasetLabel}: ${value.toFixed(1)}% (${direction})${warning}`;
                            }
                            return `${datasetLabel}: ${value.toFixed(1)} m`;
                        }
                    }
                },
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 8,
                        font: { size: 11 }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Distância (m)',
                        font: { size: 11 }
                    },
                    ticks: { font: { size: 10 } }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Altitude (m)',
                        font: { size: 11 }
                    },
                    ticks: { font: { size: 10 } }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    display: false, // Hidden by default
                    title: {
                        display: true,
                        text: 'Inclinação (%)',
                        font: { size: 11 },
                        color: 'rgba(156, 39, 176, 0.8)'
                    },
                    ticks: {
                        font: { size: 10 },
                        color: 'rgba(156, 39, 176, 0.8)'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            }
        };
    }

    /**
     * Setup slope toggle event listener.
     * @private
     */
    _setupSlopeToggle(slopeDataset) {
        const slopeToggle = document.getElementById('slopeToggle');
        if (slopeToggle) {
            slopeToggle.addEventListener('change', (e) => {
                if (!this.activeChart) return;

                if (e.target.checked) {
                    // Add slope dataset
                    this.activeChart.data.datasets.push(slopeDataset);
                    this.activeChart.options.scales.y1.display = true;
                } else {
                    // Remove slope dataset
                    const slopeIndex = this.activeChart.data.datasets.findIndex(d => d.label === 'Inclinação (%)');
                    if (slopeIndex !== -1) {
                        this.activeChart.data.datasets.splice(slopeIndex, 1);
                    }
                    this.activeChart.options.scales.y1.display = false;
                }
                this.activeChart.update();
            });
        }
    }

    // ========================================================================
    // PRIVATE - HELPERS
    // ========================================================================

    /**
     * Check if profile data has valid (non-zero) elevation values.
     * @private
     */
    _isProfileDataEmpty(profileData) {
        if (!profileData || profileData.length === 0) return true;
        return profileData.every(d => d.elevation === 0 || d.elevation == null);
    }

    /**
     * Get color for slope value.
     * @private
     */
    _getSlopeColor(slope) {
        const absSlope = Math.abs(slope);
        if (absSlope > SLOPE_THRESHOLD) {
            return 'rgba(255, 82, 82, 0.8)'; // Critical - red
        } else if (absSlope > SLOPE_THRESHOLD * 0.6) {
            return 'rgba(255, 193, 7, 0.8)'; // Warning - yellow
        }
        return 'rgba(102, 187, 106, 0.8)'; // Normal - green
    }

    /**
     * Get alert color class for slope value.
     * @private
     */
    _getSlopeAlertColor(slope) {
        if (slope > SLOPE_THRESHOLD) return 'red';
        if (slope > SLOPE_THRESHOLD * 0.6) return 'yellow';
        return 'green';
    }

    /**
     * Save chart as PNG image with white background.
     * @private
     */
    _saveChartAsImage(isLOS) {
        if (!this.activeChart) return;

        const canvas = this.activeChart.canvas;

        // Create a new canvas with white background
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        // Fill with white background
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Draw the chart on top
        tempCtx.drawImage(canvas, 0, 0);

        const link = document.createElement('a');
        link.download = isLOS ? 'linha-de-visada.png' : 'perfil-terreno.png';
        link.href = tempCanvas.toDataURL('image/png', 1);
        link.click();
    }

    /**
     * Close profile panel and update the feature's profile property to false.
     * @private
     */
    _closeProfileAndUpdateFeature() {
        const selectedFeatures = this.selectionManager.getAllSelectedFeatures();

        if (selectedFeatures.length === 1) {
            const feature = selectedFeatures[0];
            const { source } = feature.properties;

            // Get the appropriate control from selectionManager and update the property
            const control = this.selectionManager.controls.get(source);
            if (control && typeof control.updateFeaturesProperty === 'function') {
                control.updateFeaturesProperty(selectedFeatures, 'profile', false);
            }

            // Update the toggle in the attribute panel directly
            const profileToggle = document.getElementById('profile-toggle');
            if (profileToggle && profileToggle.setChecked) {
                profileToggle.setChecked(false);
            }
        }

        this.hideProfilePanel();
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    /**
     * Cleanup resources.
     */
    destroy() {
        this.hideProfilePanel();
    }
}

