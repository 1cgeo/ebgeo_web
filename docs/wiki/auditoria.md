# Trilha de Auditoria de Negócio

Evento de domínio persistido em `audit_trail` que pode participar da transação da mutação auditada, com um CHECK de 15 ações das quais só 6 são realmente emitidas.

## Auditoria é transacional, e isso inverte a intuição de log

O terceiro argumento `t` de `createAudit` (`backend/src/utils/audit.js:13`) faz o INSERT entrar na transação de negócio: se a mutação reverte, o evento reverte junto. Num log operacional isso seria perda de informação; aqui é a garantia desejada, não existe janela em que o banco diga "fulano deletou o usuário" e o usuário continue vivo. Os dois lados estão pinados em `backend/tests/integration/audit-coverage.test.js:63` (rollback) e `:106` (commit).

**Esquecer o `t` é a armadilha principal.** Sem ele o helper cai num `dbQuery` autônomo (`utils/audit.js:26-30`): compila, o teste feliz passa, e só um rollback revela o registro órfão. O código convida ao erro porque o argumento é opcional e a chamada sem ele é indistinguível à leitura.

**`actorId` não tem fallback.** A coluna é `NOT NULL` e o helper repassa o valor cru, então `req.user?.id` indefinido em rota anônima vira violação de NOT NULL, ou seja, 500 na mutação inteira, não só na auditoria. Toda rota que audita precisa estar atrás de autenticação (ver [[auth-flexivel]] e [[autenticacao-jwt]]).

`req` pode ser sintético: `ip` cai para a string `'system'` quando falsy e `user_agent` só é lido se `req.get` existir (`utils/audit.js:14-15`), então `{ ip }` basta para jobs e seeds.

## Por que `actor_id` não tem FK

Decisão deliberada em `backend/src/database/migrations/001_core.sql:166-178`. As duas alternativas foram rejeitadas pelo mesmo motivo: com `ON DELETE CASCADE` a trilha se apagaria exatamente no caso em que mais importa; com `RESTRICT` o delete de usuário quebraria. Consequência para quem lê a trilha: `actor_id` pode apontar para usuário inexistente, então a UI precisa tolerar join vazio.

É para isso que `target_name` existe: **snapshot do nome no momento do evento, não referência viva**. Renomear a OM depois não reescreve a trilha, e isso é intencional.

## O CHECK não é cobertura

Existem exatamente seis chamadas a `createAudit` no repositório, contra 15 ações permitidas pelo CHECK (`backend/src/database/migrations/001_core.sql:172-177`). O que isso significa na prática:

- **`LOGIN`/`LOGOUT` não existem na trilha.** Auditoria de sessão não está implementada; quem precisa disso hoje só tem o log operacional.
- **`ATLAS_DELETE` e `SHARING_CHANGE` nunca são emitidas**, apesar de [[atlas-modelo-de-dados]] e [[compartilhamento-atlas]] serem mutações sensíveis.
- **`PERMISSION_REVOKE` nunca é emitida.** `setZonePermissions` é replace-set e grava `PERMISSION_GRANT` sempre, inclusive com array vazio, que na prática é revogação total (`backend/src/modules/zones/zones.service.js:74-90`). Para detectar revogação é preciso comparar `details.before` com `details.after`, nunca a `action`. Ver [[zonas-acesso-geografico]].
- `target_type` `GROUP`, `MODEL` e `SYSTEM` estão no CHECK sem nenhum call site.

O custo do CHECK fechado: ação nova exige migração de schema, não só código. Em troca, typo em `action` falha na hora em vez de virar lixo silencioso.

### Armadilha: auditoria de organização não é atômica

As três ações de OM auditam **depois** do serviço retornar, no controller e fora de qualquer transação (`backend/src/modules/organizations/organizations.controller.js:16`, `:24`, `:32`), ao contrário de `USER_DELETE`, `API_KEY_ROTATE` e `PERMISSION_GRANT`, que passam `t`. Se o INSERT de auditoria falhar, a OM já foi criada, alterada ou desativada e o cliente ainda recebe 500: estado divergente entre operação e trilha.

Não contradiz o guia (que só afirma atomicidade para a rotação de API key), mas é inconsistência real entre módulos. Ao auditar algo novo em [[organizacoes-om]], mova a chamada para dentro do `tx` do service, como faz [[gestao-usuarios]].

## Leitura: armadilhas de integração de `GET /api/v1/audit`

O gate é o `role` **global** do JWT, não o `org_role` nem permissão por atlas: um `owner` de OM que não seja admin global não lê a trilha (ver [[sintese-eixos-de-permissao]] e [[permissoes-atlas]]). Ausência de credencial dá 401, não 403 (`backend/src/middleware/require-admin.js:10-16`); erro de Joi dá 422 (ver [[erros-api]] e [[sintese-contrato-erros-http]]).

Quatro pegadinhas para quem for construir a tela:

- **Envelope duplamente aninhado.** O controller faz `res.json({ data: result })` sobre um `result` que já é `{ total, page, limit, data }` (`backend/src/modules/audit/audit.controller.js:6-7`, `backend/src/modules/audit/audit.service.js:12`). Os eventos ficam em `response.data.data`. É o erro de integração mais provável nesta rota.
- **Paginação 1-based** (`backend/src/modules/audit/audit.service.js:6`). Tabela de UI 0-based precisa somar 1.
- **Filtros são igualdade exata**, via `($1::text IS NULL OR action = $1)` (`backend/src/modules/audit/audit.queries.js:13-15`). Não há busca parcial nem case-insensitive: `action=org_create` não retorna nada, e `action=all` filtra por uma ação literal chamada `all` devolvendo lista vazia sem erro. Para "todos", **omita o param**. Params desconhecidos são descartados em silêncio pelo `stripUnknown` (`backend/src/middleware/validate.js:3-6`), então um filtro com nome errado parece funcionar e traz tudo.
- **Linhas saem em snake_case**, sem camelização, ao contrário de outras superfícies do cliente (ver [[api-rest-atlas]]).

Não há filtro por intervalo de datas nem por `targetId`, apesar do índice `(target_type, target_id)` existir. `total` e as linhas vêm de duas queries em `Promise.all` sem transação (`backend/src/modules/audit/audit.service.js:8-11`): sob escrita concorrente podem discordar por uma linha, irrelevante para tela de admin, relevante se alguém usar isso para reconciliação exata.

## Estado no frontend

O cliente web **não consome a rota**: não há referência a `/api/v1/audit` em `ebgeo_web/src/`. A tela de auditoria do painel de admin ainda é checklist, não código.

Auditoria é REST puro e admin-only: não gera nem consome operações de colaboração, então nada disso passa por [[modelo-conflito-lww]] ou [[envelope-operacao]]. Para o que o admin faz sobre o sync em si, ver [[sync-admin-operacoes]] e [[hardening-borda-api]].

## Fontes

- guia *12-multiorg-identidade-auditoria* (absorvido): Parte 5.
- `ebgeo_backend/src/database/migrations/001_core.sql:165-192`, `backend/src/utils/audit.js`, `src/modules/audit/*`, os 6 call sites em `modules/{organizations,users,zones}`, `src/middleware/{require-admin,validate,error-handler}.js`, `backend/tests/integration/audit-coverage.test.js`.
