// Path: tests/unit/salvar-como-local-nao-promete-restricao.test.js

/**
 * @fileoverview M8 DA CONSOLIDAÇÃO DO LOTE DO VISITANTE DESLOGADO, e ele nasceu de um agente
 * relatar o que NÃO conseguia fazer, e não de uma varredura.
 *
 * O aviso de poda afirmava "recursos restritos" em DUAS portas, e o achado nomeava uma só (o
 * `.ebgeo`). A outra é "Salvar como local", em `sidebar/tabs/maps.tab.js`, que chama o MESMO
 * `descreverPerdas` (portanto já ganhou os dois blocos de graça) com uma moldura que continuava
 * anunciando uma natureza só. Um achado varrido pelo escopo do DOCUMENTO que o encontrou, em vez
 * de pela FORMA do defeito, deixa o irmão de pé.
 *
 * ESTE ARQUIVO JÁ ABRIGOU O GÊMEO B1, a garantia `trabalho-local-intacto` dita a quem entrava
 * numa conta trabalhando local. O chefe mandou retirar a frase em 2026-08-25, e o caso negativo
 * que prende a retirada mora agora em `seus-atlas-sem-servidor.test.js`, junto da tabela de
 * avisos que ele interroga.
 *
 * O QUE ESTE ARQUIVO NÃO PRENDE: nada aqui observa pixel. As asserções de fiação leem a fonte,
 * então provam que o caminho existe, não que ele desenha. A prova de tela é a captura do
 * Playwright, que é outra camada.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAPS_TAB_SRC = readFileSync(resolve(FRONT, 'src/js/sidebar/tabs/maps.tab.js'), 'utf8');

/** A fonte sem comentários, para que uma asserção não case com a prosa que a explica. */
function semComentarios(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('M8: "Salvar como local" deixou de afirmar restrição', () => {
    it('a moldura não promete mais que só o restrito fica para trás', () => {
        expect(MAPS_TAB_SRC).not.toContain('nunca leva recurso de catálogo');
    });

    it('ela nomeia a razão verdadeira: fora do servidor não há como CONFERIR', () => {
        const src = semComentarios(MAPS_TAB_SRC);
        expect(src).toMatch(/fora dele não há como conferir quem pode ver o /);
        expect(src).toMatch(/comprovadamente público viaja nela/);
    });

    it('a porta continua medindo antes de perguntar, e com UMA medição só', () => {
        // `aviso-de-perda-de-recursos.test.js` exige exatamente uma chamada; repeti-la aqui não é
        // redundância, é a âncora que impede que "consertar o texto" vire "medir duas vezes".
        const src = semComentarios(MAPS_TAB_SRC);
        expect(src.match(/descreverPerdas\(relatorio\)/g)).toHaveLength(1);
        expect(src.indexOf('descreverPerdas(relatorio)'))
            .toBeLessThan(src.indexOf('Guardar uma cópia deste atlas neste computador?'));
    });
});
