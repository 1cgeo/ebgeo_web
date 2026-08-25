// Path: tests/unit/portao-de-combinar-setas-espelhado.test.js

/**
 * @fileoverview O PORTÃO DE "COMBINAR SETAS" EXISTE EM DUAS CÓPIAS, e a segunda quase não foi
 * consertada.
 *
 * `canMergeArrows` mora em `military_tools/arrow_tool/arrow-merge.js` e é COPIADO, inline e
 * privado, em `tool_manager/helpers/feature-header.helpers.js`. A duplicação é deliberada e o
 * comentário de lá diz por quê: um import estático de `military_tools` a partir de `core` cria
 * ciclo de chunk. O que faltava era a consequência: a cópia não herda conserto nenhum.
 *
 * ================= O DEFEITO QUE ESTE ARQUIVO FECHA ==========================
 *
 * As duas cópias usavam `f.properties?.layerId || 'default'`, e o `||` troca um `layerId` de `0`
 * ou `''` pelo sentinela, fazendo duas setas de CAMADAS DIFERENTES passarem pelo portão de
 * mesma-camada.
 *
 * **A moldura honesta é DEFESA EM PROFUNDIDADE, não defeito vivo, e a distinção foi medida.** Um
 * `layerId` resolve hoje para UUID ou para o próprio sentinela `'default'`, os dois truthy, então
 * o gatilho só nasceria de dado corrompido ou importado. O relato que originou este arquivo o
 * chamou de defeito; ele é latente. O que É vivo, e é a razão de o arquivo existir, é a
 * DIVERGÊNCIA: em 2026-08-24 o original foi consertado e a cópia não, porque nada ligava as duas,
 * e uma cópia declarada sem guarda diverge na primeira revisão.
 *
 * ================= O QUE ESTE ARQUIVO NÃO ALCANÇA ============================
 *
 * Ele é LÉXICO nos dois lados: compara o TEXTO da linha decisiva, não o comportamento da cópia
 * privada (que não é exportada e não tem seam). Uma reescrita que preserve a semântica com outra
 * grafia fica vermelha aqui sem haver defeito, e é o preço de prender uma função sem export. O
 * lado exportado (`arrow-merge.js`) é exercitado por valor em `arrow-merge.test.js`; aqui só se
 * prende o ESPELHO.
 *
 * Ele também não alcança a outra assimetria medida no mesmo dia e deixada aberta de propósito:
 * `mergeArrows` NÃO chama `canMergeArrows`, então o portão é consultivo nos dois lados.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** As duas moradas do portão. A lista tem tamanho asserido: perder uma não pode passar verde. */
const COPIAS = [
    'src/js/military_tools/arrow_tool/arrow-merge.js',
    'src/js/tool_manager/helpers/feature-header.helpers.js',
];

/** A fonte sem comentários, para que a prosa que explica a regra não a satisfaça. */
function semComentarios(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * O CORPO de `canMergeArrows`, e nao o arquivo: `feature-header.helpers.js` tem VINTE E NOVE
 * outros sitios de `layerId ||` na arvore, e varre-los daqui transformaria este espelho num
 * censo de outra coisa, atravessando a propriedade de arquivos que nao sao deste assunto.
 */
function corpoDoPortao(src) {
    const i = src.indexOf('canMergeArrows');
    if (i < 0) return '';
    const resto = src.slice(i);
    const fim = resto.indexOf('\n}');
    return fim < 0 ? resto : resto.slice(0, fim);
}

const FONTES = COPIAS.map((rel) => ({
    rel,
    codigo: corpoDoPortao(semComentarios(readFileSync(resolve(FRONT, rel), 'utf8'))),
}));

describe('o portão de combinar setas está espelhado nas duas cópias', () => {
    it('as DUAS moradas existem e ainda carregam o portão', () => {
        // Sem isto, renomear uma das duas deixaria os casos seguintes vacuamente verdes.
        expect(FONTES).toHaveLength(2);
        for (const { rel, codigo } of FONTES) {
            expect(codigo, rel).toMatch(/canMergeArrows/);
            expect(codigo, rel).toMatch(/layerId/);
        }
    });

    it('nenhuma das duas usa `|| \'default\'`, a forma alinhada em 2026-08-24', () => {
        for (const { rel, codigo } of FONTES) {
            expect(codigo, `${rel} divergiu do gemeo: voltou a forma antiga`)
                .not.toMatch(/layerId\s*\|\|\s*'default'/);
        }
    });

    it('as duas usam `?? \'default\'`, e é a MESMA forma', () => {
        for (const { rel, codigo } of FONTES) {
            expect(codigo, rel).toMatch(/layerId\s*\?\?\s*'default'/);
        }
    });

    it('CONTROLE: o varredor lê código, não a prosa que o explica', () => {
        // Esta string aparece SÓ nos comentários deste arquivo e do `feature-header.helpers.js`.
        // Se a remoção de comentários falhar, os casos acima ficam verdes por acaso.
        for (const { rel, codigo } of FONTES) {
            expect(codigo, rel).not.toMatch(/ciclo de chunk/);
        }
    });
});
