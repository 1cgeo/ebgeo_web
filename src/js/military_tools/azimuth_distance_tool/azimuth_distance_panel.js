// Path: js/military_tools/azimuth_distance_tool/azimuth_distance_panel.js

/**
 * @fileoverview Main panel for the Azimuth and Distance tool.
 * Implements the Caderneta de Campanha Digital UI.
 * Content only - rendered inside the existing FeaturePanel structure.
 *
 * @module military_tools/azimuth_distance_tool/azimuth_distance_panel
 */

import {
    COLORS,
    ANGULAR_UNIT,
    DISTANCE_UNIT,
    NORTH_REFERENCE,
    OUTPUT_MODE,
    OUTPUT_MODE_INFO,
    COMPASS_PRESETS,
    DEG_TO_MIL,
    MIL_TO_DEG
} from './azimuth_distance_constants.js';

import {
    calculateTotalDistance,
    formatTotalDistance,
    canCreateFeature
} from './azimuth_distance_geometry.js';

import {
    createCompassRoseComponent,
    createLegsTable,
    createReferencePointComponent,
    createSectionLabel
} from './components/index.js';

import {
    setupCleanup,
    addDomListener,
    cleanup
} from '../../utilities/event-cleanup.js';

import { showConfirm } from '../../modals/confirm.modal.js';

/**
 * Azimuth Distance Panel class.
 * Content-only panel that renders inside the FeaturePanel.
 */
export class AzimuthDistancePanel {
    /**
     * @param {Object} options - Panel options
     * @param {Function} options.onCreateFeature - Callback when create is clicked
     * @param {Function} options.onCancel - Callback when cancel is clicked
     * @param {Function} options.onRequestMapClick - Callback to request map click mode
     * @param {Function} options.onEditCoordinates - Callback to open coordinate modal
     * @param {Function} options.onStateChange - Callback when state changes (for preview update)
     * @param {Function} options.onResetReferencePoint - Callback when reference point is reset
     */
    constructor(options) {
        this._options = options;
        this._container = null;

        // State
        this._state = {
            referencePoint: null,
            angularUnit: ANGULAR_UNIT.DEGREES,
            distanceUnit: DISTANCE_UNIT.METERS,
            northReference: NORTH_REFERENCE.MAGNETIC,
            magneticDeclination: -21.5, // Default for Brazil
            outputMode: OUTPUT_MODE.ROUTE,
            activeIndex: 0,
            legs: [{ azimuth: '', distance: '' }]
        };

        // Component references
        this._refPointComponent = null;
        this._compassComponent = null;
        this._legsComponent = null;
        this._summaryElement = null;
        this._createButton = null;

        // Section references for rebuild
        this._unitTogglesSection = null;
        this._modeSelector = null;
        this._declinationSection = null;
        this._quickAzLabel = null;
        this._quickAzButtons = null;

        setupCleanup(this);
    }

    /**
     * Render the panel content (not the full panel structure).
     * @returns {HTMLElement} Content container
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'azimuth-distance-content';

        // Reference Point Section
        this._container.appendChild(this._createReferencePointSection());

        // Unit Toggles
        this._container.appendChild(this._createUnitToggles());

        // Output Mode Selector
        this._container.appendChild(this._createOutputModeSelector());

        // Declination Section
        this._container.appendChild(this._createDeclinationSection());

        // Compass Rose
        this._container.appendChild(this._createCompassSection());

        // Legs Section
        this._container.appendChild(this._createLegsSection());

        // Quick Azimuth Buttons
        this._container.appendChild(this._createQuickAzimuthSection());

        // Summary
        this._container.appendChild(this._createSummary());

        // Action Buttons
        this._container.appendChild(this._createActionButtons());

        return this._container;
    }

    // =========================================================================
    // REFERENCE POINT SECTION
    // =========================================================================

    _createReferencePointSection() {
        const section = document.createElement('div');
        section.className = 'azd-section';

        section.appendChild(createSectionLabel('Ponto de Referência (Origem)'));

        this._refPointComponent = createReferencePointComponent({
            referencePoint: this._state.referencePoint,
            onClickMap: () => this._options.onRequestMapClick?.(),
            onEditCoordinates: () => {
                if (this._state.referencePoint) {
                    this._options.onEditCoordinates?.(
                        this._state.referencePoint[1],
                        this._state.referencePoint[0]
                    );
                }
            },
            onReset: () => {
                this._state.referencePoint = null;
                this._options.onResetReferencePoint?.();
                // Update the reference point component to show "click to define" state
                this._updateAll();
            }
        });

        section.appendChild(this._refPointComponent.container);
        return section;
    }

    // =========================================================================
    // UNIT TOGGLES
    // =========================================================================

    _createUnitToggles() {
        const section = document.createElement('div');
        section.className = 'azd-section azd-unit-toggles';

        // Angular unit toggle
        const angToggle = this._createUnitToggle(
            'ANG',
            this._state.angularUnit === ANGULAR_UNIT.DEGREES ? 'Graus (°)' : 'Milésimos (₥)',
            () => this._toggleAngularUnit()
        );
        section.appendChild(angToggle);

        // Distance unit toggle
        const distToggle = this._createUnitToggle(
            'DIST',
            this._state.distanceUnit === DISTANCE_UNIT.METERS ? 'Metros (m)' : 'Quilômetros (km)',
            () => this._toggleDistanceUnit()
        );
        section.appendChild(distToggle);

        this._unitTogglesSection = section;
        return section;
    }

    _createUnitToggle(label, value, onClick) {
        const btn = document.createElement('button');
        btn.className = 'azd-unit-toggle';
        btn.innerHTML = `
            <span class="azd-unit-label">${label}</span>
            ${value}
        `;

        addDomListener(this, btn, 'click', onClick);
        return btn;
    }

    // =========================================================================
    // OUTPUT MODE SELECTOR
    // =========================================================================

    _createOutputModeSelector() {
        const section = document.createElement('div');
        section.className = 'azd-section azd-mode-selector';

        Object.values(OUTPUT_MODE_INFO).forEach(mode => {
            const btn = this._createModeButton(mode);
            section.appendChild(btn);
        });

        this._modeSelector = section;
        return section;
    }

    _createModeButton(mode) {
        const isActive = this._state.outputMode === mode.id;

        const btn = document.createElement('button');
        btn.dataset.mode = mode.id;
        btn.title = mode.description;
        btn.className = `azd-mode-btn ${isActive ? 'active' : ''}`;

        // Icon
        const iconSvg = this._getModeIcon(mode.id, isActive);
        btn.appendChild(iconSvg);

        // Label
        const label = document.createElement('span');
        label.className = 'azd-mode-label';
        label.textContent = mode.label;
        btn.appendChild(label);

        addDomListener(this, btn, 'click', () => this._setOutputMode(mode.id));

        return btn;
    }

    _getModeIcon(mode, active) {
        const color = active ? COLORS.primary700 : COLORS.gray500;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '22');
        svg.setAttribute('height', '22');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', color);
        svg.setAttribute('stroke-width', '2');

        switch (mode) {
            case OUTPUT_MODE.POINT:
                svg.innerHTML = `
                    <circle cx="12" cy="10" r="3"/>
                    <path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z"/>
                `;
                break;
            case OUTPUT_MODE.ROUTE:
                svg.innerHTML = `
                    <polyline points="4 20 8 10 14 16 20 4" stroke-linejoin="round"/>
                    <circle cx="4" cy="20" r="1.5" fill="${color}"/>
                    <circle cx="20" cy="4" r="1.5" fill="${color}"/>
                `;
                break;
            case OUTPUT_MODE.AREA:
                svg.setAttribute('fill', active ? 'rgba(22,163,74,0.12)' : 'none');
                svg.innerHTML = `
                    <polygon points="12 3 21 10 18 21 6 21 3 10"/>
                `;
                break;
        }

        return svg;
    }

    // =========================================================================
    // DECLINATION SECTION
    // =========================================================================

    _createDeclinationSection() {
        const section = document.createElement('div');
        section.className = 'azd-section azd-declination';
        const showWarning = this._state.northReference === NORTH_REFERENCE.MAGNETIC &&
            this._state.magneticDeclination !== 0;

        if (showWarning) {
            section.classList.add('azd-declination-active');
        }

        section.appendChild(createSectionLabel('Norte de Referência'));

        const row = document.createElement('div');
        row.className = 'azd-declination-row';

        // NM/NV Toggle
        const northToggle = document.createElement('div');
        northToggle.className = 'azd-north-toggle';

        const nmBtn = this._createNorthButton('NM', 'Norte Magnético (bússola)', NORTH_REFERENCE.MAGNETIC);
        const nvBtn = this._createNorthButton('NV', 'Norte Verdadeiro (carta)', NORTH_REFERENCE.TRUE);
        northToggle.appendChild(nmBtn);
        northToggle.appendChild(nvBtn);
        row.appendChild(northToggle);

        // Declination input
        const isDisabled = this._state.northReference === NORTH_REFERENCE.TRUE;
        const declContainer = document.createElement('div');
        declContainer.className = `azd-decl-container ${isDisabled ? 'disabled' : ''}`;

        const declLabel = document.createElement('span');
        declLabel.className = 'azd-decl-label';
        declLabel.textContent = 'Decl:';
        declContainer.appendChild(declLabel);

        const declInput = document.createElement('input');
        declInput.type = 'number';
        declInput.className = 'azd-decl-input';
        declInput.value = this._state.magneticDeclination;
        declInput.step = '0.5';
        declInput.disabled = isDisabled;

        addDomListener(this, declInput, 'input', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) {
                this._state.magneticDeclination = Math.max(-45, Math.min(45, val));
                // Update compass to reflect new declination
                this._updateCompass();
                // Update declination helper text without rebuilding input
                this._updateDeclinationHelper();
                // Notify for map preview update
                this._notifyStateChange();
            }
        });

        this._declInput = declInput;
        declContainer.appendChild(declInput);

        const unitLabel = document.createElement('span');
        unitLabel.className = 'azd-decl-unit';
        unitLabel.textContent = '°';
        declContainer.appendChild(unitLabel);

        row.appendChild(declContainer);
        section.appendChild(row);

        // Helper text
        const helper = document.createElement('div');
        helper.className = 'azd-decl-helper';

        const helperLeft = document.createElement('span');
        helperLeft.textContent = 'Oeste (−) / Leste (+)';
        helper.appendChild(helperLeft);

        if (showWarning) {
            const helperRight = document.createElement('span');
            helperRight.className = 'azd-decl-warning';
            const sign = this._state.magneticDeclination > 0 ? '+' : '';
            helperRight.textContent = `Correção ativa: ${sign}${this._state.magneticDeclination}°`;
            helper.appendChild(helperRight);
        }

        section.appendChild(helper);

        this._declinationSection = section;
        return section;
    }

    _createNorthButton(label, title, northRef) {
        const isActive = this._state.northReference === northRef;
        const btn = document.createElement('button');
        btn.title = title;
        btn.className = `azd-north-btn ${isActive ? 'active' : ''} ${northRef === NORTH_REFERENCE.MAGNETIC ? 'nm' : 'nv'}`;
        btn.textContent = label;

        addDomListener(this, btn, 'click', () => this._setNorthReference(northRef));

        return btn;
    }

    // =========================================================================
    // COMPASS SECTION
    // =========================================================================

    _createCompassSection() {
        const section = document.createElement('div');
        section.className = 'azd-section azd-compass';

        const activeAzDeg = this._getActiveAzimuthDeg();
        const declInDeg = this._state.northReference === NORTH_REFERENCE.MAGNETIC
            ? this._state.magneticDeclination : 0;

        this._compassComponent = createCompassRoseComponent({
            azimuthDeg: activeAzDeg,
            size: 156,
            declination: declInDeg,
            northRef: this._state.northReference
        });

        section.appendChild(this._compassComponent.container);

        return section;
    }

    // =========================================================================
    // LEGS SECTION
    // =========================================================================

    _createLegsSection() {
        const section = document.createElement('div');
        section.className = 'azd-section';

        this._legsComponent = createLegsTable({
            legs: this._state.legs,
            activeIndex: this._state.activeIndex,
            angularUnit: this._state.angularUnit,
            distanceUnit: this._state.distanceUnit,
            onChange: (index, field, value) => this._updateLeg(index, field, value),
            onRemove: (index) => this._removeLeg(index),
            onFocus: (index) => this._setActiveLeg(index),
            onAdd: () => this._addLeg()
        });

        section.appendChild(this._legsComponent.container);

        return section;
    }

    // =========================================================================
    // QUICK AZIMUTH SECTION
    // =========================================================================

    _createQuickAzimuthSection() {
        const section = document.createElement('div');
        section.className = 'azd-section';

        const label = createSectionLabel(`Azimute rápido → Perna ${this._state.activeIndex + 1}`);
        section.appendChild(label);
        this._quickAzLabel = label;

        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'azd-quick-buttons';
        buttonsContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
        `;

        COMPASS_PRESETS.forEach(preset => {
            const btn = this._createQuickAzimuthButton(preset);
            buttonsContainer.appendChild(btn);
        });

        section.appendChild(buttonsContainer);
        this._quickAzButtons = buttonsContainer;

        return section;
    }

    _createQuickAzimuthButton(preset) {
        const value = this._state.angularUnit === ANGULAR_UNIT.MILS
            ? Math.round(preset.deg * DEG_TO_MIL)
            : preset.deg;
        const isN = preset.label === 'N';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `azd-quick-btn ${isN ? 'north' : ''}`;
        btn.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            padding: 10px 8px;
            border: 1px solid ${isN ? COLORS.red600 : COLORS.gray300};
            border-radius: 6px;
            background: ${isN ? COLORS.red50 : COLORS.white};
            cursor: pointer;
            transition: all 0.15s;
            min-height: 50px;
        `;

        const labelSpan = document.createElement('span');
        labelSpan.className = 'azd-quick-label';
        labelSpan.style.cssText = `
            font-size: 14px;
            font-weight: 700;
            color: ${isN ? COLORS.red600 : COLORS.gray700};
        `;
        labelSpan.textContent = preset.label;
        btn.appendChild(labelSpan);

        const valueSpan = document.createElement('span');
        valueSpan.className = 'azd-quick-value';
        valueSpan.style.cssText = `
            font-size: 11px;
            font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
            color: ${COLORS.gray500};
        `;
        valueSpan.textContent = this._state.angularUnit === ANGULAR_UNIT.MILS ? `${value}₥` : `${value}°`;
        btn.appendChild(valueSpan);

        // Hover effects
        btn.addEventListener('mouseenter', () => {
            if (!isN) {
                btn.style.borderColor = COLORS.primary600;
                btn.style.background = COLORS.primary50;
            }
        });
        btn.addEventListener('mouseleave', () => {
            if (!isN) {
                btn.style.borderColor = COLORS.gray300;
                btn.style.background = COLORS.white;
            }
        });

        addDomListener(this, btn, 'click', () => this._applyQuickAzimuth(preset.deg));

        return btn;
    }

    // =========================================================================
    // SUMMARY
    // =========================================================================

    _createSummary() {
        const section = document.createElement('div');
        section.className = 'azd-summary';

        const legsCount = document.createElement('span');
        legsCount.innerHTML = `<b>${this._state.legs.length}</b> perna${this._state.legs.length !== 1 ? 's' : ''}`;
        section.appendChild(legsCount);

        const totalDist = calculateTotalDistance(this._state.legs, this._state.distanceUnit);
        const totalSpan = document.createElement('span');
        totalSpan.innerHTML = `Total: <b class="azd-summary-total">${formatTotalDistance(totalDist, this._state.distanceUnit)}</b>`;
        section.appendChild(totalSpan);

        this._summaryElement = section;
        return section;
    }

    // =========================================================================
    // ACTION BUTTONS
    // =========================================================================

    _createActionButtons() {
        const section = document.createElement('div');
        section.className = 'azd-actions';

        // Cancel button
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'azd-btn azd-btn-cancel';
        cancelBtn.textContent = 'Cancelar';
        addDomListener(this, cancelBtn, 'click', () => this._options.onCancel?.());
        section.appendChild(cancelBtn);

        // Create button
        const createBtn = document.createElement('button');
        createBtn.className = 'azd-btn azd-btn-create';
        createBtn.textContent = `Criar ${OUTPUT_MODE_INFO[this._state.outputMode].label}`;

        addDomListener(this, createBtn, 'click', () => this._handleCreate());

        this._createButton = createBtn;
        section.appendChild(createBtn);

        return section;
    }

    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================

    _toggleAngularUnit() {
        if (this._state.angularUnit === ANGULAR_UNIT.DEGREES) {
            // Convert all azimuths to mils
            this._state.legs = this._state.legs.map(leg => ({
                ...leg,
                azimuth: leg.azimuth !== '' && leg.azimuth != null
                    ? Math.round(Number(leg.azimuth) * DEG_TO_MIL)
                    : ''
            }));
            this._state.angularUnit = ANGULAR_UNIT.MILS;
        } else {
            // Convert all azimuths to degrees
            this._state.legs = this._state.legs.map(leg => ({
                ...leg,
                azimuth: leg.azimuth !== '' && leg.azimuth != null
                    ? parseFloat((Number(leg.azimuth) * MIL_TO_DEG).toFixed(1))
                    : ''
            }));
            this._state.angularUnit = ANGULAR_UNIT.DEGREES;
        }
        this._updateAll();
    }

    _toggleDistanceUnit() {
        if (this._state.distanceUnit === DISTANCE_UNIT.METERS) {
            // Convert all distances to km
            this._state.legs = this._state.legs.map(leg => ({
                ...leg,
                distance: leg.distance
                    ? parseFloat((Number(leg.distance) / 1000).toFixed(3))
                    : ''
            }));
            this._state.distanceUnit = DISTANCE_UNIT.KILOMETERS;
        } else {
            // Convert all distances to meters
            this._state.legs = this._state.legs.map(leg => ({
                ...leg,
                distance: leg.distance
                    ? Math.round(Number(leg.distance) * 1000)
                    : ''
            }));
            this._state.distanceUnit = DISTANCE_UNIT.METERS;
        }
        this._updateAll();
    }

    _setOutputMode(mode) {
        this._state.outputMode = mode;
        this._updateAll();
    }

    _setNorthReference(ref) {
        this._state.northReference = ref;
        this._updateAll();
    }

    _updateLeg(index, field, value) {
        this._state.legs[index][field] = value;
        // Don't call _updateAll() here - it would rebuild the legs table
        // and cause the input to lose focus while typing.
        // Instead, just update the parts that need refreshing:
        this._updateSummary();
        this._updateCompass();
        this._notifyStateChange();
    }

    _removeLeg(index) {
        if (this._state.legs.length > 1) {
            this._state.legs.splice(index, 1);
            this._state.activeIndex = Math.min(this._state.activeIndex, this._state.legs.length - 1);
            this._updateAll();
        }
    }

    _addLeg() {
        this._state.legs.push({ azimuth: '', distance: '' });
        this._state.activeIndex = this._state.legs.length - 1;
        this._updateAll();
    }

    _setActiveLeg(index) {
        // Don't do anything if already active
        if (this._state.activeIndex === index) {
            return;
        }

        this._state.activeIndex = index;

        // Update visual state without rebuilding inputs
        // Just update the quick azimuth label and compass
        if (this._quickAzLabel) {
            this._quickAzLabel.textContent = `Azimute rápido → Perna ${index + 1}`;
        }
        this._updateCompass();

        // Update row visual states (active highlighting)
        this._updateLegRowStyles();
    }

    _updateLegRowStyles() {
        const rows = this._container?.querySelectorAll('.azimuth-distance-leg-row');
        if (!rows) return;

        rows.forEach((row, i) => {
            const isActive = i === this._state.activeIndex;
            row.style.background = isActive ? 'rgba(22,163,74,0.05)' : 'transparent';

            // Update badge color
            const badge = row.querySelector('.leg-badge');
            if (badge) {
                badge.style.background = isActive ? '#16a34a' : '#e5e7eb';
                badge.style.color = isActive ? '#ffffff' : '#6b7280';
            }
        });
    }

    _applyQuickAzimuth(degValue) {
        const value = this._state.angularUnit === ANGULAR_UNIT.MILS
            ? Math.round(degValue * DEG_TO_MIL)
            : degValue;
        this._state.legs[this._state.activeIndex].azimuth = value;
        this._updateAll();
    }

    _getActiveAzimuthDeg() {
        const az = this._state.legs[this._state.activeIndex]?.azimuth;
        if (az === '' || az == null) return 0;
        return this._state.angularUnit === ANGULAR_UNIT.MILS
            ? Number(az) * MIL_TO_DEG
            : Number(az);
    }

    async _handleCreate() {
        const { canCreate, reason } = canCreateFeature(
            this._state.referencePoint,
            this._state.legs,
            this._state.outputMode
        );

        if (!canCreate) {
            await showConfirm('Dados incompletos', {
                message: reason,
                confirmText: 'OK',
                cancelText: null
            });
            return;
        }

        this._options.onCreateFeature?.(this.getState());
    }

    _notifyStateChange() {
        this._options.onStateChange?.(this.getState());
    }

    // =========================================================================
    // UPDATE ALL COMPONENTS
    // =========================================================================

    _updateAll() {
        // Update reference point
        if (this._refPointComponent) {
            this._refPointComponent.update({
                referencePoint: this._state.referencePoint,
                onClickMap: () => this._options.onRequestMapClick?.(),
                onEditCoordinates: () => {
                    if (this._state.referencePoint) {
                        this._options.onEditCoordinates?.(
                            this._state.referencePoint[1],
                            this._state.referencePoint[0]
                        );
                    }
                },
                onReset: () => {
                    this._state.referencePoint = null;
                    this._options.onResetReferencePoint?.();
                    // Update the reference point component to show "click to define" state
                    this._updateAll();
                }
            });
        }

        // Update compass
        if (this._compassComponent) {
            const activeAzDeg = this._getActiveAzimuthDeg();
            const declInDeg = this._state.northReference === NORTH_REFERENCE.MAGNETIC
                ? this._state.magneticDeclination : 0;

            this._compassComponent.update({
                azimuthDeg: activeAzDeg,
                size: 156,
                declination: declInDeg,
                northRef: this._state.northReference
            });
        }

        // Update legs table
        if (this._legsComponent) {
            this._legsComponent.update({
                legs: this._state.legs,
                activeIndex: this._state.activeIndex,
                angularUnit: this._state.angularUnit,
                distanceUnit: this._state.distanceUnit,
                onChange: (index, field, value) => this._updateLeg(index, field, value),
                onRemove: (index) => this._removeLeg(index),
                onFocus: (index) => this._setActiveLeg(index),
                onAdd: () => this._addLeg()
            });
        }

        // Update summary
        this._updateSummary();

        // Update create button text
        if (this._createButton) {
            this._createButton.textContent = `Criar ${OUTPUT_MODE_INFO[this._state.outputMode].label}`;
        }

        // Update quick azimuth label
        if (this._quickAzLabel) {
            this._quickAzLabel.textContent = `Azimute rápido → Perna ${this._state.activeIndex + 1}`;
        }

        // Rebuild sections that need full refresh
        this._rebuildUnitToggles();
        this._rebuildModeSelector();
        this._rebuildDeclinationSection();
        this._rebuildQuickAzimuthButtons();

        // Notify state change for map preview
        this._notifyStateChange();
    }

    _updateSummary() {
        if (this._summaryElement) {
            const totalDist = calculateTotalDistance(this._state.legs, this._state.distanceUnit);
            this._summaryElement.innerHTML = '';

            const legsCount = document.createElement('span');
            legsCount.innerHTML = `<b>${this._state.legs.length}</b> perna${this._state.legs.length !== 1 ? 's' : ''}`;
            this._summaryElement.appendChild(legsCount);

            const totalSpan = document.createElement('span');
            totalSpan.innerHTML = `Total: <b class="azd-summary-total">${formatTotalDistance(totalDist, this._state.distanceUnit)}</b>`;
            this._summaryElement.appendChild(totalSpan);
        }
    }

    _updateCompass() {
        if (this._compassComponent) {
            const activeAzDeg = this._getActiveAzimuthDeg();
            const declInDeg = this._state.northReference === NORTH_REFERENCE.MAGNETIC
                ? this._state.magneticDeclination : 0;

            this._compassComponent.update({
                azimuthDeg: activeAzDeg,
                size: 156,
                declination: declInDeg,
                northRef: this._state.northReference
            });
        }
    }

    _updateDeclinationHelper() {
        if (!this._declinationSection) return;

        // Find the helper element
        const helper = this._declinationSection.querySelector('.azd-decl-helper');
        if (!helper) return;

        // Update or create warning text
        const showWarning = this._state.northReference === NORTH_REFERENCE.MAGNETIC &&
            this._state.magneticDeclination !== 0;

        let warningSpan = helper.querySelector('.azd-decl-warning');

        if (showWarning) {
            const sign = this._state.magneticDeclination > 0 ? '+' : '';
            const warningText = `Correção ativa: ${sign}${this._state.magneticDeclination}°`;

            if (warningSpan) {
                warningSpan.textContent = warningText;
            } else {
                warningSpan = document.createElement('span');
                warningSpan.className = 'azd-decl-warning';
                warningSpan.textContent = warningText;
                helper.appendChild(warningSpan);
            }

            // Update section styling
            this._declinationSection.classList.add('azd-declination-active');
        } else {
            if (warningSpan) {
                warningSpan.remove();
            }
            this._declinationSection.classList.remove('azd-declination-active');
        }
    }

    _rebuildUnitToggles() {
        if (!this._unitTogglesSection) return;

        this._unitTogglesSection.innerHTML = '';

        const angToggle = this._createUnitToggle(
            'ANG',
            this._state.angularUnit === ANGULAR_UNIT.DEGREES ? 'Graus (°)' : 'Milésimos (₥)',
            () => this._toggleAngularUnit()
        );
        this._unitTogglesSection.appendChild(angToggle);

        const distToggle = this._createUnitToggle(
            'DIST',
            this._state.distanceUnit === DISTANCE_UNIT.METERS ? 'Metros (m)' : 'Quilômetros (km)',
            () => this._toggleDistanceUnit()
        );
        this._unitTogglesSection.appendChild(distToggle);
    }

    _rebuildModeSelector() {
        if (!this._modeSelector) return;

        this._modeSelector.innerHTML = '';
        Object.values(OUTPUT_MODE_INFO).forEach(mode => {
            const btn = this._createModeButton(mode);
            this._modeSelector.appendChild(btn);
        });
    }

    _rebuildDeclinationSection() {
        if (!this._declinationSection || !this._declinationSection.parentNode) return;

        const parent = this._declinationSection.parentNode;
        const nextSibling = this._declinationSection.nextSibling;

        // Remove old section
        parent.removeChild(this._declinationSection);

        // Create new section
        const newSection = this._createDeclinationSection();

        // Insert at same position
        if (nextSibling) {
            parent.insertBefore(newSection, nextSibling);
        } else {
            parent.appendChild(newSection);
        }
    }

    _rebuildQuickAzimuthButtons() {
        if (!this._quickAzButtons) return;

        this._quickAzButtons.innerHTML = '';
        // Maintain the grid style
        this._quickAzButtons.style.cssText = `
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
        `;
        COMPASS_PRESETS.forEach(preset => {
            const btn = this._createQuickAzimuthButton(preset);
            this._quickAzButtons.appendChild(btn);
        });
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Set reference point from map click.
     * @param {number} lng - Longitude
     * @param {number} lat - Latitude
     */
    setReferencePoint(lng, lat) {
        this._state.referencePoint = [lng, lat];
        this._updateAll();
    }

    /**
     * Get current state.
     * @returns {Object} Current state
     */
    getState() {
        return { ...this._state };
    }

    /**
     * Reset panel to initial state.
     */
    reset() {
        this._state = {
            referencePoint: null,
            angularUnit: ANGULAR_UNIT.DEGREES,
            distanceUnit: DISTANCE_UNIT.METERS,
            northReference: NORTH_REFERENCE.MAGNETIC,
            magneticDeclination: -21.5,
            outputMode: OUTPUT_MODE.ROUTE,
            activeIndex: 0,
            legs: [{ azimuth: '', distance: '' }]
        };
        this._updateAll();
    }

    /**
     * Get container element.
     * @returns {HTMLElement}
     */
    getContainer() {
        return this._container;
    }

    /**
     * Destroy panel and cleanup.
     */
    destroy() {
        cleanup(this);
        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._container = null;
    }
}
