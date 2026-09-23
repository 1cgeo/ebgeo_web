// Path: js/military_tools/engineering_symbol_tool/engineering_selector.js
import { ModalBase } from '@modals';
import { ENGINEERING_CATALOG } from './engineering_catalog.js';
import { engineeringFields } from './engineering_fields.js';
import { engineeringDraft, engineeringItem, engineeringSvg } from './engineering_generator.js';
import { errorsFor } from './engineering_drawing.js';
import { createDigitalComboBoxWithThumbnails, createDigitalComboBox, createDropdownState, createCheckbox } from '../coordination_measure_tool/attributes/ui-components.helpers.js';
import { createColorControlSection } from '../coordination_measure_tool/attributes/color-control.section.js';
import { createTextModifierField } from '../coordination_measure_tool/attributes/text-modifiers.section.js';

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Transient configuration: edits touch the atlas only when the user applies them. */
export class EngineeringSelectorModal extends ModalBase {
    constructor(config) {
        super({ id: 'engineering-selector', title: 'Configurar Símbolo de Engenharia', destroyOnHide: true });
        this.config = config;
        this.properties = structuredClone(config.feature.properties);
        this.properties.engineering = engineeringDraft(this.properties.pointCode, this.properties.engineering);
        this.dropdownState = createDropdownState();
        this.combos = [];
    }

    show() {
        this.render();
        document.body.appendChild(this.getOverlay());
        this.getContainer().classList.add('point-selector-modal-container');
        const body = this.getBody();
        const content = element('div', 'point-selector-content');
        const main = element('div', 'point-selector-main');
        const form = element('div', 'point-selector-controls');
        const picker = createDigitalComboBoxWithThumbnails(ENGINEERING_CATALOG.map(item => ({
            value: String(item.number), label: `${String(item.number).padStart(2, '0')} · ${item.title}`, iconCode: String(item.number)
        })), String(this.properties.pointCode), value => {
            this.properties.pointCode = value;
            this.properties.engineering = engineeringDraft(value);
            this.renderFields();
        }, 'Símbolo', async code => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(engineeringSvg(code).svg), this.dropdownState,
        code => this.preview(code));
        this.combos.push(picker);
        form.appendChild(picker);
        this.variantContainer = element('div', 'point-selector-subtype');
        form.appendChild(this.variantContainer);
        form.appendChild(createColorControlSection(this.properties.fillColor, color => {
            this.properties.fillColor = color; this.preview();
        }, 'Cor do símbolo'));
        this.fields = element('div', 'point-selector-text-grid point-selector-text-modifiers');
        form.appendChild(this.fields);
        const right = element('div', 'point-selector-preview');
        right.appendChild(element('h4', 'point-selector-preview-label', 'Visualização'));
        this.previewNode = element('div', 'point-selector-preview-container engineering-preview');
        right.appendChild(this.previewNode);
        this.help = element('p', 'engineering-help');
        right.appendChild(this.help);
        this.error = element('p', 'engineering-error'); this.error.setAttribute('role', 'status');
        right.appendChild(this.error);
        main.append(form, right);
        content.appendChild(main);
        const footer = element('div', 'point-selector-actions');
        const cancel = element('button', 'point-selector-btn point-selector-btn-cancel', 'Cancelar'); cancel.onclick = () => this.hide();
        this.applyButton = element('button', 'point-selector-btn point-selector-btn-apply', 'Aplicar');
        this.applyButton.onclick = () => this.apply();
        footer.append(cancel, this.applyButton);
        content.appendChild(footer);
        body.appendChild(content);
        super.show();
        this.renderFields();
    }

    renderFields() {
        this.fields.replaceChildren();
        const item = engineeringItem(this.properties.pointCode), schema = engineeringFields[item.number];
        const draft = this.properties.engineering;
        this.variantCombo?._cleanup();
        this.variantContainer.replaceChildren();
        this.variantCombo = null;
        if (item.variants.length > 1 && schema.variant) {
            this.variantCombo = createDigitalComboBox(item.variants.map((variant, index) => ({ value: String(index), label: variant.label })),
                String(draft.variant), value => { draft.variant = Number(value); this.preview(); }, schema.variant || 'Variante', this.dropdownState);
            this.variantContainer.appendChild(this.variantCombo);
        }
        this.variantContainer.hidden = !this.variantCombo;
        for (const field of schema.fields) {
            const onChange = value => { draft.values[field.key] = value ?? ''; this.preview(); };
            const label = field.kind === 'checkbox'
                ? createCheckbox(field.label, draft.values[field.key], onChange)
                : createTextModifierField(field.key, {
                    label: field.label, type: field.kind === 'select' ? 'select' : 'text', required: true,
                    help: field.help, options: field.options?.map(([key]) => key), optionLabels: Object.fromEntries(field.options || [])
                }, draft.values[field.key], onChange);
            const input = label.querySelector('input,select');
            input.dataset.field = field.key; input.setAttribute('aria-label', field.label);
            if (input.type === 'text') { input.maxLength = 40; input.inputMode = field.kind === 'integer' ? 'numeric' : 'decimal'; }
            this.fields.appendChild(label);
        }
        if (!schema.fields.length && item.variants.length === 1) this.fields.appendChild(element('p', 'engineering-help', 'Este símbolo não possui dados variáveis.'));
        this.help.textContent = schema.extra || '';
        this.preview();
    }

    preview(previewCode = null) {
        if (!this.previewNode) return;
        const item = engineeringItem(this.properties.pointCode);
        const issues = errorsFor(item, this.properties.engineering.values);
        this.error.textContent = issues.map(issue => issue.message).join(' ');
        this.applyButton.disabled = issues.length > 0;
        const drawing = engineeringSvg(previewCode || this.properties.pointCode, previewCode ? { fillColor: this.properties.fillColor } : this.properties);
        this.previewNode.replaceChildren(new DOMParser().parseFromString(drawing.svg, 'image/svg+xml').documentElement);
    }

    hide() {
        this.variantCombo?._cleanup();
        this.combos.forEach(combo => combo._cleanup());
        this.combos = [];
        super.hide();
    }

    async apply() {
        if (this.applyButton.disabled) return;
        this.applyButton.disabled = true;
        const { control, feature, selectedFeatures, initialPropertiesMap, selectionManager } = this.config;
        try {
            control.cancelPendingSymbolUpdates();
            Object.assign(feature.properties, { pointCode: this.properties.pointCode, engineering: structuredClone(this.properties.engineering), fillColor: this.properties.fillColor });
            await control.updateFeatures([feature], false, true);
            await control.updateSymbolImage(feature);
            await control.saveFeatures(selectedFeatures, initialPropertiesMap);
            this.hide();
            selectionManager.deselectAllFeatures();
        } catch (error) {
            console.error('Could not apply engineering symbol', error);
            this.error.textContent = 'Não foi possível salvar o símbolo. Tente novamente.';
            this.applyButton.disabled = false;
        }
    }
}
