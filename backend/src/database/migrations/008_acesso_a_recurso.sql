-- Path: src/database/migrations/008_acesso_a_recurso.sql
-- ACESSO A RECURSO PRIVADO: a concessão em DAG, o empréstimo por atlas e a
-- RESOLUÇÃO — as quatro funções que respondem "quem vê o quê" e "quem mantém o
-- quê", para os CINCO tipos concedíveis (camada de base, modelo 3D, camada de
-- dados, camada de análise, projeto 360).
--
-- ESTE ARQUIVO É PURO CONSUMIDOR: nada no schema depende dele, e ele depende de
-- todos os outros. É por isso que ele é o último, e é uma propriedade que se lê
-- sem abrir o arquivo. Repare que as COLUNAS do eixo (`access_level`,
-- `owner_org_id`) NÃO moram aqui: elas moram com a tabela que as carrega
-- (005_catalogo.sql, 007_sv360.sql). Coluna mora com a tabela; predicado mora com
-- o predicado.
--
-- Decisões registradas em docs/decisions/decisions-2026.md (entrada
-- "2026-08-16: recursos privados..."), com as alternativas recusadas por extenso.

-- ---------------------------------------------------------------------------
-- 1. A tabela de concessões (o DAG)
-- ---------------------------------------------------------------------------
--
-- Concessão de acesso a UM recurso privado, para UM usuário, por UM concedente.
--
-- `resource_id` é TEXT e NÃO tem FK: o alvo pode estar em cinco relações com
-- tipos de chave diferentes (slug VARCHAR nas quatro de catálogo, UUID em
-- sv360.projects). Postgres não tem FK polimórfica, e as alternativas (uma tabela
-- por tipo, ou trigger de integridade) custam mais do que a órfã que elas evitam.
-- A órfã é contida por dois fatos: catálogo é SOFT-delete (`active = false`, a
-- linha fica) e o único hard-delete do sistema é
-- `DELETE /sv360/admin/projects/:slug`, cujo service apaga as concessões na MESMA
-- transação.
-- ---------------------------------------------------------------------------
-- ONDE MORA O GRUPO DE ACESSO
-- ---------------------------------------------------------------------------
--
-- `access_groups` e `access_group_members` nascem em `001_identidade.sql`, e nao aqui.
-- Duas razoes, e a segunda e a que obriga: grupo de acesso e uma colecao de USUARIOS, e
-- desde que ganhou dono e entidade de usuario; e `atlas_shares` (003) o referencia, entao
-- ele TEM de existir antes, porque a ordem entre as baselines e a de dependencia de FK.
-- Aqui ficam so as funcoes que o LEEM, que e o papel deste arquivo.

CREATE TABLE resource_grants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type   VARCHAR(24) NOT NULL
                      CHECK (resource_type IN ('basemap','tileset','data_layer','analysis_layer','sv360_project')),
    resource_id     TEXT NOT NULL,
    -- O ALVO DA CONCESSAO E EXATAMENTE UM DOS DOIS, e o CHECK la embaixo e quem
    -- garante. Pessoa e grupo sao alternativos, nunca simultaneos: uma linha que
    -- carregasse os dois teria duas respostas para "quem recebeu", e a poda da
    -- subarvore precisaria escolher uma.
    grantee_id       UUID REFERENCES users(id),
    grantee_group_id UUID REFERENCES access_groups(id),
    grant_level     VARCHAR(12) NOT NULL CHECK (grant_level IN ('view','view_share')),
    granted_by      UUID REFERENCES users(id),
    -- A ARESTA DO GRAFO. NULL = concessão de raiz (feita por admin/credenciado, que
    -- não deriva de ninguém). ON DELETE CASCADE é cinto de segurança para um
    -- expurgo FÍSICO, NÃO o mecanismo de revogação: revogar é soft (`revoked_at`),
    -- e soft nunca dispara CASCADE. Ver D2.
    parent_grant_id UUID REFERENCES resource_grants(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,
    revoked_by      UUID REFERENCES users(id),

    -- O PRAZO. Concessão de acesso a recurso privado CADUCA: teto de um ano,
    -- default de um ano, e o default é VOLÁTIL de propósito (avaliado por linha).
    --
    -- A MORTE MORA NO PREDICADO, NUNCA NUMA VARREDURA. Não existe sweeper que
    -- escreva `revoked_at` quando o prazo vence, e a ausência é a decisão: um
    -- sweeper é mais um verificador, e verificador quebra calado — o dia em que o
    -- cron não roda, o acesso expirado continua vivo e nada fica vermelho. Com o
    -- prazo dentro de `fn_granted_resource_ids`, "expirou" e "não aparece" são o
    -- MESMO fato, e não dois fatos que precisam concordar.
    --
    -- Consequência que a leitura precisa aceitar: uma concessão expirada continua
    -- com `revoked_at IS NULL`. REVOGADA e EXPIRADA são estados DIFERENTES (a
    -- primeira tem autor e hora, a segunda é o relógio), e toda query que defina
    -- "concessão viva" só como `revoked_at IS NULL` está definindo errado.
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 year'),

    -- O teto e o piso, no mesmo CHECK. O piso (`> created_at`) recusa a concessão
    -- que nasce morta, que só pode ser erro de chamador. O teto (um ano) é a
    -- política, e está aqui e não só na aplicação porque o INSERT cru existe
    -- (testes de função escrevem direto na tabela) e porque um teto que a borda
    -- esquece de aplicar é um teto que não existe.
    --
    -- Repare que os dois lados comparam com `created_at`, NÃO com `NOW()`: o CHECK
    -- precisa continuar verdadeiro para sempre, e um predicado ancorado no relógio
    -- ficaria falso amanhã e travaria qualquer UPDATE na linha.
    CONSTRAINT resource_grants_expires_at_check
      CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '1 year'),

    -- EXATAMENTE UM ALVO. `num_nonnulls` e a forma que diz isso sem escrever as
    -- quatro combinacoes a mao, e sem deixar a quinta de fora quando um terceiro
    -- tipo de beneficiario aparecer.
    CONSTRAINT resource_grants_alvo_unico_check
      CHECK (num_nonnulls(grantee_id, grantee_group_id) = 1)
);

-- D3: NÃO existe índice único sobre (tipo, recurso, beneficiário). Várias
-- concessões vivas para a mesma pessoa são deliberadas — a estrutura é um DAG,
-- não uma árvore estrita — para que a revogação de A não desfaça o que C deu.

-- O índice que a resolução usa: "que ids deste tipo este usuário tem vivos?"
CREATE INDEX idx_resource_grants_grantee
    ON resource_grants (grantee_id, resource_type, resource_id) WHERE revoked_at IS NULL;
-- O irmão do de cima, para o braço de GRUPO da resolução. Sem ele o ramo novo
-- varreria a tabela inteira, e ele é percorrido no mesmo caminho quente.
CREATE INDEX idx_resource_grants_grantee_group
    ON resource_grants (grantee_group_id, resource_type, resource_id) WHERE revoked_at IS NULL;
-- O índice da tela "quem tem acesso a este recurso"
CREATE INDEX idx_resource_grants_resource
    ON resource_grants (resource_type, resource_id) WHERE revoked_at IS NULL;
-- O índice que a poda recursiva percorre
CREATE INDEX idx_resource_grants_parent
    ON resource_grants (parent_grant_id) WHERE revoked_at IS NULL;

-- NÃO HÁ ÍNDICE SOBRE `expires_at`, e a ausência é medida: pôr `AND expires_at > NOW()`
-- num índice parcial é IMPOSSÍVEL (NOW() não é IMMUTABLE), e um índice separado não
-- ajuda uma consulta que já entrou pelo beneficiário e devolve unidades de linhas.

-- ---------------------------------------------------------------------------
-- 2. O vínculo atlas -> recurso (o empréstimo)
-- ---------------------------------------------------------------------------
--
-- O atlas EMPRESTA acesso ao recurso, no escopo dele. Tabela SEPARADA de
-- `atlas.settings.available_*` de propósito: aquele é RESTRITIVO com
-- "vazio = sem restrição" (contrato congelado), este é AMPLIATIVO com
-- "vazio = não empresta nada". A mesma estrutura não carrega as duas semânticas.
--
-- ON DELETE CASCADE no atlas é declarado, mas atlas é SOFT-deletado
-- (`deleted_at`), então quem realmente corta o empréstimo do atlas na lixeira é o
-- `a.deleted_at IS NULL` da função de resolução. Restaurar o atlas restaura os
-- empréstimos, que é o comportamento desejado.
--
-- `atlas_resources` NÃO ganha relógio próprio, de propósito: o braço D4 já amarra
-- o empréstimo a "o dono do atlas continua vendo o recurso", então o empréstimo
-- morre junto com a concessão do dono, sem uma segunda data para manter coerente.
CREATE TABLE atlas_resources (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    atlas_id       UUID NOT NULL REFERENCES atlas(id) ON DELETE CASCADE,
    resource_type  VARCHAR(24) NOT NULL
                     CHECK (resource_type IN ('basemap','tileset','data_layer','analysis_layer','sv360_project')),
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
-- ocuparia a vaga para sempre e reanexar seria impossível, que é o beco sem saída
-- documentado em catalog-soft-delete-resurrect.repro.test.js.
CREATE UNIQUE INDEX uq_atlas_resources_live
    ON atlas_resources (atlas_id, resource_type, resource_id) WHERE removed_at IS NULL;
CREATE INDEX idx_atlas_resources_atlas
    ON atlas_resources (atlas_id) WHERE removed_at IS NULL;
CREATE INDEX idx_atlas_resources_resource
    ON atlas_resources (resource_type, resource_id) WHERE removed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. A resolução de acesso: UMA pergunta, UMA definição
-- ---------------------------------------------------------------------------
--
-- O repositório já pagou pelo predicado duplicado verbatim entre duas queries, com um
-- comentário nomeando uma função que nunca existiu. Aqui o predicado NASCE como função
-- SQL, e a de cima é COMPOSTA das de baixo: não há segunda cópia da regra.

-- Papel global que enxerga TODO recurso privado.
--
-- É consultado NO BANCO, não recebido do JWT, e a escolha é de segurança: o token
-- vive até 15 min e `flexibleAuth` (que autentica o caminho de leitura do sv360 e
-- do /api/config) NÃO reconcilia contra o banco, então um credenciado rebaixado
-- carregaria o papel antigo por essa janela inteira. Resolver aqui elimina a
-- janela por construção, e de quebra o predicado continua valendo se a camada de
-- aplicação errar. É o padrão que `nomes.queries.js` já usa.
CREATE FUNCTION fn_has_global_data_access(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT p_user_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM users u
          LEFT JOIN organizations o ON o.id = u.organization_id
         WHERE u.id = p_user_id
           AND u.is_active = true
           AND COALESCE(o.is_active, true) = true
           AND u.role IN ('admin','credenciado')
    );
$$;

-- Os ids concedidos a este principal, de UM tipo: concessão direta UNION
-- empréstimo do atlas em foco.
--
-- p_atlas_id NULL = não há atlas em foco, e o segundo braço não contribui.
-- p_user_id NULL = visitante de link público, que NÃO tem linha em `users`: o
-- primeiro braço morre e só o empréstimo do atlas o alcança, que é exatamente o
-- desejado (R4 — "compartilhei o atlas, quem acessar acessa os recursos" inclui o
-- link público).
--
-- OS DOIS `IS NOT NULL` SÃO DECLARAÇÃO DE INTENÇÃO, NÃO O MECANISMO: a lógica de três
-- valores já entrega o mesmo resultado sem eles, e isso foi MEDIDO (removê-los deixa a
-- suíte verde). Ficam por legibilidade, mas nenhum teste os segura.
--
-- O PRAZO ENTRA NOS DOIS SÍTIOS em que esta função consulta `resource_grants`: o
-- braço direto e o `EXISTS (... og ...)` dentro do braço D4. Pô-lo só no primeiro
-- deixaria o empréstimo de atlas vivo com a concessão do dono já expirada — a morte
-- moraria em METADE do predicado, que é pior que não morar em nenhuma, porque o
-- vazamento fica no braço que ninguém olha. As duas linhas são a mesma decisão e
-- mudam juntas.
-- Os grupos VIVOS de uma pessoa. Existe como função, e não copiada nos dois sítios
-- que a consultam, porque "esta pessoa pertence a este grupo" tem de ter UMA
-- resposta: foi o predicado duplicado verbatim entre SELECT e COUNT que este
-- repositório acabou de apagar junto com o catálogo 3D do `ng`.
--
-- O `deleted_at IS NULL` do grupo é o que faz apagar um grupo REVOGAR o que ele
-- concedia, sem tocar em `resource_grants`. A alternativa (podar as concessões do
-- grupo ao apagá-lo) destruiria a resposta de auditoria pela mesma razão que a
-- revogação é soft (D2).
-- O principal está VIVO? Conta ativa e OM ativa (linha de OM AUSENTE conta como
-- ativa: é anomalia de dado, não desativação deliberada, e é a mesma regra de
-- `utils/org-status.js`).
--
-- POR QUE ISTO EXISTE COMO FUNÇÃO PRÓPRIA, e a resposta é um defeito medido em
-- 2026-08-19: `fn_has_global_data_access` sempre checou liveness, e o ramo de
-- CONCESSÃO nunca checou. Um admin desativado perdia o atalho na mesma consulta em
-- que um beneficiário desativado continuava enxergando o recurso concedido. A
-- assimetria não aparecia em teste porque cada ramo tinha o seu, e nenhum media o
-- outro. O predicado promete não vazar "nem com bug de app"; sem isto, ele
-- prometia menos do que entregava em metade dos ramos.
CREATE FUNCTION fn_principal_vivo(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT p_user_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM users u
          LEFT JOIN organizations o ON o.id = u.organization_id
         WHERE u.id = p_user_id
           AND u.is_active = true
           AND COALESCE(o.is_active, true) = true
    );
$$;

-- O DONO MORTO DERRUBA O GRUPO INTEIRO: `fn_principal_vivo(ag.owner_id)` e o que faz a
-- desativacao do dono cortar, de uma vez, todo acesso que o grupo dele concedia. Sem isso
-- um grupo continuaria emprestando permissao depois de o responsavel sair.
CREATE FUNCTION fn_user_group_ids(p_user_id UUID)
RETURNS TABLE (group_id UUID) LANGUAGE sql STABLE AS $$
    SELECT gm.group_id
      FROM access_group_members gm
      JOIN access_groups ag ON ag.id = gm.group_id AND ag.deleted_at IS NULL
     WHERE p_user_id IS NOT NULL
       AND gm.user_id = p_user_id
       AND fn_principal_vivo(ag.owner_id);
$$;

-- Papel global de ADMINISTRADOR DO SISTEMA, resolvido no banco pelo mesmo motivo de
-- `fn_has_global_data_access`: o token vive ate 15 min e nao reconcilia.
CREATE FUNCTION fn_is_global_admin(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT p_user_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM users u
          LEFT JOIN organizations o ON o.id = u.organization_id
         WHERE u.id = p_user_id
           AND u.is_active = true
           AND COALESCE(o.is_active, true) = true
           AND u.role = 'admin'
    );
$$;

-- Quem pode administrar ESTE grupo: o dono vivo, ou o administrador do sistema. Repare
-- que credenciado NAO entra: ler todo recurso privado nao e o mesmo que mandar no grupo
-- de outra pessoa.
CREATE FUNCTION fn_can_administer_group(p_user_id UUID, p_group_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT p_user_id IS NOT NULL AND p_group_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM access_groups g
         WHERE g.id = p_group_id
           AND g.deleted_at IS NULL
           AND ( (g.owner_id = p_user_id AND fn_principal_vivo(p_user_id))
                 OR fn_is_global_admin(p_user_id) )
    );
$$;

-- O gate de PRODUÇÃO: "este usuário MANTÉM este recurso?" — uma pergunta, UMA
-- definição.
--
-- Ela responde pelos CINCO tipos (as quatro tabelas de catálogo mais o projeto
-- 360). É plpgsql e não SQL puro porque precisa de despacho por tipo. O DESPACHO É
-- UM `CASE` SOBRE LITERAIS, nunca `EXECUTE format('%I', p_type)`: com `format` o
-- nome da tabela viria do argumento, e o argumento vem de um caminho que uma rota
-- nova pode alimentar com o corpo do request. Aqui o conjunto de tabelas
-- alcançáveis é FECHADO no texto da função, e o `ELSE` LEVANTA em vez de devolver
-- FALSE — tipo desconhecido é bug de chamador, e FALSE silencioso viraria um 404
-- que ninguém consegue explicar.
--
-- O ADMIN passa por aqui em vez de por um `OR fn_has_global_data_access(...)` no
-- chamador porque `fn_has_global_data_access` inclui o CREDENCIADO, que não escreve
-- nada. Os dois eixos globais não se contêm e não podem compartilhar predicado:
-- quem lê tudo não é quem mantém, e nenhum dos dois é o outro.
--
-- A conta e a OM de LOTAÇÃO precisam estar ativas, mesmo o eixo de lotação não
-- autorizando mais nada: isso é LIVENESS (conta desativada não age), não
-- autorização por OM, e é o mesmo COALESCE de `fn_has_global_data_access`.
CREATE FUNCTION fn_can_produce_resource(
    p_user_id UUID, p_type TEXT, p_resource_id TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_role       TEXT;
    v_scope      UUID;
    v_prod_ativa BOOLEAN;
    v_owner_org  UUID;
BEGIN
    -- Visitante anônimo (p_user_id NULL) não produz nada. O early return também
    -- é o que impede a função de levantar por tipo desconhecido num caminho
    -- anônimo, onde o erro seria um 500 no lugar de uma tela vazia.
    IF p_user_id IS NULL OR p_type IS NULL OR p_resource_id IS NULL THEN
        RETURN false;
    END IF;

    SELECT u.role, u.producer_org_id, COALESCE(po.is_active, false)
      INTO v_role, v_scope, v_prod_ativa
      FROM users u
      LEFT JOIN organizations o  ON o.id  = u.organization_id
      LEFT JOIN organizations po ON po.id = u.producer_org_id
     WHERE u.id = p_user_id
       AND u.is_active = true
       AND COALESCE(o.is_active, true) = true;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    IF v_role = 'admin' THEN
        RETURN true;
    END IF;

    -- O bicondicional de `users_producer_scope_check` garante que produtor tem
    -- escopo, mas a função não se apoia nisso: um CHECK protege a tabela, e esta
    -- função é lida por quem está decidindo acesso. `v_scope IS NULL` aqui pararia
    -- num FALSE de qualquer jeito (NULL = NULL não é verdadeiro), e a linha
    -- explícita diz o porquê.
    --
    -- `NOT v_prod_ativa` fecha o caso da OM produtora DESATIVADA. Repare que ele NÃO usa
    -- `COALESCE(.., true)` como o ramo de lotação, e a assimetria é deliberada: lotação
    -- ausente é o estado normal de quem não declarou OM, enquanto produtora ausente é
    -- impossível neste ponto (o `v_scope IS NULL` acima já saiu). Aqui `false` só pode
    -- significar "a OM produtora existe e está desativada", e a resposta é não produzir.
    IF v_role <> 'producer' OR v_scope IS NULL OR NOT v_prod_ativa THEN
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


CREATE FUNCTION fn_granted_resource_ids(
    p_user_id UUID, p_atlas_id UUID, p_type TEXT
) RETURNS TABLE (resource_id TEXT) LANGUAGE sql STABLE AS $$
    SELECT g.resource_id
      FROM resource_grants g
     WHERE g.revoked_at IS NULL
       AND g.expires_at > NOW()
       AND g.resource_type = p_type
       AND fn_principal_vivo(p_user_id)
       -- O CONCEDENTE TAMBEM PRECISA ESTAR VIVO: desativar quem concedeu derruba o que
       -- ele concedeu, sem varredura e sem revogacao explicita. `granted_by` nulo e a
       -- concessao de raiz, que nao tem concedente para morrer.
       AND (g.granted_by IS NULL OR fn_principal_vivo(g.granted_by))
       AND g.grantee_id = p_user_id
    UNION
    -- O MESMO braço, pelo COLETIVO. Separado por UNION em vez de um OR dentro do
    -- WHERE de cima porque cada metade entra por um índice parcial próprio
    -- (`..._grantee` e `..._grantee_group`); um OR faria o planejador escolher
    -- entre eles em vez de usar os dois.
    SELECT g.resource_id
      FROM resource_grants g
     WHERE g.revoked_at IS NULL
       AND g.expires_at > NOW()
       AND g.resource_type = p_type
       AND fn_principal_vivo(p_user_id)
       AND (g.granted_by IS NULL OR fn_principal_vivo(g.granted_by))
       AND g.grantee_group_id IN (SELECT group_id FROM fn_user_group_ids(p_user_id))
    UNION
    SELECT ar.resource_id
      FROM atlas_resources ar
      JOIN atlas a ON a.id = ar.atlas_id AND a.deleted_at IS NULL
     WHERE ar.removed_at IS NULL
       AND ar.resource_type = p_type
       AND p_atlas_id IS NOT NULL
       AND ar.atlas_id = p_atlas_id
       -- D4: o empréstimo vive enquanto o DONO do atlas vir o recurso. Condição
       -- ESTÁVEL (o dono é uma coluna, não uma cadeia), que faz a revogação E a
       -- expiração propagarem sozinhas para todos os membros do atlas e para o
       -- visitante de link público, sem varredura periódica. Este ramo NÃO
       -- recorre: consulta papel global e concessão DIRETA, nunca o empréstimo,
       -- então a avaliação termina em dois níveis.
       -- TRES MANEIRAS de o dono do atlas alcancar o recurso que ele empresta: o papel
       -- global de dado, PRODUZIR o recurso (a OM dele o mantem), ou ter concessao viva.
       -- O ramo de producao entrou depois: sem ele, o produtor emprestava ao proprio atlas
       -- um recurso da propria OM e o emprestimo nao resolvia.
       AND ( fn_has_global_data_access(a.owner_id)
             OR fn_can_produce_resource(a.owner_id, ar.resource_type, ar.resource_id)
             OR (fn_principal_vivo(a.owner_id) AND EXISTS (SELECT 1 FROM resource_grants og
                         WHERE og.revoked_at IS NULL
                           AND og.expires_at > NOW()
                           AND og.resource_type = ar.resource_type
                           AND og.resource_id   = ar.resource_id
                           AND (og.granted_by IS NULL OR fn_principal_vivo(og.granted_by))
                           AND ( og.grantee_id = a.owner_id
                                 OR og.grantee_group_id IN
                                      (SELECT group_id FROM fn_user_group_ids(a.owner_id)) ))) );
$$;

-- Predicado escalar, COMPOSTO dos três acima. Não repete uma linha de regra.
--
-- Usado para checagem PONTUAL (o gate de anexar ao atlas, o caminho de foto do
-- sv360). LISTAGEM usa `fn_granted_resource_ids` como semi-join
-- (`IN (SELECT ...)`), que é uma consulta em vez de uma por linha — ver R8.
--
-- O PRODUTOR vê o privado da própria OM SEM concessão individual, e essa é a
-- diferença entre manter e receber: exigir que um administrador conceda ao produtor
-- acesso àquilo que a OM dele produziu inverteria a relação, e criaria uma
-- concessão que precisaria ser renovada todo ano para o mantenedor continuar
-- enxergando o próprio acervo.
--
-- ORDEM DOS TERMOS: `p_access_level = 'public'` primeiro por leitura, mas NÃO
-- CONTE COM CURTO-CIRCUITO — Postgres não garante ordem de avaliação num OR, e é
-- por isso que `fn_can_produce_resource` reconhece os CINCO tipos e não só os
-- quatro que uma listagem de catálogo costuma tocar. Se ela levantasse para algum
-- tipo vivo, este OR levantaria em qualquer arranjo do planejador.
CREATE FUNCTION fn_can_see_resource(
    p_user_id UUID, p_atlas_id UUID, p_type TEXT, p_resource_id TEXT, p_access_level TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT p_access_level = 'public'
        OR fn_has_global_data_access(p_user_id)
        OR fn_can_produce_resource(p_user_id, p_type, p_resource_id)
        OR EXISTS (SELECT 1 FROM fn_granted_resource_ids(p_user_id, p_atlas_id, p_type) r
                    WHERE r.resource_id = p_resource_id);
$$;

-- ---------------------------------------------------------------------------
-- 4. O compartilhamento de atlas com um GRUPO
-- ---------------------------------------------------------------------------
--
-- `atlas_shares` (003) aceita como alvo UMA pessoa OU UM grupo, nunca os dois, pelo mesmo
-- `num_nonnulls` de `resource_grants`. As funções abaixo respondem as duas perguntas que a
-- soma das duas formas cria, e existem para que essa soma tenha UMA definição só.

-- A ESCADA DO EIXO POR ATLAS, como número. Existe porque o compartilhamento agora chega
-- por dois caminhos (direto e por grupo) e o mesmo usuário pode receber os dois: sem uma
-- ordem, "qual permissão vale" não teria resposta única.
CREATE FUNCTION fn_permission_rank(p_level TEXT) RETURNS INT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_level
             WHEN 'read'    THEN 1
             WHEN 'comment' THEN 2
             WHEN 'write'   THEN 3
             WHEN 'manage'  THEN 4
             WHEN 'owner'   THEN 5
             ELSE 0
           END;
$$;

-- Os atlas que este usuário alcança por compartilhamento, com a MAIOR permissão de cada
-- um. O desempate secundário é `direto DESC`: com o mesmo nível vindo dos dois caminhos,
-- vale o direto, que é o que a tela de compartilhamento mostra e o que o dono editou.
CREATE FUNCTION fn_user_atlas_shares(p_user_id UUID, p_atlas_id UUID DEFAULT NULL)
RETURNS TABLE (atlas_id UUID, permission TEXT)
LANGUAGE sql STABLE AS $$
    SELECT c.atlas_id,
           (ARRAY_AGG(c.permission
                      ORDER BY fn_permission_rank(c.permission) DESC, c.direto DESC))[1]
      FROM (
            SELECT s.atlas_id, s.permission::text AS permission, true AS direto
              FROM atlas_shares s
             WHERE p_user_id IS NOT NULL
               AND s.user_id = p_user_id
               AND (p_atlas_id IS NULL OR s.atlas_id = p_atlas_id)
            UNION ALL
            SELECT s.atlas_id, s.permission::text, false
              FROM atlas_shares s
             WHERE p_user_id IS NOT NULL
               AND s.group_id IN (SELECT g.group_id FROM fn_user_group_ids(p_user_id) g)
               AND (p_atlas_id IS NULL OR s.atlas_id = p_atlas_id)
           ) c
     GROUP BY c.atlas_id;
$$;

-- A pergunta inversa: quem são os membros deste atlas. `UNION` (e não `UNION ALL`) porque
-- a mesma pessoa pode chegar pelos dois caminhos e a presença é um conjunto.
CREATE FUNCTION fn_atlas_member_ids(p_atlas_id UUID)
RETURNS TABLE (user_id UUID)
LANGUAGE sql STABLE AS $$
    SELECT s.user_id
      FROM atlas_shares s
     WHERE s.atlas_id = p_atlas_id AND s.user_id IS NOT NULL
    UNION
    SELECT gm.user_id
      FROM atlas_shares s
      JOIN access_groups ag ON ag.id = s.group_id AND ag.deleted_at IS NULL
                           AND fn_principal_vivo(ag.owner_id)
      JOIN access_group_members gm ON gm.group_id = s.group_id
     WHERE s.atlas_id = p_atlas_id AND s.group_id IS NOT NULL;
$$;

-- O que a OM deste produtor mantém e está PRIVADO. É a lista que a tela de produção
-- mostra, e ela não passa por concessão nenhuma: produzir já é o título.
CREATE FUNCTION fn_produced_private_resource_ids(p_user_id UUID)
RETURNS TABLE (resource_type TEXT, resource_id TEXT) LANGUAGE sql STABLE AS $$
    WITH ator AS (
        SELECT u.producer_org_id AS escopo
          FROM users u
          LEFT JOIN organizations o  ON o.id  = u.organization_id
          JOIN organizations po ON po.id = u.producer_org_id AND po.is_active = true
         WHERE u.id = p_user_id
           AND u.is_active = true
           AND COALESCE(o.is_active, true) = true
           AND u.role = 'producer'
           AND u.producer_org_id IS NOT NULL
    )
    SELECT 'basemap'::text, b.id
      FROM basemaps b JOIN ator ON b.owner_org_id = ator.escopo
     WHERE b.active = true AND b.access_level = 'private'
    UNION ALL
    SELECT 'tileset'::text, t.id
      FROM tilesets t JOIN ator ON t.owner_org_id = ator.escopo
     WHERE t.active = true AND t.access_level = 'private'
    UNION ALL
    SELECT 'data_layer'::text, d.id
      FROM data_layers d JOIN ator ON d.owner_org_id = ator.escopo
     WHERE d.active = true AND d.access_level = 'private'
    UNION ALL
    SELECT 'analysis_layer'::text, al.id
      FROM analysis_layers al JOIN ator ON al.owner_org_id = ator.escopo
     WHERE al.active = true AND al.access_level = 'private'
    UNION ALL
    SELECT 'sv360_project'::text, p.id::text
      FROM sv360.projects p JOIN ator ON p.organization_id = ator.escopo
     WHERE p.status = 'enabled' AND p.access_level = 'private';
$$;
