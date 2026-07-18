# Rotação, Reuso e Revogação de Refresh Tokens

Refresh tokens são de uso único e rotacionados a cada renovação; reapresentar um token já revogado é lido como roubo e revoga toda a família do usuário, junto com as revogações em massa por troca/reset de senha e desativação.

## Modelo

Dois tokens, papéis distintos (ver [[autenticacao-jwt]] e [[jwt-emissor-unico]]):

- **Access token**: JWT HS256, stateless, TTL default `15m` (`config.js:42`). Não é consultado no banco, então **não existe revogação de access token**.
- **Refresh token**: opaco, com estado no Postgres. Gerado como `crypto.randomUUID() + '-' + 32 bytes hex` (`auth.service.js:57-61`), ou seja, entropia muito acima do necessário para dispensar salt.

O banco guarda apenas o **SHA-256 do token** (`auth.service.js:59`, `auth.queries.js:29-33`). Um dump da tabela `refresh_tokens` não devolve tokens usáveis. A tabela tem `token_hash VARCHAR(255) NOT NULL UNIQUE`, `expires_at`, `revoked_at` (`001_core.sql:125-132`); revogação é um carimbo `revoked_at = NOW()`, nunca um `DELETE`.

TTL do refresh: `7d` por default (`JWT_REFRESH_EXPIRY`, `config.js:43`), materializado como `expires_at` na inserção (`auth.service.js:104-105`).

## Rotação: cada refresh queima o token apresentado

`POST /api/v1/auth/refresh` (`auth.routes.js:21` → `auth.controller.js:11-15` → `auth.service.js:127-178`) faz, nesta ordem:

1. Hash do token recebido e busca **incluindo revogados** via `FIND_REFRESH_TOKEN_ANY` (`auth.queries.js:42-46`). Esse "incluindo revogados" é o ponto inteiro do desenho: sem ele não há como distinguir "nunca existiu" de "já foi usado".
2. Se não achou: `401`.
3. Se achou **com `revoked_at`**: detecção de reuso (abaixo).
4. Se `expires_at` no passado: `401`, e o token **não** é revogado nem a família é atingida.
5. `REVOKE_REFRESH_TOKEN` no token apresentado (`auth.service.js:154`).
6. Recarrega o usuário, cria novo access + novo refresh, insere o novo hash (`auth.service.js:170-175`).

Consequência prática: **o cliente é obrigado a substituir o refresh armazenado pelo retornado**. Guardar o antigo não é só inútil, é ativamente perigoso, porque reapresentá-lo derruba a sessão inteira.

**Armadilha de operação:** os passos 5 e 6 são duas `query` soltas, fora de transação (`auth.service.js:154` e `175`). Uma falha entre elas deixa o usuário sem refresh válido. É fail-safe (força login novo), não fail-open, mas explica sessões que morrem "sem motivo" depois de um blip no banco.

**Gate de organização no refresh:** se a OM do usuário estiver inativa, o refresh lança `ForbiddenError` (`403`), não `401` (`auth.service.js:165-167`). O cliente que trata apenas `401` como "sessão perdida" vai tratar isso como erro genérico. Ver [[organizacoes-om]].

## Detecção de reuso: revoga a família

Token com `revoked_at` reapresentado = a cadeia de rotação vazou. O backend loga `Refresh token reuse detected` e roda `REVOKE_ALL_USER_TOKENS` (`auth.service.js:142-146`), que marca `revoked_at = NOW()` em **todos** os refresh tokens ainda vivos daquele `user_id` (`auth.queries.js:52-54`). Todos os dispositivos caem no próximo refresh.

A resposta ao atacante é a mesma de "token nunca existiu", de propósito: nenhum sinal de que a detecção disparou.

Isso significa que **refresh concorrente é indistinguível de roubo**. Dois requests com o mesmo refresh token: o primeiro rotaciona, o segundo cai na detecção e mata a sessão de todo mundo. Duas defesas existem no cliente:

- `apiClient.refresh()` compartilha um único refresh em voo (`api-client.js:289-312`), então rajadas de `401` na mesma aba coalescem.
- O tab lock (`index.js:126`, `utilities/tab-lock.js`) evita duas abas do app rodando em paralelo. Sem ele, duas abas leem o mesmo token de `localStorage` e produzem exatamente o cenário de reuso.

**Retenção é parte do mecanismo de segurança.** Não existe job de purga: nenhum `DELETE FROM refresh_tokens` no backend. Se alguém "otimizar" limpando linhas revogadas/expiradas, a detecção de reuso degrada silenciosamente para "token nunca existiu" (ainda `401`, mas sem revogar a família). Se a tabela crescer demais, purgue por `expires_at` bem antigo, nunca por `revoked_at`.

**Nota de índice:** `idx_refresh_tokens_hash` é parcial (`WHERE revoked_at IS NULL`, `001_core.sql:135`) e portanto **não serve** a query de detecção de reuso, que precisa ver revogados. O lookup continua indexado pelo índice único implícito de `token_hash UNIQUE`. Não remova o `UNIQUE` achando que o índice parcial cobre.

## Revogação em massa: as quatro portas

`REVOKE_ALL_USER_TOKENS` é chamado em exatamente quatro lugares:

| Evento | Onde |
|---|---|
| Reuso de refresh detectado | `auth.service.js:144` |
| Usuário troca a própria senha (`PUT /users/me/password`) | `users.service.js:67` |
| Admin reseta a senha (`POST /users/:userId/reset-password`) | `users.service.js:197` |
| Usuário desativado (`DELETE /users/:userId`) | `users.service.js:239`, dentro da transação de soft-delete + transferência de atlas + auditoria |

Só a desativação é transacional com o resto da operação; os dois casos de senha revogam em uma query separada logo após o `UPDATE`. Ver [[gestao-usuarios]] e [[auditoria]].

**O que a revogação em massa NÃO faz:** não invalida access tokens já emitidos. Um access token roubado continua válido até `exp` (até 15 min), e o socket de colaboração já aberto continua aberto, porque o token vai na query string apenas no handshake (`api-client.js:935-939`) e não é revalidado depois. Ver [[canal-collab-websocket]] e [[canal-collab-websocket]]. Se o requisito for corte imediato, ele não existe hoje; encurtar `JWT_ACCESS_EXPIRY` é o único ajuste disponível.

Logout é revogação **de um token só** (`auth.service.js:183-186`): as outras sessões do usuário continuam vivas. A rota exige access token válido (`auth` middleware, `auth.routes.js:22`) e devolve `204`. Ver [[sessao-boot-e-ciclo-de-vida]].

## Rate limit no /auth/refresh (armadilha real)

`/auth/refresh` usa o mesmo `authLimiter` do login (`auth.routes.js:21`), cuja chave é `${req.ip}:${(req.body?.username || '').toLowerCase()}` (`middleware/rate-limit.js:32`). O corpo do refresh **não tem username** (`auth.schemas.js:9-11`), então a chave degrada para `"<ip>:"`: **todos os usuários atrás do mesmo IP compartilham um único balde de 10 tentativas por 15 minutos**.

Numa OM atrás de NAT único, ou com o backend atrás de proxy sem `trust proxy` correto, isso vira `429` em massa no refresh. Trate `429` como backoff, nunca como logout (ver [[hardening-borda-api]] e [[erros-api]]).

## Lado cliente (ebgeo_web)

- Access **e** refresh são persistidos juntos em `localStorage` sob uma única chave (`api-client.js:143-157`), e recarregados no boot por `loadStoredTokens()` (`api-client.js:164-176`). O caminho de "viewer link" público usa `setEphemeralToken()`, que fica só em memória e não persiste (`api-client.js:117-120`).
- Qualquer request autenticado que tome `401` dispara **um** refresh transparente e um único retry (`api-client.js:229-234`); `_retry: false` no próprio `/auth/refresh` corta a recursão.
- Falha terminal do refresh: limpa tokens, dispara `authLost` uma única vez (`api-client.js:301-310`), rearmado no próximo `setTokens` (`api-client.js:107`). O handler é ligado **depois** do boot (`index.js:132-134`), para que expiração detectada no boot caia em anônimo silenciosamente em vez de abrir modal. Ver [[modos-operacao]] e [[auth-flexivel]].

Checklist para não errar:

1. Salve sempre o `refreshToken` da resposta, substituindo o anterior.
2. Serialize o refresh (uma fila única por origem de token). Concorrência aqui não é lentidão, é logout global.
3. `429` != `401`: não dispare refresh nem logout.
4. Depois de trocar a senha, espere `401` nas outras sessões e trate como "faça login de novo".
5. Não reutilize o fluxo de refresh para integrações máquina-a-máquina; para isso existem [[api-keys]].

## Divergências entre a documentação e o código

> [!CONTRADICAO 2026-07-18] guia *11-seguranca-hardening* (absorvido) §2, §3.2 e `§10` documentam mensagens em inglês (`Invalid credentials`, `Invalid refresh token`, `Refresh token expired`, `Account is deactivated`); o código emite pt-BR: `Usuário ou senha inválidos` (`auth.service.js:78`), `Conta desativada` (`auth.service.js:82`), `Sessão inválida. Entre novamente.` para token inexistente e para reuso (`auth.service.js:135` e `145`) e `Sessão expirada. Entre novamente.` para expirado (`auth.service.js:150`). Os `code` e status HTTP da tabela continuam corretos; não faça matching por `message`.

> [!CONTRADICAO 2026-07-18] guia *01-autenticacao* (absorvido) §3 prescreve access token em "memória ou sessionStorage" e só o refresh em `localStorage`; `src/js/store/sync/api-client.js:143-157` persiste **os dois** no mesmo item de `localStorage`. É uma escolha deliberada (o boot valida a sessão via `getMe`), mas amplia a superfície de XSS: quem consegue script na página leva o access token pronto.

O guia 11 §3.3 lista corretamente as quatro portas de revogação em massa, e §3.2 descreve corretamente a semântica de família. Nenhum dos dois documenta o gate de organização inativa no refresh (`403`, `auth.service.js:165-167`) nem o balde de rate limit compartilhado por IP descrito acima.

## Fontes

- guia *11-seguranca-hardening* (absorvido): §3 (rotação, detecção de reuso, revogação em massa), §1 (rate limit em `/auth/refresh`), §4 (allowlist HS256), §10 (tabela de status de erro).
- guia *01-autenticacao* (absorvido): contrato dos endpoints `/auth/login`, `/auth/refresh`, `/auth/logout`, formato da resposta e recomendação de armazenamento de tokens.
- `ebgeo_backend/src/modules/auth/auth.service.js`, `auth.queries.js`, `auth.routes.js`, `auth.schemas.js`, `auth.controller.js`: implementação real da rotação, detecção de reuso e revogação.
- `ebgeo_backend/src/modules/users/users.service.js`, `src/middleware/rate-limit.js`, `src/config.js`, `src/database/migrations/001_core.sql`: revogações em massa, chave do limitador, TTLs e esquema da tabela.
- `ebgeo_web/src/js/store/sync/api-client.js` e `src/js/index.js`: persistência de tokens, refresh coalescido, retry em 401 e handler de sessão perdida.
