# Autenticação Flexível (flexibleAuth)

Middleware global e não-bloqueante que popula `req.user` a partir de `x-api-key`, cookie `token` ou `Authorization: Bearer` nessa ordem de precedência, deixando a requisição seguir anônima quando nenhuma credencial é válida e renovando o cookie por sliding session.

## O que ele é (e o que não é)

`flexibleAuth` (`ebgeo_backend/src/middleware/flexible-auth.js:42`) é montado uma única vez, globalmente, em `src/app.js:70`, depois de `cookieParser()` (`src/app.js:50`) e dos parsers de JSON, antes de todas as rotas. Ele **identifica**, não **autoriza**: qualquer falha (formato inválido, JWT expirado, assinatura errada, erro de banco) resulta em `next()` sem `req.user`, nunca em resposta de erro. O `catch` final (`flexible-auth.js:105-107`) existe exatamente para garantir isso: um Postgres fora do ar não pode derrubar as rotas anônimas (`/api/config`, catálogo público, [[gazetteer-nomes-geograficos]], [[streetview-360]]).

Quem barra é a rota, via middleware estrito `auth` / `requireAdmin` (`src/middleware/auth.js:55`), que retorna `401`/`403` conforme [[sintese-contrato-erros-http]] e [[erros-api]]. Ver [[autenticacao-jwt]] para o token em si e [[sintese-eixos-de-permissao]] para a separação papel global x papel de organização x permissão de atlas.

## Ordem de precedência (e o short-circuit que morde)

```
1. x-api-key (header) OU ?api_key=   → req.authVia = 'api_key'
2. cookie `token`                    → req.authVia = 'jwt'
3. Authorization: Bearer <token>     → req.authVia = 'jwt'
```

Armadilhas reais, todas visíveis no código:

- **A presença de `x-api-key` encerra a decisão, mesmo falhando.** `flexible-auth.js:45-54`: se a chave existe mas não é UUID, ou é UUID mas não bate com nenhum usuário ativo, o middleware faz `return next()` **sem** olhar cookie ou Bearer. Um cliente que manda API key errada + Bearer válido é tratado como anônimo. Não é bug, é precedência estrita; mas quebra quem espera fallback.
- **Chave em formato inválido não toca o banco** (`flexible-auth.js:46`, guarda `UUID_RE`). Isso é anti-DoS de borda, ver [[hardening-borda-api]].
- **Cookie ganha do Bearer** (`flexible-auth.js:56`, `req.cookies?.token || extractBearerToken(req)`). Num browser com cookie velho e SPA mandando Bearer novo, o cookie vence, silenciosamente.
- **`extractBearerToken` é case-sensitive:** só aceita o prefixo exato `Bearer ` (`auth.js:15-21`); `bearer x` vira anônimo (coberto por teste em `tests/unit/middleware-auth.test.js:55`).
- **`?api_key=` é transporte suportado**, e por isso é redigido nos logs junto com `token`/`access_token`/`refresh_token` (`src/utils/redact-url.js:6`).

## Forma do `req.user`

Duas fontes, mesmo formato de saída, origens diferentes:

- **API key:** vem do banco (`mapDbUser`, `flexible-auth.js:18`), via `FIND_USER_BY_API_KEY` (`src/modules/users/users.queries.js:199-206`), cujo `WHERE` já exige `u.api_key = $1 AND u.is_active = true`. Chave de usuário desativado simplesmente não autentica. Ver [[api-keys]] e [[gestao-usuarios]].
- **JWT:** vem dos claims (`mapPayload`, `flexible-auth.js:30`), com o mesmo fallback legado do middleware estrito: `organization_id ?? null` e `org_role || 'viewer'` (`flexible-auth.js:37-38`). Tokens emitidos antes dos claims de organização degradam para viewer/sem-org em vez de explodir. Ver [[organizacoes-om]] e [[jwt-emissor-unico]].

`req.authVia` (`'api_key'` | `'jwt'` | ausente) fica disponível para trilhas de [[auditoria]].

## Sliding session, e por que ela consulta o banco

Quando faltam menos de 5 minutos (`SLIDING_THRESHOLD_MS`, `flexible-auth.js:15`) para o `exp` do JWT, o middleware reemite o access token e reescreve o cookie (`flexible-auth.js:102`) com `env.cookieOptions()` (`httpOnly`, `secure` conforme HTTPS, `sameSite` strict em produção, `maxAge` derivado de `JWT_ACCESS_EXPIRY`, `src/utils/environment.js:21-34`). O frontend não faz nada, o `Set-Cookie` chega na resposta.

O ponto não óbvio: **a renovação consulta o estado vivo antes de assinar** (`getLiveAuthState`, `src/utils/org-status.js:53`). O comentário em `flexible-auth.js:70-76` documenta o incidente que motivou isso: reassinar os claims antigos transformava a janela de "no máximo 15 min desatualizado" em "para sempre", porque um usuário desativado que mantivesse uma requisição a cada 15 minutos renovava a sessão indefinidamente, e um admin rebaixado carregava `role: admin` adiante.

Regras da renovação, exatamente como o código faz:

- Usuário desativado **ou** organização desativada: o cookie é derrubado com `res.clearCookie` (com as mesmas opções **menos** `maxAge`, que o Express deprecia no clear, `flexible-auth.js:87-89`), `req.user` e `req.authVia` voltam a `undefined`, a requisição segue anônima e as rotas estritas dão 401.
- Linha de usuário ausente **não** é revogação: usuários são só soft-deleted, então `live === null` deixa a sessão deslizar (`flexible-auth.js:82`, mesma regra do `auth.js:86-90`). Organização desconhecida é tratada como ativa (`org-status.js:19`).
- Só o **`role` global** é adotado do banco (`flexible-auth.js:100`). `org_role`/`organization_id` continuam vindo do token, deliberadamente, para preservar o degrade de tokens legados.
- Principals de link público (`sub` no formato `public-<uuid>`, não-UUID) **nunca** deslizam: a guarda `UUID_RE.test(payload.sub)` em `flexible-auth.js:77` os exclui. O token deles é escopado ao atlas e curto por design. Ver [[link-publico]] e [[permissoes-atlas]].

> **Nota histórica.** guia *12-multiorg-identidade-auditoria* (absorvido) (Parte 3) diz que a sliding session ocorre "quando o JWT **do cookie**" está perto de expirar; o código em `flexible-auth.js:56` resolve `token = cookie || Bearer` e a renovação em `flexible-auth.js:77-103` roda igualmente para o token vindo do header `Authorization`, gravando um `Set-Cookie` numa chamada que não usava cookie nenhum. O guia também não menciona a revalidação viva contra o banco nem o `clearCookie` de sessão morta.

## Relação com o middleware estrito `auth`

`auth` (`src/middleware/auth.js:55-118`) reaproveita o que o `flexibleAuth` já resolveu: `if (!req.user)` ele tenta o Bearer por conta própria (`auth.js:58-64`), e só então roda a reconciliação viva (`getLiveAuthState`) que aplica `401 Account is inactive` / `403 Organization is inactive` e adota o `role` global atual. Consequência prática: **quem entra por API key também passa pela reconciliação viva** ao atingir uma rota estrita, porque o `id` é UUID. E principals públicos são isentos (`auth.js:80-82`).

Portanto: o caminho anônimo/público nunca paga a query extra; o caminho estrito paga exatamente uma query joined por requisição. Isso substitui o antigo lookup só-de-organização sem custo adicional (`org-status.js:29-30`).

## Integração

- SPA: continue usando `Authorization: Bearer <accessToken>` e o fluxo de [[refresh-token-rotacao]]; é o caminho recomendado e o que [[sessao-boot-e-ciclo-de-vida]] descreve.
- Cookie `token`: útil para server-rendered e multi-aba; exige CORS com `credentials: true`, já configurado em `src/app.js:49`.
- `x-api-key`: máquina-a-máquina (scripts, serviços). Não use no browser: sem `httpOnly`, sem expiração, e a rotação invalida a chave anterior na mesma transação, sem janela de convivência (ver [[api-keys]]).
- O canal WebSocket **não** passa por `flexibleAuth`: o token vai na query da conexão e é validado no gateway (ver [[canal-collab-websocket]] e [[canal-collab-websocket]]).

## Fontes

- guia *12-multiorg-identidade-auditoria* (absorvido): Parte 3 (ordem de precedência, semântica não-bloqueante, sliding session de 5 min, notas de integração frontend/M2M) e Parte 4 (API key única por usuário, exigência de `is_active`).
- `ebgeo_backend/src/middleware/flexible-auth.js`: implementação real, short-circuit da API key, guarda UUID, revalidação viva antes da renovação, `clearCookie` de sessão morta, isenção de principals públicos.
- `ebgeo_backend/src/middleware/auth.js`: middleware estrito, `extractBearerToken`, reconciliação `getLiveAuthState`, isenção `public-<uuid>`.
- `ebgeo_backend/src/utils/org-status.js`: `getLiveAuthState` / `orgIsActive` e as regras de linha ausente.
- `ebgeo_backend/src/app.js`: ordem de montagem (cookieParser, CORS com credentials, parsers, flexibleAuth global).
- `ebgeo_backend/src/utils/environment.js`, `src/modules/auth/auth.service.js`, `src/modules/users/users.queries.js`, `src/utils/redact-url.js`, `tests/unit/middleware-auth.test.js`: opções de cookie, `issueAccessToken`/`msUntilExpiry`, query da API key, redação de `?api_key=`, casos de borda testados.
