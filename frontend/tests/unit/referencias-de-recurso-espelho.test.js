// Path: tests/unit/referencias-de-recurso-espelho.test.js
//
// AS DUAS CÓPIAS DO INVENTÁRIO DE REFERÊNCIAS PRECISAM CONCORDAR.
//
// `frontend/src/js/catalog/resource-reference.registry.js` e
// `backend/src/modules/atlas/resource-reference.registry.js` são espelhos: os dois lados
// falam linguagens diferentes (documento contra tabela) e nenhum pode importar o outro,
// mas a LISTA de superfícies é a mesma. Uma divergência faria o servidor podar uma
// superfície que o cliente não poda (ou o contrário) com as duas suítes verdes — e o
// sintoma apareceria longe da causa, num `.ebgeo` que carrega o que o clone tira.
//
// É o desenho de `catalog-layer-ref.test.js` e de
// `calibracao-espelha-marcador-andar.test.js`, e a lição deles vale inteira: comparar só
// as duas cópias deixaria passar duas cópias erradas do mesmo jeito, então cada bloco leva
// asserção ABSOLUTA além da comparação.
//
// O CONTRATO DE ZERO IMPORTS é asserido aqui e não em outro lugar porque é ESTE teste que
// depende dele: os dois arquivos são carregados no mesmo processo node, sem resolução de
// alias e sem o pacote de backend montado.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    RESOURCE_REF_SURFACES as CLIENTE,
    RESOURCE_REF_GROUP,
    REF_ACTION as ACAO_CLIENTE,
    DEFAULT_BASE_LAYER as PADRAO_CLIENTE,
} from '../../src/js/catalog/resource-reference.registry.js';
import {
    RESOURCE_REF_SURFACES as SERVIDOR,
    RESOURCE_TYPE_BY_GROUP,
    REF_ACTION as ACAO_SERVIDOR,
    DEFAULT_BASE_LAYER as PADRAO_SERVIDOR,
    resourceRefKey,
} from '../../../backend/src/modules/atlas/resource-reference.registry.js';

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url));

/** A lista ABSOLUTA, escrita aqui e não derivada de nenhuma das duas cópias. */
const IDS = [
    'mapa.baseLayer',
    'mapa.catalogLayers',
    'cesium3d.cameraPositions',
    'cesium3d.markers',
    'cesium3d.measurements',
    'cesium3d.viewsheds',
    'sv360.orientations',
    'sv360.markers',
    'briefing.slide.modelId',
    'briefing.slide.photoId',
    'settings.basemaps',
    'settings.default_basemap',
    'settings.available_data_layers',
    'settings.available_analysis_layers',
    'settings.available_3d_models',
    'settings.available_360_views',
    'mapa.analysisLayers',
];

/** Os cinco tipos de `RESOURCE_TYPES`, escritos por extenso pelo mesmo motivo. */
const TIPOS = ['basemap', 'tileset', 'data_layer', 'analysis_layer', 'sv360_project'];

describe('as duas cópias do registro de referências', () => {
    it('declaram os MESMOS ids, na MESMA ordem (e a lista absoluta bate nas duas)', () => {
        expect(CLIENTE.map((s) => s.id)).toEqual(IDS);
        expect(SERVIDOR.map((s) => s.id)).toEqual(IDS);
    });

    it('declaram a MESMA ação por superfície (e as ações absolutas)', () => {
        const acaoDe = (lista) => Object.fromEntries(lista.map((s) => [s.id, s.acao]));
        expect(acaoDe(SERVIDOR)).toEqual(acaoDe(CLIENTE));

        // ABSOLUTO: as três ações que a poda executa, por superfície. Sem isto, as duas
        // cópias poderiam concordar em "remove tudo" e o teste passaria.
        expect(acaoDe(CLIENTE)).toEqual({
            'mapa.baseLayer': 'padrao',
            'mapa.catalogLayers': 'remove-entrada',
            'cesium3d.cameraPositions': 'remove-entrada',
            'cesium3d.markers': 'remove-entrada',
            'cesium3d.measurements': 'remove-entrada',
            'cesium3d.viewsheds': 'remove-entrada',
            'sv360.orientations': 'remove-entrada',
            'sv360.markers': 'remove-entrada',
            'briefing.slide.modelId': 'zera-e-rebaixa',
            'briefing.slide.photoId': 'zera-e-rebaixa',
            'settings.basemaps': 'filtra-lista',
            'settings.default_basemap': 'padrao',
            'settings.available_data_layers': 'filtra-lista',
            'settings.available_analysis_layers': 'filtra-lista',
            'settings.available_3d_models': 'filtra-lista',
            'settings.available_360_views': 'filtra-lista',
            'mapa.analysisLayers': 'nao-referencia',
        });
        expect(ACAO_CLIENTE).toEqual(ACAO_SERVIDOR);
    });

    it('as SEIS superfícies só-servidor são as mesmas nas duas cópias, e só elas', () => {
        // A família de `atlas.settings` é a que o inventário por NOME DE CAMPO não enxergava:
        // seis listas de id de catálogo que o clone copiava verbatim. Elas estão declaradas
        // nas DUAS cópias porque o inventário é da pergunta, não do executor — e é justamente
        // por só o servidor as podar que a marca precisa concordar dos dois lados: um flag
        // só no cliente dispensaria o podador de lá e ninguém ficaria vermelho.
        const soServidor = (lista) => lista.filter((x) => x.soServidor === true).map((x) => x.id);
        expect(soServidor(SERVIDOR)).toEqual(soServidor(CLIENTE));
        expect(soServidor(CLIENTE)).toEqual([
            'settings.basemaps',
            'settings.default_basemap',
            'settings.available_data_layers',
            'settings.available_analysis_layers',
            'settings.available_3d_models',
            'settings.available_360_views',
        ]);
        // DISCRIMINAÇÃO: nenhuma das outras carrega a marca. Sem esta linha, marcar TODAS
        // como só-servidor passaria nas duas asserções acima com a poda do cliente morta.
        expect(CLIENTE.filter((x) => x.soServidor === true)).toHaveLength(6);
        expect(CLIENTE.filter((x) => x.id.startsWith('settings.') && x.soServidor !== true)).toEqual([]);
    });

    it('os GRUPOS do cliente traduzem para os TIPOS do servidor, superfície a superfície', () => {
        // A tradução mora num lugar só (`RESOURCE_TYPE_BY_GROUP`), e é aqui que se prova que
        // ela é a mesma lista dos dois lados: `views360` -> `sv360_project` é a que mais
        // engana, porque o nome do grupo é da TELA e o do tipo é da LINHA.
        for (const [i, superficie] of CLIENTE.entries()) {
            const traduzidos = superficie.grupos.map((g) => RESOURCE_TYPE_BY_GROUP[g]);
            expect(traduzidos, `superfície ${superficie.id}`).toEqual(SERVIDOR[i].tipos);
        }

        // ABSOLUTO nos dois extremos da tradução.
        expect(Object.values(RESOURCE_TYPE_BY_GROUP).sort()).toEqual([...TIPOS].sort());
        expect(Object.keys(RESOURCE_TYPE_BY_GROUP).sort())
            .toEqual(Object.values(RESOURCE_REF_GROUP).sort());
    });

    it('o basemap PADRÃO é o mesmo dos dois lados', () => {
        // O QUE ESTE CASO PODE PROVAR, e o que ele NÃO pode. Ele roda em vitest, sem banco,
        // então só alcança as duas constantes. A asserção "e é o DEFAULT da coluna" morava
        // aqui lendo o TEXTO de `003_atlas.sql`, e era verdadeira por acidente de história:
        // um `ALTER TABLE maps ALTER COLUMN base_layer SET DEFAULT ...` num degrau posterior
        // deixaria o arquivo 003 intacto e este verde mentindo sobre o schema vivo. Quem
        // pergunta ao BANCO é `backend/tests/integration/base-layer-default-do-schema.test.js`, via
        // `information_schema.columns`.
        expect(PADRAO_CLIENTE).toBe('carta-topografica');
        expect(PADRAO_SERVIDOR).toBe(PADRAO_CLIENTE);
    });

    it('nenhuma das duas cópias tem IMPORT (é o contrato que as torna carregáveis aqui)', () => {
        const alvos = [
            'frontend/src/js/catalog/resource-reference.registry.js',
            'backend/src/modules/atlas/resource-reference.registry.js',
        ];
        for (const alvo of alvos) {
            const codigo = readFileSync(path.join(RAIZ, alvo), 'utf8');
            const semComentario = codigo
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n');
            expect(semComentario, `${alvo} precisa ter zero imports`).not.toMatch(/^\s*import\s/m);
        }
    });

    it('a chave de junção usa NUL escapado, e o arquivo NÃO carrega um NUL cru', () => {
        // Duas coisas na mesma linha, e as duas são load-bearing. NUL não cabe num tipo nem
        // num id, então é o único separador que não faz dois pares diferentes colidirem numa
        // chave só (um espaço faz: ('tileset a','b') e ('tileset','a b')). E o BYTE cru faz o
        // git classificar o arquivo como binário — um módulo com peso de segurança que muda
        // sem diff revisável.
        expect(resourceRefKey('tileset', 'a b')).not.toBe(resourceRefKey('tileset a', 'b'));
        expect(resourceRefKey('tileset', 'x')).toBe('tileset\u0000x');

        const bruto = readFileSync(
            path.join(RAIZ, 'backend/src/modules/atlas/resource-reference.registry.js')
        );
        expect(bruto.includes(0), 'byte NUL cru no arquivo-fonte').toBe(false);
    });
});
