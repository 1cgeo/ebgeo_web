// Path: e2e-ui/helpers/catalog-seed.js

/**
 * RECURSO DE CATÁLOGO REAL para os specs de 3D e 360, escrito no Postgres descartável.
 *
 * POR QUE ISTO EXISTE. A borda de escrita do sync recusa uma op que REFERENCIA um recurso que o
 * autor não enxerga (`unseenResourceDenialReason`, `backend/src/modules/sync/sync.service.js`), e
 * "linha ausente" conta como não enxerga, por decisão escrita na própria consulta
 * (`canSeeCatalogResource`: NO ROW MEANS REFUSE). Enquanto os specs inventavam o id do recurso, o
 * servidor devolvia `rejected` com motivo e a entidade nunca chegava ao par: TREZE specs vermelhos
 * com a mesma causa, e nenhum deles falando dela (o teste morre num `expect.poll` que expira, e o
 * toast que carrega o motivo não tem quem o veja num navegador sem tela).
 *
 * POR QUE POR SQL, E NÃO PELA ROTA — a resposta MUDOU DE METADE em 2026-08-23, e vale escrever
 * qual metade caiu. Caiu a do papel: `helpers/accounts.js` passou a criar conta de produtor com
 * escopo (`role: 'producer'`), então "só se concede escrevendo em `users`" deixou de ser um
 * obstáculo, e um chamador que queira exercitar `POST /api/v1/tilesets` pela rota já pode.
 *
 * O QUE SEGUE VALENDO, e é o que mantém o INSERT aqui:
 *   - o projeto 360 NÃO TEM ROTA DE CRIAÇÃO nenhuma. Ele nasce da ingestão, fora de banda, e
 *     `seedSv360Photo` não teria por onde passar mesmo com o papel resolvido;
 *   - o tileset semeado aqui é INSTITUCIONAL (sem OM dona), que é justamente a linha que a rota
 *     NÃO consegue produzir: `fn_can_produce_resource` compara IGUALDADE com a OM do produtor, e
 *     `owner_org_id` nulo não é igual a nada. Criar pela rota daria um recurso da OM do produtor,
 *     que é OUTRO sujeito;
 *   - e o custo: são treze specs de convergência semeando por chamada, e cada uma passaria a
 *     pagar uma conta nova mais um login para obter um recurso que o teste nem olha.
 *
 * O RECURSO NASCE PÚBLICO E INSTITUCIONAL de propósito: o que estes specs medem é a CONVERGÊNCIA
 * da op entre dois clientes, não a privacidade. Quem mede a privacidade é o censo de superfícies
 * dos dois pacotes. Quem PRECISA do recurso privado com dona (um produtor que concede o que
 * mantém) passa `accessLevel` e `ownerOrgId`, e aí o par vira o sujeito do teste.
 *
 * A CONEXÃO É A DE `db.js`, e nunca uma segunda. Abrir um pool próprio aqui custou uma medição: o
 * `pgp.end()` que `accounts.js` chamava derrubava TODOS os pools do processo, e não só os da
 * instância que o chamou, então criar uma conta no meio da rodada matava esta conexão e a chamada
 * seguinte voltava "Connection pool of the database object has been destroyed". Os dois pontos de
 * fechamento agora usam `conn.$pool.end()`, mas a regra fica: uma conexão só, e a de `db.js`.
 */

import { createDb } from './db.js';
// O id fixo da OM semeada mora em `accounts.js` porque é lá que ele decide alguma coisa (o
// escopo de produção). Uma segunda cópia do literal aqui seria a que envelheceria sozinha.
import { DEFAULT_ORG_ID as ORG_PADRAO } from './accounts.js';

/** A conexão compartilhada de `db.js`, resolvida a cada chamada (ela pode ter sido fechada). */
function conectar(dbName) {
    return createDb(dbName).raw;
}

/**
 * Cria um tileset ativo e devolve o id que a op deve referenciar.
 *
 * Público e institucional por padrão (ver o `fileoverview`). O par `accessLevel: 'private'` +
 * `ownerOrgId` é o que produz a linha que um PRODUTOR daquela OM mantém e pode conceder:
 * `fn_can_produce_resource` compara `owner_org_id` com `users.producer_org_id` por igualdade,
 * e `NULL` nunca é igual a nada, então privado sem dona é um recurso que produtor nenhum
 * alcança — estado legítimo, mas nunca o que quem passa `ownerOrgId` está querendo.
 *
 * O `ON CONFLICT` reescreve os DOIS eixos, e não só o `active`: enquanto ele só carimbava
 * `public`, semear o mesmo id duas vezes com intenções diferentes devolvia em silêncio o
 * recurso da primeira chamada.
 *
 * @param {string} dbName - `readState().dbName`.
 * @param {{id?: string, name?: string, accessLevel?: 'public'|'private', ownerOrgId?: string}} [opts]
 * @returns {Promise<string>} O id do tileset.
 */
export async function seedTileset(dbName, {
    id, name = 'Tileset de teste', accessLevel = 'public', ownerOrgId = null,
} = {}) {
    const tilesetId = id ?? `tileset-e2e-${Math.random().toString(36).slice(2, 10)}`;
    await conectar(dbName).none(
        `INSERT INTO tilesets (id, name, description, config, active, access_level, owner_org_id)
         VALUES ($1, $2, 'semeado pelo e2e', '{}'::jsonb, true, $3, $4)
         ON CONFLICT (id) DO UPDATE
            SET active = true, access_level = EXCLUDED.access_level,
                owner_org_id = EXCLUDED.owner_org_id`,
        [tilesetId, name, accessLevel, ownerOrgId],
    );
    return tilesetId;
}

/**
 * Registra o modelo 3D CONVERTIDO que serve os bytes de um tileset, em `a3d.models`.
 *
 * POR QUE UM SEMEADOR SEPARADO DO TILESET. As duas metades de um modelo moram em tabelas
 * diferentes e respondem a perguntas diferentes: `public.tilesets` é o CATÁLOGO (o que o
 * cliente vê e quem pode vê-lo) e `a3d.models` é a PRODUÇÃO (qual arquivo `.3dtiles` serve
 * aqueles bytes). `resolverModelo3d` faz o JOIN das duas, então um tileset com linha de
 * catálogo e sem linha de produção responde **404** em `/api/v1/assets3d/m/<id>/...`, com a
 * mensagem "3D model not found" e nenhum outro sinal.
 *
 * ISSO CUSTOU UMA MEDIDA ERRADA em 2026-08-31: um spec que só semeava o tileset abria o
 * visualizador, via o modelo falhar, voltava para o 2D e ficava verde por outro caminho. Um
 * ambiente incompleto se parece com defeito do produto, e a diferença entre os dois é
 * exatamente esta linha.
 *
 * O ARQUIVO PRECISA EXISTIR em `backend/data/models3d/<dbFilename>`: o padrão é o
 * `serra_dourada.3dtiles` do repositório, que é o único modelo real versionado aqui.
 *
 * @param {string} dbName - `readState().dbName`.
 * @param {{modelId: string, dbFilename?: string, buildToken?: string}} opts
 * @returns {Promise<string>} O `model_id` registrado.
 */
export async function seedModelo3d(dbName, {
    modelId, dbFilename = 'serra_dourada.3dtiles', buildToken = 'e2e-token',
}) {
    await conectar(dbName).none(
        `INSERT INTO a3d.models (model_id, db_filename, build_token)
         VALUES ($1, $2, $3)
         ON CONFLICT (model_id) DO UPDATE
            SET db_filename = EXCLUDED.db_filename, build_token = EXCLUDED.build_token`,
        [modelId, dbFilename, buildToken],
    );
    return modelId;
}

/**
 * Cria um projeto 360 PÚBLICO com uma foto, e devolve o `original_name` dela, que é a forma
 * pela qual `streetview360_data.photo_name` referencia o projeto (`RESOLVE_SV360_REFS`).
 *
 * `entryPhotoId` É OPCIONAL E NASCE FALSO, e a assimetria é deliberada. A coluna é anulável no
 * DDL (`007_sv360.sql:45`) porque a ingestão pode não achar a foto de entrada, e a maioria dos
 * treze specs que chamam este semeador nem olha o projeto: eles querem um id de recurso que o
 * servidor enxergue. Quem precisa da foto de entrada é o botão "Calibrar" da linha do catálogo,
 * que muda de URL conforme ela exista, e esse spec pede os DOIS lados.
 *
 * @param {string} dbName - `readState().dbName`.
 * @param {{photoName?: string, slug?: string, entryPhotoId?: boolean}} [opts]
 * @returns {Promise<{photoName: string, projectId: string, slug: string, photoId: string}>}
 */
export async function seedSv360Photo(dbName, { photoName, slug, entryPhotoId = false } = {}) {
    const sufixo = Math.random().toString(36).slice(2, 10);
    const nomeFoto = photoName ?? `foto-e2e-${sufixo}.jpg`;
    const slugProjeto = slug ?? `projeto-e2e-${sufixo}`;
    const idFoto = `foto-${sufixo}`;
    const conn = conectar(dbName);
    const projeto = await conn.one(
        `INSERT INTO sv360.projects (organization_id, slug, name, db_filename, status, access_level)
         VALUES ($1, $2, $3, $4, 'enabled', 'public')
         RETURNING id`,
        [ORG_PADRAO, slugProjeto, `Projeto 360 ${sufixo}`, `${slugProjeto}.db`],
    );
    await conn.none(
        `INSERT INTO sv360.photos (id, project_id, original_name, sequence_number, lat, lon)
         VALUES ($1, $2, $3, 1, -22.9, -43.2)`,
        [idFoto, projeto.id, nomeFoto],
    );
    if (entryPhotoId) {
        await conn.none('UPDATE sv360.projects SET entry_photo_id = $1 WHERE id = $2',
            [idFoto, projeto.id]);
    }
    return { photoName: nomeFoto, projectId: projeto.id, slug: slugProjeto, photoId: idFoto };
}

/**
 * Cria uma CAMADA BASE com estilo próprio, e devolve o id.
 *
 * POR QUE ELA EXISTE AQUI, ao lado do tileset. A camada base é o quinto tipo de recurso e a
 * ÚNICA cuja superfície de compartilhamento é alcançável em dois cliques a partir do mapa (o
 * seletor de camada base, `data-testid="base-layer-share"`), sem passar pela grade do catálogo.
 * Isso a torna o caminho mais curto até o modal de concessão de recurso, que é o que os specs
 * de compartilhamento precisam abrir.
 *
 * O ESTILO É UM `background` DE COR SÓLIDA, como no spec que provou este caminho: ele não
 * depende de rede nenhuma, então a camada desenha num runner sem acesso externo, e a cor no
 * pixel é prova de que foi o estilo PUBLICADO que chegou ao MapLibre.
 *
 * @param {string} dbName - `readState().dbName`.
 * @param {{id?: string, name?: string, accessLevel?: 'public'|'private', ownerOrgId?: string,
 *   color?: string}} [opts]
 * @returns {Promise<string>} O id da camada base.
 */
export async function seedBasemap(dbName, {
    id, name = 'Camada base de teste', accessLevel = 'private', ownerOrgId = null, color = '#c2185b',
} = {}) {
    const basemapId = id ?? `bm-e2e-${Math.random().toString(36).slice(2, 10)}`;
    const config = {
        enabled: true,
        priority: 99,
        style: {
            version: 8,
            sources: {},
            layers: [{ id: 'bg', type: 'background', paint: { 'background-color': color } }],
        },
    };
    await conectar(dbName).none(
        `INSERT INTO basemaps (id, name, description, config, active, sort_order, access_level, owner_org_id)
         VALUES ($1, $2, 'semeado pelo e2e', $3::jsonb, true, 99, $4, $5)
         ON CONFLICT (id) DO UPDATE
            SET active = true, config = EXCLUDED.config,
                access_level = EXCLUDED.access_level, owner_org_id = EXCLUDED.owner_org_id`,
        [basemapId, name, JSON.stringify(config), accessLevel, ownerOrgId],
    );
    return basemapId;
}

/**
 * Espera o catálogo SERVIDO por `GET /api/config` refletir uma linha semeada por SQL.
 *
 * O CACHE DO CONFIG É INVALIDADO NA ESCRITA PELA API, E SÓ NELA. O harness liga o memo do
 * `/api/config` de propósito (`CONFIG_CACHE_FORCE=1`, com TTL de 30 s de recuo), porque os specs
 * do painel de administração editam o catálogo pela tela real e esperam ver a mudança, que é a
 * invalidação de ponta a ponta. Os semeadores deste arquivo escrevem por SQL, que nenhuma
 * invalidação vê. Sozinho, um spec não sente isso: o cache está frio. Na rodada COMPLETA, o spec
 * anterior aqueceu o cache há menos de 30 s, a página abre com o catálogo memoizado SEM a linha
 * recém-semeada, e o produto responde "Cena 3D não encontrada" e sai sem lançar. Medido em
 * 2026-09-21 em `first-person-collaboration.spec.js`: 1 reprovação em cada rodada completa
 * (17/482 e 1/483), zero em 16 execuções isoladas, e o trace da reprovação trazia
 * `[first-person] scene not found: museu-1cgeo`. É a classe "o instrumento mede outra cópia do
 * sujeito": a leitura que vale é a do catálogo servido, não a da linha no Postgres.
 *
 * Chame DEPOIS da última escrita SQL no item (o `UPDATE tilesets SET config` do spec inclusive),
 * e antes de abrir a página que vai consumi-lo.
 *
 * @param {string} baseUrl - A origem do backend (`readState().baseUrl`).
 * @param {'tilesets'|'basemaps'} colecao - A coleção do payload.
 * @param {(item: Object) => boolean} predicado - O que a linha servida precisa satisfazer.
 * @param {{timeoutMs?: number}} [opts] - Padrão de 45 s: um TTL inteiro mais folga.
 * @returns {Promise<Object>} O item servido.
 */
export async function esperarCatalogoServido(baseUrl, colecao, predicado, { timeoutMs = 45000 } = {}) {
    const inicio = Date.now();
    let ultimo = null;
    while (Date.now() - inicio < timeoutMs) {
        const resposta = await fetch(`${baseUrl}/api/config`, { cache: 'no-store' });
        const corpo = await resposta.json();
        const lista = (corpo?.data ?? corpo)?.[colecao];
        ultimo = Array.isArray(lista) ? lista.map((item) => item?.id) : lista;
        const achado = Array.isArray(lista) ? lista.find(predicado) : null;
        if (achado) return achado;
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`o catálogo servido não refletiu a linha semeada em ${colecao} em ${timeoutMs} ms; ids servidos: ${JSON.stringify(ultimo)}`);
}
