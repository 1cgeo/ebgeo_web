// Path: js/ui/password-visibility.js

/**
 * @fileoverview The eye that reveals a password field. One call applies it to ANY `<input
 * type="password">` already in the document, so the signup form, the "Entrar" dialog and the
 * password-reset screen share one behaviour instead of three near-copies.
 *
 * FOUR THINGS THAT ARE CONTRACT, NOT DECORATION:
 *
 * 1. `<button type="button">`. Inside a `<form>` a button with no type is a SUBMIT button, so an
 *    eye written without it sends the form on the first click — the single most expensive mistake
 *    available in this file.
 * 2. IT DOES NOT STEAL THE FOCUS. `mousedown` is prevented, which is what keeps the caret where
 *    the person left it: without that, revealing the password moves focus to the button and the
 *    next keystroke goes nowhere. The button stays reachable by Tab and answers Enter/Space.
 * 3. THE STATE IS `aria-pressed`, AND THE NAME CHANGES WITH IT. A toggle whose label stays
 *    "Mostrar senha" while the password is already showing tells a screen reader the opposite of
 *    the screen.
 * 4. IT WRAPS THE INPUT. The button is positioned inside the field, so the input needs a
 *    positioned parent of its own; reusing whatever the caller happened to build would make the
 *    helper depend on the caller's markup. The wrapper carries `.password-field`, whose rules are
 *    in `css/password-field.css`, and the input gets the padding that keeps the text off the icon.
 *
 * @example
 * const olho = attachPasswordVisibility(input, { testid: 'login-password-eye' });
 * // ... when the surface goes away:
 * olho.destroy();
 */

/** Eye, drawn open: the password is hidden and clicking will reveal it. */
const ICONE_MOSTRAR = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

/** Eye, struck through: the password is showing and clicking will hide it. */
const ICONE_OCULTAR = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

const ROTULO_MOSTRAR = 'Mostrar senha';
const ROTULO_OCULTAR = 'Ocultar senha';

/**
 * Wraps a password input and adds the reveal toggle to it.
 *
 * @param {HTMLInputElement} input - An input ALREADY in the document, with a parent element.
 * @param {Object} [options]
 * @param {string} [options.testid] - `data-testid` for the button (the e2e layer drives it).
 * @param {string} [options.mostrar] - Accessible name while the password is hidden.
 * @param {string} [options.ocultar] - Accessible name while it is showing.
 * @returns {{ button: HTMLButtonElement, wrapper: HTMLElement, isVisible: () => boolean,
 *   destroy: () => void }}
 * @throws {Error} When the input is missing or has no parent — a caller bug, not a runtime state.
 */
export function attachPasswordVisibility(input, options = {}) {
    if (!input || !input.parentElement) {
        throw new Error('attachPasswordVisibility: o input precisa estar no documento');
    }
    const nomeMostrar = options.mostrar || ROTULO_MOSTRAR;
    const nomeOcultar = options.ocultar || ROTULO_OCULTAR;

    const parent = input.parentElement;
    const wrapper = document.createElement('div');
    wrapper.className = 'password-field';
    parent.insertBefore(wrapper, input);
    // Moves the input: appendChild detaches it from `parent` first, which is the DOM's own rule.
    wrapper.appendChild(input);
    input.classList.add('password-field__input');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'password-field__toggle';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', nomeMostrar);
    button.title = nomeMostrar;
    // Static icon markup written by us, never user data.
    button.innerHTML = ICONE_MOSTRAR;
    if (options.testid) button.dataset.testid = options.testid;
    wrapper.appendChild(button);

    /** Applies the state to the input, the icon and the accessible name. */
    const aplicar = (visivel) => {
        input.type = visivel ? 'text' : 'password';
        button.setAttribute('aria-pressed', visivel ? 'true' : 'false');
        button.setAttribute('aria-label', visivel ? nomeOcultar : nomeMostrar);
        button.title = visivel ? nomeOcultar : nomeMostrar;
        button.innerHTML = visivel ? ICONE_OCULTAR : ICONE_MOSTRAR;
    };

    const aoClicar = () => aplicar(input.type === 'password');
    // Keeps the caret in the input: see the header, item 2.
    const aoApertar = (event) => event.preventDefault();

    button.addEventListener('click', aoClicar);
    button.addEventListener('mousedown', aoApertar);

    return {
        button,
        wrapper,
        /** @returns {boolean} Whether the password is currently readable. */
        isVisible: () => input.type === 'text',
        /**
         * Hides the password again, without detaching anything.
         *
         * CALL IT WHEREVER THE HOST CLEARS THE VALUE. A cleared field that stays revealed shows the
         * NEXT thing typed there in clear text, with no gesture from the person: clearing protects
         * the DOM and leaves the screen open. Value cleared and visibility reset are one gesture.
         */
        hide: () => aplicar(false),
        /** Removes the listeners and leaves the password hidden again. */
        destroy() {
            button.removeEventListener('click', aoClicar);
            button.removeEventListener('mousedown', aoApertar);
            input.type = 'password';
            button.remove();
        },
    };
}
