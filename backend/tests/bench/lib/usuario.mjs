// Path: tests/bench/lib/usuario.mjs
//
// THE VIRTUAL HUMAN: one collab socket behaving like a person editing a map.
//
// EVERY CADENCE NUMBER HERE COMES FROM THE CLIENT, NOT FROM IMAGINATION. Inventing a load shape
// would produce a bench that measures the shape instead of the server:
//   - `CURSOR_THROTTLE_MS = 80` (`frontend/src/js/presence/presence-bridge.js`) — a user whose
//     mouse is moving emits 12.5 cursor frames per second, and nothing throttles that further.
//   - `batchIntervalMs` 250 / 500 / 1500 / 3000 by connection quality
//     (`src/modules/collab/collab.quality.js`) — 500 ms is the default band, so an editing user
//     flushes its outbound queue twice a second.
//   - The heartbeat sweep runs every 30 s (`WS_HEARTBEAT_INTERVAL_MS`) and TERMINATES any socket
//     whose `isAlive` is false. There is NO `on('pong')` listener in the gateway: the only thing
//     that re-arms the flag is an application-level `{type:'ping'}` from the client
//     (`handlePing`). A virtual user that goes quiet is therefore reaped after at most 60 s, and
//     the population test would silently decay into a reconnect storm instead of measuring load.
//     Every user pings, editing or idle. This is the single most load-bearing line in the file.
//
// WHY PRESENCE IS THE POINT AND NOT A GARNISH. In a hundred-person room, fifty moving cursors
// are 625 inbound frames per second, each relayed to 99 sockets: about 62 thousand outbound
// frames per second from ONE room, against roughly a hundred operation flushes per second in the
// same room. A write-only population test would report a comfortable green while missing two
// orders of magnitude of the real traffic.
//
// WHAT CANNOT BE MEASURED HERE, STATED SO NOBODY LOOKS FOR IT. Cursor frames carry no id, and
// the gateway relays only the NORMALIZED value (`collab.schemas.js` says so, and the reason is
// that the raw payload is retained on the socket and replayed into later joins). So there is no
// way to stamp a frame and time its delivery. What IS measurable: frames sent, frames received,
// and therefore the DROP RATE — which is the number that matters, because presence is droppable
// by design on a congested socket. Operation delivery lag is measured exactly, by op id.

import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { Histograma } from './metricas.mjs';

/** Uniform jitter in [min, max]. */
const entre = (min, max) => min + Math.random() * (max - min);

/**
 * Off-duration that yields the requested duty cycle for a given mean on-duration.
 *
 * A duty cycle is not a coin flip per tick: a person edits in bursts and then reads for a while.
 * Modelling it as an alternating renewal process keeps the burstiness that makes a room spike,
 * which a per-tick probability would average away.
 */
function ocioParaFracao(mediaAtivaS, fracao) {
  if (fracao <= 0) return Infinity;
  if (fracao >= 1) return 0;
  return (mediaAtivaS * (1 - fracao)) / fracao;
}

export const CADENCIAS = {
  reuniao: {
    nome: 'reuniao',
    fracaoEditando: 0.05,
    fracaoCursor: 0.20,
    opsPorLote: [1, 2],
    rajadaEdicaoS: [8, 20],
    rajadaCursorS: [3, 8],
  },
  trabalho: {
    nome: 'trabalho',
    fracaoEditando: 0.15,
    fracaoCursor: 0.50,
    opsPorLote: [1, 3],
    rajadaEdicaoS: [10, 30],
    rajadaCursorS: [4, 12],
  },
  exercicio: {
    nome: 'exercicio',
    fracaoEditando: 0.40,
    fracaoCursor: 0.80,
    opsPorLote: [2, 4],
    rajadaEdicaoS: [15, 45],
    rajadaCursorS: [5, 20],
  },
};

const INTERVALO_LOTE_MS = 500; // banda padrão de collab.quality.js
const INTERVALO_CURSOR_MS = 80; // CURSOR_THROTTLE_MS do presence-bridge.js
const INTERVALO_PING_MS = 12_000; // bem abaixo dos 30 s da varredura

/**
 * Creates one virtual user. Nothing happens until `iniciar()`.
 *
 * @param {Object} opts
 * @param {string} opts.base - http://host:port
 * @param {string} opts.atlasId
 * @param {string} opts.mapId
 * @param {string} opts.token
 * @param {Object} opts.cadencia - One of CADENCIAS.
 * @param {boolean} [opts.observador] - Records arrival time of every op it receives. One per room
 *   is enough, and recording it on all of them would cost more than the load itself.
 * @param {number} opts.tamanhoSala - Room size, carried into the result so the report can break
 *   every metric down by room instead of averaging the interesting room away.
 */
export function criarUsuario({
  base, atlasId, mapId, token, cadencia, observador = false, tamanhoSala,
}) {
  const clientId = randomUUID();
  const estado = {
    clientId,
    atlasId,
    tamanhoSala,
    observador,
    // [opId, tsEnvio] — o observador de outro processo casa por opId, e o relógio de parede é
    // comparável entre processos da mesma máquina.
    opsEnviadas: [],
    ackHist: new Histograma('ack'),
    acks: 0,
    recusadas: 0,
    erros: 0,
    mudos: 0,
    cursoresEnviados: 0,
    cursoresRecebidos: 0,
    opsRecebidas: 0,
    // Só o observador preenche: [opId, tsChegada].
    chegadas: [],
    reconexoes: 0,
    fechadoPeloServidor: false,
    // O CODIGO DO FECHAMENTO, e ele decide um diagnostico inteiro. O gateway fecha socket por
    // SETE caminhos diferentes, e so um deles e a falha de autorizacao (`4003 authorization
    // unverifiable`). A varredura de heartbeat usa `terminate()`, que chega ao cliente como
    // 1006. Contar "derrubados" sem o codigo nao distingue "o banco nao respondeu" de "o
    // servidor nao processou meu ping a tempo", e as duas pedem consertos opostos.
    fechamentos: [],
    // EM VOO NO CORTE não é o mesmo que SEM VEREDITO, e juntar os dois quebrou a reconciliação da
    // primeira rodada de mil usuários: toda sala saiu FALHA porque as ops que ainda esperavam ack
    // quando a janela fechou foram contadas como perdidas, enquanto `ausentesDoLedger` dava ZERO —
    // ou seja, elas tinham sido gravadas normalmente. Uma é defeito, a outra é a borda da janela.
    emVooNoFim: 0,
  };

  let ws = null;
  let vivo = false;
  const timers = new Set();
  const emVoo = new Map(); // opId -> tsEnvio, para casar o ack_batch

  const agendar = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); if (vivo) fn(); }, ms);
    timers.add(t);
    return t;
  };

  function conectar() {
    return new Promise((resolve, reject) => {
      const url = `${base.replace(/^http/, 'ws')}/api/v1/collab`
        + `?atlasId=${atlasId}&token=${encodeURIComponent(token)}&clientId=${clientId}`;
      const sock = new WebSocket(url);
      sock.on('open', () => resolve(sock));
      sock.on('error', reject);
    });
  }

  function aoReceber(bruto) {
    let msg;
    try { msg = JSON.parse(bruto.toString()); } catch { return; }

    if (msg.type === 'ack_batch') {
      const agora = Date.now();
      for (const r of msg.results ?? []) {
        const t0 = emVoo.get(r.operationId);
        if (t0 != null) {
          estado.ackHist.registrar(agora - t0);
          emVoo.delete(r.operationId);
        }
        if (r.success === false) estado.recusadas += 1;
        else estado.acks += 1;
      }
      return;
    }

    if (msg.type === 'error') {
      estado.erros += 1;
      // Desde que o frame carrega `opIds`, a falha e ATRIBUIVEL: so as ops nomeadas saem de voo.
      // O que sobrar continua em voo e sera resolvido pelo ack seguinte ou pelo corte da janela.
      // Sem os ids, o frame derrubava a fila inteira para "sem veredito", que era o defeito.
      const nomeadas = Array.isArray(msg.opIds) ? msg.opIds : null;
      if (nomeadas) {
        for (const opId of nomeadas) {
          if (emVoo.delete(opId)) estado.recusadas += 1;
        }
      } else {
        estado.mudos += emVoo.size;
        emVoo.clear();
      }
      return;
    }

    if (msg.type === 'operations' || msg.type === 'operation') {
      const ops = msg.ops ?? (msg.operation ? [msg.operation] : []);
      estado.opsRecebidas += ops.length;
      if (observador) {
        const agora = Date.now();
        for (const op of ops) if (op?.id) estado.chegadas.push([op.id, agora]);
      }
      return;
    }

    if (msg.type === 'cursor') estado.cursoresRecebidos += 1;
  }

  // --- os três laços independentes -------------------------------------------------------------

  function lacoPing() {
    if (!vivo) return;
    enviar({ type: 'ping' });
    agendar(lacoPing, INTERVALO_PING_MS * entre(0.8, 1.2));
  }

  function lacoEdicao(editando, primeiraVez = false) {
    if (!vivo) return;
    if (editando) {
      descarregar();
      agendar(() => lacoEdicao(true), INTERVALO_LOTE_MS);
      return;
    }
    // FASE INICIAL SORTEADA, e isso não é detalhe. Fazer todo mundo esperar um ócio INTEIRO antes
    // da primeira rajada deixa o começo da janela sem escrita nenhuma: na cadência de trabalho o
    // ócio médio é de quase dois minutos, então uma janela de dois minutos mediria uma população
    // que ainda não começou a trabalhar. Medido: um piloto de 20 s registrou ZERO ops. Pessoas
    // reais chegam em fase aleatória, e é isso que a primeira espera reproduz.
    const duracaoS = entre(...cadencia.rajadaEdicaoS);
    const ocioCheioMs = ocioParaFracao(
      (cadencia.rajadaEdicaoS[0] + cadencia.rajadaEdicaoS[1]) / 2,
      cadencia.fracaoEditando
    ) * 1000;
    const espera = primeiraVez ? ocioCheioMs * Math.random() : ocioCheioMs * entre(0.5, 1.5);
    agendar(() => {
      const fim = Date.now() + duracaoS * 1000;
      const bater = () => {
        if (!vivo) return;
        if (Date.now() >= fim) { lacoEdicao(false); return; }
        descarregar();
        agendar(bater, INTERVALO_LOTE_MS);
      };
      bater();
    }, espera);
  }

  function lacoCursor(primeiraVez = false) {
    if (!vivo) return;
    const duracaoS = entre(...cadencia.rajadaCursorS);
    const ocioCheioMs = ocioParaFracao(
      (cadencia.rajadaCursorS[0] + cadencia.rajadaCursorS[1]) / 2,
      cadencia.fracaoCursor
    ) * 1000;
    const espera = primeiraVez ? ocioCheioMs * Math.random() : ocioCheioMs * entre(0.5, 1.5);
    agendar(() => {
      const fim = Date.now() + duracaoS * 1000;
      const bater = () => {
        if (!vivo) return;
        if (Date.now() >= fim) { lacoCursor(); return; }
        enviar({
          type: 'cursor',
          position: { lng: -43.2 + Math.random() * 0.1, lat: -22.9 + Math.random() * 0.1 },
          mapId,
        });
        estado.cursoresEnviados += 1;
        agendar(bater, INTERVALO_CURSOR_MS);
      };
      bater();
    }, espera);
  }

  function descarregar() {
    const quantas = Math.round(entre(...cadencia.opsPorLote));
    const agora = Date.now();
    const ops = [];
    for (let i = 0; i < quantas; i += 1) {
      const entityId = randomUUID();
      const opId = randomUUID();
      ops.push({
        id: opId,
        entityType: 'feature',
        operationType: 'create',
        entityId,
        mapId,
        data: {
          id: entityId,
          feature_type: 'point',
          geometry: { type: 'Point', coordinates: [-43.2 + Math.random(), -22.9 + Math.random()] },
          properties: { nome: 'Ponto de carga', descricao: clientId, visivel: true },
        },
        timestamp: agora,
        clientId,
      });
      estado.opsEnviadas.push([opId, agora]);
      emVoo.set(opId, agora);
    }
    enviar({ type: 'operations', ops });
  }

  function enviar(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  return {
    estado,

    async iniciar() {
      ws = await conectar();
      vivo = true;
      ws.on('message', aoReceber);
      ws.on('close', (codigo, motivo) => {
        if (!vivo) return;
        estado.fechadoPeloServidor = true;
        estado.fechamentos.push(`${codigo}${motivo ? ` ${String(motivo).slice(0, 40)}` : ''}`);
      });
      // Desencontro inicial: mil usuários começando a editar no mesmo milissegundo produziriam
      // um pico sintético que nenhuma sala real vê.
      agendar(lacoPing, entre(0, INTERVALO_PING_MS));
      agendar(() => lacoEdicao(false, true), entre(0, 3000));
      agendar(() => lacoCursor(true), entre(0, 3000));
    },

    /**
     * Throws away everything recorded so far, keeping the socket and the loops running.
     *
     * THE RAMP IS NOT THE MEASUREMENT. A thousand upgrades each cost a JWT verify plus a
     * permission resolve against a pool of ten, so the first seconds are a connection storm whose
     * latency has nothing to do with steady state. The worker calls this once every user is
     * connected, and only what comes after is reported.
     */
    zerar() {
      estado.opsEnviadas.length = 0;
      estado.chegadas.length = 0;
      estado.ackHist = new Histograma('ack');
      estado.acks = 0;
      estado.recusadas = 0;
      estado.erros = 0;
      estado.mudos = 0;
      estado.cursoresEnviados = 0;
      estado.cursoresRecebidos = 0;
      estado.opsRecebidas = 0;
      estado.emVooNoFim = 0;
      estado.fechamentos.length = 0;
      emVoo.clear();
    },

    parar() {
      vivo = false;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      estado.emVooNoFim = emVoo.size;
      try { ws?.close(); } catch { /* socket já foi */ }
      return estado;
    },
  };
}
