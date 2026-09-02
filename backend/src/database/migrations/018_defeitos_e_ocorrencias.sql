-- Path: src/database/migrations/018_defeitos_e_ocorrencias.sql
-- ============================================================================
-- 018 — o erro vira DEFEITO com CICLO DE VIDA, e ganha OCORRÊNCIAS
-- ============================================================================
-- `client_errors` respondia "qual defeito e quantas vezes". Ficavam de fora as duas
-- perguntas que um administrador faz em seguida: "isto já foi resolvido, e voltou?" e
-- "quantas ABAS diferentes viram isto, e em que estado o app estava em cada uma?". A
-- primeira pede um ciclo de vida na linha agregada; a segunda pede as evidências
-- individuais, que o agrupamento por assinatura tinha apagado por construção.
--
-- O desenho vem do par issue/event do Sentry, avaliado e recusado como DEPENDÊNCIA em
-- 2026-09-01 (SaaS ou stack pesado numa rede fechada). O que se importou foi o modelo, no
-- Postgres que já existia.
--
-- POR QUE RENOMEAR A TABELA. `client_errors` deixou de descrever o conteúdo no momento em
-- que o 5xx do PRÓPRIO servidor passou a entrar nela, com `origem = 'servidor'` (ver
-- `src/modules/diag/defeitos-de-servidor.js`). Uma tabela chamada "erros do cliente"
-- guardando erro de servidor é a prosa mentindo sobre o schema, e o custo disso não é
-- estético: é a próxima pessoa escrevendo o predicado ao contrário porque acreditou no nome.
-- O RENAME é aditivo (nenhum dado se move, nenhuma coluna cai) e o pacote inteiro é
-- reescrito no mesmo commit.
--
-- POR QUE ESTE ARQUIVO É IDEMPOTENTE ATÉ ONDE O POSTGRES DEIXA. `ALTER TABLE ... RENAME TO`
-- não tem `IF EXISTS` útil aqui (ele existe para a tabela ORIGEM, não para o destino), então
-- toda renomeação está dentro de um bloco `DO` guardado por `to_regclass`/`pg_constraint`.
-- O motivo é operacional e vale mais que a elegância: outra sessão desta mesma árvore aplica
-- TODAS as migrações num banco virgem a cada rodada de teste de UI, e um arquivo que morra
-- na segunda aplicação derruba o boot do backend dela.
--
-- ─── O QUE CADA COLUNA NOVA DE `defeitos` RESPONDE ───
--
-- `estado` — o ciclo de vida, CHECK fechado com quatro valores, espelhado em
--   `src/modules/diag/estados-de-defeito.js` (a mesma disciplina de `origem`). Ele NASCE
--   `'aberto'` com DEFAULT, o que é o que torna a coluna aditiva sobre uma tabela com
--   linhas: nenhuma linha existente fica em estado indefinido.
--
-- `resolvido_em`, `resolvido_por`, `resolvido_na_release`, `resolvido_no_commit` — o ato de
--   resolver, com autor e build. `resolvido_na_release` é a coluna que a REGRESSÃO consulta:
--   uma ocorrência nova numa release DIFERENTE daquela em que o defeito foi resolvido é
--   regressão, e na MESMA release é apenas um navegador com o bundle velho em cache. A regra
--   e o porquê estão no CASE de `UPSERT_DEFEITO` (`src/modules/diag/defeitos.queries.js`).
--
-- `resolvido_por` É `ON DELETE SET NULL`, com a MESMA assimetria (e o mesmo motivo) de
--   `user_id`, declarada em `014_observabilidade.sql`: a convenção da casa é "FK sem ON
--   DELETE, reatribua antes do hard-delete", e ela existe para DADO DE TRABALHO, que não pode
--   perder dono. Isto é telemetria: o defeito continua resolvido sem o nome de quem o
--   resolveu, e uma FK bloqueante faria a exclusão de uma conta falhar com 23503 por causa de
--   um registro de diagnóstico.
--
-- `resolvido_no_commit` TEM TETO POR CHECK e não por `VARCHAR(64)`. Os dois recusam o mesmo
--   valor; o CHECK é o que a casa usa em toda parte, e trocar o tipo depois seria
--   `ALTER COLUMN ... TYPE`, que é DDL destrutiva e exigiria linha em `EXCECOES_DESTRUTIVAS`.
--   64 é o comprimento de um SHA-256 em hexadecimal, que é o teto do que um id de commit pode
--   ser hoje ou depois da transição do git para SHA-256.
--
-- `primeira_release` e `ultima_release` — em qual build o defeito foi visto pela PRIMEIRA e
--   pela ÚLTIMA vez. `release` sozinha não respondia nenhuma das duas: ela é sobrescrita pelo
--   relato mais recente, então "apareceu na v2 e sumiu na v4" era indeduzível. A assimetria
--   com `stack_bruta` é deliberada e se lê junto: a pilha crua fica FIXA na primeira, e é
--   `primeira_release` que diz contra qual bundle ela deve ser lida.
--
-- ─── A ORIGEM GANHA UM DÉCIMO PRIMEIRO VALOR ───
--
-- `'servidor'` entra no fim da lista, e ele quebra a regra do nome do vocabulário: os dez
-- primeiros dizem por qual porta o erro entrou no coletor do NAVEGADOR, e este diz que não
-- houve navegador nenhum. Ele é o que permite `origem IS DISTINCT FROM 'servidor'` recortar
-- de volta exatamente o que `GET /diag/erros-cliente` respondia antes.
--
-- ALARGAR UM CHECK É COMPATÍVEL PARA TRÁS (todo valor aceito antes continua aceito), mas o
-- Postgres não tem `ALTER CONSTRAINT` para expressão: o constraint cai e volta, e isso conta
-- como DDL destrutiva. A linha correspondente está em `EXCECOES_DESTRUTIVAS`
-- (`tests/unit/migrations-higiene.test.js`), no mesmo commit, que é o ato explícito que a
-- convenção exige.
--
-- ─── A TABELA DE OCORRÊNCIAS, E OS DOIS PONTOS QUE SURPREENDEM ───
--
-- `defeito_id` É `ON DELETE CASCADE`, e é a ÚNICA FK deste par que cascateia. A casa proíbe
-- hard-delete de entidade principal e usa soft-delete em toda parte, mas uma ocorrência SEM o
-- defeito dela não é um registro incompleto, é um registro sem sentido: ela não tem
-- assinatura, não tem mensagem e não tem como ser achada por nada. O cascade também é o que
-- mantém UMA definição de "podar": a poda por idade apaga o defeito e as ocorrências saem
-- junto, sem um segundo DELETE que alguém precise lembrar de manter em dia.
--
-- O TETO DE VINTE NÃO ESTÁ AQUI, e a ausência é deliberada. Ele é imposto pela ESCRITA, na
-- mesma transação do INSERT (`DELETE_OCORRENCIAS_EXCEDENTES`), porque um teto declarado no
-- schema exigiria trigger, e trigger é lógica escondida do lado errado da fronteira. O
-- índice `(defeito_id, em DESC)` serve as duas coisas: a listagem e o próprio DELETE do teto.
--
-- `migalhas` e `contexto` são JSONB com forma FECHADA na borda (Joi, `diag.schemas.js`),
-- classificados no censo de campos livres (`tests/integration/campos-livres-censo.test.js`).
-- JSONB e não colunas porque o conjunto útil ainda está sendo descoberto; livre no
-- armazenamento não significa livre na entrada.

-- ── 1. a tabela muda de nome ────────────────────────────────────────────────
DO $$ BEGIN
  IF to_regclass('public.client_errors') IS NOT NULL
     AND to_regclass('public.defeitos') IS NULL THEN
    ALTER TABLE client_errors RENAME TO defeitos;
  END IF;
END $$;

-- ── 2. e leva os nomes dos objetos dela junto ───────────────────────────────
-- Um `client_errors_pkey` pendurado numa tabela chamada `defeitos` é a mesma mentira do nome
-- da tabela, uma camada abaixo, e é a que aparece na mensagem de erro do Postgres quando
-- alguém viola o constraint. O laço evita quatro blocos idênticos.
DO $$
DECLARE
  par RECORD;
BEGIN
  FOR par IN
    SELECT * FROM (VALUES
      ('client_errors_pkey',          'defeitos_pkey'),
      ('client_errors_assinatura_key','defeitos_assinatura_key'),
      ('client_errors_user_id_fkey',  'defeitos_user_id_fkey'),
      ('client_errors_origem_check',  'defeitos_origem_check')
    ) AS t(antigo, novo)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = par.antigo AND conrelid = 'public.defeitos'::regclass
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = par.novo AND conrelid = 'public.defeitos'::regclass
    ) THEN
      EXECUTE format('ALTER TABLE defeitos RENAME CONSTRAINT %I TO %I', par.antigo, par.novo);
    END IF;
  END LOOP;
END $$;

DO $$ BEGIN
  IF to_regclass('public.idx_client_errors_ultima_em') IS NOT NULL
     AND to_regclass('public.idx_defeitos_ultima_em') IS NULL THEN
    ALTER INDEX idx_client_errors_ultima_em RENAME TO idx_defeitos_ultima_em;
  END IF;
END $$;

-- ── 3. o ciclo de vida ──────────────────────────────────────────────────────
ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS estado               TEXT NOT NULL DEFAULT 'aberto';
ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS resolvido_em         TIMESTAMPTZ;
ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS resolvido_por        UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS resolvido_na_release TEXT;
ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS resolvido_no_commit  TEXT;
ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS primeira_release     TEXT;
ALTER TABLE defeitos ADD COLUMN IF NOT EXISTS ultima_release       TEXT;

-- Os dois CHECKs vão dentro de blocos que engolem o `duplicate_object` porque o Postgres não
-- tem `ADD CONSTRAINT IF NOT EXISTS`. É o mesmo padrão de `017_erro_cliente_identidade.sql`,
-- e ele é preferível a derrubar e recriar: um `DROP CONSTRAINT` é DDL destrutiva e teria de
-- virar linha em `EXCECOES_DESTRUTIVAS` para um constraint que ainda não existe.
DO $$ BEGIN
  ALTER TABLE defeitos ADD CONSTRAINT defeitos_estado_check CHECK (
    estado IN ('aberto', 'resolvido', 'ignorado', 'regrediu')
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE defeitos ADD CONSTRAINT defeitos_resolvido_no_commit_check CHECK (
    resolvido_no_commit IS NULL OR length(resolvido_no_commit) <= 64
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 4. a origem passa a aceitar o servidor ──────────────────────────────────
-- ESTE É O ÚNICO DDL DESTRUTIVO DO ARQUIVO, e ele está declarado em `EXCECOES_DESTRUTIVAS`
-- (`tests/unit/migrations-higiene.test.js`). O `IF EXISTS` é o que o mantém idempotente numa
-- segunda aplicação, onde o constraint com o nome antigo já não existe.
ALTER TABLE defeitos DROP CONSTRAINT IF EXISTS defeitos_origem_check;
DO $$ BEGIN
  ALTER TABLE defeitos ADD CONSTRAINT defeitos_origem_check CHECK (
    origem IS NULL OR origem IN (
      'boot', 'nao-tratado', 'rejeicao', 'console', 'store',
      'ws', 'maplibre', 'cesium', 'sv360', 'indisponivel', 'servidor'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 5. as linhas que já existem ganham as duas releases ─────────────────────
-- O `AND release IS NOT NULL` não é redundante: sem ele, toda linha sem release seria
-- reescrita a cada aplicação (NULL := NULL), o que é inofensivo e desnecessário. Com ele o
-- UPDATE toca cada linha uma vez na vida.
UPDATE defeitos
   SET primeira_release = release,
       ultima_release   = release
 WHERE primeira_release IS NULL
   AND release IS NOT NULL;

-- ── 6. as ocorrências ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS defeito_ocorrencias (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  defeito_id  UUID NOT NULL REFERENCES defeitos(id) ON DELETE CASCADE,
  em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  release     TEXT,
  sessao_id   UUID,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  pagina      TEXT,
  url         TEXT,
  user_agent  TEXT,
  origem      TEXT,
  migalhas    JSONB,
  contexto    JSONB,
  req_id      TEXT,
  rota        TEXT,
  status_code INT,
  CONSTRAINT defeito_ocorrencias_origem_check CHECK (
    origem IS NULL OR origem IN (
      'boot', 'nao-tratado', 'rejeicao', 'console', 'store',
      'ws', 'maplibre', 'cesium', 'sv360', 'indisponivel', 'servidor'
    )
  )
);

-- O ÚNICO acesso desta tabela é "as N mais recentes de UM defeito", e ele aparece nos dois
-- lados: na listagem da tela e no DELETE que impõe o teto de vinte. O índice composto serve
-- os dois; um índice só em `defeito_id` deixaria a ordenação para um sort em memória a cada
-- escrita de ocorrência, que é o caminho mais quente desta camada.
CREATE INDEX IF NOT EXISTS idx_defeito_ocorrencias_defeito_em
  ON defeito_ocorrencias (defeito_id, em DESC);

COMMENT ON TABLE defeitos IS
  'Defeito agrupado por assinatura, do navegador OU do servidor. Uma linha por defeito, nao por ocorrencia. Chamava-se client_errors ate 018_defeitos_e_ocorrencias.sql.';
COMMENT ON COLUMN defeitos.estado IS
  'Ciclo de vida: aberto | resolvido | ignorado | regrediu. Vocabulario fechado, espelhado em src/modules/diag/estados-de-defeito.js.';
COMMENT ON COLUMN defeitos.resolvido_na_release IS
  'A build em que o defeito foi dado por resolvido. E ela que decide REGRESSAO: ocorrencia numa release diferente desta reabre como regrediu; na mesma, e bundle velho em cache.';
COMMENT ON COLUMN defeitos.primeira_release IS
  'A build do PRIMEIRO avistamento. Le-se junto com stack_bruta, que tambem fica fixa na primeira.';
COMMENT ON COLUMN defeitos.ultima_release IS
  'A build do avistamento mais recente. Com primeira_release, responde "apareceu na v2 e sumiu na v4".';
COMMENT ON TABLE defeito_ocorrencias IS
  'Evidencias individuais de um defeito, no maximo 20 por defeito (teto imposto pela escrita, ver DELETE_OCORRENCIAS_EXCEDENTES).';
COMMENT ON COLUMN defeito_ocorrencias.migalhas IS
  'O rastro dos ultimos passos antes do erro (breadcrumbs). Forma fechada por Joi na borda: array de ate 30 itens {t, tipo, texto}.';
COMMENT ON COLUMN defeito_ocorrencias.req_id IS
  'O req.id da requisicao que falhou, quando a ocorrencia e de servidor. E a costura com a linha do .jsonl.';
