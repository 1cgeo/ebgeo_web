#!/usr/bin/env node
// Path: dev/basemaps-de-desenvolvimento.mjs
//
// DEIXA O CATÁLOGO DE MAPA BASE COM DOIS ITENS QUE NÃO DEPENDEM DO SERVIDOR DE PRODUÇÃO: um OSM
// e um de satélite, os dois de tiles públicos da internet.
//
// POR QUE ELE EXISTE (decisão do dono, 2026-09-17). Os quatro mapas base que a produção serve
// (Topográfica e Ortoimagem do Overture, DSG do atlas Perseu, BDGEx) desenham a partir do servidor
// da DGEO: para trabalhar neles é preciso o proxy apontado para lá, e uma estação sem alcance
// àquele host fica com a tela vazia. Para DESENVOLVER e TESTAR, dois rasters públicos bastam e
// tornam o ambiente autossuficiente.
//
// O QUE ELE NÃO TOCA: os glyphs e o sprite, que já são do PRÓPRIO app (`./glyphs/...`,
// `./images/sprite`, servidos de `frontend/public/`). É isso que mantém rótulo de feição e símbolo
// militar desenhando: um estilo raster sem `glyphs` cala todo texto que o app acrescenta, e sem
// `sprite` os ícones somem — os dois sintomas aparecem SEM erro no console.
//
// E ELE NÃO APAGA NADA: os quatro de produção ficam na tabela com `active = false`, então
// `--restaurar` devolve a lista anterior sem reimportar coisa nenhuma.
//
// Uso:
//   node dev/basemaps-de-desenvolvimento.mjs                 # dry-run: mostra o que faria
//   node dev/basemaps-de-desenvolvimento.mjs --apply
//   node dev/basemaps-de-desenvolvimento.mjs --apply --satelite=google
//   node dev/basemaps-de-desenvolvimento.mjs --apply --restaurar
//
// | Flag | Efeito |
// |---|---|
// | `--apply` | executa a escrita; sem ela é dry-run |
// | `--satelite=esri\|google` | a fonte do satélite (padrão `esri`) |
// | `--restaurar` | reativa os mapas base de produção e desativa os dois de desenvolvimento |

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pgPromise = require(path.resolve('backend/node_modules/pg-promise'));

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const restaurar = args.includes('--restaurar');
const satelite = (args.find((a) => a.startsWith('--satelite='))?.split('=')[1] ?? 'esri').toLowerCase();

const DATABASE_URL = readFileSync('backend/.env', 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!DATABASE_URL) throw new Error('DATABASE_URL ausente em backend/.env');

/** Os ids de desenvolvimento. `osm` já existe na tabela semeada; `satelite` é novo. */
const DEV = Object.freeze(['osm', 'satelite']);

/**
 * As fontes de satélite. A do Esri é a padrão porque o uso dela é declarado e a atribuição
 * resolve; a do Google fica disponível porque foi citada, e a diferença de contrato de uso é do
 * operador, não deste script.
 *
 * ATENÇÃO À ORDEM DOS EIXOS: o Esri serve `{z}/{y}/{x}` e o Google `x={x}&y={y}&z={z}`. Trocar
 * y por x não dá erro nenhum: desenha o mundo em outro lugar.
 */
const SATELITE = Object.freeze({
    esri: {
        nome: 'Satélite (Esri)',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Imagens © Esri, Maxar, Earthstar Geographics',
        maxzoom: 19,
    },
    google: {
        nome: 'Satélite (Google)',
        tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
        attribution: 'Imagens © Google',
        maxzoom: 20,
    },
});

/** Glyphs e sprite do PRÓPRIO app: é o que mantém rótulo e símbolo desenhando. */
const DO_APP = Object.freeze({
    glyphs: './glyphs/{fontstack}/{range}.pbf',
    sprite: [
        { id: 'default', url: './images/sprite' },
        { id: 'etrdg', url: './images/rdg_transparente' },
    ],
});

/** Monta um estilo MapLibre de UMA camada raster, auto-contido. */
function estiloRaster({ nome, tiles, attribution, maxzoom }) {
    return {
        version: 8,
        name: nome,
        ...DO_APP,
        sources: {
            base: { type: 'raster', tiles, tileSize: 256, attribution, maxzoom },
        },
        layers: [
            // O fundo evita o "vazio" cinza do MapLibre enquanto o tile não chega.
            { id: 'fundo', type: 'background', paint: { 'background-color': '#e9e5dc' } },
            { id: 'base', type: 'raster', source: 'base' },
        ],
    };
}

const pgp = pgPromise();
const db = pgp(DATABASE_URL);

const ESCOLHIDO = SATELITE[satelite];
if (!ESCOLHIDO) throw new Error(`--satelite=${satelite} desconhecido (use esri ou google)`);

const alvos = [
    {
        id: 'osm',
        name: 'OSM',
        description: 'OpenStreetMap (tiles públicos) — ambiente de desenvolvimento',
        sort_order: 1,
        style: estiloRaster({
            nome: 'OSM',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            attribution: '© OpenStreetMap contributors',
            maxzoom: 19,
        }),
    },
    {
        id: 'satelite',
        name: ESCOLHIDO.nome,
        description: 'Imagem de satélite (tiles públicos) — ambiente de desenvolvimento',
        sort_order: 2,
        style: estiloRaster({ nome: ESCOLHIDO.nome, ...ESCOLHIDO }),
    },
];

async function main() {
    const antes = await db.any('SELECT id, name, active, sort_order FROM basemaps ORDER BY sort_order');
    console.log('ANTES:');
    for (const r of antes) console.log(`  ${r.active ? '*' : ' '} ${r.id.padEnd(22)} ${r.name} (ordem ${r.sort_order})`);

    if (restaurar) {
        console.log('\nRESTAURAR: reativa os de produção e desativa os de desenvolvimento.');
        if (!apply) { console.log('(dry-run; use --apply)'); return; }
        await db.tx(async (t) => {
            await t.none('UPDATE basemaps SET active = false, updated_at = NOW() WHERE id = ANY($1)', [DEV]);
            await t.none(`UPDATE basemaps SET active = true, updated_at = NOW()
                          WHERE id IN ('osm-overture','overture-ortoimagem','carta-topografica','bdgex')`);
        });
    } else {
        console.log(`\nDEPOIS: só ${alvos.map((a) => a.id).join(' e ')} ativos (satélite: ${satelite}).`);
        console.log('  os de produção ficam na tabela, inativos, e voltam com --restaurar.');
        if (!apply) { console.log('(dry-run; use --apply)'); return; }
        await db.tx(async (t) => {
            // Desativa TUDO primeiro: assim uma linha semeada que ninguém lembrava (o `imagens`
            // sem estilo, por exemplo) não sobra na lista e vira um cartão que não desenha.
            await t.none('UPDATE basemaps SET active = false, updated_at = NOW()');
            for (const alvo of alvos) {
                await t.none(
                    `INSERT INTO basemaps (id, name, description, config, active, sort_order, access_level)
                     VALUES ($1, $2, $3, $4::jsonb, true, $5, 'public')
                     ON CONFLICT (id) DO UPDATE
                       SET name = EXCLUDED.name, description = EXCLUDED.description,
                           config = EXCLUDED.config, active = true,
                           sort_order = EXCLUDED.sort_order, updated_at = NOW()`,
                    // O META VAI JUNTO, e sem ele o mapa base nao aparece: `listBasemaps` serve
                    // `config` menos o `style`, e o cliente filtra por `enabled` e ordena por
                    // `priority` (`getEnabledBasemaps`, config.helpers.js). Gravar so o estilo
                    // deixa a lista vazia, sem erro em lugar nenhum.
                    [alvo.id, alvo.name, alvo.description,
                        JSON.stringify({
                            enabled: true,
                            priority: alvo.sort_order,
                            minzoom: 2,
                            maxzoom: alvo.style.sources.base.maxzoom,
                            style: alvo.style,
                        }),
                        alvo.sort_order],
                );
            }
        });
    }

    // GRID E SOMBREAMENTO saem junto (pedido do dono, 2026-09-17): os dois desenham a partir do
    // servidor de produção, e o que se quer aqui é um ambiente que se baste. O grid ja e `false`
    // na configuração estática; quem o liga e o OVERRIDE de administrador, entao e nele que se
    // mexe. `--restaurar` devolve os dois.
    await db.tx(async (t) => {
        const linha = await t.oneOrNone("SELECT value FROM config_settings WHERE key = 'app_config'");
        const valor = linha?.value ?? {};
        valor.features = { ...(valor.features || {}), grid: !restaurar ? false : true };
        valor.map2d = { ...(valor.map2d || {}) };
        if (valor.map2d.hillshade) {
            valor.map2d.hillshade = { ...valor.map2d.hillshade, enabled: restaurar };
        }
        // O BOTÃO "Terreno" JÁ SABE SUMIR, e o gate dele é a própria fonte: a barra inferior lê
        // `map2d.terrainSource` (`FEATURE_TOGGLES.terrain`, bottom-controls.constants.js) e não
        // desenha o comando quando ela é falsy. Então desligar o terreno é NÃO ENTREGAR a fonte,
        // e não uma bandeira nova: o `deepMerge` do config repassa `null` por cima do valor
        // estático (config.service.js), do mesmo jeito que o 3D já decide por
        // `enabled: Boolean(map3dTerrainUrl)`.
        valor.map2d.terrainSource = restaurar ? undefined : null;
        if (restaurar) delete valor.map2d.terrainSource;
        // O TERRENO DO 3D E OUTRO SERVICO, e ele tambem so existe na producao: o Cesium busca
        // `layer.json` do provider de terreno e, sem resposta, o visualizador fica em "Carregando
        // cena..." para sempre (medido em 2026-09-18, com a conexao recusada no console). A chave
        // `MAP3D_TERRAIN_URL` do `.env` vence a variavel de ambiente, entao quem desliga e o
        // OVERRIDE, como o resto desta funcao ja faz. Sem terreno o Cesium usa o elipsoide, que e o
        // comportamento declarado de quem nao tem terreno (config.service.js).
        valor.map3d = { ...(valor.map3d || {}) };
        valor.map3d.providers = { ...(valor.map3d.providers || {}) };
        valor.map3d.providers.terrain = {
            ...(valor.map3d.providers.terrain || {}),
            enabled: restaurar,
        };
        await t.none(
            `INSERT INTO config_settings (key, value, updated_at) VALUES ('app_config', $1::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [JSON.stringify(valor)],
        );
    });
    console.log(`
features.grid = ${!restaurar ? 'false' : 'true'} | hillshade = ${restaurar} | terrainSource = ${restaurar ? '(do ambiente)' : 'null'} | terreno 3D = ${restaurar}`);

    const depois = await db.any('SELECT id, name, active, sort_order FROM basemaps WHERE active ORDER BY sort_order');
    console.log('\nATIVOS AGORA:');
    for (const r of depois) console.log(`  ${r.id.padEnd(22)} ${r.name} (ordem ${r.sort_order})`);
    console.log('\nO cliente lê isto por GET /api/config; recarregue a página para ver.');
}

main().catch((e) => { console.error(String(e).slice(0, 400)); process.exitCode = 1; }).finally(() => pgp.end());
