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

export async function resumoPresenca() {
  const dados = await one(`SELECT
    COUNT(DISTINCT user_id)::int AS logados,
    COUNT(*) FILTER (WHERE user_id IS NULL)::int AS deslogados,
    COUNT(*) FILTER (WHERE pendentes > 0)::int AS navegadores_com_pendencias,
    COUNT(*) FILTER (WHERE pendentes IS NULL)::int AS pendencias_desconhecidas,
    COALESCE(SUM(pendentes), 0)::bigint AS pendentes,
    MAX(idade_pendente_ms)::bigint AS maior_idade_pendente_ms,
    COALESCE(SUM(falhas_coleta), 0)::bigint AS falhas_coleta,
    NOW() AS atualizado_em
    FROM uso_presenca WHERE visto_em > NOW() - ($1 * INTERVAL '1 second')`,
  [PRESENCA_JANELA_SEGUNDOS]);
  return { ...dados, janelaSegundos: PRESENCA_JANELA_SEGUNDOS };
}
