# Trilha de Auditoria de Negócio

Evento de domínio persistido em `audit_trail` que pode participar da transação da mutação auditada, com um CHECK fechado de ações do qual três continuam sem emissor.

## Auditoria é transacional, e isso inverte a intuição de log

O terceiro argumento `t` de `createAudit` (`backend/src/utils/audit.js`) faz o INSERT entrar na transação de negócio: se a mutação reverte, o evento reverte junto. Num log operacional isso seria perda de informação; aqui é a garantia desejada, não existe janela em que o banco diga "fulano deletou o usuário" e o usuário continue vivo. Os dois lados estão pinados em `backend/tests/integration/audit-coverage.test.js`, nos casos `audit-cov-01` (rollback) e `audit-cov-02` (commit).

**Esquecer o `t` é a armadilha principal.** Sem ele o helper cai num `dbQuery` autônomo: compila, o teste feliz passa, e só um rollback revela o registro órfão. O código convida ao erro porque o argumento é opcional e a chamada sem ele é indistinguível à leitura.

**`actorId` não tem fallback.** A coluna é `NOT NULL` e o helper repassa o valor cru, então `req.user?.id` indefinido em rota anônima vira violação de NOT NULL, ou seja, 500 na mutação inteira, não só na auditoria. Toda rota que audita precisa estar atrás de autenticação (ver [[auth-flexivel]] e [[autenticacao-jwt]]).

`req` pode ser sintético: `ip` cai para a string `'system'` quando falsy e `user_agent` só é lido se `req.get` existir, então `{ ip }` basta para jobs e seeds.

## Por que `actor_id` não tem FK

Decisão deliberada, comentada na DDL de `audit_trail` (`backend/src/database/migrations/001_core.sql`). As duas alternativas foram rejeitadas pelo mesmo motivo: com `ON DELETE CASCADE` a trilha se apagaria exatamente no caso em que mais importa; com `RESTRICT` o delete de usuário quebraria. Consequência para quem lê a trilha: `actor_id` pode apontar para usuário inexistente, então a UI precisa tolerar join vazio.

É para isso que `target_name` existe: **snapshot do nome no momento do evento, não referência viva**. Renomear a OM depois não reescreve a trilha, e isso é intencional.

## O CHECK não é cobertura

A lista de ações permitidas é fechada por CHECK (`backend/src/database/migrations/001_core.sql`, ampliada por `007_audit_zone_actions.sql`), e a cobertura andou muito: onde havia seis chamadas a `createAudit` no repositório, hoje há dezoito, espalhadas por `users`, `zones`, `sharing` e `organizations`. **Três ações continuam sem emissor nenhum**, e é essa a lista que importa:

- **`LOGIN`/`LOGOUT` não existem na trilha.** Auditoria de sessão não está implementada; quem precisa disso hoje só tem o log operacional.
- **`ATLAS_DELETE` nunca é emitida**, apesar de ser mutação sensível ([[atlas-modelo-de-dados]]). `SHARING_CHANGE` e `PERMISSION_REVOKE`, que esta seção listava junto, passaram a ser emitidas por `backend/src/modules/sharing/sharing.service.js`.
- `target_type` `GROUP`, `MODEL` e `SYSTEM` continuam no CHECK sem nenhum call site.

**Filtro que por construção nunca casa se lê como "nada aconteceu", não como "nunca foi ligado"**, e essa é a razão de esta seção existir. Foi assim que `USER_CREATE` passou meses no CHECK sem emissor, e é o mesmo risco de qualquer ação da lista acima.

**A revogação de zona é a exceção que continua muda por `action`.** `setZonePermissions` é replace-set e grava sempre `PERMISSION_GRANT`, inclusive com array vazio, que na prática é revogação total. Para detectar revogação nesse caminho é preciso comparar `details.before` com `details.after`, nunca a `action`. Já o `DELETE` da zona inteira, que revoga tudo por CASCADE, tem hoje o seu próprio `ZONE_DELETE`. Ver [[zonas-acesso-geografico]].

O custo do CHECK fechado: ação nova exige migração de schema, não só código, e foi exatamente o que as três ações de zona custaram. Em troca, typo em `action` falha na hora em vez de virar lixo silencioso.

### Armadilha: auditoria de organização não é atômica

As três ações de OM auditam **depois** do serviço retornar, no controller e fora de qualquer transação (`backend/src/modules/organizations/organizations.controller.js`), ao contrário de todo o ciclo de vida de usuário, das três ações de zona e da rotação de API key, que passam `t`. Se o INSERT de auditoria falhar, a OM já foi criada, alterada ou desativada e o cliente ainda recebe 500: estado divergente entre operação e trilha.

`organizations` é hoje o **único** módulo assim, o que torna a inconsistência mais cara do que era quando havia vários: o padrão do repositório é auditar dentro do `tx` do service, e um leitor que copie o controller de OM copia a exceção achando que copia a regra. Ao auditar algo novo em [[organizacoes-om]], mova a chamada para dentro do service, como fazem [[gestao-usuarios]] e [[zonas-acesso-geografico]].

## Leitura: armadilhas de integração de `GET /api/v1/audit`

O gate é o `role` **global**, não o `org_role` nem permissão por atlas: um `owner` de OM que não seja admin global não lê a trilha (ver [[sintese-eixos-de-permissao]] e [[permissoes-atlas]]). E é o papel **vivo**, não a claim, porque `auth` sobrescreve `req.user.role` antes de `requireAdmin` rodar. Ausência de credencial dá 401, não 403 (`requireAdmin`, `backend/src/middleware/require-admin.js`); erro de Joi dá 422 (ver [[erros-api]] e [[sintese-contrato-erros-http]]).

Quatro pegadinhas para quem for construir a tela:

- **Envelope duplamente aninhado.** O controller faz `res.json({ data: result })` sobre um `result` que já é `{ total, page, limit, data }` (`backend/src/modules/audit/audit.controller.js`, `backend/src/modules/audit/audit.service.js`). Os eventos ficam em `response.data.data`. É o erro de integração mais provável nesta rota.
- **Paginação 1-based** (`backend/src/modules/audit/audit.service.js`). Tabela de UI 0-based precisa somar 1.
- **Filtros são igualdade exata**, via `($1::text IS NULL OR action = $1)` (`backend/src/modules/audit/audit.queries.js`). Não há busca parcial nem case-insensitive: `action=org_create` não retorna nada, e `action=all` filtra por uma ação literal chamada `all` devolvendo lista vazia sem erro. Para "todos", **omita o param**. Params desconhecidos são descartados em silêncio pelo `stripUnknown` (`backend/src/middleware/validate.js`), então um filtro com nome errado parece funcionar e traz tudo.
- **Linhas saem em snake_case**, sem camelização, ao contrário de outras superfícies do cliente (ver [[api-rest-atlas]]).

Não há filtro por intervalo de datas nem por `targetId`, apesar do índice `(target_type, target_id)` existir. `total` e as linhas vêm de duas queries em `Promise.all` sem transação (`backend/src/modules/audit/audit.service.js`): sob escrita concorrente podem discordar por uma linha, irrelevante para tela de admin, relevante se alguém usar isso para reconciliação exata.

## Estado no frontend

O cliente web **não consome a rota**: não há referência a `/api/v1/audit` em `frontend/src/`. A tela de auditoria do painel de admin ainda é checklist, não código.

Auditoria é REST puro e admin-only: não gera nem consome operações de colaboração, então nada disso passa por [[modelo-conflito-lww]] ou [[envelope-operacao]]. Para o que o admin faz sobre o sync em si, ver [[sync-admin-operacoes]] e [[hardening-borda-api]].

## Histórico

- **2026-07-25.** A seção "O CHECK não é cobertura" descrevia seis chamadas contra 15 ações e nomeava `SHARING_CHANGE` e `PERMISSION_REVOKE` como nunca emitidas. Superado: são dezoito call sites, o CHECK ganhou as três ações de zona por migração, e só `LOGIN`, `LOGOUT` e `ATLAS_DELETE` seguem sem emissor.
