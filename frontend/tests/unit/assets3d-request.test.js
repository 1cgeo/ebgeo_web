// Path: tests/unit/assets3d-request.test.js
//
// COMO UMA REQUISIÇÃO DE ASSET 3D SE IDENTIFICA (fase F11, parte B, lado cliente).
//
// Desde a F11 os bytes sob `/api/v1/assets3d` seguem o RECURSO: modelo público continua
// aberto, modelo PRIVADO responde 404 para quem não o alcança. Quem faz o pedido chegar
// identificado é este módulo, e o modo de falha dele é MUDO nas duas direções — carimbo a
// menos vira modelo que aparece vazio sem erro nenhum, carimbo a mais vaza para terceiro em
// que atlas o usuário está. Daí o par completo em cada bloco.

import { describe, it, expect, beforeEach } from 'vitest';
import { escoparUrlDeAsset, escopoDeAsset, descritorDeAsset } from '@store/sync/assets3d-request.js';
import { resourceScopeKey, setResourceScope, resetResourceScope } from '@store/sync/resource-scope.js';

const ATLAS = '11111111-2222-3333-4444-555555555555';

describe('F11 — o carimbo de escopo numa URL de asset', () => {
    beforeEach(() => {
        resetResourceScope();
    });

    it('sem atlas em foco a URL sai IDÊNTICA (o modelo público não regride)', () => {
        expect(escopoDeAsset()).toBeNull();
        expect(escoparUrlDeAsset('/api/v1/assets3d/3d/PCL/tileset.json'))
            .toBe('/api/v1/assets3d/3d/PCL/tileset.json');

        // E logado SEM atlas: o escopo tem usuário e nenhum atlas, que é o estado de quem
        // entrou e ainda não abriu projeto nenhum.
        setResourceScope(resourceScopeKey('usuario-1', null));
        expect(escopoDeAsset()).toBeNull();
        expect(escoparUrlDeAsset('/x/tileset.json')).toBe('/x/tileset.json');
    });

    it('com atlas em foco o `atlasId` entra na query, respeitando query e hash já presentes', () => {
        setResourceScope(resourceScopeKey('usuario-1', ATLAS));
        expect(escopoDeAsset()).toBe(ATLAS);

        expect(escoparUrlDeAsset('/api/v1/assets3d/3d/PCL/tileset.json'))
            .toBe(`/api/v1/assets3d/3d/PCL/tileset.json?atlasId=${ATLAS}`);
        expect(escoparUrlDeAsset('/x/y.json?v=2')).toBe(`/x/y.json?v=2&atlasId=${ATLAS}`);
        expect(escoparUrlDeAsset('/x/y.json#frag')).toBe(`/x/y.json?atlasId=${ATLAS}#frag`);
    });

    it('URL de OUTRA ORIGEM sai intacta: o empréstimo é uma afirmação sobre ESTE servidor', () => {
        setResourceScope(resourceScopeKey('usuario-1', ATLAS));
        for (const url of ['https://cdn.exemplo/3d/x.json', '//cdn.exemplo/3d/x.json']) {
            expect(escoparUrlDeAsset(url)).toBe(url);
        }
    });

    it('carimbar duas vezes não duplica o parâmetro', () => {
        setResourceScope(resourceScopeKey('usuario-1', ATLAS));
        const uma = escoparUrlDeAsset('/x/y.json');
        expect(escoparUrlDeAsset(uma)).toBe(uma);
    });

    it('valor inútil atravessa sem quebrar', () => {
        setResourceScope(resourceScopeKey('usuario-1', ATLAS));
        expect(escoparUrlDeAsset('')).toBe('');
        expect(escoparUrlDeAsset(null)).toBeNull();
        expect(escoparUrlDeAsset(undefined)).toBeUndefined();
    });
});

describe('F11 — o descritor que o Cesium recebe', () => {
    beforeEach(() => {
        resetResourceScope();
    });

    it('anônimo e sem atlas: só a URL, que é o `Resource` que o Cesium montaria sozinho', async () => {
        const d = await descritorDeAsset('/api/v1/assets3d/3d/PCL/tileset.json');
        expect(d).toEqual({ url: '/api/v1/assets3d/3d/PCL/tileset.json' });
        expect(d.queryParameters).toBeUndefined();
        expect(d.headers).toBeUndefined();
    });

    it('com atlas em foco o escopo vai em `queryParameters`, que é o que PROPAGA aos filhos', async () => {
        // A propriedade que decide se isto funciona: `getDerivedResource` funde
        // `queryParameters` do pai no filho, então carimbar o `tileset.json` alcança cada
        // `.b3dm`. Pôr o escopo só na string da URL do pai também propagaria, mas depender
        // do parser em vez do campo é o tipo de detalhe que uma atualização de vendor muda.
        setResourceScope(resourceScopeKey('usuario-1', ATLAS));
        const d = await descritorDeAsset('/api/v1/assets3d/3d/PCL/tileset.json');
        expect(d.queryParameters).toEqual({ atlasId: ATLAS });
    });

    it('endereço de outra origem não recebe escopo nem credencial', async () => {
        setResourceScope(resourceScopeKey('usuario-1', ATLAS));
        const d = await descritorDeAsset('https://cdn.exemplo/3d/tileset.json');
        expect(d).toEqual({ url: 'https://cdn.exemplo/3d/tileset.json' });
    });
});
