// Path: tests/store/teto-do-portao-de-versao.test.js

/**
 * @fileoverview O TETO que decide qual `.ebgeo` entra, medido no predicado e nao no servico.
 *
 * O portao do import (`import_export/ebgeo-file-gate.js`, `importVersionRefusal`) recusa todo
 * arquivo cuja versao declarada seja MAIOR que `ATLAS_SCHEMA_VERSION`. A regra fica: ela e
 * simetrica nas duas linhas do produto, e protege o gesto destrutivo que vem logo depois dela
 * (o import nao aditivo limpa o projeto do usuario). O que mudou em 2026-09-07 foi so o TETO.
 *
 * ISTO IMPORTAVA MAIS DO QUE PARECIA. A outra linha do produto exporta `version: "2.4"`, e
 * enquanto a constante daqui foi '2.3' todo arquivo gerado por ela desde 2026-09-06 era
 * recusado INTEIRO, com uma mensagem mandando o usuario "atualizar a aplicacao", que na
 * travessia e o conselho oposto do certo. Medido: 805 feicoes recusadas; o MESMO arquivo com o
 * campo `version` reescrito para "2.3" entrava sem perder nada. Ou seja, o conteudo ja era
 * legivel e o que barrava 805 feicoes era o numero. Esse era o unico caminho de salvacao se a
 * aplicacao nova nao for servida na MESMA origem da antiga, porque ai o IndexedDB nao atravessa
 * e so o arquivo salva o usuario.
 *
 * POR QUE O TESTE E PURO. O servico de import e do lote C e exige DOM, JSZip e a store montada.
 * O que este arquivo prende e o PREDICADO: as duas constantes e a comparacao entre elas. Um
 * teste que chamasse o servico mediria o servico; este mede a regra que o servico aplica, e e
 * ela que a subida de versao move.
 */

import { describe, it, expect } from 'vitest';
import { compareVersions, MIN_SCHEMA_VERSION } from '@store/repository.utils.js';
import { ATLAS_SCHEMA_VERSION } from '@store/atlas/atlas.entity.js';

/**
 * O predicado do portao, escrito aqui a partir das MESMAS duas constantes que
 * `importVersionRefusal` le. Nao e uma copia da funcao: e a regra que ela implementa.
 * @param {string} versao - Versao declarada no `data.json` do arquivo.
 * @returns {boolean} Se o arquivo passa pelo teto e pelo piso.
 */
function passaNoPortao(versao) {
    return compareVersions(versao, MIN_SCHEMA_VERSION) >= 0
        && compareVersions(versao, ATLAS_SCHEMA_VERSION) <= 0;
}

describe('o teto do portao do .ebgeo', () => {
    it('aceita 2.2, 2.3 e 2.4, que sao as tres versoes que a outra linha do produto exporta', () => {
        expect(passaNoPortao('2.2')).toBe(true);
        expect(passaNoPortao('2.3')).toBe(true);
        // A que estava fora, e a que motivou a subida: a outra linha exporta 2.4 desde
        // 2026-09-06.
        expect(passaNoPortao('2.4')).toBe(true);
    });

    it('aceita a propria versao corrente, que e o arquivo que este app exporta', () => {
        expect(passaNoPortao(ATLAS_SCHEMA_VERSION)).toBe(true);
        expect(ATLAS_SCHEMA_VERSION).toBe('3.0');
    });

    it('RECUSA 3.1, que e uma versao futura deste mesmo app', () => {
        // O pior caso do lado de cima: aceitar em silencio um formato que este codigo nao
        // conhece e a classe de defeito oposta e mais cara, porque o import nao aditivo limpa o
        // projeto do usuario logo depois do portao.
        expect(passaNoPortao('3.1')).toBe(false);
        expect(passaNoPortao('4.0')).toBe(false);
    });

    it('RECUSA abaixo do piso legado', () => {
        expect(passaNoPortao('1.2')).toBe(false);
        expect(passaNoPortao('1.3')).toBe(true);
    });

    it('o teto esta ACIMA de toda versao que a outra linha pode ter produzido', () => {
        // Escrito como ordenacao, e nao como lista de literais, porque e a propriedade que tem
        // de valer: se um dia a constante daqui voltar para 2.x, esta linha reprova antes de a
        // recusa chegar ao usuario.
        for (const versaoDaOutraLinha of ['2.2', '2.3', '2.4']) {
            expect(compareVersions(versaoDaOutraLinha, ATLAS_SCHEMA_VERSION)).toBe(-1);
        }
    });

    it('CONTRAPARTIDA, dita em voz alta: um arquivo 3.0 NAO volta para a outra linha', () => {
        // O espelho da regra, e ele e o preco da subida. A outra linha esta em 2.4 e aplica o
        // mesmo predicado, entao ela recusa 3.0 com a mesma mensagem, antes de destruir nada.
        // A partir da travessia o `.ebgeo` e via de MAO UNICA, e isso esta registrado na
        // decisao de 2026-09-07.
        const TETO_DA_OUTRA_LINHA = '2.4';
        expect(compareVersions(ATLAS_SCHEMA_VERSION, TETO_DA_OUTRA_LINHA)).toBe(1);
    });
});
