-- Path: src/database/migrations/019_defeito_estado_auditado.sql
-- ============================================================================
-- 019: o CICLO DE VIDA do defeito vira ato de administrador, e ato deixa trilha
-- ============================================================================
-- Até 018 a coluna `defeitos.estado` existia com quatro valores e UMA transição, a
-- automática (`resolvido` -> `regrediu`, no CASE de `UPSERT_DEFEITO`). As outras três
-- (resolver, ignorar, reabrir) eram atos de administrador sem porta: a rota de escrita não
-- existia, e o `diag.routes.js` dizia isso por extenso. Elas chegam agora, por
-- `PATCH /api/v1/diag/defeitos/:id` e pelos três comandos do `npm run diag`.
--
-- POR QUE UMA MIGRAÇÃO SÓ PARA ISTO. Nenhuma coluna nasce aqui: as quatro `resolvido_*` já
-- existem desde 018. O que falta é uma AÇÃO no vocabulário de `audit_trail.action`, e sem
-- ela o INSERT da trilha morreria com 23514 dentro da transação do próprio ato, ou seja, a
-- rota nova falharia por um motivo que não tem relação aparente com o assunto dela.
--
-- ─── POR QUE ISTO É AUDITADO, quando o RELATO de erro é isento ───
--
-- `POST /diag/erro-cliente` é isento no censo (`tests/unit/auditoria-censo.test.js`) e esta
-- rota não é, e a diferença não é de tabela, é de NATUREZA. Lá, quem escreve é um visitante
-- anônimo relatando o que o navegador dele viu, em altíssima frequência, e a própria linha de
-- `defeitos` já guarda quem, quando e quantas vezes; auditar seria uma linha de trilha por
-- erro de tela, exatamente a rajada que a agregação por assinatura existe para conter.
-- Aqui, quem escreve é um ADMINISTRADOR afirmando um juízo sobre o produto ("isto foi
-- corrigido", "isto não será corrigido"), e esse juízo apaga um alerta para todo mundo que
-- olhar a tela depois. Um ato raro, humano e com efeito sobre a leitura alheia é a definição
-- do que a trilha existe para guardar.
--
-- ─── O QUE ELA CARREGA, e por que o alvo é `SYSTEM` ───
--
-- `target_type = 'SYSTEM'` porque um defeito NÃO é recurso de acesso: ele não pertence a
-- nenhuma OM, não é concedível, não tem dono. 'SYSTEM' significa sistema, e o cabeçalho de
-- `002_auditoria.sql` avisa em voz alta que ele já foi depósito do alvo que não coube (não é
-- o caso aqui), e é por isso que `target_id` vai preenchido com o id do defeito, que é o que
-- faz `idx_audit_target` responder "tudo que já foi feito com este defeito".
-- `target_org_id` fica NULO pela mesma razão: alvo sem OM dona.
--
-- ─── DDL DESTRUTIVA, DECLARADA ───
--
-- Alargar um CHECK exige derrubá-lo e recriá-lo: o Postgres não tem `ALTER CONSTRAINT` para
-- expressão. Isso conta como destrutivo mesmo sendo compatível para trás (todo valor aceito
-- antes continua aceito), e a linha correspondente está em `EXCECOES_DESTRUTIVAS`
-- (`tests/unit/migrations-higiene.test.js`), no mesmo commit. O `IF EXISTS` é o que mantém a
-- migração idempotente numa segunda aplicação; o par inteiro roda dentro da transação do
-- migrador (`migrate.js` aplica cada arquivo por `t.none`), então não existe janela em que a
-- tabela fique sem a regra.
--
-- A LISTA É REESCRITA INTEIRA, e não há como não ser: o CHECK é uma expressão, não um
-- conjunto ao qual se acrescenta. Quem acrescentar a próxima ação copia a lista VIGENTE
-- (que é esta, e não a de 002) e junta a dela. Quem cobra que a leitura pegue a declaração
-- MAIS RECENTE, e não a primeira encontrada, é `tests/unit/auditoria-censo.test.js`, que
-- varre as migrações em ordem numérica DECRESCENTE.
-- ============================================================================

ALTER TABLE audit_trail DROP CONSTRAINT IF EXISTS audit_trail_action_check;

ALTER TABLE audit_trail ADD CONSTRAINT audit_trail_action_check CHECK (action IN (
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
  'PERMISSION_REPARENT',
  'RANK_CREATE','RANK_UPDATE','RANK_DELETE',
  'API_KEY_CREATE','API_KEY_REVOKE',
  -- O ato de administrador sobre o ciclo de vida de um defeito: resolver, ignorar ou
  -- reabrir. UMA ação para as três transições, com o de/para em `details`, e não três
  -- ações: a pergunta que a trilha responde é "o que já foi feito com este defeito", e
  -- partir a história dele em três listas que não se cruzam é o que o cabeçalho de
  -- `002_auditoria.sql` recusa por extenso para as chaves de API. O valor tem 14 caracteres;
  -- a coluna é VARCHAR(50), e o mais longo continua sendo `ACCESS_GROUP_MEMBER_REMOVE` (26).
  'DEFEITO_ESTADO'
));
