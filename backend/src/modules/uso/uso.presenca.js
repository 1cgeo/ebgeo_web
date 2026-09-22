// Path: src/modules/uso/uso.presenca.js
import { tx, one, query } from '../../database/index.js';

export const PRESENCA_JANELA_SEGUNDOS = 90;

/**
 * Grava o pulso de um navegador, ou a SAÍDA dele.
 *
 * A SAÍDA EXPLÍCITA EXISTE DESDE 2026-09-22 (relato do dono: "ainda diz que tem usuário presente
 * mesmo depois de sair"). Até ali a única forma de uma linha deixar de contar era a janela de 90 s
 * passar, então quem fechava a aba continuava "logado" no painel por um minuto e meio, mais os 15 s
 * do ciclo da tela. A janela continua valendo, e agora é só a REDE DE SEGURANÇA: ela cobre o que não
 * avisa (a aba que trava, o notebook que suspende, a rede que cai).
 *
 * A SAÍDA SÓ APAGA A LINHA SE O ÚLTIMO PULSO FOI DO MESMO DOCUMENTO (`aba_id`). Sem essa condição,
 * duas coisas normais apagariam quem continua presente: a navegação do mapa para `atlas.html`, em
 * que a página nova pode pulsar antes de a saída da velha chegar, e fechar uma de duas abas do mesmo
 * navegador (as duas pulsam sob o mesmo `navegador_id`). A outra aba, avisada pelo navegador, pulsa
 * logo em seguida e recria a linha se a saída tiver vencido (`session/presenca.js`).
 * @param {{navegadorId: string, abaId?: string, saindo?: boolean, pendentes?: number|null,
 *   idadePendenteMs?: number|null, falhasColeta?: number}} body - Já validado.
 * @param {string|null} userId
 * @returns {Promise<void>}
 */
export async function registrarPresenca(body, userId) {
  if (body.saindo === true) {
    // Sem `abaId` não há como saber de quem é a linha, e apagar às cegas é o defeito que a condição
    // existe para impedir: a linha fica e expira pela janela.
    if (!body.abaId) return;
    await query('DELETE FROM uso_presenca WHERE navegador_id = $1 AND aba_id = $2',
      [body.navegadorId, body.abaId]);
    return;
  }
  await tx(async t => {
    await t.none(`INSERT INTO uso_presenca
      (navegador_id, user_id, pendentes, idade_pendente_ms, falhas_coleta, aba_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (navegador_id) DO UPDATE SET user_id = EXCLUDED.user_id,
        visto_em = NOW(), pendentes = EXCLUDED.pendentes,
        idade_pendente_ms = EXCLUDED.idade_pendente_ms,
        falhas_coleta = EXCLUDED.falhas_coleta,
        aba_id = EXCLUDED.aba_id`,
    [body.navegadorId, userId ?? null, body.pendentes ?? null,
      body.idadePendenteMs ?? null, body.falhasColeta ?? 0, body.abaId ?? null]);
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
