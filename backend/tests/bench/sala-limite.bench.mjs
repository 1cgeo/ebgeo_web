// Path: tests/bench/sala-limite.bench.mjs
//
// E9 — QUANTAS PESSOAS CABEM NUMA SALA. O teto de UM atlas, varrido ate quebrar.
//
// Rode a mao:
//   node tests/bench/sala-limite.bench.mjs
//   node tests/bench/sala-limite.bench.mjs --tamanhos 10,25,50,100,200,400 --minutos 2
//   node tests/bench/sala-limite.bench.mjs --cadencia exercicio
//
// A DIFERENCA PARA O E8. Aquele mede uma populacao com a forma de um uso real, e a sala de 100 e
// so a maior dela. Este isola a variavel: uma sala por degrau, cadencia fixa, tamanho crescendo,
// ate a sala deixar de acompanhar. E a diferenca entre "aguenta o que temos hoje" e "onde fica o
// teto".
//
// POR QUE O CUSTO E QUADRATICO, E POR QUE ISSO E ESTRUTURAL. A sala e `atlasId -> Set<WebSocket>`
// (`src/modules/collab/collab.rooms.js`), sem subcanal por mapa. Cada quadro que UM membro envia e
// escrito em todos os outros. Com `S` membros e uma fracao `f` deles mexendo o cursor a 12,5
// quadros por segundo, o servidor escreve `S x f x 12,5 x (S - 1)` quadros por segundo. Dobrar a
// sala QUADRUPLICA o trabalho. Nenhum ajuste de pool ou de lote muda isso: e a forma do desenho.
//
// AS TRES REGUAS DE QUEBRA, em ordem de gravidade:
//   `perdaCursorPct` sobe   — a sala nao acompanha, e a presenca degrada. Nao e defeito: quadro de
//                             presenca e descartavel por desenho, e o descarte se auto-cura.
//   `entregaP95` sobe       — a EDICAO passa a chegar tarde no par. Isto o usuario sente.
//   `derrubados` sobe       — o servidor terminou sockets. Op duravel nunca e descartada, entao o
//                             socket que passa do teto e cortado para recuperar por `sync_request`.
//                             Aqui a sala parou de funcionar.
//
// A ORDEM EM QUE ELAS APARECEM E O RESULTADO, tanto quanto os numeros. Se a perda de cursor sobe
// muito antes da entrega, o desenho esta se protegendo como pretendido. Se as duas sobem juntas,
// nao esta.
//
// UMA SALA VIRGEM POR DEGRAU, e usuarios proprios: reaproveitar a sala faria o ledger crescer
// entre degraus, e reaproveitar usuarios faria o degrau de 400 medir tambem as 10 sessoes velhas.

import fs from 'fs';
import path from 'path';
import { comBancada, arg, argLista } from './lib/bancada.mjs';
import { DSN_PADRAO } from './lib/semear.mjs';
import { semearPopulacao, autenticarPopulacao, fatiar } from './lib/populacao.mjs';
import { CADENCIAS } from './lib/usuario.mjs';
import {
  rodarTrabalhadores, fundirResumos, juntarEntrega, reconciliarPopulacao,
  linhaDeSala, COLUNAS_POP, saudeDoInstrumento, cpuDoServidorPct,
} from './lib/coordenador.mjs';
import { tabela, round } from './lib/metricas.mjs';
import { amostrarPg } from './lib/sonda-pg.mjs';

const TAMANHOS = argLista('tamanhos', [10, 25, 50, 100, 200, 400]);
const MINUTOS = arg('minutos', 2);
const RAMPA_S = arg('rampa', 30);
const TRABALHADORES = arg('trabalhadores', 6);
const nomeCadencia = (() => {
  const i = process.argv.indexOf('--cadencia');
  return i === -1 ? 'trabalho' : String(process.argv[i + 1]);
})();

const DIR_TMP = path.join(process.env.TEMP || '/tmp', 'ebgeo-bench-sala');

await comBancada(
  {
    titulo: 'E9 — o teto de uma sala',
    extraCabecalho: {
      tamanhos: TAMANHOS.join(', '),
      cadencia: nomeCadencia,
      janela: `${MINUTOS} min por degrau`,
      rampa: `${RAMPA_S} s`,
      trabalhadores: TRABALHADORES,
      usuariosTotais: TAMANHOS.reduce((s, t) => s + t, 0),
    },
  },
  async (ctx) => {
    const cadencia = CADENCIAS[nomeCadencia];
    if (!cadencia) throw new Error(`cadencia desconhecida: ${nomeCadencia}`);
    fs.rmSync(DIR_TMP, { recursive: true, force: true });

    // Uma sala por tamanho, semeadas de uma vez: cada degrau usa a sua, virgem.
    console.log('  semeando as salas...');
    const { salas, senha } = await semearPopulacao({
      dsn: DSN_PADRAO,
      distribuicao: TAMANHOS.map((t) => ({ tamanho: t, quantidade: 1 })),
      log: (m) => console.log(m),
    });
    // Token fresco por degrau: `JWT_ACCESS_EXPIRY` e 15 min e a varredura inteira passa disso.
    const autenticar = () => autenticarPopulacao({ base: ctx.base, salas, senha });

    const linhas = [];
    const extras = [];

    for (const tamanho of TAMANHOS) {
      const sala = salas.find((s) => s.tamanho === tamanho);
      console.log(`\n  === sala de ${tamanho}: rampa ${RAMPA_S} s + janela ${MINUTOS} min ===`);
      await ctx.servidor.laco({ reset: true });
      // O amostrador do Postgres e o que discrimina "o Node saturou" de "a fila do banco
      // encheu". Sem ele, uma latencia alta com laco ocioso nao tem como ser atribuida.
      const sondaPg = await amostrarPg(ctx.dsn);

      const tokens = await autenticar();
      const specs = await rodarTrabalhadores({
        fatias: fatiar({ salas: [sala], tokens, trabalhadores: TRABALHADORES }),
        base: ctx.base,
        cadencia,
        rampaMs: RAMPA_S * 1000,
        duracaoMs: MINUTOS * 60 * 1000,
        dirTmp: path.join(DIR_TMP, String(tamanho)),
      });

      const pg = await sondaPg.parar();
      const laco = await ctx.servidor.laco();
      const fundido = fundirResumos(specs);
      const entrega = await juntarEntrega(specs);
      const rec = await reconciliarPopulacao({
        dsn: ctx.dsn, salas: [sala], porSala: fundido.porSala, enviadas: entrega.enviadas,
      });

      const saude = saudeDoInstrumento(fundido.lacoDriver);
      if (!saude.ok) console.log(`  ${saude.texto}`);
      const balde = [...fundido.porSala.values()][0];
      const linha = linhaDeSala(balde, entrega.hist.get(String(tamanho)), fundido.janelaMs);
      // O custo teorico do fan-out, ao lado do medido: e a unica forma de ver se a sala esta
      // entregando o que o desenho manda, ou ja descartando.
      linha.quadrosTeoricos = round(
        linha['cursorEnv/s'] * Math.max(0, tamanho - 1), 0
      );
      linha.lacoP99 = laco?.lacoMs?.p99 ?? '-';
      linha.usoLacoPct = laco?.usoDoLacoPct ?? '-';
      linha.cpuPct = cpuDoServidorPct(laco, fundido.janelaMs + fundido.maiorConexaoMs);
      linha.pgConex = pg.picoConexoes;
      linha.pgLock = pg.picoEsperandoLock;
      linha.driverP99 = fundido.lacoDriver.p99;
      linha.instrumento = saude.nivel;
      linha.rssMB = laco?.memoria?.rssMB ?? '-';
      linha.provas = rec.ok ? 'OK' : 'FALHA';
      linhas.push(linha);

      extras.push(`sala ${tamanho}: ${fundido.conectados}/${fundido.pedidos} conectados, `
        + `${entrega.casadas} entregas cronometradas`);
      if (fundido.falhas.length > 0) {
        extras.push(`sala ${tamanho}: ${fundido.falhas.length} conexoes FALHARAM `
          + `(${fundido.falhas[0]})`);
      }
      if (!rec.ok) {
        extras.push(`sala ${tamanho}: RECONCILIACAO REPROVOU `
          + `(${JSON.stringify(rec.provas)})`);
      }
      console.log(`  ... sala de ${tamanho} concluida`);
    }

    console.log('');
    tabela(linhas, [
      ...COLUNAS_POP.filter((c) => c !== 'usuarios'),
      'quadrosTeoricos', 'lacoP99', 'usoLacoPct', 'cpuPct', 'pgConex', 'pgLock',
      'driverP99', 'instrumento', 'rssMB', 'provas',
    ]);

    console.log('\n  LEITURA');
    console.log('    - quadrosTeoricos e cursorEnv/s x (S-1): o que o desenho manda transmitir.');
    console.log('    - cursorRec/s abaixo de quadrosTeoricos e descarte, e perdaCursorPct o mede.');
    console.log('    - A ordem em que as reguas quebram e o resultado: perda de cursor primeiro e');
    console.log('      o desenho se protegendo; entrega e perda juntas nao e.');
    console.log('    - derrubados diferente de zero marca a sala que parou de funcionar.');
    console.log('    - Dobrar a sala quadruplica o fan-out. Isso e da forma do desenho, nao de ajuste.');
    for (const e of extras) console.log(`    - ${e}`);
    console.log('');

    return linhas.some((l) => l.provas === 'FALHA') ? 1 : 0;
  }
);
