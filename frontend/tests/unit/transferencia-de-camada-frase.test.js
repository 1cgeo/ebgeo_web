// Path: tests/unit/transferencia-de-camada-frase.test.js

/**
 * A FRASE DA TRANSFERÊNCIA DE CAMADA DIZ O QUE ACONTECEU COM A ORIGEM.
 *
 * Defeito (até 2026-09-21): a frase era montada dentro da aba de feições a partir de dois fatos só
 * (`mode` e `sourceLayerRemoved`), e um MOVER tem três desfechos do lado da origem. Quando o
 * esvaziamento da origem era recusado no meio do gesto (o par trava o mapa, ou o papel é rebaixado,
 * entre a escrita do destino e o esvaziamento), a tela anunciava "Camada movida" mais o remendo "A
 * camada vazia continuou no mapa de origem", falso duas vezes: a camada continuava CHEIA, e as
 * mesmas feições ficavam nos dois mapas deste computador enquanto o servidor as tinha só no destino
 * (por um instante: medido em 2026-09-21, a origem se esvazia sozinha quando o servidor confirma).
 * E quando o mapa de origem tinha sido EXCLUÍDO por um par, o mesmo remendo falava de uma camada
 * vazia num mapa que não existe mais.
 *
 * A frase saiu para `src/js/features_tab/layer-transfer-phrases.js`, folha de zero imports, e o
 * resultado de `transferLayerToMap` ganhou `sourceEmptied`, `sourceMissing` e `sourceRefusal`
 * (presos em `tests/store/layer-transfer.test.js`).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { transferOutcomeNotice } from '../../src/js/features_tab/layer-transfer-phrases.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A successful MOVE result with the source emptied, overridable field by field. */
const mover = (extra = {}) => ({
    success: true, mode: 'move', movedCount: 3, skippedCount: 0,
    sourceLayerRemoved: true, sourceEmptied: true, sourceMissing: false, sourceRefusal: null,
    ...extra,
});

describe('a frase da transferência de camada', () => {
    it('caminho feliz: sucesso, com o verbo do modo e a contagem no plural certo', () => {
        expect(transferOutcomeNotice('Inimigo', 'Mapa B', mover())).toEqual({
            kind: 'success', text: 'Camada "Inimigo" movida para "Mapa B" (3 feições)',
        });
        expect(transferOutcomeNotice('Inimigo', 'Mapa B', mover({ mode: 'copy', movedCount: 1 })).text)
            .toBe('Camada "Inimigo" copiada para "Mapa B" (1 feição)');
    });

    it('só o REGISTRO da camada ficou para trás: o remendo antigo continua valendo', () => {
        const aviso = transferOutcomeNotice('Inimigo', 'Mapa B', mover({ sourceLayerRemoved: false }));
        expect(aviso.kind).toBe('success');
        expect(aviso.text).toBe('Camada "Inimigo" movida para "Mapa B" (3 feições). A camada vazia continuou no mapa de origem');
    });

    it('origem NÃO esvaziada: é AVISO, nomeia o estado, e não fala em camada vazia nem em "movida"', () => {
        const aviso = transferOutcomeNotice('Inimigo', 'Mapa B',
            mover({ sourceEmptied: false, sourceLayerRemoved: false, sourceRefusal: 'map_locked' }));
        expect(aviso.kind).toBe('warning');
        expect(aviso.text).toContain('foi copiada para "Mapa B" (3 feições)');
        expect(aviso.text).toContain('não pôde ser esvaziado na hora: ele está bloqueado');
        // O QUE VEM DEPOIS FOI MEDIDO TRÊS VEZES EM 2026-09-21, e cada medição desmentiu a anterior
        // (o cabeçalho de `layer-transfer-phrases.js` conta as três). O que ficou de pé: o duplicado
        // some sozinho em cerca de um segundo, para LADOS OPOSTOS conforme o servidor aceite ou
        // recuse, e com a trava REAL de um colega ele RECUSA, porque o gate dele confere também o
        // mapa de ORIGEM de um mover. A frase diz os dois desfechos e não promete qual.
        expect(aviso.text).toContain('se ele aceitar a mudança, as feições saem do mapa de origem sozinhas');
        expect(aviso.text).toContain('se recusar, a cópia em "Mapa B" é desfeita, a camada continua no mapa de origem');
        expect(aviso.text).toContain('o motivo é avisado na tela');
        expect(aviso.text).not.toContain('Recarregue');
        expect(aviso.text).not.toContain('estado do servidor');
        expect(aviso.text).not.toContain('movida');
        expect(aviso.text).not.toContain('levada');
        // "A camada vazia continua" era falso no desfecho da recusa, que é o da trava real.
        expect(aviso.text).not.toContain('camada vazia');
    });

    it('o motivo do PAPEL tem frase própria, e motivo desconhecido cai na frase genérica', () => {
        const base = { sourceEmptied: false, sourceLayerRemoved: false };
        expect(transferOutcomeNotice('L', 'M', mover({ ...base, sourceRefusal: 'permission' })).text)
            .toContain('a sua permissão neste atlas mudou');
        expect(transferOutcomeNotice('L', 'M', mover({ ...base, sourceRefusal: 'unknown' })).text)
            .toContain('a escrita foi recusada');
        // Valor que não é chave própria da tabela: `toString` existe no protótipo de todo objeto.
        expect(transferOutcomeNotice('L', 'M', mover({ ...base, sourceRefusal: 'toString' })).text)
            .toContain('a escrita foi recusada');
        expect(transferOutcomeNotice('L', 'M', mover({ ...base, sourceRefusal: null })).text)
            .toContain('a escrita foi recusada');
    });

    it('origem EXCLUÍDA por um par: sucesso, diz isso, e NÃO fala em camada vazia', () => {
        const aviso = transferOutcomeNotice('Inimigo', 'Mapa B', mover({ sourceMissing: true }));
        expect(aviso.kind).toBe('success');
        expect(aviso.text).toBe('Camada "Inimigo" movida para "Mapa B" (3 feições). O mapa de origem foi removido por outro usuário');
        // Mesmo que o registro conste como não removido, o remendo seria falso: não há mapa.
        expect(transferOutcomeNotice('Inimigo', 'Mapa B', mover({ sourceMissing: true, sourceLayerRemoved: false })).text)
            .not.toContain('camada vazia');
    });

    it('COPIAR ignora os campos da origem, mesmo que cheguem preenchidos', () => {
        const aviso = transferOutcomeNotice('L', 'M',
            mover({ mode: 'copy', sourceEmptied: false, sourceMissing: true, sourceRefusal: 'map_locked' }));
        expect(aviso).toEqual({ kind: 'success', text: 'Camada "L" copiada para "M" (3 feições)' });
    });

    it('as feições de análise deixadas para trás entram no fim, nos três desfechos', () => {
        const cauda = '. 2 feições de análise (LOS/visibilidade) não foram levadas';
        expect(transferOutcomeNotice('L', 'M', mover({ skippedCount: 2 })).text.endsWith(cauda)).toBe(true);
        expect(transferOutcomeNotice('L', 'M', mover({ skippedCount: 2, sourceMissing: true })).text.endsWith(cauda)).toBe(true);
        expect(transferOutcomeNotice('L', 'M', mover({ skippedCount: 2, sourceEmptied: false })).text.endsWith(cauda)).toBe(true);
        expect(transferOutcomeNotice('L', 'M', mover({ skippedCount: 1 })).text)
            .toContain('1 feição de análise (LOS/visibilidade) não foi levada');
    });

    it('BORDA: resultado nulo, contagem ausente ou não finita não quebram nem imprimem NaN', () => {
        expect(transferOutcomeNotice('L', 'M', null).text).toBe('Camada "L" copiada para "M" (0 feições)');
        for (const movedCount of [undefined, NaN, Infinity, '3']) {
            expect(transferOutcomeNotice('L', 'M', mover({ movedCount })).text).toContain('(0 feições)');
        }
    });
});

describe('a aba de feições usa a frase e respeita a origem ainda cheia', () => {
    const texto = readFileSync(path.join(RAIZ, 'src/js/features_tab/features_tab.js'), 'utf8').replace(/\r\n/g, '\n');
    const inicio = texto.indexOf('async handleTransferLayer(');
    const corpo = texto.slice(inicio, texto.indexOf('\n    }\n', inicio));

    it('PISO: o gesto existe e chama a operação', () => {
        expect(inicio).toBeGreaterThan(-1);
        expect(corpo).toContain('transferLayerToMap(');
    });

    it('a frase vem do módulo folha, e o aviso substitui o toast genérico da recusa no MESMO canal', () => {
        expect(texto).toMatch(/import \{ transferOutcomeNotice \} from '\.\/layer-transfer-phrases\.js';/);
        expect(corpo).toContain('transferOutcomeNotice(layer.name, targetMapName, result)');
        expect(corpo).toMatch(/showInChannel\('store-blocked', notice\.text, 'warning'/);
        expect(texto).not.toContain('_buildTransferMessage');
    });

    it('com a origem ainda CHEIA a tela não desseleciona nem apaga as feições das fontes do mapa', () => {
        const guarda = corpo.indexOf('if (isMove && !sourceStillFull) {');
        const limpa = corpo.indexOf('_syncMapSourcesAfterDelete(');
        expect(corpo).toContain('const sourceStillFull = isMove && result.sourceEmptied === false;');
        expect(guarda).toBeGreaterThan(-1);
        expect(limpa).toBeGreaterThan(guarda);
        expect(corpo.indexOf('_deselectFeaturesOfLayer(')).toBeGreaterThan(guarda);
    });
});
