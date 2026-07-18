# Trilha de Auditoria de Negócio

Tabela de eventos de domínio (`action`, `actor_id` sem FK, `target_type`/`target_id`/`target_name`, `details`, `ip`) consultável por admin em `GET /api/v1/audit`, participando da mesma transação da operação auditada e com lista fechada de ações cujo subconjunto realmente gravado é menor que o CHECK.

## O que a auditoria é (e o que não é)

Auditoria aqui é **evento de domínio persistido no banco**, não logging operacional (pino/arquivo). A diferença prática: o registro de auditoria pode ser inserido **dentro da transação de negócio**, então se a mutação reverte, o evento reverte junto. Não existe janela em que o banco diga "fulano deletou o usuário" e o usuário continue vivo.

Isso é o oposto do que se espera de um log: um log escrito e depois revertido é considerado perda de informação; aqui a reversão é a garantia desejada. O par de testes `audit-cov-01` (rollback) e `audit-cov-02` (commit) em `tests/integration/audit-coverage.test.js:63` e `:106` pina os dois lados.

## Schema da tabela

`audit_trail`, definida em `src/database/migrations/001_core.sql:169`:

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `action` | VARCHAR(50) NOT NULL | CHECK com lista fechada (abaixo) |
| `actor_id` | UUID NOT NULL | **sem FK** para `users` |
| `target_type` | VARCHAR(20) | CHECK: `USER`, `GROUP`, `MODEL`, `ZONE`, `SYSTEM`, `ATLAS`, `ORG` |
| `target_id` | UUID | opcional |
| `target_name` | VARCHAR(255) | snapshot do nome no momento do evento |
| `details` | JSONB | contexto livre, índice GIN |
| `ip` | VARCHAR(45) NOT NULL | |
| `user_agent` | TEXT | |
| `created_at` | TIMESTAMPTZ NOT NULL | default `NOW()` |

Duas decisões estruturais que respondem a "por quê":

- **`actor_id` sem FK** (`001_core.sql:166-178`): o registro precisa sobreviver ao delete do usuário. Com FK e `ON DELETE CASCADE` a trilha se apagaria exatamente no caso em que mais importa; com FK e `RESTRICT` o delete de usuário quebraria. Consequência para quem lê a trilha: `actor_id` pode apontar para um usuário que não existe mais, então a UI precisa tolerar join vazio (é para isso que existe `target_name`, um snapshot, e não um join vivo).
- **`target_name` é snapshot, não referência**: renomear a OM depois não reescreve a trilha. Isso é intencional, a trilha registra o estado no momento do evento.

Índices: `actor_id`, `(target_type, target_id)`, `action`, `created_at DESC`, `(created_at DESC, action)` e GIN em `details` (`001_core.sql:187-192`). O índice composto `created_at DESC, action` existe porque a query de listagem sempre ordena por `created_at DESC` e o filtro mais comum é `action`.

## Escrita: `createAudit`

Helper único em `src/utils/audit.js:13`:

```js
createAudit(req, { action, actorId, targetType?, targetId?, targetName?, details? }, t?)
```

- O **terceiro argumento `t`** é o que torna a auditoria transacional: com `t`, usa `t.none(INSERT_AUDIT, args)`; sem `t`, cai em `dbQuery` autônomo (`utils/audit.js:26-30`). **Esquecer o `t` é a armadilha principal**: o código compila, o teste feliz passa, e só um rollback revela o registro órfão.
- `req` pode ser parcial. `ip` cai para a string literal `'system'` quando `req?.ip` é falsy (`utils/audit.js:14`), porque a coluna é `NOT NULL`. `user_agent` só é lido se `req.get` existir (`:15`), então um `{ ip }` sintético é aceito para chamadas fora de request (jobs, seeds).
- `details` é serializado com `JSON.stringify` e passado como `$6::jsonb` (`audit.queries.js:6`); ausente vira `null`, não `{}`.
- **`actorId` não tem fallback.** A coluna é `NOT NULL` e o helper repassa o valor cru. Em rota anônima, `req.user?.id` indefinido vira violação de NOT NULL, ou seja, erro 500 na mutação inteira. Toda rota que audita precisa estar atrás de autenticação (ver [[auth-flexivel]] e [[autenticacao-jwt]]).

## Ações no CHECK vs. ações realmente emitidas

O CHECK aceita 15 ações (`001_core.sql:172-177`): `LOGIN`, `LOGOUT`, `USER_CREATE`, `USER_UPDATE`, `USER_DELETE`, `PASSWORD_RESET`, `API_KEY_ROTATE`, `ROLE_CHANGE`, `ORG_CREATE`, `ORG_UPDATE`, `ORG_DELETE`, `ATLAS_DELETE`, `SHARING_CHANGE`, `PERMISSION_GRANT`, `PERMISSION_REVOKE`.

**Só 6 são emitidas.** Existem exatamente seis chamadas a `createAudit` fora do helper:

| Ação | Onde | Transacional? |
|---|---|---|
| `ORG_CREATE` | `src/modules/organizations/organizations.controller.js:16` | **não** |
| `ORG_UPDATE` | `organizations.controller.js:24` | **não** |
| `ORG_DELETE` | `organizations.controller.js:32` | **não** |
| `USER_DELETE` | `src/modules/users/users.service.js:242` | sim (`t`) |
| `API_KEY_ROTATE` | `users.service.js:261` | sim (`t`) |
| `PERMISSION_GRANT` | `src/modules/zones/zones.service.js:85` | sim (`t`) |

Implicações concretas, não conte com o CHECK como se fosse cobertura:

- **`LOGIN`/`LOGOUT` não existem na trilha.** Auditoria de sessão não está implementada. Quem precisa disso hoje só tem o log operacional.
- **`ATLAS_DELETE` e `SHARING_CHANGE` não são emitidas**, apesar de [[atlas-modelo-de-dados]] e [[compartilhamento-atlas]] serem mutações sensíveis.
- **`PERMISSION_REVOKE` nunca é emitida.** `setZonePermissions` é replace-set e grava `PERMISSION_GRANT` sempre, inclusive quando o array chega vazio, o que na prática é uma revogação total (`zones.service.js:74-90`). Para saber se houve revogação é preciso comparar `details.before` com `details.after`, não olhar a `action`. Ver [[zonas-acesso-geografico]].
- `target_type` `GROUP`, `MODEL` e `SYSTEM` estão no CHECK mas nenhum call site os usa.

A CHECK fechada tem um custo operacional: adicionar uma ação nova exige migração de schema, não só código. Em compensação, um typo em `action` falha na hora com violação de CHECK em vez de virar lixo silencioso na trilha.

### Armadilha: as auditorias de organização não são atômicas

As três ações de OM auditam **depois** do serviço retornar, fora de qualquer transação (`organizations.controller.js:15-19`, `:23-27`, `:31-34`). Duas consequências:

1. Se o INSERT de auditoria falhar, a OM **já foi criada/alterada/desativada** e o cliente recebe 500. Estado divergente entre operação e trilha.
2. Não há rollback conjunto, ao contrário de `USER_DELETE`, `API_KEY_ROTATE` e `PERMISSION_GRANT`.

Isso não é uma contradição com o guia (ele diz "pode participar da mesma transação", e afirma atomicidade só para a rotação de API key), mas é uma inconsistência real entre módulos. Ao auditar algo novo em [[organizacoes-om]], prefira mover a chamada para dentro do `tx` do service, como faz [[gestao-usuarios]].

## Leitura: `GET /api/v1/audit`

Montada em `src/app.js:110`. Cadeia de middlewares em `src/modules/audit/audit.routes.js:11`: `auth` → `requireAdmin` → `validate({ query })` → controller.

- **Sem credencial: 401**, não 403. `requireAdmin` distingue explicitamente ausência de credencial (autenticação) de papel insuficiente (`src/middleware/require-admin.js:10-16`).
- **Autenticado sem `role === 'admin'`: 403.** O gate é o `role` **global** do JWT, não o `org_role` nem a permissão por atlas. Um `owner` de OM que não seja admin global não lê a trilha. Ver [[sintese-eixos-de-permissao]] e [[permissoes-atlas]].

Query params validados por Joi (`audit.schemas.js:4-10`), com `stripUnknown: true` no `validate` (`src/middleware/validate.js:3-6`), ou seja, params desconhecidos são silenciosamente descartados, não rejeitados:

| Param | Regra | Default |
|---|---|---|
| `action` | string, máx. 50 | — |
| `actorId` | UUID | — |
| `targetType` | string, máx. 20 | — |
| `page` | inteiro ≥ 1 | `1` |
| `limit` | inteiro 1–200 | `50` |

Erro de Joi vira **422 `VALIDATION_ERROR`** (`src/middleware/error-handler.js:28-31`), coerente com [[erros-api]] e [[sintese-contrato-erros-http]].

### Filtros são igualdade exata e opcionais via SQL

`LIST_AUDIT` usa o padrão `($1::text IS NULL OR action = $1)` (`audit.queries.js:13-15`), com o service passando `?? null` para cada filtro (`audit.service.js:7`). Consequências:

- **Não há busca parcial nem case-insensitive.** `action=org_create` não retorna nada; tem que ser `ORG_CREATE`.
- **Para "todos", omita o param.** Enviar `action=all` filtra por uma ação literal chamada `all` e devolve lista vazia, não erro.
- Não há filtro por intervalo de datas nem por `targetId`, apesar de existir índice `(target_type, target_id)`.

Paginação: `offset = (page - 1) * limit` (`audit.service.js:6`), **1-based**. Tabelas de UI que paginam 0-based precisam somar 1. Ordenação fixa `created_at DESC` (`audit.queries.js:16`).

`total` e as linhas vêm de duas queries em `Promise.all` (`audit.service.js:8-11`), sem transação. Sob escrita concorrente, `total` e a página podem discordar por uma linha. Irrelevante para uma tela de admin, relevante se alguém tentar usar isso para reconciliação exata.

### Envelope duplamente aninhado

O controller faz `res.json({ data: result })` onde `result` já é `{ total, page, limit, data }` (`audit.controller.js:6-7`, `audit.service.js:12`). O resultado:

```json
{ "data": { "total": 12, "page": 1, "limit": 50, "data": [ /* eventos */ ] } }
```

O array de eventos está em **`response.data.data`**; a paginação em `response.data`. É o erro de integração mais provável nesta rota.

As linhas saem em **snake_case** (`action`, `actor_id`, `target_type`, ...), sem camelização, ao contrário do que o cliente faz em outras superfícies (ver [[api-rest-atlas]]).

## Estado no frontend

O cliente web **não consome `/api/v1/audit`**: não há nenhuma referência a essa rota em `ebgeo_web/src/`. A tela de auditoria do painel de administrador ainda é item de checklist, não código. Quem for construí-la precisa tratar os três pontos acima (envelope aninhado, paginação 1-based, omitir filtros vazios) e tolerar `actor_id` sem usuário correspondente.

Nada disso passa pelo pipeline de operações de [[modelo-conflito-lww]] ou pelo [[envelope-operacao]]: auditoria é REST puro, admin-only, e não gera nem consome operações de colaboração. Para o que o admin pode fazer sobre o sync em si, ver [[sync-admin-operacoes]] e [[hardening-borda-api]].

## Fontes

- guia *12-multiorg-identidade-auditoria* (absorvido): Parte 5 (shape do evento, lista de ações do CHECK, subconjunto realmente gravado, contrato de `GET /api/v1/audit`, envelope aninhado, paginação 1-based, tabela consolidada de erros).
- `ebgeo_backend/src/database/migrations/001_core.sql:165-192`: DDL de `audit_trail`, CHECKs de `action` e `target_type`, ausência de FK em `actor_id`, índices.
- `ebgeo_backend/src/utils/audit.js`: assinatura de `createAudit`, argumento `t` opcional, fallback `ip = 'system'`, serialização de `details`.
- `ebgeo_backend/src/modules/audit/{routes,controller,service,queries,schemas}.js`: cadeia `auth`/`requireAdmin`/`validate`, SQL de filtros opcionais, offset 1-based, envelope duplo.
- `ebgeo_backend/src/modules/{organizations/organizations.controller.js,users/users.service.js,zones/zones.service.js}`: os 6 call sites reais, quais são transacionais e quais não.
- `ebgeo_backend/src/middleware/{require-admin.js,validate.js,error-handler.js}`: 401 vs 403, `stripUnknown`, mapeamento Joi para 422.
- `ebgeo_backend/tests/integration/audit-coverage.test.js`: testes de atomicidade em commit e rollback, captura de ip/user-agent reais, 401 anônimo.
- `ebgeo_web/src/`: ausência de qualquer consumo de `/api/v1/audit`.
