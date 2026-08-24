// Path: tests/unit/concessoes-alcance-do-administrador.test.js

/**
 * @fileoverview A ABA "Concessões" PARA QUEM ADMINISTRA O SISTEMA, e a única assimetria que a
 * mudança de 2026-08-24 abriu.
 *
 * A aba nasceu para o credenciado e repousava numa propriedade da CONSULTA, escrita no
 * `fileoverview` dela: `grants/issued` filtra por `granted_by = <quem pergunta>`, e o gate de
 * revogação do servidor (`requireGrantRevoker`) tem um ramo estreito que pergunta por AUTORIA.
 * Para o credenciado e para o produtor os dois conjuntos COINCIDEM, e por isso "o que eu concedi"
 * é também "o que o servidor me deixa revogar", sem que a tela precise gatear botão nenhum.
 *
 * PARA O ADMINISTRADOR ELES NÃO COINCIDEM, e a diferença é só numa direção: o ramo LARGO daquele
 * gate é administração do sistema, então ele revoga também o que não originou, e essas linhas
 * NUNCA aparecem na consulta (medido na query: `LIST_GRANTS_ISSUED_BY_ACTOR` não tem ramo de
 * papel). Nenhuma linha da lista fica desonesta, porque toda linha é dele; o que a lista faz é
 * SUBDECLARAR o alcance, e uma tela que subdeclara autoridade ensina a concluir que a autoridade
 * não existe. É esse o buraco que `issuedReachNotice` tapa, e ele é o motivo de esta suíte existir
 * separada: as demais frases da aba não variam por papel global, e esta é a única que varia.
 *
 * O QUE ESTA SUÍTE NÃO ALCANÇA, dito em voz alta: não há jsdom neste pacote (o ambiente do vitest
 * é `node`), então o parágrafo REALMENTE aparecendo na tela é matéria de Playwright, não daqui. O
 * que fica preso aqui é a frase (função pura) e o CAMINHO até ela (o perfil sair de
 * `mountAdminPage`, entrar na fábrica e chegar ao ponto de decisão), que é onde o defeito de
 * fiação moraria. Asserção sobre fonte é fraca por natureza; o controle negativo de cada uma
 * apagou o elo, não a frase.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issuedReachNotice } from '../../src/js/admin/grant-phrases.js';
import { createGrantsTab } from '../../src/js/admin/grants-tab.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** @param {string} rel @returns {string} */
function fonte(rel) {
    return readFileSync(resolve(FRONT, rel), 'utf8');
}

/**
 * Remove comentários: a varredura mede CÓDIGO. O `fileoverview` da própria aba NOMEIA
 * `sessionContext` para dizer que ela não o lê, e acusar essa frase ensinaria a apagar a
 * explicação, que é o contrário do que este guarda quer (mesmo raciocínio de
 * `admin-audiencia.test.js`).
 * @param {string} texto @returns {string}
 */
const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('issuedReachNotice — a frase que só o administrador do sistema lê', () => {
    it('fala para quem administra, e diz as três coisas que a lista não diz', () => {
        const frase = issuedReachNotice({ isAdmin: true });
        // NOMEIA O ALCANCE MAIOR (o ramo largo do gate), senão a frase seria decorativa.
        expect(frase).toMatch(/revogar também concessões que outras\s+pessoas fizeram/);
        // DIZ QUE A LISTA É PARCIAL, que é o fato que a tela sozinha não conta.
        expect(frase).toMatch(/SÓ as suas/);
        // E NOMEIA A SAÍDA REAL. Sem ela, a frase informa um poder e não diz onde exercê-lo, que
        // é a forma de aviso que a casa já recusou no lado "Recebidos" (ver
        // `receivedNotRevocableNotice`): espaço vazio, ou beco, se lê como tela quebrada.
        expect(frase).toMatch(/cartão do recurso/);
        expect(frase).toMatch(/catálogo/);
        // E ela cobre os DOIS lados da aba, porque mora acima das duas seções.
        expect(frase).toMatch(/Recebidos por mim/);
    });

    it('é SILÊNCIO para quem não administra o sistema, nos três jeitos de perguntar', () => {
        // O credenciado e o produtor caem aqui, e para eles a frase seria FALSA: os dois revogam
        // exatamente o que a lista mostra. Uma frase que promete alcance a quem não o tem é o
        // erro simétrico ao que a de cima conserta.
        expect(issuedReachNotice({ isAdmin: false })).toBe('');
        expect(issuedReachNotice({})).toBe('');
        expect(issuedReachNotice()).toBe('');
    });

    it('o módulo continua FOLHA depois da frase nova', () => {
        // `admin.html` boota sem a store, e um import aqui a arrastaria de volta pelo caminho
        // transitivo. A frase nova não precisa de nada, e esta asserção é o que impede a
        // PRÓXIMA de importar `session-context.js` para ler o papel sozinha.
        const src = fonte('src/js/admin/grant-phrases.js');
        expect(src).not.toMatch(/^\s*import\s/m);
        expect(src).not.toMatch(/\brequire\s*\(/);
    });
});

describe('o CAMINHO do perfil até a frase (é aqui que a fiação quebra, não na frase)', () => {
    it('a fábrica aceita o perfil e continua devolvendo a aba `grants`', () => {
        // O descritor é o que `mountAdminPage` empurra para o painel. As duas chamadas passam,
        // porque a assinatura nova tem default: uma fábrica que exigisse o argumento derrubaria
        // a montagem de quem ainda a chamasse sem ele, em silêncio de tipo.
        for (const perfil of [{ isAdmin: true }, { isAdmin: false }, undefined]) {
            const aba = createGrantsTab(perfil);
            expect(aba.id).toBe('grants');
            expect(aba.label).toBe('Concessões');
            expect(typeof aba.mount).toBe('function');
        }
    });

    it('`mountAdminPage` passa às fábricas o MESMO perfil que decidiu as abas', () => {
        // A aba lida por `sessionContext` por conta própria seria a segunda leitura do mesmo
        // fato, com chance de discordar da audiência que acabou de decidir que ela existe. O elo
        // é o objeto único: ele vai para `adminAudience` e para a fábrica.
        const src = fonte('src/js/admin/index.js');
        expect(src).toMatch(/adminAudience\(principal\)/);
        expect(src).toMatch(/factory\(principal\)/);
        // A discriminação: o perfil é o que a sessão diz, e não um literal escrito no meio do
        // caminho. Se alguém trocar a leitura por `true`, o painel promove todo mundo.
        expect(src).toMatch(/isAdmin: sessionContext\.isAdmin\(\)/);
    });

    it('a aba consulta a frase com o perfil RECEBIDO, e não lê a sessão', () => {
        const src = semComentarios(fonte('src/js/admin/grants-tab.js'));
        expect(src).toMatch(/issuedReachNotice\(\{ isAdmin: this\._isAdmin \}\)/);
        // NÃO LÊ A SESSÃO: é o que mantém a aba montável sem sessão (o teste acima a constrói em
        // node) e o que impede a terceira definição de "quem é esta pessoa" dentro do painel.
        expect(src).not.toMatch(/session-context/);
        expect(src).not.toMatch(/sessionContext/);
    });

    it('a frase é a ÚNICA coisa que varia por papel global dentro da aba', () => {
        // O gate é do SERVIDOR, e a aba não desenha nenhum. Se `_isAdmin` começar a decidir
        // botão, coluna ou consulta, esta linha fica vermelha e obriga a passar pelo cabeçalho:
        // um botão condicionado a papel no cliente é a lista fechada que a constituição proíbe,
        // e aqui ela seria escrita sobre o eixo que NÃO é uma escada.
        //
        // Conta LEITURA, não a escrita do construtor (daí o `(?!\s*=)`): a atribuição é o único
        // lugar em que o campo aparece à esquerda, e contá-la faria o número desta linha depender
        // de onde o campo nasce em vez de para que ele serve.
        const src = semComentarios(fonte('src/js/admin/grants-tab.js'));
        const leituras = [...src.matchAll(/this\._isAdmin(?!\s*=)/g)];
        expect(leituras.length, 'apareceu uma segunda LEITURA de `_isAdmin` na aba').toBe(1);
        // O piso: se o campo mudar de nome, a contagem acima vira zero e passaria verde sozinha.
        expect(src).toMatch(/this\._isAdmin = isAdmin === true;/);
    });
});
