// Path: tests/bench/escrita-sequencia.bench.mjs
//
// E6 — SEQUENCIA LONGA NO MESMO ATLAS. A escrita piora conforme o ledger cresce?
//
// Rode a mao:
//   node tests/bench/escrita-sequencia.bench.mjs
//   node tests/bench/escrita-sequencia.bench.mjs --escritores 8 --rodadas 5 --lotes 10 --ops 100
//
// ESTE E O UNICO CENARIO QUE REAPROVEITA O ATLAS DE PROPOSITO. Todos os outros dao um atlas
// virgem a cada degrau, para que a tabela nao vire uma variavel escondida. Aqui a tabela E a
// variavel: as rodadas escrevem no MESMO atlas, uma depois da outra, e a coluna `linhasNoLedger`
// cresce a cada linha do relatorio. Se `p95` subir junto, o custo de escrever depende do que ja
// foi escrito, e isso decide se `POST /sync/admin/cleanup` e higiene ou necessidade.
//
// O LEITOR INCREMENTAL FICA LIGADO DA PRIMEIRA A ULTIMA RODADA, e ele e a razao de ser deste
// arquivo. O advisory lock existe para que `server_version` sirva de cursor: sem ele, uma op que
// commita tarde recebe versao baixa, e o `WHERE server_version > $ultima` do pull nunca mais a
// devolve. Perda silenciosa, permanente, invisivel para quem so olha latencia. Uma sequencia
// longa com muitos escritores e a condicao que produz esse interleaving. A prova P4, no fim,
// compara o que o cursor viu com o que o ledger tem.
//
// A COMPARACAO E POR `op_id`, E ISSO NAO E DETALHE. `atlas_version_seq` e global entre atlas,
// entao numeracao esburacada e normal e detectar perda por nao-contiguidade ja causou tempestade
// de `sync_request` neste sistema.
//
// A RECONCILIACAO FINAL E CUMULATIVA. Cada rodada tem sua contabilidade, mas o cursor atravessou
// todas elas, entao julgar P4 rodada a rodada julgaria um subconjunto e daria o conjunto por
// conferido.

import { comBancada, medir, fechar, arg, aquecer } from './lib/bancada.mjs';
import { semearCenario, autenticar, novoAtlas, DSN_PADRAO } from './lib/semear.mjs';
import { escritorRest, criarRegistro } from './lib/escritor.mjs';
import { leitorIncremental, versaoAtual } from './lib/leitor.mjs';
import { reconciliar, imprimirProvas } from './lib/reconciliar.mjs';
import { Serie } from './lib/metricas.mjs';

const ESCRITORES = arg('escritores', 8);
const RODADAS = arg('rodadas', 5);
const LOTES = arg('lotes', 10);
const OPS = arg('ops', 100);

await comBancada(
  {
    titulo: 'E6 — sequencia longa: o ledger cresce debaixo da escrita',
    extraCabecalho: {
      escritores: ESCRITORES,
      rodadas: RODADAS,
      lotesPorRodada: LOTES,
      opsPorLote: OPS,
      opsTotais: ESCRITORES * RODADAS * LOTES * OPS,
    },
  },
  async (ctx) => {
    const cenario = await semearCenario({
      dsn: DSN_PADRAO,
      escritores: ESCRITORES,
      leitores: 1,
      atlas: 0,
    });
    const tokens = await autenticar(ctx.base, cenario.usuarios, cenario.senha);
    const [leitorToken] = await autenticar(ctx.base, cenario.espectadores, cenario.senha);

    const atlas = await novoAtlas({ cenario, nome: 'Sequencia longa' });
    await aquecer({
      servidor: ctx.servidor,
      token: tokens[0].token,
      atlasId: atlas.id,
      mapId: atlas.mapas[0],
    });

    // O cursor comeca na versao ATUAL: puxar da versao 0 devolveria um snapshot do atlas
    // inteiro, e snapshot nao e pull incremental.
    const desdeVersao = await versaoAtual(ctx.base, leitorToken.token, atlas.id);
    const leitor = leitorIncremental({
      base: ctx.base,
      token: leitorToken.token,
      atlasId: atlas.id,
      desdeVersao,
      intervaloMs: 200,
    });

    const registroTotal = criarRegistro();
    const resultados = [];

    for (let r = 1; r <= RODADAS; r += 1) {
      const registro = criarRegistro();
      const serie = new Serie(`rodada ${r}`);

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
        })
      );

      resultados.push(
        await medir({
          ctx,
          rotulo: `rodada ${r}`,
          atlasIds: [atlas.id],
          registro,
          serie,
          tarefas,
        })
      );

      // Funde no registro cumulativo, que e o que a prova P4 vai julgar no fim.
      for (const id of registro.enviados) registroTotal.enviados.add(id);
      for (const id of registro.acked) registroTotal.acked.add(id);
      for (const id of registro.idempotentes) registroTotal.idempotentes.add(id);
      for (const [id, m] of registro.recusados) registroTotal.recusados.set(id, m);
      for (const id of registro.semVeredito) registroTotal.semVeredito.add(id);

      console.log(`  ... rodada ${r} de ${RODADAS} concluida`);
    }

    const leitura = await leitor.parar();
    const codigoTabela = fechar(resultados, [
      'As rodadas compartilham o atlas: linhasNoLedger sobe de uma linha para a outra.',
      'p95 subindo junto com linhasNoLedger diz que escrever fica mais caro conforme o ledger cresce.',
      'p95 estavel diz que o cleanup e higiene, nao necessidade.',
      `O cursor incremental partiu da versao ${desdeVersao} e fez ${leitura.puxadas} puxadas.`,
      leitura.snapshots > 0
        ? `ATENCAO: ${leitura.snapshots} puxadas voltaram snapshot, o que quebra a cadeia de ids.`
        : 'Nenhuma puxada voltou snapshot: a cadeia de ids esta inteira.',
    ]);

    console.log('\n  PROVA CUMULATIVA DO CURSOR (todas as rodadas juntas)');
    const rec = await reconciliar({
      dsn: ctx.dsn,
      atlasIds: [atlas.id],
      registro: registroTotal,
      leitura,
    });
    const codigoProva = imprimirProvas(rec);

    return Math.max(codigoTabela, codigoProva);
  }
);
