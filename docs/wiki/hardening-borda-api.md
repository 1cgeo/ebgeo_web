# Hardening de Borda da API

Conjunto de endurecimentos visíveis ao cliente: rate limiting por IP+username nas rotas de credencial, login timing-safe com mensagem genérica, allowlist HS256, cabeçalhos helmet/CSP/HSTS, health check de readiness e boot fail-fast de variáveis de ambiente.

Nada aqui muda contratos de dados nem quebra o caminho anônimo. O que muda é a borda: status codes novos (`429`, `503`), mensagens deliberadamente pobres em informação, e um backend que se recusa a subir mal configurado. Detalhes de upload ficam em [[upload-imagens-seguranca]]; rotação de refresh em [[refresh-token-rotacao]]; o contrato de envelope de erro em [[erros-api]] e [[sintese-contrato-erros-http]].

## 1. Rate limiting

Dois limitadores, ambos em `src/middleware/rate-limit.js`, ambos respondendo `429` com o envelope padrão (`code: TOO_MANY_REQUESTS`, mensagem `Muitas tentativas. Tente novamente mais tarde.`, `rate-limit.js:5-12`).

| Limitador | Chave | Janela | Máx | Rotas |
|---|---|---|---|---|
| `authLimiter` | `${req.ip}:${username.toLowerCase()}` (`rate-limit.js:32`) | 15 min (`RATE_LIMIT_AUTH_WINDOW_MS`) | 10 (`RATE_LIMIT_AUTH_MAX`) | `/auth/{register,verify-email,resend-verification,login,refresh}` |
| `publicLinkLimiter` | `req.ip` | 1 min (`RATE_LIMIT_PUBLIC_WINDOW_MS`) | 30 (`RATE_LIMIT_PUBLIC_MAX`) | `GET /atlas/public/:link` |

Defaults em `config.js:92-99`; montagem em `src/modules/auth/auth.routes.js:15-21` e `src/modules/atlas/atlas.routes.js:23`. O limitador emite headers `RateLimit-*` padrão (`standardHeaders: true`), então dá para montar countdown com `RateLimit-Reset`.

**Por que a chave composta:** força-bruta contra uma conta é estrangulada sem que um IP barulhento (NAT de quartel, saída única da rede) trave o login de todo mundo. É uma escolha deliberada de disponibilidade sobre rigor.

### Armadilhas

- **`req.ip` sem `trust proxy`.** Não existe `app.set('trust proxy', ...)` em lugar nenhum de `src/`. Atrás de nginx/proxy reverso, `req.ip` é o IP do proxy, e a chave composta degenera: todos os usuários caem no mesmo balde por username. Antes de colocar em produção com proxy, isso precisa ser configurado, ou o limitador vira um DoS acidental contra os próprios usuários.
- **Rotas sem `username` no body compartilham balde.** `/auth/refresh` (body só tem `refreshToken`, `auth.schemas.js:9-11`), `/auth/verify-email` e `/auth/resend-verification` produzem a chave `"<ip>:"`. As três rotas somadas têm 10 requisições por 15 minutos por IP. Com [[refresh-token-rotacao]] e várias abas abertas, isso é atingível. Reforça a regra de serializar refresh numa fila única (ver `store/sync/api-client.js` no frontend).
- **O limitador roda antes do `validate()`** (a ordem nas rotas é `authLimiter, validate(...), ctrl`): body malformado também consome quota.
- **`validate: false`** desliga os avisos internos do `express-rate-limit` (inclusive o aviso de trust-proxy mal configurado). Não conte com ele para detectar a armadilha acima.
- **Pulado em teste.** `skip = () => config.isTest && process.env.RATE_LIMIT_FORCE !== '1'` (`rate-limit.js:18`). O store em memória acumularia ao longo da suíte inteira. Um teste que queira exercitar o limitador precisa setar `RATE_LIMIT_FORCE=1` e usar chave isolada.
- No cliente, `429` **não** é `401`: não dispare logout nem refresh, só backoff.

> **Nota histórica.** guia *11-seguranca-hardening* (absorvido) §1.1 lista o limitador estrito apenas em `/auth/{login,refresh,register}`; o código em `src/modules/auth/auth.routes.js:18-19` também o aplica a `/auth/verify-email` e `/auth/resend-verification`.

## 2. Login timing-safe e mensagem genérica

`src/modules/auth/auth.service.js:19` computa um `DUMMY_HASH` bcrypt uma vez no load. No login, `hashToCompare = user ? user.password_hash : DUMMY_HASH` e o `bcrypt.compare` **sempre roda** (`auth.service.js:70-72`). Sem isso, "usuário inexistente" responderia em microssegundos e "senha errada" em ~100 ms com 12 rounds de salt, entregando um oráculo de enumeração.

Usuário inexistente e senha errada lançam o mesmo `UnauthorizedError` com o mesmo texto (`auth.service.js:74-77`). Não tente distinguir os dois na UI, o backend não fornece esse sinal de propósito.

Os demais desfechos do login **são** distinguíveis, e cada um merece tratamento próprio na interface:

| Situação | Status / code | Onde |
|---|---|---|
| Usuário inexistente ou senha errada | `401 UNAUTHORIZED` | `auth.service.js:74-77` |
| Conta desativada (`is_active = false`) | `401 UNAUTHORIZED` | `auth.service.js:79-81` |
| E-mail não confirmado | `401 EMAIL_NOT_VERIFIED` | `auth.service.js:85-87` |
| Organização inativa | `403 FORBIDDEN` | `auth.service.js:90-92` |

O caso `EMAIL_NOT_VERIFIED` tem `code` próprio justamente para a UI oferecer "reenviar confirmação"; ver [[gestao-usuarios]] e [[organizacoes-om]] para o gate de organização inativa.

> **Nota histórica.** guia *11-seguranca-hardening* (absorvido) §2 e §3.2 documentam as mensagens em inglês (`Invalid credentials`, `Account is deactivated`, `Invalid refresh token`); o código emite português: `Usuário ou senha inválidos` (`auth.service.js:76`), `Conta desativada` (`auth.service.js:80`), `Sessão inválida. Entre novamente.` (`auth.service.js:127`). Nunca faça match por string de mensagem, use o `code`.

## 3. JWT: allowlist HS256

`config.jwt.algorithms = ['HS256']` (`config.js:45`) é passado em **todos** os `jwt.verify` do backend:

- REST estrito: `src/middleware/auth.js:30`
- Auth não bloqueante (anônimo preservado): `src/middleware/flexible-auth.js:61`, ver [[auth-flexivel]]
- Handshake do WebSocket: `src/modules/collab/collab.gateway.js:241`, ver [[canal-collab-websocket]] e [[canal-collab-websocket]]

Sem a allowlist, `jsonwebtoken` aceitaria o `alg` declarado **no próprio token**, abrindo o ataque clássico de `alg: none` e a confusão HS/RS. A emissão é igualmente pinada (`algorithm: 'HS256'`, `auth.service.js:40`).

Como só existe um emissor de token (ver [[jwt-emissor-unico]] e [[autenticacao-jwt]]), qualquer novo verificador que apareça no código **deve** repetir `{ algorithms: config.jwt.algorithms }`; esquecer o parâmetro é a regressão silenciosa mais provável desta seção. No WS, a falha encerra o upgrade com `401` em vez de abrir o socket.

No cliente: `Token expired` aciona refresh; token inválido significa limpar tokens e voltar ao login.

## 4. helmet, CSP, HSTS e CORS

Configurado em `src/app.js:37-49`, como primeiro middleware global (a ordem importa: precisa envolver inclusive as respostas de erro).

- CSP: `default-src 'none'`, `img-src 'self' data:`, `connect-src 'self'`, `frame-ancestors 'none'` (`app.js:38-45`).
- HSTS: `max-age=15552000; includeSubDomains`, **apenas** quando `config.isProd`, senão `false` (`app.js:46`). Ligar HSTS em dev sobre `http://localhost` envenenaria o cache HSTS do navegador do desenvolvedor.
- `Cross-Origin-Resource-Policy: cross-origin` (`app.js:47`), necessário para o consumo de assets (imagens de atlas, tiles 3D, ver [[assets3d-distribuicao]]) por origem diferente.
- CORS: `origin: config.cors.origin` com `credentials: true` (`app.js:49`). Default `http://localhost:8080` (`config.js:49`), placeholder de dev.

Entenda o escopo: essa CSP protege as **respostas da API** (JSON), não a página do frontend, que tem servidor e CSP próprios. O ganho prático é `frame-ancestors 'none'` (anticlickjacking) e o fato de uma resposta hostil nunca conseguir carregar script.

## 5. Health check de readiness

`GET /api/v1/health` (`app.js:78-87`) é readiness de verdade: executa `SELECT 1 AS ok` no banco. Sucesso devolve `{ "status": "ok" }`; falha devolve `503` com `code: SERVICE_UNAVAILABLE` e mensagem `Database unavailable`. É montado antes de qualquer rota autenticada e não passa por auth.

Serve para orquestração e monitoramento, **não** para o boot do frontend. O app decide por `GET /api/config` (ver [[config-runtime-urls-relativas]] e [[config-dinamico]]), com fail-fast; não existe modo offline para o qual cair quando existe backend configurado (a distinção local/remoto é outra coisa, ver [[dominio-local-vs-remoto]] e [[dominio-local-vs-remoto]]). O frontend hoje não chama `/health` em lugar nenhum. Não faça polling agressivo: cada chamada dispara uma query.

## 6. Boot fail-fast de ambiente

`validateEnvVariables()` roda em `src/index.js:11`, **antes** de `createServer` e de aceitar qualquer conexão. Acumula todos os erros num array e aborta com a lista completa, em vez de parar no primeiro (`config.js:184-190`). Isso existe para que um deploy mal configurado custe um ciclo de correção, não cinco.

Regras (`config.js:191-218`):

- `DATABASE_URL` obrigatório.
- `JWT_SECRET` obrigatório; em produção, `>= 32` caracteres.
- `PORT` inteiro entre 1 e 65535 (`NaN` também falha).
- `CORS_ORIGIN` **obrigatório em produção** e, se presente em qualquer ambiente, precisa ser uma URL válida (`new URL(...)`).
- Knobs numéricos e durações (`15m`, `7d`) validados em bloco logo depois (`config.js:230-256`).

Detalhe sutil: `isProd` é lido de `process.env.NODE_ENV` **no momento da chamada**, não da constante de import time (`config.js:188`), justamente para que testes e overrides de boot exerçam o ramo de produção de forma determinística.

Ver [[deploy-backend]] para o conjunto completo de variáveis.

## 7. Self-registration gateada

`POST /auth/register` só é **montada** se `config.security.allowSelfRegistration` (`auth.routes.js:13-16`). A resolução é `resolveAllowSelfRegistration(env, override)` (`config.js:23-27`): `ALLOW_SELF_REGISTRATION=true|false` vence; sem override, habilitado em tudo que não for `production`.

Como a rota não é montada (e não apenas bloqueada), a chamada cai no 404 genérico de `app.js:122-124` e retorna `404 NOT_FOUND`, não `403`. É intencional: `403` confirmaria a existência do endpoint. Consequência para o frontend: não assuma que o cadastro existe; derive da configuração de deploy ou trate `404` escondendo a tela.

Note que `/auth/verify-email` e `/auth/resend-verification` continuam sempre montadas, porque contas com e-mail podem existir mesmo com o auto-cadastro desligado (criadas por admin em [[gestao-usuarios]]).

## 8. Resumo de status

| Situação | Status | `code` |
|---|---|---|
| Excedeu rate limit | `429` | `TOO_MANY_REQUESTS` |
| Credenciais inválidas / conta desativada | `401` | `UNAUTHORIZED` |
| E-mail não confirmado | `401` | `EMAIL_NOT_VERIFIED` |
| Organização inativa | `403` | `FORBIDDEN` |
| Refresh inválido, reuso ou expirado | `401` | `UNAUTHORIZED` |
| JWT forjado, `alg` fora da allowlist ou expirado | `401` | `UNAUTHORIZED` |
| Imagem: tipo inválido, conteúdo divergente, grande demais | `400` | `BAD_REQUEST` |
| `register` desabilitado | `404` | `NOT_FOUND` |
| Banco indisponível (health) | `503` | `SERVICE_UNAVAILABLE` |

O `429` é escrito diretamente pelo handler do limitador e **não** passa pelo `errorHandler` central (`src/middleware/error-handler.js`), então não espere dele os enriquecimentos de log ou `details` dos demais erros.

## Relacionados

[[erros-api]], [[sintese-contrato-erros-http]], [[autenticacao-jwt]], [[jwt-emissor-unico]], [[refresh-token-rotacao]], [[auth-flexivel]], [[api-keys]], [[upload-imagens-seguranca]], [[permissoes-atlas]], [[link-publico]], [[deploy-backend]], [[auditoria]], [[sintese-eixos-de-permissao]]

## Fontes

- guia *11-seguranca-hardening* (absorvido): estrutura dos mecanismos de borda (rate limiting, timing-safe, HS256, helmet, health, fail-fast, self-registration) e notas de integração para o cliente.
- `ebgeo_backend/src/middleware/rate-limit.js`: chaves, janelas, `skip` em teste, `validate: false`, handler do 429.
- `ebgeo_backend/src/config.js`: defaults de `rateLimit`, allowlist `algorithms: ['HS256']`, `resolveAllowSelfRegistration`, corpo de `validateEnvVariables`.
- `ebgeo_backend/src/app.js`: configuração do helmet/CSP/HSTS/CORP, CORS, health check com `SELECT 1`, 404 genérico.
- `ebgeo_backend/src/index.js`: chamada de `validateEnvVariables()` antes do listen.
- `ebgeo_backend/src/modules/auth/auth.service.js`: `DUMMY_HASH`, comparação bcrypt incondicional, mensagens reais (em português) e desfechos de login.
- `ebgeo_backend/src/modules/auth/auth.routes.js`, `auth.schemas.js`: rotas cobertas pelo `authLimiter`, ordem limiter/validate, montagem condicional de `/register`.
- `ebgeo_backend/src/middleware/auth.js`, `flexible-auth.js`, `src/modules/collab/collab.gateway.js`: pontos de `jwt.verify` com a allowlist.
- `ebgeo_backend/src/middleware/error-handler.js`: envelope de erro e o fato de o 429 não passar por ele.
