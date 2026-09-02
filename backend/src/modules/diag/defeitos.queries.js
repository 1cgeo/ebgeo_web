// Path: src/modules/diag/defeitos.queries.js

/**
 * @fileoverview O SQL do defeito e da ocorrência.
 *
 * O NOME DAS DUAS TABELAS É O MODELO. `defeitos` é o AGRUPAMENTO (uma linha por
 * assinatura, com contagem e ciclo de vida); `defeito_ocorrencias` são as evidências
 * individuais, com teto estrutural. A tabela se chamava `client_errors` até
 * `018_defeitos_e_ocorrencias.sql`, e o nome antigo deixou de descrever o conteúdo no dia
 * em que o 5xx do próprio servidor passou a entrar nela com `origem = 'servidor'`: uma
 * tabela chamada "erros do cliente" guardando erro de servidor é a prosa mentindo sobre o
 * schema, e prosa que mente é o que faz a próxima pessoa escrever o predicado ao contrário.
 */

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
 * navegador que mandou menos contexto, inclusive `user_id`, onde a alternativa (sobrescrever
 * com NULL) apagaria a única identificação que a linha já tinha assim que um anônimo
 * repetisse o erro.
 *
 * `mensagem` é a exceção e sobrescreve sempre: ela é NOT NULL, então "vazia" não é um
 * estado possível, e a mais recente é a que corresponde ao `stack` e à `url` recém-gravados.
 *
 * `stack_bruta` É A SEGUNDA EXCEÇÃO, E ELA VAI NA DIREÇÃO CONTRÁRIA: o argumento da ordem
 * está invertido (`COALESCE(defeitos.stack_bruta, EXCLUDED.stack_bruta)`), de modo que
 * o PRIMEIRO valor não-nulo é o que fica para sempre. O motivo é o `release`: a pilha crua
 * carrega o hash do bundle, e só faz sentido lida contra a build que a produziu. Como
 * `ultima_release` segue a regra normal (o relato NOVO vence), deixar a pilha crua também
 * seguir faria as duas colunas descreverem builds DIFERENTES na mesma linha, e uma pilha de
 * um bundle apontando linhas de outro é pior que pilha nenhuma, porque parece endereço.
 * Fixada na primeira, ela responde "onde isto quebrou quando foi visto pela primeira vez",
 * que é uma pergunta que a linha pode responder inteira. É por isso que `primeira_release`
 * existe ao lado de `ultima_release`: a pilha crua sem a build que a produziu é ruído.
 *
 * O INCREMENTO É PARÂMETRO ($14), E NÃO O LITERAL `1`. O relato do navegador manda 1 (uma
 * requisição, uma ocorrência) e a descarga do agregador de servidor manda a contagem
 * acumulada na memória do processo. A alternativa recusada foi uma segunda query com
 * `+ $n`: ela duplicaria a máquina de estado abaixo, e duas cópias de uma máquina de
 * estado divergem no dia em que alguém consertar uma.
 *
 * ─── A MÁQUINA DE ESTADO, que é a parte que não se deduz lendo o CASE ───
 *
 * `estado` tem quatro valores e só UMA transição é automática: `resolvido` -> `regrediu`.
 * As outras três são atos de administrador (lote C) ou o próprio nascimento em `aberto`.
 *
 * A REGRESSÃO É POR RELEASE DIFERENTE, NUNCA POR ORDEM NO TEMPO. A leitura ingênua ("chegou
 * uma ocorrência depois de eu ter resolvido, logo regrediu") acusa um defeito corrigido toda
 * vez que um navegador com o bundle VELHO em cache dispara o erro de novo, e isso acontece
 * sempre: quem tinha a aba aberta no momento do deploy continua com o código antigo até
 * recarregar. Marcar `regrediu` ali ensinaria o administrador a ignorar o estado, que é o
 * único jeito de um campo de ciclo de vida virar decoração. Com a comparação por release, a
 * ocorrência do bundle velho é INFORMATIVA (entra na contagem e vira ocorrência) e o defeito
 * continua `resolvido`; a do bundle novo é regressão de verdade.
 *
 * `IS DISTINCT FROM` e não `<>`, porque `NULL <> 'x'` é NULL, e um CASE com condição NULL
 * cai no ELSE calado. Com `IS DISTINCT FROM`, resolver sem anotar a release (o campo é
 * opcional) e depois receber ocorrência COM release conta como regressão, que é o desfecho
 * conservador certo: sem saber em qual build o conserto entrou, não há como afirmar que a
 * ocorrência nova é do build velho.
 *
 * O `AND EXCLUDED.release IS NOT NULL` FECHA A DIREÇÃO OPOSTA, e ela é a frequente. Sem ele,
 * `IS DISTINCT FROM` é VERDADEIRO quando o relato NOVO chega SEM release (NULL contra 'v3'),
 * de modo que todo relato de um cliente antigo (script em cache, versão sem o carimbo de
 * build, fila de relatos gravada antes do deploy) reabriria como REGRESSÃO um defeito
 * corrigido. É a mesma assimetria de sempre nesta tabela: relato que não traz o campo não
 * apaga o que já se sabia (`COALESCE`), então ele também não pode AFIRMAR o contrário. Build
 * desconhecida não é build diferente; ela é ocorrência informativa, contada e virada
 * ocorrência, com o estado intacto. Guarda:
 * `tests/integration/defeito-ciclo-de-vida.test.js`.
 *
 * `ignorado` NÃO transiciona por nada, e é isso que o separa de `resolvido`: ele significa
 * "eu sei, e não quero mais ouvir sobre isto", então voltar a acusá-lo desfaria o único ato
 * que o administrador tem para calar ruído conhecido.
 */
export const UPSERT_DEFEITO = `
  INSERT INTO defeitos
    (assinatura, mensagem, stack, url, pagina, user_agent, release, user_id, atlas_id,
     sessao_id, stack_bruta, origem, contexto, ocorrencias, primeira_release, ultima_release)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $7, $7)
  ON CONFLICT (assinatura) DO UPDATE SET
    ocorrencias      = defeitos.ocorrencias + EXCLUDED.ocorrencias,
    ultima_em        = NOW(),
    mensagem         = EXCLUDED.mensagem,
    stack            = COALESCE(EXCLUDED.stack, defeitos.stack),
    url              = COALESCE(EXCLUDED.url, defeitos.url),
    pagina           = COALESCE(EXCLUDED.pagina, defeitos.pagina),
    user_agent       = COALESCE(EXCLUDED.user_agent, defeitos.user_agent),
    release          = COALESCE(EXCLUDED.release, defeitos.release),
    user_id          = COALESCE(EXCLUDED.user_id, defeitos.user_id),
    atlas_id         = COALESCE(EXCLUDED.atlas_id, defeitos.atlas_id),
    sessao_id        = COALESCE(EXCLUDED.sessao_id, defeitos.sessao_id),
    stack_bruta      = COALESCE(defeitos.stack_bruta, EXCLUDED.stack_bruta),
    origem           = COALESCE(EXCLUDED.origem, defeitos.origem),
    contexto         = COALESCE(EXCLUDED.contexto, defeitos.contexto),
    primeira_release = COALESCE(defeitos.primeira_release, EXCLUDED.release),
    ultima_release   = COALESCE(EXCLUDED.release, defeitos.ultima_release),
    estado = CASE
      WHEN defeitos.estado = 'resolvido'
       AND EXCLUDED.release IS NOT NULL
       AND EXCLUDED.release IS DISTINCT FROM defeitos.resolvido_na_release
      THEN 'regrediu'
      ELSE defeitos.estado
    END
  RETURNING id
`;

/**
 * A EVIDÊNCIA INDIVIDUAL, que o agrupamento por assinatura tinha apagado.
 *
 * O que o UPSERT acima ganha em custo ele perde em detalhe: sobrescrevendo `sessao_id`,
 * `user_id` e `contexto` a cada relato, a linha responde "a última vez" e nada sobre a
 * distribuição. "Quantas ABAS diferentes viram isto" e "só acontece com este contexto?" não
 * têm resposta a partir de uma linha só, e são as duas primeiras perguntas de quem
 * diagnostica. Daí a tabela irmã, com teto de vinte (ver `DELETE_OCORRENCIAS_EXCEDENTES`).
 */
export const INSERT_OCORRENCIA = `
  INSERT INTO defeito_ocorrencias
    (defeito_id, release, sessao_id, user_id, pagina, url, user_agent, origem,
     migalhas, contexto, req_id, rota, status_code)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
`;

/**
 * O TETO DE OCORRÊNCIAS POR DEFEITO, aplicado NA MESMA TRANSAÇÃO do INSERT.
 *
 * POR QUE ESTRUTURAL, e não uma poda por idade como a da tabela de cima. As duas tabelas
 * crescem por motivos diferentes: `defeitos` cresce com a VARIEDADE de defeitos (que é
 * limitada, e por isso a poda por idade basta), e `defeito_ocorrencias` cresce com a
 * REPETIÇÃO, que não tem limite nenhum. Um laço de render em cinco navegadores gera
 * milhares de ocorrências por minuto da MESMA assinatura, e a milésima não diz nada que a
 * vigésima não tenha dito. Sem o teto, a mesa de diagnóstico vira o incidente, que é
 * literalmente o modo de falha que o cabeçalho de `014_observabilidade.sql` recusa.
 *
 * POR QUE NA MESMA TRANSAÇÃO, e não num varredor periódico. Um sweeper é mais um
 * verificador que quebra calado (a casa já recusou um para expiração de concessão, pelo
 * mesmo motivo), e entre duas passadas dele o teto simplesmente não existe. Aqui a
 * invariante "nunca mais de vinte por defeito" vale a todo instante, em qualquer leitura de
 * qualquer transação, porque ela é imposta pela escrita que a poderia violar. O custo é um
 * DELETE por ocorrência, guiado pelo índice `(defeito_id, em DESC)` e que não apaga NADA em
 * 100% dos casos até a vigésima primeira.
 *
 * O DESEMPATE POR `id` NÃO É DECORATIVO: `em` tem por padrão `NOW()`, que em Postgres é o
 * relógio da TRANSAÇÃO, então duas ocorrências gravadas na mesma transação empatariam e a
 * escolha de qual cai ficaria a cargo do heap. Cada ocorrência tem transação própria hoje,
 * mas a ordenação não pode depender disso.
 */
export const DELETE_OCORRENCIAS_EXCEDENTES = `
  DELETE FROM defeito_ocorrencias
   WHERE defeito_id = $1
     AND id NOT IN (
       SELECT id
         FROM defeito_ocorrencias
        WHERE defeito_id = $1
        ORDER BY em DESC, id DESC
        LIMIT $2
     )
`;

/** As ocorrências de um defeito, da mais recente para a mais antiga (no máximo vinte). */
export const LIST_OCORRENCIAS = `
  SELECT o.id, o.defeito_id, o.em, o.release, o.sessao_id, o.user_id, u.username,
         o.pagina, o.url, o.user_agent, o.origem, o.migalhas, o.contexto,
         o.req_id, o.rota, o.status_code
    FROM defeito_ocorrencias o
    LEFT JOIN users u ON u.id = o.user_id
   WHERE o.defeito_id = $1
   ORDER BY o.em DESC, o.id DESC
   LIMIT $2
`;

/**
 * A LISTAGEM DE DEFEITOS, com os filtros da tela.
 *
 * TODO FILTRO É `($n::tipo IS NULL OR coluna = $n)`, e a forma é deliberada: o SQL fica
 * ESTÁTICO e 100% parametrizado, sem concatenação nenhuma. Montar o `WHERE` por
 * concatenação a partir da query string é a porta de injeção que a casa proíbe, e a
 * alternativa "um SQL por combinação de filtros" seria trinta e duas queries para cinco
 * filtros. O preço é o planejador não poder podar o predicado inerte; sobre uma tabela cuja
 * cardinalidade é a VARIEDADE de defeitos (dezenas a milhares, nunca milhões) isso não paga
 * nem uma linha de complexidade a mais.
 *
 * `novos` ($6) COMPARTILHA O `$1` DA JANELA de propósito: "novo" significa nascido DENTRO da
 * janela que está sendo olhada, não dentro de um período próprio. Um segundo parâmetro
 * permitiria pedir "defeitos das últimas 24h nascidos nos últimos 30 dias", que não é
 * pergunta nenhuma e ainda deixaria a tela ter de explicar dois períodos.
 *
 * O TOTAL VEM NO MESMO SELECT, como subconsulta ESCALAR, pelo motivo medido no cabeçalho de
 * `LIST_ERROS_CLIENTE`: `COUNT(*) OVER ()` materializa a janela inteira antes do LIMIT. O
 * PREDICADO É LITERALMENTE O MESMO nos dois lugares, e é daí que vem a garantia que a tela
 * usa: lista vazia implica total zero.
 *
 * DOIS `LEFT JOIN` sobre `users`, e nenhum pode virar `JOIN`: a maior parte destas linhas é
 * ANÔNIMA por desenho (o app roda deslogado), e `resolvido_por` é nulo em tudo que ninguém
 * resolveu, ou seja, na esmagadora maioria. Um join interno esconderia exatamente as linhas
 * que a rota existe para mostrar, sem erro nenhum e com uma lista plausível na tela.
 */
export const LIST_DEFEITOS = `
  SELECT d.id, d.assinatura, d.mensagem, d.stack, d.url, d.pagina,
         d.user_agent, d.release, d.user_id, u.username, d.atlas_id,
         d.sessao_id, d.stack_bruta, d.origem, d.contexto,
         d.estado, d.resolvido_em, d.resolvido_por, r.username AS resolvido_por_username,
         d.resolvido_na_release, d.resolvido_no_commit,
         d.primeira_release, d.ultima_release,
         d.ocorrencias, d.primeira_em, d.ultima_em,
         (SELECT COUNT(*)::int
            FROM defeitos
           WHERE ultima_em >= $1
             AND ($2::text IS NULL OR estado = $2)
             AND ($3::text IS NULL OR origem = $3)
             AND ($4::text IS NULL OR release = $4)
             AND ($5::text IS NULL OR pagina = $5)
             AND (NOT $6::boolean OR primeira_em >= $1)) AS total_defeitos
    FROM defeitos d
    LEFT JOIN users u ON u.id = d.user_id
    LEFT JOIN users r ON r.id = d.resolvido_por
   WHERE d.ultima_em >= $1
     AND ($2::text IS NULL OR d.estado = $2)
     AND ($3::text IS NULL OR d.origem = $3)
     AND ($4::text IS NULL OR d.release = $4)
     AND ($5::text IS NULL OR d.pagina = $5)
     AND (NOT $6::boolean OR d.primeira_em >= $1)
   ORDER BY d.ultima_em DESC
   LIMIT $7
`;

/**
 * UM defeito pelo id, com as MESMAS colunas de `LIST_DEFEITOS`, na mesma ordem.
 *
 * As colunas são as mesmas por uma razão que não é de gosto: as duas saídas passam pelo
 * MESMO mapeador (`itemDeDefeitoCompleto`, `defeitos.service.js`), então uma coluna a menos
 * aqui apareceria como `undefined` num campo que a listagem preenche, o que se lê como dado
 * ausente no BANCO em vez de coluna esquecida na QUERY. É essa igualdade que deixa `diag
 * defeitos` e `diag defeitos --id` responderem o mesmo objeto sobre o mesmo defeito, que é a
 * propriedade que um agente usa ao comparar as duas saídas.
 *
 * O que ela NÃO traz é o `total_defeitos` da listagem: contagem de janela não faz sentido
 * sobre uma linha só, e devolvê-la como 1 seria um número verdadeiro respondendo outra
 * pergunta.
 *
 * ELA NASCEU FORA DE `src/`, num módulo do próprio comando, porque este arquivo estava
 * congelado no commit em que `defeitos --id` e `pilha` entraram (outra sessão dirigindo
 * Playwright contra a árvore). Aquele módulo declarava o próprio exílio e morreu ao trazer o
 * SQL para casa, junto com a cópia do mapeamento de colunas que ele carregava.
 */
export const SELECT_DEFEITO_POR_ID = `
  SELECT d.id, d.assinatura, d.mensagem, d.stack, d.url, d.pagina,
         d.user_agent, d.release, d.user_id, u.username, d.atlas_id,
         d.sessao_id, d.stack_bruta, d.origem, d.contexto,
         d.estado, d.resolvido_em, d.resolvido_por, r.username AS resolvido_por_username,
         d.resolvido_na_release, d.resolvido_no_commit,
         d.primeira_release, d.ultima_release,
         d.ocorrencias, d.primeira_em, d.ultima_em
    FROM defeitos d
    LEFT JOIN users u ON u.id = d.user_id
    LEFT JOIN users r ON r.id = d.resolvido_por
   WHERE d.id = $1
`;

/**
 * A listagem TRANSITÓRIA de `GET /diag/erros-cliente`, com o shape de antes.
 *
 * ELA EXISTE PORQUE A ABA DE ADMINISTRAÇÃO AINDA A CONSOME (o consumidor troca no lote C).
 * O contrato de resposta é byte a byte o de quando a tabela se chamava `client_errors`:
 * mesmas chaves, mesma ordem, mesmo `totalAssinaturas`. O que mudou embaixo é o nome da
 * tabela e o recorte.
 *
 * `origem IS DISTINCT FROM 'servidor'` É O RECORTE, e ele não pode ser `<> 'servidor'`:
 * a esmagadora maioria das linhas tem `origem` NULL (o cliente não declarou), e
 * `NULL <> 'servidor'` é NULL, o que as excluiria TODAS. A rota devolveria uma lista quase
 * vazia com cara de "quase não há erro de navegador", que é o pior desfecho possível para
 * uma tela de diagnóstico.
 *
 * O TOTAL VEM NO MESMO SELECT, como subconsulta ESCALAR, e a forma foi escolhida medindo,
 * porque a óbvia é a cara. `COUNT(*) OVER ()` obriga o `WindowAgg` a materializar TODAS as
 * linhas da janela antes de o `LIMIT` cortar: medido com EXPLAIN ANALYZE sobre 200 mil
 * linhas, a rota saiu de 0,05 ms para 257 ms e derramou milhares de blocos em arquivo
 * temporário, porque cada linha carrega um `stack` de milhares de caracteres. A subconsulta
 * vira um `InitPlan` avaliado UMA vez, resolvido por `Index Only Scan` no mesmo
 * `idx_defeitos_ultima_em`, e o `LIMIT` do corpo continua parando na quinquagésima
 * linha: 4,8 ms na janela de 7 dias sobre 200 mil linhas espalhadas por 30 dias, contra
 * 32,8 ms de um COUNT em requisição separada, que ainda custaria uma segunda ida ao banco.
 *
 * O PREDICADO É LITERALMENTE O MESMO ($1 nos dois lugares, e o mesmo recorte de origem), e é
 * daí que vem a única garantia que importa: lista vazia implica total zero, então o chamador
 * pode ler o total da primeira linha e assumir zero quando não há linha nenhuma. Um
 * predicado que divergisse do outro anunciaria "50 de 400" ao lado de uma lista de 3, que é
 * pior que não ter número.
 *
 * `LEFT JOIN` e não `JOIN`: a maior parte destas linhas é ANÔNIMA por desenho (o app roda
 * deslogado, e é justamente aí que ninguém vê o erro). Um `JOIN` interno esconderia
 * exatamente a metade que a rota existe para mostrar, sem erro nenhum, com uma lista
 * plausível na tela.
 */
export const LIST_ERROS_CLIENTE = `
  SELECT ce.id, ce.assinatura, ce.mensagem, ce.stack, ce.url, ce.pagina,
         ce.user_agent, ce.release, ce.user_id, u.username, ce.atlas_id,
         ce.sessao_id, ce.stack_bruta, ce.origem, ce.contexto,
         ce.ocorrencias, ce.primeira_em, ce.ultima_em,
         (SELECT COUNT(*)::int FROM defeitos
           WHERE ultima_em >= $1 AND origem IS DISTINCT FROM 'servidor') AS total_assinaturas
    FROM defeitos ce
    LEFT JOIN users u ON u.id = ce.user_id
   WHERE ce.ultima_em >= $1
     AND ce.origem IS DISTINCT FROM 'servidor'
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
 * AS OCORRÊNCIAS SAEM JUNTO, e não por uma segunda passada: `defeito_ocorrencias.defeito_id`
 * é `ON DELETE CASCADE`. A alternativa (um DELETE próprio, ordenado antes deste) seria uma
 * segunda verdade sobre o que "podar" significa, e a primeira vez que alguém esquecesse de
 * mantê-la em dia deixaria órfãs que ninguém acharia, porque nada mais aponta para elas.
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
 * Medido com EXPLAIN: o plano é `Index Scan Backward using idx_defeitos_ultima_em`
 * com o LIMIT em cima, ou seja, o índice que a listagem já tem serve a poda também, e
 * nenhum índice novo foi preciso.
 *
 * `RETURNING id` é o que dá a CONTAGEM ao chamador, e ela vai ao log quando é maior que
 * zero: poda que apaga em silêncio é indistinguível de poda que não rodou.
 */
export const DELETE_DEFEITOS_EXPIRADOS = `
  DELETE FROM defeitos
   WHERE id IN (
     SELECT id
       FROM defeitos
      WHERE ultima_em < NOW() - ($1::int * INTERVAL '1 day')
      ORDER BY ultima_em
      LIMIT $2
   )
  RETURNING id
`;
