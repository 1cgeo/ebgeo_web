-- Path: src/database/migrations/017_erro_cliente_identidade.sql
-- ============================================================================
-- 017 — o erro do navegador ganha IDENTIDADE, PILHA CRUA, ORIGEM e CONTEXTO
-- ============================================================================
-- `client_errors` (criada em `014_observabilidade.sql`) respondia "qual defeito e quantas
-- vezes" e não respondia nenhuma das perguntas seguintes: de qual aba, com que pilha de
-- verdade, por qual porta ele entrou, e em que estado o app estava. Quatro colunas
-- aditivas, todas NULL-áveis, todas opcionais na borda: um relato que não traga nenhuma
-- delas continua sendo aceito exatamente como antes, que é o contrato da rota anônima.
--
-- `sessao_id` — a ABA do navegador que produziu o erro, cunhada pelo cliente e a mesma que
--   viaja no cabeçalho `X-EBGeo-Sessao` de toda requisição, o que a torna a única costura
--   entre o erro que o navegador viu e as linhas que o servidor escreveu no mesmo instante.
--   SEM FK, e pela mesma razão de `atlas_id`: a sessão é do CLIENTE e não tem tabela aqui.
--
-- `stack_bruta` — a pilha ANTES da normalização que o cliente aplica para montar a
--   assinatura (hash de build, UUID e o `?t=` do HMR viram marcador). A normalizada agrupa;
--   esta é a que se lê para achar o arquivo e a linha, porque é a que ainda tem o hash do
--   bundle que corresponde ao `release` daquela ocorrência.
--
-- `origem` — POR QUAL PORTA o erro entrou no coletor do cliente. É um vocabulário FECHADO
--   por CHECK, com dez valores, e ele é ESPELHADO em `src/modules/diag/origens-de-erro.js`,
--   de onde o Joi da borda deriva a lista: os dois precisam andar juntos, e um valor novo
--   entra nos dois no mesmo commit (o CHECK recusa com 23514, que a borda traduz em 400, e
--   o Joi recusa antes com 422, que é a recusa que nomeia o campo).
--
-- `contexto` — JSONB pequeno com o ESTADO do app no instante do erro (tipo de atlas,
--   conexão, causa, camada, status HTTP). JSONB e não colunas porque o conjunto útil ainda
--   está sendo descoberto, e coluna por hipótese é coluna que fica NULL para sempre; a
--   borda mantém a forma fechada em Joi, então o "livre" aqui não é livre na entrada.
--
-- POR QUE `origem` NÃO É ENUM DE POSTGRES. Alargar um CHECK é uma migração aditiva de uma
-- linha; alargar um `CREATE TYPE ... AS ENUM` é DDL que o resto da casa não usa em lugar
-- nenhum, e o valor novo teria de existir no tipo antes de qualquer deploy que o emita.
-- O CHECK aceita NULL de propósito: relato de cliente antigo (ou de cliente que não sabe
-- classificar a própria origem) continua entrando, e "não declarou" é um estado honesto,
-- diferente de qualquer um dos dez.
ALTER TABLE client_errors ADD COLUMN IF NOT EXISTS sessao_id   UUID;
ALTER TABLE client_errors ADD COLUMN IF NOT EXISTS stack_bruta TEXT;
ALTER TABLE client_errors ADD COLUMN IF NOT EXISTS origem      TEXT;
ALTER TABLE client_errors ADD COLUMN IF NOT EXISTS contexto    JSONB;

-- O CONSTRAINT VAI DENTRO DE UM BLOCO QUE ENGOLE O `duplicate_object` porque o Postgres não
-- tem `ADD CONSTRAINT IF NOT EXISTS`: as quatro colunas acima são idempotentes por
-- `IF NOT EXISTS`, e sem isto ele seria o único DDL do arquivo que morre com 42710 numa
-- segunda aplicação. Derrubar e recriar o constraint resolveria igual e sai mais caro: um
-- `DROP CONSTRAINT` é DDL destrutiva e teria de virar linha em `EXCECOES_DESTRUTIVAS`
-- (`tests/unit/migrations-higiene.test.js`) para uma migração que não derruba nada.
DO $$ BEGIN
  ALTER TABLE client_errors ADD CONSTRAINT client_errors_origem_check CHECK (
    origem IS NULL OR origem IN (
      'boot', 'nao-tratado', 'rejeicao', 'console', 'store',
      'ws', 'maplibre', 'cesium', 'sv360', 'indisponivel'
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN client_errors.sessao_id IS
  'Aba do navegador que produziu o erro (X-EBGeo-Sessao). SEM FK: e identidade do CLIENTE.';
COMMENT ON COLUMN client_errors.stack_bruta IS
  'Pilha ANTES da normalizacao da assinatura: e a que ainda aponta arquivo e linha do bundle.';
COMMENT ON COLUMN client_errors.origem IS
  'Por qual porta o erro entrou no coletor do cliente. Vocabulario fechado, espelhado em '
  'src/modules/diag/origens-de-erro.js. NULL = o relato nao declarou.';
COMMENT ON COLUMN client_errors.contexto IS
  'Estado do app no instante do erro (atlasKind, conexao, causa, camada, status). Forma '
  'fechada por Joi na borda; JSONB porque o conjunto util ainda esta sendo descoberto.';
