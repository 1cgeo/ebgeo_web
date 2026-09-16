#!/usr/bin/env node
// Path: dev/import-estilos-basemap.mjs
//
// GRAVA O ESTILO MAPLIBRE EXATO DE CADA MAPA BASE no catálogo, lendo os módulos de estilo
// do deploy da `main` (o `src/js/baselayers/*.js` que está no ar).
//
// POR QUE ELE EXISTE. No backend novo o estilo de mapa base tem duas fontes: os
// CONSTRUTORES estáticos de `config.static.js:214-225`, que montam um raster de uma camada
// a partir das URLs do ambiente, e o `config.style` da linha de catálogo, que os SOBRESCREVE
// (`config.service.js:174-181`). Os construtores cobrem cinco ids genéricos, e o que a
// produção serve hoje são outros quatro, desenhados: a Topográfica do Overture (190 camadas,
// 12 fontes), a Ortoimagem do Overture (13 fontes), a DSG do atlas Perseu (97 camadas) e o
// BDGEx. Sem este passo, `osm-overture` e `overture-ortoimagem` não têm estilo nenhum, o
// frontend cai no fallback e a tela mostra DUAS cartas topográficas iguais, que foi o
// sintoma medido em 2026-09-16.
//
// A ALTERNATIVA ERA PORTAR os quatro módulos para o `frontend/` da integração, 38 mil linhas
// de estilo que o `main` ainda edita à mão (a padronização cadastral de Cacequi está aplicada
// dentro do `overture_layer.js`, e o gerador do `edgv_topo_20` não a tem). Pelo banco, o
// estilo é dado de configuração e segue o mesmo caminho do resto do catálogo.
//
// A ORDEM É CONTRATO, E RODAR FORA DELA APAGA ESTE TRABALHO: `import-config-catalog.mjs`
// SUBSTITUI o `config` de cada mapa base, não o mescla, então uma reimportação do config
// derruba os quatro `style` de volta a nada, e a tela volta a mostrar duas Topográficas.
// Medido em 2026-09-16. Rode sempre config → estilos, e repita este script depois de
// qualquer reimportação do config.
//
// O QUE ELE MUDA NO ESTILO, e é a única coisa: o `sprite` vem gravado como URL ABSOLUTA do
// nome público (`https://<nome>/ebgeo/images/sprite`), e ele passa a ser RELATIVO AO
// DOCUMENTO (`./images/sprite`), que é a forma que o `glyphs` do MESMO arquivo já usa.
//
// Absoluta, ela só funciona onde aquele nome resolve, e de uma estação a resolução vai para
// outra sub-rede (ver a wiki do servidor). O caminho de raiz (`/ebgeo/images/...`) também não
// serve, e isto foi medido em 2026-09-16: o app é servido sob `/ebgeo/` em produção mas na
// RAIZ pelo servidor de desenvolvimento (o `base` do Vite só vira `/cms/` no build), de modo
// que `/ebgeo/images/sprite.json` cai no fallback de SPA e volta o `index.html` com HTTP 200 —
// 200 que mente, e o sintoma é ícone que não desenha, sem erro no console. Relativo resolve
// contra a base do documento e vale nos dois. O MapLibre busca o sprite na THREAD PRINCIPAL,
// onde essa base existe (a armadilha do worker de blob é do tile, nunca do sprite).
// Use `--sprite-verbatim` para gravar o valor da origem sem tocar.
//
// Uso:
//   node dev/import-estilos-basemap.mjs --origem=<caminho>/ebgeo_web_main/src/js/baselayers
//   node dev/import-estilos-basemap.mjs --origem=... --apply
//
// | Flag | Efeito |
// |---|---|
// | `--origem=` | a pasta `src/js/baselayers` do checkout da `main`. Obrigatória. |
// | `--apply` | executa a escrita. Sem ela é dry-run. |
// | `--sprite-verbatim` | não reescreve o `sprite` absoluto. |
// | `--so=a,b` | restringe a estes ids de mapa base. |
//
// `DATABASE_URL` (o DESTINO) sai do ambiente ou de `backend/.env`.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..', 'backend');
const requireFromBackend = createRequire(pathToFileURL(resolve(BACKEND, 'package.json')));
const pgp = requireFromBackend('pg-promise')();

// O mapa entre o id do catálogo e o módulo que o desenha. Ele é o CONTRATO desta migração:
// o id vem do `config.js` do deploy (`basemaps`), e o arquivo, do `index.js` dos baselayers.
const MODULOS = {
  'osm-overture': 'overture_layer.js',
  'overture-ortoimagem': 'overture_ortoimagem.js',
  'carta-topografica': 'carta_topografica.js',
  bdgex: 'bdgex_layer.js',
};

const args = process.argv.slice(2);
const flag = (nome) => args.some((a) => a === `--${nome}`);
const valor = (nome) => {
  const achado = args.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.slice(nome.length + 3) : null;
};

const ORIGEM = valor('origem');
const APPLY = flag('apply');
const VERBATIM = flag('sprite-verbatim');
const SO = (valor('so') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!ORIGEM || !existsSync(ORIGEM)) {
  console.error(`Falta --origem=<pasta src/js/baselayers da main>${ORIGEM ? ` (não encontrada: ${ORIGEM})` : ''}.`);
  process.exit(1);
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = resolve(BACKEND, '.env');
  if (existsSync(envPath)) {
    for (const linha of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      if (linha.startsWith('DATABASE_URL=')) return linha.slice('DATABASE_URL='.length).trim();
    }
  }
  console.error('DATABASE_URL ausente no ambiente e em backend/.env.');
  process.exit(1);
}

/**
 * Troca a origem absoluta do `sprite` pelo caminho de mesma origem. Aceita as duas formas
 * que o MapLibre admite (string única e lista de `{id, url}`), porque os quatro estilos usam
 * as duas e uma delas quebraria calada se o código só soubesse da outra.
 * @param {Object} estilo - o estilo MapLibre
 * @returns {{estilo: Object, trocas: Array<string>}}
 */
function normalizarSprite(estilo) {
  const trocas = [];
  const corta = (url) => {
    if (typeof url !== 'string') return url;
    const nova = url.replace(/^https?:\/\/[^/]+\/ebgeo\//, './');
    if (nova !== url) trocas.push(`${url} -> ${nova}`);
    return nova;
  };
  const s = estilo.sprite;
  if (typeof s === 'string') estilo.sprite = corta(s);
  else if (Array.isArray(s)) estilo.sprite = s.map((e) => ({ ...e, url: corta(e.url) }));
  return { estilo, trocas };
}

const UPDATE = `
  UPDATE basemaps
     SET config = config || jsonb_build_object('style', $<style>::jsonb),
         updated_at = NOW()
   WHERE id = $<id>
`;

async function main() {
  const db = pgp(databaseUrl());
  const alvo = new URL(databaseUrl());
  console.log(`\norigem : ${ORIGEM}`);
  console.log(`destino: ${alvo.pathname.slice(1)} em ${alvo.hostname}:${alvo.port || 5432}`);
  console.log(`modo   : ${APPLY ? 'APPLY (escreve)' : 'DRY-RUN (nada é escrito)'}`
    + `${VERBATIM ? ' | sprite verbatim' : ''}${SO.length ? ` | só ${SO.join(',')}` : ''}\n`);

  const noBanco = new Map((await db.any('SELECT id, name, active FROM basemaps')).map((r) => [r.id, r]));

  const aEscrever = [];
  for (const [id, arquivo] of Object.entries(MODULOS)) {
    if (SO.length && !SO.includes(id)) continue;
    const caminho = join(ORIGEM, arquivo);
    if (!existsSync(caminho)) { console.log(`  ! ${id}: ${arquivo} não existe na origem, pulado`); continue; }
    if (!noBanco.has(id)) { console.log(`  ! ${id}: não existe em basemaps, pulado (importe o config primeiro)`); continue; }

    let estilo = (await import(pathToFileURL(caminho).href)).default;
    // Um módulo de estilo pode exportar a URL de um style.json em vez do objeto. Gravar uma
    // string em `config.style` produziria um mapa base que não carrega e não reclama.
    if (typeof estilo !== 'object' || estilo === null || !Array.isArray(estilo.layers)) {
      console.log(`  ! ${id}: ${arquivo} não exporta um estilo MapLibre (layers ausente), pulado`);
      continue;
    }
    estilo = JSON.parse(JSON.stringify(estilo));
    const { trocas } = VERBATIM ? { trocas: [] } : normalizarSprite(estilo);
    const json = JSON.stringify(estilo);
    aEscrever.push({ id, style: json });
    console.log(`  ${id.padEnd(22)} ${noBanco.get(id).name.padEnd(14)} `
      + `${String((json.length / 1024).toFixed(0)).padStart(4)} KB  `
      + `${Object.keys(estilo.sources || {}).length} fonte(s), ${estilo.layers.length} camada(s)`
      + `${noBanco.get(id).active ? '' : '  [INATIVO no catálogo]'}`);
    for (const t of trocas) console.log(`      sprite: ${t}`);
  }

  console.log(`\n  ${aEscrever.length} estilo(s) a gravar, `
    + `${(aEscrever.reduce((s, r) => s + r.style.length, 0) / 1024).toFixed(0)} KB no total`);
  console.log('  (todo esse peso entra no GET /api/config, que o boot do frontend busca uma vez)');

  if (!APPLY) {
    console.log('\nDry-run: nada foi escrito. Repita com --apply.\n');
    await db.$pool.end();
    return;
  }

  let escritos = 0;
  await db.tx(async (t) => {
    for (const r of aEscrever) escritos += (await t.result(UPDATE, r)).rowCount;
  });
  console.log(`\n--- escrito ---\n  ${escritos} estilo(s) gravado(s)`);
  console.log('\nO memo do /api/config expira em até CONFIG_CACHE_TTL_MS (ou reinicie o backend).\n');
  await db.$pool.end();
}

main().catch((e) => {
  console.error(`Falhou: ${e.message}`);
  process.exit(1);
});
