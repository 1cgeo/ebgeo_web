// Path: tests/unit/configuracoes-atlas-alcance-da-aparencia.test.js

/**
 * @fileoverview O RODAPÉ DE "CONFIGURAÇÕES" NÃO PROMETE COMPARTILHAMENTO NUM ATLAS LOCAL.
 *
 * A frase do rodapé dizia, para quem não administra restrições, "Vale para este atlas, neste
 * computador e para quem o compartilha", sem condição nenhuma. A segunda metade não significa nada
 * num atlas LOCAL: atlas local não se compartilha pelo sistema (`CONSTITUICAO.md` 7.5), então ela
 * prometia a um visitante deslogado um efeito que a tela dele não tem. Num atlas de SERVIDOR ela é
 * verdadeira mesmo sem `manage`, porque a aparência viaja por sync para os outros participantes.
 *
 * O que separa os dois casos é o MARCADOR DE ORIGEM (`store/store-origin.js`, `isRemoteStoreSync`),
 * que é o predicado da casa para local contra remoto, e não a permissão.
 *
 * ============================ O QUE ESTE ARQUIVO PRENDE ==============================
 *
 * Duas metades, e a segunda é a que impede a regressão:
 *
 *   1. a FUNÇÃO pura `appearanceScopeNote`, nos três desfechos, com o controle negativo dentro do
 *      próprio bloco: afirmar que o remoto diz "para quem o compartilha" não discrimina uma
 *      implementação que dissesse isso sempre. O que reprova essa é a asserção de que o LOCAL não
 *      diz;
 *   2. a FIAÇÃO: que a tela chame essa função, e que a frase de compartilhamento não exista em
 *      lugar nenhum do arquivo fora dela. É varredura de TEXTO sobre o fonte, e é o que fica
 *      vermelho quando alguém devolve o literal incondicional ao `_renderBody`, que é exatamente a
 *      forma do defeito corrigido.
 *
 * ============================ O QUE ELE NÃO PRENDE ==================================
 *
 * O ambiente é node puro, sem jsdom, e `_renderBody` escreve `innerHTML` numa árvore de verdade:
 * nenhuma asserção aqui monta a tela. A metade 2 mede PRESENÇA e AUSÊNCIA de texto no fonte, nunca
 * semântica: uma chamada a `appearanceScopeNote` cujo resultado fosse jogado fora passa verde. E
 * nada aqui prova que `isRemoteStoreSync()` esteja carregado no instante em que o modal abre.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appearanceScopeNote } from '@modals/atlas-settings.modal.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * O CÓDIGO do modal, sem comentário nenhum. A limpeza não é higiene: o próprio JSDoc da correção
 * cita a frase antiga entre aspas, e contar ocorrências sobre o arquivo cru contaria a explicação
 * junto com a implementação.
 */
const FONTE = readFileSync(resolve(FRONT, 'src/js/modals/atlas-settings.modal.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/** A promessa que só um atlas de servidor pode fazer. */
const PROMESSA = 'para quem o compartilha';

/**
 * O corpo de um método/função do fonte, do `nome(` até a coluna em que a chave fecha.
 * @param {string} nome
 * @returns {string}
 */
function corpoDe(nome) {
    // ANCORADO NO INÍCIO DA LINHA, e isso não é detalhe: um `indexOf` solto acha a CHAMADA
    // (`this._renderBody()`, escrita antes da definição) e devolve o corpo da função seguinte,
    // que é um verde ou um vermelho sobre o arquivo errado.
    const definicao = new RegExp(`^\\s*${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(`, 'm');
    const achado = definicao.exec(FONTE);
    expect(achado, `a definição de ${nome} existe no arquivo`).not.toBeNull();

    // A LISTA DE PARÂMETROS PRIMEIRO. `appearanceScopeNote({ canRestrict = false, ... })`
    // desestrutura, então a primeira chave depois do nome é a do ARGUMENTO, não a do corpo.
    let parenteses = 0;
    let cursor = achado.index + achado[0].length - 1;
    do {
        if (FONTE[cursor] === '(') parenteses += 1;
        else if (FONTE[cursor] === ')') parenteses -= 1;
        cursor += 1;
    } while (parenteses > 0 && cursor < FONTE.length);

    const inicio = FONTE.indexOf('{', cursor);
    let profundidade = 0;
    for (let i = inicio; i < FONTE.length; i += 1) {
        if (FONTE[i] === '{') {
            profundidade += 1;
        } else if (FONTE[i] === '}') {
            profundidade -= 1;
            if (profundidade === 0) return FONTE.slice(inicio, i + 1);
        }
    }
    throw new Error(`corpo de ${nome} não fecha`);
}

describe('configurações do atlas: o alcance da escolha de aparência', () => {
    it('quem administra o projeto ouve a frase dos participantes, local ou remoto', () => {
        expect(appearanceScopeNote({ canRestrict: true, isRemote: true }))
            .toBe('Vale para todos os participantes deste atlas.');
        // `canRestrict` só é verdadeiro num atlas de servidor; a asserção aqui é de que a origem
        // não muda esse ramo, para que ninguém "conserte" o topo junto com o fundo.
        expect(appearanceScopeNote({ canRestrict: true, isRemote: false }))
            .toBe('Vale para todos os participantes deste atlas.');
    });

    it('num atlas de SERVIDOR sem manage a frase mantém a promessa de compartilhamento', () => {
        const frase = appearanceScopeNote({ canRestrict: false, isRemote: true });
        expect(frase).toBe('Vale para este atlas, neste computador e para quem o compartilha.');
        expect(frase).toContain(PROMESSA);
    });

    it('num atlas LOCAL a promessa de compartilhamento SOME', () => {
        const frase = appearanceScopeNote({ canRestrict: false, isRemote: false });
        expect(frase).toBe('Vale para este atlas, neste computador.');
        expect(frase, 'é isto que o visitante deslogado não pode ouvir').not.toContain(PROMESSA);
    });

    it('o padrão (sem argumento nenhum) é o caso fechado, não o que promete', () => {
        // Falha FECHADA: um chamador que esqueça de passar a origem promete de menos, nunca de
        // mais, que é a direção certa para uma frase sobre alcance.
        expect(appearanceScopeNote()).not.toContain(PROMESSA);
        expect(appearanceScopeNote({})).toBe('Vale para este atlas, neste computador.');
    });

    it('a tela deriva a frase da função, e o literal não sobrevive fora dela', () => {
        const renderBody = corpoDe('_renderBody');
        expect(renderBody, 'o rodapé chama a função pura').toContain('appearanceScopeNote(');
        expect(renderBody, 'e lê a origem pelo marcador da casa').toContain('isRemoteStoreSync(');

        // A ASSERÇÃO QUE PRENDE A REGRESSÃO: o literal condicionado existe UMA vez no arquivo, e
        // dentro da função. Devolver o ternário incondicional ao `_renderBody` cria a segunda
        // ocorrência e derruba isto, mesmo que a função continue exportada e testada acima.
        const ocorrencias = FONTE.split(PROMESSA).length - 1;
        expect(ocorrencias, `"${PROMESSA}" aparece uma vez só`).toBe(1);
        expect(corpoDe('export function appearanceScopeNote')).toContain(PROMESSA);
    });
});
