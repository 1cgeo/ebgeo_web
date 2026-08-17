-- 017_resource_access.sql
--
-- Recursos privados e concessão em árvore, para os QUATRO tipos de recurso do
-- catálogo (modelo 3D, camada de dados, camada de análise, panorama 360).
--
-- Três peças, e nenhuma delas muda comportamento sozinha: a marca
-- público/privado nasce com DEFAULT 'public', então nenhuma linha existente sai
-- da tela até um administrador marcar alguma coisa. Esta migração cria o
-- vocabulário e a RESOLUÇÃO; quem consome vem nas fases seguintes.
--
-- Decisões registradas em docs/decisions/decisions-2026.md (entrada
-- "2026-08-16: recursos privados..."), com as alternativas recusadas por extenso.

-- ---------------------------------------------------------------------------
-- 1. A marca público/privado
-- ---------------------------------------------------------------------------
--
-- AS CINCO TABELAS DE CATÁLOGO, NÃO AS TRÊS EM USO. Elas nasceram de
-- `LIKE basemaps INCLUDING ALL` (003_sync.sql) e `catalog.service.js` roda a
-- MESMA string COLS contra as cinco; `catalog-tabelas-paridade.test.js` exige
-- conjuntos idênticos de (nome, tipo, nullable, default). Acrescentar a coluna
-- só onde ela é lida reprova aquele teste, que existe exatamente para pegar
-- esta classe de esquecimento. `basemaps` e `streetview_markers` ganham a
-- coluna e nunca a consultam.
ALTER TABLE basemaps           ADD COLUMN access_level VARCHAR(20) NOT NULL DEFAULT 'public'
  CHECK (access_level IN ('public','private'));
ALTER TABLE data_layers        ADD COLUMN access_level VARCHAR(20) NOT NULL DEFAULT 'public'
  CHECK (access_level IN ('public','private'));
ALTER TABLE analysis_layers    ADD COLUMN access_level VARCHAR(20) NOT NULL DEFAULT 'public'
  CHECK (access_level IN ('public','private'));
ALTER TABLE tilesets           ADD COLUMN access_level VARCHAR(20) NOT NULL DEFAULT 'public'
  CHECK (access_level IN ('public','private'));
ALTER TABLE streetview_markers ADD COLUMN access_level VARCHAR(20) NOT NULL DEFAULT 'public'
  CHECK (access_level IN ('public','private'));

-- 360: eixo ORTOGONAL ao `status`, e é por isso que a coluna é nova em vez de
-- um terceiro valor de status. `disabled` continua significando "oculto",
-- visível para a OM dona; `private` significa "não é público", visível para a
-- OM dona MAIS quem tem concessão. enabled+private é o caso novo (D6).
ALTER TABLE sv360.projects     ADD COLUMN access_level VARCHAR(20) NOT NULL DEFAULT 'public'
  CHECK (access_level IN ('public','private'));

-- Índices parciais no lado PRIVADO (o inverso do padrão de `ng`, que indexa o
-- lado público): o conjunto privado é o pequeno, e é ele que a resolução visita.
CREATE INDEX idx_tilesets_private        ON tilesets(id)        WHERE access_level = 'private';
CREATE INDEX idx_data_layers_private     ON data_layers(id)     WHERE access_level = 'private';
CREATE INDEX idx_analysis_layers_private ON analysis_layers(id) WHERE access_level = 'private';
CREATE INDEX idx_sv360_projects_private  ON sv360.projects(id)  WHERE access_level = 'private';

-- ---------------------------------------------------------------------------
-- 2. A tabela de concessões (a árvore)
-- ---------------------------------------------------------------------------
--
-- Concessão de acesso a UM recurso privado, para UM usuário, por UM concedente.
--
-- `resource_id` é TEXT e NÃO tem FK: o alvo pode estar em quatro tabelas com
-- tipos de chave diferentes (slug VARCHAR nas três de catálogo, UUID em
-- sv360.projects). Postgres não tem FK polimórfica, e as alternativas (uma
-- tabela por tipo, ou trigger de integridade) custam mais do que a órfã que
-- elas evitam. A órfã é contida por dois fatos: catálogo é SOFT-delete
-- (`active = false`, a linha fica) e o único hard-delete do sistema é
-- `DELETE /sv360/admin/projects/:slug`, cujo service apaga as concessões na
-- MESMA transação (fase F6).
CREATE TABLE resource_grants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type   VARCHAR(24) NOT NULL
                      CHECK (resource_type IN ('tileset','data_layer','analysis_layer','sv360_project')),
    resource_id     TEXT NOT NULL,
    grantee_id      UUID NOT NULL REFERENCES users(id),
    grant_level     VARCHAR(12) NOT NULL CHECK (grant_level IN ('view','view_share')),
    granted_by      UUID REFERENCES users(id),
    -- A ARESTA DA ÁRVORE. NULL = concessão de raiz (feita por admin/curador, que
    -- não deriva de ninguém). ON DELETE CASCADE é cinto de segurança para um
    -- expurgo FÍSICO futuro, NÃO o mecanismo de revogação: revogar é soft
    -- (`revoked_at`), e soft nunca dispara CASCADE. Ver D2.
    parent_grant_id UUID REFERENCES resource_grants(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    revoked_by      UUID REFERENCES users(id)
);

-- D3: NÃO existe índice único sobre (tipo, recurso, beneficiário). Várias
-- concessões vivas para a mesma pessoa são deliberadas — a estrutura é um DAG,
-- não uma árvore estrita — para que a revogação de A não desfaça o que C deu.

-- O índice que a resolução usa: "que ids deste tipo este usuário tem vivos?"
CREATE INDEX idx_resource_grants_grantee
    ON resource_grants (grantee_id, resource_type, resource_id) WHERE revoked_at IS NULL;
-- O índice da tela "quem tem acesso a este recurso"
CREATE INDEX idx_resource_grants_resource
    ON resource_grants (resource_type, resource_id) WHERE revoked_at IS NULL;
-- O índice que a poda recursiva percorre
CREATE INDEX idx_resource_grants_parent
    ON resource_grants (parent_grant_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. O vínculo atlas -> recurso (o empréstimo)
-- ---------------------------------------------------------------------------
--
-- O atlas passa a EMPRESTAR acesso ao recurso, no escopo dele. Tabela SEPARADA
-- de `atlas.settings.available_*` de propósito: aquele é RESTRITIVO com
-- "vazio = sem restrição" (contrato congelado), este é AMPLIATIVO com
-- "vazio = não empresta nada". A mesma estrutura não carrega as duas semânticas.
--
-- ON DELETE CASCADE no atlas é declarado, mas atlas é SOFT-deletado
-- (`deleted_at`), então quem realmente corta o empréstimo do atlas na lixeira é
-- o `a.deleted_at IS NULL` da função de resolução. Restaurar o atlas restaura
-- os empréstimos, que é o comportamento desejado.
CREATE TABLE atlas_resources (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atlas_id       UUID NOT NULL REFERENCES atlas(id) ON DELETE CASCADE,
    resource_type  VARCHAR(24) NOT NULL
                     CHECK (resource_type IN ('tileset','data_layer','analysis_layer','sv360_project')),
    resource_id    TEXT NOT NULL,
    added_by       UUID REFERENCES users(id),
    added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at     TIMESTAMPTZ,
    removed_by     UUID REFERENCES users(id)
);

-- Aqui o índice único É desejado, e a diferença com resource_grants é o
-- significado: emprestar duas vezes o mesmo recurso no mesmo atlas não carrega
-- informação nenhuma (não há "quem emprestou" a preservar em árvore), enquanto
-- duas concessões vivas carregam dois concedentes distintos. O
-- `WHERE removed_at IS NULL` é obrigatório: sem ele um empréstimo removido
-- ocuparia a vaga para sempre e reanexar seria impossível, que é o beco sem
-- saída documentado em catalog-soft-delete-resurrect.repro.test.js.
CREATE UNIQUE INDEX uq_atlas_resources_live
    ON atlas_resources (atlas_id, resource_type, resource_id) WHERE removed_at IS NULL;
CREATE INDEX idx_atlas_resources_atlas
    ON atlas_resources (atlas_id) WHERE removed_at IS NULL;
CREATE INDEX idx_atlas_resources_resource
    ON atlas_resources (resource_type, resource_id) WHERE removed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. A resolução de acesso: UMA pergunta, UMA definição
-- ---------------------------------------------------------------------------
--
-- O repositório já pagou pelo predicado duplicado verbatim entre
-- CATALOGO_SELECT e CATALOGO_COUNT (`ng`), cujo comentário nomeia uma função
-- `fn_user_can_see_model` que nunca existiu. Aqui o predicado NASCE como função
-- SQL, e a de cima é COMPOSTA das duas de baixo, para que não exista uma
-- segunda cópia da regra.

-- Papel global que enxerga TODO recurso privado.
--
-- É consultado NO BANCO, não recebido do JWT, e a escolha é de segurança: o
-- token vive até 15 min e `flexibleAuth` (que autentica o caminho de leitura do
-- sv360 e do /api/config) NÃO reconcilia contra o banco, então um curador
-- rebaixado carregaria o papel antigo por essa janela inteira. Resolver aqui
-- elimina a janela por construção, e de quebra o predicado continua valendo se
-- a camada de aplicação errar. É o padrão que `nomes.queries.js` já usa.
--
-- `curator` (D5) já aparece aqui antes de o CHECK de `users.role` aceitá-lo
-- (fase F4). Isso é inofensivo: nenhuma linha pode carregar o valor ainda,
-- então o termo simplesmente nunca casa.
CREATE OR REPLACE FUNCTION fn_has_global_data_access(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT p_user_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM users u
          LEFT JOIN organizations o ON o.id = u.organization_id
         WHERE u.id = p_user_id
           AND u.is_active = true
           AND COALESCE(o.is_active, true) = true
           AND u.role IN ('admin','curator')
    );
$$;

-- Os ids concedidos a este principal, de UM tipo: concessão direta UNION
-- empréstimo do atlas em foco.
--
-- p_atlas_id NULL = não há atlas em foco, e o segundo braço não contribui.
-- p_user_id NULL = visitante de link público, que NÃO tem linha em `users`: o
-- primeiro braço morre e só o empréstimo do atlas o alcança, que é exatamente o
-- desejado (R4 — "compartilhei o atlas, quem acessar acessa os recursos"
-- inclui o link público).
--
-- OS DOIS `IS NOT NULL` SÃO DECLARAÇÃO DE INTENÇÃO, NÃO O MECANISMO. A lógica
-- de três valores já entrega o mesmo resultado sem eles (`grantee_id = NULL` é
-- NULL, nunca verdadeiro, então o braço não devolve linha), e isso foi medido:
-- removê-los deixa a suíte inteira verde. Ficam porque tornam legível, no ponto
-- de leitura, qual braço atende o visitante anônimo — mas não conte com um teste
-- para segurá-los, porque não há o que segurar.
CREATE OR REPLACE FUNCTION fn_granted_resource_ids(
    p_user_id UUID, p_atlas_id UUID, p_type TEXT
) RETURNS TABLE (resource_id TEXT) LANGUAGE sql STABLE AS $$
    SELECT g.resource_id
      FROM resource_grants g
     WHERE g.revoked_at IS NULL
       AND g.resource_type = p_type
       AND p_user_id IS NOT NULL
       AND g.grantee_id = p_user_id
    UNION
    SELECT ar.resource_id
      FROM atlas_resources ar
      JOIN atlas a ON a.id = ar.atlas_id AND a.deleted_at IS NULL
     WHERE ar.removed_at IS NULL
       AND ar.resource_type = p_type
       AND p_atlas_id IS NOT NULL
       AND ar.atlas_id = p_atlas_id
       -- D4: o empréstimo vive enquanto o DONO do atlas vir o recurso. É uma
       -- condição ESTÁVEL (o dono é uma coluna, não uma cadeia) e faz a
       -- revogação propagar sozinha para todos os membros do atlas, sem
       -- varredura periódica. Repare que este ramo NÃO recorre: ele consulta
       -- papel global e concessão DIRETA, nunca o empréstimo, então a avaliação
       -- termina em dois níveis.
       AND ( fn_has_global_data_access(a.owner_id)
             OR EXISTS (SELECT 1 FROM resource_grants og
                         WHERE og.revoked_at IS NULL
                           AND og.resource_type = ar.resource_type
                           AND og.resource_id   = ar.resource_id
                           AND og.grantee_id    = a.owner_id) );
$$;

-- Predicado escalar, COMPOSTO das duas acima. Não repete uma linha de regra.
--
-- Usado para checagem PONTUAL (o gate de anexar ao atlas, o caminho de foto do
-- sv360). LISTAGEM usa `fn_granted_resource_ids` como semi-join
-- (`IN (SELECT ...)`), que é uma consulta em vez de uma por linha — ver R8.
CREATE OR REPLACE FUNCTION fn_can_see_resource(
    p_user_id UUID, p_atlas_id UUID, p_type TEXT, p_resource_id TEXT, p_access_level TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT p_access_level = 'public'
        OR fn_has_global_data_access(p_user_id)
        OR EXISTS (SELECT 1 FROM fn_granted_resource_ids(p_user_id, p_atlas_id, p_type) r
                    WHERE r.resource_id = p_resource_id);
$$;
