// Path: tests/helpers/dom-double.js

/**
 * @fileoverview O `document` de mentira que as seções de `atlas.html` montam contra.
 *
 * A suíte roda em node PURO (`environment: 'node'` em `vitest.config.js`), então componente que
 * desenha DOM não tem onde ser exercido. Este dublê cobre só o que `LocalAtlasSection` e as suas
 * vizinhas TOCAM de verdade, e essa estreiteza é deliberada: um jsdom completo custaria a suíte
 * inteira para provar a mesma coisa.
 *
 * ELE SAIU DE DENTRO DE `tests/unit/seus-atlas-sem-servidor.test.js` em 2026-08-25, quando um
 * segundo arquivo (`tests/unit/menu-do-cartao-local.test.js`) precisou montar a MESMA seção. Duas
 * cópias do dublê seriam duas definições do que "chegou à tela" significa, e a que não fosse
 * atualizada passaria verde contra uma tela que mudou.
 *
 * A REGRA QUE ELE EXISTE PARA SERVIR: asserir que o código CONSTRÓI um objeto não prova que o
 * objeto CHEGA À TELA. Por isso os testes que usam este dublê montam o componente e disparam o
 * clique real, em vez de perguntar à função pura o que ela devolveria.
 */


export function makeElement(tag) {
    const listeners = new Map();
    const attrs = new Map();
    const el = {
        tagName: String(tag).toUpperCase(),
        className: '',
        textContent: '',
        innerHTML: '',
        title: '',
        hidden: false,
        type: '',
        value: '',
        accept: '',
        files: null,
        style: {},
        dataset: {},
        parentNode: null,
        children: [],
        _listeners: listeners,
        classList: {
            add(...names) { for (const n of names) if (!el.className.split(' ').includes(n)) el.className = `${el.className} ${n}`.trim(); },
            remove(...names) { el.className = el.className.split(' ').filter((c) => c && !names.includes(c)).join(' '); },
            contains(name) { return el.className.split(' ').includes(name); },
        },
        setAttribute(name, value) { attrs.set(name, String(value)); },
        getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
        removeAttribute(name) { attrs.delete(name); },
        hasAttribute(name) { return attrs.has(name); },
        appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
        append(...nodes) { for (const n of nodes) el.appendChild(n); },
        replaceChildren(...nodes) {
            for (const c of el.children) c.parentNode = null;
            el.children = [];
            for (const n of nodes) el.appendChild(n);
        },
        removeChild(child) {
            const i = el.children.indexOf(child);
            if (i >= 0) el.children.splice(i, 1);
            child.parentNode = null;
            return child;
        },
        remove() { el.parentNode?.removeChild(el); },
        contains(node) {
            if (node === el) return true;
            return el.children.some((c) => c.contains(node));
        },
        getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
        addEventListener(event, handler) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(handler);
        },
        removeEventListener(event, handler) {
            const bucket = listeners.get(event) || [];
            const i = bucket.indexOf(handler);
            if (i >= 0) bucket.splice(i, 1);
        },
        click() { fire(el, 'click'); },
    };
    return el;
}

/** Dispara um evento no dublê, com o mínimo de superfície que os handlers usam. */
export function fire(el, event) {
    const evt = { target: el, stopPropagation() {}, preventDefault() {} };
    for (const handler of [...(el._listeners.get(event) || [])]) handler(evt);
}

/** Varre a árvore inteira do dublê procurando um `data-testid`. */
export function byTestid(root, testid) {
    if (root?.dataset?.testid === testid) return root;
    for (const child of root?.children || []) {
        const found = byTestid(child, testid);
        if (found) return found;
    }
    return null;
}

/** Todo o texto visível da árvore, concatenado. */
export function allText(root) {
    let out = root?.textContent ?? '';
    for (const child of root?.children || []) out += ` ${allText(child)}`;
    return out;
}

export function makeDocumentStub() {
    const body = makeElement('body');
    return {
        body,
        createElement: (tag) => makeElement(tag),
        addEventListener() {},
        removeEventListener() {},
    };
}

