// Path: tests/integration/contagem-do-atlas-sem-saida-derivada.repro.test.js
//
// A CONTAGEM DE UM ATLAS NÃO CONTA A SAÍDA DAS ANÁLISES (2026-09-25).
//
// O DEFEITO. "Enviar ao servidor" de um acervo do main com linhas de visada e bacias de visibilidade
// avisava "Subiram só 793 feições de 805: parte deste atlas não chegou ao servidor", e era falso. As 12
// que faltavam eram a SAÍDA das análises (as metades verde e vermelha), que desde 2026-09-23 não
// viaja: cada cliente a deriva da entrada, e o envio a pula de propósito, sem contá-la como perda
// (`local-atlas-to-server.js`). O denominador da frase vem de `countAtlasContents`, que somava todo
// balde de todo mapa, saída inclusive. A mesma conta aparece no cartão do atlas e no aviso de quem vai
// substituir um atlas, onde a saída também não é conteúdo: ela volta sozinha da entrada.
//
// IndexedDB de verdade (`fake-indexeddb`), num slot local lido por escopo explícito, como o leitor faz.

import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { localScope, StoreName, getStoreFor } from '@store/atlas-namespace.js';
import { countAtlasContents } from '@store/atlas-contents.js';

const feicao = (id, source) => ({ type: 'Feature', properties: { id, source }, geometry: { type: 'Point', coordinates: [0, 0] } });

describe('a contagem de feições de um atlas', () => {
    it('REPRO: a saída derivada das análises não entra na conta', async () => {
        const scope = localScope(`slot-${crypto.randomUUID()}`, `local-${crypto.randomUUID().slice(0, 8)}`);
        await getStoreFor(StoreName.MAPS, scope).setItem('Principal', {
            name: 'Principal',
            features: {
                points: [feicao('p1', 'point')],
                los: [feicao('l1', 'los')],
                processed_los: [feicao('l1-visible', 'los'), feicao('l1-obstructed', 'los')],
                visibility: [feicao('v1', 'visibility')],
                processed_visibility: [feicao('v1-visible', 'visibility')],
            },
        });

        const contagem = await countAtlasContents(scope);

        expect(contagem.maps).toBe(1);
        expect(contagem.features, 'o ponto e as duas entradas; as três metades derivadas ficam de fora').toBe(3);
    });

    it('CONTROLE: sem análise, a conta continua somando todo balde', async () => {
        const scope = localScope(`slot-${crypto.randomUUID()}`, `local-${crypto.randomUUID().slice(0, 8)}`);
        await getStoreFor(StoreName.MAPS, scope).setItem('Principal', {
            name: 'Principal',
            features: { points: [feicao('p1', 'point'), feicao('p2', 'point')], lines: [feicao('r1', 'line')] },
        });

        expect((await countAtlasContents(scope)).features).toBe(3);
    });
});
