// Path: tests/unit/renovar-concessao-escada-compartilhada.test.js
//
// DUAS telas do produto estendem o prazo de uma concessao: o modal de UM recurso
// (`catalog/resource-share.modal.js`), onde se concede, e a aba Concessoes do painel
// (`admin/grants-tab.js`), onde se revisa. Elas nasceram em lotes diferentes, e a
// segunda chegou com uma coluna dizendo "vence em 3 dias" e nenhum botao ao lado.
//
// O QUE ESTE ARQUIVO PROVA:
//   1. a escada de prazos e UMA e mora em `catalog/grant-tree.js`, e o modal a CONSOME
//      em vez de carregar a propria (enquanto eram duas listas, "90 dias" podia valer
//      prazos diferentes em duas telas do mesmo produto, e so quem comparasse veria);
//   2. a aba desenha o botao de renovar e o liga ao handler;
//   3. o handler le o prazo EFETIVO da resposta, e nao o pedido.
//
// O QUE ELE NAO PROVA: comportamento de DOM. O ambiente da suite e `node`, e a aba monta
// tabela. A aritmetica da extensao (`extensionDeadline`, `extensionOutcome`,
// `extensionSummary`) e provada onde ela mora, em `concessao-prazo-e-alcance.test.js`.
//
// Controle negativo, conferido caso a caso ao escrever: repondo a lista literal no modal,
// apagando o botao da aba, ou lendo o pedido no lugar do efetivo, o `it()` correspondente
// reprova.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    GRANT_TERMS,
    GRANT_TERM_DEFAULT_DAYS,
    extensionDeadline,
} from '../../src/js/catalog/grant-tree.js';
import { issuedExtensionHint, issuedExtensionTermLabel } from '../../src/js/admin/grant-phrases.js';

const PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ABA = readFileSync(join(PACOTE, 'src/js/admin/grants-tab.js'), 'utf8');
const MODAL = readFileSync(join(PACOTE, 'src/js/catalog/resource-share.modal.js'), 'utf8');

/** Posicao da primeira ocorrencia, falhando alto se a ancora sumiu. */
function pos(texto, ancora, arquivo) {
    const i = texto.indexOf(ancora);
    expect(i, `ancora ausente em ${arquivo}: ${ancora}`).toBeGreaterThan(-1);
    return i;
}

/** O corpo de um metodo, do cabecalho ate a primeira linha que fecha na indentacao de classe. */
function corpoDeMetodo(texto, assinatura, arquivo) {
    const inicio = pos(texto, assinatura, arquivo);
    const fim = texto.indexOf('\n    }', inicio);
    expect(fim, `nao achei o fim de ${assinatura} em ${arquivo}`).toBeGreaterThan(inicio);
    return texto.slice(inicio, fim);
}

describe('a escada de prazos e UMA, e as duas telas a consomem', () => {
    it('GRANT_TERMS tem cinco degraus crescentes, e o ultimo e o padrao', () => {
        expect(Array.isArray(GRANT_TERMS)).toBe(true);
        expect(GRANT_TERMS).toHaveLength(5);
        const dias = GRANT_TERMS.map((p) => p.dias);
        expect(dias).toEqual([...dias].sort((a, b) => a - b));
        for (const p of GRANT_TERMS) {
            expect(Number.isInteger(p.dias), `degrau nao inteiro: ${p.dias}`).toBe(true);
            expect(p.dias).toBeGreaterThan(0);
            expect(String(p.label).trim().length).toBeGreaterThan(0);
        }
        // UM ANO E O TETO DO SERVIDOR: oferecer um degrau maior seria desenhar uma opcao
        // que o `LEAST` recusa em silencio.
        expect(GRANT_TERM_DEFAULT_DAYS).toBe(365);
        expect(dias[dias.length - 1]).toBe(GRANT_TERM_DEFAULT_DAYS);
    });

    it('a lista e congelada, degrau a degrau', () => {
        // Congelar so o array deixaria uma escrita em `GRANT_TERMS[0].dias` passar, e um
        // degrau mutado em runtime e o tipo de defeito que nao aparece em revisao de codigo.
        expect(Object.isFrozen(GRANT_TERMS)).toBe(true);
        for (const p of GRANT_TERMS) expect(Object.isFrozen(p)).toBe(true);
    });

    it('o modal CONSOME a escada, e nao carrega uma copia literal', () => {
        expect(MODAL).toContain('const PRAZOS = GRANT_TERMS;');
        expect(MODAL).toContain('const PRAZO_PADRAO_DIAS = GRANT_TERM_DEFAULT_DAYS;');
        // REPROVA a volta da lista literal, que e a forma exata que divergia.
        expect(MODAL, 'a lista literal de prazos voltou para o modal')
            .not.toMatch(/const PRAZOS = Object\.freeze\(\[/);
    });

    it('a aba tambem consome a MESMA escada, pelo mesmo caminho', () => {
        expect(ABA).toMatch(/import \{[\s\S]*GRANT_TERMS[\s\S]*\} from '@js\/catalog\/grant-tree\.js'/);
        expect(ABA).toContain('for (const p of GRANT_TERMS) {');
        expect(ABA, 'a aba escreveu a propria escada').not.toMatch(/\{ dias: 90, label:/);
    });
});

describe('a aba Concessoes oferece renovar, e le o prazo efetivo', () => {
    it('a linha concedida desenha o botao e o liga ao handler', () => {
        // REPROVA o estado anterior: a coluna Vencimento existia e nao havia botao nenhum
        // ao lado dela, o que e meia ferramenta.
        expect(ABA).toContain("'admin-grant-extend', () => this._extend(grant))");
        expect(ABA).toContain('async _extend(grant) {');
    });

    it('renovar vem ANTES de revogar na celula de acoes', () => {
        // O ato aditivo nao pode ficar depois do destrutivo na varredura do olho, senao a
        // linha inteira se le como linha de risco.
        const renovar = pos(ABA, "'admin-grant-extend'", 'grants-tab.js');
        const revogar = pos(ABA, "'admin-grant-revoke'", 'grants-tab.js');
        expect(renovar).toBeLessThan(revogar);
    });

    it('o handler anuncia o EFETIVO da resposta, nunca o pedido', () => {
        const corpo = corpoDeMetodo(ABA, 'async _extend(grant) {', 'grants-tab.js');

        expect(corpo).toContain('const efetivo = resposta?.expiresAt');
        expect(corpo).toContain('extensionSummary(desfecho, shortDate(efetivo))');
        // REPROVA a forma que mente: anunciar o pedido. O servidor apara por dois tetos, e
        // pedir 180 e receber 20 e desfecho NORMAL desta rota.
        expect(corpo, 'o toast anuncia o pedido em vez do efetivo')
            .not.toMatch(/extensionSummary\([^)]*\bpedido\b/);
        // E o desfecho compara os TRES, senao "nao mudou nada" viraria "estendido".
        expect(corpo).toContain('pedido,');
        expect(corpo).toContain('efetivo,');
        expect(corpo).toContain('anterior:');
    });

    it('renovar NAO pede confirmacao, e revogar pede', () => {
        // Confirmar tudo treina a confirmar sem ler, e e a confirmacao do ato destrutivo que
        // paga o preco. Renovar e aditivo e reversivel (revogar continua ao lado).
        expect(corpoDeMetodo(ABA, 'async _extend(grant) {', 'grants-tab.js'))
            .not.toContain('showConfirm');
        expect(corpoDeMetodo(ABA, 'async _revoke(grant) {', 'grants-tab.js'))
            .toContain('showConfirm');
    });

    it('o prazo escolhido sobrevive ao re-render, e nasce no padrao', () => {
        // Cada ato rele as duas listas. Se o estado morasse no seletor, quem renovasse cinco
        // linhas por 30 dias escolheria 30 cinco vezes.
        expect(ABA).toContain('this._dias = GRANT_TERM_DEFAULT_DAYS;');
        expect(pos(ABA, 'this._dias = GRANT_TERM_DEFAULT_DAYS;', 'grants-tab.js'))
            .toBeLessThan(pos(ABA, '_termPicker()', 'grants-tab.js'));
    });
});

describe('as frases da aba', () => {
    it('a dica diz que o servidor APARA, que e a metade que nao pode sumir', () => {
        const frase = issuedExtensionHint();
        expect(frase).toContain('apara');
        expect(frase).toContain('menor');
        // Nao pode mandar ler um seletor que nao existe nesta tela: a irma do modal manda
        // ler o de "Conceder acesso", que e secao de outro arquivo.
        expect(frase).not.toContain('Conceder acesso');
    });

    it('o rotulo do seletor nao e vazio', () => {
        expect(issuedExtensionTermLabel().trim().length).toBeGreaterThan(0);
    });
});

describe('a aritmetica compartilhada aceita todos os degraus oferecidos', () => {
    it('todo degrau produz data ISO no FUTURO, ancorada ao meio-dia UTC', () => {
        // O servidor exige a data no futuro (`Joi.date().iso().greater('now')`), entao um
        // degrau que produzisse passado seria um botao que sempre devolve 400.
        const agora = Date.UTC(2026, 7, 24, 23, 59, 0);
        for (const p of GRANT_TERMS) {
            const iso = extensionDeadline(p.dias, agora);
            expect(iso, `degrau sem data: ${p.dias}`).toBeTruthy();
            const t = new Date(iso).getTime();
            expect(t, `degrau no passado: ${p.dias}`).toBeGreaterThan(agora);
            expect(new Date(iso).getUTCHours(), `degrau fora do meio-dia UTC: ${p.dias}`).toBe(12);
        }
    });
});
