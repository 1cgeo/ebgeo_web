#!/usr/bin/env node
// Path: scripts/auth-purgar-refresh-tokens.js
//
// APAGA linha morta de `refresh_tokens`. A tabela nunca perdia nenhuma.
//
// ============================================================================
// O DEFEITO QUE ESTE ROTEIRO FECHA
// ============================================================================
// Varredura em `backend/src` por `refresh_tokens` devolve INSERT, SELECT e UPDATE
// (`auth.queries.js`, `users.queries.js`) e as migracoes. Nenhum DELETE, em lugar
// nenhum. A tabela ganha uma linha por login e mais uma por rotacao de refresh, e
// nunca perde. Token vencido e token revogado ficavam para sempre, junto com as
// entradas de indice que cada um arrasta.
//
// ============================================================================
// A JANELA, QUE E A UNICA DECISAO DIFICIL AQUI
// ============================================================================
// NAO PURGUE CEDO. A linha revogada nao e lixo no instante em que e revogada: ela
// e a PROVA que a deteccao de reuso le.
//
// `auth.service.js` decide o que fazer com um refresh recusado assim: se
// `CLAIM_REFRESH_TOKEN` nao reivindicou nada, ele reabre a linha por
// `FIND_REFRESH_TOKEN_ANY` e olha a IDADE de `revoked_at`. Revogada ha pouco (o
// `REFRESH_RACE_GRACE_MS`, hoje 10 s) e duplicata concorrente: dois separadores, um
// F5 duplo, um retry de rede. Revogada ha muito tempo e REUSO, e o servico revoga a
// familia inteira e corta as sessoes por `users.sessions_valid_from`.
//
// Apagar a linha DESLIGA esse alarme. Sem ela, `FIND_REFRESH_TOKEN_ANY` volta
// vazio, o replay de um token roubado vira "Sessao invalida. Entre novamente." como
// qualquer sessao velha, e ninguem e avisado de nada.
//
// Por isso o padrao e 30 DIAS, e nunca 1. O refresh do projeto vale 7 dias
// (`JWT_REFRESH_EXPIRY`, padrao `7d`), entao a janela guarda mais de quatro
// validades inteiras de folga depois de o token ter vencido. Baixar isso para menos
// de uma validade e trocar a deteccao de roubo por espaco em disco.
//
// O PREDICADO exige as DUAS coisas velhas, e a redundancia e deliberada:
//   1. `expires_at` ja passou ha mais de N dias, ou seja o token esta morto por
//      prazo e nao so revogado; e
//   2. ou a linha nunca foi revogada, ou `revoked_at` tambem passou ha mais de N
//      dias, ou seja a prova de reuso ja envelheceu.
// Um token revogado ha 5 minutos tem `expires_at` no futuro e falha a condicao 1,
// entao SOBREVIVE. E o teste em `tests/integration/auth-purga-refresh-tokens.test.js`
// cobra exatamente isso.
//
// ============================================================================
// SEM AGENDADOR, DE PROPOSITO
// ============================================================================
// O repositorio nao tem agendador, e a periodicidade e decisao do dono da base, nao
// deste arquivo. Chame na mao, ou pendure no agendador que voce ja opera.
//
// Uso:
//   node --env-file=.env scripts/auth-purgar-refresh-tokens.js              # dry-run
//   node --env-file=.env scripts/auth-purgar-refresh-tokens.js --apply
//   node --env-file=.env scripts/auth-purgar-refresh-tokens.js --dias=60 --apply
//
// O DRY-RUN E DE VERDADE: ele monta o DELETE real, executa contra o banco vivo
// dentro de uma transacao e desfaz. O numero que ele imprime e a contagem que o
// proprio PostgreSQL apagaria, nao uma estimativa paralela que poderia divergir do
// comando que roda depois.

import { one, tx, pgp } from '../src/database/index.js';

/** Janela padrao, em dias. Ver o cabecalho: e a idade da prova de reuso. */
const DIAS_PADRAO = 30;

/** Piso da janela. Abaixo de uma validade de refresh a purga come prova viva. */
const DIAS_MINIMO = 7;

/** Quantas linhas por transacao no modo `--apply`. */
const LOTE_PADRAO = 10000;

/**
 * As linhas que podem sair, e so elas. `$1` e a janela em dias.
 *
 * `expires_at` primeiro: a linha precisa estar morta POR PRAZO, nao apenas
 * revogada. `revoked_at` depois: se houve revogacao, ela tambem precisa ter
 * envelhecido alem da janela, senao a deteccao de reuso perde a prova.
 */
export const PREDICADO_PURGA = `
  expires_at < NOW() - make_interval(days => $1::int)
  AND (revoked_at IS NULL OR revoked_at < NOW() - make_interval(days => $1::int))
`;

const CONTAR = `
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE ${PREDICADO_PURGA})::int AS purgaveis,
         count(*) FILTER (WHERE expires_at < NOW())::int AS vencidos,
         count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revogados,
         pg_size_pretty(pg_total_relation_size('refresh_tokens')) AS tamanho
    FROM refresh_tokens
`;

const APAGAR_TUDO = `DELETE FROM refresh_tokens WHERE ${PREDICADO_PURGA} RETURNING id`;

const APAGAR_LOTE = `
  DELETE FROM refresh_tokens
   WHERE ctid IN (
     SELECT ctid FROM refresh_tokens WHERE ${PREDICADO_PURGA} LIMIT $2
   )
  RETURNING id
`;

/** Sentinela de rollback: `db.tx` desfaz a transacao quando o callback lanca. */
const DESFAZER = Symbol('dry-run');

/**
 * Le a linha de comando.
 * @param {string[]} argv
 * @returns {{aplicar: boolean, dias: number, lote: number, erro?: string}}
 */
export function lerArgumentos(argv) {
  const aplicar = argv.includes('--apply');
  const arg = (nome, padrao) => {
    const a = argv.find((x) => x.startsWith(`--${nome}=`));
    return a === undefined ? padrao : Number(a.slice(nome.length + 3));
  };
  const dias = arg('dias', DIAS_PADRAO);
  const lote = arg('lote', LOTE_PADRAO);

  if (!Number.isInteger(dias) || dias < DIAS_MINIMO) {
    return {
      aplicar,
      dias,
      lote,
      erro:
        `--dias precisa ser inteiro >= ${DIAS_MINIMO}, recebi "${dias}". `
        + 'Abaixo de uma validade de refresh a purga apaga a prova que a deteccao '
        + 'de reuso le, e um token roubado passa a devolver "sessao invalida" comum.',
    };
  }
  if (!Number.isInteger(lote) || lote < 1) {
    return { aplicar, dias, lote, erro: `--lote precisa ser inteiro >= 1, recebi "${lote}".` };
  }
  return { aplicar, dias, lote };
}

/**
 * A medida da tabela, antes e depois.
 * @param {number} dias
 */
async function medir(dias) {
  return one(CONTAR, [dias]);
}

/**
 * Dry-run REAL: executa o DELETE e desfaz.
 * @param {number} dias
 * @returns {Promise<number>} quantas linhas sairiam
 */
export async function simular(dias) {
  return tx(async (t) => {
    const linhas = await t.any(APAGAR_TUDO, [dias]);
    throw Object.assign(new Error('dry-run'), { [DESFAZER]: true, n: linhas.length });
  }).catch((e) => {
    if (e && e[DESFAZER]) return e.n;
    throw e;
  });
}

/**
 * Apaga de verdade, em lotes, uma transacao por lote.
 * @param {number} dias
 * @param {number} lote
 * @returns {Promise<number>} quantas linhas sairam
 */
export async function purgar(dias, lote) {
  let total = 0;
  for (;;) {
    const linhas = await tx((t) => t.any(APAGAR_LOTE, [dias, lote]));
    total += linhas.length;
    if (linhas.length < lote) return total;
    console.log(`  ... ${total} linha(s) apagadas`);
  }
}

async function principal() {
  const { aplicar, dias, lote, erro } = lerArgumentos(process.argv.slice(2));
  if (erro) {
    console.error(`ERRO: ${erro}`);
    process.exitCode = 2;
    return;
  }

  const antes = await medir(dias);
  console.log(
    `refresh_tokens: ${antes.total} linha(s), ${antes.vencidos} vencida(s), `
    + `${antes.revogados} revogada(s), ${antes.tamanho}`,
  );
  console.log(`janela de ${dias} dia(s): ${antes.purgaveis} linha(s) purgavel(is)`);

  if (!aplicar) {
    const simuladas = await simular(dias);
    const depois = await medir(dias);
    console.log(`dry-run: ${simuladas} linha(s) sairiam. Nada foi apagado.`);
    console.log(`confirmado: a tabela continua com ${depois.total} linha(s).`);
    console.log('Para apagar de verdade, repita com --apply.');
    return;
  }

  const apagadas = await purgar(dias, lote);
  const depois = await medir(dias);
  console.log(`--apply: ${apagadas} linha(s) apagadas.`);
  console.log(
    `refresh_tokens agora: ${depois.total} linha(s), ${depois.purgaveis} purgavel(is), `
    + `${depois.tamanho}`,
  );
  if (depois.purgaveis !== 0) {
    console.error(`ERRO: sobraram ${depois.purgaveis} linha(s) purgavel(is) depois do --apply.`);
    process.exitCode = 1;
  }
}

const chamadoDireto = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/auth-purgar-refresh-tokens.js');
if (chamadoDireto) {
  principal()
    .catch((err) => {
      console.error('Purga falhou:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pgp.end());
}
