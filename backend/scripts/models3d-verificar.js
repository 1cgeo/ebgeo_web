#!/usr/bin/env node
// Path: scripts/models3d-verificar.js

/**
 * @module scripts/models3d-verificar
 * @description Confere um modelo ja importado, do lado do banco.
 *
 * EXISTE PORQUE A CONFERENCIA DA IMPORTACAO NAO BASTA. Aquela roda com o banco
 * ainda aberto para escrita e com a lista da origem em maos. Esta abre o arquivo
 * publicado, do jeito que o servico abre, e faz as perguntas que importam depois:
 * o `tileset.json` esta la, toda `uri` que ele publica resolve, e os bytes que
 * saem sao mesmo glTF.
 *
 * Com --origem, compara tambem contra a arvore de origem, um a um.
 *
 * PORTADO do repositório `ebgeo_3d`, com o catálogo lido do Postgres. O valor dele é ser
 * um caminho INDEPENDENTE do que produziu o arquivo: a conferência da importação roda com
 * o banco ainda aberto e com a lista da origem em mãos, e uma checagem que compartilha o
 * estado de quem escreveu confirma a si mesma.
 *
 * Uso:
 *   npm run models3d:verificar -- --id <slug> [--origem <dir>] [--amostra 200]
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import Database from 'better-sqlite3';
import config from '../src/config.js';
import { pgp, query } from '../src/database/index.js';
import { obterModelo3d, ultimasImportacoes } from '../src/modules/models3d/models3d.import.service.js';
import { GET_SCENE_3D } from '../src/modules/models3d/models3d.queries.js';
import {
  medirCena, validarLayoutDeCena, caminhoLocalDaCena,
} from '../src/modules/models3d/models3d.scene.js';

function args() {
  const a = process.argv.slice(2);
  const v = (n, p) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : p; };
  return { id: v('--id'), origem: v('--origem'), amostra: parseInt(v('--amostra', '200'), 10) };
}

/** Resolve "Data/d000/" mais "Data/c00.glb" para "Data/d000/Data/c00.glb". */
function resolve(base, uri) {
  const partes = [];
  for (const p of `${base}${uri}`.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') { partes.pop(); continue; }
    partes.push(p);
  }
  return partes.join('/');
}

/**
 * Confere uma CENA instalada: o layout obrigatorio e a assinatura do manifesto.
 *
 * A ASSINATURA E A CONFERENCIA INTEIRA, e ela pega o que a contagem nao pega: arquivo
 * trocado, truncado, renomeado e A MAIS. Um `.3dtiles` carrega no proprio arquivo o
 * cabecalho que o identifica; uma pasta nao carrega nada, e sem este registro "a cena
 * esta inteira?" so teria resposta na hora da instalacao.
 *
 * @param {object} c - linha de `a3d.scenes` com o que o catalogo diz
 * @returns {Promise<number>} quantos pontos reprovaram
 */
async function verificaCena(c) {
  let falhas = 0;
  const reprova = (msg) => { console.log(`  REPROVA ${msg}`); falhas++; };

  console.log(`cena      ${c.scene_id}  (${c.name})`);
  console.log(`basePath  ${c.base_path}`);
  console.log(`registro  ${c.file_count} arquivos, ${(Number(c.total_bytes) / 2 ** 20).toFixed(1)} MiB`);
  console.log(`assinado  ${c.manifest_sha256.slice(0, 16)}...  (${c.imported_at})`);
  console.log(`publicado ${c.active ? 'sim' : 'NAO'}`);

  const raiz = caminhoLocalDaCena(c.base_path, config.assets3d);
  if (!raiz) {
    // NAO E REPROVACAO: o endereco publicado pode estar fora desta rota (o nginx serve o
    // mesmo diretorio por outro prefixo), e ai este processo nao sabe onde os bytes estao.
    console.log(`
  base_path fora de ${config.assets3d.baseUrl}: os bytes nao sao servidos por este processo,`);
    console.log('  e a conferencia local nao se aplica. Verifique no servidor que publica esse prefixo.');
    return falhas;
  }
  if (!existsSync(raiz)) {
    reprova(`a pasta nao esta em disco: ${raiz}`);
    return falhas;
  }

  console.log('\n1. o layout que o visualizador exige');
  const medida = await medirCena(raiz);
  const veredito = validarLayoutDeCena(medida.arquivos.map((a) => a.rel));
  if (!veredito.ok) reprova(veredito.motivo);
  else if (veredito.avisos.length) console.log(`   sem ${veredito.avisos.join(', ')} (o cartao fica pobre)`);
  console.log(`   ${medida.arquivos.length} arquivos, ${(medida.totalBytes / 2 ** 20).toFixed(1)} MiB`);

  console.log('\n2. a assinatura do manifesto');
  if (medida.sha256 !== c.manifest_sha256) {
    reprova('a pasta em disco NAO e a que foi registrada');
    const registradosFaltando = medida.arquivos.length !== c.file_count;
    if (registradosFaltando) {
      console.log(`   o registro diz ${c.file_count} arquivos e a pasta tem ${medida.arquivos.length}`);
    }
    console.log(`   registrado ${c.manifest_sha256.slice(0, 16)}...  medido ${medida.sha256.slice(0, 16)}...`);
  } else {
    console.log('   identica ao registro');
  }

  return falhas;
}

async function main() {
  const o = args();
  if (!o.id) {
    console.error('Uso: npm run models3d:verificar -- --id <slug> [--origem <dir>]');
    process.exit(2);
  }

  const m = await obterModelo3d(o.id);
  if (!m) {
    // O SERVICO 3D PUBLICA DUAS FORMAS, e a segunda nao e 3D Tiles: a cena caminhavel
    // (Gaussian splatting) mora numa PASTA e abre por outro visualizador. Verificar so a
    // primeira deixaria metade do acervo sem conferencia nenhuma depois da instalacao.
    const { rows } = await query(GET_SCENE_3D, [o.id]);
    if (rows.length) {
      const falhas = await verificaCena(rows[0]);
      await encerrar();
      console.log(`
=== ${falhas === 0 ? 'APROVADA' : `REPROVADA em ${falhas} pontos`} ===`);
      process.exit(falhas === 0 ? 0 : 1);
    }
    console.error(`ERRO: "${o.id}" nao e modelo nem cena registrada.`);
    await encerrar();
    process.exit(3);
  }

  const caminho = join(config.models3d.dbDir, m.db_filename);
  if (!existsSync(caminho)) {
    console.error(`ERRO: arquivo ausente: ${caminho}`);
    await encerrar();
    process.exit(3);
  }

  // `model_id` e nao `id`: a linha vem do JOIN de `a3d.models` com `tilesets`, e a chave
  // primaria de producao carrega o nome da coluna dela.
  console.log(`modelo    ${m.model_id}  (${m.name})`);
  console.log(`arquivo   ${m.db_filename}  ${(statSync(caminho).size / 2 ** 20).toFixed(1)} MiB`);
  console.log(`formato   ${m.tiles_version} / ${m.geometry_codec} / ${m.texture_codec} q${m.texture_quality}`);
  console.log(`token     ${m.build_token}  (${m.built_at})`);
  console.log(`publicado ${m.active ? 'sim' : 'NAO'}`);

  // Abre como o servico abre: somente leitura.
  const db = new Database(caminho, { readonly: true });
  db.pragma('query_only = true');
  const get = db.prepare('SELECT content FROM media WHERE key = ?');
  const tem = db.prepare('SELECT 1 FROM media WHERE key = ?');
  const total = db.prepare('SELECT COUNT(*) AS n FROM media').get().n;
  const glbs = db.prepare("SELECT COUNT(*) AS n FROM media WHERE key LIKE '%.glb'").get().n;
  const jsons = db.prepare("SELECT COUNT(*) AS n FROM media WHERE key LIKE '%.json'").get().n;

  let falhas = 0;
  const reprova = (msg) => { console.log(`  REPROVA ${msg}`); falhas++; };

  console.log(`\nentradas  ${total.toLocaleString('pt-BR')}  (glb ${glbs.toLocaleString('pt-BR')}, json ${jsons})`);
  if (glbs !== m.tile_count) reprova(`o catalogo diz ${m.tile_count} tiles e o banco tem ${glbs}`);

  console.log('\n1. a porta de entrada');
  const raiz = get.get('tileset.json');
  if (!raiz) reprova('sem tileset.json na raiz');
  else {
    const j = JSON.parse(raiz.content.toString('utf-8'));
    console.log(`   asset.version = ${j.asset && j.asset.version}`);
    if (!j.asset || j.asset.version !== '1.1') reprova('asset.version nao e 1.1');
    if (j.asset && 'gltfUpAxis' in j.asset) reprova('gltfUpAxis sobreviveu a conversao');
  }

  console.log('\n2. toda uri publicada resolve');
  let quebradas = 0; let semToken = 0; let uris = 0;
  const todosJson = db.prepare("SELECT key, content FROM media WHERE key LIKE '%.json'").all();
  for (const linha of todosJson) {
    const base = dirname(linha.key) === '.' ? '' : `${dirname(linha.key)}/`;
    let j;
    try { j = JSON.parse(linha.content.toString('utf-8')); } catch { reprova(`JSON invalido: ${linha.key}`); continue; }
    const visita = (t) => {
      if (!t || typeof t !== 'object') return;
      const c = [];
      if (t.content) c.push(t.content);
      if (Array.isArray(t.contents)) c.push(...t.contents);
      for (const x of c) {
        if (!x || typeof x.uri !== 'string') continue;
        if (/^[a-z][a-z0-9+.-]*:/i.test(x.uri)) continue;
        uris++;
        if (!x.uri.includes('?v=')) semToken++;
        if (!tem.get(resolve(base, x.uri.split('?')[0]))) {
          if (quebradas < 5) console.log(`   QUEBRADA ${linha.key} -> ${x.uri}`);
          quebradas++;
        }
      }
      if (Array.isArray(t.children)) t.children.forEach(visita);
    };
    visita(j.root);
  }
  console.log(`   ${uris.toLocaleString('pt-BR')} uris, ${quebradas} quebradas, ${semToken} sem token`);
  if (quebradas) reprova(`${quebradas} referencias quebradas`);
  if (semToken) reprova(`${semToken} uris sem ?v=, o immutable de um ano fica sem rede`);

  console.log('\n3. os bytes sao glTF, e trazem o que a conversao prometeu');
  // A REGUA CONTA SO O QUE TEM O QUE COMPRIMIR. O acervo tem tile VAZIO, sem
  // malha e sem imagem: no Ponte_Quatis sao 5 em 7.501, e eles ja vinham assim
  // da origem. Exigir Draco de um arquivo sem geometria reprovaria uma conversao
  // correta, e um alarme que dispara sem defeito treina a gente a ignora-lo.
  const chaves = db.prepare("SELECT key FROM media WHERE key LIKE '%.glb' ORDER BY key").all().map((r) => r.key);
  const passo = Math.max(1, Math.floor(chaves.length / o.amostra));
  let lidos = 0; let ruins = 0; let vazios = 0;
  let comMalha = 0; let comDraco = 0;
  let comImagem = 0; let comKtx = 0;
  for (let i = 0; i < chaves.length; i += passo) {
    const d = get.get(chaves[i]).content;
    lidos++;
    if (d.subarray(0, 4).toString('ascii') !== 'glTF') { ruins++; continue; }
    const n = d.readUInt32LE(12);
    let j;
    try { j = JSON.parse(d.subarray(20, 20 + n).toString('utf-8')); } catch { ruins++; continue; }
    const ext = j.extensionsUsed || [];
    const malhas = (j.meshes || []).length;
    const imagens = (j.images || []).length;
    if (malhas === 0 && imagens === 0) { vazios++; continue; }
    if (malhas) {
      comMalha++;
      if (ext.includes('KHR_draco_mesh_compression')) comDraco++;
    }
    if (imagens) {
      comImagem++;
      if (ext.includes('KHR_texture_basisu')
        && j.images.every((im) => im.mimeType === 'image/ktx2')) comKtx++;
    }
  }
  console.log(`   amostra ${lidos}: ${ruins} nao abrem, ${vazios} vazios (sem malha e sem imagem)`);
  console.log(`   com malha  ${comMalha}, destes ${comDraco} com Draco`);
  console.log(`   com imagem ${comImagem}, destes ${comKtx} com KTX2`);
  if (ruins) reprova(`${ruins} tiles da amostra nao abrem como glTF`);
  if (comDraco < comMalha) reprova(`${comMalha - comDraco} tiles com malha e sem Draco`);
  if (comKtx < comImagem) reprova(`${comImagem - comKtx} tiles com imagem e sem KTX2`);

  if (o.origem) {
    console.log('\n4. contra a arvore de origem');
    const naOrigem = [];
    (function anda(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { anda(p); continue; }
        const ext = extname(e.name).toLowerCase();
        if (ext === '.b3dm' || ext === '.glb') {
          naOrigem.push(relative(o.origem, p).replace(/\\/g, '/').replace(/\.b3dm$/i, '.glb'));
        }
      }
    })(o.origem);
    const faltam = naOrigem.filter((k) => !tem.get(k));
    console.log(`   origem ${naOrigem.length.toLocaleString('pt-BR')} tiles, faltam ${faltam.length}`);
    for (const f of faltam.slice(0, 5)) console.log(`   AUSENTE ${f}`);
    if (faltam.length) reprova(`${faltam.length} tiles da origem nao entraram`);
  }

  // O HISTORICO DE IMPORTACAO responde a pergunta que o arquivo sozinho nao responde:
  // este modelo veio de uma rodada que TERMINOU? `a3d.imports` e escrita em duas etapas
  // (abre ao comecar, fecha ao terminar), entao uma linha que ficou em `rodando` e uma
  // importacao interrompida, e o arquivo publicado pode ser o da tentativa anterior. Ate
  // 2026-08-23 a tabela era escrita a cada importacao e NENHUM codigo a lia, que e o
  // mesmo defeito de `active_sessions`: dado gravado que ninguem consulta nao e registro,
  // e peso morto que envelhece sem ninguem notar.
  console.log('\n5. historico de importacao');
  try {
    const historico = await ultimasImportacoes(o.id, 3);
    if (!historico.length) {
      console.log('   (sem registro: modelo adotado de arquivo pronto, sem rodada aqui)');
    }
    for (const h of historico) {
      const fim = h.finished_at ? new Date(h.finished_at).toISOString() : 'em aberto';
      console.log(`   ${String(h.status).padEnd(10)} ${new Date(h.started_at).toISOString()} -> ${fim}`);
      if (h.status === 'rodando') {
        reprova('a ultima importacao nao fechou: o arquivo pode ser de uma rodada anterior');
      }
    }
  } catch (err) {
    // Sem registro legivel a conferencia nao pode dizer que passou neste ponto.
    reprova(`historico de importacao ilegivel: ${err.message}`);
  }

  db.close();
  await encerrar();
  console.log(`\n=== ${falhas === 0 ? 'APROVADO' : `REPROVADO em ${falhas} pontos`} ===`);
  process.exit(falhas === 0 ? 0 : 1);
}

/** Fecha o pool do Postgres: o CLI termina o processo, e um pool aberto o segura. */
async function encerrar() {
  await Promise.resolve(pgp.end());
}

main().catch(async (err) => {
  console.error('FALHA:', err.stack || err.message);
  await encerrar().catch(() => {});
  process.exit(1);
});
