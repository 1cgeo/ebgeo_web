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
 *
 * `stack_bruta` É A SEGUNDA EXCEÇÃO, E ELA VAI NA DIREÇÃO CONTRÁRIA: o argumento da ordem
 * está invertido (`COALESCE(client_errors.stack_bruta, EXCLUDED.stack_bruta)`), de modo que
 * o PRIMEIRO valor não-nulo é o que fica para sempre. O motivo é o `release`: a pilha crua
 * carrega o hash do bundle, e só faz sentido lida contra a build que a produziu. Como
 * `release` segue a regra normal (o relato NOVO vence), deixar a pilha crua também seguir
 * faria as duas colunas descreverem builds DIFERENTES na mesma linha — uma pilha de um
 * bundle apontando linhas de outro é pior que pilha nenhuma, porque parece endereço. Fixada
 * na primeira, a linha responde "onde isto quebrou quando foi visto pela primeira vez", que
 * é uma pergunta que ela pode responder inteira. Guarda:
 * `tests/integration/diag-erro-de-cliente-identidade.test.js`.
 */
export const UPSERT_CLIENT_ERROR = `
  INSERT INTO client_errors
    (assinatura, mensagem, stack, url, pagina, user_agent, release, user_id, atlas_id,
     sessao_id, stack_bruta, origem, contexto)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
    atlas_id    = COALESCE(EXCLUDED.atlas_id, client_errors.atlas_id),
    sessao_id   = COALESCE(EXCLUDED.sessao_id, client_errors.sessao_id),
    stack_bruta = COALESCE(client_errors.stack_bruta, EXCLUDED.stack_bruta),
    origem      = COALESCE(EXCLUDED.origem, client_errors.origem),
    contexto    = COALESCE(EXCLUDED.contexto, client_errors.contexto)
`;

/**
 * A listagem para o administrador.
 *
 * O TOTAL VEM NO MESMO SELECT, como subconsulta ESCALAR, e a forma foi escolhida medindo,
 * porque a óbvia é a cara. `COUNT(*) OVER ()` obriga o `WindowAgg` a materializar TODAS as
 * linhas da janela antes de o `LIMIT` cortar: medido com EXPLAIN ANALYZE sobre 200 mil
 * linhas, a rota saiu de 0,05 ms para 257 ms e derramou milhares de blocos em arquivo
 * temporário, porque cada linha carrega um `stack` de milhares de caracteres. A subconsulta
 * vira um `InitPlan` avaliado UMA vez, resolvido por `Index Only Scan` no mesmo
 * `idx_client_errors_ultima_em`, e o `LIMIT` do corpo continua parando na quinquagésima
 * linha: 4,8 ms na janela de 7 dias sobre 200 mil linhas espalhadas por 30 dias, contra
 * 32,8 ms de um COUNT em requisição separada, que ainda custaria uma segunda ida ao banco.
 *
 * O PREDICADO É LITERALMENTE O MESMO ($1 nos dois lugares), e é daí que vem a única
 * garantia que importa: lista vazia implica total zero, então o chamador pode ler o total
 * da primeira linha e assumir zero quando não há linha nenhuma. Um predicado que divergisse
 * do outro anunciaria "50 de 400" ao lado de uma lista de 3, que é pior que não ter número.
 *
 * `LEFT JOIN` e não `JOIN`: a maior parte destas linhas é ANÔNIMA por desenho (o app roda
 * deslogado, e é justamente aí que ninguém vê o erro). Um `JOIN` interno esconderia
 * exatamente a metade que a rota existe para mostrar, sem erro nenhum, com uma lista
 * plausível na tela.
 */
export const LIST_CLIENT_ERRORS = `
  SELECT ce.id, ce.assinatura, ce.mensagem, ce.stack, ce.url, ce.pagina,
         ce.user_agent, ce.release, ce.user_id, u.username, ce.atlas_id,
         ce.sessao_id, ce.stack_bruta, ce.origem, ce.contexto,
         ce.ocorrencias, ce.primeira_em, ce.ultima_em,
         (SELECT COUNT(*)::int FROM client_errors WHERE ultima_em >= $1) AS total_assinaturas
    FROM client_errors ce
    LEFT JOIN users u ON u.id = ce.user_id
   WHERE ce.ultima_em >= $1
   ORDER BY ce.ultima_em DESC
   LIMIT $2
`;

/**
 * A PODA POR IDADE, com teto de linhas por passada.
 *
 * O CRITÉRIO É `ultima_em`, NUNCA `primeira_em`, e a diferença entre os dois é o dado mais
 * valioso da tabela. Uma assinatura vista pela primeira vez há um ano e ainda ocorrendo
 * hoje é o defeito CRÔNICO, que é justamente o que ninguém quer perder; podar por
 * nascimento apagaria exatamente esse e deixaria de pé o erro de ontem que ninguém vai
 * reproduzir de novo. É o mesmo critério que a LISTAGEM já usa para a janela, e a simetria
 * é a propriedade: a linha que a tela ainda alcança é a linha que a poda ainda respeita.
 *
 * O TETO ($2) EXISTE PARA O LOCK, não para a correção. Sem ele, uma tabela que cresceu
 * durante um período sem escrita nenhuma viraria um DELETE de centenas de milhares de
 * linhas na primeira requisição seguinte, segurando lock e WAL enquanto quem relatou o erro
 * espera pelo 204. Com ele cada passada é barata e o que sobrar sai na próxima: a poda é
 * incremental por desenho e nunca precisa terminar numa passada só.
 *
 * O SUBSELECT COM `ORDER BY ultima_em LIMIT` NÃO É ENFEITE. Ele é o que aplica o teto ANTES
 * do DELETE (Postgres não tem `DELETE ... LIMIT`) e o que garante que as linhas escolhidas
 * sejam as MAIS ANTIGAS, e não as que o heap devolveu primeiro; sem o `ORDER BY`, duas
 * passadas poderiam circular pela cauda e deixar as mais velhas para trás para sempre.
 * Medido com EXPLAIN: o plano é `Index Scan Backward using idx_client_errors_ultima_em`
 * com o LIMIT em cima, ou seja, o índice que a listagem já tem serve a poda também, e
 * nenhum índice novo foi preciso.
 *
 * `RETURNING id` é o que dá a CONTAGEM ao chamador, e ela vai ao log quando é maior que
 * zero: poda que apaga em silêncio é indistinguível de poda que não rodou.
 */
export const DELETE_CLIENT_ERRORS_EXPIRADOS = `
  DELETE FROM client_errors
   WHERE id IN (
     SELECT id
       FROM client_errors
      WHERE ultima_em < NOW() - ($1::int * INTERVAL '1 day')
      ORDER BY ultima_em
      LIMIT $2
   )
  RETURNING id
`;
