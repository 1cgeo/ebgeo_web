-- 020_auditoria_alvo_e_acoes.sql
--
-- A trilha de auditoria deixa de ser estreita demais para o que o sistema faz:
-- catorze ações novas, sete tipos de alvo novos, e `target_id` de UUID para TEXT.
--
-- O PROBLEMA QUE ESTA MIGRAÇÃO RESOLVE NÃO É "faltam ações". É que o SCHEMA
-- ESTAVA EMPURRANDO O ALVO PARA DENTRO DE `details`. `setResourceVisibility`
-- registra hoje `target_type = 'SYSTEM'` e `target_id = NULL`, com o tipo e o id
-- do recurso viajando num JSONB, e o comentário no serviço diz por escrito que a
-- única razão são as duas restrições que caem aqui: o CHECK de `target_type` não
-- tinha os tipos de recurso, e `target_id` era UUID enquanto o id de catálogo é
-- slug. A consequência é que `idx_audit_target` não responde "tudo que já foi
-- feito com este recurso", e que 'SYSTEM' virou depósito de alvo que não coube.
-- Depois desta migração 'SYSTEM' volta a significar sistema.
--
-- O id de catálogo ser slug já cobrou o preço uma vez: gravar um slug numa coluna
-- UUID levanta 22P02, que a borda traduz em 400, numa rota que aparentemente não
-- tinha nada de errado.
--
-- ISTO É DDL DESTRUTIVA por TRÊS definições de `tests/unit/migrations-higiene.test.js`
-- ao mesmo tempo (dois `DROP CONSTRAINT` e um `ALTER COLUMN ... TYPE`), e cada uma
-- exige linha própria em EXCECOES_DESTRUTIVAS naquele arquivo, NO MESMO COMMIT.
-- Esquecer deixa a suíte vermelha com uma mensagem sobre "DDL destrutiva não
-- documentada", que não parece ter relação nenhuma com auditoria.
--
-- Alargar um CHECK é compatível para trás: todo valor aceito antes continua
-- aceito, então nenhuma linha e nenhum escritor existente é afetado. É o mesmo
-- alargamento de 007, e não uma redefinição. O constraint precisa cair e voltar
-- porque Postgres não tem ALTER CONSTRAINT para expressão de CHECK.

-- ---------------------------------------------------------------------------
-- 1. As ações
-- ---------------------------------------------------------------------------
--
-- Dezoito antigas mais catorze. As novas fecham buracos de duas naturezas
-- diferentes, e vale distinguir porque a segunda é a que envergonha:
--
-- (a) ESCRITAS QUE NUNCA DEIXARAM RASTRO. CRUD de catálogo inteiro (que sob o
--     escopo de produção deixa de ser só-admin e passa a ter N autores),
--     `config_settings` (o documento único de boot, cujo override muda o app para
--     todo mundo), ingestão e exclusão de projeto 360, criação de atlas, purga de
--     concessões, mudança de escopo de produção.
--
-- (b) AÇÕES JÁ DECLARADAS NO CHECK QUE NUNCA TIVERAM EMISSOR. `LOGIN`, `LOGOUT` e
--     `ATLAS_DELETE` estão na 001 desde o primeiro dia e a contagem de emissores em
--     `src/` é zero para as três. Uma ação declarada sem emissor é um verde que não
--     verifica nada: quem filtrar a trilha por `ATLAS_DELETE` recebe lista vazia e
--     conclui que ninguém apagou atlas. Elas não precisam de linha aqui (já estão
--     no CHECK), precisam de emissor — e o teste-censo de auditoria é quem passa a
--     cobrar isso, com piso decrescente.
--
-- POR QUE `PRODUCER_SCOPE_CHANGE` É AÇÃO PRÓPRIA E NÃO UM DETALHE DE `ROLE_CHANGE`:
-- o bicondicional de 018 permite transferir um produtor de OM SEM mudar o papel,
-- e nesse evento não há `ROLE_CHANGE` nenhum para carregar o detalhe. Um campo
-- dentro de outra ação deixaria o evento mais importante do eixo de produção sem
-- nada para filtrar.
--
-- POR QUE `CONFIG_CLEAR` É SEPARADA DE `CONFIG_UPDATE`: uma edita chaves, a outra
-- é a válvula que apaga TODOS os overrides de uma vez. Distinguir mantém a trilha
-- filtrável, que é o propósito inteiro da coluna (o mesmo argumento da 007).
--
-- POR QUE CALIBRAÇÃO DE FOTO 360 FICA DE FORA, e é decisão e não esquecimento: é
-- evento de altíssima frequência, a foto já carrega `updated_at`, e uma linha de
-- auditoria por ajuste afogaria a trilha no ruído que menos importa. A auditoria
-- de 360 é no nível do PROJETO (`SV360_INGEST`, `SV360_DELETE`,
-- `SV360_STATUS_CHANGE`), que é onde as decisões de acesso acontecem.
--
-- `LOGIN_FAILED` também fica de fora, e por impossibilidade estrutural, não por
-- escolha: `audit_trail.actor_id` é NOT NULL e um login que falhou não tem ator
-- identificado. Login falho continua só no log operacional.
--
-- O valor mais longo é `PRODUCER_SCOPE_CHANGE` (21 caracteres); a coluna é
-- VARCHAR(50), então não há tipo a mexer.
ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_action_check;

ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_action_check
  CHECK (action IN (
    -- 001 + 007, todas mantidas
    'LOGIN','LOGOUT','USER_CREATE','USER_UPDATE','USER_DELETE',
    'PASSWORD_RESET','API_KEY_ROTATE','ROLE_CHANGE',
    'ORG_CREATE','ORG_UPDATE','ORG_DELETE',
    'ATLAS_DELETE','SHARING_CHANGE','PERMISSION_GRANT','PERMISSION_REVOKE',
    'ZONE_CREATE','ZONE_UPDATE','ZONE_DELETE',
    -- ciclo de vida do atlas: `ATLAS_DELETE` existia sozinho, sem o ato que cria
    -- nem os dois que mudam o dono e desfazem a exclusão. Meia história.
    'ATLAS_CREATE','ATLAS_RESTORE','ATLAS_TRANSFER',
    -- catálogo: sob o escopo de produção o autor deixa de ser sempre o admin
    'CATALOG_CREATE','CATALOG_UPDATE','CATALOG_DELETE',
    -- config_settings: override do documento de boot, e a válvula que o zera
    'CONFIG_UPDATE','CONFIG_CLEAR',
    -- escopo de produção (018), que muda sem o papel mudar
    'PRODUCER_SCOPE_CHANGE',
    -- 360 no nível do projeto (ingestão, hard-delete, eixo de ocultação)
    'SV360_INGEST','SV360_DELETE','SV360_STATUS_CHANGE',
    -- hard-delete de concessões arrastado pelo sumiço do recurso. Fica na família
    -- PERMISSION_* de propósito: quem filtra a família acha a purga junto com a
    -- concessão e a revogação, que é o que se quer ao investigar um acesso.
    'PERMISSION_PURGE',
    -- simetria com USER_DELETE, que já auditava sozinho
    'USER_REACTIVATE'
  ));

-- ---------------------------------------------------------------------------
-- 2. O alvo volta a ser coluna de primeira classe
-- ---------------------------------------------------------------------------
--
-- A ORDEM DAS TRÊS LINHAS ABAIXO IMPORTA: o CHECK de `target_type` cai primeiro
-- para que o `ALTER COLUMN` de `target_id` não conviva com um constraint que está
-- prestes a ser substituído, e o CHECK novo entra por último, já sobre a coluna
-- no tipo final.
--
-- O nome `audit_trail_target_type_check` é o que o Postgres GERA para o CHECK
-- inline e sem nome da 001 (`<tabela>_<coluna>_check`). Um DROP com nome errado
-- falha alto, e falhar alto é o comportamento bom aqui.
ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_target_type_check;

-- UUID -> TEXT, e é a mudança que desfaz o desvio descrito no cabeçalho. TEXT
-- porque o id de recurso é heterogêneo por construção: slug VARCHAR nas cinco
-- tabelas de catálogo, UUID em `sv360.projects`, e a chave textual
-- `app_config` em `config_settings`. A alternativa (uma coluna por formato)
-- multiplicaria a pergunta "o que aconteceu com este alvo?" por três.
--
-- Alargar UUID para TEXT preserva toda linha existente (`::text` de um UUID é a
-- forma canônica com hífens, que é como o leitor já compara) e não invalida
-- consulta nenhuma: `audit.queries.js` filtra por `action` e `target_type`, nunca
-- por `target_id`, e não há join sobre ele. É o mesmo alargamento de 006
-- (`catalog_layers.id` UUID -> TEXT), pelo mesmo motivo: o id do domínio nunca
-- foi UUID.
--
-- `idx_audit_target` é RECONSTRUÍDO pelo próprio ALTER; não o recrie à mão.
ALTER TABLE audit_trail ALTER COLUMN target_id TYPE TEXT USING target_id::text;

-- Sete tipos novos. As CINCO tabelas de catálogo entram todas, e não só as três
-- que têm tipo de concessão: o CRUD auditado é das cinco, e `basemaps` e
-- `streetview_markers` não aparecem em `resource_grants.resource_type` de
-- propósito (são dois vocabulários, ver 019). Conflatá-los deixaria duas rotas
-- auditáveis sem alvo declarável.
--
-- `CONFIG` é o alvo de CONFIG_UPDATE/CONFIG_CLEAR, e é o segundo sítio que só
-- existe porque `target_id` virou TEXT: o alvo é a chave `app_config`, que nunca
-- foi UUID.
--
-- `MODEL` e `GROUP` continuam declarados e continuam sem nenhum emissor, herdados
-- da 001. Removê-los seria DDL destrutiva sem ganho, e o teste-censo de auditoria
-- é quem passa a registrá-los como buraco conhecido, com motivo escrito, em vez
-- de deixá-los passar despercebidos numa lista.
--
-- O valor mais longo é `STREETVIEW_MARKER` (17 caracteres); a coluna é VARCHAR(20),
-- então o tipo não precisa mudar — o que economiza uma quarta linha de DDL
-- destrutiva.
ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_target_type_check
  CHECK (target_type IN (
    'USER','GROUP','MODEL','ZONE','SYSTEM','ATLAS','ORG',
    'BASEMAP','DATA_LAYER','ANALYSIS_LAYER','TILESET','STREETVIEW_MARKER',
    'SV360_PROJECT','CONFIG'
  ));
