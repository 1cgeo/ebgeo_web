// Path: tests/bench/imagens-orfas-gatilho.bench.mjs
//
// E11 — O CUSTO DO GATILHO QUE ZERA A MARCA DE IMAGEM ÓRFÃ (`zerar_marca_de_imagem_citada`,
// `src/database/migrations/017_imagens_orfas.sql`) nas duas escritas grandes do produto: o import
// de um atlas inteiro numa transação e o push de um lote cheio pelo sync.
//
// Rode a mao:
//   node tests/bench/imagens-orfas-gatilho.bench.mjs
//   node tests/bench/imagens-orfas-gatilho.bench.mjs --feicoes 5000 --ops 500 --repeticoes 5
//
// AS QUATRO CONDICOES. O gatilho tem dois regimes: sem imagem marcada ele sai na primeira linha,
// depois de uma consulta ao indice parcial vazio; com UMA imagem marcada em qualquer atlas do
// servidor, toda linha escrita nas doze tabelas-fonte serializa o proprio texto, procura UUIDs
// nele e abre uma subtransacao (o bloco EXCEPTION). `desligado` e a linha de base sem gatilho
// nenhum, para que o regime barato tenha um numero e nao um adjetivo. `marcas citadas` e o pior
// caso: CITADAS imagens marcadas, cada uma citada por uma feicao do import e do push, de modo que
// a zerada de cada uma ESCREVE dentro da subtransacao.
//
// A SONDA DE SUBTRANSACAO, e por que ela decide a leitura. Uma transacao com mais de 64
// subtransacoes transborda o cache de subtransacao do backend, e dai em diante os OUTROS processos
// que a veem em curso consultam `pg_subtrans` para decidir visibilidade. Mas o Postgres so da XID a
// subtransacao que ESCREVE, e so essas contam: a do gatilho que nao acha imagem citada nao escreve
// nada. A sonda amostra `pg_stat_get_backend_subxact` (Postgres 16 ou mais) em todos os backends do
// banco durante cada escrita e guarda o maior contador e se algum transbordou. O leitor pede o
// snapshot de OUTRO atlas no mesmo intervalo, e a coluna dele diz se o transbordo chega a quem nao
// tem nada com a escrita.
//
// Nao afirma tempo e nao reprova: imprime a tabela. Reprova so se uma escrita falhar, porque ai o
// numero mediria o erro.

import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { comBancada, arg } from './lib/bancada.mjs';
import { semearCenario, autenticar, novoAtlas } from './lib/semear.mjs';
import { criarLote } from './lib/escritor.mjs';

const FEICOES = arg('feicoes', 5000);
const OPS = arg('ops', 500);
const REPETICOES = arg('repeticoes', 5);
const CITADAS = arg('citadas', 100);

// As doze tabelas-fonte, lidas do banco e nao escritas aqui: o gatilho tem o mesmo nome em todas.
const TABELAS_DO_GATILHO = `
  SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE t.tgname = 'trg_zerar_marca_de_imagem_citada' ORDER BY 1`;

const DESCRICAO = 'Posição levantada em reconhecimento; '.repeat(16);

/** Uma feição de polígono com texto de tamanho realista (~1 KB de JSON). */
function feicao(i, layerId, citada = null) {
  const x = -43.2 + (i % 100) * 1e-3;
  const y = -22.9 + Math.floor(i / 100) * 1e-3;
  return {
    id: randomUUID(),
    feature_type: 'polygon',
    geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 5e-4, y], [x + 5e-4, y + 5e-4], [x, y + 5e-4], [x, y]]] },
    // O gatilho procura UUID em QUALQUER texto da linha, e e isso que a citacao usa.
    properties: { nome: `Área ${i}`, descricao: citada ? `${DESCRICAO} foto ${citada}` : DESCRICAO, color: '#ff0000', opacity: 0.4, visivel: true },
    layer_id: layerId,
  };
}

function corpoDoImport(nome, citadas = []) {
  const layerId = randomUUID();
  return {
    atlas: { name: nome },
    maps: [{
      id: randomUUID(), name: 'Mapa', base_layer: 'osm', center_lat: -22.9, center_long: -43.2, zoom: 12,
      layers: [{ id: layerId, name: 'Camada', visible: true, opacity: 1, sort_order: 0, style: {} }],
      features: Array.from({ length: FEICOES }, (_, i) => feicao(i, layerId, citadas[i] ?? null)),
    }],
    briefings: [],
  };
}

const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];

/** Pede o snapshot de `atlasId` em laço até `parar()`; devolve as latências em ms. */
function leitor({ base, token, atlasId }) {
  const amostras = [];
  let vivo = true;
  const laco = (async () => {
    while (vivo) {
      const t0 = performance.now();
      const r = await fetch(`${base}/api/v1/atlas/${atlasId}/sync/0`, { headers: { authorization: `Bearer ${token}` } });
      await r.arrayBuffer();
      if (r.status !== 200) throw new Error(`leitor: HTTP ${r.status}`);
      amostras.push(performance.now() - t0);
    }
  })();
  return { parar: async () => { vivo = false; await laco; return amostras; } };
}

/** Amostra o contador de subtransacoes de todos os backends do banco ate `parar()`. */
function sondaDeSubtransacao(dsn) {
  const c = new pg.Client({ connectionString: dsn });
  let vivo = true;
  let maior = 0;
  let transbordou = false;
  const laco = (async () => {
    await c.connect();
    while (vivo) {
      const { rows } = await c.query(
        `SELECT coalesce(max(s.subxact_count), 0) AS n, coalesce(bool_or(s.subxact_overflowed), false) AS ov
           FROM pg_stat_get_backend_idset() AS b(id)
           CROSS JOIN LATERAL pg_stat_get_backend_subxact(b.id) AS s
          WHERE pg_stat_get_backend_dbid(b.id) = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND pg_stat_get_backend_pid(b.id) <> pg_backend_pid()`);
      maior = Math.max(maior, Number(rows[0].n));
      transbordou ||= rows[0].ov;
      await new Promise((r) => setTimeout(r, 5));
    }
    await c.end();
  })();
  return { parar: async () => { vivo = false; await laco; return { maior, transbordou }; } };
}

await comBancada(
  {
    titulo: 'E11 — gatilho de imagem orfa nas escritas grandes',
    extraCabecalho: { feicoes: FEICOES, ops: OPS, repeticoes: REPETICOES },
  },
  async (ctx) => {
    const cenario = await semearCenario({ dsn: ctx.dsn, escritores: 1, atlas: 0 });
    const [{ token }] = await autenticar(ctx.base, cenario.usuarios, cenario.senha);
    const db = new pg.Client({ connectionString: ctx.dsn });
    await db.connect();

    try {
      const tabelas = (await db.query(TABELAS_DO_GATILHO)).rows.map((r) => r.relname);
      if (tabelas.length === 0) throw new Error('nenhuma tabela com o gatilho: a bancada mediria nada');

      // O atlas do leitor: as mesmas feicoes, importadas uma vez antes de tudo.
      const r0 = await fetch(`${ctx.base}/api/v1/atlas/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(corpoDoImport('Leitor')),
      });
      if (r0.status !== 201) throw new Error(`import do atlas do leitor: HTTP ${r0.status}`);
      const atlasDoLeitor = (await r0.json()).data.id;

      // A imagem que fica marcada na condicao `com marca`: de outro atlas, e citada por ninguem.
      const outro = await novoAtlas({ dsn: ctx.dsn, cenario, nome: 'Dono da imagem' });
      const imagens = Array.from({ length: CITADAS }, () => randomUUID());
      for (const id of imagens) {
        await db.query(
          `INSERT INTO images (id, atlas_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
           VALUES ($1, $2, 'orfa.png', 'image/png', 1, 'bench/orfa.png', $3)`,
          [id, outro.id, cenario.dono.id]);
      }
      const imagem = imagens[0];
      const ligar = async (sim) => {
        for (const t of tabelas) {
          await db.query(`ALTER TABLE ${t} ${sim ? 'ENABLE' : 'DISABLE'} TRIGGER trg_zerar_marca_de_imagem_citada`);
        }
      };
      const marcar = (ids) => db.query(
        `UPDATE images SET sem_referencia_desde = CASE WHEN id = ANY($1) THEN NOW() - interval '1 day' END
          WHERE atlas_id = $2`, [ids, outro.id]);

      // `preparar` roda antes de CADA repeticao, porque a condicao citada zera as proprias marcas.
      const condicoes = {
        desligado: { citadas: [], preparar: async () => { await ligar(false); await marcar([]); } },
        'sem marca': { citadas: [], preparar: async () => { await ligar(true); await marcar([]); } },
        'uma marca': { citadas: [], preparar: async () => { await ligar(true); await marcar([imagem]); } },
        'marcas citadas': { citadas: imagens, preparar: async () => { await ligar(true); await marcar(imagens); } },
      };

      const linhas = [];
      for (const [nome, { citadas, preparar }] of Object.entries(condicoes)) {
        const imports = [];
        const pushes = [];
        const leituras = [];
        const subx = { import: { maior: 0, transbordou: false }, push: { maior: 0, transbordou: false } };
        const somar = (k, r) => { subx[k].maior = Math.max(subx[k].maior, r.maior); subx[k].transbordou ||= r.transbordou; };
        for (let n = 0; n < REPETICOES; n += 1) {
          await preparar();
          // IMPORT: um atlas inteiro numa transacao.
          const corpo = JSON.stringify(corpoDoImport(`${nome} ${n}`, citadas));
          let l = leitor({ base: ctx.base, token, atlasId: atlasDoLeitor });
          let sonda = sondaDeSubtransacao(ctx.dsn);
          let t0 = performance.now();
          const ri = await fetch(`${ctx.base}/api/v1/atlas/import`, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: corpo,
          });
          imports.push(performance.now() - t0);
          somar('import', await sonda.parar());
          leituras.push(...await l.parar());
          if (ri.status !== 201) throw new Error(`import (${nome}): HTTP ${ri.status}`);
          await preparar();

          // PUSH: um lote cheio de criacoes pelo sync, num atlas novo.
          const alvo = await novoAtlas({ dsn: ctx.dsn, cenario, nome: `Push ${nome} ${n}` });
          const ops = criarLote({ mapId: alvo.mapas[0], clientId: randomUUID(), quantidade: OPS, lamport: 1 });
          citadas.slice(0, OPS).forEach((id, i) => { ops[i].data.properties.descricao = `foto ${id}`; });
          l = leitor({ base: ctx.base, token, atlasId: atlasDoLeitor });
          sonda = sondaDeSubtransacao(ctx.dsn);
          t0 = performance.now();
          const rp = await fetch(`${ctx.base}/api/v1/atlas/${alvo.id}/sync`, {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ operations: ops }),
          });
          pushes.push(performance.now() - t0);
          somar('push', await sonda.parar());
          leituras.push(...await l.parar());
          const rc = await rp.json().catch(() => null);
          const aceitas = (rc?.data?.results ?? []).filter((r) => r.success !== false).length;
          if (rp.status !== 200 || aceitas !== OPS) throw new Error(`push (${nome}): HTTP ${rp.status}, ${aceitas}/${OPS} aceitas`);
        }
        const { rows: [{ marcadas }] } = await db.query(
          'SELECT count(*)::int AS marcadas FROM images WHERE atlas_id = $1 AND sem_referencia_desde IS NOT NULL', [outro.id]);
        linhas.push({
          condicao: nome,
          [`import ${FEICOES} (ms, mediana)`]: Math.round(mediana(imports)),
          [`push ${OPS} (ms, mediana)`]: Math.round(mediana(pushes)),
          'leitor p50 (ms)': Math.round(mediana(leituras)),
          'leitor p95 (ms)': Math.round(p95(leituras)),
          'leituras': leituras.length,
          'subxact import (max)': `${subx.import.maior}${subx.import.transbordou ? ' TRANSBORDOU' : ''}`,
          'subxact push (max)': `${subx.push.maior}${subx.push.transbordou ? ' TRANSBORDOU' : ''}`,
          'marcadas ao fim': marcadas,
        });
      }
      console.table(linhas);
      console.log(`  tabelas com o gatilho: ${tabelas.length}`);
      return 0;
    } finally {
      await db.end().catch(() => {});
    }
  }
);
