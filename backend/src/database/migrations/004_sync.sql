-- Path: src/database/migrations/004_sync.sql
-- SYNC: o LOG e o relógio, não as entidades. `operations` é o log CRDT
-- append-only, idempotente por op_id. A PRESENÇA NÃO TEM TABELA, e o porquê está no
-- bloco do fim deste arquivo. As entidades que o log escreve moram em 003_atlas.sql.

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
-- PRESENÇA NÃO TEM TABELA, E A AUSÊNCIA É A DECISÃO
-- ============================================================================
-- Havia aqui uma `active_sessions` com nove colunas, duas FKs, uma UNIQUE e dois índices.
-- Ela foi criada como vocabulário de presença e NUNCA teve leitor: a varredura de
-- `backend/src` não achava um `SELECT` sequer, e a estatística do banco confirmava pelo
-- outro lado (`n_tup_ins = 0`, todos os índices com `idx_scan = 0`). Os dois escritores
-- saíram em 2026-07-25, e a tabela ficou por um argumento que deixou de valer: "migração
-- é forward-only, derrubá-la seria DDL destrutiva". Depois da consolidação em baselines,
-- CRIAR a tabela é que passou a ser o ato deliberado -- e criar tabela morta é escolha.
-- Removida em 2026-08-23, por decisão do dono.
--
-- POR QUE ELA NÃO CONSEGUIA SER O QUE PARECIA. As escritas eram fire-and-forget, então um
-- connect seguido de close rápido podia commitar o DELETE antes do INSERT e orfanar a
-- linha; nada expurgava a tabela, e todo restart com usuário conectado orfanava em
-- silêncio TODA linha viva. Coluna viva pela metade engana mais que coluna ausente.
--
-- ONDE A PRESENÇA VIVE HOJE: no `Map` em memória de `collab.rooms.js`, por processo. Isso
-- casa com o deploy, que é de UMA instância por decisão (sem backplane, 2+ réplicas
-- quebrariam o broadcast antes de a persistência ajudar em algo).
--
-- SE A PRESENÇA DURÁVEL VOLTAR, ela começa pelo LEITOR, nunca pelo INSERT, e vem com
-- reaper e heartbeat no mesmo commit -- foi a ausência dos dois que matou a primeira
-- tentativa. Que nenhum caminho de socket escreve no banco é asserido, sem depender de
-- tabela nenhuma, por `tests/ws/collab-presenca-sem-banco.test.js`.
