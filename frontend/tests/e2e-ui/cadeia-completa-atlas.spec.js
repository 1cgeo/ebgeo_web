// Path: e2e-ui/cadeia-completa-atlas.spec.js

/**
 * @fileoverview A CADEIA INTEIRA numa corrida só, contando TUDO em cada perna: um `.ebgeo` real
 * entra pela tela e vira atlas LOCAL, sobrevive a um F5, sobe ao SERVIDOR pelo menu de conta e
 * volta como CÓPIA LOCAL. Quatro leituras, quatro contagens absolutas, uma sessão de navegador.
 *
 * O QUE ESTE ARQUIVO ACRESCENTA AOS VIZINHOS. `atlas-local-ebgeo-e-teardown.spec.js` conta o que
 * chega do arquivo ao disco e `exportar-le-todo-mapa.spec.js` conta o que o exportador enxerga
 * depois de um reload. Nenhum dos dois atravessa a fronteira: 3D, 360, briefing e slide nunca
 * foram contados NO SERVIDOR nem NA VOLTA, e é essa metade que aqui é medida.
 *
 * ------------------------------------------------------------------------------------------
 * O F5 É O SUJEITO, E SEM ELE ESTE ARQUIVO MEDE O CASO AFORTUNADO
 * ------------------------------------------------------------------------------------------
 * Importar e enviar na MESMA sessão povoa a memória por efeito colateral do próprio import
 * (`importMapGroups` escreve memória para TODOS os mapas, enquanto o irmão de camada só escreve
 * para o mapa corrente). O defeito real de 2026-09-01 era exatamente esse: a tabela de seções
 * opcionais do `.ebgeo` (`frontend/src/js/import_export/export-optional-sections.js`) lia camada e
 * grupo pelos getters SÍNCRONOS do store, que leem `memoryStore`, hidratado UM MAPA POR VEZ. Com
 * onze mapas e um reload no meio, o envio ao servidor chegava com 11 camadas de 17 e ZERO grupos
 * de 2, sem um erro em lugar nenhum. Recarregar deixa em memória apenas o mapa corrente, que é o
 * estado de quem abre o app noutro dia e manda enviar sem passear pelos mapas. Quem apagar o
 * `page.reload()` daqui não torna a spec mais rápida: torna-a vazia.
 *
 * ------------------------------------------------------------------------------------------
 * A PERNA DO SERVIDOR SE MEDE EM SQL, NUNCA NO SNAPSHOT
 * ------------------------------------------------------------------------------------------
 * O snapshot passa pelo cliente que acabou de escrever; o Postgres não. Ler o que o servidor
 * devolve para conferir o que o cliente mandou é o instrumento medindo outra cópia do sujeito. As
 * contagens da perna 3 vêm de `SELECT` direto nas tabelas (`maps`, `features`, `layers`, `groups`,
 * `cesium3d_data`, `streetview360_data`, `briefings`, `slides`, `images`), e são POR TIPO
 * (`data_type`) e não só por total: um total certo com os tipos trocados é um defeito que a soma
 * esconde.
 *
 * ------------------------------------------------------------------------------------------
 * AS DUAS PODAS DE RECURSO, QUE SÃO A METADE NÃO ÓBVIA DESTA CADEIA
 * ------------------------------------------------------------------------------------------
 * 3D e 360 carregam id de recurso de catálogo (`tilesetId`, nome da foto), e as duas fronteiras
 * desta cadeia PODAM referência de recurso, com regras DIFERENTES. Ignorar isso produziria dois
 * vermelhos falsos, então as duas entram como sujeito declarado:
 *
 *   ENTRADA NO SERVIDOR (`POST /atlas/import`): poda POR DESTINATÁRIO, decidida em SQL
 *   (`classifyResourceRefs` → `fn_can_see_resource`). Duas consequências medidas:
 *     - a conta é `credenciado` de propósito, e não `user`. `fn_has_global_data_access` cobre
 *       `admin` e `credenciado`, e é ele que faz um `tilesetId` sem linha de catálogo
 *       (`COALESCE(n.access_level, 'private')`) continuar visível. Com `user` os oito registros
 *       3D seriam podados na entrada e a perna 3 mediria a poda, não o transporte. `credenciado`
 *       e não `admin` porque `admin` muda `atlas.html` (ganha a busca de atlas) e curto-circuita
 *       a escada por atlas: variáveis que esta spec não quer.
 *     - o papel global NÃO salva o 360. A referência gravada é o NOME DA FOTO, e
 *       `classifyResourceRefs` resolve foto → projeto ANTES do predicado: o que não resolve sai
 *       como não visível sem que a função de acesso chegue a ser chamada. Por isso as duas fotos
 *       da fixture são semeadas em `sv360.projects`/`sv360.photos`. A semeadura é SQL puro no
 *       schema `sv360`, que não entra em `/api/config`, então ela não depende do memo de config
 *       (ligado nesta camada por `CONFIG_CACHE_FORCE=1` e cego a escrita direta no banco).
 *
 *   SAÍDA DO SERVIDOR ("Salvar como local"): poda KEEP-LIST, cega a papel, incondicional
 *   (`frontend/src/js/catalog/private-reference-pruner.js`). Sobrevive só o que resolve para
 *   PÚBLICO. Daí as DUAS ausências que a perna 4 asserere como ZERO, e nenhuma delas é defeito:
 *     - 3D sai porque os dois `tilesetId` da fixture não estão em `config.tilesets` (veredito
 *       `unknown`, que sai pela mesma porta do privado);
 *     - 360 sai SEMPRE, pública inclusive, por decisão registrada: `construirResolverDeSaida`
 *       devolve `unknown` para todo `views360` porque não existe mapa local foto → projeto.
 *   As duas são asseridas como PREMISSA (os quatro vereditos, lidos do resolver real) antes de
 *   virarem contagem, para que uma mudança de catálogo faça o motivo aparecer em vez de um zero
 *   inexplicado.
 *
 * ------------------------------------------------------------------------------------------
 * O QUE UM VERDE AQUI NÃO PROVA
 * ------------------------------------------------------------------------------------------
 *   - nada sobre o ZIP `.ebgeo` GRAVADO em disco: o arquivo aqui só é LIDO, e a saída medida é a
 *     de "Enviar ao servidor" e "Salvar como local", nunca a de exportar;
 *   - nada sobre import ADITIVO: o caminho exercitado é o não-aditivo do boot, que descarta os
 *     mapas do escopo antes da primeira escrita;
 *   - nada sobre comentário espacial, feição processada (`processed_los`/`processed_visibility`)
 *     nem imagem ANEXADA a feição de marcador 3D/360: a fixture não tem nenhum dos três, então
 *     essas travessias ficam sem exercício e um verde daqui não fala delas;
 *   - nada sobre os BLOBS na perna 4. Eles são recunhados no envio (`imageIdMap`) e o cliente os
 *     busca do servidor sob demanda (`image-sync.js`), então a cópia local nasce sem bytes de
 *     imagem por desenho. A cadeia de blob medida vai do arquivo ao disco (perna 1) e do disco à
 *     tabela `images` (perna 3);
 *   - nada sobre convergência entre DUAS abas: aqui há um cliente só;
 *   - e nada sobre a poda por destinatário de verdade, porque a conta que importa é a mesma que
 *     enviou e enxerga tudo. Quem mede aquilo é o censo de superfícies dos dois pacotes.
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readState } from './state.js';
import { createDb, closeDb } from './helpers/db.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { seedSv360Photo } from './helpers/catalog-seed.js';
import { loginUI } from './helpers/collab-helpers.js';
import { loadEbgeoFixture, countFixture } from '../helpers/ebgeo-fixture.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O mesmo `.ebgeo` real que a suíte de migração e as duas specs vizinhas usam. */
const FIXTURE = fileURLToPath(new URL('../fixtures/ebgeo-2.2/01-completo.ebgeo', import.meta.url));

/** O único mapa da fixture que carrega 3D e 360. Não é o mapa corrente, e isso é premissa. */
const MAPA_3D_360 = '10 3D e 360';

/** O mapa com mais de uma camada: é nele que a camada inventada pela memória vazia aparecia. */
const MAPA_DE_CAMADAS = '07 Camadas';

/** O único mapa com grupos: é nele que a seção vazia aparecia. */
const MAPA_DE_GRUPOS = '08 Grupos';

/** As quatro famílias de `cesium3d_data.data_type`, na ordem do CHECK da coluna. */
const ZERO_3D = Object.freeze({ camera_position: 0, marker: 0, measurement: 0, viewshed: 0 });

/** As duas famílias de `streetview360_data.data_type`. */
const ZERO_360 = Object.freeze({ orientation: 0, marker: 0 });

/** Espera o mapa 2D estar de pé. */
async function esperarMapa(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 60000 },
    );
}

/**
 * PRONTIDÃO DO BOOT, e ela é PREMISSA e nunca o sujeito: o escopo do slot montado só fica ativo
 * depois de `activateBootAtlasScope` e da remontagem do resolvedor de nomes, e ler antes disso
 * alcança os bancos errados. O número de MAPAS não é nenhuma das quantias que as asserções abaixo
 * comparam contra o servidor, então esperar por ele não esconde defeito nenhum.
 */
async function esperarEscopoMontado(page, mapasEsperados) {
    await page.waitForFunction(
        async (n) => {
            const store = await import('/src/js/store/index.js');
            return (await store.getAllMapNamesStore()).length === n;
        },
        mapasEsperados,
        { timeout: 60000 },
    );
}

/**
 * A LEITURA DO ATLAS MONTADO, seja ele qual for. Roda DENTRO da página e devolve o mesmo formato
 * que o leitor de SQL mais abaixo, de propósito: as duas pernas passam a ser comparáveis contra o
 * MESMO objeto derivado da fixture, em vez de contra dois esperados escritos à mão.
 *
 * A travessia é por CHAVE de armazenamento (`getAllMaps()`), nunca por nome: um slot local
 * não-legado exibe os mapas por UUID depois de um reload, e resolver nome → chave passaria pelo
 * `mapResolver`, que é justamente a peça que o boot deixa presa aos bancos legados. A chave
 * resolve para ela mesma nos dois regimes.
 *
 * @param {string[]} idsDeImagem - Ids de blob DA FIXTURE, para a perna em que eles ainda valem.
 */
async function lerAtlasMontado(idsDeImagem) {
    const { getRepository } = await import('/src/js/store/repositories/index.js');
    const { getCustomIcons } = await import('/src/js/store/customIcons.operations.js');
    const ns = await import('/src/js/store/atlas-namespace.js');
    const repo = getRepository();

    const feicoesPorMapa = {};
    const camadasPorMapa = {};
    const gruposPorMapa = {};
    const c3dPorMapa = {};
    const sv360PorMapa = {};
    let chaves = 0;

    for (const [chave, registro] of await repo.getAllMaps()) {
        chaves += 1;
        const nome = registro?.name ?? chave;

        let feicoes = 0;
        for (const lista of Object.values(registro?.features ?? {})) {
            if (Array.isArray(lista)) feicoes += lista.length;
        }
        const camadas = await repo.getLayers(chave);
        const grupos = await repo.getGroups(chave);
        const c3d = await repo.getCesium3d(chave);
        const sv = await repo.getStreetview360(chave);

        // SOMA POR NOME, porque o mesmo nome pode carregar duas chaves num slot recém-criado. O
        // número de chaves volta à parte, para que a soma nunca esconda uma duplicata.
        feicoesPorMapa[nome] = (feicoesPorMapa[nome] ?? 0) + feicoes;
        camadasPorMapa[nome] = (camadasPorMapa[nome] ?? 0) + (camadas?.length ?? 0);
        gruposPorMapa[nome] = (gruposPorMapa[nome] ?? 0) + Object.keys(grupos ?? {}).length;

        const a3d = c3dPorMapa[nome]
            ?? { camera_position: 0, marker: 0, measurement: 0, viewshed: 0 };
        a3d.camera_position += Object.keys(c3d?.cameraPositions ?? {}).length;
        a3d.marker += (c3d?.markers ?? []).length;
        a3d.measurement += (c3d?.measurements ?? []).length;
        a3d.viewshed += (c3d?.viewsheds ?? []).length;
        c3dPorMapa[nome] = a3d;

        const a360 = sv360PorMapa[nome] ?? { orientation: 0, marker: 0 };
        a360.orientation += Object.keys(sv?.orientations ?? {}).length;
        a360.marker += (sv?.markers ?? []).length;
        sv360PorMapa[nome] = a360;
    }

    const brutos = await repo.getAllBriefings();
    const briefings = brutos instanceof Map ? [...brutos.values()] : (brutos ?? []);
    const slidesPorBriefing = {};
    for (const b of briefings) {
        const nome = b?.name ?? '(briefing sem nome)';
        slidesPorBriefing[nome] = (slidesPorBriefing[nome] ?? 0) + (b?.slides?.length ?? 0);
    }

    const presentes = [];
    for (const id of idsDeImagem) presentes.push(await repo.hasImage(id));

    const escopo = ns.getActiveScope();
    const slots = await ns.readLocalAtlasRegistry();
    const slot = slots.find((s) => s.id === escopo?.atlasId) ?? null;

    return {
        chaves,
        feicoesPorMapa,
        camadasPorMapa,
        gruposPorMapa,
        c3dPorMapa,
        sv360PorMapa,
        briefings: briefings.length,
        slides: briefings.reduce((soma, b) => soma + (b?.slides?.length ?? 0), 0),
        slidesPorBriefing,
        icones: (await getCustomIcons()).length,
        blobsDaFixture: presentes.filter(Boolean).length,
        escopo: escopo
            ? { kind: escopo.kind, atlasId: escopo.atlasId ?? null, dbSuffix: escopo.dbSuffix ?? null }
            : null,
        nomeDoSlot: slot?.name ?? null,
    };
}

/**
 * O VEREDITO REAL do resolver de saída para os ids que a fixture referencia. Lido do próprio
 * `construirResolverDeSaida`, e não deduzido aqui, porque é ele que a poda consome: se o catálogo
 * do deploy mudar, esta leitura muda junto e a premissa fala em vez de o zero calar.
 */
async function lerVereditosDeSaida({ tilesets, fotos }) {
    const { construirResolverDeSaida } =
        await import('/src/js/catalog/resource-reference.resolver.js');
    const { RESOURCE_REF_GROUP } = await import('/src/js/catalog/resource-reference.registry.js');
    const resolver = await construirResolverDeSaida();
    return {
        tilesets: Object.fromEntries(
            tilesets.map((id) => [id, resolver(RESOURCE_REF_GROUP.TILESETS, id)]),
        ),
        fotos: Object.fromEntries(
            fotos.map((id) => [id, resolver(RESOURCE_REF_GROUP.VIEWS_360, id)]),
        ),
    };
}

/**
 * A VERDADE DE SOLO da perna 3, lida do Postgres e no MESMO formato do leitor da página.
 *
 * Os mapas são a espinha: cada contagem nasce zerada para os onze nomes e só então é preenchida
 * pelo `GROUP BY`. Sem isso, um mapa que perdesse todas as suas camadas simplesmente não
 * apareceria no resultado, e um `toEqual` contra um objeto de onze chaves reprovaria nomeando a
 * chave ausente em vez do número errado, que é pior diagnóstico pelo mesmo defeito.
 */
async function lerServidorEmSql(db, atlasId) {
    const mapas = await db.raw.any(
        'SELECT id, name FROM maps WHERE atlas_id = $1 AND deleted_at IS NULL',
        [atlasId],
    );

    const porMapa = (inicial) => Object.fromEntries(mapas.map((m) => [m.name, inicial()]));

    const contarPorMapa = async (tabela) => {
        const linhas = await db.raw.any(
            `SELECT m.name AS nome, count(*)::int AS n
               FROM ${tabela} x
               JOIN maps m ON m.id = x.map_id
              WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND x.deleted_at IS NULL
              GROUP BY m.name`,
            [atlasId],
        );
        const saida = porMapa(() => 0);
        for (const linha of linhas) saida[linha.nome] = linha.n;
        return saida;
    };

    const contarPorTipo = async (tabela, zero) => {
        const linhas = await db.raw.any(
            `SELECT m.name AS nome, x.data_type AS tipo, count(*)::int AS n
               FROM ${tabela} x
               JOIN maps m ON m.id = x.map_id
              WHERE m.atlas_id = $1 AND m.deleted_at IS NULL AND x.deleted_at IS NULL
              GROUP BY m.name, x.data_type`,
            [atlasId],
        );
        const saida = porMapa(() => ({ ...zero }));
        for (const linha of linhas) saida[linha.nome][linha.tipo] = linha.n;
        return saida;
    };

    const briefings = await db.raw.any(
        'SELECT id, name FROM briefings WHERE atlas_id = $1 AND deleted_at IS NULL',
        [atlasId],
    );
    const slides = await db.raw.any(
        `SELECT b.name AS nome, count(*)::int AS n
           FROM slides s
           JOIN briefings b ON b.id = s.briefing_id
          WHERE b.atlas_id = $1 AND b.deleted_at IS NULL AND s.deleted_at IS NULL
          GROUP BY b.name`,
        [atlasId],
    );
    const imagens = await db.raw.one(
        'SELECT count(*)::int AS n FROM images WHERE atlas_id = $1',
        [atlasId],
    );

    const slidesPorBriefing = Object.fromEntries(briefings.map((b) => [b.name, 0]));
    for (const linha of slides) slidesPorBriefing[linha.nome] = linha.n;

    return {
        mapas: mapas.length,
        nomesDeMapa: mapas.map((m) => m.name).sort(),
        feicoesPorMapa: await contarPorMapa('features'),
        camadasPorMapa: await contarPorMapa('layers'),
        gruposPorMapa: await contarPorMapa('groups'),
        c3dPorMapa: await contarPorTipo('cesium3d_data', ZERO_3D),
        sv360PorMapa: await contarPorTipo('streetview360_data', ZERO_360),
        briefings: briefings.length,
        slides: slides.reduce((soma, linha) => soma + linha.n, 0),
        slidesPorBriefing,
        imagens: imagens.n,
    };
}

describeOrSkip('a cadeia inteira: arquivo → atlas local → F5 → servidor → cópia local', () => {
    // A MEDIÇÃO É O PRODUTO AQUI, e `retries: 1` do config a mascararia: uma segunda tentativa
    // que passasse fecharia a rodada verde com o defeito apenas rotulado `flaky`, que é
    // exatamente a medição única de algo probabilístico que a constituição proíbe.
    test.describe.configure({ retries: 0 });

    test.afterAll(async () => { await closeDb(); });

    test('cada perna carrega mapas, camadas, grupos, feições, 3D, 360, briefings e slides', async ({ browser }) => {
        // O import de 262 feições mais o envio e o clone local passam de vários minutos numa
        // máquina carregada, e o teto do config não cobre isso.
        test.setTimeout(600000);

        // =============================== O QUE O ARQUIVO DECLARA ===============================
        const fixture = await loadEbgeoFixture('01-completo.ebgeo');
        const esperado = countFixture(fixture);
        const idsDeImagem = [...fixture.images.keys()];

        const nomesDeMapa = esperado.mapNames;
        const camadasEsperadas = Object.fromEntries(
            nomesDeMapa.map((nome) => [nome, (fixture.data.layers?.[nome] ?? []).length]),
        );
        const gruposEsperados = Object.fromEntries(
            nomesDeMapa.map((nome) => [nome, Object.keys(fixture.data.groups?.[nome] ?? {}).length]),
        );
        const c3dEsperado = Object.fromEntries(nomesDeMapa.map((nome) => {
            const doc = fixture.data.cesium3d?.[nome] ?? null;
            return [nome, {
                camera_position: Object.keys(doc?.cameraPositions ?? {}).length,
                marker: (doc?.markers ?? []).length,
                measurement: (doc?.measurements ?? []).length,
                viewshed: (doc?.viewsheds ?? []).length,
            }];
        }));
        const sv360Esperado = Object.fromEntries(nomesDeMapa.map((nome) => {
            const doc = fixture.data.streetview360?.[nome] ?? null;
            return [nome, {
                orientation: Object.keys(doc?.orientations ?? {}).length,
                marker: (doc?.markers ?? []).length,
            }];
        }));
        const slidesEsperados = Object.fromEntries(
            (fixture.data.briefings ?? []).map((b) => [b.name, (b.slides ?? []).length]),
        );

        // Os ids de recurso que o 3D e o 360 da fixture citam, colhidos das quatro e das duas
        // superfícies. Eles decidem a semeadura do 360 e as premissas da perna 4.
        const doc3d = fixture.data.cesium3d?.[MAPA_3D_360] ?? {};
        const doc360 = fixture.data.streetview360?.[MAPA_3D_360] ?? {};
        const tilesetsCitados = [...new Set([
            ...Object.keys(doc3d.cameraPositions ?? {}),
            ...(doc3d.markers ?? []).map((i) => i.tilesetId),
            ...(doc3d.measurements ?? []).map((i) => i.tilesetId),
            ...(doc3d.viewsheds ?? []).map((i) => i.tilesetId),
        ].filter(Boolean))].sort();
        const fotosCitadas = [...new Set([
            ...Object.keys(doc360.orientations ?? {}),
            ...(doc360.markers ?? []).map((i) => i.photoName),
        ].filter(Boolean))].sort();

        // CONTROLE DA DERIVAÇÃO, e ele é o que impede a cobertura vazia. Tudo acima é derivado do
        // arquivo, e uma derivação que devolvesse zero para tudo faria cada `toEqual` adiante
        // passar verde comparando dois vazios. Os números são os do README da fixture.
        expect(esperado.maps, 'a fixture tem onze mapas').toBe(11);
        expect(esperado.features, 'e 262 feições').toBe(262);
        expect(esperado.layers, 'e 17 camadas').toBe(17);
        expect(esperado.groups, 'e 2 grupos').toBe(2);
        expect(esperado.briefings, 'e 2 briefings').toBe(2);
        expect(esperado.slides, 'com 5 slides').toBe(5);
        expect(esperado.customIcons, 'e 2 ícones próprios').toBe(2);
        expect(esperado.images, 'e 5 blobs PNG').toBe(5);
        expect(camadasEsperadas[MAPA_DE_CAMADAS], `"${MAPA_DE_CAMADAS}" tem sete camadas`).toBe(7);
        expect(gruposEsperados[MAPA_DE_GRUPOS], `"${MAPA_DE_GRUPOS}" tem dois grupos`).toBe(2);
        expect(c3dEsperado[MAPA_3D_360], 'o 3D da fixture são dois de cada família')
            .toEqual({ camera_position: 2, marker: 2, measurement: 2, viewshed: 2 });
        expect(sv360Esperado[MAPA_3D_360], 'e o 360 são duas orientações e dois marcadores')
            .toEqual({ orientation: 2, marker: 2 });
        expect(slidesEsperados, 'os cinco slides estão repartidos 2 + 3')
            .toEqual({ 'Briefing de Inteligência': 2, 'Briefing Operacional': 3 });
        expect(tilesetsCitados, 'o 3D cita dois tilesets').toHaveLength(2);
        expect(fotosCitadas, 'o 360 cita duas fotos').toEqual(['FOTO_0001', 'FOTO_0002']);
        // O MAPA SOB EXAME NÃO É O CORRENTE, e isso é o que dá sentido ao F5: o corrente é o único
        // que o boot hidrata em memória, e portanto o único que passaria mesmo com o defeito.
        expect(fixture.data.currentMap, 'o mapa corrente é o que a fixture declara').toBe('Principal');
        expect([MAPA_3D_360, MAPA_DE_CAMADAS, MAPA_DE_GRUPOS], 'nenhum mapa sob exame é o corrente')
            .not.toContain(fixture.data.currentMap);

        /** Confere uma leitura de atlas montado contra o arquivo. `resumo` diz de qual perna é. */
        const conferirContraOArquivo = (medido, resumo, { c3d, sv360 }) => {
            expect(medido.chaves, `${resumo}: uma chave de armazenamento por mapa do arquivo`)
                .toBe(esperado.maps);
            expect(medido.feicoesPorMapa, `${resumo}: as feições de cada mapa`)
                .toEqual(esperado.featuresByMap);
            expect(medido.camadasPorMapa, `${resumo}: as camadas de cada mapa`)
                .toEqual(camadasEsperadas);
            expect(medido.gruposPorMapa, `${resumo}: os grupos de cada mapa`)
                .toEqual(gruposEsperados);
            expect(medido.c3dPorMapa, `${resumo}: o 3D, por família e por mapa`).toEqual(c3d);
            expect(medido.sv360PorMapa, `${resumo}: o 360, por família e por mapa`).toEqual(sv360);
            expect(medido.briefings, `${resumo}: os briefings`).toBe(esperado.briefings);
            expect(medido.slides, `${resumo}: os slides`).toBe(esperado.slides);
            expect(medido.slidesPorBriefing, `${resumo}: os slides de cada briefing`)
                .toEqual(slidesEsperados);
            expect(medido.icones, `${resumo}: os ícones próprios`).toBe(esperado.customIcons);
        };

        // ============================== A SEMEADURA DO 360 ==============================
        // Ver o `fileoverview`: sem projeto por trás do nome da foto, a referência 360 nunca chega
        // ao predicado de acesso e a entrada no servidor a poda, papel global inclusive.
        const sufixo = Math.random().toString(36).slice(2, 8);
        for (const nomeDaFoto of fotosCitadas) {
            const semeada = await seedSv360Photo(state.dbName, {
                photoName: nomeDaFoto,
                slug: `cadeia-${sufixo}-${nomeDaFoto.toLowerCase()}`,
            });
            expect(semeada.photoName, 'o projeto 360 semeado carrega o nome que a fixture cita')
                .toBe(nomeDaFoto);
        }

        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');

        // A conta nasce no NODE, com o e-mail confirmado pela rota pública. `credenciado` pelo
        // motivo escrito no `fileoverview`: ele é o papel mais estreito que faz a poda de ENTRADA
        // ser inócua, de modo que a perna 3 meça transporte e não acesso.
        const creds = await createVerifiedUser({
            prefix: 'cadeia', nome: 'Cadeia Completa', role: 'credenciado',
        });
        await loginUI(page, creds.username, creds.password);

        // ==================== PERNA 1: o arquivo vira um atlas LOCAL ====================
        await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(FIXTURE);

        // A tela entrega o arquivo e NAVEGA; quem importa é o boot do mapa.
        await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 60000 });
        await esperarMapa(page);

        // ESPERA PELO FIM DO IMPORT INTEIRO, ancorada no toast porque ele é a ÚLTIMA linha do
        // fluxo (mapas, grupos, camadas, 3D/360, temporal, comentários, briefings, ordem, imagens
        // e ícones já foram escritos quando ele aparece). Ancorar na própria quantia que se vai
        // asserir transformaria a asserção num timeout mudo no dia em que o defeito voltar.
        // A PLURALIZAÇÃO É DO PRODUTO e está errada de propósito aqui: `showLoadSuccess` escreve
        // "1 mapa carregados!" para um mapa só. Para onze, "11 mapas carregados!".
        await expect(page.locator('.toast', { hasText: `${esperado.maps} mapas carregados!` }))
            .toBeVisible({ timeout: 180000 });

        const p1 = await page.evaluate(lerAtlasMontado, idsDeImagem);
        conferirContraOArquivo(p1, 'perna 1 (import → local)', {
            c3d: c3dEsperado, sv360: sv360Esperado,
        });
        // OS BYTES, e não a referência: uma feição de imagem cujo blob não veio junto rende um
        // ícone de erro no mapa, e nenhuma contagem de feição acusa isso.
        expect(p1.blobsDaFixture, 'perna 1: os cinco blobs do zip chegaram ao repositório')
            .toBe(esperado.images);
        expect(p1.escopo?.kind, 'perna 1: o escopo montado é um slot LOCAL').toBe('local');
        expect(p1.nomeDoSlot, 'perna 1: o slot nasceu com o nome do arquivo').toBe('01-completo');

        // ============================ PERNA 2: O F5, O ATO SOB MEDIÇÃO ============================
        // Sem esta linha a memória continua povoada pelo import e as pernas seguintes medem o caso
        // afortunado. Ver o `@fileoverview`.
        await page.reload();
        await esperarMapa(page);
        await esperarEscopoMontado(page, esperado.maps);

        const p2 = await page.evaluate(lerAtlasMontado, idsDeImagem);
        conferirContraOArquivo(p2, 'perna 2 (depois do F5)', {
            c3d: c3dEsperado, sv360: sv360Esperado,
        });
        expect(p2.blobsDaFixture, 'perna 2: os blobs sobreviveram ao reload').toBe(esperado.images);
        expect(p2.escopo, 'perna 2: o reload voltou ao MESMO endereço de bancos').toEqual(p1.escopo);

        // ==================== PERNA 3: "Enviar ao servidor" ====================
        await page.locator('[data-testid="account-control"] .account-control__identity').click();
        const enviar = page.locator('[data-testid="account-save-server-btn"]');
        await expect(enviar, 'o menu de conta oferece "Enviar ao servidor" num atlas local')
            .toBeVisible({ timeout: 20000 });
        await enviar.click();

        const NOME_NO_SERVIDOR = `Cadeia ${sufixo}`;
        await expect(page.locator('[data-testid="create-atlas-name"]')).toBeVisible({ timeout: 20000 });
        await page.locator('[data-testid="create-atlas-name"]').fill(NOME_NO_SERVIDOR);
        await page.locator('[data-testid="create-atlas-confirm"]').click();

        // O TOAST É ESPERADO PRIMEIRO, e a ordem não é estilo: ele é a ÚLTIMA linha de
        // `saveLocalToServer` (depois do upload, do claim, da ativação de namespace, do wipe, do
        // connect e do `startAutoFlush`), e some em três segundos. Esperar pela badge antes e por
        // ele depois é a corrida que transformaria esta asserção num flake. Ele também é a única
        // leitura do que o CLIENTE contou ao ler o repositório depois do F5.
        await expect(
            page.locator('.toast', {
                hasText: `Atlas salvo no servidor (${esperado.maps} mapa(s), ${esperado.features} feição(ões))`,
            }),
            'o envio anunciou os onze mapas e as 262 feições que o repositório tinha',
        ).toBeVisible({ timeout: 300000 });

        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 60000 });
        // QUAL atlas, lido da BARRA DE ENDEREÇO e não de `syncEngine.atlasId` por `import()`:
        // com o Vite servindo um módulo recém-editado sob `?t=`, a sonda receberia OUTRA
        // instância, cujo `atlasId` é nulo enquanto a página diz "Conectado".
        await page.waitForURL(/[?&]atlas=/, { timeout: 60000 });
        const atlasId = new URL(page.url()).searchParams.get('atlas');
        expect(atlasId, 'a URL passou a nomear o atlas recém-criado').toBeTruthy();

        // A VERDADE DE SOLO, em SQL. Ela é a asserção que vale nesta perna.
        const db = createDb(state.dbName);
        const sql = await lerServidorEmSql(db, atlasId);

        expect(sql.mapas, 'servidor: uma linha em `maps` por mapa do arquivo').toBe(esperado.maps);
        expect(sql.nomesDeMapa, 'servidor: os nomes são os do arquivo')
            .toEqual([...nomesDeMapa].sort());
        expect(sql.feicoesPorMapa, 'servidor: `features` por mapa').toEqual(esperado.featuresByMap);
        expect(sql.camadasPorMapa, 'servidor: `layers` por mapa').toEqual(camadasEsperadas);
        expect(sql.gruposPorMapa, 'servidor: `groups` por mapa').toEqual(gruposEsperados);
        // POR `data_type`, e não só no total: oito registros 3D com as famílias trocadas somam
        // oito do mesmo jeito, e o total esconderia a troca.
        expect(sql.c3dPorMapa, 'servidor: `cesium3d_data` por família e por mapa').toEqual(c3dEsperado);
        expect(sql.sv360PorMapa, 'servidor: `streetview360_data` por família e por mapa')
            .toEqual(sv360Esperado);
        expect(sql.briefings, 'servidor: `briefings`').toBe(esperado.briefings);
        expect(sql.slides, 'servidor: `slides`').toBe(esperado.slides);
        expect(sql.slidesPorBriefing, 'servidor: os slides de cada briefing').toEqual(slidesEsperados);
        expect(sql.imagens, 'servidor: os cinco blobs subiram para `images`').toBe(esperado.images);

        // O ESPELHO LOCAL DO ATLAS DE SERVIDOR, leitura SECUNDÁRIA e declarada como tal: ele não
        // decide nada acima, e existe para localizar a falha da perna 4. Se o 3D sumir lá, esta
        // leitura diz se ele já tinha sumido no pull ou se foi a poda de saída que o tirou.
        await esperarEscopoMontado(page, esperado.maps);
        const espelho = await page.evaluate(lerAtlasMontado, idsDeImagem);
        expect(espelho.escopo?.kind, 'o escopo montado passou a ser REMOTO').toBe('remote');
        expect(espelho.escopo?.atlasId, 'e é o namespace do atlas recém-criado').toBe(atlasId);
        expect(espelho.c3dPorMapa, 'o snapshot trouxe o 3D para o espelho local').toEqual(c3dEsperado);
        expect(espelho.sv360PorMapa, 'e o 360 também').toEqual(sv360Esperado);
        expect(espelho.briefings, 'e os briefings').toBe(esperado.briefings);
        expect(espelho.slides, 'com os slides').toBe(esperado.slides);

        // ==================== PERNA 4: "Salvar como local" ====================
        // AS PREMISSAS DA PODA DE SAÍDA, lidas do resolver REAL antes de o botão ser clicado. Elas
        // são o que transforma os zeros adiante em consequência declarada em vez de zero mudo.
        const vereditos = await page.evaluate(lerVereditosDeSaida, {
            tilesets: tilesetsCitados, fotos: fotosCitadas,
        });
        expect(
            vereditos.tilesets,
            'os tilesets da fixture não estão no catálogo deste deploy, logo não são comprováveis',
        ).toEqual(Object.fromEntries(tilesetsCitados.map((id) => [id, 'unknown'])));
        expect(
            vereditos.fotos,
            'e toda foto 360 é `unknown` por decisão registrada, pública inclusive',
        ).toEqual(Object.fromEntries(fotosCitadas.map((id) => [id, 'unknown'])));

        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        const salvarLocal = page.locator('[data-testid="maps-save-local"]');
        await expect(salvarLocal, 'a aba Mapas de um atlas de servidor oferece "Salvar como local"')
            .toBeVisible({ timeout: 30000 });
        await salvarLocal.click();

        // O diálogo só aparece depois de o serviço montar o documento podado dos onze mapas.
        const confirmar = page.locator('.confirm-modal-btn-confirm');
        await expect(confirmar).toBeVisible({ timeout: 180000 });
        await confirmar.click();

        const NOME_DA_COPIA = `Copia ${sufixo}`;
        await expect(page.locator('.prompt-modal-input')).toBeVisible({ timeout: 30000 });
        await page.locator('.prompt-modal-input').fill(NOME_DA_COPIA);
        await page.locator('.prompt-modal-btn-confirm').click();

        await expect(
            page.locator('.toast', { hasText: `local "${NOME_DA_COPIA}" criada` }),
            'a cópia local foi criada e nomeada',
        ).toBeVisible({ timeout: 300000 });

        // REABRIR A CÓPIA. Sem isso a leitura seguinte continuaria no atlas de SERVIDOR, que tem
        // os mesmos onze mapas: contar onze ali passaria idêntico sem o clique ter trocado nada.
        await page.goto('/atlas.html');
        const cartao = page.locator('[data-testid="local-atlas-item"]', { hasText: NOME_DA_COPIA });
        await expect(cartao).toBeVisible({ timeout: 60000 });
        await cartao.click();
        await esperarMapa(page);
        await esperarEscopoMontado(page, esperado.maps);

        const p4 = await page.evaluate(lerAtlasMontado, idsDeImagem);

        // CONTROLE DE ESCOPO, e ele vem ANTES das contagens: é o que impede que a perna 4 seja a
        // perna 3 disfarçada.
        expect(p4.escopo?.kind, 'perna 4: o escopo montado é LOCAL de novo').toBe('local');
        expect(p4.nomeDoSlot, 'perna 4: e é o slot da cópia').toBe(NOME_DA_COPIA);
        expect(p4.escopo?.dbSuffix, 'perna 4: outro endereço de bancos, não o do atlas de servidor')
            .not.toBe(espelho.escopo?.dbSuffix);
        expect(p4.escopo?.dbSuffix, 'perna 4: e nem o do slot importado da perna 1')
            .not.toBe(p1.escopo?.dbSuffix);

        // O QUE ATRAVESSA A CADEIA INTEIRA. 3D e 360 saem ZERO, e as duas premissas acima dizem
        // por quê: a poda de saída é keep-list e cega a papel.
        conferirContraOArquivo(p4, 'perna 4 (cópia local)', {
            c3d: Object.fromEntries(nomesDeMapa.map((nome) => [nome, { ...ZERO_3D }])),
            sv360: Object.fromEntries(nomesDeMapa.map((nome) => [nome, { ...ZERO_360 }])),
        });

        await ctx.close();
    });
});
