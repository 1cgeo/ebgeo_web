-- Path: src/database/migrations/001_identidade.sql
-- IDENTIDADE: quem é o chamador. organizations, ranks, users (campos militares
-- BR + OM + papéis globais + escopo de produção + api_key), refresh_tokens,
-- email_verification_tokens, api_key_history.
--
-- Baseline por DOMÍNIO, escrita no ESTADO FINAL do schema. Este arquivo não tem
-- um único ALTER que desfaça o que ele mesmo cria: o CHECK de `role` nasce com
-- os quatro papéis, `sessions_valid_from` e `producer_org_id` nascem como
-- colunas. O histórico de como o schema chegou aqui vive no git, não em degraus.

-- ============================================================================
-- GUARDA DE BANCO PRÉ-CONSOLIDAÇÃO
-- ============================================================================
-- O runner casa arquivo com linha de `_migrations` pelo NOME, sem checksum. Um
-- banco criado antes da consolidação tem 22 linhas, nenhuma casando com estes
-- nomes, então o runner tentaria aplicar tudo de novo e o primeiro
-- `CREATE TABLE organizations` estouraria com 42P07 "relation already exists" —
-- uma mensagem que não diz o que aconteceu. Este bloco falha alto e explica.
--
-- `_migrations` já existe quando este arquivo roda: o runner a cria antes do
-- laço (src/database/migrate.js).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _migrations WHERE name IN ('001_core.sql','002_atlas.sql','003_sync.sql')) THEN
    RAISE EXCEPTION 'Banco criado antes da consolidacao de migracoes (F15). O historico '
      'incremental foi esmagado em baselines por dominio e este schema NAO e alcancavel '
      'por upgrade. Em desenvolvimento: node scripts/dev-db.js recreate.';
  END IF;
END $$;

-- ============================================================================
-- EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()

-- ============================================================================
-- ORGANIZATIONS (multi-org; precede users por causa da FK organization_id)
-- ============================================================================
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        VARCHAR(255) NOT NULL,
    slug        VARCHAR(100) UNIQUE NOT NULL,
    sigla       VARCHAR(50),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Org padrão determinística (id fixo para backfill idempotente + testes).
INSERT INTO organizations (id, nome, slug, sigla)
VALUES ('00000000-0000-0000-0000-000000000001', 'Organização Padrão', 'default', 'DEFAULT')
ON CONFLICT (slug) DO NOTHING;

-- Organizações militares (OMs) — a lista controlada de organizações que o cadastro usa
-- (FK users.organization_id). O admin cura o resto pela aba "Pessoal" (módulo organizations).
INSERT INTO organizations (nome, slug, sigla) VALUES
  ('Diretoria de Serviço Geográfico',                          'dsg',    'DSG'),
  ('Centro de Imagens e Informações Geográficas do Exército',  'cigex',  'CIGEx'),
  ('1º Centro de Geoinformação',                               '1-cgeo', '1º CGEO'),
  ('2º Centro de Geoinformação',                               '2-cgeo', '2º CGEO'),
  ('3º Centro de Geoinformação',                               '3-cgeo', '3º CGEO'),
  ('4º Centro de Geoinformação',                               '4-cgeo', '4º CGEO'),
  ('5º Centro de Geoinformação',                               '5-cgeo', '5º CGEO')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- RANKS (postos/graduações — lista controlada do cadastro, FK users.rank_id;
-- seed de dominio.tipo_posto_grad, code -> sort_order, nome_abrev = abreviação).
-- ============================================================================
CREATE TABLE ranks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        SMALLINT,
    nome        VARCHAR(255) NOT NULL,
    nome_abrev  VARCHAR(50),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ranks_active ON ranks(sort_order) WHERE is_active;

INSERT INTO ranks (code, nome, nome_abrev, sort_order) VALUES
  (1,  'Civil',                  'Civ',     1),
  (2,  'Mão de Obra Temporária', 'MOT',     2),
  (3,  'Soldado EV',             'Sd EV',   3),
  (4,  'Soldado EP',             'Sd EP',   4),
  (5,  'Cabo',                   'Cb',      5),
  (6,  'Terceiro Sargento',      '3º Sgt',  6),
  (7,  'Segundo Sargento',       '2º Sgt',  7),
  (8,  'Primeiro Sargento',      '1º Sgt',  8),
  (9,  'Subtenente',             'ST',      9),
  (10, 'Aspirante',              'Asp',    10),
  (11, 'Segundo Tenente',        '2º Ten', 11),
  (12, 'Primeiro Tenente',       '1º Ten', 12),
  (13, 'Capitão',                'Cap',    13),
  (14, 'Major',                  'Maj',    14),
  (15, 'Tenente Coronel',        'TC',     15),
  (16, 'Coronel',                'Cel',    16),
  (17, 'General de Brigada',     'Gen Bda',17),
  (18, 'General de Divisão',     'Gen Div',18),
  (19, 'General de Exército',    'Gen Ex', 19);

-- ============================================================================
-- USERS
-- rank_id (FK ranks) é o posto/graduação; organization_id (FK organizations) é a OM.
-- Ambos NULLABLE (contas sem dados / tokens legados degradam para null).
-- ============================================================================
--
-- OS QUATRO PAPÉIS GLOBAIS NÃO SÃO UMA ESCADA. 'user', 'producer', 'credenciado'
-- e 'admin' não se contêm: nenhum deles é "o de cima" de outro, e comparar papel
-- global por ordem (>=, índice em array, ROLE_ORDER) é erro de leitura, não
-- otimização. O eixo POR ATLAS (read < comment < write < manage < owner) É uma
-- escada, é gateado pela hierarquia, e não compartilha uma palavra com este.
--
--   user         quem entra e usa. Sem nada de global.
--   producer     MANTÉM o que a OM dele produziu (catálogo e projetos 360 daquela
--                OM). Escopo em `producer_org_id`. Escreve, e só dentro do escopo.
--   credenciado  LÊ todo recurso privado do sistema e NÃO ESCREVE NADA. Não passa
--                em requireAdmin, não vira dono de atlas, não edita catálogo, não
--                abre lixeira global, não vira 'admin' em toFrontendRole.
--   admin        administra o sistema.
--
-- O risco deste eixo é o INVERSO do usual em gate de permissão: não é excluir o
-- nível de cima com uma lista fechada, é alguém escrever `if (role !== 'user')`
-- num gate de PODER e promover o credenciado ou o produtor em silêncio.
-- `backend/tests/unit/papel-global-censo.test.js` classifica cada sítio e reprova
-- o que aparecer sem classificação.
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username            VARCHAR(100) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    role                VARCHAR(20) NOT NULL DEFAULT 'user'
                          CHECK (role IN ('user','producer','credenciado','admin')),

    -- Personal info (Brazilian military context)
    nome                VARCHAR(255) NOT NULL,
    rank_id             UUID REFERENCES ranks(id),

    -- Multi-org: organization_id é a LOTAÇÃO (FK); papel org-scoped (vocabulário
    -- UserRole do frontend). Repare que `organization_id` NÃO AUTORIZA nada: ele é
    -- auto-declarado no auto-cadastro (`POST /auth/register` aceita a OM de
    -- qualquer organização ativa), então autorizar por ele seria escalação de
    -- privilégio por formulário público. O eixo de OM que autoriza é o de PRODUÇÃO
    -- (`producer_org_id`, abaixo), que só um administrador concede.
    --
    -- ANOTADO EM 2026-08-21, sem tocar em DDL: o parêntese acima dizia também que
    -- "conta sem e-mail nasce ativa na hora", e isso deixou de valer quando o e-mail
    -- virou obrigatório no auto-cadastro. Não confunda com a frase do bloco de
    -- `email` abaixo, que continua verdadeira e fala de OUTRO caminho: conta criada
    -- por ADMINISTRADOR não tem e-mail e nasce ativa mesmo. O argumento que este
    -- comentário sustenta (lotação não autoriza) nunca dependeu da metade errada.
    -- Corrigido AQUI, e não no cabeçalho da próxima migração, porque isto é
    -- COMENTÁRIO e não DDL: quem lê a coluna encontra o argumento neste arquivo, e
    -- um erro corrigido três arquivos adiante continua sendo lido como verdade.
    organization_id     UUID REFERENCES organizations(id),
    org_role            VARCHAR(20) NOT NULL DEFAULT 'viewer'
                          CHECK (org_role IN ('owner','admin','editor','viewer')),

    -- Chave de API M2M (live key na linha quente; histórico/rotação à parte).
    api_key             UUID UNIQUE,

    -- Self-registration e-mail confirmation. NULLABLE: username stays the login key, and
    -- accounts created without an e-mail (admin-created, legacy, M2M) are immediately active.
    -- When email IS NOT NULL, login is gated on email_verified (see auth.service login).
    email               VARCHAR(255),
    email_verified      BOOLEAN NOT NULL DEFAULT FALSE,

    -- Metadata
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at       TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,

    -- O CORTE DE SESSÃO. Dá à revogação em massa um efeito que o caminho VIVO de
    -- auth enxerga: `REVOKE_ALL_USER_TOKENS` carimba `refresh_tokens.revoked_at`, e
    -- nada no caminho de requisição lê aquela tabela — o middleware estrito e a
    -- renovação deslizante de `flexible-auth.js` reconciliam por `getLiveAuthState`,
    -- que olha só `is_active`/`role`/`organization`. Sem este marcador, revogar a
    -- família encerra a capacidade de ROTACIONAR e mais nada, e a renovação
    -- deslizante reemite o access token para sempre a quem fizer uma requisição a
    -- cada menos de 15 min.
    --
    -- NULLABLE E SEM DEFAULT, DE PROPÓSITO. NULL significa "nunca houve corte". Um
    -- `DEFAULT NOW()` retroagiria um corte para toda conta do banco e invalidaria
    -- toda sessão viva de uma vez; um NOT NULL obrigaria a isso. O lado de leitura
    -- trata NULL como "sem marcador, o token passa" (utils/org-status.js,
    -- `tokenPredatesSessionCut`): NULL nunca pode significar "tudo é inválido".
    --
    -- RESOLUÇÃO. O `iat` de um JWT tem resolução de SEGUNDO; esta coluna tem
    -- microssegundo. O leitor trunca o marcador para segundos inteiros antes de
    -- comparar, e o segundo que os dois compartilham é ambíguo. Esse segundo é
    -- RECUSADO (`iat <= floor(cut)`): fail closed, porque a rejeição a mais é um 401
    -- do qual o cliente já se recupera e a rejeição a menos é um buraco silencioso.
    sessions_valid_from TIMESTAMPTZ,

    -- O ESCOPO DE PRODUÇÃO. UMA OM SÓ, e é decisão de produto, não limitação
    -- técnica: quem mantém o que várias OMs produzem é administrador. Uma tabela de
    -- junção (usuário x OM) caberia no schema e foi recusada porque transformaria
    -- "quem produz isto?" numa pergunta com resposta plural, e o gate de escrita
    -- precisa de resposta única.
    --
    -- NÃO EXPIRA, e a assimetria com `resource_grants.expires_at` é deliberada:
    -- concessão de acesso é favor e caduca; ser produtor é FUNÇÃO, e função se tira
    -- por ato de administração, não por relógio. Um `expires_at` aqui faria a OM
    -- perder o mantenedor do próprio acervo num aniversário que ninguém marcou.
    --
    -- É `REFERENCES organizations(id)` e não uma cópia do slug porque a OM pode ser
    -- renomeada, e porque o gate de produção compara ESTE valor com a coluna dona do
    -- recurso (`owner_org_id` / `sv360.projects.organization_id`), que também é FK.
    producer_org_id     UUID REFERENCES organizations(id),

    -- O BICONDICIONAL: crachá sem escopo e escopo sem crachá são os DOIS estados
    -- impossíveis, e um CHECK unidirecional só pegaria um deles.
    --
    --   (producer, OM)      OK   -- produtor com escopo
    --   (producer, NULL)    NÃO  -- crachá sem escopo: produz o quê, de quem?
    --   (user, OM)          NÃO  -- escopo sem crachá: sobra de rebaixamento, e é o
    --                            --   estado perigoso, porque o dia em que alguém
    --                            --   promover essa conta de volta ela reencontra um
    --                            --   escopo que ninguém reviu
    --   (user, NULL)        OK
    --
    -- Repare que o bicondicional é sobre 'producer', NÃO sobre "não é user":
    -- (admin, OM) e (credenciado, OM) também são recusados. Admin não tem escopo
    -- porque alcança todos, e credenciado não escreve nada — dar escopo a qualquer um
    -- dos dois seria escrever uma segunda resposta para "quem produz por esta OM".
    --
    -- NENHUM DOS DOIS LADOS PODE SER NULL, então o CHECK nunca degrada para o
    -- "desconhecido = passa" do SQL: `role` é NOT NULL e `IS NOT NULL` devolve
    -- booleano sempre. Um CHECK que pode dar NULL é um CHECK que aprova em silêncio.
    --
    -- CUSTO CONHECIDO, e é da borda de escrita, não daqui: um UPDATE parcial (mudar
    -- `role` sem limpar `producer_org_id`, ou o inverso) bate aqui com 23514, que o
    -- `errorHandler` não mapeia e devolve como 500. O espelho deste bicondicional no
    -- Joi de `users.schemas.js` é o que transforma isso em 422 com nome de campo.
    CONSTRAINT users_producer_scope_check
      CHECK ((role = 'producer') = (producer_org_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_users_username_lower ON users(LOWER(username));
-- Case-insensitive unique e-mail (partial: NULL e-mails are allowed and not unique-constrained).
CREATE UNIQUE INDEX idx_users_email_lower ON users(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_organization ON users(organization_id);
-- Índice PARCIAL no lado pequeno: produtores são poucos e a pergunta que a tela de
-- administração faz é "quem produz por esta OM?". O gate de escrita NÃO usa este
-- índice — ele resolve o usuário pela PK.
CREATE INDEX idx_users_producer_org ON users(producer_org_id)
  WHERE producer_org_id IS NOT NULL;

COMMENT ON COLUMN users.sessions_valid_from IS
  'Session cut-off: an access token whose JWT iat predates this instant is refused. '
  'NULL = never cut. Written together with the refresh-family revocation.';

-- ============================================================================
-- REFRESH TOKENS (for logout revocation support)
-- ============================================================================
CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash) WHERE revoked_at IS NULL;

-- ============================================================================
-- EMAIL VERIFICATION TOKENS (self-registration confirmation). The token UUID is
-- the secret carried in the verification link; it is single-use (consumed_at) and
-- expiring (expires_at). Cascades on user delete.
-- ============================================================================
CREATE TABLE email_verification_tokens (
    token       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_email_verification_user ON email_verification_tokens(user_id);

-- ============================================================================
-- API KEY HISTORY (rotação/revogação das chaves M2M)
-- ============================================================================
CREATE TABLE api_key_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    api_key     UUID NOT NULL,
    created_at  TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    revoked_by  UUID REFERENCES users(id),
    UNIQUE (user_id, api_key)
);
CREATE INDEX idx_api_key_history_user ON api_key_history(user_id);
