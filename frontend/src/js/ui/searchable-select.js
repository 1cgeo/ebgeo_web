// Path: js/ui/searchable-select.js

/**
 * @fileoverview A combobox with type-to-filter over a CONTROLLED list: the person reads and types
 * a name, and what the form submits is still the row id. Born for "Organização Militar" in the
 * signup form (a `<select>` with dozens of units, which on a long list is a scroll hunt), and
 * written to be reusable because every controlled list in this product has the same shape.
 *
 * WHAT IS NOT OBVIOUS FROM THE CODE:
 *
 * - THE LIST IS A PORTAL, appended to `document.body` and positioned `fixed`. It has to be: this
 *   component's first home is inside `.modal-body`, which is an `overflow-y: auto` scroll box
 *   inside a `.modal-container` with `overflow: hidden`, so an absolutely positioned dropdown is
 *   CLIPPED by two ancestors at once. Positioning is recomputed on open, on resize and on any
 *   scroll (captured), and the list is removed from the body by `destroy()`.
 * - BUILD AND WIRE ARE SEPARATE. The constructor only creates DOM (`document.createElement`), and
 *   `mount()` adds every listener. That split is what lets a node test build the host form over a
 *   minimal fake `document` without a single `addEventListener`, which is how
 *   `tests/unit/cadastro-lotacao-nao-autoriza.test.js` reads the real form.
 * - THE VALUE IS NOT THE TEXT. `value` is '' until the person picks a row, and TYPING CLEARS IT.
 *   Free text that resolves to nothing must not submit, and the host form says so in its own
 *   words; a component that guessed ("the single remaining match") would send an id nobody chose.
 * - ESCAPE STOPS PROPAGATING while the list is open. Every dialog in this app closes on a document
 *   `keydown` of Escape, so without that the first Escape would throw away the whole form instead
 *   of the dropdown.
 * - ENTER WITH THE LIST OPEN IS NOT A SUBMIT. It is `preventDefault`ed and chooses the highlighted
 *   row; with the list closed it falls through and submits, which is what a keyboard user expects.
 *
 * The ARIA is the 1.2 combobox pattern: `role="combobox"` on the input with `aria-expanded`,
 * `aria-controls` and `aria-activedescendant`, and a sibling `role="listbox"` of `role="option"`.
 * The options are NEVER focused — the focus stays in the input and `aria-activedescendant` is what
 * moves, which is what keeps typing possible while the list is open.
 *
 * ONE DECLARED LIMIT OF THAT PATTERN HERE: the portal puts the listbox OUTSIDE the host dialog, and
 * every dialog of this app is `aria-modal="true"`, which tells a screen reader to ignore whatever
 * lives outside it. `aria-controls` and `aria-activedescendant` then point at nodes it may not read,
 * so the keyboard works and nothing is announced. The list cannot move inside (the dialog clips),
 * so the component keeps a polite `role="status"` line INSIDE the field, which says how many rows
 * matched and which row the keyboard is on. It is the announcement, not a second list.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement,
} from '@utils/event-cleanup.js';
import { filtrarOpcoes } from '@ui/searchable-select.model.js';

/** How tall the dropdown may get, in px. Beyond this it scrolls. */
const ALTURA_MAX_LISTA = 260;

/** Breathing room between the field and the edge of the viewport, in px. */
const FOLGA = 8;

/** Chevron drawn in the field; decorative, never a tab stop. */
const ICONE_SETA = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="6 9 12 15 18 9"/></svg>';

/**
 * A labelled combobox over a controlled list.
 */
export class SearchableSelect {
    /**
     * Builds the DOM. Adds NO listeners — call `mount()` for that.
     * @param {Object} spec
     * @param {string} spec.id - DOM id of the input; the listbox derives its own from it.
     * @param {string} spec.label - Visible label, in pt-BR.
     * @param {string} spec.testid - `data-testid` of the input (the list gets `${testid}-list`).
     * @param {Array<{ value: string, label: string, sigla?: string }>} [spec.items]
     * @param {string} [spec.placeholder]
     * @param {string} [spec.emptyText] - Shown when the term matches nothing.
     * @param {boolean} [spec.required]
     * @param {boolean} [spec.disabled]
     * @param {string} [spec.fieldClass] - Extra classes for the field wrapper (host styling).
     * @param {string} [spec.inputClass] - Extra classes for the input (host styling).
     */
    constructor(spec) {
        this._id = spec.id;
        this._items = Array.isArray(spec.items) ? spec.items.slice() : [];
        this._emptyText = spec.emptyText || 'Nenhum resultado encontrado';
        this._value = '';
        this._chosenLabel = '';
        this._open = false;
        this._activeIndex = -1;
        this._filtered = [];
        this._optionEls = [];

        setupCleanup(this);

        const listId = `${spec.id}-listbox`;

        const field = document.createElement('div');
        field.className = `searchable-select ${spec.fieldClass || ''}`.trim();
        // The field is addressable on its own so a test can assert that a hint or an error really
        // sits INSIDE this control's box, and not merely somewhere in the same form.
        field.dataset.testid = `${spec.testid}-field`;

        const label = document.createElement('label');
        label.className = 'settings-field__label';
        label.setAttribute('for', spec.id);
        label.textContent = spec.label;
        field.appendChild(label);

        const shell = document.createElement('div');
        shell.className = 'searchable-select__shell';

        const input = document.createElement('input');
        input.type = 'text';
        input.id = spec.id;
        input.className = `searchable-select__input ${spec.inputClass || ''}`.trim();
        input.autocomplete = 'off';
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-haspopup', 'listbox');
        input.setAttribute('aria-controls', listId);
        input.dataset.testid = spec.testid;
        if (spec.placeholder) input.placeholder = spec.placeholder;
        if (spec.required) input.required = true;
        if (spec.disabled) input.disabled = true;
        shell.appendChild(input);

        // A SPAN, not a button: it is decoration for a field that already opens on focus and
        // click, and an `aria-hidden` element that can still take focus is an axe violation.
        const caret = document.createElement('span');
        caret.className = 'searchable-select__caret';
        caret.setAttribute('aria-hidden', 'true');
        // Static icon markup written by us, never user data.
        caret.innerHTML = ICONE_SETA;
        shell.appendChild(caret);

        field.appendChild(shell);

        // See the header: the announcement that survives `aria-modal`.
        const status = document.createElement('span');
        status.className = 'searchable-select__status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        field.appendChild(status);

        const list = document.createElement('ul');
        list.id = listId;
        list.className = 'searchable-select__list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', spec.label);
        list.dataset.testid = `${spec.testid}-list`;
        list.hidden = true;

        this._field = field;
        this._shell = shell;
        this._input = input;
        this._caret = caret;
        this._status = status;
        this._list = list;
    }

    /** @returns {HTMLElement} The field wrapper (label + shell); the host appends THIS. */
    get element() {
        return this._field;
    }

    /** @returns {HTMLInputElement} The combobox input, for labels, hints and focus. */
    get input() {
        return this._input;
    }

    /** @returns {string} The chosen row id, or '' when nothing was chosen from the list. */
    get value() {
        return this._value;
    }

    /** @returns {string} Whatever is typed in the field right now. */
    get text() {
        return this._input.value;
    }

    /** Adds every listener. Call once, after the field is in the document. */
    mount() {
        document.body.appendChild(this._list);

        addDomListener(this, this._input, 'input', () => this._onType());
        addDomListener(this, this._input, 'keydown', (e) => this._onKeyDown(e));
        addDomListener(this, this._input, 'focus', () => this._openList());
        addDomListener(this, this._input, 'click', () => this._openList());
        addDomListener(this, this._input, 'blur', () => this._onBlur());

        // preventDefault on mousedown keeps the caret in the input while the list toggles.
        addDomListener(this, this._caret, 'mousedown', (e) => {
            e.preventDefault();
            if (this._input.disabled) return;
            if (this._open) {
                this._closeList();
            } else {
                this._input.focus();
                this._openList();
            }
        });

        addDomListener(this, this._list, 'mousedown', (e) => e.preventDefault());
        addDomListener(this, this._list, 'click', (e) => this._onListClick(e));
        addDomListener(this, this._list, 'mouseover', (e) => this._onListHover(e));

        addDomListener(this, document, 'mousedown', (e) => this._onDocumentDown(e), true);
        addDomListener(this, window, 'resize', () => this._position());
        addDomListener(this, window, 'scroll', () => this._position(), true);
    }

    /** Removes every listener and takes the portal list out of the document. */
    destroy() {
        cleanup(this);
        removeElement(this._list);
        this._open = false;
        this._optionEls = [];
    }

    // ------------------------------------------------------------------ internals

    /** @private Reacts to typing: the chosen id dies with the first keystroke. */
    _onType() {
        this._value = '';
        this._chosenLabel = '';
        if (this._open) {
            this._renderOptions();
            this._position();
        } else {
            this._openList();
        }
    }

    /** @private */
    _onBlur() {
        // A committed choice re-writes the field with the canonical label, so half-typed text
        // never survives as if it were the selection. Free text is KEPT on purpose: the submit
        // error has to be able to point at what the person actually left there.
        if (this._value && this._chosenLabel) this._input.value = this._chosenLabel;
        this._closeList();
    }

    /** @private @param {MouseEvent} e */
    _onDocumentDown(e) {
        if (!this._open) return;
        const alvo = e.target;
        if (this._shell.contains(alvo) || this._list.contains(alvo)) return;
        this._closeList();
    }

    /** @private @param {MouseEvent} e */
    _onListClick(e) {
        const li = e.target?.closest?.('[role="option"]');
        if (!li) return;
        const escolhido = this._filtered[Number(li.dataset.index)];
        if (escolhido) this._commit(escolhido);
    }

    /** @private @param {MouseEvent} e */
    _onListHover(e) {
        const li = e.target?.closest?.('[role="option"]');
        if (!li) return;
        // No scrolling on hover: `block: 'nearest'` slides a half-visible row into view, the
        // content moves under the pointer, and the highlight jumps to a row nobody pointed at.
        this._setActive(Number(li.dataset.index), { rolar: false });
    }

    /** @private @param {KeyboardEvent} e */
    _onKeyDown(e) {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (!this._open) this._openList(); else this._setActive(this._activeIndex + 1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (this._open) this._setActive(this._activeIndex - 1);
                break;
            case 'Home':
                if (this._open) { e.preventDefault(); this._setActive(0); }
                break;
            case 'End':
                if (this._open) { e.preventDefault(); this._setActive(this._filtered.length - 1); }
                break;
            case 'Enter': {
                if (!this._open) return;
                e.preventDefault();
                const escolhido = this._filtered[this._activeIndex];
                if (escolhido) this._commit(escolhido); else this._closeList();
                break;
            }
            case 'Escape':
                if (!this._open) return;
                e.preventDefault();
                // The dialog closes on a document-level Escape: this one is for the list only.
                e.stopPropagation();
                this._closeList();
                break;
            case 'Tab':
                if (this._open) this._closeList();
                break;
            default:
                break;
        }
    }

    /** @private Writes the chosen row into the field and closes. */
    _commit(item) {
        this._value = item.value;
        this._chosenLabel = item.label;
        this._input.value = item.label;
        this._closeList();
        this._input.dispatchEvent(new CustomEvent('ebgeo:select', {
            bubbles: true,
            detail: { value: item.value, label: item.label },
        }));
    }

    /** @private */
    _openList() {
        if (this._input.disabled || this._open) return;
        this._open = true;
        this._list.hidden = false;
        this._input.setAttribute('aria-expanded', 'true');
        this._renderOptions();
        this._position();
    }

    /** @private */
    _closeList() {
        this._open = false;
        this._list.hidden = true;
        this._input.setAttribute('aria-expanded', 'false');
        this._input.removeAttribute('aria-activedescendant');
        this._activeIndex = -1;
        this._announce('');
    }

    /** @private Rebuilds the options for the current term. Delegated listeners: no per-row wiring. */
    _renderOptions() {
        const termo = this._value ? '' : this._input.value;
        this._filtered = filtrarOpcoes(this._items, termo);
        this._list.textContent = '';
        this._optionEls = [];

        if (!this._filtered.length) {
            const vazio = document.createElement('li');
            vazio.className = 'searchable-select__empty';
            vazio.setAttribute('role', 'presentation');
            vazio.dataset.testid = `${this._input.dataset.testid}-empty`;
            vazio.textContent = this._emptyText;
            this._list.appendChild(vazio);
            this._activeIndex = -1;
            this._input.removeAttribute('aria-activedescendant');
            this._announce(this._emptyText);
            return;
        }

        this._filtered.forEach((item, i) => {
            const li = document.createElement('li');
            li.id = `${this._id}-opt-${i}`;
            li.className = 'searchable-select__option';
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', 'false');
            li.dataset.index = String(i);
            li.dataset.value = item.value;

            // textContent, never innerHTML: these names come from the server.
            const nome = document.createElement('span');
            nome.className = 'searchable-select__option-name';
            nome.textContent = item.label;
            li.appendChild(nome);

            if (item.sigla) {
                const sigla = document.createElement('span');
                sigla.className = 'searchable-select__option-sigla';
                sigla.textContent = item.sigla;
                li.appendChild(sigla);
            }

            this._list.appendChild(li);
            this._optionEls.push(li);
        });

        const escolhido = this._filtered.findIndex((item) => item.value === this._value);
        this._setActive(escolhido >= 0 ? escolhido : 0);
    }

    /**
     * @private Writes the status line, only when the sentence changed: re-assigning the same text
     * is still a mutation, and a live region re-reads it on every keystroke.
     * @param {string} texto
     */
    _announce(texto) {
        if (this._status.textContent !== texto) this._status.textContent = texto;
    }

    /** @private Moves the highlight. Clamps instead of wrapping: the ends are a useful stop. */
    _setActive(i, { rolar = true } = {}) {
        if (!this._optionEls.length) return;
        const alvo = Math.max(0, Math.min(i, this._optionEls.length - 1));
        if (this._activeIndex >= 0 && this._optionEls[this._activeIndex]) {
            this._optionEls[this._activeIndex].classList.remove('searchable-select__option--active');
            this._optionEls[this._activeIndex].setAttribute('aria-selected', 'false');
        }
        this._activeIndex = alvo;
        const li = this._optionEls[alvo];
        li.classList.add('searchable-select__option--active');
        li.setAttribute('aria-selected', 'true');
        this._input.setAttribute('aria-activedescendant', li.id);
        if (rolar) {
            li.scrollIntoView({ block: 'nearest' });
            this._announce(this._filtered[alvo]?.label ?? '');
        }
    }

    /**
     * @private Pins the portal list under (or over) the field.
     * Below when it fits, above when it does not and there is more room there.
     */
    _position() {
        if (!this._open) return;
        const r = this._shell.getBoundingClientRect();
        const abaixo = window.innerHeight - r.bottom - FOLGA;
        const acima = r.top - FOLGA;
        const paraCima = abaixo < Math.min(ALTURA_MAX_LISTA, acima);
        const altura = Math.max(120, Math.min(ALTURA_MAX_LISTA, paraCima ? acima : abaixo));

        this._list.style.left = `${Math.round(r.left)}px`;
        this._list.style.width = `${Math.round(r.width)}px`;
        this._list.style.maxHeight = `${Math.round(altura)}px`;
        if (paraCima) {
            this._list.style.top = 'auto';
            this._list.style.bottom = `${Math.round(window.innerHeight - r.top + 4)}px`;
        } else {
            this._list.style.bottom = 'auto';
            this._list.style.top = `${Math.round(r.bottom + 4)}px`;
        }
    }
}

/**
 * Builds a searchable select.
 * @param {Object} spec See {@link SearchableSelect}.
 * @returns {SearchableSelect}
 */
export function createSearchableSelect(spec) {
    return new SearchableSelect(spec);
}
