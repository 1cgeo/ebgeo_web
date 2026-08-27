// Path: tests/bench/populacao-1000.bench.mjs
//
// E8 — MIL USUARIOS EM CADENCIA HUMANA, TUDO POR WEBSOCKET.
//
// Rode a mao:
//   node tests/bench/populacao-1000.bench.mjs
//   node tests/bench/populacao-1000.bench.mjs --minutos 15 --trabalhadores 8
//   node tests/bench/populacao-1000.bench.mjs --cadencias trabalho
//
// A POPULACAO. Mil usuarios em 184 salas: uma de 100, uma de 50, uma de 20, uma de 10, cem de 5 e
// oitenta de 4. Toda metrica sai SEPARADA POR TAMANHO DE SALA, porque a media sobre 184 salas
// esconderia exatamente a sala que interessa.
//
// POR QUE TUDO PELO SOCKET. E o caminho que o cliente real usa quando esta conectado. O REST de
// `/sync` existe para a fila offline drenar; medir a populacao por ele mediria o caminho de
// excecao.
//
// O QUE ESTA BANCADA MEDE QUE NENHUMA OUTRA MEDE: a PRESENCA. Um usuario com o mouse em movimento
// emite 12,5 quadros por segundo (`CURSOR_THROTTLE_MS = 80`), e a sala e por atlas, entao cada
// quadro e retransmitido para todos os outros membros. Na sala de 100, com metade mexendo o
// cursor, sao ~625 quadros por segundo entrando e ~62 mil saindo. A escrita, na mesma sala, sao
// ~100 descargas por segundo. Duas ordens de grandeza de diferenca, e as bancadas E1 a E7 nao
// enxergam nada disso.
//
// A HIPOTESE QUE ELA TESTA: o teto de mil usuarios nao e a escrita, e a presenca na sala grande.
// A previsao de escrita (~600 ops/s na cadencia media) cabe folgada no teto de ~3.400 ops/s que
// o E4 mediu. A de presenca nao tem previsao, e e por isso que ela e medida.
//
// AS TRES CADENCIAS, e nenhum numero delas foi inventado. O que varia e a fracao do tempo em que
// a pessoa edita e a fracao em que ela mexe o mouse; o RITMO dentro de cada estado vem do cliente
// (500 ms de descarga de fila, 80 ms de cursor). Ver `lib/usuario.mjs`.
//
// TOKEN CUNHADO UMA VEZ NAO ATRAVESSA A RODADA. `JWT_ACCESS_EXPIRY` e 15 minutos por padrao, e
// esta bancada roda mais que isso. Na primeira tentativa de tres cadencias, a terceira abriu com
// tokens de vinte minutos de idade e conectou 0 de 1000, todas com 401 no handshake.
//
// O QUE ISSO **NAO** SIGNIFICA, e a distincao importa: socket JA ABERTO nao cai quando o token
// expira. `reconcileAuthorization` re-resolve permissao e vitalidade da conta a cada varredura,
// mas nao reverifica o JWT — o token so e conferido no upgrade. Usuario real com sessao longa
// segue conectado, e isso e desenho, nao descuido. So a CONEXAO NOVA precisa de token fresco.
//
// A JANELA MEDIDA COMECA DEPOIS DA RAMPA. Mil handshakes, cada um com verificacao de JWT e
// resolucao de permissao, sao uma tempestade de conexao que nao tem nada a ver com regime
// permanente. A rampa e cronometrada e reportada a parte.

import fs from 'fs';
import path from 'path';
import { comBancada, arg, cabecalhoDaBase, pisoDaBase } from './lib/bancada.mjs';
import { DSN_PADRAO } from './lib/semear.mjs';
import {
  semearPopulacao, autenticarPopulacao, fatiar,
  DISTRIBUICAO_PADRAO, totalDeUsuarios,
} from './lib/populacao.mjs';
import { CADENCIAS } from './lib/usuario.mjs';
import {
  rodarTrabalhadores, fundirResumos, juntarEntrega, reconciliarPopulacao,
  linhaDeSala, COLUNAS_POP, saudeDoInstrumento,
} from './lib/coordenador.mjs';
import { tabela, round } from './lib/metricas.mjs';
import { amostrarPg } from './lib/sonda-pg.mjs';
import { baseDaRodada } from './lib/linha-de-base.mjs';
import { medirCargaDaMaquina, saudeDoAmbiente } from './lib/carga-da-maquina.mjs';

const MINUTOS = arg('minutos', 5);
const TRABALHADORES = arg('trabalhadores', 6);
const RAMPA_S = arg('rampa', 60);
const listaCadencias = (() => {
  const i = process.argv.indexOf('--cadencias');
  return i === -1
    ? ['reuniao', 'trabalho', 'exercicio']
    : String(process.argv[i + 1]).split(',');
})();

const DIR_TMP = path.join(process.env.TEMP || '/tmp', 'ebgeo-bench-populacao');

await comBancada(
  {
    titulo: 'E8 — mil usuarios em cadencia humana, por WebSocket',
    extraCabecalho: {
      usuarios: totalDeUsuarios(DISTRIBUICAO_PADRAO),
      salas: DISTRIBUICAO_PADRAO.map((d) => `${d.quantidade}x${d.tamanho}`).join(' '),
      cadencias: listaCadencias.join(', '),
      janela: `${MINUTOS} min por cadencia`,
      rampa: `${RAMPA_S} s`,
      trabalhadores: TRABALHADORES,
      transporte: 'WebSocket (o caminho do cliente conectado)',
    },
  },
  async (ctx) => {
    fs.rmSync(DIR_TMP, { recursive: true, force: true });

    console.log('  semeando a populacao...');
    const t0 = Date.now();
    const { salas, senha } = await semearPopulacao({
      dsn: DSN_PADRAO,
      distribuicao: DISTRIBUICAO_PADRAO,
      log: (m) => console.log(m),
    });
    console.log(`  ${salas.length} salas semeadas em ${round((Date.now() - t0) / 1000)} s`);

    // Autenticacao acontece por CADENCIA, logo antes de conectar. Ver a nota no topo.
    const autenticar = async () => {
      const t = await autenticarPopulacao({ base: ctx.base, salas, senha });
      console.log(`  ${t.size} tokens frescos emitidos`);
      return t;
    };

    const resultados = [];

    for (const nome of listaCadencias) {
      const cadencia = CADENCIAS[nome];
      if (!cadencia) throw new Error(`cadencia desconhecida: ${nome}`);

      console.log(`\n  === cadencia "${nome}": rampa de ${RAMPA_S} s + janela de ${MINUTOS} min ===`);
      const dirTmp = path.join(DIR_TMP, nome);
      await ctx.servidor.laco({ reset: true });
      // O amostrador do Postgres e o que discrimina "o Node saturou" de "a fila do banco
      // encheu". Sem ele, uma latencia alta com laco ocioso nao tem como ser atribuida.
      const sondaPg = await amostrarPg(ctx.dsn);
      const maquina = await medirCargaDaMaquina();

      const tokens = await autenticar();
      const specs = await rodarTrabalhadores({
        fatias: fatiar({ salas, tokens, trabalhadores: TRABALHADORES }),
        base: ctx.base,
        cadencia,
        rampaMs: RAMPA_S * 1000,
        duracaoMs: MINUTOS * 60 * 1000,
        dirTmp,
      });

      const pg = await sondaPg.parar();
      const laco = await ctx.servidor.laco();
      const fundido = fundirResumos(specs);
      const carga = await maquina.parar({
        servidorMs: (laco?.cpuUsuarioMs ?? 0) + (laco?.cpuSistemaMs ?? 0),
        driversMs: fundido.cpuDriversMs,
      });
      const ambiente = saudeDoAmbiente(carga, pisoDaBase());
      const entrega = await juntarEntrega(specs);
      const rec = await reconciliarPopulacao({
        dsn: ctx.dsn, salas, porSala: fundido.porSala, enviadas: entrega.enviadas,
      });

      const linhas = [...fundido.porSala.values()]
        .sort((a, b) => b.tamanhoSala - a.tamanhoSala)
        .map((b) => linhaDeSala(b, entrega.hist.get(String(b.tamanhoSala)), fundido.janelaMs));

      const saude = saudeDoInstrumento(fundido.lacoDriver);
      resultados.push({ nome, linhas, fundido, rec, laco, entrega, saude, pg });
      // Uma linha de base POR CADENCIA: reuniao e exercicio sao experimentos diferentes, e
      // guardar as duas no mesmo arquivo compararia carga leve contra carga pesada.
      baseDaRodada({
        linhas, cabecalho: cabecalhoDaBase(), chave: 'sala', sufixo: nome,
      });

      console.log(`\n  CADENCIA "${nome}"  —  ${fundido.conectados}/${fundido.pedidos} conectados, `
        + `rampa ${round(fundido.maiorConexaoMs / 1000)} s, janela ${round(fundido.janelaMs / 1000)} s`);
      console.log(`  ${saude.texto}`);
      console.log(`  ${ambiente.texto}`);
      if (!ambiente.ok) console.log('  >>> ESTES NUMEROS NAO SERVEM DE LINHA DE BASE. <<<');
      if (!saude.ok) console.log('  >>> A TABELA ABAIXO NAO MEDE O SERVIDOR. <<<');
      tabela(linhas, COLUNAS_POP);

      const totalOps = linhas.reduce((s, l) => s + l['ops/s'], 0);
      const totalCursorEnv = linhas.reduce((s, l) => s + l['cursorEnv/s'], 0);
      const totalCursorRec = linhas.reduce((s, l) => s + l['cursorRec/s'], 0);
      console.log(`\n    agregado: ${round(totalOps)} ops/s escritas, `
        + `${round(totalCursorEnv)} quadros/s de cursor entrando, `
        + `${round(totalCursorRec)} saindo`);
      console.log(`    laco do SERVIDOR: p99 ${laco?.lacoMs?.p99 ?? '-'} ms, `
        + `max ${laco?.lacoMs?.max ?? '-'} ms, RSS ${laco?.memoria?.rssMB ?? '-'} MB`);
      console.log(`    laco do SERVIDOR, OCUPACAO: ${laco?.usoDoLacoPct ?? '-'} % `
        + `(ativo ${laco?.ativoMs ?? '-'} ms de ${(laco?.ativoMs ?? 0) + (laco?.ociosoMs ?? 0)} ms)`);
      console.log(`    CPU do SERVIDOR (caminho independente): `
        + `${laco?.cpuUsuarioMs ?? '-'} ms usuario + ${laco?.cpuSistemaMs ?? '-'} ms sistema`);
      console.log(`    laco do DRIVER (pior trabalhador): p99 ${fundido.lacoDriver.p99} ms, `
        + `max ${fundido.lacoDriver.max} ms, RSS ${fundido.rssDriverMB} MB`);
      console.log(`    POSTGRES: pico de ${pg.picoConexoes} conexoes, ${pg.picoAtivas} ativas, `
        + `${pg.picoEsperandoLock} esperando lock | esperas: ${JSON.stringify(pg.esperas)}`);
      console.log(`    entrega casada: ${entrega.casadas} ops, ${entrega.orfas} orfas`);

      console.log('\n    RECONCILIACAO POR SALA (ausentes do ledger tem de cair entre piso e teto)');
      tabela(rec.provas, ['sala', 'linhasNoLedger', 'ausentesDoLedger', 'piso', 'teto',
        'semVeredito', 'emVooNoFim', 'recusadas', 'veredito']);
      if (fundido.falhas.length > 0) {
        console.log(`\n    ATENCAO: ${fundido.falhas.length} conexoes falharam. `
          + `Exemplos: ${fundido.falhas.slice(0, 3).join(' | ')}`);
      }
    }

    // Comparacao final entre cadencias, so a sala grande, que e onde a hipotese vive.
    console.log('\n\n  A SALA DE 100, LADO A LADO ENTRE AS CADENCIAS');
    const grandes = resultados.map((r) => {
      const l = r.linhas.find((x) => x.sala === 100) ?? {};
      return {
        cadencia: r.nome,
        'ops/s': l['ops/s'] ?? '-',
        'cursorEnv/s': l['cursorEnv/s'] ?? '-',
        'cursorRec/s': l['cursorRec/s'] ?? '-',
        perdaCursorPct: l.perdaCursorPct ?? '-',
        ackP95: l.ackP95 ?? '-',
        entregaP95: l.entregaP95 ?? '-',
        derrubados: l.derrubados ?? '-',
        instrumento: r.saude.nivel,
        lacoP99: r.laco?.lacoMs?.p99 ?? '-',
        usoLacoPct: r.laco?.usoDoLacoPct ?? '-',
        rssMB: r.laco?.memoria?.rssMB ?? '-',
      };
    });
    tabela(grandes);

    const falhou = resultados.some((r) => !r.rec.ok);
    console.log('\n  LEITURA');
    console.log('    - ops/s por sala contra o teto de ~3.400 ops/s que o E4 mediu para o processo inteiro.');
    console.log('    - perdaCursorPct e a regua de saturacao da sala. Quadro de presenca e descartavel por');
    console.log('      desenho num socket entupido, entao perda nao e defeito: e o ponto em que a sala nao acompanha.');
    console.log('    - entregaP95 e o tempo do autor ate o par, e e o que o usuario sente.');
    console.log('    - derrubados sao sockets que o servidor terminou. Zero e o esperado: todo usuario pinga.');
    console.log('    - Um processo, sala em memoria. Nada disto se estende a mais de uma instancia.');
    console.log('');
    return falhou ? 1 : 0;
  }
);
