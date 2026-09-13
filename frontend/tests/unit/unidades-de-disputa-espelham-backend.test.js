// Path: tests/unit/unidades-de-disputa-espelham-backend.test.js

/**
 * @fileoverview A tabela de unidades de disputa existe nos DOIS pacotes, e o servidor é o dono.
 *
 * POR QUE ISTO EXISTE. `DISPUTE_UNITS` (`backend/src/modules/sync/entity-conflicts.js`) decide o
 * veredito que o usuário vive: duas pessoas renomeando o mesmo mapa a partir da mesma base é
 * conflito, uma renomeando enquanto a outra desloca o mapa não é. O cliente precisa da MESMA
 * divisão para declarar o que mudou e para ler de volta uma recusa que nomeia `posicao`. Duas
 * tabelas, duas verdades: o modo de falha é mudo dos dois lados, porque cada pacote continua
 * internamente coerente enquanto discorda do outro.
 *
 * O molde é `sync-trace-espelha-backend.test.js`, inclusive a parte que mais importa: cada bloco
 * leva asserção ABSOLUTA além da comparação, porque comparar as duas cópias só uma com a outra
 * deixa passar duas cópias erradas do mesmo jeito.
 *
 * ALCANCE. Ele cobre o VOCABULÁRIO (quais alvos existem e quais unidades cada alvo tem), nunca a
 * semântica: um campo do cliente posto na unidade errada passa aqui, e quem pega isso é o caso de
 * contrato que compara a unidade declarada com a que o servidor deriva do payload.
 */

import { describe, it, expect } from 'vitest';
import {
    DISPUTE_UNITS as CLIENTE, DOCUMENTO, TODAS_AS_UNIDADES, hasDisputeUnits, unitsForFields,
} from '../../src/js/store/sync/dispute-units.js';
import {
    DISPUTE_UNITS as SERVIDOR, DOCUMENTO as DOCUMENTO_SERVIDOR,
} from '../../../backend/src/modules/sync/entity-conflicts.js';

/** Alvo do servidor → unidades que o CLIENTE declara para ele, somando os tipos de entidade. */
function unidadesDoClientePorAlvo() {
    const porAlvo = {};
    for (const spec of Object.values(CLIENTE)) {
        const nomes = spec.wholeDocument ? [DOCUMENTO] : spec.units.map((u) => u.unit);
        porAlvo[spec.target] = [...new Set([...(porAlvo[spec.target] ?? []), ...nomes])];
    }
    return porAlvo;
}

describe('as unidades de disputa do cliente espelham as do servidor', () => {
    // PISO. Sem ele, um import que resolvesse para objeto vazio (arquivo movido, export
    // renomeado) reportaria verde comparando dois conjuntos vazios.
    it('as duas tabelas foram de fato carregadas (piso contra comparação vazia)', () => {
        expect(Object.keys(SERVIDOR).length).toBe(9);
        expect(Object.keys(CLIENTE).length).toBe(18);
        expect(DOCUMENTO).toBe(DOCUMENTO_SERVIDOR);
        expect(DOCUMENTO).toBe('documento');
    });

    it('os alvos são exatamente os mesmos dos dois lados', () => {
        const doServidor = Object.keys(SERVIDOR).sort();
        expect(doServidor).toEqual([
            'briefing', 'catalog_layer', 'cesium3d', 'comment', 'group',
            'layer', 'map', 'slide', 'streetview360',
        ]);
        expect(Object.keys(unidadesDoClientePorAlvo()).sort()).toEqual(doServidor);
    });

    it('cada alvo tem o mesmo CONJUNTO de unidades dos dois lados', () => {
        const doCliente = unidadesDoClientePorAlvo();
        const divergentes = [];
        for (const [alvo, spec] of Object.entries(SERVIDOR)) {
            const esperado = (spec.wholeDocument ? [DOCUMENTO] : spec.units.map((u) => u.unit)).sort();
            const achado = [...doCliente[alvo]].sort();
            if (JSON.stringify(esperado) !== JSON.stringify(achado)) {
                divergentes.push(`${alvo}: servidor ${esperado.join()} / cliente ${achado.join()}`);
            }
        }
        expect(divergentes).toEqual([]);

        // ABSOLUTO, porque a comparação acima também passaria com as duas tabelas erradas do
        // mesmo jeito. Estes são os nomes escritos no cabeçalho do servidor.
        expect(SERVIDOR.map.units.map((u) => u.unit))
            .toEqual(['nome', 'posicao', 'mapaBase', 'notas', 'grade', 'temporal', 'travado']);
        expect(CLIENTE.map.units.map((u) => u.unit))
            .toEqual(['nome', 'posicao', 'mapaBase', 'notas', 'grade', 'temporal', 'travado']);
        expect(CLIENTE.layer.units.map((u) => u.unit))
            .toEqual(['nome', 'visivel', 'travado', 'opacidade', 'ordem', 'estilo']);
        expect(CLIENTE.comment.units.map((u) => u.unit)).toEqual(['resolvido', 'texto']);
    });

    // A NARRAÇÃO DO SUB-TIPO É O QUE O ESPELHO POR ALVO NÃO ALCANÇA. Um `mapPosition` só pode
    // tocar a posição, e é o servidor que impõe isso (`MAP_SUBTYPE_FIELDS`); declarar mais de uma
    // unidade aqui seria o cliente prometendo uma disputa que a escrita não tem.
    it('cada sub-tipo de mapa declara UMA unidade, e é a sua', () => {
        expect(CLIENTE.mapPosition.units.map((u) => u.unit)).toEqual(['posicao']);
        expect(CLIENTE.baseLayer.units.map((u) => u.unit)).toEqual(['mapaBase']);
        expect(CLIENTE.mapNotes.units.map((u) => u.unit)).toEqual(['notas']);
        expect(CLIENTE.gridStyle.units.map((u) => u.unit)).toEqual(['grade']);
        expect(CLIENTE.mapTemporal.units.map((u) => u.unit)).toEqual(['temporal']);
    });

    it('as três famílias de documento inteiro são as mesmas dos dois lados', () => {
        const inteirosNoServidor = Object.entries(SERVIDOR)
            .filter(([, spec]) => spec.wholeDocument).map(([alvo]) => alvo).sort();
        expect(inteirosNoServidor).toEqual(['catalog_layer', 'cesium3d', 'streetview360']);
        const inteirosNoCliente = [...new Set(Object.values(CLIENTE)
            .filter((spec) => spec.wholeDocument).map((spec) => spec.target))].sort();
        expect(inteirosNoCliente).toEqual(inteirosNoServidor);
    });

    it('membresia de grupo e preferência de atlas continuam SEM unidade, nos dois', () => {
        // Junção idempotente e merge por chave não têm perdedor: dar unidade a elas inventaria
        // uma disputa que o servidor não sabe julgar.
        expect(hasDisputeUnits('groupFeature')).toBe(false);
        expect(hasDisputeUnits('setting')).toBe(false);
        expect(Object.hasOwn(SERVIDOR, 'group_feature')).toBe(false);
        expect(Object.hasOwn(SERVIDOR, 'setting')).toBe(false);
    });

    it('campo desconhecido ALARGA para tudo, do mesmo jeito que no servidor', () => {
        // Falhar para o lado da recusa ampla: campo sem unidade é campo escrito sem comparação,
        // e uma recusa demais alguém percebe, uma sobrescrita silenciosa não.
        expect(unitsForFields('layer', ['inventado'])).toEqual([TODAS_AS_UNIDADES]);
        // O comentário é a exceção declarada: ele TEM um pega-tudo, que é a coluna `data`.
        expect(unitsForFields('comment', ['texto', 'autor'])).toEqual(['texto']);
        expect(unitsForFields('comment', ['status'])).toEqual(['resolvido']);
        expect(unitsForFields('comment', ['status', 'texto'])).toEqual(['resolvido', 'texto']);
    });

    it('os apelidos que o servidor resolve caem na unidade da coluna que ele escreve', () => {
        // `normalizeLayerChanges` dobra `order` em `sort_order`, e `normalizeMapChanges` dobra
        // `baseLayer` em `base_layer` e `title`/`description` em `notes_*`. Um apelido fora da
        // unidade certa é o cliente declarando uma coisa e escrevendo outra.
        expect(unitsForFields('layer', ['order'])).toEqual(['ordem']);
        expect(unitsForFields('layer', ['sort_order'])).toEqual(['ordem']);
        expect(unitsForFields('map', ['baseLayer'])).toEqual(['mapaBase']);
        expect(unitsForFields('map', ['title', 'description'])).toEqual(['notas']);
        expect(unitsForFields('mapTemporal', ['ativo', 'inicio'])).toEqual(['temporal']);
    });

    it('a posição do mapa é UMA unidade sobre cinco campos, nos dois lados', () => {
        // Recusar um zoom por causa de um bearing concorrente seria fiel às colunas e falso ao
        // gesto: deslocar o mapa é um movimento só.
        const noServidor = SERVIDOR.map.units.find((u) => u.unit === 'posicao');
        expect(noServidor.columns).toEqual(['center_lat', 'center_long', 'zoom', 'bearing', 'pitch']);
        expect(unitsForFields('map', ['zoom', 'bearing', 'pitch', 'center_lat', 'center_long']))
            .toEqual(['posicao']);
        expect(unitsForFields('mapPosition', ['centerLat', 'centerLong'])).toEqual(['posicao']);
    });
});
