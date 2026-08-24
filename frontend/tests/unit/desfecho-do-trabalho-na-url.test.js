// Path: tests/unit/desfecho-do-trabalho-na-url.test.js

/**
 * @fileoverview O canal `?trabalho=` : o que o MAPA diz sobre um resgate que aconteceu em outra
 * página.
 *
 * POR QUE O CANAL EXISTE. `atlas.html` e `admin.html` encerram a sessão e navegam com
 * `window.location.replace`, que mata qualquer toast levantado antes dele. Então o desfecho do
 * resgate viaja na barra de endereços como um CÓDIGO (`?trabalho=guardado|falhou`) mais uma
 * contagem (`&pendentes=<n>`), e quem remonta a frase é o mapa, a partir do mesmo módulo puro que
 * a outra página teria usado.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO. São duas metades, e cada uma tem um modo
 * de falha próprio:
 *
 *   - a FRASE fica verde num módulo que devolve sempre a mesma coisa, então todo caso de conteúdo
 *     anda com um controle negativo que exige textos DIFERENTES para desfechos diferentes, e a
 *     contagem exige o número dentro do texto;
 *   - a FIAÇÃO fica verde com a frase pronta e ninguém chamando, que foi literalmente o estado
 *     entregue pelas duas páginas antes desta fatia: elas escreviam o parâmetro e nada no mapa o
 *     lia. Por isso a segunda metade é estrutural, sobre o corpo de `explainEndedSessionFromUrl`
 *     em `index.js`, que não instancia em node (o módulo boota o app inteiro).
 */

import { describe, it, expect } from 'vitest';

import { ExitOutcome, exitOutcomeNotice } from '@js/session/unsynced-work-phrases.js';

/** @returns {Promise<string>} O texto-fonte de um arquivo do app, para asserção estrutural. */
async function fonteDe(caminhoRelativo) {
    const { readFileSync } = await import('node:fs');
    return readFileSync(new URL(caminhoRelativo, import.meta.url), 'utf-8');
}

describe('exitOutcomeNotice: os desfechos que têm frase', () => {
    it('guardado: diz onde o trabalho ficou, com a contagem, em tom de aviso', () => {
        const r = exitOutcomeNotice(ExitOutcome.GUARDADO, '47');

        expect(r).not.toBe(null);
        expect(r.message).toContain('47 operações');
        expect(r.message).toContain('atlas local');
        expect(r.message).toContain('Enviar ao servidor');
        expect(r.tone).toBe('warning');
        // CONTROLE NEGATIVO: a frase do sucesso não pode conter a negativa da falha, senão as duas
        // metades do canal estariam dizendo a mesma coisa.
        expect(r.message).not.toContain('NÃO foi possível');
    });

    it('falhou: é o mais forte dos três, e não promete que o trabalho está guardado', () => {
        const r = exitOutcomeNotice(ExitOutcome.FALHOU, '3');

        expect(r.message).toContain('NÃO foi possível guardar');
        expect(r.message).toContain('3 operações');
        expect(r.message).toContain('Entre novamente');
        expect(r.tone).toBe('error');
        // CONTROLE NEGATIVO, e é o que mais importa neste caso: a pessoa não escolheu nada e o
        // resgate não deu certo, então nenhuma frase pode dizer que o trabalho ficou guardado.
        expect(r.message).not.toContain('ficou neste computador');
        expect(r.message).not.toContain('atlas local');
    });

    it('os dois desfechos com frase produzem textos e tons DIFERENTES', () => {
        const guardado = exitOutcomeNotice(ExitOutcome.GUARDADO, '5');
        const falhou = exitOutcomeNotice(ExitOutcome.FALHOU, '5');

        // Sem esta asserção, um módulo que devolvesse a mesma frase para tudo passaria em todos os
        // `toContain` acima que fossem escritos de forma genérica.
        expect(guardado.message).not.toBe(falhou.message);
        expect(guardado.tone).not.toBe(falhou.tone);
        // E o número atravessa os dois, que é a propriedade que a frase fixa não tem.
        expect(exitOutcomeNotice(ExitOutcome.GUARDADO, '5').message)
            .not.toBe(exitOutcomeNotice(ExitOutcome.GUARDADO, '9').message);
    });
});

describe('exitOutcomeNotice: o que NÃO vira frase', () => {
    it('desfecho ausente, "nada" e valor desconhecido calam a boca', () => {
        for (const nada of [undefined, null, '', 'nada', 'guardad', 'GUARDADO', 'sim', 42, {}]) {
            expect(exitOutcomeNotice(nada, '7'), `entrada ${String(nada)}`).toBe(null);
        }
        // CONTROLE NEGATIVO: o valor certo, com a mesma contagem, tem frase. Sem esta linha o laço
        // acima ficaria verde numa função que devolve null para tudo.
        expect(exitOutcomeNotice(ExitOutcome.GUARDADO, '7')).not.toBe(null);
    });

    // O DESFECHO QUE MORREU. "descartado" existia enquanto a saída perguntava; a decisão do dono de
    // 2026-08-23 tirou a pergunta, e nada em `frontend/src/` descarta de propósito. Ele é tratado
    // aqui como qualquer valor digitado à mão: ignorado. O caso existe para que a volta do
    // desfecho seja uma decisão escrita, e não um efeito colateral.
    it('"descartado" é um valor desconhecido, e o enum não o oferece mais', () => {
        expect(exitOutcomeNotice('descartado', '12')).toBe(null);
        expect(Object.values(ExitOutcome)).not.toContain('descartado');
        // CONTROLE NEGATIVO: o enum não ficou vazio nem perdeu os que sobraram.
        expect(Object.values(ExitOutcome).sort()).toEqual(['falhou', 'guardado', 'nada']);
    });

    it('contagem que não é inteiro positivo não vira número na frase', () => {
        // `?pendentes=0` não é emitido pelo produto (o emissor só escreve contagem verdadeira),
        // mas a URL é editável à mão, e "0 operações" ao lado de "o trabalho ficou guardado" seria
        // a única frase autocontraditória que este módulo poderia produzir.
        for (const ruim of [undefined, null, '', '0', '-3', 'abc', 'Infinity', 'NaN', '1,5', {}]) {
            const r = exitOutcomeNotice(ExitOutcome.GUARDADO, ruim);
            expect(r.message, `entrada ${String(ruim)}`).not.toMatch(/\d/);
            expect(r.message, `entrada ${String(ruim)}`).not.toContain('operaç');
        }
        // CONTROLE NEGATIVO: com um inteiro positivo o número aparece, e aparece nos dois formatos
        // em que a URL o entrega (string) e o guarda o mede (number).
        expect(exitOutcomeNotice(ExitOutcome.GUARDADO, '1').message).toContain('1 operação');
        expect(exitOutcomeNotice(ExitOutcome.GUARDADO, 12).message).toContain('12 operações');
        // E "1,5" acima cai no desconhecido de propósito: `Number('1,5')` é NaN, não 1.
    });
});

// ============================================================================
// A FIAÇÃO. A frase certa e NÃO LIGADA tem o mesmo verde da frase ligada, e foi esse o estado que
// esta fatia encontrou: as duas páginas já escreviam `?trabalho=` e ninguém lia.
// ============================================================================

describe('o mapa consome o parâmetro', () => {
    it('explainEndedSessionFromUrl lê os dois parâmetros, remonta a frase e limpa a URL', async () => {
        const fonte = await fonteDe('../../src/js/index.js');

        expect(fonte).toContain("import { exitOutcomeNotice } from './session/unsynced-work-phrases.js';");

        const inicio = fonte.indexOf('function explainEndedSessionFromUrl(');
        expect(inicio).toBeGreaterThan(0);
        const corpo = fonte.slice(inicio, fonte.indexOf('\n}', inicio));

        expect(corpo).toContain("params.get('trabalho')");
        expect(corpo).toContain("params.get('pendentes')");
        expect(corpo).toContain('exitOutcomeNotice(');
        expect(corpo).toContain('showToast(');
        // A LIMPEZA É DE UMA VEZ SÓ, e alcança os três: parâmetro que sobra na barra de endereços
        // repete o aviso a cada F5.
        expect(corpo).toContain("params.delete('sessao')");
        expect(corpo).toContain("params.delete('trabalho')");
        expect(corpo).toContain("params.delete('pendentes')");

        // CONTROLE NEGATIVO 1: a prosa não pode estar escrita aqui. Se estiver, o módulo puro
        // deixou de ser a fonte e as duas cópias vão divergir sem nada ficar vermelho.
        expect(corpo).not.toContain('atlas local');
        expect(corpo).not.toContain('NÃO foi possível');

        // CONTROLE NEGATIVO 2: o recorte do corpo tem que ser um recorte de verdade. Sem isto, um
        // `indexOf` que devolvesse o arquivo inteiro faria todas as asserções acima passarem por
        // acharem os literais em qualquer outro lugar de `index.js`.
        expect(corpo.length).toBeGreaterThan(200);
        expect(corpo.length).toBeLessThan(fonte.length / 4);
        expect(corpo).not.toContain('function initializeApplication');
    });
});
