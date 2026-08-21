// Path: tests/fixtures/censo-atlas-shares/exemplo-resolve-direto.queries.js
//
// FIXTURE do controle negativo de `tests/unit/atlas-shares-eixo-de-grupo-censo.test.js`.
// NÃO é código de produção e não é importada por ninguém: ela existe para que o censo
// possa provar que ENXERGA e ACUSA o defeito que existe para impedir — um sexto leitor
// de `atlas_shares` que resolve acesso por conta própria, lendo só o braço de PESSOA e
// deixando o de grupo de fora sem erro em lugar nenhum.
//
// Sem esta fixture, um verde do censo seria indistinguível de uma regex quebrada, que é
// a forma de cobertura vazia que este projeto mais pagou.

export const RESOLVE_ACESSO_A_MAO = `
  SELECT permission FROM atlas_shares WHERE atlas_id = $1 AND user_id = $2
`;

export const RESOLVE_ACESSO_EM_DUAS_LINHAS = `
  SELECT s.permission
    FROM atlas_shares s
   WHERE s.atlas_id = $1 AND s.user_id = $2
`;

// A TERCEIRA FORMA, e ela entrou em 2026-08-21 porque a varredura NÃO a via: resolver por
// `JOIN` em vez de `FROM`. É literalmente a forma que esta onda REMOVEU de
// `atlas.queries.js` (o `LEFT JOIN atlas_shares s ... AND s.user_id = $1` das três
// listagens), então é a forma exata que alguém reintroduziria ao "consertar" um cartão que
// não aparece.
export const RESOLVE_ACESSO_POR_JOIN = `
  SELECT a.id, s.permission
    FROM atlas a
    LEFT JOIN atlas_shares s ON s.atlas_id = a.id AND s.user_id = $1
   WHERE a.deleted_at IS NULL
`;
