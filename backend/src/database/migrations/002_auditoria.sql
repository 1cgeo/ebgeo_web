-- Path: src/database/migrations/002_auditoria.sql
-- AUDITORIA: a trilha de negócio queryable e transacional. Distinta do log
-- operacional (arquivos), que é volume e não evidência.
--
-- POR QUE ARQUIVO PRÓPRIO, e não dentro de identidade: o vocabulário desta tabela
-- é a UNIÃO dos vocabulários de todos os domínios (zona vem do `ng`,
-- PRODUCER_SCOPE_CHANGE vem de identidade, CONFIG_CLEAR vem de catálogo), então
-- ela não muda junto com usuário — muda junto com a funcionalidade que emite o
-- evento. Como não tem FK nenhuma, a posição no encadeamento é livre.

-- ============================================================================
-- AUDIT TRAIL
-- ============================================================================
--
-- `actor_id` NÃO TEM FK, e é deliberado: o log precisa sobreviver ao delete do
-- usuário que agiu. Alternativa recusada por extenso em docs/wiki/auditoria.md.
--
-- `target_id` É TEXT porque o id de recurso é heterogêneo por construção: slug
-- VARCHAR nas quatro tabelas de catálogo, UUID em `sv360.projects`, e a chave
-- textual `app_config` em `config_settings`. A alternativa (uma coluna por
-- formato) multiplicaria a pergunta "o que aconteceu com este alvo?" por três.
-- Enquanto a coluna foi UUID, o alvo era empurrado para dentro de `details` e
-- 'SYSTEM' virou depósito de alvo que não coube: `idx_audit_target` não
-- respondia "tudo que já foi feito com este recurso". 'SYSTEM' significa sistema.
CREATE TABLE audit_trail (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- AS AÇÕES. Duas naturezas de buraco fecharam aqui, e vale distinguir porque
    -- a segunda é a que envergonha:
    --
    -- (a) ESCRITAS QUE NUNCA DEIXARAM RASTRO. CRUD de catálogo inteiro (que sob o
    --     escopo de produção deixa de ser só-admin e passa a ter N autores),
    --     `config_settings` (o documento único de boot, cujo override muda o app
    --     para todo mundo), ingestão e exclusão de projeto 360, criação de atlas,
    --     purga de concessões, mudança de escopo de produção.
    --
    -- (b) AÇÕES DECLARADAS QUE NUNCA TIVERAM EMISSOR. `LOGIN`, `LOGOUT` e
    --     `ATLAS_DELETE` estão declaradas desde o primeiro dia. Uma ação declarada
    --     sem emissor é um verde que não verifica nada: quem filtrar a trilha por
    --     `ATLAS_DELETE` recebe lista vazia e conclui que ninguém apagou atlas.
    --     `tests/unit/auditoria-censo.test.js` é quem cobra isso, com piso
    --     decrescente.
    --
    -- POR QUE `PRODUCER_SCOPE_CHANGE` É AÇÃO PRÓPRIA E NÃO DETALHE DE `ROLE_CHANGE`:
    -- o bicondicional de `users_producer_scope_check` permite transferir um produtor
    -- de OM SEM mudar o papel, e nesse evento não há `ROLE_CHANGE` nenhum para
    -- carregar o detalhe.
    --
    -- POR QUE `CONFIG_CLEAR` É SEPARADA DE `CONFIG_UPDATE`: uma edita chaves, a
    -- outra é a válvula que apaga TODOS os overrides de uma vez. Distinguir mantém
    -- a trilha filtrável, que é o propósito inteiro da coluna.
    --
    -- POR QUE EDIÇÃO DE ZONA GEOGRÁFICA TEM AÇÃO PRÓPRIA: a GEOMETRIA de uma zona é
    -- fronteira de acesso, não decoração. Redesenhar um polígono muda em silêncio
    -- quem lê quais topônimos privados, com o mesmo efeito de conceder ou revogar.
    -- Reusar PERMISSION_GRANT/REVOKE seria errado (um create não é um grant) e
    -- SHARING_CHANGE é vocabulário de atlas.
    --
    -- POR QUE CALIBRAÇÃO DE FOTO 360 FICA DE FORA, e é decisão e não esquecimento:
    -- é evento de altíssima frequência, a foto já carrega `updated_at`, e uma linha
    -- por ajuste afogaria a trilha no ruído que menos importa. A auditoria de 360 é
    -- no nível do PROJETO, que é onde as decisões de acesso acontecem.
    --
    -- `LOGIN_FAILED` fica de fora por IMPOSSIBILIDADE ESTRUTURAL, não por escolha:
    -- `actor_id` é NOT NULL e um login que falhou não tem ator identificado. Login
    -- falho continua só no log operacional.
    --
    -- O valor mais longo é `PRODUCER_SCOPE_CHANGE` (21 caracteres); a coluna é
    -- VARCHAR(50).
    action      VARCHAR(50) NOT NULL
                CHECK (action IN (
                  'LOGIN','LOGOUT','USER_CREATE','USER_UPDATE','USER_DELETE',
                  'PASSWORD_RESET','API_KEY_ROTATE','ROLE_CHANGE',
                  'ORG_CREATE','ORG_UPDATE','ORG_DELETE',
                  'ATLAS_DELETE','SHARING_CHANGE','PERMISSION_GRANT','PERMISSION_REVOKE',
                  -- ciclo de vida do atlas: `ATLAS_DELETE` existia sozinho, sem o ato que cria
                  -- nem os dois que mudam o dono e desfazem a exclusão. Meia história.
                  'ATLAS_CREATE','ATLAS_RESTORE','ATLAS_TRANSFER',
                  -- catálogo: sob o escopo de produção o autor deixa de ser sempre o admin
                  'CATALOG_CREATE','CATALOG_UPDATE','CATALOG_DELETE',
                  -- config_settings: override do documento de boot, e a válvula que o zera
                  'CONFIG_UPDATE','CONFIG_CLEAR',
                  -- escopo de produção, que muda sem o papel mudar
                  'PRODUCER_SCOPE_CHANGE',
                  -- 360 no nível do projeto (ingestão, hard-delete, eixo de ocultação)
                  'SV360_INGEST','SV360_DELETE','SV360_STATUS_CHANGE',
                  -- hard-delete de concessões arrastado pelo sumiço do recurso. Fica na
                  -- família PERMISSION_* de propósito: quem filtra a família acha a purga
                  -- junto com a concessão e a revogação, que é o que se quer ao investigar
                  -- um acesso.
                  'PERMISSION_PURGE',
                  -- simetria com USER_DELETE, que já auditava sozinho
                  'USER_REACTIVATE'
                )),
    actor_id    UUID NOT NULL,

    -- OS TIPOS DE ALVO. As QUATRO tabelas de catálogo entram, e não só as que têm
    -- tipo de concessão: o CRUD auditado é de todas. `CONFIG` é o alvo de
    -- CONFIG_UPDATE/CONFIG_CLEAR, e é o segundo sítio que só existe porque
    -- `target_id` é TEXT: o alvo é a chave `app_config`, que nunca foi UUID.
    --
    -- `MODEL`, `GROUP` e `STREETVIEW_MARKER` estão declarados e NÃO têm emissor
    -- nenhum. Os três são buraco conhecido, registrado com motivo escrito em
    -- `tests/unit/auditoria-censo.test.js`; `STREETVIEW_MARKER` em particular
    -- sobrevive à tabela homônima, que saiu do sistema, porque linhas de trilha já
    -- gravadas podem carregar o valor.
    --
    -- O valor mais longo é `STREETVIEW_MARKER` (17 caracteres); a coluna é VARCHAR(20).
    target_type VARCHAR(20) CHECK (target_type IN (
                  'USER','GROUP','MODEL','SYSTEM','ATLAS','ORG',
                  'BASEMAP','DATA_LAYER','ANALYSIS_LAYER','TILESET','STREETVIEW_MARKER',
                  'SV360_PROJECT','CONFIG'
                )),
    target_id   TEXT,
    target_name VARCHAR(255),
    details     JSONB,
    ip          VARCHAR(45) NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_actor ON audit_trail(actor_id);
CREATE INDEX idx_audit_target ON audit_trail(target_type, target_id);
CREATE INDEX idx_audit_action ON audit_trail(action);
CREATE INDEX idx_audit_created ON audit_trail(created_at DESC);
CREATE INDEX idx_audit_created_act ON audit_trail(created_at DESC, action);
CREATE INDEX idx_audit_details_gin ON audit_trail USING GIN (details);
