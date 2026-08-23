#!/usr/bin/env node
// Path: scripts/models3d-importar.js

/**
 * @module scripts/models3d-importar
 * @description Importa um modelo: converte a arvore de origem para 3D Tiles 1.1
 * e grava tudo num unico {slug}.3dtiles.
 *
 * UM MODELO POR VEZ, de proposito. O acervo tem 115 modelos e 96,8 GiB, e nao ha
 * espaco em disco para trabalhar com varios ao mesmo tempo. Mais importante que
 * o espaco: um modelo por vez e a unidade em que a conferencia fecha ou reprova.
 *
 * LE DA ORIGEM, ESCREVE NO DESTINO, e nunca escreve na origem. Medido, converter
 * lendo do disco externo custa 1,2% a mais que ler do SSD, ou seja nada: o
 * gargalo e a CPU, e o conversor le cerca de 1,2 MiB/s. O que muda e o risco: se
 * o barramento USB cair no meio de uma corrida de horas, perde-se a corrida e
 * nao o acervo.
 *
 * OS SETE PASSOS, e cada um confere o anterior:
 *   1. inventario da origem
 *   2. abre o banco de destino, ainda com nome temporario
 *   3. converte os tiles com N workers, gravando direto no banco
 *   4. reescreve os tileset.json (versao 1.1, uri .glb, token de geracao)
 *   5. conferencia: todo tile da origem entrou, e toda uri referenciada existe
 *   6. finaliza o banco e o poe no lugar
 *   7. registra no catalogo
 *
 * O roteiro PARA no primeiro passo que reprovar, e o arquivo temporario nao vira
 * modelo. Nada da origem e tocado em nenhuma hipotese.
 *
 * PORTADO do repositório `ebgeo_3d`, com UMA mudança de desenho no passo 7: em vez de
 * escrever o catálogo aqui, ele chama `adotarModelo`, que lê o cabeçalho `meta` que o
 * passo 6 acabou de gravar. Assim existe UM caminho para "arquivo em disco vira linha de
 * catálogo", e não dois. Isso mata por construção o defeito que custou quatro modelos e
 * 40 minutos de conversão: um passo 7 com uma lista de campos própria, que ficou para trás
 * quando a lista mudou.
 *
 * Uso (pelo atalho do npm, que é o que passa o `.env`):
 *   npm run models3d:importar -- --origem <dir> --id <slug> [--nome "..."]
 *                                [--workers N] [--qlevel 200] [--max-textura auto|N|0]
 *                                [--forcar] [--limite N] [--dry-run]
 *   npm run models3d:importar -- --promover --id <slug>
 */

import { Worker } from 'node:worker_threads';
import { readFileSync, statSync, existsSync, readdirSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, relative, dirname, extname, basename } from 'node:path';
import { availableParallelism } from 'node:os';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import config from '../src/config.js';
import { pgp } from '../src/database/index.js';
import { blobPool } from '../src/utils/sqlite-blob-pool.js';
import { createModelDb, finalizarModelDb } from '../src/modules/models3d/models3d.build.js';
import {
  abrirImportacao, fecharImportacao, obterModelo3d,
} from '../src/modules/models3d/models3d.import.service.js';
import { adotarModelo } from './models3d-adotar.js';
import { versaoKtx, QLEVEL_PADRAO } from './lib3d/ktx2.js';
import {
  reescreveTileset, pontoDeNavegacao, envelopeGeodesico, ESCALA_GE,
  MAX_TEXTURA, MAX_TEXTURA_PADRAO,
} from './lib3d/tileset.js';
import {
  tipoDeTile, abrirTile, leGerador, extensoesNaoSuportadas,
} from './lib3d/b3dm.js';
import { trocaArquivo } from './lib3d/deposito.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** Extensoes que sao tile de conteudo e por isso passam pelo conversor. */
const EXT_TILE = new Set(['.b3dm', '.glb']);
/** Extensoes que entram no banco como estao. */
const EXT_COPIA = new Set(['.json', '.bin', '.ktx2', '.jpg', '.jpeg', '.png', '.webp', '.subtree']);
/**
 * Conteudo de 3D Tiles que este roteiro NAO converte.
 *
 * Eles precisam de nome proprio porque, sem isso, caiam em `ignorados` e
 * sumiam calados: o modelo entrava sem eles, e a reprovacao so vinha no passo 5
 * como "referencia quebrada", que a tabela de sintomas atribui a outra causa.
 * Nuvem de pontos e instanciacao pedem outro pipeline, e a hora de dizer isso e
 * no passo 1.
 */
const EXT_RECUSADA = new Set(['.pnts', '.i3dm', '.cmpt']);

/** Quantos tiles se acumulam antes de uma transacao de escrita. */
const LOTE_ESCRITA = 256;

// ---------------------------------------------------------------- argumentos

function args() {
  const a = process.argv.slice(2);
  const v = (nome, padrao) => {
    const i = a.indexOf(nome);
    return i >= 0 && a[i + 1] ? a[i + 1] : padrao;
  };
  return {
    origem: v('--origem'),
    id: v('--id'),
    nome: v('--nome'),
    workers: parseInt(v('--workers', String(Math.max(1, Math.min(12, availableParallelism() - 2)))), 10),
    qlevel: parseInt(v('--qlevel', String(QLEVEL_PADRAO)), 10),
    // 'auto' aplica o teto que MAX_TEXTURA conhece para o motor que a conversao
    // leu do proprio glTF, do mesmo jeito que `--escala-ge auto`.
    maxTextura: v('--max-textura', 'auto'),
    geometria: v('--geometria', 'draco'),
    escalaGe: v('--escala-ge', 'auto'),
    limite: v('--limite') ? parseInt(v('--limite'), 10) : null,
    forcar: a.includes('--forcar'),
    promover: a.includes('--promover'),
    dryRun: a.includes('--dry-run'),
    // OS DOIS EIXOS DE ACESSO passam direto para a adocao, e so quando informados: omitir
    // PRESERVA o que a linha de catalogo ja tem, para que uma reimportacao nao devolva ao
    // publico um modelo que alguem fechou.
    accessLevel: v('--access-level'),
    orgId: v('--org'),
  };
}

// ---------------------------------------------------------------- inventario

/**
 * Percorre a arvore e separa o que e tile, o que se copia e o que se ignora.
 * @param {string} raiz
 * @returns {{tiles:string[], copias:string[], ignorados:string[], recusados:string[], bytes:number}}
 */
function inventaria(raiz) {
  const tiles = []; const copias = []; const ignorados = []; const recusados = [];
  let bytes = 0;
  (function anda(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { anda(p); continue; }
      const rel = relative(raiz, p).replace(/\\/g, '/');
      const ext = extname(e.name).toLowerCase();
      bytes += statSync(p).size;
      if (EXT_TILE.has(ext)) tiles.push(rel);
      else if (EXT_COPIA.has(ext)) copias.push(rel);
      else if (EXT_RECUSADA.has(ext)) recusados.push(rel);
      else ignorados.push(rel);
    }
  })(raiz);
  return { tiles: tiles.sort(), copias: copias.sort(), ignorados, recusados, bytes };
}

// ---------------------------------------------------------------- conversao

/**
 * Converte todos os tiles com N workers, gravando cada resultado no banco.
 *
 * A ESCRITA E DE UMA THREAD SO, a principal. better-sqlite3 e sincrono e uma
 * conexao de escrita nao se compartilha entre threads; alem disso o custo aqui e
 * a conversao, nao o INSERT. Medido: doze workers saturam a CPU e a escrita
 * acompanha sem virar fila.
 *
 * @param {object} ctx
 * @returns {Promise<object>} totais da conversao
 */
function converteTiles(ctx) {
  const { raiz, tiles, db, workers, qlevel, geometria, upAxis, maxTextura, log } = ctx;
  return new Promise((resolve, reject) => {
    const inserir = db.prepare('INSERT OR REPLACE INTO media (key, content) VALUES (?, ?)');
    const gravarLote = db.transaction((linhas) => {
      for (const [k, v] of linhas) inserir.run(k, v);
    });

    let proximo = 0;
    let concluidos = 0;
    let bytesEntrada = 0; let bytesSaida = 0;
    let texturas = 0; let falhasTextura = 0; let triangulos = 0;
    let batchDescartadas = 0;
    const geradores = new Map();
    const erros = [];
    const pendentes = [];
    const vivos = new Set();
    const t0 = Date.now();
    let ultimoAviso = t0;

    const despacha = (w) => {
      if (proximo >= tiles.length) {
        w.postMessage({ fim: true });
        return false;
      }
      const chave = tiles[proximo++];
      w.postMessage({ chave, caminho: join(raiz, chave) });
      return true;
    };

    const grava = (chave, buf) => {
      pendentes.push([chave, buf]);
      if (pendentes.length >= LOTE_ESCRITA) {
        gravarLote(pendentes.splice(0, pendentes.length));
      }
    };

    for (let i = 0; i < workers; i++) {
      const w = new Worker(join(__dirname, 'lib3d', 'converter-worker.js'), { workerData: { qlevel, geometria, upAxis, maxTextura } });
      vivos.add(w);

      w.on('message', (m) => {
        if (m.pronto) { despacha(w); return; }

        concluidos++;
        if (m.ok) {
          const buf = Buffer.from(m.glb);
          // A CHAVE DE SAIDA TROCA A EXTENSAO. O tileset.json reescrito aponta
          // .glb, entao a chave gravada tem de casar com ele, senao o modelo
          // fica inteiro no banco e responde 404 em cada tile.
          const chaveSaida = m.chave.replace(/\.b3dm$/i, '.glb');
          grava(chaveSaida, buf);
          bytesEntrada += m.bytesEntrada;
          bytesSaida += buf.length;
          texturas += m.texturas;
          falhasTextura += m.falhasTextura;
          triangulos += m.triangulos;
          if (m.batchTableDescartada) batchDescartadas++;
          if (m.gerador) geradores.set(m.gerador, (geradores.get(m.gerador) || 0) + 1);
        } else {
          erros.push(`${m.chave}: ${m.erro}`);
        }

        const agora = Date.now();
        if (agora - ultimoAviso > 5000) {
          ultimoAviso = agora;
          const s = (agora - t0) / 1000;
          log(`    ${concluidos.toLocaleString('pt-BR')}/${tiles.length.toLocaleString('pt-BR')} tiles`
            + `  ${(concluidos / s).toFixed(1)} tiles/s`
            + `  restam ~${(((tiles.length - concluidos) / (concluidos / s)) / 60).toFixed(1)} min`);
        }

        despacha(w);
      });

      w.on('error', (err) => { erros.push(`worker: ${err.message}`); });
      w.on('exit', () => {
        vivos.delete(w);
        if (vivos.size === 0) {
          if (pendentes.length) gravarLote(pendentes.splice(0, pendentes.length));
          const segundos = (Date.now() - t0) / 1000;
          resolve({
            convertidos: concluidos - erros.filter((e) => !e.startsWith('worker')).length,
            tentados: tiles.length,
            bytesEntrada,
            bytesSaida,
            texturas,
            falhasTextura,
            triangulos,
            batchDescartadas,
            // O MAIS FREQUENTE, e nao o primeiro: um modelo combinado por
            // `py3dtiles merge` pode ter partes de motores diferentes, e o que
            // descreve o conjunto e a maioria.
            gerador: [...geradores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
            geradores: Object.fromEntries(geradores),
            erros,
            segundos,
          });
        }
      });
    }

    if (tiles.length === 0) {
      for (const w of vivos) w.postMessage({ fim: true });
    }
    setTimeout(() => {
      if (vivos.size && concluidos === 0) reject(new Error('nenhum worker respondeu em 60 s'));
    }, 60000).unref();
  });
}

// ---------------------------------------------------------------- principal

async function main() {
  const o = args();
  if (o.promover) {
    if (!o.id) { console.error('Uso: npm run models3d:importar -- --promover --id <slug>'); process.exit(2); }
    await promover(o.id, { accessLevel: o.accessLevel, orgId: o.orgId });
    return;
  }
  if (!o.origem || !o.id) {
    console.error('Uso: npm run models3d:importar -- --origem <dir> --id <slug> [--nome "..."]'
      + ' [--workers N] [--qlevel 200] [--max-textura auto|N|0] [--forcar] [--limite N]');
    process.exit(2);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(o.id)) {
    console.error(`ERRO: --id "${o.id}" invalido. Use minusculas, digitos, hifen e sublinhado.`);
    process.exit(2);
  }
  if (!existsSync(o.origem)) {
    console.error(`ERRO: origem nao existe: ${o.origem}`);
    process.exit(2);
  }

  const log = (s) => console.log(s);
  const passo = (t) => console.log(`\n--- ${t} ---`);

  const dbFilename = `${o.id}.3dtiles`;
  const destino = join(config.models3d.dbDir, dbFilename);
  const temporario = `${destino}.parcial`;

  const jaExiste = await obterModelo3d(o.id);
  if (jaExiste && !o.forcar) {
    console.error(`ERRO: o modelo "${o.id}" ja esta no catalogo (importado em ${jaExiste.built_at}).`);
    console.error('Use --forcar para reimportar por cima.');
    await encerrar();
    process.exit(3);
  }

  passo('1. inventario da origem');
  const inv = inventaria(o.origem);
  const tiles = o.limite ? inv.tiles.slice(0, o.limite) : inv.tiles;
  log(`  ${(inv.tiles.length + inv.copias.length).toLocaleString('pt-BR')} arquivos, ${(inv.bytes / 2 ** 20).toFixed(1)} MiB`);
  log(`  tiles ${inv.tiles.length.toLocaleString('pt-BR')}   json e afins ${inv.copias.length}   ignorados ${inv.ignorados.length}   recusados ${inv.recusados.length}`);
  if (o.limite) log(`  ATENCAO: --limite ${o.limite}, importacao PARCIAL (nao publique)`);
  if (inv.ignorados.length) {
    log(`  ignorados (nao entram no banco): ${inv.ignorados.slice(0, 5).join(', ')}${inv.ignorados.length > 5 ? ' ...' : ''}`);
  }
  if (inv.recusados.length) {
    console.error(`ERRO: ${inv.recusados.length} arquivos de tipo que este roteiro nao converte.`);
    for (const r of inv.recusados.slice(0, 5)) console.error(`  ${r}`);
    console.error('Nuvem de pontos (.pnts), instanciacao (.i3dm) e composto (.cmpt) pedem outro pipeline.');
    await encerrar();
    process.exit(4);
  }
  if (!tiles.length) {
    console.error('ERRO: nenhum tile na origem.');
    await encerrar();
    process.exit(4);
  }
  // O tileset de raiz e a porta de entrada: sem ele o modelo nao abre.
  if (!inv.copias.includes('tileset.json')) {
    console.error('ERRO: a origem nao tem tileset.json na raiz.');
    await encerrar();
    process.exit(4);
  }

  // O EIXO PARA CIMA DO CONTEUDO SAI DO tileset.json DA ORIGEM, e tem de ser
  // lido AQUI: a conversao remove `asset.gltfUpAxis` (ele nunca existiu no
  // esquema de 1.1), e sem passar a informacao adiante o conteudo Z-up do DJI
  // Terra passa a ser lido como Y-up e o modelo aparece de pe.
  const upAxis = (() => {
    try {
      const j = JSON.parse(readFileSync(join(o.origem, 'tileset.json'), 'utf-8'));
      return ((j.asset && j.asset.gltfUpAxis) || 'Y').toUpperCase();
    } catch { return 'Y'; }
  })();
  log(`  eixo para cima do conteudo: ${upAxis}${upAxis === 'Z' ? ' (a conversao rotaciona a geometria)' : ''}`);

  // Container de cada tile, por amostragem: um .pnts ou .cmpt no meio nao passa
  // por este conversor e precisa ser tratado antes, nao descoberto no fim.
  const amostraContainers = new Set();
  for (const t of tiles.slice(0, 50)) {
    amostraContainers.add(tipoDeTile(readFileSync(join(o.origem, t)).subarray(0, 4)));
  }
  log(`  containers na amostra: ${[...amostraContainers].join(', ')}`);

  // O MOTOR TEM DE SAIR AQUI, e nao no fim: o teto de textura entra no
  // workerData, e o worker nasce antes do primeiro tile ser lido. A escala do
  // geometricError pode esperar, porque a reescrita acontece depois.
  // A MESMA LEITURA SERVE A DUAS PERGUNTAS: qual o motor, e ha extensao que esta
  // conversao nao sabe tratar. Ler duas vezes seria desperdicio.
  let motorAmostra = null;
  const naoSuportadas = new Set();
  for (const t of tiles.slice(0, 20)) {
    try {
      const tile = abrirTile(readFileSync(join(o.origem, t)));
      if (!tile || !tile.glb) continue;
      if (!motorAmostra) motorAmostra = leGerador(tile.glb);
      for (const e of extensoesNaoSuportadas(tile.glb)) naoSuportadas.add(e);
    } catch { /* tile ilegivel na amostra: tenta o proximo */ }
  }

  // RECUSA CEDO. Este roteiro decodifica o documento inteiro para aplicar KTX2 e
  // Draco, e um modelo de Gaussian splatting nao sobrevive a isso: os atributos
  // do splat se perdem, e o resultado e um modelo QUE ABRE e aparece errado, o
  // que e pior que um erro. Converter primeiro e descobrir depois custaria a
  // reconversao inteira, e a chance de ninguem notar.
  if (naoSuportadas.size) {
    console.error(`ERRO: os tiles declaram extensao que esta conversao nao trata:`);
    for (const e of naoSuportadas) console.error(`  ${e}`);
    console.error('Um modelo assim precisa de outro caminho: sirva a arvore como esta,');
    console.error('ou trate o formato antes de trazer para ca.');
    await encerrar();
    process.exit(4);
  }
  // `auto` consulta a tabela por motor e cai no PADRAO quando ela nao diz nada.
  // O padrao e 512 desde 2026-08-22: ver a razao medida em lib/tileset.js.
  const maxTextura = o.maxTextura === 'auto'
    ? (MAX_TEXTURA[motorAmostra] ?? MAX_TEXTURA_PADRAO)
    : Number(o.maxTextura);
  log(`  motor na amostra: ${motorAmostra || 'desconhecido'}`
    + `   teto de textura: ${maxTextura ? `${maxTextura} px` : 'nenhum'}`);
  for (const c of amostraContainers) {
    if (c !== 'b3dm' && c !== 'glb') {
      console.error(`ERRO: container "${c}" nao e convertido por este roteiro.`);
      await encerrar();
      process.exit(4);
    }
  }

  if (o.dryRun) {
    log('\n--dry-run: nada foi escrito.');
    await encerrar();
    return;
  }

  // O `ktx` se confere DEPOIS do inventario e ANTES de escrever qualquer coisa.
  //
  // Antes do inventario nao serve: o --dry-run e reconhecimento, nao converte
  // nada, e exigir o binario ali negava ao operador a unica leitura que ele pode
  // fazer sem ter instalado coisa alguma.
  //
  // Depois da conversao seria tarde: um binario ausente viraria "textura pulada"
  // em cada um dos milhares de tiles, e a corrida terminaria com o modelo
  // inteiro sem compressao de textura, sem um erro.
  const ktxVersao = await versaoKtx();

  passo('2. banco de destino');
  if (!existsSync(config.models3d.dbDir)) mkdirSync(config.models3d.dbDir, { recursive: true });
  // O `.parcial` e arquivo NOVO: ninguem o tem aberto, e por isso nao ha nada a fechar
  // aqui. Quem carrega a armadilha do Windows e a TROCA do arquivo publicado, no passo 6,
  // e ela mora em `lib3d/deposito.js`, que segura a janela do pool de leitura.
  for (const f of [temporario, `${temporario}-wal`, `${temporario}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
  const db = createModelDb(temporario);
  log(`  ${basename(temporario)}  page_size=${db.pragma('page_size', { simple: true })}  journal=${db.pragma('journal_mode', { simple: true })}`);

  const token = `${Date.now().toString(36)}`;
  const importId = await abrirImportacao(o.id, o.origem);

  passo(`3. conversao (${o.workers} workers, geometria=${o.geometria}, qlevel=${o.qlevel}, upAxis=${upAxis}, maxTextura=${maxTextura || 'nenhum'}, ${ktxVersao})`);
  const conv = await converteTiles({ raiz: o.origem, tiles, db, workers: o.workers, qlevel: o.qlevel, geometria: o.geometria, upAxis, maxTextura, log });
  const taxa = conv.convertidos / conv.segundos;
  log(`  ${conv.convertidos.toLocaleString('pt-BR')} tiles em ${conv.segundos.toFixed(1)} s (${taxa.toFixed(1)} tiles/s)`);
  log(`  texturas ${conv.texturas.toLocaleString('pt-BR')}   triangulos ${conv.triangulos.toLocaleString('pt-BR')}`);
  log(`  bytes ${(conv.bytesEntrada / 2 ** 20).toFixed(1)} -> ${(conv.bytesSaida / 2 ** 20).toFixed(1)} MiB  (razao ${(conv.bytesSaida / conv.bytesEntrada).toFixed(4)})`);
  if (conv.batchDescartadas) log(`  ATENCAO: ${conv.batchDescartadas} tiles tinham batch table com conteudo, que NAO foi preservada`);
  if (conv.falhasTextura) log(`  ATENCAO: ${conv.falhasTextura} texturas o codificador recusou`);
  for (const e of conv.erros.slice(0, 10)) log(`  ERRO: ${e}`);

  if (conv.erros.length) {
    await fecharComFalha(db, temporario, importId, o, conv, `conversao com ${conv.erros.length} erros`);
    return;
  }

  passo('4. reescrita dos tileset.json');
  // A ESCALA SAI DO MOTOR MEDIDO, e nao do nome da pasta. `auto` aplica o fator
  // que ESCALA_GE conhece para o gerador que a conversao leu do proprio glTF.
  const escalaGe = o.escalaGe === 'auto'
    ? (ESCALA_GE[conv.gerador] || 1)
    : Number(o.escalaGe);
  if (escalaGe !== 1) {
    log(`  geometricError sera escalado por ${escalaGe} (motor: ${conv.gerador || 'desconhecido'})`);
    log('  isso substitui o maximumScreenSpaceError 1 no config: ver docs/formato.md');
  }
  const inserir = db.prepare('INSERT OR REPLACE INTO media (key, content) VALUES (?, ?)');
  const gravarJson = db.transaction((linhas) => { for (const [k, v] of linhas) inserir.run(k, v); });
  const referenciadas = new Set();
  const linhasJson = [];
  let urisTrocadas = 0;
  let geEscalados = 0;
  let raizJson = null;
  // A ARVORE INTEIRA, e nao so a raiz: o envelope geodesico so fecha com os
  // tilesets externos, porque o `transform` que poe o box no lugar certo mora
  // neles. Ver `envelopeGeodesico` em lib/tileset.js.
  const arvore = new Map();

  for (const rel of inv.copias) {
    const bruto = readFileSync(join(o.origem, rel));
    if (!rel.toLowerCase().endsWith('.json')) {
      linhasJson.push([rel, bruto]);
      continue;
    }
    let json;
    try {
      json = JSON.parse(bruto.toString('utf-8'));
    } catch (err) {
      await fecharComFalha(db, temporario, importId, o, conv, `JSON invalido em ${rel}: ${err.message}`);
      return;
    }
    const r = reescreveTileset(json, token, { escalaGe });
    urisTrocadas += r.trocadas;
    geEscalados += r.escalados || 0;
    // As uris sao relativas AO PROPRIO tileset: um "Data/c00.glb" dentro de
    // "Data/d000/tileset.json" aponta "Data/d000/Data/c00.glb". Resolver contra
    // a raiz daria uma chave que nao existe, e a conferencia acusaria falso.
    const base = dirname(rel) === '.' ? '' : `${dirname(rel)}/`;
    for (const u of r.uris) referenciadas.add(normaliza(base + u));
    linhasJson.push([rel, Buffer.from(JSON.stringify(r.json), 'utf-8')]);
    arvore.set(normaliza(rel), r.json);
    if (rel === 'tileset.json') raizJson = r.json;
  }
  gravarJson(linhasJson);
  log(`  ${inv.copias.length} arquivos, ${urisTrocadas.toLocaleString('pt-BR')} uris de .b3dm para .glb, token ${token}`);
  if (escalaGe !== 1) log(`  ${geEscalados.toLocaleString('pt-BR')} geometricError escalados por ${escalaGe}`);

  passo('5. conferencia');
  const temChave = db.prepare('SELECT 1 FROM media WHERE key = ?');
  const totalMedia = db.prepare('SELECT COUNT(*) AS n FROM media').get().n;

  const faltando = [];
  for (const t of tiles) {
    const chave = t.replace(/\.b3dm$/i, '.glb');
    if (!temChave.get(chave)) faltando.push(chave);
  }
  const quebradas = [];
  for (const r of referenciadas) {
    if (!temChave.get(r)) quebradas.push(r);
  }
  log(`  entradas no banco ${totalMedia.toLocaleString('pt-BR')} (esperado ${(tiles.length + inv.copias.length).toLocaleString('pt-BR')})`);
  log(`  tiles ausentes ${faltando.length}   referencias quebradas ${quebradas.length}`);
  for (const f of faltando.slice(0, 5)) log(`    AUSENTE ${f}`);
  for (const q of quebradas.slice(0, 5)) log(`    QUEBRADA ${q}`);

  if (faltando.length || (quebradas.length && !o.limite)) {
    await fecharComFalha(db, temporario, importId, o, conv,
      `conferencia: ${faltando.length} ausentes, ${quebradas.length} referencias quebradas`);
    return;
  }

  passo('6. fecho do banco');
  // DUAS FONTES PARA O PONTO, e a segunda nao e luxo. O `pontoDeNavegacao` le
  // `properties` ou `boundingVolume.region`, e o DJI Terra nao publica nenhum
  // dos dois: ali ele devolve null e o ponto ia a mao no catalogo. Foi assim que
  // o Silo entrou 3,6 km ao sul do lugar dele. O envelope mede.
  const envelope = envelopeGeodesico(arvore);
  const declarado = raizJson ? pontoDeNavegacao(raizJson) : null;
  const ponto = declarado || (envelope
    ? { lon: envelope.lon, lat: envelope.lat, height: envelope.hChao }
    : null);
  // O CABECALHO GUARDA TUDO QUE O PASSO 7 PRECISA. Nao e redundancia com o
  // catalogo: e o que permite ao `--promover` e a ADOCAO registrarem depois, sem
  // repetir a conversao, quando a troca do arquivo falha (ver abaixo).
  const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  db.transaction(() => {
    meta.run('id', o.id);
    meta.run('name', o.nome || o.id);
    meta.run('tilesVersion', '1.1');
    meta.run('geometry', o.geometria);
    meta.run('escalaGe', String(escalaGe));
    meta.run('upAxisOrigem', upAxis);
    meta.run('texture', 'ktx2-etc1s');
    meta.run('textureQuality', String(o.qlevel));
    meta.run('buildToken', token);
    meta.run('builtAt', new Date().toISOString());
    meta.run('sourcePath', o.origem);
    meta.run('ktx', ktxVersao);
    meta.run('tileCount', String(tiles.length));
    meta.run('jsonCount', String(inv.copias.length));
    meta.run('sourceBytes', String(inv.bytes));
    meta.run('published', o.limite ? '0' : '1');
    if (ponto) {
      meta.run('lon', String(ponto.lon));
      meta.run('lat', String(ponto.lat));
      meta.run('height', String(ponto.height));
    }
    if (envelope) {
      meta.run('groundHeight', String(envelope.hChao));
      meta.run('minHeight', String(envelope.hMin));
    }
  })();
  finalizarModelDb(db);

  const bytesFinal = await trocaArquivo({ temporario, destino, dbFilename, importId, conv, log });
  log(`  ${dbFilename}  ${(bytesFinal / 2 ** 20).toFixed(1)} MiB  (origem ${(inv.bytes / 2 ** 20).toFixed(1)} MiB, razao ${(bytesFinal / inv.bytes).toFixed(4)})`);

  passo('7. catalogo');
  // AQUI NAO HA LISTA DE CAMPOS. O passo 6 gravou no cabecalho `meta` tudo que o registro
  // precisa, e quem le o cabecalho e a adocao, que e o MESMO caminho usado para registrar
  // um arquivo que ja estava em disco. Um passo 7 com lista propria e o defeito que custou
  // quatro modelos: ele fica para tras quando a lista muda, e a saida ainda diz "publicado".
  const registro = await adotarModelo(dbFilename, {
    accessLevel: o.accessLevel,
    orgId: o.orgId,
  });
  if (registro.acao === 'recusado') {
    await fecharImportacao({
      id: importId,
      status: 'falhou',
      tilesIn: tiles.length,
      tilesOut: conv.convertidos,
      textures: conv.texturas,
      failures: conv.falhasTextura,
      seconds: conv.segundos,
      ratio: bytesFinal / inv.bytes,
      notes: `arquivo publicado, catalogo RECUSADO: ${registro.motivo}`,
    });
    console.error(`
=== PARADO no passo 7: ${registro.motivo} ===`);
    console.error('O arquivo esta publicado em disco; conserte o cabecalho e rode:');
    console.error(`  npm run models3d:adotar -- --id ${o.id}`);
    await encerrar();
    process.exit(7);
  }
  log(`  ${registro.acao}: ${registro.id}`);
  await fecharImportacao({
    id: importId,
    status: 'ok',
    tilesIn: tiles.length,
    tilesOut: conv.convertidos,
    textures: conv.texturas,
    failures: conv.falhasTextura,
    seconds: conv.segundos,
    ratio: bytesFinal / inv.bytes,
    notes: null,
  });
  if (ponto) {
    log(`  navegacao lon=${ponto.lon.toFixed(6)} lat=${ponto.lat.toFixed(6)} h=${ponto.height.toFixed(1)} m`
      + `  (${declarado ? 'declarado no tileset' : 'medido pelo envelope'})`);
  } else {
    log('  ATENCAO: o tileset nao publica lon/lat e o envelope nao fechou; preencha a mao no catalogo');
  }
  if (envelope) {
    log(`  envelope: chao ${envelope.hChao.toFixed(1)} m elipsoidal`
      + ` (${envelope.hMin.toFixed(1)} a ${envelope.hMax.toFixed(1)}),`
      + ` raio ${Math.round(envelope.raio)} m, ${envelope.amostras.toLocaleString('pt-BR')} cantos`);
    log('  SEM TERRENO no cliente o modelo flutua essa altura: use heightOffset = -chao');
  }
  if (o.limite) log('  publicado=0 porque a importacao foi parcial (--limite)');

  log(`\n=== IMPORTADO: ${o.id} em ${(conv.segundos / 60).toFixed(1)} min ===`);
  log(`URL publicada no catalogo: ${config.assets3d.baseUrl}/m/${o.id}/tileset.json`);
  await encerrar();
}


/**
 * Termina uma importacao a partir do `.parcial` que ficou pronto.
 *
 * Nao reconverte nada: troca o arquivo e registra. E o conserto do caso EBUSY acima, e
 * por isso ele NAO refaz a validacao do cabecalho por conta propria: quem valida e a
 * adocao, no mesmo lugar em que valida um arquivo qualquer. Um `.parcial` gravado por uma
 * versao anterior do roteiro (sem `tileCount`) e RECUSADO ali, e a mensagem diz o que
 * falta em vez de gravar um catalogo com `tile_count = 0` num modelo de 7.501 tiles. Nao
 * e hipotese: aconteceu, e quem pegou foi a verificacao.
 *
 * @param {string} id
 * @param {{accessLevel?: string, orgId?: string}} opcoes
 * @returns {Promise<void>}
 */
async function promover(id, opcoes = {}) {
  const dbFilename = `${id}.3dtiles`;
  const destino = join(config.models3d.dbDir, dbFilename);
  const temporario = `${destino}.parcial`;
  if (!existsSync(temporario)) {
    console.error(`ERRO: nao ha ${dbFilename}.parcial para promover.`);
    process.exit(2);
  }

  const lido = new Database(temporario, { readonly: true });
  const entradas = lido.prepare('SELECT COUNT(*) AS n FROM media').get().n;
  const token = lido.prepare("SELECT value FROM meta WHERE key = 'buildToken'").get()?.value;
  lido.close();
  console.log(`promovendo ${dbFilename}: token ${token || 'AUSENTE'}, ${entradas.toLocaleString('pt-BR')} entradas`);

  try {
    await blobPool.withEvicted(destino, () => {
      for (const f of [destino, `${destino}-wal`, `${destino}-shm`]) {
        if (existsSync(f)) unlinkSync(f);
      }
      renameSync(temporario, destino);
    });
  } catch (err) {
    console.error(`ERRO: o arquivo publicado continua em uso (${err.code}). Pare o servico e tente de novo.`);
    await encerrar();
    process.exit(6);
  }

  const registro = await adotarModelo(dbFilename, opcoes);
  if (registro.acao === 'recusado') {
    console.error(`ERRO: ${registro.motivo}`);
    console.error('O arquivo esta publicado em disco, e o catalogo NAO foi escrito.');
    await encerrar();
    process.exit(7);
  }
  const bytesFinal = statSync(destino).size;
  console.log(`  ${dbFilename}  ${(bytesFinal / 2 ** 20).toFixed(1)} MiB  ${registro.acao}`);
  console.log(`URL publicada no catalogo: ${config.assets3d.baseUrl}/m/${registro.id}/tileset.json`);
  await encerrar();
}

/** Normaliza uma chave de media resolvendo "a/b/../c" para "a/c". */
function normaliza(chave) {
  const partes = [];
  for (const p of chave.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') { partes.pop(); continue; }
    partes.push(p);
  }
  return partes.join('/');
}

/** Fecha o pool do Postgres. O CLI termina o processo, e um pool aberto o segura. */
async function encerrar() {
  await Promise.resolve(pgp.end());
}

/** Encerra a importacao sem publicar nada, deixando o registro do porque. */
async function fecharComFalha(db, temporario, importId, o, conv, motivo) {
  console.error(`
=== PARADO: ${motivo} ===`);
  console.error('O arquivo parcial NAO virou modelo, e a origem nao foi tocada.');
  try { db.close(); } catch { /* ja fechado */ }
  await fecharImportacao({
    id: importId,
    status: 'falhou',
    tilesIn: conv ? conv.tentados : null,
    tilesOut: conv ? conv.convertidos : null,
    textures: conv ? conv.texturas : null,
    failures: conv ? conv.falhasTextura : null,
    seconds: conv ? conv.segundos : null,
    ratio: null,
    notes: motivo,
  });
  console.error(`Arquivo parcial em: ${temporario}`);
  await encerrar();
  process.exit(5);
}

main().catch(async (err) => {
  console.error('FALHA:', err.stack || err.message);
  await encerrar().catch(() => {});
  process.exit(1);
});
