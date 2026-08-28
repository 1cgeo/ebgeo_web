// Path: tests/bench/lib/trabalhador.mjs
//
// ONE DRIVER PROCESS. Owns a slice of the virtual population and reports what it saw.
//
// WHY THE POPULATION TEST NEEDS SEVERAL OF THESE. A thousand sockets, twelve thousand cursor
// frames per second and half a million timestamped operations do not fit in one Node event loop
// without the driver becoming the thing being measured. Every earlier bench in this folder could
// stay single-process because its load was request-shaped and bounded; this one is frame-shaped
// and continuous. Splitting the drivers is the same move that split the server from the driver in
// `servidor.mjs`, applied one level further out.
//
// THE CONTRACT IS TWO FILES, NOT A SOCKET. The coordinator writes a spec, this process writes a
// result, and nothing streams between them while the run is in flight. An IPC channel would put
// the coordinator's event loop inside the measurement window, which is exactly what we are paying
// several processes to avoid.
//
// Usage (the coordinator does this for you):
//   node tests/bench/lib/trabalhador.mjs <caminho-do-spec.json>

import fs from 'fs';
import { monitorEventLoopDelay } from 'perf_hooks';
import { criarUsuario } from './usuario.mjs';

// ---------------------------------------------------------------------------------------------
// A SAUDE DO PROPRIO DRIVER, e ela nasceu de uma rodada que mentiu.
//
// A primeira rodada de mil usuarios imprimiu `ackP95` de 41 SEGUNDOS, derrubou 191 sockets e
// acusou dezenas de milhares de ops perdidas. O laco de eventos do SERVIDOR, medido pela sonda de
// dentro dele, marcava p99 de 16 ms e maximo de 32 ms. Os dois numeros nao podem ser verdade
// sobre o mesmo processo: quem estava travando eram estes trabalhadores, com 167 sockets cada e
// milhares de quadros por segundo para desserializar. A bancada nao tinha como saber, porque
// media o laco do sujeito e nao o laco do instrumento.
//
// Uma checagem que nao pode reprovar nao e checagem. Este histograma e o que permite a rodada
// dizer "instrumento saturado" em vez de imprimir numeros com cara de resultado.
// ---------------------------------------------------------------------------------------------
const laco = monitorEventLoopDelay({ resolution: 10 });
laco.enable();

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const { base, cadencia, usuarios, rampaMs, duracaoMs, saida, saidaOps, saidaChegadas } = spec;

const criados = [];
const falhasDeConexao = [];

// --- rampa -------------------------------------------------------------------------------------
// Escalonada de propósito, e o passo sai da própria rampa: abrir os N sockets desta fatia de uma
// vez transformaria o handshake (JWT + resolução de permissão, uma consulta cada) numa tempestade
// que nada tem a ver com regime permanente.
const passoMs = usuarios.length > 0 ? Math.max(1, Math.floor(rampaMs / usuarios.length)) : 0;
const t0Conexao = Date.now();

for (const u of usuarios) {
  const usuario = criarUsuario({
    base,
    atlasId: u.atlasId,
    mapId: u.mapId,
    token: u.token,
    cadencia,
    observador: u.observador === true,
    tamanhoSala: u.tamanhoSala,
  });
  try {
    await usuario.iniciar();
    criados.push(usuario);
  } catch (err) {
    falhasDeConexao.push(String(err && err.message ? err.message : err));
  }
  await espera(passoMs);
}
const msDeConexao = Date.now() - t0Conexao;

// --- janela de regime permanente -----------------------------------------------------------------
// Tudo que a rampa produziu é descartado aqui. O que sobra é população estável sob carga estável.
// A SAUDE DO DRIVER **DURANTE A RAMPA**, colhida antes do reset. Sem ela a rampa era um ponto
// cego: 163 sockets caiam ali com codigo 1006 (ping nao processado a tempo) e nao havia como
// dizer se quem nao processou foi o servidor ou o proprio trabalhador, ocupado abrindo sockets
// enquanto os ja abertos mandavam cursor. O histograma da janela nao serve para isso, porque
// ele comeca depois.
const ns = (v) => Math.round(v / 1e6);
const lacoNaRampa = {
  p50: ns(laco.percentile(50)),
  p99: ns(laco.percentile(99)),
  max: ns(laco.max),
};

for (const u of criados) u.zerar();
laco.reset();
// A CPU do driver e o segundo termo da subtracao que a sonda de ambiente faz: maquina ocupada
// MENOS servidor MENOS drivers e o trabalho alheio ao experimento.
const cpu0 = process.cpuUsage(); // a rampa nao conta: ela e serial por desenho e trava o laco de proposito
const t0 = Date.now();
await espera(duracaoMs);
const janelaMs = Date.now() - t0;

const estados = criados.map((u) => u.parar());

// --- saída ---------------------------------------------------------------------------------------
// Os pares (opId, tempo) vão para NDJSON, e não para o JSON de resumo: são centenas de milhares de
// linhas, e o coordenador as consome em fluxo, sem carregar o arquivo inteiro como objeto.
const fluxoOps = fs.createWriteStream(saidaOps);
const fluxoChegadas = fs.createWriteStream(saidaChegadas);

const porSala = new Map();
for (const e of estados) {
  const chave = String(e.tamanhoSala);
  if (!porSala.has(chave)) {
    porSala.set(chave, {
      tamanhoSala: e.tamanhoSala,
      usuarios: 0,
      opsEnviadas: 0,
      acks: 0,
      recusadas: 0,
      erros: 0,
      mudos: 0,
      cursoresEnviados: 0,
      cursoresRecebidos: 0,
      opsRecebidas: 0,
      fechadosPeloServidor: 0,
      emVooNoFim: 0,
      codigosDeFechamento: {},
      fechadosNaRampa: 0,
      codigosNaRampa: {},
      ackHist: null,
    });
  }
  const b = porSala.get(chave);
  b.usuarios += 1;
  b.opsEnviadas += e.opsEnviadas.length;
  b.acks += e.acks;
  b.recusadas += e.recusadas;
  b.erros += e.erros;
  b.mudos += e.mudos;
  b.cursoresEnviados += e.cursoresEnviados;
  b.cursoresRecebidos += e.cursoresRecebidos;
  b.opsRecebidas += e.opsRecebidas;
  b.emVooNoFim += e.emVooNoFim;
  if (e.fechadoPeloServidor) b.fechadosPeloServidor += 1;
  for (const c of e.fechamentos) b.codigosDeFechamento[c] = (b.codigosDeFechamento[c] ?? 0) + 1;
  b.fechadosNaRampa += e.fechamentosNaRampa.length;
  for (const c of e.fechamentosNaRampa) b.codigosNaRampa[c] = (b.codigosNaRampa[c] ?? 0) + 1;

  for (const [opId, ts] of e.opsEnviadas) fluxoOps.write(`${opId} ${ts} ${e.tamanhoSala}\n`);
  for (const [opId, ts] of e.chegadas) fluxoChegadas.write(`${opId} ${ts}\n`);
}

// Histogramas de ack fundidos por tamanho de sala. Feito num segundo passe porque `fundir` opera
// sobre instâncias de Histograma e o balde acima guarda a forma serializada.
const { Histograma } = await import('./metricas.mjs');
const histPorSala = new Map();
for (const e of estados) {
  const chave = String(e.tamanhoSala);
  if (!histPorSala.has(chave)) histPorSala.set(chave, new Histograma(`ack-${chave}`));
  histPorSala.get(chave).fundir(e.ackHist);
}
for (const [chave, h] of histPorSala) porSala.get(chave).ackHist = h.serializar();

await new Promise((r) => fluxoOps.end(r));
await new Promise((r) => fluxoChegadas.end(r));

fs.writeFileSync(saida, JSON.stringify({
  cadencia: cadencia.nome,
  usuariosPedidos: usuarios.length,
  usuariosConectados: criados.length,
  falhasDeConexao,
  msDeConexao,
  janelaMs,
  lacoNaRampaMs: lacoNaRampa,
  lacoDriverMs: {
    media: Math.round(laco.mean / 1e6),
    p50: Math.round(laco.percentile(50) / 1e6),
    p95: Math.round(laco.percentile(95) / 1e6),
    p99: Math.round(laco.percentile(99) / 1e6),
    max: Math.round(laco.max / 1e6),
  },
  rssMB: Math.round(process.memoryUsage().rss / 1024 ** 2),
  cpuMs: (() => { const c = process.cpuUsage(cpu0); return Math.round((c.user + c.system) / 1000); })(),
  porSala: [...porSala.values()],
}));

process.exit(0);
