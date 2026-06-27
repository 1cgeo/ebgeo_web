# Plano de implementação — Criação de conta (signup + e-mail) e Painel do Administrador

> Companheiro **acionável** da [`proposta-ui-ux-atlas-drive.md`](./proposta-ui-ux-atlas-drive.md)
> (§8 Frente 6 e §9 Frente 7). Enquanto aquele documento descreve o **quê/porquê**, este descreve o
> **como** — faseado, file-by-file, nos dois repositórios (`ebgeo_web` + `ebgeo_backend`), com testes
> e gates de verificação por fase.
>
> Status: **IMPLEMENTADO (F0–F6)** — todas as fases entregues e verificadas (lint + unit + e2e nos dois
> repositórios). **Nada commitado** (revisão manual). Desvios de projeto adotados na execução:
> - **Migrações editadas in-place** (`001_core.sql`, `003_sync.sql`), não em arquivos novos (dev).
> - **F2:** a verificação é disparada **quando há e-mail** — registros sem e-mail (admin/legado/testes)
>   seguem ativos, então nada existente quebrou. O **mailer é sem-dependência** (loga o link em dev;
>   *seam* para SMTP via `nodemailer` quando disponível — `package-lock` não foi tocado).
> - **F5:** **só metadados** (decisão do usuário: 360/3D não tratam arquivos). Sem media-store/upload; o
>   `config` (rico, com expressões MapLibre) é editado como **JSON**. Backend `resources`/`sv360-admin`
>   reaproveitados sem mudança.
> - **F6:** estilo de basemap = **override em DB sobre o estático** (preserva a injeção de URLs por ENV);
>   sem mudança de seed. Validação MapLibre (`utilities/maplibre-style-validate.js`, unit-testada).
> - **F4:** a aba "Sistema" usa **handler de click** no salvar (submit-via-botão não disparava no overlay).

---

## 0. Escopo

| Frente | Entrega | Fases |
|--------|---------|-------|
| **F6** — Criação de conta | Botão "Criar conta" no login + confirmação por e-mail | F1, F2 |
| **F7** — Painel do admin | Tela cheia (gated por admin global): usuários · config · catálogo · estilos | F0, F3, F4, F5, F6* |

`*` A fase de estilos de basemap é a F7.4 da proposta; aqui é a **Fase 6** do plano (numeração de fase
≠ numeração de frente). Mapa: F0=pré-requisito · F1/F2=Frente 6 · F3=Frente 7.1 · F4=Frente 7.2 ·
F5=Frente 7.3 · F6=Frente 7.4.

### Fora de escopo (deste plano)
Frentes 1–5 da proposta (Drive, logout, URL por atlas, idle timeout, share 3D/360) — já têm guia
próprio na proposta e podem interfoliar com este plano sem dependência forte (exceto reuso do modo de
tela cheia, ver F3).

---

## 1. Decisões a travar ANTES de codar

Três decisões mudam o desenho. Recomendação em **negrito**; confirmar antes de iniciar a fase citada.

1. **Confirmação por e-mail vs. aprovação por admin (bloqueia F2).** Rede militar é fechada e **hoje
   não há SMTP** no deploy.
   - **(a)** Existe **relay SMTP interno**? Se sim → fluxo por e-mail completo.
   - **(b)** Se não → **modo "aprovação por admin"**: a conta nasce pendente e um admin a ativa pela
     aba Usuários (F3). O e-mail (quando houver SMTP) só **confirma o endereço**; o admin **libera o
     acesso**.
   - **Recomendação:** implementar o backend **agnóstico ao canal** (estado `pending` + token), com
     um flag `AUTH_VERIFICATION_MODE = email | admin | both`. Em dev, o mailer faz **no-op + loga o
     link** (sem SMTP). Assim F2 não fica bloqueada pela infra.

2. **Destino do storage de mídia (bloqueia parte da F5).** Thumbnails (todas as categorias) e vídeos
   (só 3D) enviados pela UI precisam de um destino real. Opções: módulo `images` existente · `assets3d`
   · media-store novo. **Recomendação:** reusar o módulo `images` para thumbnails/vídeos de catálogo
   (já resolve upload+serve+blob), guardando a URL retornada em `previewThumbnail`/`previewVideo`.

3. **Upload dos *bytes* do modelo 3D (escopo da F5).** Hoje `tileset.json`/`.glb` são populados **fora
   de banda** (filesystem/SQLite via `assets3d`, sem rota de upload admin). **Recomendação:** F5 cobre
   só o **cadastro de metadados + thumbnail/vídeo** (a parte pedida); o **upload dos bytes** fica como
   item opcional/posterior (rota de ingestão no `assets3d`), para não inchar a fase.

> Identidade de login: **decidido** — `username` continua a chave; `email` é atributo verificado
> adicional. Não vira identidade de login (preserva `idx_users_username_lower`).

---

## 2. Convenções obrigatórias (não-negociáveis)

- **Frontend:** path aliases (`@store/`, `@modals/`, `@account/`, `@events/`, `@utils/`, `@css/` …),
  **nunca** relativo `../../`. Strings de UI em **pt-BR**; comentários/JSDoc em **inglês**.
  **Sem inline style** — classes BEM em CSS. **Sem `innerHTML` com dado de usuário** → `textContent`/
  `escapeHtml`. Limpeza de listeners via `@utils/event-cleanup.js`. IDs com `generateUUID()`. Eventos
  via `EventTypes.XXX`. Comentário `// Path: …` na linha 1 de todo `.js`.
- **Backend:** módulo no padrão `*.routes.js` + `*.controller.js` + `*.service.js` + `*.queries.js` +
  `*.schemas.js` + `index.js`. Validação Joi via `validate({...})`. Admin gated por `requireAdmin`
  (`role === 'admin'`). **Soft-delete** (`is_active`/`active`/`deleted_at`). Auditoria via
  `audit_trail` (`INSERT_AUDIT`).
- **Migrações — editar SQL in-place (sistema em dev).** **Não** criar arquivos `006/007/008` novos:
  o padrão do projeto é **forward-only, editado in-place** — altera-se o SQL existente
  (`001_core.sql`, `003_sync.sql`, …) e **re-seeda/recria o DB de dev**. As mudanças continuam sendo
  estruturalmente **aditivas** (novas colunas/tabelas/seed), só que aplicadas no arquivo de migração
  já existente em vez de num arquivo novo.
- **Sem rota REST de escrita para entidade colaborativa** (feature/map/layer/group/briefing) — viajam
  por sync. `users`/`resources`/`config`/`sv360-admin` **não** são colaborativas → rotas admin REST
  são legítimas (e várias já existem).
- **Verificação (CLAUDE.md):** `npm run lint` + `npm test` no frontend; backend
  `node scripts/run-tests.js '<glob>'` (nesta máquina com `DB_USER=postgres DB_PASSWORD=postgres`);
  e2e-ui Playwright. Mudança de UI: **capturar screenshot via Playwright e ler a imagem**. **NUNCA
  commitar** — o usuário revisa e commita.

---

## 3. Faseamento e ordem de merge

```
F0  Surfacing do role global  ─┐ (prereq do gate admin)
                               │
F1  "Criar conta" + register ──┼─ independentes entre si
                               │
F2  Confirmação por e-mail ────┘ (depende de F1 + decisão SMTP)

F3  Shell admin + aba Usuários  (depende de F0)
F4  Aba Sistema (config)        (depende de F3 shell)
F5  Aba Catálogo (3D/360/…)     (depende de F3 shell + decisão storage)
F6  Editor de estilo basemap    (depende de F3 shell)
```

Cada fase é **mergeável e verificável sozinha**. Sugestão de ordem: **F0 → F1 → F3 → (F2 ∥ F4 ∥ F5 ∥
F6)**. F0 é barato e destrava o gate; F1 entrega valor visível cedo; F3 abre o shell que F4–F6
preenchem.

---

## 4. Fase 0 — Surfacing do `role` global no cliente (pré-requisito)

**Objetivo:** o cliente passa a conhecer o papel **global** (`user`/`admin`), hoje **descartado**
(`sessionContext` só guarda `org_role`). Sem isso não há como gatear o painel admin.

### Backend
- [ ] Confirmar que `POST /auth/login` e `GET /auth/me` retornam o campo `role` global no objeto user
      (o JWT já carrega `role`; garantir que o **payload de resposta** também o expõe). Ajuste, se
      faltar, é aditivo em `auth.controller.js`/`auth.service.js`.

### Frontend
- [ ] `store/sync/session-context.js`: adicionar `globalRole` (separado de `role`, que segue sendo o
      papel **por atlas**). Métodos `setSession({..., globalRole})` e `isAdmin()` (`globalRole ===
      'admin'`). Não quebrar chamadas existentes (default seguro).
- [ ] `store/sync/sync-engine.js` (`login`) e `index.js` (boot `getMe`): preencher `globalRole` a
      partir de `user.role`.
- [ ] Emitir/propagar via `SESSION_CHANGED` (já existe) para os gates reavaliarem.

### Testes
- [ ] `tests/integration/session-context.test.js`: `isAdmin()` true/false; `globalRole` preservado
      separado de `role` por atlas; default quando ausente.

### Gate
`npm run lint` + `npm test`. (Sem UI nova nesta fase.)

---

## 5. Fase 1 — Botão "Criar conta" + wiring do `register` (sem e-mail ainda)

**Objetivo:** "Adicionar criação de usuário no botão de login." Entrega a **UI de cadastro** ligada ao
`POST /auth/register` **existente** (que hoje cria conta já ativa, sem e-mail). Já é útil em ambientes
com `allowSelfRegistration` ligado; F2 adiciona o e-mail por cima.

### Frontend
- [ ] **NOVO** `modals/signup.modal.js` (extende `ModalBase`, espelha `login.modal.js`): campos
      `nome`, `username`, `senha` + confirmação, e os atributos militares `posto_graduacao`,
      `organizacao_militar`. Factory `showSignupModal({ onSubmit })`. Erros inline (mesma casca do
      login). (Campo `email` entra na F2.)
- [ ] `modals/login.modal.js`: adicionar **link/botão "Criar conta"** na linha de ações + callback
      `onRegister` (paralelo a `onSubmit`); ao clicar, fecha o login e abre o signup.
- [ ] `account/account.control.js` (`_handleLogin`): passar `onRegister` para `showLoginModal`; no
      submit do signup chamar `syncEngine.register({...})` (hoje **órfão**) e, no sucesso, encaminhar
      para login/`openProjectPicker`.
- [ ] `store/sync/api-client.js` / `sync-engine.js`: `register` **já existem** — só consumir. Garantir
      mapeamento de erro (username duplicado → mensagem pt-BR clara).
- [ ] **NOVO** `css/signup.css` (BEM, espelha `login.css`; sem inline style). Registrar import no
      ponto onde `login.css` é importado.

### Backend
- [ ] Nenhuma mudança obrigatória (endpoint existe). Garantir `allowSelfRegistration` ligado no
      ambiente de teste/dev para o e2e. `registerSchema` já aceita os campos militares.

### Testes
- [ ] `tests/e2e-ui/browser-signup.spec.js` (NOVO): no ambiente e2e (self-registration on), abrir
      login → "Criar conta" → preencher → submeter → conseguir logar com a conta criada.
- [ ] (Se houver helper de validação de form puro, unit em `tests/unit/`.)

### Gate
`npm run lint` + `npm test`; e2e-ui do signup; **screenshot** do modal de signup (capturar + ler a
imagem).

---

## 6. Fase 2 — Confirmação por e-mail (completa a Frente 6)

**Objetivo:** conta nasce **pendente** e só ativa após confirmação. Implementar **agnóstico ao canal**
(ver Decisão 1): estado + token no backend; e-mail quando houver SMTP, senão aprovação por admin.

### Backend
- [ ] **Editar `src/database/migrations/001_core.sql` in-place** (dev → recria o DB):
  - na `CREATE TABLE users`, adicionar as colunas `email CITEXT UNIQUE` (nullable — linhas legadas
    sem e-mail) e `email_verified BOOLEAN NOT NULL DEFAULT false`.
  - adicionar `CREATE TABLE email_verification_tokens (token UUID PK DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())` + índice por `user_id` (junto das
    demais tabelas de auth do `001_core.sql`).
  - habilitar a extensão `citext` (`CREATE EXTENSION IF NOT EXISTS citext;`) se ainda não estiver.
- [ ] **NOVO** `src/utils/mailer.js`: transporte de e-mail (ex. nodemailer) **configurável**; quando
      sem SMTP (dev) faz **no-op + loga o link**. Interface `sendVerificationEmail(to, link)`.
- [ ] `src/config.js`: bloco `mail` (host/port/user/pass/from) + `auth.verificationMode`
      (`email|admin|both`, default seguro) + TTL do token. Tudo via env, com defaults dev.
- [ ] `src/modules/auth/`:
  - `auth.schemas.js`: `registerSchema` ganha `email` (obrigatório quando modo exige); novos
    `verifyEmailSchema` ({token}) e `resendVerificationSchema` ({email|username}).
  - `auth.service.js`: `register` grava `email`, cria token, dispara `sendVerificationEmail`; deixa a
    conta **pendente** (`email_verified=false`; e `is_active=false` no modo `admin`).
    `verifyEmail(token)` valida/expira/consome o token e marca `email_verified=true`.
    `resendVerification` re-emite token. **`login` bloqueia** conta não-verificada com erro
    semântico (ex. `EMAIL_NOT_VERIFIED`).
  - `auth.queries.js`: inserts/updates de token + `UPDATE users SET email_verified`.
  - `auth.controller.js` + `auth.routes.js`: `POST /auth/verify-email`, `POST /auth/resend-verification`
    (com `authLimiter`).
- [ ] `audit_trail`: registrar `USER_REGISTER` e `EMAIL_VERIFIED` (reusar `INSERT_AUDIT`).

### Frontend
- [ ] `modals/signup.modal.js`: adicionar campo **`email`** (validação de formato) — mensagem
      "verifique seu e-mail para confirmar a conta" no sucesso.
- [ ] `store/sync/api-client.js`: `verifyEmail(token)`, `resendVerification(payload)`.
- [ ] `index.js` (boot): tratar **`?verify=<token>`** → chamar `verifyEmail` → tela/toast "conta
      confirmada, faça login". Inserir como branch de boot **com a precedência do contrato** (após
      `#view`, antes de `?atlasPublico`/`?atlas`).
- [ ] Login: ao receber `EMAIL_NOT_VERIFIED`, mostrar erro + ação **"reenviar e-mail de confirmação"**.

### Testes
- [ ] Backend `tests/auth/*` (node:test): register→pending→verify→login OK; login bloqueado antes de
      verificar; token expirado/consumido rejeitado; resend emite novo token. Rodar:
      `DB_USER=postgres DB_PASSWORD=postgres node scripts/run-tests.js 'tests/auth/**/*.test.js'`.
- [ ] `tests/e2e-ui/browser-signup-verify.spec.js`: signup → captura do link logado pelo mailer no-op
      → `?verify=` → login. (Modo `email` com mailer no-op.)
- [ ] Unit `tests/unit/` para a matemática de expiração do token (TTL/agora), se extraída pura.

### Gate
`npm run lint` + `npm test`; backend auth tests; e2e-ui verify; **screenshot** do estado "verifique
seu e-mail" e do erro de login não-verificado.

> **Branch de decisão (SMTP):** sem relay interno, subir só o **modo `admin`** (conta pendente →
> ativada na aba Usuários da F3). O código acima já cobre os dois modos via `verificationMode`.

---

## 7. Fase 3 — Shell do Painel Admin + aba Usuários (Frente 7.1)

**Objetivo:** abrir a tela cheia de administração (gated por admin global) e entregar a primeira aba
(Usuários) — a de **menor risco**, porque o CRUD backend **já existe**.

### Frontend — shell
- [ ] **NOVO** módulo `admin/` (com `index.js` barrel): `admin.control.js` (orquestra abrir/fechar +
      gate), `admin.view.js` (tela cheia + framework de abas). Reusar o **modo de visibilidade de UI**
      (`ApplicationModeManager`) usado pela Frente 1 para esconder o mapa/painéis enquanto o admin
      está aberto.
- [ ] `account/account.control.js`: item de menu **"Administração"**, visível só com
      `sessionContext.isAdmin()` (novo `_updateAdminVisibility`, **sem** depender de `atlasId`).
      Reavaliar em `SESSION_CHANGED` (já assinado).
- [ ] `events/event_types.js`: `ADMIN_PANEL_OPENED` / `ADMIN_PANEL_CLOSED`.
- [ ] **NOVO** `css/admin.css` (BEM): layout de tela cheia, abas, tabelas, formulários. Sem inline
      style; usar design tokens.

### Frontend — aba Usuários
- [ ] Lista (tabela) com `?includeInactive`; ações: **criar**, **editar**, **desativar**/**reativar**,
      **resetar senha**, **rotacionar API key**. Form com os atributos da tabela `users` (mapeados
      1:1). Desativação que **exige `transferTo`** quando o usuário é dono de atlas → UI deve coletar o
      novo dono (reusar `searchUsers` typeahead, como na sharing modal).
- [ ] `store/sync/api-client.js` (**NOVOS** métodos): `listUsers(query)`, `createUser(payload)`,
      `getUser(id)`, `updateUser(id, payload)`, `resetUserPassword(id, payload)`,
      `deactivateUser(id, { transferTo })`, `reactivateUser(id)`, `rotateUserApiKey(id)`.

### Backend
- [ ] CRUD **já existe** em `/api/v1/users` (gated `requireAdmin`). Ajustes pequenos:
  - [ ] (Opcional) `updateUserAdminSchema`: permitir editar `org_role`/`organization_id` (hoje só
        `role`/`is_active`).
  - [ ] (Se F2 em modo `admin`) ação "ativar conta pendente" = `PUT /:id` com `is_active=true` +
        `email_verified=true`; expor como botão "Aprovar" na lista quando pendente.
  - [ ] Auditoria de create/update (reusar `INSERT_AUDIT`; `USER_DELETE` já existe).

### Testes
- [ ] Backend (node:test): cobertura de users CRUD já existe; adicionar caso da extensão de schema
      (`org_role`) se implementada; caso "aprovar conta pendente".
- [ ] `tests/e2e-ui/browser-admin-users.spec.js`: admin loga → abre Administração → cria usuário →
      desativa (com transferTo quando dono) → reativa.
- [ ] Negativo: usuário **não-admin** não vê o item "Administração" e recebe 403 nas rotas.

### Gate
Lint + test (FE); `node scripts/run-tests.js 'tests/users/**/*.test.js'` (BE); e2e-ui admin-users;
**screenshots** da tela cheia, da lista e do form de usuário.

---

## 8. Fase 4 — Aba Sistema: configurar todas as propriedades do config (Frente 7.2)

**Objetivo:** tornar editável **todo** o `GET /api/config` — inclusive os blocos hoje sem via de
escrita (`app`, `features`, `map2d`, `map3d`, URLs de serviço).

### Backend
- [ ] **Editar `003_sync.sql` in-place** (junto da tabela `resources`): adicionar `CREATE TABLE
      config_settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT
      NOW(), updated_by UUID REFERENCES users(id))`. (Chave = caminho do config, ex. `app.title`,
      `features.grid`, `map2d.maxZoom`.) Recria o DB de dev.
- [ ] `src/modules/config/config.service.js` (`getAppConfig`): após montar STATIC+ENV+resources,
      **mesclar os overrides do DB por cima** (precedência do admin). Deep-merge por chave/caminho.
- [ ] **NOVAS** rotas admin no módulo config: `GET /config/admin` (devolve o conjunto editável + os
      overrides atuais) e `PUT /config/admin` (grava overrides), gated `requireAdmin`. Novos
      `config.admin.controller.js`/`config.admin.schemas.js` + `config.queries.js` (upsert/list/delete
      override). **Validação por seção** (App/Features/Map2D/Map3D/Serviços) — tipos e ranges.
- [ ] Auditoria de alteração de config (`CONFIG_UPDATE`).

### Frontend
- [ ] Aba **"Sistema"** com formulário agrupado: **App** (título/tutorial), **Features** (toggles
      `map_3d`/`imagens_panoramicas`/`grid`/`apisearch`), **Mapa 2D** (bounds, min/maxZoom, maxPitch,
      globe, LOD), **Mapa 3D** (bounds + flags do viewer Cesium), **Serviços/URLs** (tiles, busca,
      terrain, glyphs, sv360…). Campos **tipados** (toggle/número/URL) + validação client-side.
- [ ] `store/sync/api-client.js`: `getConfigAdmin()`, `updateConfigOverrides(payload)`.
- [ ] Aviso **"recarregar para aplicar"** (config é `no-cache` → vale no próximo boot/fetch).

### Testes
- [ ] Backend (node:test): merge de override sobre STATIC/ENV/resources com **precedência correta**;
      validação por seção rejeita tipo inválido; round-trip get→put→get. Função de merge **pura** →
      unit dedicado.
- [ ] `tests/e2e-ui/browser-admin-config.spec.js`: admin altera `app.title`/`features.grid` → recarrega
      → efeito visível.

### Gate
Lint + test (FE); `node scripts/run-tests.js 'tests/config/**/*.test.js'` (BE); e2e-ui config;
**screenshot** da aba Sistema.

---

## 9. Fase 5 — Aba Catálogo: 3D, 360, dados e análises (Frente 7.3)

**Objetivo:** cadastrar/editar recursos do catálogo, com **thumbnail** (todas) e **vídeo** (só 3D).
Maior parte do backend **já existe** (`resources` CRUD + `sv360` admin).

### Backend
- [ ] `src/modules/resources/resources.schemas.js`: trocar o `config` genérico (`Joi.object()`) por
      **validação condicional por `category`**: `tileset` (url, heightOffset, keywords, locate,
      previewThumbnail, previewVideo), `data_layer` (source/sourceLayer/minzoom/maxzoom/style.border),
      `analysis_layer` (source/**bounds[4] obrigatório**/paint), `basemap` (enabled/image/priority/—
      style entra na F6). Mantém CRUD existente (`POST/PUT/DELETE /resources`, `requireAdmin`).
- [ ] **Storage de mídia** (Decisão 2): rota/uso para upload de thumbnail (todas) e vídeo (3D). Reusar
      módulo `images` (upload→URL) e gravar a URL em `previewThumbnail`/`previewVideo`. (Bytes do
      modelo 3D = fora de escopo desta fase, ver Decisão 3.)
- [ ] 360: **sem mudança de backend** — `sv360` admin já tem `POST /admin/projects/upload` (multipart
      manifest+SQLite+thumbnail.webp), `GET /admin/projects`, `PATCH .../status`, `DELETE .../:slug`,
      gated por `requireUploadCapability`. (360 **não** tem vídeo, coerente com a regra.)

### Frontend
- [ ] Aba **"Catálogo"** reusando `catalog-card`/grid/filtros já usados no modo *selectable* do
      `atlas-settings.modal.js`, agora em **modo gerência/escrita**: criar/editar/excluir por categoria.
- [ ] Formulários **por categoria** com upload de **thumbnail** (todas) e **vídeo** (só na aba 3D);
      campos do `config` tipados; preview do thumbnail/vídeo.
- [ ] `store/sync/api-client.js` (**NOVOS**): `listResources(category)`, `createResource(payload)`,
      `updateResource(id, payload)`, `deleteResource(id)`, `uploadCatalogMedia(file)` (→ URL); e
      sv360-admin: `listSv360Projects()`, `uploadSv360Project(bundle)`, `setSv360ProjectStatus(slug,
      status)`, `deleteSv360Project(slug)`.

### Testes
- [ ] Backend (node:test): `resources` aceita config válido por categoria e **rejeita** inválido
      (ex.: `analysis_layer` sem `bounds[4]`); soft-delete (`active=false`).
- [ ] `tests/e2e-ui/browser-admin-catalog.spec.js`: cadastrar um `data_layer` → aparece no catálogo;
      cadastrar 3D com thumbnail+vídeo → preview ok.

### Gate
Lint + test (FE); `node scripts/run-tests.js 'tests/resources/**/*.test.js'` (BE); e2e-ui catalog;
**screenshots** dos formulários (3D com vídeo, 360, dados, análise).

---

## 10. Fase 6 — Editor de estilo dos basemaps (Frente 7.4)

**Objetivo:** editar o **JSON de estilo MapLibre** dos basemaps (hoje **hardcoded** em
`config.static.js`). "Editor de JSON mesmo, pois é o padrão do MapLibre."

### Backend
- [ ] Mover o estilo para o **`config` JSONB do recurso basemap** (campo `style`). **Editar o seed de
      basemaps em `003_sync.sql` in-place**: incluir `style` (o JSON MapLibre) no `config` de cada
      basemap atual (`carta-topografica`, `osm`, `bdgex`, `imagens`, `carta-ortoimagem`), portando os
      estilos hoje hardcoded em `config.static.js` — assim **nada regride**. Recria o DB de dev.
- [ ] `config.service.js#buildBasemapStyles`: **emitir do DB** quando houver `config.style`; **fallback
      ao estático** para ids legados sem `style`. Manter os `id`s casados entre `basemaps` e
      `basemapStyles`.
- [ ] `resources.schemas.js` (`basemap`): validar `style` como objeto MapLibre mínimo (`version: 8`,
      `sources`, `layers`).

### Frontend
- [ ] Na aba **"Basemaps & Estilos"**: por basemap, um **editor de JSON** (textarea ou CodeMirror) com
      **validação antes de salvar** (parse + checagens do style spec) para não "brickar" o mapa.
      Mensagens de erro pt-BR. Opcional: botão **preview**.
- [ ] **NOVO** util puro `utils/maplibre-style-validate.js` (`validateStyleJson(text) → {ok, errors}`)
      — função **pura**, ideal para unit test.
- [ ] `store/sync/api-client.js`: reusar `updateResource(id, { config: { style } })`.

### Testes
- [ ] **Unit** `tests/unit/maplibre-style-validate.test.js`: JSON inválido, faltando `version`/`sources`
      /`layers`, válido mínimo, edge cases (string vazia, não-objeto). (Per testing.md: lógica pura +
      ao menos um edge case.)
- [ ] Backend (node:test): `buildBasemapStyles` emite do DB quando há `style` e cai no fallback quando
      não há.
- [ ] `tests/e2e-ui/browser-admin-basemap-style.spec.js`: editar estilo → salvar → persistência.

### Gate
Lint + test (FE, com o unit do validador); `node scripts/run-tests.js 'tests/config/**/*.test.js'`
(BE); e2e-ui basemap-style; **screenshot** do editor.

---

## 11. Matriz de testes e verificação (resumo)

| Fase | FE unit/integration | Backend (node:test) | e2e-ui Playwright | Screenshot |
|------|---------------------|---------------------|-------------------|------------|
| F0 | `session-context` (isAdmin/globalRole) | — (verificar payload /me) | — | — |
| F1 | (form helper, se puro) | — | `browser-signup` | signup modal |
| F2 | TTL do token (se puro) | `tests/auth/**` (register→verify→login) | `browser-signup-verify` | "verifique e-mail" + erro login |
| F3 | — | `tests/users/**` (schema/aprovar) | `browser-admin-users` | tela cheia + lista + form |
| F4 | merge de override (puro) | `tests/config/**` (merge/precedência) | `browser-admin-config` | aba Sistema |
| F5 | — | `tests/resources/**` (validação por categoria) | `browser-admin-catalog` | forms 3D/360/dados/análise |
| F6 | `maplibre-style-validate` | `tests/config/**` (emit-from-DB/fallback) | `browser-admin-basemap-style` | editor JSON |

Comandos: FE `npm run lint && npm test`; BE
`DB_USER=postgres DB_PASSWORD=postgres node scripts/run-tests.js '<glob>'`; e2e-ui
`DB_USER=postgres DB_PASSWORD=postgres npx playwright test <spec>`. **Nunca commitar.**

---

## 12. Riscos e pontos de atenção

- **SMTP inexistente (F2):** mitigado pelo `verificationMode` + mailer no-op (modo `admin` como
  fallback). Confirmar a Decisão 1 antes de F2.
- **Gate por role (F3+):** depende **inteiramente** da F0 (surfacing do `role` global). Sem ela, o
  item "Administração" não tem como distinguir admin de editor.
- **`role` global vs `org_role`:** dois eixos distintos. `requireAdmin` no backend usa o **global**;
  não confundir com o papel por atlas usado nos gates de share/delete.
- **Sincronia de ids de basemap (F6):** os `id`s em `basemaps` e `basemapStyles` devem permanecer
  casados; o seed editado em `003_sync.sql` deve cobrir todos os ids estáticos para evitar mapa
  quebrado.
- **Destino de mídia (F5):** decidir antes (Decisão 2); caminhos `previewThumbnail`/`previewVideo`
  hoje apontam para assets fora de banda — o upload precisa de destino real.
- **Propagação de config (F4):** mudanças valem no próximo fetch (`no-cache`); prever o aviso de
  "recarregar" para não dar falsa sensação de no-op.
- **Auditoria:** estender `audit_trail` para create/update de user/resource/config (hoje só
  `USER_DELETE` é garantido) — desejável para rastreabilidade administrativa.

---

## 13. Checklist de prontidão para começar

- [ ] Decisão 1 (SMTP vs aprovação por admin) confirmada.
- [ ] Decisão 2 (storage de mídia) confirmada.
- [ ] Decisão 3 (upload de bytes 3D dentro/fora de escopo) confirmada.
- [ ] F0 priorizada como primeiro merge (destrava o gate do painel).
