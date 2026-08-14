// Path: js/phone/phone-move-actions.js

/**
 * @fileoverview Confirm/cancel action bar for feature move mode on phone.
 * Displayed at the bottom of the screen when the user is repositioning a feature.
 */

import { setupCleanup, addDomListener, cleanup, removeElement } from '@utils/event-cleanup.js';

/**
 * Phone move-mode action bar component.
 */
export class PhoneMoveActions {
    constructor() {
        /** @private */
        this._container = null;
        /** @private */
        this._confirmBtn = null;
        /** @private */
        this._cancelBtn = null;
        /** @private */
        this._onConfirm = null;
        /** @private */
        this._onCancel = null;

        setupCleanup(this);
    }

    /**
     * Append the action bar to a parent element.
     * @param {HTMLElement} parent
     */
    mount(parent) {
        this._container = document.createElement('div');
        this._container.className = 'phone-move-actions';
        this._container.hidden = true;

        // Cancel button
        this._cancelBtn = document.createElement('button');
        this._cancelBtn.className = 'phone-move-actions__btn phone-move-actions__btn--cancel';
        this._cancelBtn.textContent = 'Cancelar';

        // Confirm button
        this._confirmBtn = document.createElement('button');
        this._confirmBtn.className = 'phone-move-actions__btn phone-move-actions__btn--confirm';
        this._confirmBtn.textContent = 'Confirmar';

        this._container.appendChild(this._cancelBtn);
        this._container.appendChild(this._confirmBtn);

        // Event listeners
        addDomListener(this, this._confirmBtn, 'click', this._handleConfirm.bind(this));
        addDomListener(this, this._cancelBtn, 'click', this._handleCancel.bind(this));

        parent.appendChild(this._container);
    }

    /**
     * Remove container and clean up all listeners.
     */
    destroy() {
        cleanup(this);
        removeElement(this._container);
        this._container = null;
        this._confirmBtn = null;
        this._cancelBtn = null;
        this._onConfirm = null;
        this._onCancel = null;
    }

    /**
     * Show the action bar with confirm/cancel callbacks.
     * @param {Function} onConfirm - Called when user taps Confirmar
     * @param {Function} onCancel - Called when user taps Cancelar
     */
    show(onConfirm, onCancel) {
        this._onConfirm = onConfirm;
        this._onCancel = onCancel;

        this.setBusy(false);
        if (this._container) {
            this._container.hidden = false;
        }
    }

    /**
     * Hide the action bar.
     */
    hide() {
        if (this._container) {
            this._container.hidden = true;
        }
        this.setBusy(false);
        this._onConfirm = null;
        this._onCancel = null;
    }

    /**
     * Disable both buttons while the confirmed move is being persisted.
     * Without this a second tap on "Confirmar" fires a second store write with
     * a delta measured from the same start centre, moving the feature twice.
     * @param {boolean} busy
     */
    setBusy(busy) {
        const disabled = Boolean(busy);
        if (this._confirmBtn) this._confirmBtn.disabled = disabled;
        if (this._cancelBtn) this._cancelBtn.disabled = disabled;
    }

    // -------------------------------------------------------------------------
    // Private
    // -------------------------------------------------------------------------

    /** @private */
    _handleConfirm() {
        this._onConfirm?.();
    }

    /** @private */
    _handleCancel() {
        this._onCancel?.();
    }
}
