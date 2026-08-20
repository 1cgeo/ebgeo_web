-- Path: src/database/migrations/009_grupos_de_acesso.sql
-- O VOCABULARIO DE AUDITORIA DO GRUPO DE ACESSO.
--
-- A PRIMEIRA MIGRACAO FORWARD-ONLY depois da consolidacao de 2026-08-19. As oito
-- baselines foram escritas no estado FINAL do schema, e a decisao que as autorizou
-- diz, por extenso, que forward-only volta a valer a partir DESTE arquivo. Por isso
-- ele NAO edita a 002: um banco que ja rodou a 002 nunca a roda de novo, entao
-- alargar um CHECK ali seria uma mudanca que so alcanca banco virgem.
--
-- POR QUE ELE E CURTO. As duas tabelas do grupo (`access_groups`,
-- `access_group_members`), o `resource_grants.grantee_group_id` com o seu CHECK de
-- alvo unico, o indice do braco de grupo e `fn_user_group_ids` JA NASCERAM na
-- 008_acesso_a_recurso.sql. O que faltava era do lado de fora do banco: nenhuma
-- linha de JavaScript tocava nada disso, entao a coluna so se preenchia por SQL
-- direto. Este arquivo entrega a unica peca de SCHEMA que o produto ainda exigia --
-- o vocabulario da trilha -- e o resto da entrega e codigo.
--
-- A ARMADILHA QUE ELE EVITA POR NOME: `target_type` ja tem o valor 'GROUP', e ele
-- NAO serve aqui. Aquele valor foi declarado para os grupos de FEICAO de um mapa
-- (`public.groups`), esta sem emissor nenhum desde a 001 e e um dos buracos
-- conhecidos do censo de auditoria. Reusa-lo faria a trilha do grupo de acesso e a
-- trilha (futura) do grupo de feicao caiem no MESMO balde de `idx_audit_target`, e
-- a pergunta "o que ja foi feito com este grupo" passaria a ter duas respostas
-- misturadas. O valor novo e 'ACCESS_GROUP', que qualifica, exatamente como a
-- tabela se chama `access_groups` e nao `groups`.

-- ---------------------------------------------------------------------------
-- 1. As cinco acoes
-- ---------------------------------------------------------------------------
--
-- CINCO E NAO TRES: o ciclo de vida do grupo (criar, renomear, apagar) e a
-- composicao dele (entrar, sair) sao perguntas diferentes na investigacao. "Quem
-- criou este grupo" e uma pergunta de governanca; "desde quando o Fulano estava
-- nele" e a pergunta que responde por que ele viu um recurso, e ela precisa de uma
-- linha por movimento de membro. Uma acao unica de UPDATE para os dois casos
-- obrigaria a investigacao a abrir `details` de toda linha para descobrir qual das
-- duas perguntas aquela linha responde.
--
-- NAO EXISTE ACAO DE CONCESSAO NOVA, e a ausencia e deliberada: conceder a um
-- grupo continua emitindo `PERMISSION_GRANT`, com o recurso como alvo, porque o
-- fato auditado e o mesmo (o acesso a ESTA coisa mudou) e separar por tipo de
-- beneficiario partiria a historia de um acesso em duas listas que nao se cruzam.
-- Quem recebeu desce para `details`, como ja descia para a pessoa.
--
-- O valor mais longo passa a ser `ACCESS_GROUP_MEMBER_REMOVE` (26 caracteres); a
-- coluna e VARCHAR(50), entao ela nao muda.
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
    'ACCESS_GROUP_MEMBER_ADD','ACCESS_GROUP_MEMBER_REMOVE'
  ));

-- ---------------------------------------------------------------------------
-- 2. O alvo
-- ---------------------------------------------------------------------------
--
-- 'ACCESS_GROUP' tem 12 caracteres e o mais longo do conjunto continua sendo
-- 'STREETVIEW_MARKER' (17); a coluna e VARCHAR(20) e nao muda.
--
-- O alvo de uma acao de MEMBRO e o GRUPO, nunca o usuario, e a escolha e a mesma
-- que `PERMISSION_GRANT` ja faz com o recurso: investiga-se pela coisa cujo acesso
-- mudou. O usuario movido desce para `details` com o nome junto, para que a linha
-- continue legivel sem um JOIN.
ALTER TABLE audit_trail DROP CONSTRAINT audit_trail_target_type_check;
ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_target_type_check
  CHECK (target_type IN (
    'USER','GROUP','MODEL','SYSTEM','ATLAS','ORG',
    'BASEMAP','DATA_LAYER','ANALYSIS_LAYER','TILESET','STREETVIEW_MARKER',
    'SV360_PROJECT','CONFIG',
    'ACCESS_GROUP'
  ));

-- ---------------------------------------------------------------------------
-- 3. O indice que a tela de grupo percorre
-- ---------------------------------------------------------------------------
--
-- "Quais grupos existem" e a consulta da aba de administracao, e ela filtra por
-- vivo e ordena por nome. `uq_access_groups_nome_vivo` ja indexa `LOWER(name)`
-- entre os vivos e serve a ordenacao, entao o que falta e o outro lado: "quem esta
-- neste grupo", percorrido a cada abertura da lista de membros e a cada concessao.
-- `idx_access_group_members_user` (008) responde a pergunta inversa (de que grupos
-- esta pessoa participa) e nao serve a esta, porque `group_id` e a PRIMEIRA coluna
-- da PK e ja e prefixo indexado -- ou seja, este indice seria redundante e NAO e
-- criado. A secao existe para dizer isso: a ausencia e medida, nao esquecimento.
