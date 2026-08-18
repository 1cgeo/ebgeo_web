-- 021_catalogo_quatro_tabelas.sql
--
-- Duas mudanças que se encontram nos MESMOS constraints, e por isso vêm juntas:
-- a tabela `streetview_markers` sai do sistema, e `basemap` entra no vocabulário
-- de concessão. Depois desta migração o modelo é QUATRO tabelas de catálogo e
-- CINCO tipos de recurso concedível.
--
-- ---------------------------------------------------------------------------
-- POR QUE `streetview_markers` MORRE, e por que sem depreciação
-- ---------------------------------------------------------------------------
--
-- Ela nasceu de `CREATE TABLE streetview_markers (LIKE basemaps INCLUDING ALL)`
-- em 003_sync.sql e nunca teve um consumidor: não alimenta `GET /api/config`
-- (`config.service.js` lê quatro tabelas), nenhum código do frontend chama
-- `/api/v1/streetview-markers`, e `seed.js` não escreve nela. As únicas escritas
-- que existiram foram de teste. Depreciar uma tabela sem leitor é manter viva a
-- ambiguidade que ela causa, que é o custo real: existe um ARQUIVO homônimo no
-- frontend (`street_view_tool/streetview_markers.js`) que é a camada VIVA de
-- marcadores do 360 no mapa 2D e lê de `sv360.projects`. Os dois nomes coincidem
-- e os dois objetos são opostos; um deles precisa sair.
--
-- O que a 019 acrescentou a ela (`owner_org_id`, o índice parcial e o ramo do
-- `CASE`) morre junto, e isso é esperado — não é regressão daquela migração, é o
-- alvo dela deixando de existir. As migrações 017/019/020 NÃO são editadas: elas
-- já foram para o remoto e forward-only vale.
--
-- `'STREETVIEW_MARKER'` PERMANECE no CHECK de `audit_trail.target_type` (020).
-- Tirá-lo seria uma quarta linha de DDL destrutiva para não ganhar nada, e a
-- coluna pode carregar o valor em linhas de trilha já gravadas. Ele passa a ser
-- o quarto alvo declarado SEM escritor, registrado como buraco conhecido em
-- `tests/unit/auditoria-censo.test.js`.
--
-- ---------------------------------------------------------------------------
-- POR QUE `basemap` VIRA TIPO DE RECURSO
-- ---------------------------------------------------------------------------
--
-- A camada de base já tinha `access_level` (017) e `owner_org_id` (019), e o
-- filtro público-por-padrão de `catalog.service.js` já valia para ela: um basemap
-- marcado `private` já sumia de `/api/config` e da listagem crua. O que faltava
-- era o outro lado do filtro — não havia como DEVOLVÊ-LO a quem tem direito,
-- porque `basemap` não existia em `resource_grants.resource_type`, então nem
-- concessão pessoal nem empréstimo por atlas o alcançavam. Meia regra: fechava e
-- não abria.
--
-- A superfície é o SELETOR DE BASEMAP, e é ela que passa a honrar as duas
-- direções.
--
-- Alargar um CHECK é compatível para trás — todo valor aceito antes continua
-- aceito — mas Postgres não tem `ALTER CONSTRAINT` para expressão de CHECK, então
-- o constraint precisa cair e voltar. Mesmo alargamento de 007/018/020.
--
-- ---------------------------------------------------------------------------
-- DDL DESTRUTIVA: TRÊS LINHAS, e cada uma exige entrada própria em
-- EXCECOES_DESTRUTIVAS (`tests/unit/migrations-higiene.test.js`), NO MESMO
-- COMMIT. Esquecer deixa a suíte vermelha com uma mensagem sobre "DDL destrutiva
-- não documentada", que não parece ter relação nenhuma com catálogo.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. O gate de produção perde o ramo do marcador
-- ---------------------------------------------------------------------------
--
-- VEM ANTES DO `DROP TABLE`, de propósito: Postgres não registra dependência de
-- plpgsql para tabela, então a ordem inversa deixaria, entre dois statements da
-- mesma transação, uma função viva cujo `CASE` aponta para uma tabela que já não
-- existe. Nada quebraria hoje (o tipo some do vocabulário no mesmo commit), mas a
-- ordem que nunca produz esse estado é a que se lê sem precisar do argumento.
--
-- O resto do corpo é IDÊNTICO ao da 019: só o ramo `WHEN 'streetview_marker'`
-- sai. `basemap` já estava lá e continua — o eixo de PRODUÇÃO sempre conheceu as
-- cinco tabelas; o que muda nesta migração é o eixo de CONCESSÃO, que é outro
-- vocabulário (ver seção 3).
CREATE OR REPLACE FUNCTION fn_can_produce_resource(
    p_user_id UUID, p_type TEXT, p_resource_id TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_role      TEXT;
    v_scope     UUID;
    v_owner_org UUID;
BEGIN
    -- Visitante anônimo (p_user_id NULL) não produz nada. O early return também
    -- é o que impede a função de levantar por tipo desconhecido num caminho
    -- anônimo, onde o erro seria um 500 no lugar de uma tela vazia.
    IF p_user_id IS NULL OR p_type IS NULL OR p_resource_id IS NULL THEN
        RETURN false;
    END IF;

    SELECT u.role, u.producer_org_id
      INTO v_role, v_scope
      FROM users u
      LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = p_user_id
       AND u.is_active = true
       AND COALESCE(o.is_active, true) = true;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    IF v_role = 'admin' THEN
        RETURN true;
    END IF;

    -- O bicondicional de 018 garante que produtor tem escopo, mas a função não se
    -- apoia nisso: um CHECK protege a tabela, e esta função é lida por quem está
    -- decidindo acesso. `v_scope IS NULL` aqui pararia num FALSE de qualquer jeito
    -- (NULL = NULL não é verdadeiro), e a linha explícita diz o porquê.
    IF v_role <> 'producer' OR v_scope IS NULL THEN
        RETURN false;
    END IF;

    CASE p_type
        WHEN 'basemap' THEN
            SELECT owner_org_id INTO v_owner_org FROM basemaps           WHERE id = p_resource_id;
        WHEN 'data_layer' THEN
            SELECT owner_org_id INTO v_owner_org FROM data_layers        WHERE id = p_resource_id;
        WHEN 'analysis_layer' THEN
            SELECT owner_org_id INTO v_owner_org FROM analysis_layers    WHERE id = p_resource_id;
        WHEN 'tileset' THEN
            SELECT owner_org_id INTO v_owner_org FROM tilesets           WHERE id = p_resource_id;
        WHEN 'sv360_project' THEN
            -- `id::text = p_resource_id` e não `p_resource_id::uuid`: o id de
            -- catálogo é slug e o de 360 é UUID, e um chamador que erre o tipo
            -- levaria um 22P02 (invalid input syntax) que a borda traduz em 400
            -- e o leitor lê como "requisição malformada". Comparar do lado texto
            -- devolve simplesmente "não encontrei", que é a verdade.
            SELECT organization_id INTO v_owner_org FROM sv360.projects  WHERE id::text = p_resource_id;
        ELSE
            RAISE EXCEPTION 'fn_can_produce_resource: tipo de recurso fora da whitelist: %', p_type
              USING ERRCODE = 'invalid_parameter_value';
    END CASE;

    -- Recurso institucional (owner_org_id NULL) e recurso inexistente caem no
    -- mesmo FALSE, e é o resultado certo para os dois: nenhum produtor mantém
    -- acervo institucional, e ninguém mantém o que não existe.
    RETURN v_owner_org IS NOT NULL AND v_owner_org = v_scope;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. A tabela sai
-- ---------------------------------------------------------------------------
--
-- Os dois índices que ela carregava (o herdado de `LIKE basemaps INCLUDING ALL`
-- e `idx_streetview_markers_owner_org` da 019) caem com ela; não há FK apontando
-- para cá e nenhuma concessão pode referenciá-la (o tipo `streetview_marker`
-- nunca esteve no CHECK de `resource_grants`).
DROP TABLE streetview_markers;

-- ---------------------------------------------------------------------------
-- 3. `basemap` entra nos dois CHECKs de tipo de recurso
-- ---------------------------------------------------------------------------
--
-- Os dois precisam andar juntos: `resource_grants` é a concessão PESSOAL e
-- `atlas_resources` é o EMPRÉSTIMO por atlas, e `fn_granted_resource_ids` une os
-- dois braços sob o mesmo `p_type`. Alargar só um deixaria o tipo concedível e
-- não emprestável, que é a metade que ninguém consegue explicar depois.
--
-- `streetview_marker` NÃO entra em nenhum dos dois — a tabela acabou de sair.
ALTER TABLE resource_grants DROP CONSTRAINT resource_grants_resource_type_check;
ALTER TABLE resource_grants ADD CONSTRAINT resource_grants_resource_type_check
  CHECK (resource_type IN ('basemap','tileset','data_layer','analysis_layer','sv360_project'));

ALTER TABLE atlas_resources DROP CONSTRAINT atlas_resources_resource_type_check;
ALTER TABLE atlas_resources ADD CONSTRAINT atlas_resources_resource_type_check
  CHECK (resource_type IN ('basemap','tileset','data_layer','analysis_layer','sv360_project'));

-- O índice parcial do lado PRIVADO que faltava a `basemaps`, agora que a
-- resolução passa a visitar esse conjunto. É o mesmo desenho da 017 (indexar o
-- lado pequeno, que é o inverso do padrão de `ng`), e a ausência dele era
-- coerente enquanto o basemap privado não tinha como ser devolvido a ninguém.
CREATE INDEX idx_basemaps_private ON basemaps(id) WHERE access_level = 'private';
