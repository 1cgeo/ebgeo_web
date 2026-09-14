// Path: tests/unit/credencial-de-asset-nao-vai-a-terceiro.test.js
//
// O TOKEN DE SESSÃO NÃO VIAJA PARA HOST DE TERCEIRO NUM `fetch` DE ASSET.
//
// O DEFEITO QUE ORIGINOU ESTE ARQUIVO (revisão de acesso a recurso, 2026-09-13).
// `cabecalhosDeAsset` devolvia `Authorization: Bearer` sem perguntar PARA ONDE, e os quatro
// chamadores dela (`loadSplat` em `first_person_3d_tool/first_person_viewer.js`, e
// `marcadores.json`, `voxel-meta.json` e `voxel.bin` em `scene-config.service.js`) o
// grudavam numa URL derivada de `config.basePath` da linha de catálogo. Aquele campo é TEXTO
// LIVRE digitado por administrador ou produtor, `joinScenePath` honra um valor absoluto como
// escrito, e o 422 que recusaria endereço de terceiro na ESCRITA não existe (cláusula 10.1 da
// `CONSTITUICAO.md`, ainda em obra). Logo um produtor de uma OM podia apontar a cena dele
// para o próprio servidor e colher o token de quem abrisse a cena, administrador inclusive.
//
// As DUAS irmãs do mesmo módulo já recusavam terceiro por escrito (`escoparUrlDeAsset` e
// `descritorDeAsset`); esta era a única sem guarda, e era justamente a do caminho que o
// `cena-indoor-carimba-credencial.test.js` obriga a carimbar. Aquele guarda mede PRESENÇA do
// cabeçalho, então ele empurrava para o defeito em vez de acusá-lo: os dois juntos são o par.
//
// A COMPARAÇÃO É POR `URL.origin`, e não por prefixo, pela mesma razão escrita em
// `map/credencial-de-tile.js`: `https://app.exemplo.evil.example` começa com a string certa e
// não é o host certo.
//
// A DIREÇÃO DA FALHA é a visível: sem `location` para comparar, ou sem URL nenhuma, o
// cabeçalho não sai e o asset PRIVADO deixa de carregar (defeito que se vê na tela), em vez
// de o token sair para quem o endereço nomear (defeito que ninguém vê).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const TOKEN = 'jwt-de-sessao';

vi.mock('@store/sync/api-client.js', () => ({
    apiClient: {
        authHeader: async () => ({ Authorization: `Bearer ${TOKEN}` }),
    },
}));

const { cabecalhosDeAsset, descritorDeAsset } = await import('@store/sync/assets3d-request.js');

const ORIGEM = 'https://app.exemplo.mil.br';
let locationAnterior;

beforeEach(() => {
    locationAnterior = globalThis.location;
    globalThis.location = { origin: ORIGEM };
});

afterEach(() => {
    if (locationAnterior === undefined) delete globalThis.location;
    else globalThis.location = locationAnterior;
});

describe('a credencial de asset só vai para o servidor que a emitiu', () => {
    it('POSITIVO: endereço relativo e endereço absoluto DA MESMA ORIGEM recebem o token', async () => {
        // O par completo: sem este lado, um guarda que recusasse TUDO passaria nos negativos.
        // `basePath` absoluto same-origin é forma legítima e o deploy pode escrevê-la.
        expect(await cabecalhosDeAsset('/api/v1/assets3d/3d/museu/cena.sog'))
            .toEqual({ Authorization: `Bearer ${TOKEN}` });
        expect(await cabecalhosDeAsset(`${ORIGEM}/api/v1/assets3d/3d/museu/cena.sog`))
            .toEqual({ Authorization: `Bearer ${TOKEN}` });
    });

    it('NEGATIVO: host de terceiro não recebe o token', async () => {
        for (const url of [
            'https://cdn.terceiro.example/3d/museu/cena.sog',
            'http://cdn.terceiro.example/3d/museu/cena.sog',
            '//cdn.terceiro.example/3d/museu/cena.sog',
        ]) {
            expect(await cabecalhosDeAsset(url), url).toEqual({});
        }
    });

    it('NEGATIVO: host que COMEÇA com o nosso não é o nosso', async () => {
        // A asserção auxiliar prova que o predicado ingênuo (`startsWith`) aceitaria, que é
        // o que torna este caso uma discriminação e não uma repetição do anterior.
        const vizinho = `${ORIGEM}.evil.example/3d/museu/cena.sog`;
        expect(vizinho.startsWith(ORIGEM)).toBe(true);
        expect(await cabecalhosDeAsset(vizinho)).toEqual({});
    });

    it('NEGATIVO: outra porta e outro esquema são outra origem', async () => {
        expect(await cabecalhosDeAsset(`${ORIGEM}:8443/x/cena.sog`)).toEqual({});
        expect(await cabecalhosDeAsset('http://app.exemplo.mil.br/x/cena.sog')).toEqual({});
    });

    it('NEGATIVO: sem URL nenhuma o cabeçalho não sai (falha FECHADA)', async () => {
        // O chamador que não diz para onde vai não pode ser respondido com segurança, e o
        // custo de errar aqui é um asset privado que não carrega — visível.
        for (const valor of [undefined, null, '', 42, {}]) {
            expect(await cabecalhosDeAsset(valor)).toEqual({});
        }
    });

    it('NEGATIVO: sem `location` para comparar, nenhum endereço absoluto recebe token', async () => {
        delete globalThis.location;
        expect(await cabecalhosDeAsset(`${ORIGEM}/x/cena.sog`)).toEqual({});
        // E o relativo continua valendo: ele é da mesma origem por construção, e recusá-lo
        // apagaria o acervo privado inteiro fora do navegador.
        expect(await cabecalhosDeAsset('/x/cena.sog')).toEqual({ Authorization: `Bearer ${TOKEN}` });
    });

    it('o descritor do Cesium segue a MESMA regra, e continua recusando terceiro', async () => {
        // Ele já recusava por conta própria; o caso fica para que a mudança do argumento de
        // `cabecalhosDeAsset` não passe a alimentá-lo por outra porta.
        const d = await descritorDeAsset('https://cdn.terceiro.example/3d/tileset.json');
        expect(d).toEqual({ url: 'https://cdn.terceiro.example/3d/tileset.json' });

        const nosso = await descritorDeAsset('/api/v1/assets3d/3d/museu/tileset.json');
        expect(nosso.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    });
});
