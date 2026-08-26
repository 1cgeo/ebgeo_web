// Path: tests/bench/sala-quantidade.bench.mjs
//
// E10 — QUANTAS DUPLAS CABEM NO PROCESSO. O eixo ortogonal ao E9.
//
// Rode a mao:
//   node tests/bench/sala-quantidade.bench.mjs
//   node tests/bench/sala-quantidade.bench.mjs --salas 50,100,250,500,1000 --minutos 2
//
// OS DOIS EIXOS, E POR QUE PRECISAM DE DUAS BANCADAS. O E9 fixa UMA sala e faz ela crescer: mede
// o fan-out, que e quadratico no tamanho da sala. Este fixa a sala no MENOR tamanho que ainda tem
// colaboracao (duas pessoas) e faz crescer a QUANTIDADE de salas: com o fan-out reduzido ao
// minimo (cada quadro vai para um unico par), o que sobra e o custo de EXISTIR — socket aberto,
// heartbeat, presenca, sala no mapa, conexao de banco.
//
// O SUSPEITO NOMEADO ANTES DE MEDIR, para que a medida possa desmenti-lo. A cada 30 s o
// `heartbeatSweep` (`src/modules/collab/collab.gateway.js`) percorre TODOS os sockets e
// re-resolve a autorizacao de cada um, com concorrencia 4, contra um pool de 10. Com duas mil
// duplas isso e uma rajada periodica de milhares de consultas que nao tem nada a ver com o que os
// usuarios estao fazendo. Se existir, aparece como dente de serra no `lacoMax` e no `ackP99`, e a
// coluna `lacoMax` esta na tabela por causa disso.
//
// O SEGUNDO SUSPEITO E O TETO DE PROCESSO, nao de codigo: descritores de arquivo, memoria por
// socket, e o unico laco de eventos do Node. `rssMB` e `lacoP99` sao as reguas.
//
// DEGRAUS EM PREFIXO. As salas sao semeadas uma vez, no maior degrau, e cada degrau usa as N
// primeiras. Isso corta a semeadura pela metade e tem um custo declarado: as salas dos degraus
// pequenos chegam ao degrau grande com ledger ja escrito. O E6 mediu que a escrita nao piora ate
// 40 mil linhas por atlas, e estas salas ficam tres ordens de grandeza abaixo disso.
//
// O QUE ELE NAO MEDE: sala grande. Para isso e o E9. Rodar so este e concluir que o sistema
// aguenta N usuarios seria trocar o eixo pelo outro.

import fs from 'fs';
import path from 'path';
import { comBancada, arg, argLista } from './lib/bancada.mjs';
import { DSN_PADRAO } from './lib/semear.mjs';
import { semearPopulacao, autenticarPopulacao, fatiar } from './lib/populacao.mjs';
import { CADENCIAS } from './lib/usuario.mjs';
import {
  rodarTrabalhadores, fundirResumos, juntarEntrega, reconciliarPopulacao,
  linhaDeSala, saudeDoInstrumento, cpuDoServidorPct,
} from './lib/coordenador.mjs';
import { tabela, round } from './lib/metricas.mjs';
import { amostrarPg } from './lib/sonda-pg.mjs';

const SALAS = argLista('salas', [50, 100, 250, 500, 1000]);
const MINUTOS = arg('minutos', 2);
const RAMPA_S = arg('rampa', 45);
const TRABALHADORES = arg('trabalhadores', 6);
const nomeCadencia = (() => {
  const i = process.argv.indexOf('--cadencia');
  return i === -1 ? 'trabalho' : String(process.argv[i + 1]);
})();

const DIR_TMP = path.join(process.env.TEMP || '/tmp', 'ebgeo-bench-duplas');

await comBancada(
  {
    titulo: 'E10 — quantas duplas cabem no processo',
    extraCabecalho: {
      degraus: SALAS.map((n) => `${n} salas`).join(', '),
      tamanhoDaSala: 2,
      cadencia: nomeCadencia,
      janela: `${MINUTOS} min por degrau`,
      rampa: `${RAMPA_S} s`,
      trabalhadores: TRABALHADORES,
      usuariosNoMaior: Math.max(...SALAS) * 2,
    },
  },
  async (ctx) => {
    const cadencia = CADENCIAS[nomeCadencia];
    if (!cadencia) throw new Error(`cadencia desconhecida: ${nomeCadencia}`);
    fs.rmSync(DIR_TMP, { recursive: true, force: true });

    const maior = Math.max(...SALAS);
    console.log(`  semeando ${maior} duplas (${maior * 2} usuarios)...`);
    const { salas, senha } = await semearPopulacao({
      dsn: DSN_PADRAO,
      distribuicao: [{ tamanho: 2, quantidade: maior }],
      log: (m) => console.log(m),
    });
    // Token fresco por degrau: `JWT_ACCESS_EXPIRY` e 15 min e a varredura inteira passa disso.
    const autenticar = () => autenticarPopulacao({ base: ctx.base, salas, senha });

    const linhas = [];
    const extras = [];

    for (const quantas of SALAS) {
      const fatia = salas.slice(0, quantas);
      console.log(`\n  === ${quantas} duplas (${quantas * 2} sockets): `
        + `rampa ${RAMPA_S} s + janela ${MINUTOS} min ===`);
      await ctx.servidor.laco({ reset: true });
      // O amostrador do Postgres e o que discrimina "o Node saturou" de "a fila do banco
      // encheu". Sem ele, uma latencia alta com laco ocioso nao tem como ser atribuida.
      const sondaPg = await amostrarPg(ctx.dsn);

      const tokens = await autenticar();
      const specs = await rodarTrabalhadores({
        fatias: fatiar({ salas: fatia, tokens, trabalhadores: TRABALHADORES }),
        base: ctx.base,
        cadencia,
        rampaMs: RAMPA_S * 1000,
        duracaoMs: MINUTOS * 60 * 1000,
        dirTmp: path.join(DIR_TMP, String(quantas)),
      });

      const pg = await sondaPg.parar();
      const laco = await ctx.servidor.laco();
      const fundido = fundirResumos(specs);
      const entrega = await juntarEntrega(specs);
      const rec = await reconciliarPopulacao({
        dsn: ctx.dsn, salas: fatia, porSala: fundido.porSala, enviadas: entrega.enviadas,
      });

      const saude = saudeDoInstrumento(fundido.lacoDriver);
      if (!saude.ok) console.log(`  ${saude.texto}`);
      const balde = [...fundido.porSala.values()][0];
      const base = linhaDeSala(balde, entrega.hist.get('2'), fundido.janelaMs);
      linhas.push({
        salas: quantas,
        sockets: quantas * 2,
        conectados: fundido.conectados,
        'ops/s': base['ops/s'],
        'cursorEnv/s': base['cursorEnv/s'],
        perdaCursorPct: base.perdaCursorPct,
        ackP50: base.ackP50,
        ackP95: base.ackP95,
        ackP99: base.ackP99,
        entregaP95: base.entregaP95,
        entregaP99: base.entregaP99,
        erros: base.erros,
        semVeredito: base.semVeredito,
        derrubados: base.derrubados,
        lacoP99: laco?.lacoMs?.p99 ?? '-',
        usoLacoPct: laco?.usoDoLacoPct ?? '-',
        cpuPct: cpuDoServidorPct(laco, fundido.janelaMs + fundido.maiorConexaoMs),
        pgConex: pg.picoConexoes,
        pgLock: pg.picoEsperandoLock,
        lacoMax: laco?.lacoMs?.max ?? '-',
        rssMB: laco?.memoria?.rssMB ?? '-',
        driverP99: fundido.lacoDriver.p99,
        instrumento: saude.nivel,
        provas: rec.ok ? 'OK' : 'FALHA',
      });

      extras.push(`${quantas} duplas: ${fundido.conectados}/${fundido.pedidos} conectados, `
        + `rampa ${round(fundido.maiorConexaoMs / 1000)} s, `
        + `${entrega.casadas} entregas cronometradas`);
      if (fundido.falhas.length > 0) {
        extras.push(`${quantas} duplas: ${fundido.falhas.length} conexoes FALHARAM `
          + `(${fundido.falhas[0]})`);
      }
      console.log(`  ... ${quantas} duplas concluido`);
    }

    console.log('');
    tabela(linhas);

    console.log('\n  LEITURA');
    console.log('    - conectados abaixo de sockets e o primeiro teto duro: o processo nao aceitou todos.');
    console.log('    - lacoMax e a coluna do heartbeatSweep: a cada 30 s ele re-resolve autorizacao de');
    console.log('      TODO socket, com concorrencia 4 contra pool 10. Com milhares de sockets isso vira');
    console.log('      rajada periodica, e o dente de serra aparece aqui e no ackP99.');
    console.log('    - rssMB dividido por sockets da o custo de memoria por conexao aberta.');
    console.log('    - derrubados diferente de zero com todo usuario pingando indica que o servidor');
    console.log('      nao conseguiu processar os pings dentro da janela de 30 s.');
    console.log('    - Este eixo NAO diz nada sobre sala grande. Para isso e o E9.');
    for (const e of extras) console.log(`    - ${e}`);
    console.log('');

    return linhas.some((l) => l.provas === 'FALHA') ? 1 : 0;
  }
);
