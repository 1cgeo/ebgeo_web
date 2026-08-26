// Path: tests/bench/escrita-fanout.bench.mjs
//
// E5 — O CUSTO DE TER PLATEIA. Escritores fixos, numero de sockets ouvindo crescendo.
//
// Rode a mao:
//   node tests/bench/escrita-fanout.bench.mjs
//   node tests/bench/escrita-fanout.bench.mjs --escritores 8 --degraus 0,10,40 --lotes 20 --ops 20
//
// A SALA E POR ATLAS, NUNCA POR MAPA. O registro e literalmente `atlasId -> Set<WebSocket>`
// (`src/modules/collab/collab.rooms.js`), e nao existe subcanal por mapa. Toda op vai para toda
// a sala, e o filtro por mapa e do cliente. Consequencia: o custo de uma escrita cresce com o
// numero de pessoas conectadas AO ATLAS, mesmo que nenhuma delas esteja olhando aquele mapa.
// Esta bancada mantem a escrita constante e so aumenta a plateia.
//
// DUAS COLUNAS NOVAS, E ELAS SAO O CENARIO:
//   `entregaP95` — quanto tempo uma edicao leva para chegar no socket de um par, contado do
//     instante em que ela SAIU do autor, nao de quando o servidor a aplicou. E o numero que o
//     usuario sente.
//   `perdaEntrega` — ops commitadas que nunca chegaram a nenhum ouvinte. Frame de presenca e
//     descartavel por design num socket entupido, mas op duravel NAO e: o socket que passa do
//     teto e `terminate()`ado de proposito, para reconectar e recuperar por `sync_request`. Um
//     numero diferente de zero aqui e esperado quando houve terminate, e a leitura correta e
//     cruzar com `fechados`.
//
// O QUE ESTA BANCADA NAO PROVA. Sala e presenca vivem na memoria de UMA instancia, sem Redis e
// sem pub/sub. Todo numero daqui vale para um processo. Com mais de uma instancia atras de um
// balanceador sem sticky-session, dois usuarios do mesmo atlas simplesmente nao se veem, e
// nenhuma medida deste arquivo se estende a esse caso.

import { comBancada, medir, fechar, arg, argLista, aquecer } from './lib/bancada.mjs';
import { semearCenario, autenticar, novoAtlas, DSN_PADRAO } from './lib/semear.mjs';
import { escritorRest, abrirSocket, criarRegistro } from './lib/escritor.mjs';
import { Serie, round } from './lib/metricas.mjs';

const ESCRITORES = arg('escritores', 8);
const DEGRAUS = argLista('degraus', [0, 10, 40]);
const LOTES = arg('lotes', 20);
const OPS = arg('ops', 20);

/**
 * Opens one silent listener and records, per op id, when it first saw the op.
 *
 * The listener never writes and never answers. A `ping` reply is not needed: the server's
 * heartbeat tolerates the window this bench runs in, and answering would add outbound traffic
 * that the fan-out cost is supposed to be free of.
 */
async function abrirOuvinte({ base, atlasId, token, chegadas }) {
  const sock = await abrirSocket({ base, atlasId, token });
  let fechou = false;
  sock.ws.on('close', () => { fechou = true; });
  sock.ws.on('message', (bruto) => {
    let msg;
    try { msg = JSON.parse(bruto.toString()); } catch { return; }
    if (msg.type !== 'operations' && msg.type !== 'operation') return;
    const agora = performance.now();
    const ops = msg.ops ?? (msg.operation ? [msg.operation] : []);
    for (const op of ops) {
      if (op?.id && !chegadas.has(op.id)) chegadas.set(op.id, agora);
    }
  });
  return { sock, fechou: () => fechou };
}

await comBancada(
  {
    titulo: 'E5 — custo do fan-out: a sala e por atlas',
    extraCabecalho: {
      escritores: ESCRITORES,
      ouvintesPorDegrau: DEGRAUS.join(', '),
      lotes: LOTES,
      opsPorLote: OPS,
      escopo: 'uma instancia; sala e presenca sao memoria de processo',
    },
  },
  async (ctx) => {
    const maxOuvintes = Math.max(...DEGRAUS);
    const cenario = await semearCenario({
      dsn: DSN_PADRAO,
      escritores: ESCRITORES,
      leitores: maxOuvintes,
      atlas: 0,
    });
    const tokens = await autenticar(ctx.base, cenario.usuarios, cenario.senha);
    const tokensLeitura = await autenticar(ctx.base, cenario.espectadores, cenario.senha);

    const aquecimento = await novoAtlas({ cenario, nome: 'Aquecimento' });
    await aquecer({
      servidor: ctx.servidor,
      token: tokens[0].token,
      atlasId: aquecimento.id,
      mapId: aquecimento.mapas[0],
    });

    const resultados = [];
    const extras = [];

    for (const quantos of DEGRAUS) {
      const atlas = await novoAtlas({ cenario, nome: `${quantos} ouvintes` });
      const registro = criarRegistro();
      const serie = new Serie(`${quantos} ouvintes`);
      const enviadoEm = new Map();
      const chegadas = new Map();

      const ouvintes = [];
      for (let i = 0; i < quantos; i += 1) {
        ouvintes.push(
          await abrirOuvinte({
            base: ctx.base,
            atlasId: atlas.id,
            token: tokensLeitura[i].token,
            chegadas,
          })
        );
      }

      const tarefas = tokens.map(({ token }) => () =>
        escritorRest({
          base: ctx.base,
          token,
          atlasId: atlas.id,
          mapId: atlas.mapas[0],
          lotes: LOTES,
          opsPorLote: OPS,
          serie,
          registro,
          enviadoEm,
        })
      );

      const r = await medir({
        ctx,
        rotulo: `${quantos} ouvintes`,
        atlasIds: [atlas.id],
        registro,
        serie,
        tarefas,
      });

      // A janela de graca existe porque o fan-out e assincrono: a ultima op sai do servidor
      // depois que o ultimo POST ja respondeu, e fechar os sockets no mesmo instante contaria
      // como perda o que era so atraso.
      await new Promise((res) => setTimeout(res, 1500));

      const atrasos = [];
      for (const [opId, t0] of enviadoEm) {
        const t1 = chegadas.get(opId);
        if (t1 != null) atrasos.push(t1 - t0);
      }
      atrasos.sort((a, b) => a - b);
      const p = (q) => (atrasos.length ? round(atrasos[Math.floor((q / 100) * atrasos.length)]) : '-');
      const commitadas = [...registro.acked];
      const naoEntregues = quantos === 0
        ? 0
        : commitadas.filter((id) => !chegadas.has(id)).length;
      const fechados = ouvintes.filter((o) => o.fechou()).length;

      r.linha.entregaP50 = p(50);
      r.linha.entregaP95 = p(95);
      r.linha.perdaEntrega = naoEntregues;
      r.linha.fechados = fechados;
      resultados.push(r);
      extras.push(`${quantos} ouvintes: ${atrasos.length} entregas cronometradas, ${fechados} sockets fechados pelo servidor`);

      await Promise.allSettled(ouvintes.map((o) => o.sock.fechar()));
      console.log(`  ... degrau de ${quantos} ouvintes concluido`);
    }

    // As colunas de entrega so existem neste cenario, entao substituem as padrao.
    const COLUNAS_E5 = [
      'degrau', 'lotes', 'ok', '503', 'p50', 'p95', 'p99',
      'entregaP50', 'entregaP95', 'perdaEntrega', 'fechados',
      'lotes/s', 'ops/s', 'lacoP99', 'rssMB', 'provas',
    ];

    return fechar(resultados, [
      'A escrita e constante em todos os degraus. So a plateia muda.',
      'p95 do POST subindo com a plateia e o custo da serializacao do fan-out, pago pelo escritor.',
      'entregaP95 e o tempo do autor ate o par, e e o numero que o usuario sente.',
      'perdaEntrega diferente de zero pede olhar `fechados`: socket terminado por backpressure recupera por sync_request, nao por replay.',
      'Um processo, uma sala em memoria. Nada disto se estende a mais de uma instancia sem sticky-session.',
      ...extras,
    ], COLUNAS_E5);
  }
);
