// Path: tests/unit/copia-antiga-frases.test.js
//
// O COMANDO QUE APAGA A CÓPIA DA VERSÃO ANTERIOR, na seção "Neste computador" de `atlas.html`
// (decisão do dono de 2026-09-26). Até então o gesto morava só na tela de recuperação, que apenas
// uma atualização QUE FALHOU alcança, e quem atualizou sem problema ficava com a cópia no disco sem
// jeito de soltá-la.
//
// O QUE ESTE VERDE PROVA: que o comando aparece só no veredito em que ele pode agir (`ok` com
// registros), que todo outro veredito o esconde, inclusive um valor que o módulo de limpeza invente
// depois deste build, e que as frases nomeiam o número que a confirmação e o aviso prometem. O que
// ele NÃO prova é que a página pergunta o veredito nem que o clique apaga: isso foi medido por
// captura do Playwright dirigindo `atlas.html` com uma instalação antiga semeada.

import { describe, it, expect } from 'vitest';
import {
    COPIA_ANTIGA_BOTAO,
    COPIA_ANTIGA_FALHOU,
    COPIA_ANTIGA_OCUPADA,
    COPIA_ANTIGA_TEXTO,
    confirmacaoDeApagarCopiaAntiga,
    copiaAntigaApagada,
    copiaAntigaParaOferecer,
} from '@js/projects/copia-antiga-phrases.js';

/** Os motivos que `describeLegacySource` devolve quando a origem NÃO pode ser apagada. */
const MOTIVOS_DE_RECUSA = ['no_transition', 'not_committed', 'legacy_changes', 'claimed', 'already_dropped', 'unreadable'];

describe('quando o comando aparece', () => {
    it('aparece no veredito ok com registros, levando o número', () => {
        expect(copiaAntigaParaOferecer({ reason: 'ok', records: 42 })).toEqual({ registros: 42 });
        expect(copiaAntigaParaOferecer({ reason: 'ok', records: 1 })).toEqual({ registros: 1 });
    });

    it('some em todo motivo de recusa, mesmo que o veredito traga um número', () => {
        for (const reason of MOTIVOS_DE_RECUSA) {
            expect(copiaAntigaParaOferecer({ reason, records: 0 }), reason).toBeNull();
            expect(copiaAntigaParaOferecer({ reason, records: 7 }), reason).toBeNull();
        }
    });

    it('falha FECHADO para um motivo desconhecido: um veredito novo não desenha o comando', () => {
        expect(copiaAntigaParaOferecer({ reason: 'motivo_de_amanha', records: 5 })).toBeNull();
    });

    it('some com a origem vazia, e com um número que não é contagem', () => {
        // DROPPING_SOURCE devolve ok com o que sobrou no disco, e isso pode ser zero.
        expect(copiaAntigaParaOferecer({ reason: 'ok', records: 0 })).toBeNull();
        for (const records of [-1, 1.5, NaN, Infinity, '3', null, undefined]) {
            expect(copiaAntigaParaOferecer({ reason: 'ok', records }), String(records)).toBeNull();
        }
    });

    it('some sem veredito (a leitura falhou antes de haver um)', () => {
        expect(copiaAntigaParaOferecer(null)).toBeNull();
        expect(copiaAntigaParaOferecer(undefined)).toBeNull();
        expect(copiaAntigaParaOferecer({})).toBeNull();
    });
});

describe('o que as frases dizem', () => {
    it('a confirmação nomeia quantos registros saem, no singular e no plural', () => {
        expect(confirmacaoDeApagarCopiaAntiga(1).mensagem).toContain('1 registro da versão anterior');
        expect(confirmacaoDeApagarCopiaAntiga(1).mensagem).not.toContain('1 registros');
        expect(confirmacaoDeApagarCopiaAntiga(1234).mensagem).toContain('1234 registros');
    });

    it('a confirmação avisa que não há como desfazer e tem título e verbo próprios', () => {
        const pergunta = confirmacaoDeApagarCopiaAntiga(3);
        expect(pergunta.mensagem).toContain('não há como desfazer');
        expect(pergunta.titulo.endsWith('?')).toBe(true);
        expect(pergunta.confirmar).toMatch(/^Apagar/);
    });

    it('o aviso de sucesso repete o número que o apagamento relatou', () => {
        expect(copiaAntigaApagada(8)).toContain('8 registros');
        expect(copiaAntigaApagada(1)).toContain('1 registro)');
    });

    it('toda frase fixa é pt-BR com ponto final, e as de falha dizem o que fazer', () => {
        for (const frase of [COPIA_ANTIGA_TEXTO, COPIA_ANTIGA_OCUPADA, COPIA_ANTIGA_FALHOU]) {
            expect(frase.endsWith('.'), frase).toBe(true);
        }
        expect(COPIA_ANTIGA_OCUPADA).toMatch(/Feche as outras janelas/);
        expect(COPIA_ANTIGA_FALHOU).toMatch(/Tente de novo/);
        expect(COPIA_ANTIGA_BOTAO).toMatch(/^Apagar a cópia antiga/);
    });
});
