// Path: tests/bench/escrita-lote.bench.mjs
//
// E2 — O TAMANHO DO LOTE CONTRA A CONTENCAO. Onde o produto cruza os 5 s do `lock_timeout`.
//
// Rode a mao:
//   node tests/bench/escrita-lote.bench.mjs
//   node tests/bench/escrita-lote.bench.mjs --escritores 8 --tamanhos 1,10,100,500
//
// A CONTA QUE ESTA BANCADA RESOLVE. O advisory lock e por atlas e vale pela transacao inteira,
// entao a espera do enesimo escritor e, na melhor das hipoteses, `(N-1) x duracao de um lote`.
// A duracao de um lote cresce com o numero de ops dentro dele, porque `pushOperations` aplica
// op a op DENTRO da mesma transacao. Ou seja, o teto nao e "N escritores": e o PRODUTO
// `N x tamanho`. E1 varre um fator, esta varre o outro.
//
// POR QUE 500 E O ULTIMO DEGRAU. `MAX_OPS_PER_PUSH` e 500 (`src/modules/sync/sync.schemas.js`).
// Lote maior nao e carga, e 422 de validacao, e mediria o Joi.
//
// A LEITURA QUE INTERESSA e a coluna `ops/s` contra a coluna `p99`. Lote grande costuma render
// mais ops por segundo E piorar a latencia de quem espera, que e a troca que um cliente faz ao
// escolher o intervalo de descarga da fila. Se `ops/s` parar de subir quando o lote cresce, o
// custo dominante deixou de ser o round-trip e passou a ser o trabalho por op.
//
// ESTA BANCADA TAMBEM EXERCITA A IDEMPOTENCIA. Um em cada cinco lotes vai duas vezes, identico.
// `ON CONFLICT (atlas_id, op_id) DO NOTHING` tem de absorver o repeteco: a contabilidade imprime
// `idempotentes`, e a prova P1 continua exigindo que cada ack tenha linha no ledger.

import { comBancada, medir, fechar, arg, argLista, aquecer } from './lib/bancada.mjs';
import { semearCenario, autenticar, novoAtlas, DSN_PADRAO } from './lib/semear.mjs';
import { escritorRest, criarRegistro } from './lib/escritor.mjs';
import { Serie } from './lib/metricas.mjs';

const ESCRITORES = arg('escritores', 8);
const TAMANHOS = argLista('tamanhos', [1, 10, 100, 500]);
// Ops totais fixas por escritor, para que os degraus comparem o MESMO trabalho repartido em
// lotes de tamanhos diferentes. Sem isso o degrau de 500 escreveria 500 vezes mais que o de 1.
const OPS_POR_ESCRITOR = arg('opsPorEscritor', 500);

await comBancada(
  {
    titulo: 'E2 — tamanho do lote contra a contencao',
    extraCabecalho: {
      escritores: ESCRITORES,
      tamanhos: TAMANHOS.join(', '),
      opsPorEscritor: OPS_POR_ESCRITOR,
      teto: 'MAX_OPS_PER_PUSH = 500',
    },
  },
  async (ctx) => {
    const cenario = await semearCenario({ dsn: DSN_PADRAO, escritores: ESCRITORES, atlas: 0 });
    const tokens = await autenticar(ctx.base, cenario.usuarios, cenario.senha);

    const aquecimento = await novoAtlas({ cenario, nome: 'Aquecimento' });
    await aquecer({
      servidor: ctx.servidor,
      token: tokens[0].token,
      atlasId: aquecimento.id,
      mapId: aquecimento.mapas[0],
    });

    const resultados = [];
    for (const tamanho of TAMANHOS) {
      const lotes = Math.max(1, Math.round(OPS_POR_ESCRITOR / tamanho));
      const atlas = await novoAtlas({ cenario, nome: `Lote ${tamanho}` });
      const registro = criarRegistro();
      const serie = new Serie(`lote ${tamanho}`);

      const tarefas = tokens.map(({ token }) => () =>
        escritorRest({
          base: ctx.base,
          token,
          atlasId: atlas.id,
          mapId: atlas.mapas[0],
          lotes,
          opsPorLote: tamanho,
          repetirFracao: 0.2,
          serie,
          registro,
        })
      );

      resultados.push(
        await medir({
          ctx,
          rotulo: `${tamanho} ops x ${lotes}`,
          atlasIds: [atlas.id],
          registro,
          serie,
          tarefas,
        })
      );
      console.log(`  ... degrau de lote ${tamanho} concluido`);
    }

    return fechar(resultados, [
      'Todo degrau escreve o mesmo total de ops por escritor; so o recorte em lotes muda.',
      'p99 subindo com o tamanho do lote e a transacao segurando o lock por mais tempo.',
      'ops/s que para de crescer quando o lote cresce diz que o custo saiu do round-trip e foi para o apply.',
      'Um em cada cinco lotes foi enviado duas vezes: `idempotentes` na contabilidade tem de ser diferente de zero.',
      '503 aqui localiza o produto (escritores x tamanho) que cruza os 5 s do lock_timeout.',
    ]);
  }
);
