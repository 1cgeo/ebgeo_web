// Path: src/modules/uso/uso.presenca.js
import { tx, one } from '../../database/index.js';

export const PRESENCA_JANELA_SEGUNDOS = 90;

export async function registrarPresenca(body, userId) {
  await tx(async t => {
    await t.none(`INSERT INTO uso_presenca
      (navegador_id, user_id, pendentes, idade_pendente_ms, falhas_coleta)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (navegador_id) DO UPDATE SET user_id = EXCLUDED.user_id,
        visto_em = NOW(), pendentes = EXCLUDED.pendentes,
        idade_pendente_ms = EXCLUDED.idade_pendente_ms,
        falhas_coleta = EXCLUDED.falhas_coleta`,
    [body.navegadorId, userId ?? null, body.pendentes ?? null,
      body.idadePendenteMs ?? null, body.falhasColeta ?? 0]);
    await t.none(`DELETE FROM uso_presenca WHERE navegador_id IN
      (SELECT navegador_id FROM uso_presenca WHERE visto_em < NOW() - INTERVAL '5 minutes' LIMIT 500)`);
  });
}

/**
 * O QUE ESTÁ ACONTECENDO AGORA, num documento só, para o painel do administrador.
 *
 * O PAYLOAD É camelCase INTEIRO, e isso é conserto, não gosto. Ele saía com as colunas cruas do
 * Postgres em snake_case ao lado de um `janelaSegundos` em camelCase, no mesmo objeto: quem lia a
 * tela tinha de saber de cor quais campos vinham da consulta e quais o serviço acrescentara, e um
 * campo novo entrava por qualquer uma das duas convenções conforme quem o escrevesse. O apelido
 * agora fica na consulta, no ponto em que a coluna nasce.
 *
 * OS DOIS DESCONHECIDOS SÃO DIFERENTES, e nenhum deles pode virar zero. `maiorIdadePendenteMs` é
 * `null` quando NENHUM navegador da janela informou idade, o que não é "idade zero"; e
 * `pendenciasDesconhecidas` conta os navegadores que pulsaram sem conseguir medir a própria fila,
 * que é a contagem que impede o painel de anunciar uma frota em dia quando metade dela não sabe se
 * está. Quem decide não mandar o campo é o cliente, e o porquê está no `fileoverview` de
 * `session/pendencias-monitoramento.js`.
 *
 * AS SOMAS SAEM COMO NÚMERO. `SUM(...)::bigint` chega do driver como STRING, e a tela fazia
 * `Number(...)` num ponto e não no outro, de modo que "3" e 3 conviviam no mesmo documento.
 * @returns {Promise<Object>} O documento de `GET /uso/agora`.
 */
export async function resumoPresenca() {
  const dados = await one(`SELECT
    COUNT(DISTINCT user_id)::int AS "logados",
    COUNT(*) FILTER (WHERE user_id IS NULL)::int AS "deslogados",
    COUNT(*) FILTER (WHERE pendentes > 0)::int AS "navegadoresComPendencias",
    COUNT(*) FILTER (WHERE pendentes IS NULL)::int AS "pendenciasDesconhecidas",
    COALESCE(SUM(pendentes), 0)::bigint AS "pendentes",
    MAX(idade_pendente_ms)::bigint AS "maiorIdadePendenteMs",
    COALESCE(SUM(falhas_coleta), 0)::bigint AS "falhasColeta",
    NOW() AS "atualizadoEm"
    FROM uso_presenca WHERE visto_em > NOW() - ($1 * INTERVAL '1 second')`,
  [PRESENCA_JANELA_SEGUNDOS]);
  return {
    ...dados,
    pendentes: Number(dados.pendentes),
    // `null` ATRAVESSA, e só o número é convertido: `Number(null)` é 0, e seria a afirmação de que
    // a frota está em dia sobre uma janela em que ninguém informou idade nenhuma.
    maiorIdadePendenteMs: dados.maiorIdadePendenteMs === null
      ? null
      : Number(dados.maiorIdadePendenteMs),
    falhasColeta: Number(dados.falhasColeta),
    janelaSegundos: PRESENCA_JANELA_SEGUNDOS,
  };
}
