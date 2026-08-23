#!/usr/bin/env node
// Path: scripts/models3d-importar-glb.js

/**
 * @module scripts/models3d-importar-glb
 * @description Importa um MODELO GLB SOLTO: um arquivo unico, sem arvore e sem
 * tileset.json.
 *
 * POR QUE UM ROTEIRO SEPARADO. O `importar.js` cuida de ARVORE: ele inventaria
 * milhares de tiles, reescreve tileset.json, escala geometricError, mede
 * envelope e confere referencia. Nada disso existe aqui, e enfiar os dois
 * caminhos num roteiro so faria cada `if` do fluxo carregar uma pergunta que
 * nao e do problema. O que os dois compartilham de verdade (a conversao, a
 * troca do arquivo publicado, o catalogo) esta em modulo comum.
 *
 * O QUE O ARQUIVO NAO SABE, E VOCE TEM DE DIZER. Um `.glb` comum traz
 * coordenada LOCAL, e nao georreferencia: sem `--lon` e `--lat` o Cesium o
 * planta no centro da Terra. Nao ha como medir isso do arquivo, entao o
 * roteiro RECUSA em vez de chutar um lugar.
 *
 * O CesiumJS carrega este tipo por `Model.fromGltfAsync`, e nao por
 * `Cesium3DTileset.fromUrl`. Quem decide e o campo `type: 'glb'` do catalogo.
 *
 * Uso:
 *   npm run models3d:importar-glb -- --origem <arquivo.glb ou pasta> --id <slug> \
 *     --lon -44.447668 --lat -22.454757 [--altura 50] [--heading 180] \
 *     [--pitch 0] [--roll 0] [--escala 1] [--nome "..."] [--dry-run]
 */

import { readFileSync, statSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import config from '../src/config.js';
import { pgp } from '../src/database/index.js';
import { createModelDb, finalizarModelDb } from '../src/modules/models3d/models3d.build.js';
import {
  abrirImportacao, fecharImportacao, obterModelo3d,
} from '../src/modules/models3d/models3d.import.service.js';
import { adotarModelo } from './models3d-adotar.js';
import { versaoKtx, QLEVEL_PADRAO } from './lib3d/ktx2.js';
import { criarConversor } from './lib3d/conversor.js';
import { abrirTile, leGerador, extensoesNaoSuportadas } from './lib3d/b3dm.js';
import { MAX_TEXTURA_PADRAO } from './lib3d/tileset.js';
import { trocaArquivo } from './lib3d/deposito.js';

/** Nome com que o GLB e servido, sempre o mesmo. */
const CHAVE = 'model.glb';

function args() {
  const a = process.argv.slice(2);
  const v = (n, p) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : p; };
  const num = (n, p) => { const x = v(n); return x == null ? p : Number(x); };
  return {
    origem: v('--origem'),
    id: v('--id'),
    nome: v('--nome'),
    lon: num('--lon', null),
    lat: num('--lat', null),
    altura: num('--altura', 0),
    heading: num('--heading', 0),
    pitch: num('--pitch', 0),
    roll: num('--roll', 0),
    escala: num('--escala', 1),
    qlevel: parseInt(v('--qlevel', String(QLEVEL_PADRAO)), 10),
    geometria: v('--geometria', 'draco'),
    accessLevel: v('--access-level'),
    orgId: v('--org'),
    maxTextura: parseInt(v('--max-textura', String(MAX_TEXTURA_PADRAO)), 10),
    forcar: a.includes('--forcar'),
    dryRun: a.includes('--dry-run'),
  };
}

/** Resolve o arquivo: aceita o .glb direto, ou a pasta que contem um so. */
function achaGlb(origem) {
  if (!existsSync(origem)) return { erro: `origem nao existe: ${origem}` };
  if (statSync(origem).isFile()) {
    return extname(origem).toLowerCase() === '.glb'
      ? { arquivo: origem }
      : { erro: `${basename(origem)} nao e .glb` };
  }
  const glbs = readdirSync(origem)
    .filter((f) => extname(f).toLowerCase() === '.glb')
    .map((f) => join(origem, f));
  if (glbs.length === 0) return { erro: `nenhum .glb em ${origem}` };
  // MAIS DE UM E AMBIGUO, e ambiguo nao se adivinha: escolher o maior, ou o
  // primeiro em ordem, seria decidir no lugar do operador sem ele saber.
  if (glbs.length > 1) {
    return { erro: `${glbs.length} arquivos .glb em ${origem}. Aponte um: ${glbs.map(basename).join(', ')}` };
  }
  return { arquivo: glbs[0] };
}

async function main() {
  const o = args();
  if (!o.origem || !o.id) {
    console.error('Uso: npm run models3d:importar-glb -- --origem <arquivo.glb|pasta> --id <slug>'
      + ' --lon <graus> --lat <graus> [--altura N] [--heading N] [--escala N]');
    process.exit(2);
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(o.id)) {
    console.error(`ERRO: --id "${o.id}" invalido. Use minusculas, digitos, hifen e sublinhado.`);
    process.exit(2);
  }

  // O PORTAO DO LUGAR VEM ANTES DA CONVERSAO. Converter para so entao descobrir
  // que ninguem sabe onde o modelo fica desperdicaria a corrida inteira, e
  // gravar um modelo sem posicao o poria no centro da Terra sem um erro.
  if (o.lon == null || o.lat == null || Number.isNaN(o.lon) || Number.isNaN(o.lat)) {
    console.error('ERRO: --lon e --lat sao obrigatorios.');
    console.error('Um .glb traz coordenada LOCAL, nao georreferencia: sem eles o');
    console.error('Cesium planta o modelo no centro da Terra. Nao ha como medir do arquivo.');
    process.exit(2);
  }
  if (Math.abs(o.lat) > 90 || Math.abs(o.lon) > 180) {
    console.error(`ERRO: lon=${o.lon} lat=${o.lat} fora do intervalo valido.`);
    process.exit(2);
  }

  const achado = achaGlb(o.origem);
  if (achado.erro) { console.error(`ERRO: ${achado.erro}`); process.exit(2); }

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

  passo('1. leitura do arquivo');
  const bruto = readFileSync(achado.arquivo);
  const bytesEntrada = bruto.length;
  log(`  ${basename(achado.arquivo)}  ${(bytesEntrada / 2 ** 20).toFixed(2)} MiB`);

  let envelope;
  try {
    envelope = abrirTile(bruto);
  } catch (err) {
    console.error(`ERRO: ${err.message}`);
    await encerrar();
    process.exit(4);
  }
  const gerador = leGerador(envelope.glb);
  const naoSuportadas = extensoesNaoSuportadas(envelope.glb);
  log(`  motor: ${gerador || 'desconhecido'}`);
  if (naoSuportadas.length) {
    console.error('ERRO: o arquivo declara extensao que esta conversao nao trata:');
    for (const e of naoSuportadas) console.error(`  ${e}`);
    await encerrar();
    process.exit(4);
  }
  log(`  onde plantar: lon ${o.lon} lat ${o.lat} altura ${o.altura} m`);
  log(`  orientacao: heading ${o.heading} pitch ${o.pitch} roll ${o.roll}   escala ${o.escala}`);

  const ktxVersao = await versaoKtx();

  if (o.dryRun) {
    log('\n--dry-run: nada foi escrito.');
    await encerrar();
    return;
  }

  passo('2. banco de destino');
  if (!existsSync(config.models3d.dbDir)) mkdirSync(config.models3d.dbDir, { recursive: true });
  // O `.parcial` e arquivo NOVO: nada a fechar aqui. A armadilha do Windows mora na TROCA
  // do arquivo publicado, e ela e do `lib3d/deposito.js`.
  for (const f of [temporario, `${temporario}-wal`, `${temporario}-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }
  const db = createModelDb(temporario);

  const token = `${Date.now().toString(36)}`;
  const importId = await abrirImportacao(o.id, achado.arquivo);

  passo(`3. conversao (geometria=${o.geometria}, qlevel=${o.qlevel}, ${ktxVersao})`);
  const t0 = Date.now();
  // upAxis fica em 'Y': um glb solto e Y-up por definicao do proprio glTF, e
  // nao ha `asset.gltfUpAxis` (isso e campo de tileset, e aqui nao ha tileset).
  const conversor = await criarConversor({
    geometria: o.geometria, upAxis: 'Y', maxTextura: o.maxTextura,
  });
  let r;
  try {
    r = await conversor.converte(bruto, o.qlevel);
  } finally {
    conversor.fecha();
  }
  const segundos = (Date.now() - t0) / 1000;
  log(`  ${(bytesEntrada / 2 ** 20).toFixed(2)} -> ${(r.glb.length / 2 ** 20).toFixed(2)} MiB`
    + `  (razao ${(r.glb.length / bytesEntrada).toFixed(4)})  em ${segundos.toFixed(1)} s`);
  log(`  texturas ${r.texturas}   triangulos ${(r.triangulos || 0).toLocaleString('pt-BR')}`);
  if (r.falhas) log(`  ATENCAO: ${r.falhas} texturas nao converteram`);

  db.prepare('INSERT OR REPLACE INTO media (key, content) VALUES (?, ?)').run(CHAVE, r.glb);

  passo('4. conferencia');
  const lido = db.prepare('SELECT content FROM media WHERE key = ?').get(CHAVE);
  // A CONFERENCIA COBRE A EXTENSAO DA ESCRITA, e aqui a escrita e um objeto so:
  // comparar o tamanho nao basta, entao ela releva o BLOB inteiro do destino e
  // o compara byte a byte com o que foi gravado.
  if (!lido || !lido.content.equals(r.glb)) {
    console.error('ERRO: o BLOB relido do banco nao bate com o convertido.');
    finalizarModelDb(db);
    await fecharImportacao({
      id: importId, status: 'falhou',
      tilesIn: 1, tilesOut: 0, textures: r.texturas, failures: r.falhas,
      seconds: segundos, ratio: null, notes: 'releitura do BLOB divergiu',
    });
    await encerrar();
    process.exit(5);
  }
  const total = db.prepare('SELECT COUNT(*) AS n FROM media').get().n;
  log(`  entradas no banco ${total} (esperado 1)   BLOB relido confere byte a byte`);

  passo('5. fecho do banco');
  const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  db.transaction(() => {
    meta.run('id', o.id);
    meta.run('name', o.nome || o.id);
    meta.run('modelType', 'glb');
    meta.run('geometry', o.geometria);
    meta.run('texture', 'ktx2-etc1s');
    meta.run('textureQuality', String(o.qlevel));
    meta.run('buildToken', token);
    meta.run('builtAt', new Date().toISOString());
    meta.run('sourcePath', achado.arquivo);
    meta.run('ktx', ktxVersao);
    // `tileCount` e `sourceBytes` sao o contrato do cabecalho, e o `adotar.js`
    // os exige: sem eles um `.3dtiles` em disco nao volta ao catalogo sem
    // reconverter. Aqui o modelo e UM objeto, e a contagem e 1.
    meta.run('tileCount', '1');
    meta.run('jsonCount', '0');
    meta.run('sourceBytes', String(bytesEntrada));
    meta.run('lon', String(o.lon));
    meta.run('lat', String(o.lat));
    meta.run('height', String(o.altura));
    meta.run('published', '1');
    meta.run('positionLon', String(o.lon));
    meta.run('positionLat', String(o.lat));
    // ORIENTACAO E ESCALA NO CABECALHO, e nao so no catalogo: e o cabecalho que a adocao
    // le para reconstruir a linha, entao um campo que so exista no catalogo se perde na
    // primeira readocao.
    meta.run('rotHeading', String(o.heading));
    meta.run('rotPitch', String(o.pitch));
    meta.run('rotRoll', String(o.roll));
    meta.run('scale', String(o.escala));
  })();
  finalizarModelDb(db);

  const bytesFinal = await trocaArquivo({
    temporario, destino, dbFilename, importId, log, roteiro: 'scripts/models3d-importar-glb.js',
    conv: { tentados: 1, convertidos: 1, texturas: r.texturas, falhasTextura: r.falhas, segundos },
  });
  log(`  ${dbFilename}  ${(bytesFinal / 2 ** 20).toFixed(2)} MiB`);

  passo('6. catalogo');
  // SEM LISTA DE CAMPOS AQUI: o passo 5 gravou no cabecalho tudo que a linha precisa, e
  // quem le o cabecalho e a adocao, o MESMO caminho de um arquivo que ja estava em disco.
  const registro = await adotarModelo(dbFilename, {
    accessLevel: o.accessLevel,
    orgId: o.orgId,
    forma3d: 'glb',
  });
  if (registro.acao === 'recusado') {
    await fecharImportacao({
      id: importId, status: 'falhou', tilesIn: 1, tilesOut: 1, textures: r.texturas,
      failures: r.falhas, seconds: segundos, ratio: bytesFinal / bytesEntrada,
      notes: `arquivo publicado, catalogo RECUSADO: ${registro.motivo}`,
    });
    console.error(`
=== PARADO no passo 6: ${registro.motivo} ===`);
    console.error(`O arquivo esta publicado. Conserte e rode: npm run models3d:adotar -- --id ${o.id}`);
    await encerrar();
    process.exit(7);
  }
  log(`  ${registro.acao}: ${registro.id}`);
  await fecharImportacao({
    id: importId,
    status: 'ok',
    tilesIn: 1,
    tilesOut: 1,
    textures: r.texturas,
    failures: r.falhas,
    seconds: segundos,
    ratio: bytesFinal / bytesEntrada,
    notes: null,
  });

  log(`
=== IMPORTADO: ${o.id} (glb) ===`);
  log(`URL publicada no catalogo: ${config.assets3d.baseUrl}/m/${o.id}/${CHAVE}`);
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
