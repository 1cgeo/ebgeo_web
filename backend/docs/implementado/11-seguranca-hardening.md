# 11 - Segurança e Hardening

Este documento cobre os endurecimentos de borda da API que o frontend precisa conhecer
para integrar com robustez: rate limiting, respostas de autenticação à prova de timing,
rotação/detecção de reuso de refresh tokens, validação de upload de imagens, cabeçalhos de
segurança (helmet) e o health check de readiness.

O foco aqui é **o que muda no comportamento visível** (status, headers, mensagens de erro)
e **como reagir no cliente**. Nada disso quebra o caminho anônimo nem os contratos de dados
existentes — são apenas bordas mais rígidas e correções de segurança.

---

## Visão Geral

| Mecanismo | Onde aparece para o cliente |
|-----------|------------------------------|
| Rate limiting | `429 TOO_MANY_REQUESTS` em `/auth/{login,refresh,register}` e `/atlas/public/:link` |
| Login timing-safe | Mensagem genérica `Invalid credentials` (não revela se o usuário existe) |
| Rotação de refresh token | Cada `POST /auth/refresh` devolve um **novo** refresh token |
| Detecção de reuso | Reapresentar um refresh token já usado invalida **toda a família** |
| JWT só HS256 | Tokens com outro algoritmo (ex.: `none`) são rejeitados → `401` |
| Upload de imagem | Allowlist `png/jpeg/webp` (sem SVG) + validação de conteúdo real |
| Download de imagem | Servido como `attachment` com ETag/Range/304 |
| helmet (CSP/HSTS) | Cabeçalhos de segurança em todas as respostas |
| Health | `GET /health` → `200` ou `503` se o banco cair |

---

## 1. Rate Limiting

Duas rotas de superfície de ataque têm limitador de taxa. Excedido o limite, o servidor
responde **`429 Too Many Requests`** com o envelope de erro padrão.

### 1.1 Rotas de credencial (`/auth/login`, `/auth/refresh`, `/auth/register`)

Limitador **estrito**, com chave por **IP + username** (força-bruta contra uma conta é
estrangulada sem que um IP barulhento bloqueie todo mundo).

- Janela: **15 minutos** (`RATE_LIMIT_AUTH_WINDOW_MS`, default `900000`)
- Máximo: **10 tentativas** por janela (`RATE_LIMIT_AUTH_MAX`, default `10`)

### 1.2 Link público (`/atlas/public/:link`)

Limitador **mais frouxo**, por **IP** apenas (a rota não tem body com username).

- Janela: **1 minuto** (`RATE_LIMIT_PUBLIC_WINDOW_MS`, default `60000`)
- Máximo: **30 requisições** por janela (`RATE_LIMIT_PUBLIC_MAX`, default `30`)

### Response (429)

```json
{
  "error": {
    "code": "TOO_MANY_REQUESTS",
    "message": "Muitas tentativas. Tente novamente mais tarde."
  }
}
```

### Headers

O limitador emite os headers padrão `RateLimit-*` (RFC), úteis para o cliente exibir
quanto falta:

```
RateLimit-Limit: 10
RateLimit-Remaining: 0
RateLimit-Reset: 842
```

### Notas de integração no frontend

- Trate `429` distinto de `401`: **não** dispare logout nem refresh; é só backoff temporal.
- Em telas de login, exiba uma mensagem amigável ("muitas tentativas, aguarde") e
  desabilite o botão de submit. Use `RateLimit-Reset` (segundos) para o countdown quando
  presente.
- Como a chave é IP + username, errar a senha de **uma** conta não trava o login de outra
  conta no mesmo IP.

> **Nota de operação:** o limitador é **pulado no ambiente de teste** por padrão (o store
> em memória acumularia entre testes). Em produção/dev ele está sempre ativo.

---

## 2. Login Timing-Safe + Mensagem Genérica

`POST /auth/login` foi endurecido contra **oráculos de timing** e **enumeração de usuários**:

- O bcrypt **sempre roda**, mesmo quando o username não existe (compara contra um hash
  dummy). Assim o tempo de resposta não revela se o usuário é real.
- A mensagem de erro é **idêntica** para "usuário inexistente" e "senha errada".

### Response (401) — usuário inexistente OU senha errada

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid credentials"
  }
}
```

### Conta desativada

Se o usuário existe e a senha confere, mas a conta foi desativada (`is_active = false`),
a mensagem é específica:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Account is deactivated"
  }
}
```

### Notas de integração no frontend

- **Não** tente distinguir "usuário não existe" de "senha incorreta" na UI — o backend não
  fornece esse sinal de propósito. Exiba sempre "credenciais inválidas".
- `Account is deactivated` pode ter um tratamento próprio (ex.: instruir a procurar o admin).

---

## 3. Refresh Tokens: Rotação, Reuso e Revogação

O fluxo de login/refresh está descrito em [01 - Autenticação](./01-autenticacao.md). Aqui
detalhamos as garantias de segurança em torno do refresh token.

### 3.1 Rotação

Cada `POST /auth/refresh` **revoga** o refresh token apresentado e emite um **novo par**
(access + refresh). O refresh token é de uso único.

> **Contrato congelado**: a resposta do refresh sempre traz um `refreshToken` novo. O
> cliente **deve** substituir o token armazenado pelo retornado; reusar o antigo falha.

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "novo-refresh-token-rotacionado..."
  }
}
```

### 3.2 Detecção de Reuso (revoga a família)

Se um refresh token **já revogado** for reapresentado, o backend interpreta como possível
roubo da cadeia de rotação e **revoga todos os refresh tokens do usuário** — forçando um
novo login em todos os dispositivos. A resposta é genérica:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid refresh token"
  }
}
```

A mesma mensagem `Invalid refresh token` cobre os três casos abaixo (sem distinguir, para
não vazar estado):

| Situação | Status |
|----------|--------|
| Token nunca existiu | `401 UNAUTHORIZED` |
| Token já revogado (reuso) | `401 UNAUTHORIZED` + revoga a família |
| Token expirado | `401 UNAUTHORIZED` (mensagem `Refresh token expired`) |

### 3.3 Revogação automática de tokens

Os refresh tokens de um usuário são **revogados em massa** quando:

- O usuário **troca a própria senha** (`PUT /users/me/password`)
- Um admin **reseta a senha** do usuário (`POST /users/:userId/reset-password`)
- O usuário é **desativado** (`DELETE /users/:userId`)
- **Reuso** de um refresh token é detectado (§3.2)

### Fluxo

```
Cliente A                      Backend                      Cliente B (atacante)
   |                              |                                 |
   |-- refresh(tokenN) ---------->|                                 |
   |<-- {access, tokenN+1} -------|  [tokenN revogado, rotacionado] |
   |                              |                                 |
   |                              |<------- refresh(tokenN) ---------|  (token roubado, já usado)
   |                              |  [REUSO detectado:              |
   |                              |   revoga TODA a família]        |
   |                              |--------- 401 ------------------>|
   |                              |                                 |
   |-- refresh(tokenN+1) -------->|                                 |
   |<-- 401 Invalid -------------|  [família foi revogada]         |
   |   [força novo login]         |                                 |
```

### Notas de integração no frontend

- **Sempre** salve o `refreshToken` retornado pelo refresh, substituindo o anterior.
- Ao trocar a senha (próprio fluxo), espere que **outras sessões/abas** percam o refresh —
  trate o `401` no refresh delas como "faça login de novo", não como erro inesperado.
- Evite refresh concorrente (duas requisições com o mesmo refresh token): a segunda cairá
  na detecção de reuso e derrubará a sessão inteira. Serialize o refresh (uma fila única).

---

## 4. JWT: Apenas HS256

Toda verificação de JWT — tanto no REST quanto no handshake do WebSocket — usa uma
**allowlist de algoritmo** (`HS256`). Tokens assinados com outro algoritmo, ou forjados
com `alg: none`, são **rejeitados**.

### Response (401) — token inválido/forjado

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid token"
  }
}
```

Token expirado tem mensagem própria:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Token expired"
  }
}
```

No WebSocket, a falha de verificação encerra o upgrade com `HTTP/1.1 401 Unauthorized`
(ver [04 - WebSocket e Colaboração](./04-websocket-collab.md)).

### Notas de integração no frontend

- O cliente nunca emite JWTs (eles vêm do backend), então isso é transparente no caminho
  feliz. O ponto prático: trate `Token expired` (401) acionando o fluxo de refresh, e
  `Invalid token` como "limpe os tokens e volte ao login".

---

## 5. Upload e Download de Imagens

O detalhe funcional do módulo de imagens está em
[06 - Presença e Imagens](./06-presenca-imagens.md). Aqui ficam só as regras de hardening.

### 5.1 Allowlist de tipos (sem SVG)

Tipos aceitos no upload: **`image/png`, `image/jpeg`, `image/webp`**. SVG foi **removido**
(é vetor de XSS armazenado quando servido).

A validação ocorre em **duas camadas**:

1. **MIME declarado** (header do multipart / campo `mimeType` no bulk base64) precisa estar
   na allowlist.
2. **Conteúdo real (magic bytes)** é inspecionado e precisa **bater** com o tipo declarado.
   Um HTML/SVG renomeado para `.png` é rejeitado.

### Request — upload single (multipart)

`POST /api/v1/atlas/:atlasId/images` — campo `image` (multipart/form-data).

### Response (400) — tipo inválido

No upload single (multipart) o `fileFilter` do multer rejeita com a mensagem curta:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid file type"
  }
}
```

(A mensagem completa `Invalid file type. Allowed: image/png, image/jpeg, image/webp` só existe na checagem do service, inalcançável no multipart; no bulk base64 o motivo é `Invalid file type: <mime>`.)

### Response (400) — conteúdo não bate com o tipo declarado

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "File content does not match declared type"
  }
}
```

### Response (400) — arquivo grande demais

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Image too large (max 10MB)"
  }
}
```

> O limite default é **10 MB** (`MAX_IMAGE_SIZE_MB`); o multer rejeita acima desse tamanho
> antes mesmo de o conteúdo ser inspecionado. No upload single (multipart) o
> `MulterError(LIMIT_FILE_SIZE)` é mapeado para **`400 BAD_REQUEST`** por um wrapper na rota
> (`uploadSingleImage`), e não mais para o `500` genérico. No caminho bulk/base64 o motivo no
> `failed[]` é `File too large: <N>MB (max: 10MB)`.
>
> O corpo do `POST /images/bulk` (lote base64) tem um limite dedicado **`MAX_BULK_UPLOAD_MB`**
> (default 50 MB), maior que o limite global de JSON (10 MB), para o limite por imagem ser
> de fato alcançável num lote.

No **bulk** (`POST /api/v1/atlas/:atlasId/images/bulk`, base64) a validação é **por item**
com falha parcial — itens inválidos vão para `failed[]` com o motivo, sem abortar os demais:

```json
{
  "data": {
    "uploaded": [
      { "localId": "img-1", "serverId": "uuid", "filename": "mapa.png", "size": 20480 }
    ],
    "failed": [
      { "localId": "img-2", "error": "Invalid file type: image/svg+xml" },
      { "localId": "img-3", "error": "Content does not match declared type" }
    ],
    "mapping": { "img-1": "uuid" }
  }
}
```

### 5.2 Download como attachment + cache

`GET /api/v1/atlas/:atlasId/images/:imageId` serve a imagem como **anexo** (nunca inline),
o que evita qualquer renderização de conteúdo no navegador.

### Headers de resposta (200)

```
Content-Type: image/png
Content-Disposition: attachment; filename="mapa.png"
Cache-Control: private, max-age=31536000, immutable
ETag: "..."
Last-Modified: ...
Accept-Ranges: bytes
```

- **304 Not Modified**: envie `If-None-Match` com o `ETag` recebido para revalidar barato.
- **Range / 206**: envie `Range: bytes=0-1023` para baixar fatias (`206 Partial Content`
  com `Content-Range`).

### Notas de integração no frontend

- Como o `Content-Disposition` é `attachment`, **não** referencie a URL diretamente em
  `<img src>` esperando inline. Para exibir, baixe via `fetch` (com o `Authorization`),
  crie um `blob:` URL e use esse no `<img>`.
- O cache é `private, immutable`: uma vez baixada, a imagem não muda. Não há necessidade de
  cache-busting por query string.
- Não envie SVG. Se a UI permite o usuário escolher arquivo, filtre para `png/jpeg/webp`
  no `accept` do input para evitar a viagem perdida ao servidor.

---

## 6. Cabeçalhos de Segurança (helmet)

Todas as respostas trazem cabeçalhos do **helmet**, com uma **Content Security Policy**
restritiva e **HSTS** habilitado **apenas em produção**.

### Diretivas CSP

```
Content-Security-Policy:
  default-src 'none';
  img-src 'self' data:;
  connect-src 'self';
  frame-ancestors 'none'
```

### HSTS (somente produção)

```
Strict-Transport-Security: max-age=15552000; includeSubDomains
```

Também é aplicada `Cross-Origin-Resource-Policy: cross-origin` (para o consumo de assets
por origens permitidas).

### Notas de integração no frontend

- A API é **JSON/dados** — a CSP acima protege as respostas da própria API, não a página
  do frontend (que tem o próprio servidor e a própria CSP). Em geral é transparente para
  quem consome a API.
- `frame-ancestors 'none'` impede embutir respostas da API em iframes (anti-clickjacking).

> **CORS:** o backend habilita CORS para `CORS_ORIGIN` (default `http://localhost:8080`)
> com `credentials: true`. Configure a origem do frontend no deploy. Ver
> [../deploy/deploy.md](../deploy/deploy.md).

---

## 7. Health Check (Readiness)

`GET /api/v1/health` é um **readiness probe real**: toca o banco com `SELECT 1`.

### Response (200) — saudável

```json
{ "status": "ok" }
```

### Response (503) — banco indisponível

```json
{
  "error": {
    "code": "SERVICE_UNAVAILABLE",
    "message": "Database unavailable"
  }
}
```

### Notas de integração no frontend

- **Serve para monitoramento/orquestração, não para o boot do frontend.** O app decide por
  `GET /api/config` (fail-fast: 3 tentativas → tela "EBGeo indisponível"); não existe modo
  offline para o qual cair, e o frontend hoje **não chama** `/health` em lugar nenhum.
- Não use `/health` em loop agressivo; é leve, mas dispara uma query a cada chamada.

---

## 8. Self-Registration Gateada

A rota `POST /auth/register` é **condicional**. Em produção ela vem **desligada** por
padrão (rede militar interna); em dev/test, ligada. Controlada por
`ALLOW_SELF_REGISTRATION` (`true`/`false`).

> Quando desabilitada, a rota **não é montada** — uma chamada retorna **`404 NOT_FOUND`**
> (não `403`), para não vazar a existência do endpoint.

### Response (404) — registro desabilitado

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found"
  }
}
```

### Notas de integração no frontend

- **Não assuma** que o registro existe. Se o ambiente desabilita, esconda a tela de
  cadastro. Uma forma robusta: tentar o endpoint e, ao receber `404`, ocultar a opção; ou
  derivar de configuração de deploy do próprio frontend.

---

## 9. Boot Fail-Fast (`validateEnvVariables`)

No boot (`src/index.js`), antes de subir o servidor, o backend valida o ambiente e
**aborta** com uma mensagem agrupada se algo estiver errado. Acumula **todos** os erros
(não para no primeiro):

- `DATABASE_URL` obrigatório
- `JWT_SECRET` obrigatório; em **produção** deve ter **≥ 32 caracteres**
- `PORT` entre 1 e 65535
- `CORS_ORIGIN`, se presente, deve ser uma URL válida

### Exemplo de saída de erro no boot

```
Configuração inválida:
  - DATABASE_URL é obrigatório
  - JWT_SECRET deve ter >= 32 caracteres em produção
  - CORS_ORIGIN deve ser uma URL válida
```

Isto é operacional (deploy), **não** algo que o cliente HTTP veja — mas explica por que um
backend mal configurado simplesmente não sobe. Detalhes de configuração em
[../deploy/deploy.md](../deploy/deploy.md).

---

## 10. Resumo de Status de Erro

| Situação | Status | `code` |
|----------|--------|--------|
| Excedeu rate limit | `429` | `TOO_MANY_REQUESTS` |
| Credenciais inválidas (login) | `401` | `UNAUTHORIZED` |
| Refresh token inválido/reuso/expirado | `401` | `UNAUTHORIZED` |
| JWT inválido/forjado/expirado | `401` | `UNAUTHORIZED` |
| Tipo de imagem inválido / conteúdo não bate / grande demais | `400` | `BAD_REQUEST` |
| `register` quando desabilitado | `404` | `NOT_FOUND` |
| Banco indisponível (health) | `503` | `SERVICE_UNAVAILABLE` |

---

## Checklist de Integração

- [ ] Tratar `429` com backoff/countdown (sem disparar refresh ou logout)
- [ ] Exibir mensagem genérica em falha de login (não distinguir usuário/senha)
- [ ] Substituir o refresh token a cada refresh; serializar refresh concorrente
- [ ] Tratar revogação em massa (troca de senha) como "relogar nas outras sessões"
- [ ] Filtrar upload para `png/jpeg/webp` (sem SVG) no input
- [ ] Baixar imagem via `fetch` + `blob:` (anexo, não inline); usar `ETag`/`If-None-Match`
- [ ] ~~Usar `GET /health` na inicialização para escolher online/offline~~ — fora de escopo: o boot é fail-fast em `GET /api/config`
- [ ] Não assumir que `/auth/register` existe (pode ser `404`)

---

## Documentos Relacionados

- [01 - Autenticação](./01-autenticacao.md) - Login, refresh, logout, registro
- [04 - WebSocket e Colaboração](./04-websocket-collab.md) - Handshake e token no WS
- [06 - Presença e Imagens](./06-presenca-imagens.md) - Fluxo funcional de imagens
- [10 - Config Dinâmico](./10-config.md) - Configuração de runtime servida ao frontend
- [../deploy/deploy.md](../deploy/deploy.md) - Env vars, CORS, migrações, segurança em deploy
- [../../README.md](../../README.md) - Índice da documentação
