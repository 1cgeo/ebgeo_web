import { describe, it, expect, beforeEach } from 'vitest';
import {
    applyAtlasSettings,
    revertAtlasSettings,
    mergeGrantedIntoBaseline,
    revertGrantedResources,
    getGrantedViews360,
    getDeployTilesets,
    getDeployDataLayers,
    _resetAtlasSettingsBaseline,
} from '../../src/js/store/sync/atlas-settings.service.js';
import config from '../../src/js/config.js';

// A SOMA DOS RECURSOS PRIVADOS CONCEDIDOS (fase F3).
//
// Duas direções opostas convivem no mesmo singleton `config`:
//   - `applyAtlasSettings` RESTRINGE (interseção), e nunca habilita o que o deploy
//     desabilitou;
//   - `mergeGrantedIntoBaseline` AMPLIA, somando o que o servidor concedeu.
//
// D1 fixa a ordem: SOMAR PRIMEIRO, INTERSECTAR DEPOIS. E a armadilha que este
// arquivo existe para prender é a do `_baseline`: ele é capturado no PRIMEIRO
// apply e `revertAtlasSettings` restaura exatamente aquilo. Se a soma chegasse
// depois e mexesse só no `config`, o revert apagaria os concedidos e eles não
// voltariam até um F5.

const PUBLICO_TILESET = { id: 'pub-3d', name: 'Público 3D' };
const PRIVADO_TILESET = { id: 'priv-3d', name: 'Privado 3D' };
const PUBLICO_DATA = { id: 'pub-data', name: 'Público dados' };
const PRIVADO_DATA = { id: 'priv-data', name: 'Privado dados' };

/** Repõe o `config` num estado de deploy conhecido, mutando os arrays IN PLACE. */
function resetConfig() {
    _resetAtlasSettingsBaseline();
    config.features = { map_3d: true, imagens_panoramicas: true, terrain_3d: true };
    config.basemaps = { a: { enabled: true } };
    config.tilesets = [{ ...PUBLICO_TILESET }];
    config.dataLayers = { enabled: true, layers: [{ ...PUBLICO_DATA }] };
    config.analysisLayers = { enabled: true, layers: [] };
}

const idsDe = (arr) => arr.map((x) => x.id);

describe('soma dos recursos concedidos (ampliativa)', () => {
    beforeEach(resetConfig);

    it('soma o privado concedido ao `config`, preservando a REFERÊNCIA dos arrays', () => {
        // A referência importa: o catálogo captura os arrays no boot, e reatribuir
        // os desconecta sem erro nenhum.
        const refTilesets = config.tilesets;
        const refData = config.dataLayers.layers;

        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET], dataLayers: [PRIVADO_DATA] });

        expect(config.tilesets).toBe(refTilesets);
        expect(config.dataLayers.layers).toBe(refData);
        expect(idsDe(config.tilesets)).toEqual(['pub-3d', 'priv-3d']);
        expect(idsDe(config.dataLayers.layers)).toEqual(['pub-data', 'priv-data']);
    });

    it('somar duas vezes não duplica, e o payload NOVO substitui o anterior', () => {
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET] });
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET] });
        expect(idsDe(config.tilesets)).toEqual(['pub-3d', 'priv-3d']);

        // Trocar de atlas: o que o primeiro emprestava precisa SAIR.
        mergeGrantedIntoBaseline({ tilesets: [{ id: 'outro-3d', name: 'Outro' }] });
        expect(idsDe(config.tilesets)).toEqual(['pub-3d', 'outro-3d']);
    });

    it('desfazer a soma devolve exatamente o público', () => {
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET], dataLayers: [PRIVADO_DATA] });
        revertGrantedResources();
        expect(idsDe(config.tilesets)).toEqual(['pub-3d']);
        expect(idsDe(config.dataLayers.layers)).toEqual(['pub-data']);
    });

    it('os panoramas 360 ficam FORA do `config` (eles não moram lá)', () => {
        mergeGrantedIntoBaseline({ views360: [{ id: 'v1', slug: 'x' }] });
        expect(getGrantedViews360().map((v) => v.id)).toEqual(['v1']);
        expect(idsDe(config.tilesets)).toEqual(['pub-3d']);
    });
});

describe('D1 — somar primeiro, intersectar depois', () => {
    beforeEach(resetConfig);

    it('a allowlist do atlas ALCANÇA o recurso concedido (não escapa da restrição)', () => {
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET] });
        applyAtlasSettings({ available_3d_models: ['pub-3d'] });
        // O concedido não está na allowlist, então some: é a consequência aceita de
        // D1, e a razão de a UI ter de avisar o Gestor.
        expect(idsDe(config.tilesets)).toEqual(['pub-3d']);
    });

    it('e o concedido SOBREVIVE quando a allowlist o inclui', () => {
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET] });
        applyAtlasSettings({ available_3d_models: ['priv-3d'] });
        expect(idsDe(config.tilesets)).toEqual(['priv-3d']);
    });

    it('vale nas DUAS ordens de chegada: soma depois do apply dá o mesmo resultado', () => {
        // ESTE É O CASO QUE A ORDEM DE CHEGADA DECIDIRIA. Se a soma que chega tarde
        // não re-aplicasse a interseção, o recurso concedido apareceria mesmo fora
        // da allowlist.
        applyAtlasSettings({ available_3d_models: ['pub-3d'] });
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET] });
        expect(idsDe(config.tilesets)).toEqual(['pub-3d']);

        // Discriminação: sem allowlist, a soma tardia aparece.
        resetConfig();
        applyAtlasSettings({});
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET] });
        expect(idsDe(config.tilesets)).toEqual(['pub-3d', 'priv-3d']);
    });
});

describe('a armadilha do `_baseline` — o revert não pode apagar o concedido', () => {
    beforeEach(resetConfig);

    it('soma DEPOIS do primeiro apply sobrevive ao revert', () => {
        applyAtlasSettings({});
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET], dataLayers: [PRIVADO_DATA] });
        expect(idsDe(config.tilesets)).toEqual(['pub-3d', 'priv-3d']);

        revertAtlasSettings();
        expect(idsDe(config.tilesets)).toEqual(['pub-3d', 'priv-3d']);
        expect(idsDe(config.dataLayers.layers)).toEqual(['pub-data', 'priv-data']);
    });

    it('soma ANTES do primeiro apply também sobrevive ao revert', () => {
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET] });
        applyAtlasSettings({});
        revertAtlasSettings();
        expect(idsDe(config.tilesets)).toEqual(['pub-3d', 'priv-3d']);
    });

    it('as duas reversões, em QUALQUER ordem, devolvem só o público', () => {
        applyAtlasSettings({});
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET] });
        revertAtlasSettings();
        revertGrantedResources();
        expect(idsDe(config.tilesets)).toEqual(['pub-3d']);

        resetConfig();
        applyAtlasSettings({});
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET] });
        revertGrantedResources();
        revertAtlasSettings();
        expect(idsDe(config.tilesets)).toEqual(['pub-3d']);
    });
});

describe('getDeploy* passam a significar público ∪ concedido', () => {
    beforeEach(resetConfig);

    it('o modal de restrição enxerga o concedido, senão não teria como reincluí-lo', () => {
        applyAtlasSettings({ available_3d_models: ['pub-3d'] });
        mergeGrantedIntoBaseline({ tilesets: [PRIVADO_TILESET], dataLayers: [PRIVADO_DATA] });

        // O `config` (UI de CONSUMO) está filtrado…
        expect(idsDe(config.tilesets)).toEqual(['pub-3d']);
        // …e o baseline (UI de CONFIGURAÇÃO) carrega os dois.
        expect(idsDe(getDeployTilesets())).toEqual(['pub-3d', 'priv-3d']);
        expect(idsDe(getDeployDataLayers())).toEqual(['pub-data', 'priv-data']);
    });
});
