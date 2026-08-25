// Path: tests/unit/auditoria-eixo-de-tempo.test.js

/**
 * @fileoverview O PERÍODO E O INTERVALO SÃO O MESMO EIXO, e este arquivo é o que impede os
 * dois de voltarem a discordar.
 *
 * O DEFEITO QUE ELE GUARDA PELO NOME. Até 2026-08-25 a barra da aba Auditoria tinha DOIS
 * controles para uma pergunta só: quatro botões de atalho (7 / 30 / 90 / Tudo) e, ao lado
 * deles, dois campos "De" e "Até". A relação entre uns e outros nunca foi declarada na tela,
 * e no código ela era esta: QUALQUER data preenchida descartava o atalho INTEIRO
 * (`janelaDoPeriodo` devolvia cedo assim que uma das duas datas existisse).
 *
 * A CONSEQUÊNCIA MEDIDA, e é por isso que isto é defeito e não feiura: com "7 dias" em vigor,
 * preencher só o "Até" mandava a consulta SEM `from`. A janela não apertava, ela ABRIA — para
 * a trilha inteira, desde o primeiro evento gravado. E a barra, nesse estado, não acendia
 * botão nenhum: nem o "7 dias", que já não mandava, nem o "Tudo", que era exatamente o
 * recorte em vigor. Ninguém na tela afirmava a janela que estava sendo consultada.
 *
 * Numa trilha de auditoria esse é o erro mais caro que existe, porque ele mente na direção
 * segura: a lista fica MAIOR do que se pediu, então nada parece quebrado. O erro simétrico
 * (lista menor) se denuncia sozinho, com uma linha faltando.
 *
 * O CONSERTO TEM DUAS METADES, e as duas estão medidas aqui. A regra, em `janelaDoPeriodo`: a
 * data absoluta refina a ponta que ela NOMEIA, e a ponta que ela não nomeia continua vindo do
 * atalho. A forma, em `audit-tab.js`: o eixo virou um `<select>` de cinco valores mutuamente
 * exclusivos, então os dois nem chegam a coexistir.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { janelaDoPeriodo, datasDoAtalho } from '../../src/js/admin/audit-phrases.js';

const ABA = readFileSync(fileURLToPath(new URL('../../src/js/admin/audit-tab.js', import.meta.url)), 'utf8');

const AGORA = new Date(2026, 7, 25, 15, 0, 0);

describe('a janela nunca alarga em silêncio', () => {
    it('preencher só o "Até" NÃO apaga o atalho em vigor', () => {
        // O VERMELHO DO CÓDIGO ANTIGO ESTÁ AQUI: ele devolvia `from: undefined`, isto é, a
        // trilha desde sempre, com "7 dias" escolhido na barra.
        const { from, to } = janelaDoPeriodo({ dias: 7, ate: '2026-08-20' }, AGORA);
        expect(from, 'a janela virou "tudo" sem ninguém pedir').toBeDefined();
        expect(new Date(from).getTime()).toBe(AGORA.getTime() - 7 * 86400000);
        expect(new Date(to)).toEqual(new Date(2026, 7, 21));
    });

    it('e o mesmo vale para o "De": ele refina o começo, não descarta o fim', () => {
        // A DIREÇÃO SIMÉTRICA, para o conserto não ser um remendo de um lado só.
        const { from, to } = janelaDoPeriodo({ dias: 7, de: '2026-08-01' }, AGORA);
        expect(new Date(from)).toEqual(new Date(2026, 7, 1));
        expect(to, '"até" vazio é o presente, e o presente não tem carimbo').toBeUndefined();
    });

    it('"Tudo" com uma data continua sendo "tudo" ATÉ aquela data', () => {
        // Sem atalho não há o que segurar, e inventar um começo seria afirmar um recorte que
        // ninguém escolheu.
        const { from, to } = janelaDoPeriodo({ dias: null, ate: '2026-08-20' }, AGORA);
        expect(from).toBeUndefined();
        expect(new Date(to)).toEqual(new Date(2026, 7, 21));
    });
});

describe('a barra não tem como fazer os dois discordarem', () => {
    it('o eixo é UM valor de estado, e não um atalho ao lado de duas datas', () => {
        // O par `_dias` + `_de`/`_ate` era o que permitia os dois estados coexistirem. Hoje o
        // estado é o `value` do seletor, e os dias saem dele.
        expect(ABA).toMatch(/this\._periodo = '7';/);
        expect(ABA, 'voltou a existir um `_dias` que pode discordar do seletor')
            .not.toMatch(/this\._dias\b/);
        expect(ABA).toMatch(/_diasDoPeriodo\(\)/);
    });

    it('sair do modo "Datas exatas" ESVAZIA as duas datas, sempre', () => {
        // É o invariante inteiro: fora do modo delas, as datas não existem, então não há como
        // um atalho aceso conviver com um intervalo preenchido.
        const troca = ABA.slice(ABA.indexOf('_trocarPeriodo(valor)'));
        expect(troca).toMatch(/if \(valor !== MODO_DATAS\) \{\s*this\._de = '';\s*this\._ate = '';/);
    });

    it('e os dois campos de data só são desenhados NO modo deles', () => {
        expect(ABA).toMatch(/if \(this\._periodo === MODO_DATAS\) \{/);
        // Os quatro botões de atalho, que eram o outro controle do mesmo eixo, saíram.
        expect(ABA, 'os botões de atalho voltaram, ao lado das datas')
            .not.toMatch(/admin-audit-periodo-\$\{/);
    });
});

describe('datasDoAtalho — a troca de modo é contínua', () => {
    it('entrar em "Datas exatas" pré-preenche a janela que ESTAVA em vigor', () => {
        // Sem isto, trocar de forma trocaria a lista: dois campos vazios são "tudo", e quem
        // vinha de "7 dias" veria a trilha inteira aparecer sem ter pedido.
        expect(datasDoAtalho(7, AGORA)).toEqual({ de: '2026-08-18', ate: '2026-08-25' });
        expect(datasDoAtalho(30, AGORA)).toEqual({ de: '2026-07-26', ate: '2026-08-25' });
    });

    it('vindo de "Tudo", o começo fica vazio', () => {
        // Não há começo para escrever no campo, e inventar um afirmaria um recorte que não
        // estava em vigor.
        expect(datasDoAtalho(null, AGORA)).toEqual({ de: '', ate: '2026-08-25' });
    });

    it('a data sai em `YYYY-MM-DD` LOCAL, que é o que o `<input type="date">` aceita', () => {
        // Um `toISOString().slice(0, 10)` erraria o dia em todo fuso a oeste de Greenwich
        // depois das 21h, que é o horário em que se investiga uma trilha.
        const noite = new Date(2026, 0, 5, 23, 30, 0);
        expect(datasDoAtalho(1, noite)).toEqual({ de: '2026-01-04', ate: '2026-01-05' });
    });
});
