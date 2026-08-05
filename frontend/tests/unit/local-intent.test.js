// Path: tests/unit/local-intent.test.js
//
// A intenção "Mapa local" é o que impede o boot de mandar um usuário logado de volta para o
// seletor de projetos. Ela já quebrou uma vez de um jeito que só o comportamento revelava: o
// redirecionamento da fase -1 respeitava a intenção, mas `openAtlasChooserOnBoot()`, que roda no
// FIM do boot, não — então o mapa carregava, parecia certo, e só depois se mandava para
// `projetos.html`. Estes testes fixam o contrato do módulo; a fiação do boot é do e2e.

import { describe, it, expect, afterEach } from 'vitest';
import { LOCAL_INTENT_KEY, hasLocalMapIntent, clearLocalMapIntent } from '@js/deep-link/local-intent.js';

/** Instala um sessionStorage mínimo em memória e devolve como desinstalar. */
function installStorage(impl) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', { value: impl, configurable: true, writable: true });
    return () => {
        if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
        else delete globalThis.sessionStorage;
    };
}

function memoryStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
    };
}

let uninstall = () => {};
afterEach(() => { uninstall(); uninstall = () => {}; });

describe('local-intent (escapatória "Mapa local")', () => {
    it('reconhece a intenção gravada', () => {
        uninstall = installStorage(memoryStorage({ [LOCAL_INTENT_KEY]: '1' }));
        expect(hasLocalMapIntent()).toBe(true);
    });

    it('não reconhece armazenamento vazio', () => {
        uninstall = installStorage(memoryStorage());
        expect(hasLocalMapIntent()).toBe(false);
    });

    it('só aceita exatamente "1" — nem "true", nem "0", nem string vazia', () => {
        for (const valor of ['true', '0', '', 'sim', 'null']) {
            uninstall = installStorage(memoryStorage({ [LOCAL_INTENT_KEY]: valor }));
            expect(hasLocalMapIntent(), `valor ${JSON.stringify(valor)}`).toBe(false);
            uninstall();
        }
        uninstall = () => {};
    });

    it('clear apaga a intenção', () => {
        const storage = memoryStorage({ [LOCAL_INTENT_KEY]: '1' });
        uninstall = installStorage(storage);
        clearLocalMapIntent();
        expect(hasLocalMapIntent()).toBe(false);
        expect(storage.getItem(LOCAL_INTENT_KEY)).toBeNull();
    });

    it('degrada para "sem intenção" quando o armazenamento LANÇA (modo privado/sandbox)', () => {
        // O default seguro é a regra simples (ir para o seletor), nunca uma exceção no boot: este
        // módulo é lido ANTES de qualquer tratamento de erro da aplicação existir.
        uninstall = installStorage({
            getItem: () => { throw new Error('storage disabled'); },
            setItem: () => { throw new Error('storage disabled'); },
            removeItem: () => { throw new Error('storage disabled'); },
        });
        expect(hasLocalMapIntent()).toBe(false);
        expect(() => clearLocalMapIntent()).not.toThrow();
    });

    it('não explode onde sessionStorage nem existe', () => {
        uninstall = installStorage(undefined);
        expect(hasLocalMapIntent()).toBe(false);
        expect(() => clearLocalMapIntent()).not.toThrow();
    });
});
