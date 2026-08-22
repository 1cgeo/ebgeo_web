-- Path: src/database/migrations/001_identidade.sql
-- IDENTIDADE: quem é o chamador. organizations, ranks, users (campos militares
-- BR, OM, papéis globais, escopo de produção, api_key), refresh_tokens,
-- email_verification_tokens, api_key_history.
--
-- Baseline por DOMÍNIO, escrita no ESTADO FINAL do schema: nenhum ALTER aqui
-- desfaz o que este mesmo arquivo criou. O histórico de como o schema chegou aqui
-- vive no git, não em degraus.

-- ============================================================================
-- GUARDA DE BANCO PRÉ-CONSOLIDAÇÃO
-- ============================================================================
-- O runner casa arquivo com linha de `_migrations` pelo NOME, sem checksum. Um
-- banco criado antes da consolidação tem nomes que não casam com nenhum destes,
-- então o runner tentaria aplicar tudo de novo e o primeiro `CREATE TABLE`
-- estouraria com 42P07, mensagem que não diz o que aconteceu. Este bloco falha
-- alto e explica. (`_migrations` já existe: o runner a cria antes do laço.)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _migrations WHERE name IN ('001_core.sql','002_atlas.sql','003_sync.sql')) THEN
    RAISE EXCEPTION 'Banco criado antes da consolidacao de migracoes. O historico '
      'incremental foi esmagado em baselines por dominio e este schema NAO e alcancavel '
      'por upgrade. Em desenvolvimento: node scripts/dev-db.js recreate.';
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- gen_random_uuid()

-- ============================================================================
-- ORGANIZATIONS (precede users por causa da FK organization_id)
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

-- Org padrão com id FIXO: é o alvo de backfill idempotente e de fixture de teste.
INSERT INTO organizations (id, nome, slug, sigla)
VALUES ('00000000-0000-0000-0000-000000000001', 'Organização Padrão', 'default', 'DEFAULT')
ON CONFLICT (slug) DO NOTHING;

-- Lista controlada que o cadastro usa (FK users.organization_id). O administrador
-- cura o resto pela aba "Pessoal".
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
-- RANKS (postos/graduações; FK users.rank_id)
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
-- ============================================================================
-- OS QUATRO PAPÉIS GLOBAIS NÃO SÃO UMA ESCADA: nenhum contém o outro, e comparar
-- papel global por ordem é erro de leitura. O eixo POR ATLAS
-- (read < comment < write < manage < owner) É escada, e não compartilha uma
-- palavra com este.
--
--   user         entra e usa; nada de global.
--   producer     MANTÉM o que a OM dele produziu. Escopo em `producer_org_id`.
--   credenciado  LÊ todo recurso privado e NÃO ESCREVE NADA (a única escrita dele
--                é administrar grupo de acesso). Não passa em requireAdmin.
--   admin        administra o sistema.
--
-- O risco aqui é o INVERSO do usual: não é excluir o nível de cima com uma lista
-- fechada, é escrever `if (role !== 'user')` num gate de PODER e promover o
-- credenciado em silêncio. `tests/unit/papel-global-censo.test.js` classifica cada
-- sítio e reprova o não classificado.
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username            VARCHAR(100) UNIQUE NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    role                VARCHAR(20) NOT NULL DEFAULT 'user'
                          CHECK (role IN ('user','producer','credenciado','admin')),

    nome                VARCHAR(255) NOT NULL,
    rank_id             UUID REFERENCES ranks(id),

    -- LOTAÇÃO, e ela NÃO AUTORIZA NADA: é auto-declarada no auto-cadastro (que
    -- aceita qualquer OM ativa), então autorizar por ela seria escalação de
    -- privilégio por formulário público. O eixo de OM que autoriza é o de PRODUÇÃO.
    organization_id     UUID REFERENCES organizations(id),
    org_role            VARCHAR(20) NOT NULL DEFAULT 'viewer'
                          CHECK (org_role IN ('owner','admin','editor','viewer')),

    -- Chave M2M viva; o histórico de rotação fica em api_key_history.
    api_key             UUID UNIQUE,

    -- NULLABLE: o username continua sendo a chave de login, e conta criada sem
    -- e-mail nasce ativa. Com e-mail, o login é gateado por email_verified.
    email               VARCHAR(255),
    email_verified      BOOLEAN NOT NULL DEFAULT FALSE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at       TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,

    -- O CORTE DE SESSÃO, que dá à revogação em massa um efeito que o caminho VIVO
    -- de auth enxerga: revogar a família carimba `refresh_tokens.revoked_at`, e
    -- nada no caminho de requisição lê aquela tabela. Sem este marcador, revogar
    -- encerra a capacidade de ROTACIONAR e mais nada, e a renovação deslizante
    -- reemite o access token para sempre a quem chamar a cada menos de 15 min.
    --
    -- NULLABLE E SEM DEFAULT: NULL significa "nunca houve corte", e um DEFAULT NOW()
    -- retroagiria um corte para toda conta do banco. O leitor trata NULL como "o
    -- token passa": NULL nunca pode significar "tudo é inválido".
    --
    -- O `iat` do JWT tem resolução de SEGUNDO e esta coluna tem microssegundo. O
    -- segundo compartilhado é ambíguo e é RECUSADO (`iat <= floor(cut)`): fail
    -- closed, porque rejeição a mais é um 401 do qual o cliente se recupera e
    -- rejeição a menos é buraco silencioso.
    sessions_valid_from TIMESTAMPTZ,

    -- O ESCOPO DE PRODUÇÃO. UMA OM SÓ, por decisão de produto: quem mantém o que
    -- várias OMs produzem é administrador. Uma tabela de junção caberia no schema e
    -- foi recusada porque tornaria "quem produz isto?" uma pergunta de resposta
    -- plural, e o gate de escrita precisa de resposta única.
    --
    -- NÃO EXPIRA, e a assimetria com `resource_grants.expires_at` é deliberada:
    -- concessão é favor e caduca; ser produtor é FUNÇÃO, e função se tira por ato
    -- de administração, não por relógio.
    producer_org_id     UUID REFERENCES organizations(id),

    -- BICONDICIONAL: crachá sem escopo e escopo sem crachá são os DOIS estados
    -- impossíveis, e um CHECK unidirecional só pegaria um deles.
    --   (producer, OM)   OK      (producer, NULL) NÃO: produz o quê, de quem?
    --   (user, NULL)     OK      (user, OM)       NÃO: sobra de rebaixamento, e é o
    --                                             estado perigoso, porque promover a
    --                                             conta de volta reencontra um escopo
    --                                             que ninguém reviu.
    -- É sobre 'producer', NÃO sobre "não é user": (admin, OM) e (credenciado, OM)
    -- também são recusados. Nenhum dos dois lados pode ser NULL, então o CHECK nunca
    -- degrada para o "desconhecido = passa" do SQL.
    --
    -- CUSTO CONHECIDO, na borda de escrita: um UPDATE parcial bate aqui com 23514,
    -- que o errorHandler não mapeia e devolve como 500. O espelho no Joi de
    -- `users.schemas.js` é o que transforma isso em 422 com nome de campo.
    CONSTRAINT users_producer_scope_check
      CHECK ((role = 'producer') = (producer_org_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_users_username_lower ON users(LOWER(username));
-- Parcial: e-mail NULL é permitido e não entra no unique.
CREATE UNIQUE INDEX idx_users_email_lower ON users(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_organization ON users(organization_id);
-- Parcial no lado pequeno: produtores são poucos, e a pergunta é "quem produz por
-- esta OM?". O gate de escrita não usa este índice: resolve o usuário pela PK.
CREATE INDEX idx_users_producer_org ON users(producer_org_id)
  WHERE producer_org_id IS NOT NULL;

COMMENT ON COLUMN users.sessions_valid_from IS
  'Session cut-off: an access token whose JWT iat predates this instant is refused. '
  'NULL = never cut. Written together with the refresh-family revocation.';

-- ============================================================================
-- REFRESH TOKENS
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
-- EMAIL VERIFICATION TOKENS
-- ============================================================================
-- O UUID do token é o segredo que viaja no link: uso único (consumed_at) e com
-- prazo (expires_at).
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
