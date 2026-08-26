// Path: tests/bench/escrita-contencao.bench.mjs
//
// E1 — CONTENCAO NUM SO ATLAS. Quantos escritores simultaneos o mesmo atlas aguenta.
//
// Rode a mao:
//   node tests/bench/escrita-contencao.bench.mjs
//   node tests/bench/escrita-contencao.bench.mjs --degraus 2,4,8 --lotes 20 --ops 10
//
// O QUE ELA MEDE, E POR QUE ESTE E O PRIMEIRO CENARIO. `pushOperations`
// (`src/modules/sync/sync.service.js`) toma `pg_advisory_xact_lock` por atlas ANTES do primeiro
// INSERT do lote. A escrita no mesmo atlas e, portanto, SERIALIZADA: a vazao do atlas e o
// inverso da duracao da transacao, e nao cresce com o numero de escritores. Somar escritores so
// alonga a fila.
//
// O NUMERO QUE ESTA BANCADA EXISTE PARA PRODUZIR e o degrau em que aparece o primeiro 503. O
// `SET LOCAL lock_timeout = '5s'` que precede o lock converte espera longa em recusa, e a
// recusa e retentavel, entao ela nao e um defeito. E um TETO, e ninguem neste repositorio sabe
// onde ele fica. A coluna `503` e a resposta; a coluna `aRetentar` diz quanto trabalho o cliente
// tem de refazer quando o teto e cruzado.
//
// A SEGUNDA COLUNA QUE IMPORTA E `conexPico`. O comentario do proprio lock afirma que a espera
// RETEM a conexao do pool, e que sem o timeout a contencao num atlas viraria esgotamento do
// pool para o processo inteiro (inclusive `/health` e `/auth/login`). `conexPico` e
// `lockPico` vem de `pg_stat_activity`, medidos por fora, e sao a prova ou a refutacao dessa
// afirmacao.
//
// ATLAS VIRGEM POR DEGRAU. Reaproveitar um atlas faria a tabela `operations` crescer entre os
// degraus, e parte da subida de latencia seria da tabela, nao da fila. Ver `novoAtlas`.
//
// A BANCADA NAO AFIRMA TEMPO, MAS AFIRMA CORRECAO. A coluna `provas` vem da reconciliacao
// (`lib/reconciliar.mjs`): op com ack tem de estar no ledger, e op sem veredito (o 503) NAO pode
// estar. Rodada com prova reprovada sai com codigo 1.

import { comBancada, medir, fechar, arg, argLista, aquecer } from './lib/bancada.mjs';
import { semearCenario, autenticar, novoAtlas, DSN_PADRAO } from './lib/semear.mjs';
import { escritorRest, criarRegistro } from './lib/escritor.mjs';
import { Serie } from './lib/metricas.mjs';

const DEGRAUS = argLista('degraus', [2, 4, 8, 16, 32]);
const LOTES = arg('lotes', 20);
const OPS = arg('ops', 10);

await comBancada(
  {
    titulo: 'E1 — contencao de escrita num so atlas',
    extraCabecalho: { degraus: DEGRAUS.join(', '), lotesPorEscritor: LOTES, opsPorLote: OPS },
  },
  async (ctx) => {
    const maximo = Math.max(...DEGRAUS);
    const cenario = await semearCenario({ dsn: DSN_PADRAO, escritores: maximo, atlas: 0 });
    const tokens = await autenticar(ctx.base, cenario.usuarios, cenario.senha);

    const aquecimento = await novoAtlas({ cenario, nome: 'Aquecimento' });
    await aquecer({
      servidor: ctx.servidor,
      token: tokens[0].token,
      atlasId: aquecimento.id,
      mapId: aquecimento.mapas[0],
    });

    const resultados = [];
    for (const n of DEGRAUS) {
      const atlas = await novoAtlas({ cenario, nome: `Degrau ${n}` });
      const registro = criarRegistro();
      const serie = new Serie(`${n} escritores`);

      const tarefas = tokens.slice(0, n).map(({ token }) => () =>
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
          rotulo: `${n} escritores`,
          atlasIds: [atlas.id],
          registro,
          serie,
          tarefas,
        })
      );
      console.log(`  ... degrau de ${n} escritores concluido`);
    }

    return fechar(resultados, [
      'p99 subindo com o degrau e a fila do advisory lock, nao trabalho a mais.',
      '503 em qualquer degrau marca o teto: N escritores x duracao do lote cruzou os 5 s.',
      'lockPico e o numero de backends esperando em `Lock/advisory` numa amostra de 250 ms; e piso, nunca o maximo real.',
      'conexPico contra DATABASE_POOL_MAX diz se a contencao ja esta comendo o pool do processo inteiro.',
      'aRetentar e o trabalho que o cliente teria de reenviar. Ele so e zero quando nao houve recusa.',
    ]);
  }
);
