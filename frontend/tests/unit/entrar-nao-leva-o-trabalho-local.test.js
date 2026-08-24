// Path: tests/unit/entrar-nao-leva-o-trabalho-local.test.js

/**
 * @fileoverview DOIS CONSERTOS DA CONSOLIDAÇÃO DO LOTE DO VISITANTE DESLOGADO, e os dois nasceram
 * de um agente relatar o que NÃO conseguia fazer, e não de uma varredura.
 *
 * B1 — entrar numa conta não dizia nada sobre o trabalho local que ficava para trás. O desfecho de
 * dados sempre foi o certo (nada é apagado), então o achado é só de fala. A correção proporcional
 * é uma linha, e ela precisou de um canal específico: `openProjectPicker` faz
 * `window.location.assign`, e um toast levantado antes morre com a página, porque o serviço de
 * toast não persiste em `sessionStorage` nem em `localStorage`. O canal que sobrevive é o
 * `?aviso=`, cuja tabela mora em `projects/atlas-drive.js`.
 *
 * M8 (gêmeo) — o aviso de poda afirmava "recursos restritos" em DUAS portas, e o achado nomeava
 * uma só (o `.ebgeo`). A outra é "Salvar como local", em `sidebar/tabs/maps.tab.js`, que chama o
 * MESMO `descreverPerdas` (portanto já ganhou os dois blocos de graça) com uma moldura que
 * continuava anunciando uma natureza só. Um achado varrido pelo escopo do DOCUMENTO que o
 * encontrou, em vez de pela FORMA do defeito, deixa o irmão de pé.
 *
 * O QUE ESTE ARQUIVO NÃO PRENDE: nada aqui observa pixel. As duas asserções de fiação leem a
 * fonte, então provam que o caminho existe, não que ele desenha. A prova de tela é a captura do
 * Playwright, que é outra camada.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrivalNotice } from '@js/projects/atlas-drive.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ACCOUNT_SRC = readFileSync(resolve(FRONT, 'src/js/account/account.control.js'), 'utf8');
const MAPS_TAB_SRC = readFileSync(resolve(FRONT, 'src/js/sidebar/tabs/maps.tab.js'), 'utf8');

/** A fonte sem comentários, para que uma asserção não case com a prosa que a explica. */
function semComentarios(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('B1: a garantia sobre o trabalho local existe e só é dita a quem entrou', () => {
    it('a frase existe, nomeia onde o trabalho está e nega o movimento', () => {
        const frase = arrivalNotice('trabalho-local-intacto', { signedIn: true });
        expect(typeof frase).toBe('string');
        // "Neste computador" é o nome LITERAL da seção de `atlas.html` para onde a pessoa acaba de
        // ser levada. Mandá-la olhar uma seção com outro nome seria pior que não dizer nada.
        expect(frase).toContain('Neste computador');
        expect(frase).toMatch(/não move nem apaga/);
    });

    it('quem não entrou não recebe a garantia, porque não fez a pergunta', () => {
        expect(arrivalNotice('trabalho-local-intacto', { signedIn: false })).toBeNull();
        expect(arrivalNotice('trabalho-local-intacto')).toBeNull();
    });

    it('o portão único não afrouxou para os dois códigos que já existiam', () => {
        for (const code of ['excluido', 'excluido-por-outro']) {
            expect(arrivalNotice(code, { signedIn: false })).toBeNull();
            expect(typeof arrivalNotice(code, { signedIn: true })).toBe('string');
        }
    });

    it('código desconhecido continua devolvendo null, e não a garantia', () => {
        for (const code of ['inventado', '', null, undefined, 0, {}, 'toString']) {
            expect(arrivalNotice(code, { signedIn: true })).toBeNull();
        }
    });

    it('ESTRUTURAL: o login PASSA o aviso, e só quando o trabalho era local', () => {
        const src = semComentarios(ACCOUNT_SRC);
        // O caminho até o efeito, não a existência da string: sem esta chamada a frase existe na
        // tabela e não chega a ninguém.
        expect(src).toContain("notice: 'trabalho-local-intacto'");
        expect(src).toMatch(/const trabalhavaLocal = !isRemoteStoreSync\(\);/);
        // E o ternário: quem já estava num atlas de servidor não recebe nada.
        expect(src).toMatch(/trabalhavaLocal \? \{ notice: 'trabalho-local-intacto' \} : undefined/);
    });

    it('CONTROLE: o varredor lê código, não a prosa que o explica', () => {
        // Esta string aparece SÓ num comentário deste arquivo e do `account.control.js`. Se a
        // remoção de comentários falhar, este caso fica verde por acaso e o de cima também.
        expect(semComentarios(ACCOUNT_SRC)).not.toContain('um toast levantado aqui morre com a página');
    });
});

describe('M8 gêmeo: "Salvar como local" deixou de afirmar restrição', () => {
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
