// Path: tests/unit/poda-fecha-no-desconhecido.test.js
//
// A REGRA É KEEP-LIST, E ESTE ARQUIVO É A ÚNICA PROVA DISSO.
//
// Com deny-list ("é privado? sai") o documento dourado passaria idêntico: lá cada
// referência é ou pública ou privada, e as duas regras dão a mesma resposta. O caso que
// as separa é o TERCEIRO veredito, `unknown` — a referência que o cliente não consegue
// classificar. Ela existe de verdade e não é hipótese: uma referência escrita por um par
// que ENXERGAVA o recurso chega aqui por sync, e `isPrivateResource` (que só conhece o
// privado deste usuário) responde "não é privado" sobre ela. Com deny-list ela viajaria
// no `.ebgeo`, que é o vazamento inteiro.
//
// O PISO: as três referências estão na MESMA superfície e no documento antes da poda,
// então nenhuma diferença de tratamento entre superfícies pode explicar o resultado.

import { describe, it, expect } from 'vitest';
import { podarDocumentoCesium3d, RefVerdict } from '@catalog/private-reference-pruner.js';

const VEREDITO = {
    'tileset-publico': RefVerdict.PUBLIC,
    'tileset-privado': RefVerdict.PRIVATE,
    // Ausente do mapa de propósito: o resolver devolve `unknown` para ela.
};

const resolver = (grupo, id) => VEREDITO[id] ?? RefVerdict.UNKNOWN;

const documento = () => ({
    cameraPositions: {},
    markers: [
        { id: 'a', tilesetId: 'tileset-publico' },
        { id: 'b', tilesetId: 'tileset-privado' },
        { id: 'c', tilesetId: 'tileset-desconhecido' },
    ],
    measurements: [],
    viewsheds: [],
});

describe('a poda de saída fecha no DESCONHECIDO', () => {
    it('PISO: as três referências estão na mesma superfície, antes da poda', () => {
        const antes = documento().markers.map((m) => m.tilesetId);
        expect(antes).toEqual(['tileset-publico', 'tileset-privado', 'tileset-desconhecido']);
        expect(resolver('tilesets', 'tileset-publico')).toBe(RefVerdict.PUBLIC);
        expect(resolver('tilesets', 'tileset-privado')).toBe(RefVerdict.PRIVATE);
        expect(resolver('tilesets', 'tileset-desconhecido')).toBe(RefVerdict.UNKNOWN);
    });

    it('sobra exatamente a PÚBLICA: a desconhecida sai junto com a privada', () => {
        const { documento: podado, relatorio } = podarDocumentoCesium3d(documento(), resolver);

        expect(podado.markers.map((m) => m.tilesetId)).toEqual(['tileset-publico']);
        expect(relatorio.porSuperficie['cesium3d.markers']).toBe(2);
        // O relatório distingue os dois motivos, porque "perdi porque é restrito" e "perdi
        // porque não sei o que é" são notícias diferentes para quem exporta.
        expect(relatorio.nomeados.map((n) => n.veredito).sort())
            .toEqual([RefVerdict.PRIVATE, RefVerdict.UNKNOWN]);
    });

    it('sem resolver nenhum, TUDO que é referência sai (falha fechado)', () => {
        // O contrário — passar tudo quando o resolver falta — transformaria um erro de
        // fiação num vazamento silencioso, no caminho irreversível.
        const { documento: podado } = podarDocumentoCesium3d(documento(), null);
        expect(podado.markers).toEqual([]);
    });

    it('DISCRIMINAÇÃO: item SEM referência nenhuma nunca é tocado', () => {
        // Uma medição 3D solta continua sendo dado do usuário; um podador que a apagasse
        // passaria nos casos acima e destruiria trabalho.
        const doc = { ...documento(), measurements: [{ id: 'd1', tilesetId: null }] };
        const { documento: podado } = podarDocumentoCesium3d(doc, null);
        expect(podado.measurements).toEqual([{ id: 'd1', tilesetId: null }]);
    });
});
