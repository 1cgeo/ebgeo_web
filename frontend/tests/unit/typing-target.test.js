// Path: tests/unit/typing-target.test.js
//
// `isTypingTarget` decide se uma tecla é TEXTO ou COMANDO, e é a guarda que faltava em
// `walk/walk-mode.js`: o modo caminhada escuta keydown no DOCUMENTO e chama `preventDefault()`
// em W, A, S, D e espaço, então, sem esta pergunta, nenhum campo de texto da página recebia
// esses seis caracteres enquanto o visualizador estivesse aberto, e a câmera andava enquanto o
// visitante digitava. O campo de busca da lista de itens da cena é um campo de texto aberto
// exatamente nesse momento.
//
// O predicado chegou no porte de 6c5abfe2 (ebgeo_web main) SEM teste, e ele é lógica pura, que
// é a categoria que a casa cobra teste. O que interessa aqui não é o caminho feliz: é o falso
// NEGATIVO. Um `false` indevido devolve o defeito original (a tecla vira comando enquanto
// alguém digita), e nenhuma suíte o pegaria, porque o sintoma é só o caractere que não aparece.
//
// O ambiente é node, sem jsdom, então os alvos são duplos com a forma mínima que a função lê:
// `tagName`, `isContentEditable` e `closest`. Isso é fiel ao contrato — a função nunca toca
// nada além desses três.

import { describe, it, expect } from 'vitest';
import { isTypingTarget } from '@utils/typing-target.js';

/**
 * Um alvo de evento com a forma mínima que `isTypingTarget` inspeciona.
 * @param {Object} [props] - tagName, isContentEditable e a lista de seletores que casam
 * @returns {Object} o duplo
 */
function alvo({ tagName, isContentEditable = false, casa = [] } = {}) {
    return {
        tagName,
        isContentEditable,
        closest(seletor) {
            return casa.includes(seletor) ? { seletor } : null;
        },
    };
}

describe('isTypingTarget: onde a tecla é texto', () => {
    it('INPUT e TEXTAREA são digitação', () => {
        expect(isTypingTarget(alvo({ tagName: 'INPUT' }))).toBe(true);
        expect(isTypingTarget(alvo({ tagName: 'TEXTAREA' }))).toBe(true);
    });

    it('contenteditable é digitação, pela propriedade do próprio nó', () => {
        expect(isTypingTarget(alvo({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
    });

    it('contenteditable herdado é digitação, pelo ancestral', () => {
        // O evento pode nascer num nó de texto dentro do editor, e não no editor.
        expect(isTypingTarget(alvo({ tagName: 'SPAN', casa: ['[contenteditable="true"]'] }))).toBe(true);
    });

    it('o editor Quill é digitação mesmo sem se declarar contenteditable', () => {
        // A razão de `.ql-editor` estar na função: algumas versões não reportam
        // `isContentEditable` no nó exato que o evento carrega.
        expect(isTypingTarget(alvo({ tagName: 'P', casa: ['.ql-editor'] }))).toBe(true);
    });
});

describe('isTypingTarget: onde a tecla é comando', () => {
    it('SELECT NÃO é digitação, e a ausência dele na lista é deliberada', () => {
        // Um `<select>` responde a seta e letra como NAVEGAÇÃO, não como texto. Tratá-lo como
        // digitação desligaria os atalhos toda vez que um combo tivesse foco.
        expect(isTypingTarget(alvo({ tagName: 'SELECT' }))).toBe(false);
    });

    it('elementos comuns não são digitação', () => {
        for (const tag of ['DIV', 'BUTTON', 'CANVAS', 'BODY', 'A']) {
            expect(isTypingTarget(alvo({ tagName: tag })), tag).toBe(false);
        }
    });

    it('contenteditable="false" não é digitação', () => {
        // `closest('[contenteditable="true"]')` não casa, e `isContentEditable` é falso.
        expect(isTypingTarget(alvo({ tagName: 'DIV', casa: ['[contenteditable="false"]'] }))).toBe(false);
    });
});

describe('isTypingTarget: entradas degeneradas não podem lançar', () => {
    // Um handler de documento recebe o que o navegador der. Uma exceção aqui derruba o
    // keydown inteiro, então cada caso abaixo vale por um travamento de teclado.
    it('null e undefined devolvem false', () => {
        expect(isTypingTarget(null)).toBe(false);
        expect(isTypingTarget(undefined)).toBe(false);
    });

    it('primitivos devolvem false sem lançar', () => {
        for (const v of ['INPUT', 42, true, Symbol('x'), 0, '']) {
            expect(() => isTypingTarget(v)).not.toThrow();
            expect(isTypingTarget(v), String(v)).toBe(false);
        }
    });

    it('objeto sem tagName, sem isContentEditable e sem closest devolve false', () => {
        // É o caso do `document` e do `window` como alvo: nenhum dos três existe.
        expect(isTypingTarget({})).toBe(false);
    });

    it('objeto cujo closest não é função devolve false em vez de lançar', () => {
        expect(isTypingTarget({ tagName: 'DIV', closest: 'nao sou funcao' })).toBe(false);
    });

    it('tagName não-string é ignorado', () => {
        expect(isTypingTarget({ tagName: 42 })).toBe(false);
    });

    it('a comparação de tag é sensível à caixa, como o DOM entrega', () => {
        // `tagName` vem MAIÚSCULO em HTML. Um duplo minúsculo não casa, e isso é o
        // comportamento real: se algum dia a função passar a normalizar, este caso avisa.
        expect(isTypingTarget(alvo({ tagName: 'input' }))).toBe(false);
    });
});
