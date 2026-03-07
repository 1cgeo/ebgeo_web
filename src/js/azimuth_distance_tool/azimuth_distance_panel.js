// Path: js/azimuth_distance_tool/azimuth_distance_panel.js

/**
 * @fileoverview Main panel for the Azimuth and Distance tool.
 * Implements the Caderneta de Campanha Digital UI.
 * Content only - rendered inside the existing FeaturePanel structure.
 *
 * @module azimuth_distance_tool/azimuth_distance_panel
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

import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { calculateMagneticDeclination } from '@utils/geomagnetic/wmm_calculator.js';

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
            magneticDeclination: -21.5,
            autoDeclinationValue: null,
            autoDeclinationWarning: null,
            manuallyEdited: false,
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
        this._declInput = null;

        setupCleanup(this);
    }

    /**
     * Render the panel content (not the full panel structure).
     * @returns {HTMLElement} Content container
     */
    render() {
        this._container = document.createElement('div');
        this._container.className = 'azimuth-distance-content';

        this._container.appendChild(this._createReferencePointSection());
        this._container.appendChild(this._createUnitToggles());
        this._container.appendChild(this._createOutputModeSelector());
        this._container.appendChild(this._createDeclinationSection());
        this._container.appendChild(this._createCompassSection());
        this._container.appendChild(this._createLegsSection());
        this._container.appendChild(this._createQuickAzimuthSection());
        this._container.appendChild(this._createSummary());
        this._container.appendChild(this._createActionButtons());

        return this._container;
    }

    // =========================================================================
    // REFERENCE POINT SECTION
    // =========================================================================

    _createReferencePointSection() {
        const section = document.createElement('div');
        section.className = 'azd-section';

        section.appendChild(createSectionLabel('Ponto de Refer\u00EAncia (Origem)'));

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

        section.appendChild(this._createUnitToggle(
            'ANG',
            this._state.angularUnit === ANGULAR_UNIT.DEGREES ? 'Graus (\u00B0)' : 'Mil\u00E9simos (\u20A5)',
            () => this._toggleAngularUnit()
        ));

        section.appendChild(this._createUnitToggle(
            'DIST',
            this._state.distanceUnit === DISTANCE_UNIT.METERS ? 'Metros (m)' : 'Quil\u00F4metros (km)',
            () => this._toggleDistanceUnit()
        ));

        this._unitTogglesSection = section;
        return section;
    }

    _createUnitToggle(label, value, onClick) {
        const btn = document.createElement('button');
        btn.className = 'azd-unit-toggle';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'azd-unit-label';
        labelSpan.textContent = label;
        btn.appendChild(labelSpan);

        btn.appendChild(document.createTextNode(` ${value}`));

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
            section.appendChild(this._createModeButton(mode));
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

        btn.appendChild(this._getModeIcon(mode.id, isActive));

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
        const isMagnetic = this._state.northReference === NORTH_REFERENCE.MAGNETIC;
        const showWarning = isMagnetic && this._state.magneticDeclination !== 0;

        if (showWarning) {
            section.classList.add('azd-declination-active');
        }

        section.appendChild(createSectionLabel('Norte de Refer\u00EAncia'));

        const row = document.createElement('div');
        row.className = 'azd-declination-row';

        // NM/NV Toggle
        const northToggle = document.createElement('div');
        northToggle.className = 'azd-north-toggle';
        northToggle.appendChild(this._createNorthButton('NM', 'Norte Magn\u00E9tico (b\u00FAssola)', NORTH_REFERENCE.MAGNETIC));
        northToggle.appendChild(this._createNorthButton('NV', 'Norte Verdadeiro (carta)', NORTH_REFERENCE.TRUE));
        row.appendChild(northToggle);

        // Declination input container
        const isDisabled = !isMagnetic;
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
        declInput.title = 'Oeste (\u2212) / Leste (+)';

        addDomListener(this, declInput, 'input', (e) => {
            const val = parseFloat(e.target.value);
            if (!isNaN(val)) {
                this._state.magneticDeclination = Math.max(-45, Math.min(45, val));
                this._state.manuallyEdited = true;
                this._updateCompass();
                this._updateDeclinationHelper();
                this._notifyStateChange();
            }
        });

        this._declInput = declInput;
        declContainer.appendChild(declInput);

        const unitLabel = document.createElement('span');
        unitLabel.className = 'azd-decl-unit';
        unitLabel.textContent = '\u00B0';
        declContainer.appendChild(unitLabel);

        declContainer.appendChild(this._createAutoDeclinationButton());
        row.appendChild(declContainer);
        section.appendChild(row);

        // WMM info line + correction warning
        const helper = document.createElement('div');
        helper.className = 'azd-decl-helper';

        const autoInfo = document.createElement('span');
        autoInfo.className = 'azd-auto-decl-info';
        this._renderAutoDeclinationInfo(autoInfo);
        helper.appendChild(autoInfo);

        if (showWarning) {
            const warningSpan = document.createElement('span');
            warningSpan.className = 'azd-decl-warning';
            const sign = this._state.magneticDeclination > 0 ? '+' : '';
            warningSpan.textContent = `Corre\u00E7\u00E3o ativa: ${sign}${this._state.magneticDeclination}\u00B0`;
            helper.appendChild(warningSpan);
        }

        section.appendChild(helper);
        this._declinationSection = section;
        return section;
    }

    /**
     * Creates the auto-calculate declination button.
     * @returns {HTMLButtonElement}
     */
    _createAutoDeclinationButton() {
        const isDisabled = !this._state.referencePoint ||
            this._state.northReference === NORTH_REFERENCE.TRUE;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'azd-auto-decl-btn';
        btn.title = 'Calcular declina\u00E7\u00E3o autom\u00E1tica (WMM2025)';
        btn.disabled = isDisabled;

        // SVG refresh icon
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.innerHTML = `
            <path d="M21 2v6h-6"/>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
            <path d="M3 22v-6h6"/>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        `;
        btn.appendChild(svg);

        if (!isDisabled) {
            addDomListener(this, btn, 'click', () => this._applyAutoDeclinacao());
        }

        return btn;
    }

    /**
     * Renders the auto-declination info text into the given span element.
     * @param {HTMLSpanElement} el - Target element
     */
    _renderAutoDeclinationInfo(el) {
        el.className = 'azd-auto-decl-info';

        if (this._state.northReference === NORTH_REFERENCE.TRUE) {
            el.textContent = '';
            return;
        }

        if (!this._state.referencePoint) {
            el.textContent = '\u25B8 Defina o ponto de refer\u00EAncia';
            return;
        }

        if (this._state.autoDeclinationValue != null) {
            let displayValue = this._state.autoDeclinationValue;
            let unit = '\u00B0';
            if (this._state.angularUnit === ANGULAR_UNIT.MILS) {
                displayValue = parseFloat((displayValue * DEG_TO_MIL).toFixed(1));
                unit = '\u20A5';
            }

            const modelLabel = this._state.autoDeclinationWarning
                ? 'WMM2025 \u2014 expirado'
                : 'WMM2025';

            el.textContent = `\u25B8 Auto: ${displayValue}${unit} (${modelLabel})`;

            if (this._state.autoDeclinationWarning) {
                el.classList.add('azd-auto-decl-info--warning');
            } else {
                el.classList.remove('azd-auto-decl-info--warning');
            }
        } else {
            el.textContent = '\u25B8 Defina o ponto de refer\u00EAncia';
        }
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

        const label = createSectionLabel(`Azimute r\u00E1pido \u2192 Perna ${this._state.activeIndex + 1}`);
        section.appendChild(label);
        this._quickAzLabel = label;

        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'azd-quick-buttons';

        COMPASS_PRESETS.forEach(preset => {
            buttonsContainer.appendChild(this._createQuickAzimuthButton(preset));
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

        const labelSpan = document.createElement('span');
        labelSpan.className = 'azd-quick-label';
        labelSpan.textContent = preset.label;
        btn.appendChild(labelSpan);

        const valueSpan = document.createElement('span');
        valueSpan.className = 'azd-quick-value';
        valueSpan.textContent = this._state.angularUnit === ANGULAR_UNIT.MILS ? `${value}\u20A5` : `${value}\u00B0`;
        btn.appendChild(valueSpan);

        addDomListener(this, btn, 'click', () => this._applyQuickAzimuth(preset.deg));

        return btn;
    }

    // =========================================================================
    // SUMMARY
    // =========================================================================

    _createSummary() {
        const section = document.createElement('div');
        section.className = 'azd-summary';

        this._renderSummaryContent(section);

        this._summaryElement = section;
        return section;
    }

    /**
     * Render summary content into the given element using safe DOM methods.
     * @param {HTMLElement} container - Target container
     */
    _renderSummaryContent(container) {
        container.innerHTML = '';

        const legsCount = document.createElement('span');
        const countBold = document.createElement('b');
        countBold.textContent = this._state.legs.length;
        legsCount.appendChild(countBold);
        legsCount.appendChild(document.createTextNode(` perna${this._state.legs.length !== 1 ? 's' : ''}`));
        container.appendChild(legsCount);

        const totalDist = calculateTotalDistance(this._state.legs, this._state.distanceUnit);
        const totalSpan = document.createElement('span');
        totalSpan.appendChild(document.createTextNode('Total: '));
        const totalBold = document.createElement('b');
        totalBold.className = 'azd-summary-total';
        totalBold.textContent = formatTotalDistance(totalDist, this._state.distanceUnit);
        totalSpan.appendChild(totalBold);
        container.appendChild(totalSpan);
    }

    // =========================================================================
    // ACTION BUTTONS
    // =========================================================================

    _createActionButtons() {
        const section = document.createElement('div');
        section.className = 'azd-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'azd-btn azd-btn-cancel';
        cancelBtn.textContent = 'Cancelar';
        addDomListener(this, cancelBtn, 'click', () => this._options.onCancel?.());
        section.appendChild(cancelBtn);

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
            this._state.legs = this._state.legs.map(leg => ({
                ...leg,
                azimuth: leg.azimuth !== '' && leg.azimuth != null
                    ? Math.round(Number(leg.azimuth) * DEG_TO_MIL)
                    : ''
            }));
            this._state.angularUnit = ANGULAR_UNIT.MILS;
        } else {
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
            this._state.legs = this._state.legs.map(leg => ({
                ...leg,
                distance: leg.distance
                    ? parseFloat((Number(leg.distance) / 1000).toFixed(3))
                    : ''
            }));
            this._state.distanceUnit = DISTANCE_UNIT.KILOMETERS;
        } else {
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
        // Only update derived state, not the inputs (avoids losing focus)
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
        if (this._state.activeIndex === index) return;

        this._state.activeIndex = index;

        if (this._quickAzLabel) {
            this._quickAzLabel.textContent = `Azimute r\u00E1pido \u2192 Perna ${index + 1}`;
        }
        this._updateCompass();
        this._updateLegRowStyles();
    }

    _updateLegRowStyles() {
        const rows = this._container?.querySelectorAll('.azd-leg-row');
        if (!rows) return;

        rows.forEach((row, i) => {
            const isActive = i === this._state.activeIndex;
            row.classList.toggle('azd-leg-row--active', isActive);
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

    // =========================================================================
    // WMM AUTO-DECLINATION
    // =========================================================================

    /**
     * Calculates auto-declination from the current reference point using WMM2025.
     */
    _calculateAutoDeclinacao() {
        if (!this._state.referencePoint) return;
        const [lng, lat] = this._state.referencePoint;
        const result = calculateMagneticDeclination(lat, lng);
        if (!result) return;
        this._state.autoDeclinationValue = result.declination;
        this._state.autoDeclinationWarning = result.warning;
    }

    /**
     * Applies WMM auto-declination value to the input field.
     * Called by the auto button -- always overwrites, resets manual flag.
     */
    _applyAutoDeclinacao() {
        this._calculateAutoDeclinacao();
        if (this._state.autoDeclinationValue != null) {
            this._state.magneticDeclination = this._state.autoDeclinationValue;
            this._state.manuallyEdited = false;
            this._updateAll();
        }
    }

    _notifyStateChange() {
        this._options.onStateChange?.(this.getState());
    }

    // =========================================================================
    // UPDATE ALL COMPONENTS
    // =========================================================================

    _updateAll() {
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
                    this._updateAll();
                }
            });
        }

        this._updateCompass();

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

        this._updateSummary();

        if (this._createButton) {
            this._createButton.textContent = `Criar ${OUTPUT_MODE_INFO[this._state.outputMode].label}`;
        }

        if (this._quickAzLabel) {
            this._quickAzLabel.textContent = `Azimute r\u00E1pido \u2192 Perna ${this._state.activeIndex + 1}`;
        }

        this._rebuildUnitToggles();
        this._rebuildModeSelector();
        this._rebuildDeclinationSection();
        this._rebuildQuickAzimuthButtons();
        this._notifyStateChange();
    }

    _updateSummary() {
        if (this._summaryElement) {
            this._renderSummaryContent(this._summaryElement);
        }
    }

    _updateCompass() {
        if (!this._compassComponent) return;

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

    _updateDeclinationHelper() {
        if (!this._declinationSection) return;

        const helper = this._declinationSection.querySelector('.azd-decl-helper');
        if (!helper) return;

        const autoInfo = helper.querySelector('.azd-auto-decl-info');
        if (autoInfo) {
            this._renderAutoDeclinationInfo(autoInfo);
        }

        const showWarning = this._state.northReference === NORTH_REFERENCE.MAGNETIC &&
            this._state.magneticDeclination !== 0;

        let warningSpan = helper.querySelector('.azd-decl-warning');

        if (showWarning) {
            const sign = this._state.magneticDeclination > 0 ? '+' : '';
            const warningText = `Corre\u00E7\u00E3o ativa: ${sign}${this._state.magneticDeclination}\u00B0`;

            if (warningSpan) {
                warningSpan.textContent = warningText;
            } else {
                warningSpan = document.createElement('span');
                warningSpan.className = 'azd-decl-warning';
                warningSpan.textContent = warningText;
                helper.appendChild(warningSpan);
            }

            this._declinationSection.classList.add('azd-declination-active');
        } else {
            if (warningSpan) warningSpan.remove();
            this._declinationSection.classList.remove('azd-declination-active');
        }
    }

    _rebuildUnitToggles() {
        if (!this._unitTogglesSection) return;

        this._unitTogglesSection.innerHTML = '';

        this._unitTogglesSection.appendChild(this._createUnitToggle(
            'ANG',
            this._state.angularUnit === ANGULAR_UNIT.DEGREES ? 'Graus (\u00B0)' : 'Mil\u00E9simos (\u20A5)',
            () => this._toggleAngularUnit()
        ));

        this._unitTogglesSection.appendChild(this._createUnitToggle(
            'DIST',
            this._state.distanceUnit === DISTANCE_UNIT.METERS ? 'Metros (m)' : 'Quil\u00F4metros (km)',
            () => this._toggleDistanceUnit()
        ));
    }

    _rebuildModeSelector() {
        if (!this._modeSelector) return;

        this._modeSelector.innerHTML = '';
        Object.values(OUTPUT_MODE_INFO).forEach(mode => {
            this._modeSelector.appendChild(this._createModeButton(mode));
        });
    }

    _rebuildDeclinationSection() {
        if (!this._declinationSection?.parentNode) return;

        const parent = this._declinationSection.parentNode;
        const nextSibling = this._declinationSection.nextSibling;

        parent.removeChild(this._declinationSection);

        const newSection = this._createDeclinationSection();

        if (nextSibling) {
            parent.insertBefore(newSection, nextSibling);
        } else {
            parent.appendChild(newSection);
        }
    }

    _rebuildQuickAzimuthButtons() {
        if (!this._quickAzButtons) return;

        this._quickAzButtons.innerHTML = '';
        COMPASS_PRESETS.forEach(preset => {
            this._quickAzButtons.appendChild(this._createQuickAzimuthButton(preset));
        });
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Set reference point from map click.
     * Auto-calculates magnetic declination via WMM2025.
     * Auto-fills the declination field if not manually edited.
     * @param {number} lng - Longitude
     * @param {number} lat - Latitude
     */
    setReferencePoint(lng, lat) {
        this._state.referencePoint = [lng, lat];

        this._calculateAutoDeclinacao();

        if (this._state.northReference === NORTH_REFERENCE.MAGNETIC &&
            this._state.autoDeclinationValue != null &&
            !this._state.manuallyEdited) {
            this._state.magneticDeclination = this._state.autoDeclinationValue;
        }

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
            autoDeclinationValue: null,
            autoDeclinationWarning: null,
            manuallyEdited: false,
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
        this._container?.remove();
        this._container = null;
    }
}
