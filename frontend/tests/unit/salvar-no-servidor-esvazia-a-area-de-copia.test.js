// Path: tests/unit/salvar-no-servidor-esvazia-a-area-de-copia.test.js

/**
 * @fileoverview "Salvar no servidor" do mapa troca a aba AO VIVO do atlas local para o atlas de
 * servidor que acabou de criar, e era a única entrada em atlas que não esvaziava a área de cópia.
 *
 * O custo, medido pelo desenho da fase 2b das fotos anexas (2026-09-24): a foto por referência da
 * feição copiada no atlas local aponta para um id que o atlas novo nunca recebeu, porque o envio
 * cunha um id novo para cada blob; colada ali, ela abria "A foto ainda não chegou" para sempre, no
 * autor e no par. A feição de imagem já tinha o mesmo buraco: `duplicateImageResource` lê o blob no
 * escopo NOVO, onde ele não existe. As outras entradas (`openRemoteAtlasNow`,
 * `switchToExistingLocalAtlas`, `switchToNewLocalAtlasNow`) esvaziam por `clearFeatureClipboard`
 * desde antes; este arquivo prende as quatro, porque a política é a mesma.
 *
 * ESTRUTURAL, e o motivo é o custo: o caminho vivo é o `onCreate` de um diálogo, com tab-lock,
 * namespace e conexão no meio. O que se prende é a chamada DEPOIS de o escopo remoto ser ativado
 * (antes disso a aba ainda está no atlas local, e a cópia continua valendo ali) e ANTES do wipe.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fonte = (arquivo) => readFileSync(resolve(__dirname, '../../src/js', arquivo), 'utf8')
    .split(/\r?\n/)
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .join('\n');

/** O corpo de uma função pelo nome, até a próxima declaração de topo. */
function corpo(texto, nome) {
    const inicio = texto.search(new RegExp(`function ${nome}\\(`));
    expect(inicio, `função ${nome}`).toBeGreaterThan(-1);
    const resto = texto.slice(inicio + 1);
    const fim = resto.search(/\n(export )?(async )?function /);
    return fim < 0 ? resto : resto.slice(0, fim);
}

describe('toda entrada em atlas esvazia a área de cópia', () => {
    it('"Salvar no servidor" esvazia depois de ativar o escopo remoto e antes do wipe', () => {
        const texto = fonte('account/account.control.js');
        const ativa = texto.indexOf('await activateRemoteAtlas(result.atlasId)');
        const esvazia = texto.indexOf('clearFeatureClipboard()', ativa);
        const wipe = texto.indexOf('await clearAllDataStore({ markLocal: false })', ativa);
        expect(ativa).toBeGreaterThan(-1);
        expect(wipe).toBeGreaterThan(ativa);
        expect(esvazia).toBeGreaterThan(ativa);
        expect(esvazia).toBeLessThan(wipe);
    });

    it.each(['openRemoteAtlasNow', 'switchToExistingLocalAtlas', 'switchToNewLocalAtlasNow'])(
        '%s esvazia (open-atlas.service.js)', (nome) => {
            expect(corpo(fonte('account/open-atlas.service.js'), nome)).toMatch(/clearFeatureClipboard\(\)/);
        });
});
