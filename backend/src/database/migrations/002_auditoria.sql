-- Path: src/database/migrations/002_auditoria.sql
-- AUDITORIA: a trilha de negócio, queryable e transacional. Distinta do log
-- operacional (arquivos), que é volume e não evidência.
--
-- Arquivo próprio porque o vocabulário desta tabela é a UNIÃO dos vocabulários de
-- todos os domínios: ela muda junto com a funcionalidade que emite o evento, nunca
-- junto com usuário. Sem FK nenhuma, então a posição no encadeamento é livre.

CREATE TABLE audit_trail (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ação declarada sem emissor é verde que não verifica nada: quem filtrar por
    -- `ATLAS_DELETE` recebe lista vazia e conclui que ninguém apagou atlas. Os
    -- buracos conhecidos são cobrados, com piso decrescente, por
    -- `tests/unit/auditoria-censo.test.js`.
    --
    -- Distinções que parecem redundância e não são:
    --   `PRODUCER_SCOPE_CHANGE` não é detalhe de `ROLE_CHANGE`, porque transferir um
    --     produtor de OM não muda o papel e não emitiria `ROLE_CHANGE` nenhum.
    --   `CONFIG_CLEAR` não é `CONFIG_UPDATE`: uma edita chaves, a outra zera TODOS
    --     os overrides do documento de boot.
    --   `PERMISSION_PURGE` fica na família `PERMISSION_*` de propósito: quem filtra
    --     a família ao investigar um acesso acha a purga junto da concessão.
    --   As cinco de grupo separam ciclo de vida (criar/renomear/apagar) de
    --     composição (entrar/sair): "quem criou este grupo" e "desde quando o Fulano
    --     estava nele" são perguntas diferentes na investigação.
    --
    -- FORA por decisão: calibração de foto 360 (altíssima frequência, e a foto já
    -- tem `updated_at`; a auditoria de 360 é no nível do PROJETO). Fora por
    -- IMPOSSIBILIDADE: `LOGIN_FAILED`, porque `actor_id` é NOT NULL e um login que
    -- falhou não tem ator.
    --
    -- Conceder a um GRUPO continua emitindo `PERMISSION_GRANT`: o fato auditado é o
    -- mesmo (o acesso a esta coisa mudou), e separar por tipo de beneficiário
    -- partiria a história de um acesso em duas listas que não se cruzam.
    --
    -- O valor mais longo é `ACCESS_GROUP_MEMBER_REMOVE` (26); a coluna é VARCHAR(50).
    action      VARCHAR(50) NOT NULL
                CHECK (action IN (
                  'LOGIN','LOGOUT','USER_CREATE','USER_UPDATE','USER_DELETE',
                  'PASSWORD_RESET','API_KEY_ROTATE','ROLE_CHANGE',
                  'ORG_CREATE','ORG_UPDATE','ORG_DELETE',
                  'ATLAS_DELETE','SHARING_CHANGE','PERMISSION_GRANT','PERMISSION_REVOKE',
                  'ATLAS_CREATE','ATLAS_RESTORE','ATLAS_TRANSFER',
                  'CATALOG_CREATE','CATALOG_UPDATE','CATALOG_DELETE',
                  'CONFIG_UPDATE','CONFIG_CLEAR',
                  'PRODUCER_SCOPE_CHANGE',
                  'SV360_INGEST','SV360_DELETE','SV360_STATUS_CHANGE',
                  'PERMISSION_PURGE',
                  'USER_REACTIVATE',
                  'ACCESS_GROUP_CREATE','ACCESS_GROUP_UPDATE','ACCESS_GROUP_DELETE',
                  'ACCESS_GROUP_MEMBER_ADD','ACCESS_GROUP_MEMBER_REMOVE',
                  'PERMISSION_REPARENT'
                )),

    -- Sem FK, e é deliberado: o log precisa sobreviver ao delete do usuário que
    -- agiu. Alternativa recusada por extenso em docs/wiki/auditoria.md.
    actor_id    UUID NOT NULL,

    -- `GROUP` é o grupo de FEIÇÃO de um mapa (`public.groups`), e NÃO serve ao grupo
    -- de acesso: reusá-lo misturaria as duas trilhas no mesmo balde de
    -- `idx_audit_target`. Daí `ACCESS_GROUP`, que qualifica como a tabela qualifica.
    --
    -- `MODEL`, `GROUP` e `STREETVIEW_MARKER` estão declarados e não têm emissor;
    -- são buraco conhecido, com motivo escrito no censo. `STREETVIEW_MARKER`
    -- sobrevive à tabela homônima, que saiu do sistema, porque linhas já gravadas
    -- podem carregar o valor.
    --
    -- O alvo de uma ação de MEMBRO é o GRUPO, nunca o usuário: investiga-se pela
    -- coisa cujo acesso mudou, e o usuário movido desce para `details`.
    --
    -- O valor mais longo é `STREETVIEW_MARKER` (17); a coluna é VARCHAR(20).
    target_type VARCHAR(20) CHECK (target_type IN (
                  'USER','GROUP','MODEL','SYSTEM','ATLAS','ORG',
                  'BASEMAP','DATA_LAYER','ANALYSIS_LAYER','TILESET','STREETVIEW_MARKER',
                  'SV360_PROJECT','CONFIG',
                  'ACCESS_GROUP'
                )),

    -- TEXT porque o id de recurso é heterogêneo por construção: slug nas quatro
    -- tabelas de catálogo, UUID em `sv360.projects`, chave textual `app_config` em
    -- `config_settings`. Enquanto foi UUID, o alvo era empurrado para `details` e
    -- 'SYSTEM' virou depósito do que não coube, com `idx_audit_target` deixando de
    -- responder "tudo que já foi feito com este recurso". 'SYSTEM' significa sistema.
    target_id   TEXT,
    target_name VARCHAR(255),
    details     JSONB,
    ip          VARCHAR(45) NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A OM DONA DO RECURSO ALVO, na época do ato: não é a OM do ator e não é a lotação
    -- dele. É o que permite perguntar "o que aconteceu com o acervo desta OM" sem
    -- reconstruir a posse a partir do estado de hoje, que já mudou.
    --
    -- POR ÚLTIMO, e não ao lado de `target_name`, onde a leitura pediria: a coluna nasceu
    -- num `ALTER TABLE ADD COLUMN` e a ordem das colunas é observável.
    target_org_id UUID
);
CREATE INDEX idx_audit_actor ON audit_trail(actor_id);
CREATE INDEX idx_audit_target ON audit_trail(target_type, target_id);
CREATE INDEX idx_audit_action ON audit_trail(action);
CREATE INDEX idx_audit_created ON audit_trail(created_at DESC);
CREATE INDEX idx_audit_created_act ON audit_trail(created_at DESC, action);
CREATE INDEX idx_audit_details_gin ON audit_trail USING GIN (details);
-- Parcial: a maioria das linhas não tem OM dona (ato de sistema, acervo institucional).
CREATE INDEX idx_audit_target_org
    ON audit_trail (target_org_id, created_at DESC)
 WHERE target_org_id IS NOT NULL;

COMMENT ON COLUMN audit_trail.target_org_id IS
  'OM dona do RECURSO ALVO na epoca do ato (nao a OM do ator, nao a lotacao). '
  'Gravada pelo emissor; NULL para alvo sem OM dona e para acervo institucional.';
