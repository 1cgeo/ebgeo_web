// Path: src/modules/diag/client-errors.queries.js

/**
 * O UPSERT que substitui N linhas por uma contagem.
 *
 * O `ON CONFLICT (assinatura)` é a peça inteira: um defeito em laço (dezenove ocorrências
 * em segundos foi o caso REAL que originou este módulo, e um laço de render faria
 * milhares) precisa custar uma linha, não milhares. Ver o cabeçalho da migração.
 *
 * OS CAMPOS DE CONTEXTO USAM `COALESCE(EXCLUDED.x, atual)`, e a ordem dos argumentos é a
 * decisão: o relato NOVO ganha quando traz o campo, e o ANTIGO sobrevive quando o novo vem
 * vazio. É o que preserva a evidência quando a mesma assinatura chega depois de um
 * navegador que mandou menos contexto — inclusive `user_id`, onde a alternativa (sobrescrever
 * com NULL) apagaria a única identificação que a linha já tinha assim que um anônimo
 * repetisse o erro.
 *
 * `mensagem` é a exceção e sobrescreve sempre: ela é NOT NULL, então "vazia" não é um
 * estado possível, e a mais recente é a que corresponde ao `stack` e à `url` recém-gravados.
 */
export const UPSERT_CLIENT_ERROR = `
  INSERT INTO client_errors
    (assinatura, mensagem, stack, url, pagina, user_agent, release, user_id, atlas_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (assinatura) DO UPDATE SET
    ocorrencias = client_errors.ocorrencias + 1,
    ultima_em   = NOW(),
    mensagem    = EXCLUDED.mensagem,
    stack       = COALESCE(EXCLUDED.stack, client_errors.stack),
    url         = COALESCE(EXCLUDED.url, client_errors.url),
    pagina      = COALESCE(EXCLUDED.pagina, client_errors.pagina),
    user_agent  = COALESCE(EXCLUDED.user_agent, client_errors.user_agent),
    release     = COALESCE(EXCLUDED.release, client_errors.release),
    user_id     = COALESCE(EXCLUDED.user_id, client_errors.user_id),
    atlas_id    = COALESCE(EXCLUDED.atlas_id, client_errors.atlas_id)
`;

/**
 * A listagem para o administrador.
 *
 * `LEFT JOIN` e não `JOIN`: a maior parte destas linhas é ANÔNIMA por desenho (o app roda
 * deslogado, e é justamente aí que ninguém vê o erro). Um `JOIN` interno esconderia
 * exatamente a metade que a rota existe para mostrar, sem erro nenhum, com uma lista
 * plausível na tela.
 */
export const LIST_CLIENT_ERRORS = `
  SELECT ce.id, ce.assinatura, ce.mensagem, ce.stack, ce.url, ce.pagina,
         ce.user_agent, ce.release, ce.user_id, u.username, ce.atlas_id,
         ce.ocorrencias, ce.primeira_em, ce.ultima_em
    FROM client_errors ce
    LEFT JOIN users u ON u.id = ce.user_id
   WHERE ce.ultima_em >= $1
   ORDER BY ce.ultima_em DESC
   LIMIT $2
`;
