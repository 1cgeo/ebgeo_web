-- Path: src/database/migrations/011_grupo_com_dono_e_producao.sql
-- DOIS EIXOS QUE SE ENCOSTAM NA MESMA LEITURA: o grupo de acesso ganha DONO, e o
-- eixo de PRODUCAO passa a valer no emprestimo por atlas e na listagem do que se
-- pode repassar.
--
-- POR QUE OS DOIS NO MESMO ARQUIVO. `fn_granted_resource_ids` consulta
-- `fn_user_group_ids`, e este arquivo redefine as duas: a checagem de vida do DONO
-- do grupo entra na funcao de grupo (o lugar mais FUNDO), e o termo de producao
-- entra no braco de emprestimo da funcao de resolucao. Separa-las em duas migracoes
-- deixaria uma janela em que a resolucao ja conhece producao e o grupo ainda entrega
-- acesso por dono morto -- e, pior, duas migracoes tocando `fn_granted_resource_ids`
-- se sobrescrevem em silencio, porque `CREATE OR REPLACE` nao avisa.
--
-- SO EXISTE UM `CREATE OR REPLACE FUNCTION fn_granted_resource_ids` NESTE ARQUIVO, e
-- essa propriedade e contrato: um segundo vence o primeiro sem erro nenhum. Quem
-- precisar mexer no braco D4 funde AQUI. A mesma regra vale para as outras duas
-- funcoes que este arquivo substitui (`fn_user_group_ids` e `fn_can_produce_resource`):
-- uma redefinicao por nome, e o teste de introspecao exige UMA linha em `pg_proc`
-- para cada uma.
--
-- DOIS PADROES DE `EXCECOES_DESTRUTIVAS` SAO DISPARADOS AQUI, e sao exatamente dois:
-- o `ALTER TABLE users DROP COLUMN org_role` do BLOCO D7 e o
-- `ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_action_check` do BLOCO E, cada
-- um pagando UMA linha na lista. O `ADD` que repoe o CHECK nao e destrutivo e nao
-- entra. O `DROP INDEX` do BLOCO A e destrutivo na pratica e NAO casa nenhum dos cinco
-- padroes (DROP TABLE, DROP COLUMN, TRUNCATE, ALTER COLUMN ... TYPE, DROP CONSTRAINT):
-- acrescentar uma linha por ele faria a contagem exata daquele teste reprovar, porque a
-- contagem compara achados com excecoes declaradas.
--
-- OS SEIS BLOCOS, E QUATRO DELES NAO ESTAO NO NOME DO ARQUIVO de proposito. O BLOCO B
-- leva o eixo de grupo ao COMPARTILHAMENTO DE ATLAS (`atlas_shares.group_id` e as tres
-- funcoes de resolucao), o BLOCO D acrescenta o eixo de ORGANIZACAO a trilha
-- (`audit_trail.target_org_id`), o BLOCO D7 remove o eixo `org_role` e o BLOCO E alarga
-- o vocabulario da trilha para a poda que NAO derrubou; nenhum dos quatro e "grupo com
-- dono" nem "producao", e os quatro estao aqui porque a onda que os decidiu e esta.
--
-- OS BLOCOS D E E TOCAM `audit_trail` NA MESMA TRANSACAO e sao compativeis: um
-- acrescenta COLUNA, o outro alarga o CHECK de OUTRA coluna. Nenhum le o que o outro
-- escreve, entao a ordem entre eles e so de leitura.
-- Renomear o arquivo quebraria as citacoes por nome que os comentarios desta onda ja
-- fazem (a convencao proibe citar migracao por numero solto), e a citacao errada custa
-- mais que o nome incompleto.
--
-- A ORDEM DOS BLOCOS E DEPENDENCIA, NAO CRONOLOGIA: o BLOCO B consulta
-- `fn_user_group_ids`, que o BLOCO A redefine, entao A vem antes de B. Como o corpo de
-- uma funcao `LANGUAGE sql` classica so se resolve na execucao, a ordem aqui e
-- legibilidade e nao obrigacao do motor -- mas escrever B antes de A convidaria o
-- proximo leitor a supor a definicao velha.

-- ===========================================================================
-- BLOCO A -- O GRUPO DE ACESSO GANHA DONO
-- ===========================================================================
--
-- Ate aqui `access_groups.created_by` era DECORATIVO: nenhuma consulta de
-- autorizacao o lia, e quem administrava qualquer grupo era o papel global de dado
-- (administrador ou credenciado). O grupo passa a ser entidade de USUARIO: qualquer
-- sessao autenticada cria um, e quem cria e o dono.
--
-- POR QUE UMA COLUNA NOVA E NAO A PROMOCAO DE `created_by`: quem criou e historia (a
-- trilha responde por ela) e quem manda e autoridade. Fundir as duas impede qualquer
-- transferencia de dono sem falsificar o registro de criacao, e faz uma linha semeada
-- por SQL direto, sem `created_by`, virar um grupo que ninguem administra sem que
-- nada diga isso.
ALTER TABLE access_groups ADD COLUMN owner_id UUID REFERENCES users(id);

-- Backfill: todo grupo criado pela rota tem `created_by` preenchido (o servico sempre
-- grava `actor.id`), entao esta linha adota o criador como dono. O que sobrar com
-- NULL e grupo SEM DONO, e os predicados abaixo o tratam como estado definido: so o
-- administrador o administra, e ele nao entrega acesso a ninguem (ver a nota de
-- `fn_user_group_ids`).
UPDATE access_groups SET owner_id = created_by WHERE owner_id IS NULL;

-- O indice que a listagem percorre: "quais grupos sao MEUS", filtrando por vivo.
CREATE INDEX idx_access_groups_owner ON access_groups (owner_id) WHERE deleted_at IS NULL;

-- A UNICIDADE DE NOME PASSA A SER POR DONO. Com todo usuario criando grupo, um unico
-- global faria o 409 falar de um grupo que o chamador nao pode ver: recusa e
-- vazamento na mesma resposta. Continua PARCIAL (`deleted_at IS NULL`) pelo motivo de
-- sempre -- sem isso um grupo apagado ocuparia o nome para sempre, que e o beco
-- documentado em `catalog-soft-delete-resurrect.repro`.
--
-- O indice novo e ESTRITAMENTE MAIS FRACO que o antigo (unico global sobre
-- `LOWER(name)` entre vivos), entao ele nao pode falhar por dado pre-existente: dois
-- grupos vivos do mesmo dono com o mesmo nome eram impossiveis ate agora.
--
-- Consequencia declarada: dois grupos SEM dono podem repetir o nome, porque NULL nao
-- colide com NULL num indice unico. Sao os orfaos do backfill acima.
--
-- SEGUNDA CONSEQUENCIA, E ELA NAO E DE UNICIDADE: o indice derrubado tambem servia a
-- ORDENACAO. A 009_grupos_de_acesso.sql diz por extenso que nao criou um indice de
-- nome separado porque "`uq_access_groups_nome_vivo` ja indexa `LOWER(name)` entre os
-- vivos e serve a ordenacao"; um btree em `(owner_id, LOWER(name))` NAO serve a
-- ordenacao por `LOWER(name)` sozinho, e as duas listagens do modulo ordenam por ele.
-- Forward-only proibe reescrever a 009, entao a justificativa de la vira historia em
-- tempo presente e e ESTA linha que a supera. O indice de ordenacao volta abaixo, nao
-- unico: o recorte por dono deixa poucas linhas para quase todo mundo, mas o
-- administrador global ve TODOS os grupos numa lista so, e e a listagem dele que
-- ficaria sem apoio.
DROP INDEX uq_access_groups_nome_vivo;
CREATE UNIQUE INDEX uq_access_groups_nome_vivo_do_dono
    ON access_groups (owner_id, LOWER(name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_access_groups_nome_vivo ON access_groups (LOWER(name)) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Os dois predicados de autoridade sobre grupo
-- ---------------------------------------------------------------------------
--
-- `fn_is_global_admin` e o papel de ADMINISTRACAO DO SISTEMA, e nao
-- `fn_has_global_data_access`: ver todo recurso privado (o que o credenciado faz) e
-- mandar no grupo de outra pessoa sao poderes diferentes -- a mesma distincao que
-- GRANT_REVOKER_ACTOR ja fez. Ele repete a forma de `fn_has_global_data_access`
-- (conta ativa, OM ausente ou ativa) trocando a lista de papeis pelo unico que
-- administra.
--
-- O LITERAL 'admin' FICA AQUI, EM SQL, DE PROPOSITO: em JavaScript ele criaria um
-- sitio novo no censo de papel global e, pior, seria papel lido do token -- que o
-- `flexibleAuth` nao reconcilia, entao um administrador rebaixado carregaria o cracha
-- antigo por ate 15 minutos.
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

-- "Este principal manda neste grupo?" -- UMA pergunta, UMA definicao, usada em TRES
-- lugares que precisam concordar: o gate das cinco rotas apontadas
-- (`requireGroupAuthority`), o recorte da listagem, e o beneficiario COLETIVO de uma
-- concessao nova (`GET_ADDRESSABLE_LIVE_GROUP`). O terceiro nao e simetria gratuita:
-- conceder a um coletivo que outra pessoa compoe e delegar a ela o poder de
-- acrescentar beneficiarios ao SEU recurso sem passar por voce.
--
-- `fn_principal_vivo` no ramo do dono pelo mesmo motivo que ela nasceu na
-- 008_acesso_a_recurso.sql: o ramo de papel sempre checou liveness e o ramo que nao
-- checava era o que vazava.
--
-- NAO HA RAMO DE PRODUCAO AQUI, e a ausencia e a decisao: produzir um recurso nao da
-- autoridade sobre o coletivo de outra pessoa. Um produtor que conceda de raiz a um
-- grupo so consegue se o grupo for dele.
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

-- ---------------------------------------------------------------------------
-- A AUTORIDADE MORRE COM QUEM A EXERCIA: o grupo passa a olhar para o DONO
-- ---------------------------------------------------------------------------
--
-- ATE AQUI `fn_user_group_ids` PERGUNTAVA SO PELO GRUPO (`deleted_at IS NULL`).
-- Resultado: dono desativado, grupo vivo, membros enxergando, e -- depois desta
-- migracao, em que o dono e o unico administrador -- ninguem podendo apagar aquele
-- grupo a nao ser o administrador do sistema. E a mesma forma de defeito que
-- `fn_principal_vivo` fechou no ramo de concessao: autoridade que sobrevive a quem a
-- exercia.
--
-- A CHECAGEM VAI NO LUGAR MAIS FUNDO, e nao no ramo coletivo de
-- `fn_granted_resource_ids`, porque esta funcao alimenta TRES portas que precisam
-- fechar juntas: a resolucao de leitura (o braco de grupo), o gate de REPASSE
-- (`LIVE_GRANTS_OF_ACTOR` e `LIST_SHAREABLE_OF_ACTOR`) e, quando o eixo de grupo
-- chegar ao atlas, o compartilhamento. Pondo a checagem num ramo so, as outras duas
-- ficariam abertas sem erro em lugar nenhum.
--
-- GRUPO SEM DONO NAO CONCEDE, e isso e falha FECHADA deliberada: `fn_principal_vivo`
-- devolve false para NULL. Um grupo orfao (semeado por SQL direto, sem `created_by`)
-- deixa de entregar acesso e continua administravel pelo administrador, que pode
-- apaga-lo. O contrario -- orfao que concede para sempre e ninguem administra -- e
-- exatamente o estado que esta linha existe para impedir.
CREATE OR REPLACE FUNCTION fn_user_group_ids(p_user_id UUID)
RETURNS TABLE (group_id UUID) LANGUAGE sql STABLE AS $$
    SELECT gm.group_id
      FROM access_group_members gm
      JOIN access_groups ag ON ag.id = gm.group_id AND ag.deleted_at IS NULL
     WHERE p_user_id IS NOT NULL
       AND gm.user_id = p_user_id
       AND fn_principal_vivo(ag.owner_id);
$$;

-- ===========================================================================
-- BLOCO B -- O EIXO DE GRUPO CHEGA AO COMPARTILHAMENTO DE ATLAS
-- ===========================================================================
--
-- Ate aqui `atlas_shares` era NOMINAL: uma linha por pessoa. O grupo de acesso, que ja
-- decidia recurso privado, passa a ser um alvo alternativo, com os MESMOS quatro niveis
-- concediveis (`read`, `comment`, `write`, `manage`). `owner` continua fora, e nao por
-- escolha de aplicacao: o CHECK de `atlas_shares.permission` (003_atlas.sql) nunca
-- aceitou o valor.
--
-- POR QUE COLUNA NOVA E NAO TABELA IRMA. O padrao ja existe neste schema, em
-- `resource_grants`: `num_nonnulls` declara "o alvo e exatamente um dos dois" sem
-- escrever as quatro combinacoes a mao. Uma tabela irma custaria o oposto -- os leitores
-- de `atlas_shares` que decidem acesso ganhariam cada um um JOIN e um UNION proprio, e a
-- pergunta "quem alcanca este atlas" passaria a ter duas respostas que precisam
-- concordar. `permission`, `added_by` e `added_at` sao identicos nos dois alvos, entao a
-- tabela irma seria a mesma tabela com outro nome.
--
-- NENHUMA DDL DESTRUTIVA, e isso NAO e sorte. O `UNIQUE (atlas_id, user_id)` herdado da
-- 003_atlas.sql CONTINUA valendo e nao precisa ser derrubado: linha de grupo carrega
-- `user_id` NULL, e NULL nao colide com NULL num indice unico (NULLS DISTINCT, o
-- default). MEDIDO nesta instalacao antes de escrito, e pinado pelo caso de alvo unico de
-- `tests/integration/atlas-share-por-grupo.test.js`: se a premissa deixar de valer numa
-- instalacao futura, aquele caso fica vermelho antes de qualquer usuario sofrer. Por isso
-- nao ha `DROP CONSTRAINT` aqui e `EXCECOES_DESTRUTIVAS`
-- (tests/unit/migrations-higiene.test.js) nao ganha entrada por causa deste bloco:
-- `ALTER COLUMN ... DROP NOT NULL` nao casa nenhum dos cinco padroes.
ALTER TABLE atlas_shares ALTER COLUMN user_id DROP NOT NULL;

-- ON DELETE CASCADE e cinto de seguranca para expurgo FISICO, NAO o mecanismo de
-- revogacao: apagar grupo e SOFT (`access_groups.deleted_at`), e soft nunca dispara
-- CASCADE. Quem mata o share de um grupo apagado e `fn_user_group_ids`, dentro da
-- resolucao -- a mesma decisao, com as mesmas palavras, de
-- `resource_grants.parent_grant_id`.
--
-- Consequencia declarada: a linha de um grupo apagado fica INERTE na tabela. Ela nao
-- concede nada e nao aparece em tela nenhuma; quem a olhar direto no banco vai achar que
-- e lixo, e e por isso que esta frase existe.
ALTER TABLE atlas_shares
    ADD COLUMN group_id UUID REFERENCES access_groups(id) ON DELETE CASCADE;

ALTER TABLE atlas_shares
    ADD CONSTRAINT atlas_shares_alvo_unico_check
        CHECK (num_nonnulls(user_id, group_id) = 1);

-- O irmao do UNIQUE herdado da 003_atlas.sql. Sem ele, compartilhar o mesmo atlas duas
-- vezes com o mesmo grupo criaria duas linhas vivas com niveis diferentes, e a resolucao
-- escolheria a maior calada em vez de recusar a segunda escrita.
ALTER TABLE atlas_shares
    ADD CONSTRAINT atlas_shares_atlas_id_group_id_key UNIQUE (atlas_id, group_id);

-- O indice do braco de grupo da resolucao, percorrido no caminho quente (todo request
-- gateado e todo heartbeat de WS). Sem ele o braco varre a tabela inteira.
CREATE INDEX idx_atlas_shares_group
    ON atlas_shares (group_id) WHERE group_id IS NOT NULL;

-- A ESCADA, EM SQL, UMA VEZ. `read < comment < write < manage < owner`, os mesmos numeros
-- de `PERMISSION_LEVELS` (src/middleware/permissions.js). Nivel desconhecido vale 0, que
-- e MENOS que `read`: falha fechada. O valor 5 de `owner` existe por PARIDADE com aquela
-- tabela, nao porque a coluna o aceite -- ela nunca aceitou, e a posse vem de
-- `atlas.owner_id`. Ha um teste que compara as duas tabelas valor a valor, porque duas
-- copias de uma escada e o defeito que esta casa ja pagou duas vezes.
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

-- A RESOLUCAO: que atlas esta pessoa alcanca por share, e em que nivel.
--
-- PRECEDENCIA: O MAIOR VENCE, sempre. Share direto e share por grupo sao dois caminhos
-- ate o mesmo atlas, nunca dois pesos: quem tem `read` direto e esta num grupo com
-- `write` fica `write`, e quem tem `manage` direto e esta num grupo com `read` fica
-- `manage`. A propriedade que o maximo garante e o motivo de ele ter sido escolhido:
-- acrescentar um caminho NUNCA rebaixa ninguem, porque maximo e monotono sob inclusao de
-- conjunto, e o caso antigo (so o direto) e o conjunto de um elemento.
--
-- UNION ALL E NAO `OR`, pelo mesmo motivo escrito em `fn_granted_resource_ids`: cada
-- metade entra pelo seu indice (`idx_atlas_shares_user` e `idx_atlas_shares_group`),
-- enquanto um `OR` sobre duas colunas costuma virar varredura. MEDIDO por EXPLAIN antes
-- de escrito: as duas metades entram por Bitmap Index Scan.
--
-- O DESEMPATE (`direto DESC`) e determinismo, nao politica: com niveis iguais as duas
-- linhas devolvem a mesma string, e a ordem so passa a importar no dia em que esta funcao
-- devolver TAMBEM a origem.
--
-- ELA NAO OLHA `atlas.deleted_at`, de proposito: responde "que shares alcancam esta
-- pessoa", nao "que atlas ela pode abrir". Quem filtra atlas na lixeira sao os chamadores,
-- que ja filtravam antes desta funcao existir.
--
-- GRUPO APAGADO E GRUPO DE DONO MORTO NAO ENTRAM, e isso vem de graca: quem responde
-- pelos dois e `fn_user_group_ids`, redefinida no BLOCO A acima. E o mesmo predicado que
-- decide recurso privado, entao as duas portas fecham juntas.
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

-- QUEM SAO OS MEMBROS DESTE ATLAS, contando quem entra por grupo.
--
-- Existe porque o cartao da tela "Seus atlas" mostra os participantes e a contagem, e a
-- versao antiga somava LINHAS de `atlas_shares`: com grupo, um coletivo de quarenta
-- pessoas contaria como um membro so, e as quarenta nao apareceriam na lista onde elas
-- proprias deveriam estar.
--
-- `UNION` (nao `UNION ALL`) porque quem tem share direto E esta num grupo compartilhado e
-- uma pessoa so. O DONO nao sai daqui: quem o exclui e o chamador, que ja o soma a parte,
-- e agora precisa exclui-lo explicitamente, porque o dono PODE estar num grupo
-- compartilhado do proprio atlas e seria contado duas vezes.
--
-- Ela expande em PESSOAS, e nao devolve o grupo como uma entidade. A alternativa faria o
-- proprio membro nao se ver na lista de participantes do atlas de que ele participa.
--
-- O BRACO DE GRUPO CARREGA O MESMO PAR DE PREDICADOS DA RESOLUCAO (grupo vivo E dono
-- vivo), e a paridade e o ponto. Enquanto ele filtrava so `deleted_at IS NULL`, esta
-- funcao e `fn_user_atlas_shares` DISCORDAVAM exatamente no caso que o BLOCO A existe
-- para fechar: com o dono do grupo desativado, o cartao de "Seus atlas" contava e NOMEAVA
-- (`nome`, `posto_graduacao`) pessoas que o gate ja recusava com 404. Medido antes de
-- escrito: `resolve = null` e `member_count = 2` na mesma fixture. Duas portas para o
-- mesmo fato, uma aberta e a outra fechada, e a que ficou aberta e a que divulga nome de
-- quem nao e membro -- para qualquer participante, inclusive Leitor, porque
-- `GET /atlas/overview` e `auth`-only.
--
-- POR QUE REPETIR O PREDICADO EM VEZ DE CHAMAR `fn_user_group_ids`: aquela funcao e por
-- PESSOA (recebe o usuario e devolve os grupos dele) e aqui a pergunta e inversa (recebe o
-- atlas e devolve as pessoas). Chama-la exigiria varrer usuarios. O que precisa andar
-- junto e o PAR de predicados, e e por isso que ele esta escrito com as mesmas duas
-- palavras nas duas funcoes, e nao derivado.
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

-- ===========================================================================
-- BLOCO C -- O EIXO DE PRODUCAO ENTRA NA RESOLUCAO
-- ===========================================================================

-- (0) A OM PRODUTORA PRECISA ESTAR VIVA PARA QUE ALGUEM PRODUZA POR ELA.
--
-- O DEFEITO, MEDIDO ANTES DE ESCRITO: `fn_can_produce_resource` conferia a vida da
-- conta e a da OM de LOTACAO (`users.organization_id`), e nunca a da OM PRODUTORA
-- (`users.producer_org_id`). Como as duas podem ser organizacoes diferentes,
-- desativar a OM produtora deixava o acervo privado dela sendo mantido, marcado
-- publico/privado e listado como repassavel por quem a mantinha.
--
-- POR QUE ISTO ENTRA NESTA MIGRACAO, e nao numa de arrumacao: o BLOCO C abaixo pluga
-- o eixo de producao em TRES superficies que ele nao tinha (o braco de emprestimo por
-- atlas, o campo `shareable` da listagem e o gate de manutencao). A primeira delas e
-- lida por VISITANTE ANONIMO de link publico. Espalhar o predicado sem fechar o furo
-- transformaria uma leitura do proprio mantenedor numa leitura de qualquer um.
--
-- DESATIVAR UMA OM E KILL-SWITCH DECLARADO NO PRODUTO (ver `docs/wiki/organizacoes-om.md`),
-- e a assimetria "a lotacao mata, a produtora nao" nao tinha razao escrita em lugar
-- nenhum: era o ramo que ninguem perguntou. E a mesma forma de defeito que
-- `fn_principal_vivo` fechou no ramo de concessao, e que o BLOCO A acabou de fechar no
-- dono do grupo -- autoridade que sobrevive a quem a exercia.
--
-- O RAMO DO ADMINISTRADOR NAO MUDA: ele volta `true` antes de qualquer ramo de OM, e
-- e por isso que a checagem nova entra DEPOIS do early return de papel, e nao no
-- SELECT inicial. Pondo-a no SELECT, um administrador sem OM produtora (o caso comum)
-- deixaria de administrar.
CREATE OR REPLACE FUNCTION fn_can_produce_resource(
    p_user_id UUID, p_type TEXT, p_resource_id TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_role       TEXT;
    v_scope      UUID;
    v_prod_ativa BOOLEAN;
    v_owner_org  UUID;
BEGIN
    -- Visitante anonimo (p_user_id NULL) nao produz nada. O early return tambem
    -- e o que impede a funcao de levantar por tipo desconhecido num caminho
    -- anonimo, onde o erro seria um 500 no lugar de uma tela vazia.
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
    -- escopo, mas a funcao nao se apoia nisso: um CHECK protege a tabela, e esta
    -- funcao e lida por quem esta decidindo acesso. `v_scope IS NULL` aqui pararia
    -- num FALSE de qualquer jeito (NULL = NULL nao e verdadeiro), e a linha
    -- explicita diz o porque.
    --
    -- `NOT v_prod_ativa` e o termo novo de 2026-08-21. Repare que ele NAO usa
    -- COALESCE(.., true) como o ramo de lotacao: lotacao ausente e o estado normal de
    -- quem nao declarou OM, e produtora ausente e impossivel neste ponto (o `v_scope
    -- IS NULL` acima ja saiu). Aqui `false` significa "a OM produtora existe e esta
    -- desativada", e a resposta certa e nao produzir.
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
            -- `id::text = p_resource_id` e nao `p_resource_id::uuid`: o id de
            -- catalogo e slug e o de 360 e UUID, e um chamador que erre o tipo
            -- levaria um 22P02 (invalid input syntax) que a borda traduz em 400
            -- e o leitor le como "requisicao malformada". Comparar do lado texto
            -- devolve simplesmente "nao encontrei", que e a verdade.
            SELECT organization_id INTO v_owner_org FROM sv360.projects  WHERE id::text = p_resource_id;
        ELSE
            RAISE EXCEPTION 'fn_can_produce_resource: tipo de recurso fora da whitelist: %', p_type
              USING ERRCODE = 'invalid_parameter_value';
    END CASE;

    -- Recurso institucional (owner_org_id NULL) e recurso inexistente caem no
    -- mesmo FALSE, e e o resultado certo para os dois: nenhum produtor mantem
    -- acervo institucional, e ninguem mantem o que nao existe.
    RETURN v_owner_org IS NOT NULL AND v_owner_org = v_scope;
END;
$$;

-- (1) O EMPRESTIMO POR ATLAS PASSA A RECONHECER A PRODUCAO DO DONO DO ATLAS.
--
-- Um produtor dono de um atlas anexava um recurso da propria OM, passava nos tres
-- gates do anexo (manage no atlas, ver o recurso, autoridade de repasse) e o
-- emprestimo nao resolvia para NINGUEM: ele continuava vendo pelo ramo de producao de
-- `fn_can_see_resource` e os membros do atlas nao viam nada, sem erro em lugar
-- nenhum. O braco D4 perguntava por papel global e por concessao, e nunca se o dono
-- PRODUZ o recurso.
--
-- O termo novo nao precisa de `fn_principal_vivo` ao lado: `fn_can_produce_resource`
-- ja exige conta ativa e OM de lotacao ativa. E o braco continua NAO recorrendo:
-- producao consulta `users` e as tabelas de catalogo, nunca o emprestimo, entao a
-- avaliacao termina em dois niveis, como o comentario da baseline promete.
--
-- CREATE OR REPLACE, e nao DROP + CREATE: o nome, os tipos dos argumentos e as
-- colunas de RETURNS TABLE sao identicos, que e a condicao para substituir de fato.
-- Acrescentar um parametro criaria uma SOBRECARGA, e todo chamador antigo continuaria
-- resolvendo para a definicao velha, em silencio -- e por isso
-- `resource-access-funcoes.test.js` exige UMA linha em `pg_proc` para este nome.
-- (1b) D8(b): A AUTORIDADE MORRE COM QUEM A EXERCIA -- O LADO DO PREDICADO.
--
-- Ate aqui o predicado conferia a vida do BENEFICIARIO (`fn_principal_vivo(p_user_id)`,
-- desde 2026-08-19) e nunca a de quem CONCEDEU. Desativar a conta de quem concedeu, ou
-- desativar a OM dele, deixava de pe tudo o que ele tinha distribuido: autoridade
-- sobrevivendo a quem a exercia, que e a forma que a decisao D8 do dono existe para
-- fechar.
--
-- O TERMO NOVO NAO E RECURSIVO, E ESSE E O SEU LIMITE DECLARADO. Ele mata a linha cujo
-- CONCEDENTE morreu, e so ela: um neto pendurado num filho de concedente vivo continua
-- resolvendo mesmo que o avo tenha caido. Fechar isso no predicado exigiria subir a
-- cadeia de `parent_grant_id` a cada leitura de catalogo, e o caminho de leitura e
-- quente. Quem fecha a transitividade e o outro lado do par, do lado da ESCRITA: a
-- desativacao de conta poda, na mesma transacao, tudo o que a pessoa concedeu, pela
-- MESMA cascata da revogacao (`podarPorRaizes`), com a preservacao de alcancabilidade
-- de D3 -- quem tiver outro caminho vivo e repai-ado, nao derrubado.
--
-- OS DOIS LADOS NAO SAO REDUNDANTES, E A DIVISAO DE TRABALHO E ESTA:
--   - o PREDICADO e a garantia. Ele nao depende de nenhum caminho de codigo ter
--     rodado, alcanca a desativacao de ORGANIZACAO (que nao passa por rota de usuario)
--     e e REVERSIVEL: reativar a conta ou a OM devolve o acesso, que e o que
--     `USER_REACTIVATE` promete.
--   - a PODA e a propagacao. Ela e a unica que alcanca DESCENDENTE e a unica que
--     dispara o repai.
-- Um teste distingue os dois pelo `revoked_at`: desativar a OM esconde sem revogar
-- (`revoked_at IS NULL`), desativar a CONTA revoga.
--
-- `granted_by IS NULL` CONTINUA VIVO DE PROPOSITO, e nao e descuido: concessao sem
-- concedente nao tem com quem morrer. A coluna e anulavel, o INSERT cru existe (os
-- testes de funcao escrevem direto), e a CTE de poda ja trata o mesmo caso com o mesmo
-- criterio (`g.granted_by IS NOT NULL` para poder resgatar). Fechar aqui reprovaria
-- fixture antiga sem fechar buraco nenhum de producao, porque `grantResource` sempre
-- carimba o ator.
--
-- O TERMO ENTRA NOS TRES SITIOS em que esta funcao le `resource_grants` -- o braco
-- direto, o de grupo e o `EXISTS (... og ...)` do D4 -- pelo mesmo motivo que o prazo:
-- meia morte e pior que morte nenhuma, porque o vazamento fica no braco que ninguem
-- olha. E ele NAO acrescenta ocorrencia de `expires_at > NOW()`, entao a contagem de
-- tres que `resource-grants-prazo.test.js` cobra continua valendo.
CREATE OR REPLACE FUNCTION fn_granted_resource_ids(
    p_user_id UUID, p_atlas_id UUID, p_type TEXT
) RETURNS TABLE (resource_id TEXT) LANGUAGE sql STABLE AS $$
    SELECT g.resource_id
      FROM resource_grants g
     WHERE g.revoked_at IS NULL
       AND g.expires_at > NOW()
       AND g.resource_type = p_type
       AND fn_principal_vivo(p_user_id)
       AND (g.granted_by IS NULL OR fn_principal_vivo(g.granted_by))
       AND g.grantee_id = p_user_id
    UNION
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

-- (2) O QUE ESTE ATOR PODE REPASSAR PELO EIXO DE PRODUCAO.
--
-- E o contraponto de LISTAGEM do predicado escalar `fn_can_produce_resource`, na
-- mesma relacao que `fn_granted_resource_ids` tem com o ramo de concessao: um
-- semi-join em vez de uma chamada por linha. Existe porque o cliente NAO consegue
-- derivar isto sozinho: o payload aditivo nao diz de qual OM e cada item, e nao deve
-- dizer.
--
-- DUAS DIVERGENCIAS DELIBERADAS em relacao a `fn_can_produce_resource`, e as duas
-- estao medidas em teste para nao virarem drift:
--   1. O ADMINISTRADOR recebe ZERO LINHAS. Ele concede de RAIZ sobre qualquer coisa e
--      o cliente ja sabe disso por outro caminho; devolver o catalogo inteiro aqui
--      inflaria o payload de todo administrador sem mudar uma decisao de tela. E a
--      mesma omissao que `LIST_SHAREABLE_OF_ACTOR` ja faz com o papel global.
--   2. So o PRIVADO entra. O campo `shareable` serve a afordancia do cartao, que so
--      existe para recurso privado; listar o publico seria payload sem leitor.
-- Dai o nome longo: quem procurar "o que este ator mantem" tem de cair em
-- `fn_can_produce_resource`, nao aqui.
CREATE FUNCTION fn_produced_private_resource_ids(p_user_id UUID)
RETURNS TABLE (resource_type TEXT, resource_id TEXT) LANGUAGE sql STABLE AS $$
    WITH ator AS (
        SELECT u.producer_org_id AS escopo
          FROM users u
          LEFT JOIN organizations o  ON o.id  = u.organization_id
          -- JOIN (nao LEFT) na OM PRODUTORA, e essa e a diferenca em relacao a linha
          -- de cima: a lotacao pode nao existir, a produtora tem de existir E estar
          -- ativa. O par de `fn_can_produce_resource` -- as duas respondem a mesma
          -- pergunta, uma por linha e a outra em conjunto, e divergir aqui faria o
          -- cartao oferecer "repassar" sobre o que o gate depois recusa.
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

-- ===========================================================================
-- BLOCO D7 -- O EIXO DE PAPEL DENTRO DA ORGANIZACAO SAI DO BANCO
-- ===========================================================================
--
-- `users.org_role` (owner|admin|editor|viewer) e residuo de um desenho anterior, em
-- que existia hierarquia DENTRO da OM. Ele ja nao autoriza nada no servidor: a
-- escrita do 360, que era o unico gate que o lia, passou para o escopo de PRODUCAO
-- (`users.producer_org_id`) na fase F6, pelo motivo que condena o eixo inteiro -- a
-- lotacao (`users.organization_id`) e AUTO-DECLARADA no auto-cadastro, entao um
-- cracha dentro de uma organizacao escolhida pelo proprio interessado nunca poderia
-- autorizar.
--
-- POR QUE ISTO NAO E COSMETICA. A coluna continuava viajando no token e, do outro
-- lado, a funcao unica de hidratacao de sessao do cliente inicializava o papel do
-- eixo POR ATLAS a partir dela (`role: user.org_role || 'viewer'`). Quem tivesse
-- `org_role = 'admin'` ou `'owner'` era tratado pela interface como Administrador ou
-- Dono de atlas, com permissoes plenas na tela, tendo papel global `user` e nenhuma
-- permissao em atlas nenhum. O servidor recusava, entao era afordancia que mente, e
-- nao brecha -- o custo aparecia como botao que existe e falha. Depois desta
-- migracao a hidratacao comeca em LEITOR, que e o padrao fechado.
--
-- DDL DESTRUTIVA DELIBERADA: `DROP COLUMN` casa `PADROES_DESTRUTIVOS` e paga UMA
-- linha em `EXCECOES_DESTRUTIVAS` (tests/unit/migrations-higiene.test.js), no mesmo
-- commit. O CHECK inline da coluna cai junto com ela, sem `DROP CONSTRAINT` proprio.
--
-- NADA DEPENDE DELA NO BANCO: nenhuma funcao SQL, nenhum indice e nenhuma view a
-- consultam (as tres consultas que a selecionavam eram de autenticacao, de listagem
-- de usuarios e de estado vivo, e saem no mesmo commit). Por isso o DROP e simples,
-- sem CASCADE: se algo ainda dependesse, o Postgres recusaria em vez de derrubar
-- junto, que e a falha alta que se quer aqui.
ALTER TABLE users DROP COLUMN org_role;

-- ===========================================================================
-- BLOCO D -- O EIXO DE ORGANIZACAO NA TRILHA
-- ===========================================================================
--
-- A trilha ganha `target_org_id`: a OM DONA DO RECURSO ALVO, gravada por quem emite
-- o evento. Ela nao e a OM do ator e nao e a lotacao dele; e a OM que responde pelo
-- acervo em que o ato aconteceu. E o eixo que permite `GET /api/v1/audit` deixar de
-- ser so-admin e passar a servir tambem o PRODUTOR, recortado na propria OM.
--
-- SEM FK, pela mesma razao escrita para `actor_id` em 002_auditoria.sql: a trilha
-- precisa sobreviver ao desaparecimento da OM que a originou. Com CASCADE ela se
-- apagaria justamente no caso em que mais importa; com RESTRICT o delete da OM
-- quebraria.
--
-- POR QUE DENORMALIZADA E GRAVADA NA ESCRITA, e nao resolvida por junta na leitura.
-- As duas rotas foram consideradas e a junta perde nos tres pontos:
--
--   (a) RECURSO QUE TROCA DE OM. A junta atribuiria toda a historia PASSADA a OM
--       ATUAL, isto e, mudaria retroativamente quem respondeu pelo ato: o produtor
--       da OM que mantinha o recurso na epoca perderia de vista o que ele proprio
--       fez, e o produtor da OM nova herdaria uma historia que nao e dele. Trilha
--       que muda de resposta depois do fato nao e trilha. A COLUNA DIZ A EPOCA, e e
--       essa a decisao: a linha guarda quem respondia pelo recurso QUANDO o ato
--       aconteceu, do mesmo jeito que `target_name` guarda o nome de entao.
--   (b) RECURSO QUE DEIXA DE EXISTIR. `SV360_DELETE` e HARD delete -- o unico do
--       sistema -- e a linha de trilha e escrita DEPOIS do DELETE, na mesma
--       transacao. A junta (e um gatilho, pelo mesmo motivo) devolveria NULL
--       exatamente para o evento que mais importa auditar. O emissor tem a OM em
--       maos; a leitura, depois do commit, nao tem mais de onde tira-la.
--   (c) CUSTO. A junta seria um UNION de cinco tabelas em toda listagem, com
--       `target_id` TEXT casando ora slug ora UUID; a coluna custa um indice.
--
-- NULL significa "alvo sem OM dona": USER, ATLAS, ORG, CONFIG, e tambem o acervo
-- INSTITUCIONAL (`owner_org_id` nulo). O filtro por OM nao alcanca NULL, que e o
-- comportamento certo: acervo institucional nao e de nenhuma OM em particular, e
-- entrega-lo a todo produtor pelo filtro seria dar a cada OM a historia das outras.
ALTER TABLE audit_trail ADD COLUMN target_org_id UUID;

COMMENT ON COLUMN audit_trail.target_org_id IS
  'OM dona do RECURSO ALVO na epoca do ato (nao a OM do ator, nao a lotacao). '
  'Gravada pelo emissor; NULL para alvo sem OM dona e para acervo institucional.';

-- PARCIAL: a maioria das linhas da trilha nao tem OM alvo (USER, ATLAS, LOGIN), e o
-- indice so serve a uma pergunta -- "o que aconteceu com o acervo desta OM" --,
-- sempre em ordem de tempo, que e a ordem da listagem.
CREATE INDEX idx_audit_target_org
    ON audit_trail (target_org_id, created_at DESC)
 WHERE target_org_id IS NOT NULL;

-- BACKFILL: APROXIMADO, E DITO EM VOZ ALTA.
--
-- Ele atribui a historia ANTIGA a OM ATUAL do recurso, que e justamente a
-- aproximacao que a decisao (a) acima recusa daqui para a frente. E aceito por uma
-- razao e uma so: sem ele o produtor abre a tela nova e ve lista vazia, que e
-- indistinguivel de "nada aconteceu" -- a mesma classe de defeito que o censo de
-- auditoria existe para impedir. Alcanca apenas linhas cujo alvo AINDA existe; o que
-- foi destruido antes desta migracao fica NULL para sempre, e nao ha de onde
-- recuperar. A tela declara isso ao usuario, em vez de deixar o leitor supor que
-- dado aproximado foi gravado.
--
-- O UNION precisa acompanhar o vocabulario de `target_type`: um tipo de recurso novo
-- que nasca depois daqui entra na trilha ja carimbado pelo emissor, mas a historia
-- ANTERIOR dele so entra aqui.
UPDATE audit_trail a
   SET target_org_id = f.org
  FROM (
        SELECT 'BASEMAP'::text        AS alvo, id::text AS rid, owner_org_id    AS org FROM basemaps
        UNION ALL
        SELECT 'DATA_LAYER'::text,             id::text,        owner_org_id           FROM data_layers
        UNION ALL
        SELECT 'ANALYSIS_LAYER'::text,         id::text,        owner_org_id           FROM analysis_layers
        UNION ALL
        SELECT 'TILESET'::text,                id::text,        owner_org_id           FROM tilesets
        UNION ALL
        SELECT 'SV360_PROJECT'::text,          id::text,        organization_id        FROM sv360.projects
       ) f
 WHERE a.target_type   = f.alvo
   AND a.target_id     = f.rid
   AND a.target_org_id IS NULL
   AND f.org IS NOT NULL;

-- ---------------------------------------------------------------------------
-- BLOCO D (segunda metade) -- O VIDEO DE PREVIA DO PROJETO 360
-- ---------------------------------------------------------------------------
--
-- O video de previa existia so para o 3D, e so como chave `previewVideo` dentro do
-- `config` JSONB de `tilesets`. Ele passa a valer para QUATRO tipos: tileset, camada
-- de dados, camada de analise e projeto 360. Nos tres primeiros nao ha DDL nenhuma --
-- eles guardam o valor em `config`, onde a chave passa a ser DECLARADA no schema Joi
-- (`catalog.schemas.js`), que e o que da borda a um campo que ate agora entrava livre.
--
-- O BASEMAP FICA DE FORA, e a razao e de produto, nao de schema: ele e a unica das
-- cinco familias que nao aparece como cartao de catalogo (a superficie dele e o
-- seletor de camada base, uma lista compacta sem lugar para uma afordancia de midia).
-- Campo de escrita sem superficie de leitura e afordancia que mente: o administrador
-- preencheria uma URL que nada mostra. Se o seletor ganhar cartao um dia, a chave ja
-- funciona la sem migracao nenhuma, porque `config` e livre.
--
-- `sv360.projects` NAO TEM `config` JSONB -- ela e a unica das cinco com colunas
-- nomeadas uma a uma --, entao aqui o campo e COLUNA. TEXT e nao VARCHAR(n) porque o
-- teto de 2048 e regra de BORDA (Joi), e duplica-lo aqui faria duas fontes para o
-- mesmo numero, que divergem no dia em que uma das duas mudar. NULL = sem video, que
-- e o estado de toda linha existente: nenhum backfill, nada a adivinhar.
--
-- A COLUNA GUARDA SO O ENDERECO. O video mora fora de banda (o mesmo prefixo `/3d/`
-- que serve os tilesets), e a borda recusa `data:` de proposito: um data URL de dez
-- megabytes em `config` sairia inteiro no `/api/config`, que e o documento que TODO
-- chamador anonimo recebe no boot.
ALTER TABLE sv360.projects ADD COLUMN preview_video TEXT;

COMMENT ON COLUMN sv360.projects.preview_video IS
  'URL do video de previa do projeto (fora de banda; a coluna guarda so o endereco). '
  'Espelha config.previewVideo das tabelas de catalogo. NULL = sem video.';

-- ===========================================================================
-- BLOCO E -- A PODA QUE NAO DERRUBOU: o vocabulario da trilha
-- ===========================================================================
--
-- Uma acao nova, e ela audita o que NAO aconteceu com o acesso. Ate aqui a poda so
-- tinha uma pergunta a responder ("por que Fulano perdeu acesso") e uma acao para
-- responde-la (`PERMISSION_REVOKE`, uma linha por concessao derrubada). A preservacao
-- de alcancabilidade (decisao D3 do dono: "se B nao caiu, D nao deve cair") cria a
-- pergunta simetrica: revogar A deixou de derrubar D porque o concedente de D ainda
-- tem `view_share` vivo por outro caminho, e D foi RE-PENDURADO nesse outro caminho.
-- Sem linha de trilha, um acesso que sobrevive a uma revogacao fica indistinguivel,
-- no registro, de um acesso que a revogacao nunca alcancou -- e a diferenca entre os
-- dois e exatamente o que a investigacao procura.
--
-- POR QUE NAO REUSAR PERMISSION_GRANT: nada foi concedido e ninguem decidiu nada. A
-- linha nao tem concedente no sentido de `PERMISSION_GRANT`, e reusa-la faria a
-- pergunta "quem deu acesso a Fulano" devolver um ato que nenhuma pessoa praticou.
--
-- POR QUE NAO REUSAR SHARING_CHANGE: ela ja significa "o regime de visibilidade do
-- recurso mudou" (publico/privado) e "o atlas passou a emprestar", que sao fatos sobre
-- o RECURSO. Este e um fato sobre uma ARESTA da arvore de concessao.
--
-- UMA ACAO PARA DOIS EFEITOS, discriminados por `details.kind`: 'reparent' (o no
-- trocou de pai) e 'prazo_herdado' (o no e descendente de um resgatado e teve o prazo
-- aparado pelo teto do pai novo). Os dois sao o MESMO fato do ponto de vista da
-- investigacao ("este acesso sobreviveu a poda, e nestas condicoes"), e separa-los em
-- duas acoes partiria a historia de uma poda em duas listas que nao se cruzam -- o
-- mesmo argumento que a 009 escreve para nao criar acao propria de concessao a grupo.
--
-- 'PERMISSION_REPARENT' tem 20 caracteres; a coluna e VARCHAR(50) e nao muda.
-- `target_type` NAO muda: o alvo e o RECURSO, igual ao par
-- PERMISSION_GRANT/PERMISSION_REVOKE, e todos os valores necessarios ja estao no CHECK
-- desde a 009.
--
-- DDL DESTRUTIVA DELIBERADA, A SEGUNDA DESTE ARQUIVO: Postgres nao tem
-- `ALTER CONSTRAINT` para expressao, entao alargar um CHECK e derrubar e repor. O par
-- DROP/ADD roda na mesma transacao do runner (entre os dois a tabela fica sem o CHECK,
-- e e por isso que eles nunca podem ser separados em migracoes diferentes), e o DROP
-- paga UMA linha em `EXCECOES_DESTRUTIVAS` (tests/unit/migrations-higiene.test.js), no
-- mesmo commit. Se um degrau futuro precisar alargar o MESMO CHECK, ele funde os
-- valores AQUI, num par so: dois pares DROP/ADD do mesmo constraint no mesmo arquivo
-- fariam o segundo vencer o primeiro sem erro nenhum.
ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_action_check;
ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_action_check
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
    -- grupo de acesso: o ciclo de vida e a composicao, separados de proposito
    'ACCESS_GROUP_CREATE','ACCESS_GROUP_UPDATE','ACCESS_GROUP_DELETE',
    'ACCESS_GROUP_MEMBER_ADD','ACCESS_GROUP_MEMBER_REMOVE',
    -- a poda que NAO derrubou: o acesso mudou de origem em vez de cair
    'PERMISSION_REPARENT'
  ));
