// Path: tests/unit/balde-de-analise-processada-no-envio.test.js

/**
 * @fileoverview Prende o BALDE da feição no envio do atlas local ao servidor (`buildFeatures`,
 * dentro de `buildServerImportPayload`, `src/js/import_export/local-atlas-to-server.js`).
 *
 * O DEFEITO QUE ELE EXISTE PARA REPROVAR (onda 3, B3-5). O tipo do servidor saía de
 * `props.source || BUCKET_TO_SOURCE[bucket]`, e o resultado de uma análise carrega
 * `properties.source = 'los'`/`'visibility'` enquanto mora no balde `processed_los`/
 * `processed_visibility`. Medido nos dois lados: o arquivo tem `los: 3, processed_los: 6,
 * visibility: 3, processed_visibility: 6`, o servidor gravou `los: 9, visibility: 9` e os dois
 * baldes processados vazios, e o namespace do atlas de servidor no navegador leu o mesmo
 * `9/9/0/0`. Doze feições de 805 voltaram como DEFINIÇÃO de visada em vez de RESULTADO.
 *
 * O CONTRATO DO SERVIDOR, lido na fonte antes do conserto: `processed_los` e
 * `processed_visibility` são tipos ACEITOS, nos três lugares onde o servidor os declara:
 * o CHECK `valid_feature_type` (`backend/src/database/migrations/003_atlas.sql:249-257`), o
 * `VALID_FEATURE_TYPES` do Joi (`backend/src/modules/atlas/atlas.schemas.js:139-153`) e o
 * `typeToCollection` do snapshot (`backend/src/modules/sync/sync.service.js:774-801`). Logo o
 * conserto é só no cliente, e nenhum campo do servidor mudou por causa deste achado.
 *
 * A REGRA CONSERTADA, e o limite dela: o balde vence quando ele é um balde CONHECIDO
 * (`BUCKET_TO_SOURCE`), porque é o balde que diz onde a feição mora de verdade no
 * `feature-type.registry.js`. Para balde DESCONHECIDO (`coordenadas`, o leitor efêmero de azimute)
 * a precedência antiga fica de pé, e é por isso que o caso do `coordenadas` continua aqui: sem
 * ele, a inversão de precedência mudaria em silêncio o que aquele balde faz.
 *
 * DESDE 2026-09-23 O RESULTADO DA ANÁLISE NÃO SOBE MAIS, e o primeiro caso mudou de sentido por
 * isso. A saída (`processed_*`) passou a ser DERIVADA por cada cliente a partir da entrada
 * (`store/analysis-output.js`), e o retrato descarta o que o servidor guardar naqueles baldes.
 * Subir as saídas deixava no servidor linhas com UUID aleatório (o id local `<entrada>-visible`
 * não é UUID), que nenhuma exclusão da entrada alcançava. O que este arquivo continua prendendo
 * é a regra do balde para todo balde que SOBE.
 */

import { describe, it, expect } from 'vitest';
import { buildServerImportPayload } from '@js/import_export/local-atlas-to-server.js';
import { generateUUID } from '@utils/uuid.js';

/** Feição de ponto mínima, com `properties.source` explícito. */
function feicao(source, extra = {}) {
    return {
        type: 'Feature',
        properties: { id: generateUUID(), source, ...extra },
        geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    };
}

/** @param {Object} buckets */
function tiposDoEnvio(buckets) {
    const { payload } = buildServerImportPayload({ maps: { M: { features: buckets } } }, { name: 'A' });
    const conta = {};
    for (const f of payload.maps[0].features) conta[f.feature_type] = (conta[f.feature_type] || 0) + 1;
    return conta;
}

describe('B3-5: o balde decide o tipo, e o resultado da analise nao sobe', () => {
    it('processed_los e processed_visibility nao sobem nem viram los e visibility, e nao contam como perda', () => {
        const conta = tiposDoEnvio({
            los: [feicao('los'), feicao('los'), feicao('los')],
            processed_los: [feicao('los'), feicao('los'), feicao('los'), feicao('los'), feicao('los'), feicao('los')],
            visibility: [feicao('visibility'), feicao('visibility'), feicao('visibility')],
            processed_visibility: [feicao('visibility'), feicao('visibility'), feicao('visibility'),
                feicao('visibility'), feicao('visibility'), feicao('visibility')],
        });

        expect(conta).toEqual({ los: 3, visibility: 3 });

        const { stats } = buildServerImportPayload({
            maps: { M: { features: { processed_los: [feicao('los')], processed_visibility: [feicao('visibility')] } } },
        }, { name: 'A' });
        expect(stats.droppedFeatures).toBe(0);
    });

    it('o balde conhecido decide, mesmo quando o source discorda dele', () => {
        const conta = tiposDoEnvio({
            military_symbols: [feicao('point')],
            magnetic_declinations: [feicao('line')],
        });

        expect(conta).toEqual({ military_symbol: 1, magnetic_declination: 1 });
    });

    it('sem properties.source, o balde continua respondendo (o caso de sempre)', () => {
        const f = feicao('point');
        delete f.properties.source;
        expect(tiposDoEnvio({ setores: [f] })).toEqual({ sector: 1 });
    });

    it('balde DESCONHECIDO continua caindo no source, e coordenadas continua sendo descartado', () => {
        const { payload, stats } = buildServerImportPayload({
            maps: { M: { features: { coordenadas: [feicao('coordenada')], points: [feicao('point')] } } },
        }, { name: 'A' });

        expect(payload.maps[0].features).toHaveLength(1);
        expect(payload.maps[0].features[0].feature_type).toBe('point');
        expect(stats.droppedFeatures).toBe(1);
    });

    it('properties.source segue no corpo da feicao, intocado', () => {
        const { payload } = buildServerImportPayload({
            maps: { M: { features: { military_symbols: [feicao('point')] } } },
        }, { name: 'A' });

        const f = payload.maps[0].features[0];
        expect(f.feature_type).toBe('military_symbol');
        expect(f.properties.source).toBe('point');
    });
});
