#!/usr/bin/env node
// Path: scripts/models3d-importar-cena.js

/**
 * @module scripts/models3d-importar-cena
 * @description Importa uma CENA navegavel a pe (Gaussian Splatting): a pasta
 * que a pipeline de processamento produz, copiada como esta.
 *
 * NADA AQUI VAI PARA SQLITE, e isso e a decisao central. Uma cena e um splat de
 * dezenas de MB mais um octree de colisao que o visualizador le EM FAIXA. O
 * sistema de arquivos serve isso melhor que um BLOB, e aqui nao ha os milhares
 * de objetos pequenos que o `.3dtiles` existe para resolver. Vai para o banco so
 * o METADADO, e ele vai para a tabela de catalogo, que e de onde o `/api/config` monta o
 * documento que o cliente le.
 *
 * NADA E CONVERTIDO. O `.sog` e o octree sao formato de outra pipeline, e
 * reescreve-los aqui seria decidir por ela. A copia e byte a byte, e a
 * conferencia e por `sha256` de cada arquivo.
 *
 * O LAYOUT DA PASTA E CONTRATO com o `scene-config.service.js` do ebgeo_web:
 *
 *   cena.sog                  o splat
 *   voxel/voxel-meta.json     cabecalho do octree de colisao
 *   voxel/voxel.bin           corpo do octree
 *   marcadores.json           fichas curadas
 *   itens/                    fotos das fichas
 *   preview/preview.webm      video do cartao do catalogo
 *   preview/thumbnail.jpg     capa do cartao
 *
 * Uso:
 *   npm run models3d:importar-cena -- --origem <pasta> --id museu-1cgeo \
 *     --nome "Sala Historica General Malan" --lon -51.2 --lat -30.03 \
 *     [--pose "3.82,0.55,1.42,0,0"] [--velocidade 2.4] [--fov 60] [--dry-run]
 */

import { existsSync, mkdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import config from '../src/config.js';
import { query, tx, pgp } from '../src/database/index.js';
import { invalidateAppConfigCache } from '../src/modules/config/config.cache.js';
import {
  UPSERT_TILESET_3D, UPSERT_SCENE_3D, CATALOG_ROW_EXISTS,
} from '../src/modules/models3d/models3d.queries.js';
// O LAYOUT E A ASSINATURA moram no modulo, e nao aqui: eles sao o CONTRATO da cena, e a
// verificacao (que roda muito depois desta importacao) precisa dos mesmos.
import { medirCena, validarLayoutDeCena } from '../src/modules/models3d/models3d.scene.js';

function args() {
  const a = process.argv.slice(2);
  const v = (n, p) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : p; };
  const num = (n, p) => { const x = v(n); return x == null ? p : Number(x); };
  return {
    origem: v('--origem'),
    id: v('--id'),
    nome: v('--nome'),
    descricao: v('--descricao'),
    local: v('--local'),
    dataCaptura: v('--data-captura'),
    keywords: v('--keywords'),
    lon: num('--lon', null),
    lat: num('--lat', null),
    pose: v('--pose'),
    velocidade: num('--velocidade', null),
    fov: num('--fov', null),
    // OS BYTES JA INSTALADOS: com `--base-path` o roteiro NAO copia nada e registra a
    // pasta onde ela ja esta, medindo `--origem` no lugar. Ele existe porque era a unica
    // coisa que `fp:register` fazia e este nao fazia, e sem ela a aposentadoria daquele
    // roteiro teria tirado uma capacidade em vez de unificar duas receitas: em dev a cena
    // e servida pelo Vite de `frontend/public/3d/`, fora de ASSETS_3D_DIR.
    basePath: v('--base-path'),
    forcar: a.includes('--forcar'),
    dryRun: a.includes('--dry-run'),
  };
}

async function main() {
  const o = args();
  if (!o.origem || !o.id) {
    console.error('Uso: npm run models3d:importar-cena -- --origem <pasta> --id <slug>'
      + ' --nome "..." [--lon N --lat N] [--pose "x,y,z,yaw,pitch"]');
    process.exit(2);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(o.id)) {
    console.error(`ERRO: --id "${o.id}" invalido. Use minusculas, digitos, hifen e sublinhado.`);
    process.exit(2);
  }
  if (!existsSync(o.origem) || !statSync(o.origem).isDirectory()) {
    console.error(`ERRO: --origem tem de ser uma PASTA: ${o.origem}`);
    process.exit(2);
  }

  const log = (s) => console.log(s);
  const passo = (t) => console.log(`\n--- ${t} ---`);

  const existente = await query(CATALOG_ROW_EXISTS, [o.id]);
  if (existente.rows.length && !o.forcar) {
    console.error(`ERRO: ja ha item de catalogo com o id "${o.id}".`);
    console.error('Use --forcar para reimportar por cima.');
    await encerrar();
    process.exit(3);
  }

  passo('1. inventario da origem');
  // A MEDIDA JA E A CONFERENCIA: cada arquivo sai daqui com o sha256, e a assinatura do
  // manifesto (a lista ordenada de caminho + hash) e o que identifica a cena inteira.
  const inv = await medirCena(o.origem);
  log(`  ${inv.arquivos.length.toLocaleString('pt-BR')} arquivos, ${(inv.totalBytes / 2 ** 20).toFixed(1)} MiB`);
  log(`  assinatura ${inv.sha256.slice(0, 16)}...`);

  const veredito = validarLayoutDeCena(inv.arquivos.map((a) => a.rel));
  if (!veredito.ok) {
    console.error(`ERRO: ${veredito.motivo}.`);
    console.error('Sem o splat nao ha o que ver; sem o octree o visitante atravessa parede,');
    console.error('e a cena abre bonita sem nada no console.');
    await encerrar();
    process.exit(4);
  }
  if (veredito.avisos.length) {
    log(`  ATENCAO: sem ${veredito.avisos.join(', ')} (a cena abre, o cartao fica pobre)`);
  }
  const itens = inv.arquivos.filter((a) => a.rel.startsWith('itens/')).length;
  log(`  fotos de ficha: ${itens}`);

  let pose = null;
  if (o.pose) {
    const p = o.pose.split(',').map(Number);
    if (p.length !== 5 || p.some(Number.isNaN)) {
      console.error('ERRO: --pose precisa de cinco numeros: "x,y,z,yaw,pitch".');
      await encerrar();
      process.exit(2);
    }
    pose = p;
  }

  if (o.dryRun) {
    log('\n--dry-run: nada foi escrito.');
    await encerrar();
    return;
  }

  // Registrar em cima dos bytes que ja estao instalados: a medida da origem JA e a
  // medida do que sera servido, entao a conferencia do passo 3 compararia a pasta
  // consigo mesma e nao provaria nada. Ela e pulada, e o log diz isso em voz alta.
  const emLoco = Boolean(o.basePath);
  let copiado = inv;
  if (emLoco) {
    passo('2. copia (pulada: --base-path registra os bytes onde ja estao)');
    log(`  registrando ${o.origem} sob ${o.basePath}`);
  } else {
  passo('2. copia');
  // O ENDEREÇO É CONTRATO com o cliente: ele recebe UM basePath e deriva dele os sete
  // caminhos internos da cena.
  const destino = join(config.assets3d.dir, 'primeira-pessoa', o.id);
  // A PASTA VELHA SAI INTEIRA antes da copia. Copiar por cima deixaria arquivo
  // que a nova versao nao tem, e o visualizador o serviria como se fosse dela.
  if (existsSync(destino)) rmSync(destino, { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });
  for (const { rel } of inv.arquivos) {
    const alvo = join(destino, rel);
    mkdirSync(dirname(alvo), { recursive: true });
    copyFileSync(join(o.origem, rel), alvo);
  }
  copiado = await medirCena(destino);
  log(`  ${copiado.arquivos.length.toLocaleString('pt-BR')} arquivos, ${(copiado.totalBytes / 2 ** 20).toFixed(1)} MiB`);
  }

  // A CONFERENCIA COMPARA O QUE FOI COPIADO COM A ORIGEM. Sem copia nao ha duas coisas
  // para comparar, e rodar assim mesmo produziria o pior tipo de verde: a pasta batendo
  // consigo mesma, provando nada e parecendo prova.
  if (emLoco) {
    log('\n--- 3. conferencia (pulada: nada foi copiado, nao ha duas coisas a comparar) ---');
  } else {
  passo('3. conferencia')
  // A CONFERENCIA COBRE A MESMA EXTENSAO DA ESCRITA, e agora numa comparacao so: a
  // assinatura e o hash da lista ORDENADA de (caminho, sha256), entao ela pega arquivo
  // faltando, arquivo A MAIS, arquivo truncado e arquivo renomeado. Comparar so o tamanho
  // deixaria passar copia truncada que casa por acaso; comparar so a contagem, nem isso.
  if (copiado.sha256 !== inv.sha256) {
    console.error('ERRO: o que foi copiado NAO bate com a origem.');
    const naOrigem = new Map(inv.arquivos.map((a) => [a.rel, a.sha256]));
    const noDestino = new Map(copiado.arquivos.map((a) => [a.rel, a.sha256]));
    for (const [rel, hash] of naOrigem) {
      if (!noDestino.has(rel)) console.error(`  AUSENTE  ${rel}`);
      else if (noDestino.get(rel) !== hash) console.error(`  DIVERGE  ${rel}`);
    }
    for (const rel of noDestino.keys()) {
      if (!naOrigem.has(rel)) console.error(`  A MAIS   ${rel}`);
    }
    await encerrar();
    process.exit(5);
  }
  log(`  ${inv.arquivos.length.toLocaleString('pt-BR')} arquivos conferidos por sha256, assinatura identica`);
  }

  passo('4. catalogo');
  const basePath = o.basePath || `${config.assets3d.baseUrl}/primeira-pessoa/${o.id}`;
  const cfg = {
    forma3d: 'indoor',
    // O DISCRIMINADOR LEGADO CONTINUA SAINDO, e não é redundância: o cliente ainda deriva
    // a forma dele em linha antiga (`forma-3d.js`), e o serviço de cena o lê pelo nome.
    viewer: 'firstPerson',
    basePath,
  };
  if (o.descricao) cfg.description = o.descricao;
  if (o.local) cfg.local = o.local;
  if (o.dataCaptura) cfg.data_captura = o.dataCaptura;
  if (o.keywords) cfg.keywords = o.keywords.split(',').map((k) => k.trim()).filter(Boolean);
  if (o.lon != null && o.lat != null) cfg.locate = { lon: o.lon, lat: o.lat };
  if (pose) {
    cfg.poseInicial = {
      x: pose[0], y: pose[1], z: pose[2], yaw: pose[3], pitch: pose[4],
    };
  }
  if (o.velocidade != null) cfg.velocidade = o.velocidade;
  if (o.fov != null) cfg.fov = o.fov;

  // AS DUAS ESCRITAS SAO UMA SO: `a3d.scenes` tem FK para `tilesets`, entao a ordem e
  // obrigatoria, e sem transacao a falha da segunda deixa uma linha de catalogo apontando
  // para uma pasta que o registro de producao desconhece -- um item que aparece na lista e
  // que ninguem consegue verificar depois.
  await tx(async (t) => {
    await t.none(UPSERT_TILESET_3D, {
      id: o.id,
      name: o.nome || o.id,
      description: o.descricao ?? null,
      config: JSON.stringify(cfg),
      ativo: true,
    });
    await t.one(UPSERT_SCENE_3D, {
      sceneId: o.id,
      basePath,
      fileCount: copiado.arquivos.length,
      totalBytes: copiado.totalBytes,
      manifestSha256: copiado.sha256,
      sourcePath: o.origem,
    });
  });
  invalidateAppConfigCache();

  if (o.lon == null || o.lat == null) {
    log('  ATENCAO: sem lon/lat a cena NAO ganha pino no mapa 2D, e so o catalogo a alcanca.');
  }
  if (!pose) {
    log('  ATENCAO: sem --pose o visitante entra na pose padrao do visualizador.');
  }
  log(`  ${copiado.arquivos.length} arquivos, ${(copiado.totalBytes / 2 ** 20).toFixed(1)} MiB registrados`);

  log(`
=== IMPORTADA: ${o.id} ===`);
  log(`basePath publicado: ${basePath}`);
  await encerrar();
}

/** Fecha o pool do Postgres: o CLI termina o processo, e um pool aberto o segura. */
async function encerrar() {
  await Promise.resolve(pgp.end());
}

main().catch(async (err) => {
  console.error(err);
  await encerrar().catch(() => {});
  process.exit(1);
});
