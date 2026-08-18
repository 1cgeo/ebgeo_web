-- 019_escopo_de_producao.sql
--
-- A OM PRODUTORA do recurso, o PRAZO da concessão, e a redefinição das funções de
-- resolução de acesso da 017 para que as duas coisas entrem no predicado.
--
-- O QUE ESTA MIGRAÇÃO REALMENTE MUDA, em uma frase: `users.organization_id` deixa
-- de autorizar qualquer coisa. Ele é LOTAÇÃO, auto-declarada no auto-cadastro
-- (`POST /auth/register` aceita a OM de qualquer organização ativa, e conta sem
-- e-mail nasce ativa na hora), e hoje autoriza LER projeto 360 oculto e privado
-- daquela OM. Isso é escalação de privilégio por formulário público. Todo ramo de
-- autorização que lia lotação passa a ler o escopo de PRODUÇÃO (018), que só um
-- administrador concede. O eixo de OM não some da autorização; ele passa a ser
-- CONCEDIDO em vez de DECLARADO.
--
-- Esta migração não muda comportamento sozinha: ela cria as colunas e redefine os
-- predicados. As queries de aplicação que ainda passam `organization_id` como
-- parâmetro são trabalho da fase seguinte, e enquanto elas existirem o eixo antigo
-- continua de pé no SQL da aplicação, não aqui.
--
-- NÃO HÁ DDL DESTRUTIVA NESTE ARQUIVO. As funções mudam por CREATE OR REPLACE com
-- assinatura idêntica (o `DROP FUNCTION` que uma troca de assinatura exigiria seria
-- destrutivo e obrigaria uma linha em EXCECOES_DESTRUTIVAS), e as colunas e
-- constraints só entram.

-- ---------------------------------------------------------------------------
-- 1. A OM produtora do recurso de catálogo
-- ---------------------------------------------------------------------------
--
-- AS CINCO TABELAS, NÃO AS TRÊS EM USO, pelo mesmo motivo que `access_level` foi
-- para as cinco em 017: elas nasceram de `LIKE basemaps INCLUDING ALL`
-- (003_sync.sql) e `catalog-tabelas-paridade.test.js` exige conjuntos idênticos de
-- (nome, tipo, nullable, default). Acrescentar a coluna só onde ela é lida reprova
-- aquele teste, que existe exatamente para pegar esta classe de esquecimento.
--
-- Diferente de `access_level`, porém, aqui as cinco são MESMO consultadas: a spec
-- diz que o produtor mexe em TODOS os tipos da própria OM, e `basemaps` e
-- `streetview_markers` são tipos de catálogo como os outros três. O que elas não
-- têm é tipo de CONCESSÃO (`resource_grants.resource_type` tem quatro valores e
-- não as inclui) — dois vocabulários distintos, e conflatá-los faz
-- `POST /basemaps` responder 500 em vez de 403.
--
-- NULL = INSTITUCIONAL. Toda linha existente nasce NULL e continua mantida só por
-- administrador, que é o comportamento de hoje. NULL não é "sem dono a definir",
-- é um estado terminal legítimo: as camadas de base que vieram do seed não foram
-- produzidas por nenhuma OM. O gate de produção compara igualdade, e NULL nunca
-- é igual a nada, então o produtor não alcança essas linhas por construção — sem
-- precisar de um ramo `IS NULL` que alguém escreveria errado.
--
-- `sv360.projects` NÃO ganha coluna: `organization_id` lá JÁ É a OM produtora
-- (o projeto é ingerido por bundle, sob um `{orgId}__{slug}.db`, e a coluna faz
-- parte do UNIQUE(organization_id, slug)). Criar uma segunda coluna ali daria duas
-- respostas para a mesma pergunta.
ALTER TABLE basemaps           ADD COLUMN owner_org_id UUID REFERENCES organizations(id);
ALTER TABLE data_layers        ADD COLUMN owner_org_id UUID REFERENCES organizations(id);
ALTER TABLE analysis_layers    ADD COLUMN owner_org_id UUID REFERENCES organizations(id);
ALTER TABLE tilesets           ADD COLUMN owner_org_id UUID REFERENCES organizations(id);
ALTER TABLE streetview_markers ADD COLUMN owner_org_id UUID REFERENCES organizations(id);

-- Índices PARCIAIS no lado produzido, que é o pequeno enquanto o acervo
-- institucional for a maioria. Eles servem a tela "o que a minha OM mantém", não
-- o gate: o gate resolve a linha pela PK e não passa por aqui.
CREATE INDEX idx_basemaps_owner_org           ON basemaps(owner_org_id)           WHERE owner_org_id IS NOT NULL;
CREATE INDEX idx_data_layers_owner_org        ON data_layers(owner_org_id)        WHERE owner_org_id IS NOT NULL;
CREATE INDEX idx_analysis_layers_owner_org    ON analysis_layers(owner_org_id)    WHERE owner_org_id IS NOT NULL;
CREATE INDEX idx_tilesets_owner_org           ON tilesets(owner_org_id)           WHERE owner_org_id IS NOT NULL;
CREATE INDEX idx_streetview_markers_owner_org ON streetview_markers(owner_org_id) WHERE owner_org_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. O prazo da concessão
-- ---------------------------------------------------------------------------
--
-- Concessão de acesso a recurso privado passa a CADUCAR. Teto de um ano, default
-- de um ano.
--
-- A MORTE MORA NO PREDICADO, NUNCA NUMA VARREDURA. Não existe sweeper que escreva
-- `revoked_at` quando o prazo vence, e a ausência é a decisão: um sweeper é mais
-- um verificador, e verificador quebra calado — o dia em que o cron não roda, o
-- acesso expirado continua vivo e nada fica vermelho. Com o prazo dentro de
-- `fn_granted_resource_ids`, "expirou" e "não aparece" são o MESMO fato, e não
-- dois fatos que precisam concordar.
--
-- Consequência que a leitura precisa aceitar: uma concessão expirada continua com
-- `revoked_at IS NULL`. Revogada e expirada são estados DIFERENTES (a primeira tem
-- autor e hora, a segunda é o relógio), e toda query que hoje define "concessão
-- viva" como `revoked_at IS NULL` está, a partir daqui, definindo errado. São seis
-- sítios em `resource-access.queries.js` além das duas referências dentro da
-- função de resolução, e dois deles decidem quem pode REPASSAR acesso; alcançá-los
-- é trabalho da fase de aplicação, e este comentário é o aviso de que existe uma
-- diferença entre VER (já corrigido abaixo) e REPASSAR (ainda não).
--
-- O DEFAULT É VOLÁTIL de propósito (`NOW() + INTERVAL '1 year'`, avaliado por
-- linha). O ALTER abaixo reescreve a tabela para materializá-lo nas linhas
-- existentes, o que é aceitável numa tabela desta ordem de grandeza.
ALTER TABLE resource_grants
  ADD COLUMN expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 year');

-- Defensivo, e no-op em banco novo (a 017 é da mesma leva e nenhuma linha é velha
-- o bastante). Em banco de desenvolvimento com concessões antigas, o DEFAULT
-- acima daria `NOW() + 1 ano` para uma linha cujo `created_at` é do mês passado,
-- e o CHECK de teto abaixo recusaria a própria migração. Esta linha ancora o
-- prazo no nascimento da concessão, que é o que o teto significa.
UPDATE resource_grants
   SET expires_at = created_at + INTERVAL '1 year'
 WHERE expires_at > created_at + INTERVAL '1 year';

-- O teto e o piso, no mesmo CHECK. O piso (`> created_at`) recusa a concessão que
-- nasce morta, que só pode ser erro de chamador. O teto (um ano) é a política, e
-- está aqui e não só na aplicação porque o INSERT cru existe (testes de função
-- escrevem direto na tabela) e porque um teto que a borda esquece de aplicar é um
-- teto que não existe.
--
-- Repare que os dois lados comparam com `created_at`, não com `NOW()`: o CHECK
-- precisa continuar verdadeiro para sempre, e um predicado ancorado no relógio
-- ficaria falso amanhã e travaria qualquer UPDATE na linha.
ALTER TABLE resource_grants ADD CONSTRAINT resource_grants_expires_at_check
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '1 year');

-- NÃO HÁ ÍNDICE SOBRE `expires_at`, e a ausência é medida, não esquecimento.
-- O índice que a resolução usa é `idx_resource_grants_grantee`, parcial em
-- `revoked_at IS NULL`; acrescentar `AND expires_at > NOW()` a um predicado de
-- índice parcial é impossível (NOW() não é IMMUTABLE), e um índice separado em
-- `expires_at` não ajuda uma consulta que já entrou pelo beneficiário e devolve
-- unidades de linhas. O filtro de prazo roda sobre esse punhado.
--
-- `atlas_resources` NÃO ganha relógio próprio, de propósito: o braço D4 já amarra
-- o empréstimo a "o dono do atlas continua vendo o recurso", então o empréstimo
-- morre junto com a concessão do dono, sem uma segunda data para manter coerente.

-- ---------------------------------------------------------------------------
-- 3. O gate de PRODUÇÃO
-- ---------------------------------------------------------------------------
--
-- "Este usuário mantém este recurso?" — uma pergunta, UMA definição. Ela responde
-- pelos SEIS tipos (as cinco tabelas de catálogo mais o projeto 360), que é um
-- vocabulário maior que o de `resource_grants.resource_type`, e a diferença é
-- proposital: concessão é sobre os quatro tipos que uma pessoa recebe; produção é
-- sobre tudo que uma OM mantém.
--
-- É plpgsql e não SQL puro porque precisa de despacho por tipo. O DESPACHO É UM
-- `CASE` SOBRE LITERAIS, nunca `EXECUTE format('%I', p_type)`: com `format` o nome
-- da tabela viria do argumento, e o argumento vem de um caminho que uma rota nova
-- pode alimentar com o corpo do request. Aqui o conjunto de tabelas alcançáveis é
-- fechado no texto da função, e o `ELSE` levanta em vez de devolver FALSE — tipo
-- desconhecido é bug de chamador, e FALSE silencioso viraria um 404 que ninguém
-- consegue explicar.
--
-- O ADMIN passa por aqui em vez de por um `OR fn_has_global_data_access(...)` no
-- chamador porque `fn_has_global_data_access` inclui o CREDENCIADO, que não
-- escreve nada. Os dois eixos globais não se contêm e não podem compartilhar
-- predicado: quem lê tudo não é quem mantém, e nenhum dos dois é o outro.
--
-- A conta e a OM de LOTAÇÃO precisam estar ativas, mesmo o eixo de lotação não
-- autorizando mais nada: isso é LIVENESS (conta desativada não age), não
-- autorização por OM, e é o mesmo COALESCE de `fn_has_global_data_access`.
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
        WHEN 'streetview_marker' THEN
            SELECT owner_org_id INTO v_owner_org FROM streetview_markers WHERE id = p_resource_id;
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
-- 4. As três funções da 017 que mudam
-- ---------------------------------------------------------------------------
--
-- CREATE OR REPLACE, assinatura idêntica: a 017 fica como está (histórico), e a
-- definição VIVA é esta. Editar a 017 seria reescrever um degrau já numerado, e
-- ler a 017 esperando o comportamento atual é o erro que este parágrafo evita.

-- 4.1 — 'curator' vira 'credenciado'. SUBSTITUIÇÃO, não alargamento: o valor
-- antigo sai da função no mesmo commit em que sai do CHECK (018). Se os dois
-- termos convivessem, um banco com a 018 antiga aplicada continuaria funcionando
-- e ninguém descobriria a divergência até a próxima leitura à mão.
--
-- O resto do corpo não muda, e o motivo dele continua valendo por inteiro: o
-- papel é resolvido NO BANCO e não no JWT porque o token vive até 15 min e
-- `flexibleAuth` (que autentica o caminho de leitura do sv360 e do /api/config)
-- não reconcilia, então um credenciado rebaixado carregaria o papel antigo por
-- essa janela. Resolver aqui elimina a janela por construção.
CREATE OR REPLACE FUNCTION fn_has_global_data_access(p_user_id UUID)
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

-- 4.2 — a resolução aprende o prazo, NOS DOIS SÍTIOS.
--
-- Esta função consulta `resource_grants` DUAS vezes: o braço direto (a concessão
-- do próprio usuário) e o `EXISTS (... og ...)` dentro do braço D4 (a concessão do
-- DONO do atlas, que é o que sustenta o empréstimo). Pôr `expires_at > NOW()` só
-- no primeiro deixaria o empréstimo de atlas vivo com a concessão do dono já
-- expirada — a morte moraria em METADE do predicado, que é pior que não morar em
-- nenhuma, porque o vazamento fica no braço que ninguém olha. As duas linhas são
-- a mesma decisão e mudam juntas.
--
-- O resto do corpo é o da 017, incluindo os dois `IS NOT NULL` que são declaração
-- de intenção e não mecanismo (a lógica de três valores já entrega o mesmo
-- resultado sem eles; removê-los deixa a suíte verde, então não conte com teste
-- para segurá-los).
CREATE OR REPLACE FUNCTION fn_granted_resource_ids(
    p_user_id UUID, p_atlas_id UUID, p_type TEXT
) RETURNS TABLE (resource_id TEXT) LANGUAGE sql STABLE AS $$
    SELECT g.resource_id
      FROM resource_grants g
     WHERE g.revoked_at IS NULL
       AND g.expires_at > NOW()
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
       -- D4: o empréstimo vive enquanto o DONO do atlas vir o recurso. Condição
       -- ESTÁVEL (o dono é uma coluna, não uma cadeia), que faz a revogação E a
       -- expiração propagarem sozinhas para todos os membros do atlas e para o
       -- visitante de link público, sem varredura periódica. Este ramo NÃO
       -- recorre: consulta papel global e concessão DIRETA, nunca o empréstimo.
       AND ( fn_has_global_data_access(a.owner_id)
             OR EXISTS (SELECT 1 FROM resource_grants og
                         WHERE og.revoked_at IS NULL
                           AND og.expires_at > NOW()
                           AND og.resource_type = ar.resource_type
                           AND og.resource_id   = ar.resource_id
                           AND og.grantee_id    = a.owner_id) );
$$;

-- 4.3 — o predicado escalar ganha o ramo de PRODUÇÃO.
--
-- O produtor vê o privado da própria OM SEM concessão individual, e essa é a
-- diferença entre manter e receber: exigir que um administrador conceda ao
-- produtor acesso àquilo que a OM dele produziu inverteria a relação, e criaria
-- uma concessão que precisaria ser renovada todo ano para o mantenedor continuar
-- enxergando o próprio acervo.
--
-- ORDEM DOS TERMOS: `p_access_level = 'public'` primeiro por leitura, mas não
-- conte com curto-circuito — Postgres não garante ordem de avaliação num OR, e é
-- por isso que `fn_can_produce_resource` reconhece os SEIS tipos e não só os
-- quatro que `resource_grants` aceita. Se ela levantasse para 'basemap', este OR
-- levantaria em qualquer arranjo do planejador no dia em que o gate de catálogo
-- passar a chamar esta função para as cinco tabelas.
--
-- Continua COMPOSTO, sem repetir uma linha de regra das outras duas.
CREATE OR REPLACE FUNCTION fn_can_see_resource(
    p_user_id UUID, p_atlas_id UUID, p_type TEXT, p_resource_id TEXT, p_access_level TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT p_access_level = 'public'
        OR fn_has_global_data_access(p_user_id)
        OR fn_can_produce_resource(p_user_id, p_type, p_resource_id)
        OR EXISTS (SELECT 1 FROM fn_granted_resource_ids(p_user_id, p_atlas_id, p_type) r
                    WHERE r.resource_id = p_resource_id);
$$;
