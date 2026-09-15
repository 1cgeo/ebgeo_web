// Path: tests/e2e/tile-emprestimo-contrato.e2e.test.js

/**
 * @fileoverview O CONTRATO DAS DUAS METADES DO EMPRÉSTIMO NO TILE (cláusula 6.7, D17).
 *
 * O QUE ESTA PERNA ACRESCENTA ÀS OUTRAS DUAS. O teste de unidade do cliente prova que
 * `credencialDeTile` escreve o carimbo; o de integração do backend prova que o gate o honra.
 * Nenhum dos dois prova que a coisa que o cliente ESCREVE é a coisa que o servidor LÊ, e é
 * exatamente aí que a cláusula 6.7 morava: o carimbo do 360 existia havia meses e o gate do
 * tile nunca o via, porque cada lado estava certo sozinho. Aqui a URL do pedido sai da função
 * REAL do cliente, contra um backend REAL, com o atlas, o empréstimo e o membro criados pelas
 * rotas de verdade.
 *
 * COMO O TILE É PEDIDO, e por que não há bytes de imagem nenhum. Num deploy os bytes saem do
 * servidor de tiles atrás do nginx, e quem decide é uma subrequisição `auth_request` a
 * `GET /api/v1/auth/tile-access`. Este harness não tem nginx nem servidor de tiles, então a
 * subrequisição é montada aqui EXATAMENTE como o `location` do host a monta: `X-Original-URI`
 * com a URI original (caminho e query) e o cabeçalho de credencial repassado. O que este
 * arquivo NÃO prova, e é o mesmo teto do arquivo irmão do backend: que o host de produção
 * monte a subrequisição assim. Isso é sonda com data no deploy.
 *
 * A PREMISSA QUE PRECISA FICAR ESCRITA. O endereço do servidor de tiles é UM campo de
 * `/api/config` (`services.tileServerUrl`), lido pelos dois lados: o cliente decide por ele
 * quais URLs recebem carimbo, e o servidor indexa o catálogo por ele. O backend deste harness
 * publica ali um endereço deliberadamente MORTO e em forma de TEMPLATE
 * (`http://127.0.0.1:9/tiles/{z}/{x}/{y}.png`), para que nenhuma spec busque tile de verdade;
 * um deploy publica a forma de BASE (`http://localhost/tiles`, ou `/tiles`). Esta spec põe no
 * cliente a forma de BASE do MESMO endereço, que é o que o produto vê. A diferença não é
 * cosmética e vale saber: com um template escrito ali, a comparação por fronteira de caminho
 * do cliente não casa nada e o carimbo fica inerte, calado.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    getBaseUrl,
    E2E_SKIP,
} from './helpers/harness.js';
import { promoteToAdmin } from './helpers/db.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/** O host do servidor de tiles, em forma de BASE. Ver a premissa no cabeçalho. */
const BASE_TILES = 'http://127.0.0.1:9/tiles';

// `window` ANTES do import do módulo sob teste: o ambiente é node, e a resolução da base
// credenciada lê `window.location.origin` (uma base relativa de deploy same-origin resolve
// contra ela). Sem isto, `credencialDeTile` devolve `undefined` para tudo e a spec mediria a
// ausência de um stub em vez do carimbo.
globalThis.window = globalThis.window ?? { location: { origin: getBaseUrl() } };

const config = (await import('../../src/js/config.js')).default;
const { credencialDeTile } = await import('../../src/js/map/credencial-de-tile.js');
// O CLIENTE SINGLETON, e não um `makeApi()`: é dele que `credencialDeTile` lê o token, e usar
// outra instância mediria um caminho que o app não tem.
const { apiClient } = await import('../../src/js/store/sync/api-client.js');
const { setResourceScope, resetResourceScope, resourceScopeKey } = await import(
    '../../src/js/store/sync/resource-scope.js'
);

/**
 * A subrequisição do `auth_request`, montada a partir do que o CLIENTE produziu.
 *
 * A URL NÃO É REESCRITA AQUI: `pedido.url` é o que o MapLibre pediria, e dele saem o caminho e
 * a query que viajam em `X-Original-URI`. Montar a URI à mão seria medir esta spec.
 *
 * @param {{url: string, headers?: Object}|undefined} pedido - A saída de `credencialDeTile`.
 * @returns {Promise<Response>}
 */
async function pedirPeloGate(pedido) {
    expect(pedido, 'o cliente precisa ter reconhecido a URL como do servidor de tiles').toBeTruthy();
    const alvo = new URL(pedido.url);
    return fetch(`${getBaseUrl()}/api/v1/auth/tile-access`, {
        headers: { ...(pedido.headers ?? {}), 'X-Original-URI': `${alvo.pathname}${alvo.search}` },
    });
}

describe.skipIf(E2E_SKIP)('e2e: o empréstimo por atlas alcança o tile, do cliente ao gate', () => {
    let dono;
    let atlasId;
    let membroId;
    let urlDoTile;
    const idCamada = `e2e-emp-${generateUUID().slice(0, 8)}`;

    beforeAll(async () => {
        // O DONO É ADMINISTRADOR porque criar linha de catálogo e emprestá-la exige quem
        // MANTÉM o acervo; o assunto desta spec é o membro, não a produção.
        dono = makeApi();
        const cred = await registerAndLogin(dono, { nome: 'Dono do emprestimo' });
        await promoteToAdmin(cred.username);
        await dono.login(cred.username, cred.password);

        await dono.createResource('data_layer', {
            id: idCamada,
            name: `Camada emprestada ${idCamada}`,
            config: { source: { type: 'vector', url: `/tiles/${idCamada}` } },
        });
        await dono.setResourceVisibility('data_layer', idCamada, 'private');

        const atlas = await createAtlas(dono, { name: 'Atlas que empresta' });
        atlasId = atlas.id;
        await dono.addAtlasResource(atlasId, { resourceType: 'data_layer', resourceId: idCamada });

        // O MEMBRO entra pelo cliente SINGLETON, e SEM concessão própria sobre a camada: é o
        // que faz o empréstimo ser a única coisa capaz de abrir os bytes.
        apiClient.baseUrl = `${getBaseUrl()}/api/v1`;
        const doMembro = await registerAndLogin(apiClient, { nome: 'Membro sem concessao' });
        membroId = doMembro.user.id;
        await dono.addShare(atlasId, membroId, 'read');

        config.services = { ...config.services, tileServerUrl: BASE_TILES };
        urlDoTile = `${BASE_TILES}/${idCamada}/10/385/577`;
    });

    it('PISO: sem atlas em foco, o pedido do cliente é recusado', async () => {
        // O caso que dá sentido a todos os outros. Ele mede DUAS coisas de uma vez: que o
        // cliente não inventa carimbo quando não há atlas, e que sem carimbo o membro não
        // alcança a camada — ou seja, que nenhuma concessão pessoal está passando por baixo.
        resetResourceScope();
        const pedido = credencialDeTile(urlDoTile);
        expect(pedido.url, 'sem atlas em foco a URL sai intacta').toBe(urlDoTile);

        const res = await pedirPeloGate(pedido);
        expect(res.status).toBe(401);
        expect(res.headers.get('x-ebgeo-tile-denial')).toBe('recurso-nao-alcancado');
    });

    it('o MEMBRO com o atlas em foco recebe o SIM, pela URL que o cliente montou', async () => {
        setResourceScope(resourceScopeKey(membroId, atlasId));
        const pedido = credencialDeTile(urlDoTile);
        // As duas metades, e elas são independentes: o carimbo diz qual empréstimo, o
        // cabeçalho diz quem pede.
        expect(pedido.url).toBe(`${urlDoTile}?atlasId=${atlasId}`);
        expect(pedido.headers.Authorization).toMatch(/^Bearer /);

        const res = await pedirPeloGate(pedido);
        expect(res.status).toBe(200);
        // A TERCEIRA PONTA: a resposta dependeu de quem pediu, então o host não pode
        // publicá-la num cache compartilhado.
        expect(res.headers.get('cache-control')).toBe('private, no-cache');
        expect(res.headers.get('vary')).toBe('Authorization, Cookie');
    });

    it('o carimbo de OUTRO atlas não abre a camada, mesmo com a sessão certa', async () => {
        // O UUID do atlas não é senha: ele diz qual empréstimo o chamador quer usar. Aqui o
        // membro nem participa do segundo atlas, e o gate recusa antes do recurso.
        const outro = await createAtlas(dono, { name: 'Atlas que nao empresta' });
        setResourceScope(resourceScopeKey(membroId, outro.id));
        const res = await pedirPeloGate(credencialDeTile(urlDoTile));
        expect(res.status).toBe(401);
    });

    // O DESFAZER DO EMPRÉSTIMO NÃO É MEDIDO AQUI, e a ausência é decisão. Anexar e desanexar
    // não invalidam o memo do gate (só a escrita de catálogo e de visibilidade o fazem), então
    // provar a revogação daqui custa duas esperas de 31 s para reconfirmar o que o irmão de
    // backend já prova em milissegundos, onde o memo é limpo em processo
    // (`tests/integration/tile-emprestimo-por-atlas.test.js`). O que SÓ esta perna prova é
    // outra coisa: que a URL que o cliente monta é a que o servidor lê.

    it('o VISITANTE de link público herda o empréstimo (cláusula 6.3)', async () => {
        // O caso em que a 6.3 mais importa, e o último do arquivo de propósito: ele troca o
        // token do cliente singleton pelo token EFÊMERO do visitante, que é o que o produto
        // faz, e a partir daí não há mais sessão de membro para medir.
        const { publicLink } = await dono.enablePublicSharing(atlasId);
        const publico = await dono.getPublicAtlas(publicLink);
        apiClient.setEphemeralToken(publico.publicToken);

        // O escopo do visitante não tem usuário: só o atlas, que é a única autorização dele.
        setResourceScope(resourceScopeKey(null, atlasId));
        const pedido = credencialDeTile(urlDoTile);
        expect(pedido.url).toBe(`${urlDoTile}?atlasId=${atlasId}`);

        const res = await pedirPeloGate(pedido);
        expect(res.status).toBe(200);
    });

    it('CONTROLE NEGATIVO: host de terceiro não recebe carimbo nem credencial', () => {
        // Com o carimbo ligado, o excesso passou a vazar DUAS coisas: o token e em qual atlas
        // a pessoa está. O `undefined` é o "deixe como está" do MapLibre.
        setResourceScope(resourceScopeKey(membroId, atlasId));
        for (const url of [
            'https://a.tile.openstreetmap.org/10/385/577.png',
            'http://127.0.0.1:9/tilesextra/x/1/2/3',
            `${getBaseUrl()}/fonts/Noto%20Sans%20Regular/0-255.pbf`,
        ]) {
            expect(credencialDeTile(url), url).toBeUndefined();
        }
    });
});
