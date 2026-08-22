-- Path: src/database/migrations/004_sync.sql
-- SYNC: o LOG e o relógio, não as entidades. `operations` é o log CRDT
-- append-only, idempotente por op_id; `active_sessions` é o vocabulário de
-- presença. As entidades que o log escreve moram em 003_atlas.sql.

-- ============================================================================
-- OPERATIONS (CRDT sync log - append-only)
-- Idempotência: op_id vem do cliente; reenvio colide em (atlas_id, op_id) e é
-- ignorado no push (INSERT ... ON CONFLICT DO NOTHING). op_id NULL fica distinto.
-- ============================================================================
CREATE SEQUENCE atlas_version_seq;

CREATE TABLE operations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atlas_id            UUID NOT NULL REFERENCES atlas(id) ON DELETE CASCADE,

    -- Operation data
    op_type             VARCHAR(20) NOT NULL CHECK (op_type IN ('create', 'update', 'delete')),
    entity_type         VARCHAR(50) NOT NULL,
    entity_id           UUID NOT NULL,
    map_id              UUID,

    -- Payload (mutually exclusive: creates use data, updates use changes)
    changes             JSONB,
    data                JSONB,

    -- Conflict resolution metadata. client_id é TEXT (id string do frontend).
    client_timestamp    BIGINT NOT NULL,
    client_id           TEXT NOT NULL,
    server_version      BIGINT NOT NULL DEFAULT nextval('atlas_version_seq'),

    -- Lamport clock (lógico) carregado pela op do frontend. NÃO decide o vencedor
    -- (LWW é por ordem de chegada ao servidor) — persistido só para ecoar no pull
    -- incremental, deixando o cliente avançar seu Lamport clock a cada op recebida.
    lamport_timestamp   BIGINT,

    -- Idempotência: id da operação fornecido pelo cliente (TEXT, formato livre).
    op_id               TEXT,

    -- Audit
    user_id             UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary index for incremental sync: "give me all ops after version X for this atlas"
CREATE INDEX idx_operations_atlas_version ON operations(atlas_id, server_version);
CREATE INDEX idx_operations_entity ON operations(entity_type, entity_id);
CREATE INDEX idx_operations_atlas_created ON operations(atlas_id, created_at);

-- Uniqueness per atlas para idempotência do push.
CREATE UNIQUE INDEX operations_atlas_op_id_uniq ON operations (atlas_id, op_id);

-- Trigger to update atlas.current_version when operations are inserted
CREATE FUNCTION update_atlas_current_version()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE atlas
  SET current_version = NEW.server_version,
      updated_at = NOW()
  WHERE id = NEW.atlas_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_atlas_version
AFTER INSERT ON operations
FOR EACH ROW
EXECUTE FUNCTION update_atlas_current_version();

-- ============================================================================
-- ACTIVE SESSIONS — o vocabulário de presença. RESERVADA E SEM ESCRITOR: a presença
-- viva é o `Map` em memória de `collab.rooms.js`, e nenhum SELECT desta tabela existe em
-- `backend/src`. As escritas antigas eram fire-and-forget, sem reaper, e todo restart com
-- usuário conectado orfanava as linhas em silêncio.
--
-- FICA POR ESCOLHA, e num schema reescrito do zero isso é decisão e não inércia: o
-- vocabulário de presença é o que uma implementação futura vai querer encontrar.
-- RESSUSCITAR ISTO COMEÇA PELO LEITOR, NUNCA PELO INSERT.
-- ============================================================================
CREATE TABLE active_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    atlas_id            UUID NOT NULL REFERENCES atlas(id),
    client_id           TEXT NOT NULL,

    connected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Presence data
    cursor_position     JSONB,                        -- { lng, lat }
    current_map_id      UUID,
    selected_features   UUID[] DEFAULT '{}',

    UNIQUE(user_id, atlas_id, client_id)
);

CREATE INDEX idx_sessions_atlas ON active_sessions(atlas_id);
CREATE INDEX idx_sessions_heartbeat ON active_sessions(last_heartbeat);
