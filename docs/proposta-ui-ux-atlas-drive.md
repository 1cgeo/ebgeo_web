# Proposta: EBGeo — Redesenho de UI/UX no modelo "Google Docs de mapas"

> Status: **PROPOSTA / EM DISCUSSÃO** — nada implementado. Este documento registra o
> diagnóstico do estado atual, as decisões de design já tomadas e o escopo de trabalho por frente.
> Escopo: `ebgeo_web` (frontend) + pontos de toque em `ebgeo_backend` (auth/cadastro de conta,
> metadado de atlas, **administração**: usuários, config global e catálogo 3D/360/dados/análises).
>
> Documentos relacionados: [`visao-e-principios.md`](./visao-e-principios.md) (princípios; **P12**),
> [`acoes-interface-multiusuario.md`](./acoes-interface-multiusuario.md),
> arquitetura do cliente em [`.claude/rules/architecture.md`](../.claude/rules/architecture.md) (§Sync).

---

## Sumário

**Contexto e invariantes**
- §0 Motivação · §1 Tensão P12 (um workspace local) vs. "Drive de atlas" · §2 Estado atual (as-is)

**Frentes de redesenho**
- §3 Frente 1 — Tela cheia de seleção de atlas ("Drive")
- §4 Frente 2 — Logout zera o IndexedDB
- §5 Frente 3 — URL por atlas (e por mapa)
- §6 Frente 4 — Expiração de login (idle timeout)
- §7 Frente 5 — Compartilhamento 3D/360 offline (invariante a preservar)
- §8 Frente 6 — Criação de conta (signup) + confirmação por e-mail
- §9 Frente 7 — Painel do Administrador
  - §9.0 Papéis: admin global vs. Gestor de atlas · §9.1 Usuários · §9.2 Config global ·
    §9.3 Catálogo (3D/360/dados/análises) · §9.4 Estilos de basemap (JSON) · §9.5 Invariantes

**Consolidação**
- §10 Resumo de decisões e esforço (+ contrato de boot) · §11 Benchmark open-source e ideias

---

## 0. Motivação

A UI/UX atual de entrada, troca e compartilhamento de atlas não comunica bem o modelo mental do
produto, que é o **"Google Docs / Google Sheets dos mapas"** (já declarado como norte em
`visao-e-principios.md`). Queremos aproximar a experiência do Drive/Docs: uma tela de seleção de
projetos rica, URL por projeto, sessões que expiram, e logout que realmente zera o ambiente — **sem
quebrar o caminho 100% offline/anônimo** (camada aditiva) nem o compartilhamento 3D/360 que já existe.

---

## 1. Tensão de fundo: P12 (um workspace local) vs. "Drive de atlas"

O conceito "Drive" pressupõe **muitos documentos**. Mas o princípio **P12** é explícito: *local = UM
workspace só* (`Principal` + arquivo `.ebgeo`); **múltiplos atlas locais nomeados é um não-objetivo
deliberado**. Atlas nomeados são um conceito **exclusivo do servidor**.

Consequência direta: **a tela cheia de seleção de atlas é uma feature online/logada.** O usuário
anônimo não tem lista — tem um workspace só.

### Decisão (tomada)

> **Mantém P12.** O usuário anônimo/offline **cai direto no mapa local** (comportamento atual). A
> tela cheia de atlas ("Drive") aparece **apenas quando logado**. Não introduzimos múltiplos atlas
> locais.

Isso preserva a invariante mais importante do produto (caminho offline idêntico) e restringe todo o
redesenho do "Drive" ao domínio remoto.

---

## 2. Estado atual (as-is) — referência rápida

| Frente | Como está hoje | Arquivos-chave |
|--------|----------------|----------------|
| Seleção de atlas | **Modal** (`ModalBase`), aberto após login ou pelo botão "Abrir do servidor". Já mostra dono ("Você"/autor), chip de permissão, badge "Público", data relativa. **Sem** busca, abas ou thumbnail. | `modals/project-picker.modal.js`, `account/account.control.js` (`openProjectPicker`) |
| Logout → branco | **Já implementado.** `_handleLogout()` → `logoutAndDisconnect()` → `clearAllDataStore()` zera todos os stores e recria `Principal`. Boot guard `enforceLocalStoreWhenLoggedOut` descarta dados remotos órfãos. | `account.control.js`, `store/sync/sync-engine.js`, `store/store.js`, `store/store-origin.js` |
| URL por atlas | **Não existe.** URL só carrega estado de *viewer* 3D/360 (hash) e link público anônimo (`?atlasPublico=<link>`). Reconexão no F5 vem do `store-origin` (IndexedDB), não da URL. | `deep-link/deep-link.js`, `index.js` (`reconnectLastAtlas`) |
| Expiração de login | Access token **15min**; refresh **7d** mas **rotaciona** (cada uso emite refresh novo com +7d). Resultado: usuário ativo **nunca expira** (sessão deslizante). Boot renova transparente no `getMe()`. | `store/sync/api-client.js`, `backend src/config.js`, `backend src/modules/auth/` |
| Share 3D/360 offline | Via **hash auto-contido** (`#view=3d&tileset=…` / `#view=360&photo=…`), referenciando `tilesetId`/`photoName` do config. **Fora do sync de entidades** (emit-only). Funciona anônimo. | `deep-link/deep-link.js`, `3d_models_viewer_tool/`, `street_view_tool/` |

---

## 3. Frente 1 — Tela cheia de seleção de atlas ("Drive")

### Objetivo
Substituir o modal por uma **tela cheia** estilo Google Drive, exibida ao entrar logado e acessível
a qualquer momento. Recursos: abas/filtros (**Recentes** / **Meus** / **Compartilhados comigo** /
**Públicos**) e **busca por nome**.

> **Thumbnail por atlas: DESCOPADO** (decisão do usuário). Não haverá snapshot/upload de miniatura do
> mapa por atlas. Os cards do Drive usam uma **faixa colorida com iniciais** (cor estável por atlas)
> como identificador visual. *(O upload de thumbnail do **catálogo**, §9.3, é outra coisa e permanece.)*

### O que já temos de graça
O `project-picker.modal.js` já consome `apiClient.listAtlas()` e já distingue dono, papel
(Proprietário/Edição/Leitura) e público. A lógica de seleção (`onPick` → `clearAllDataStore` →
`markStoreRemote` → `connect` → `activateAtlasInitialMap` → `startAutoFlush`) é reaproveitável
integralmente — muda só a **casca de apresentação** (modal → tela cheia + abas + busca).

### Boot
- **Logado** → cai na tela cheia de seleção (a menos que haja `?atlas=` na URL — ver Frente 2 —, ou
  um deep-link `#view=3d/360` — ver Frente 5 —, que têm precedência).
- **Anônimo** → cai no mapa local (P12). A tela cheia não é exibida.

### Trabalho estimado (frontend)
- Novo componente de tela cheia (reusa o modo de visibilidade de UI; ver `ApplicationModeManager`).
- Abas/filtros sobre `listAtlas()` (dados já vêm com dono/papel/público).
- Busca client-side por nome (lista costuma ser pequena; sem endpoint novo).
- ~~Pipeline de thumbnail (captura + persistência + exibição).~~ **Descopado** (ver acima).

### Toque no backend
- Nenhum (o campo de thumbnail do atlas foi descopado). A seleção (`onPick`), o `listAtlas` e os
  endpoints de rename/clone/delete já existem.

---

## 4. Frente 2 — Logout zera o IndexedDB

### Situação
**Já implementado e correto.** `clearAllDataStore()` zera todos os object stores (maps, layers,
features, imagens, atlas, fila de ops, 3D/360, briefings, comentários), recria `Principal` em branco e
marca a origem como `local`. O boot guard `enforceLocalStoreWhenLoggedOut()` cobre o caso de fechar a
aba sem deslogar.

### Ação
**Nenhuma mudança de design.** Manter como invariante.

> ⚠️ **Bug reportado (a investigar).** O usuário observou que o logout **não** está zerando o ambiente
> como deveria. Como a arquitetura já prevê esse comportamento (`clearAllDataStore` + boot guard),
> trata-se de **regressão**, não de redesenho. Investigar o caminho real de logout (e logout→novo
> login), reproduzir, corrigir e cobrir com **teste de regressão**. Não é parte do redesenho de UI/UX,
> mas bloqueia a percepção de "ambiente limpo" que o modelo Drive exige.

---

## 5. Frente 3 — URL por atlas (e por mapa)

### Decisão (tomada)
> **URL = atlas + mapa:** `?atlas=<uuid>&map=<id>`. O atlas determina o projeto; `map` aponta o mapa
> ativo dentro do atlas (link direto para um mapa específico). Convive com o `?atlasPublico=<link>`
> (anônimo, já existente).

### Comportamento de boot
1. **`#view=3d` / `#view=360` presente no hash** → abre o viewer (anônimo OK). **Tem precedência** e
   **não** força login/seleção (ver Frente 5).
2. **`?atlasPublico=<link>`** → fluxo público anônimo atual.
3. **`?atlas=<uuid>`**:
   - **Logado + com acesso** → `connect(atlasId, { initialPull })`; aplica `&map=<id>` ao ativar o
     mapa inicial; `history.pushState`.
   - **Sem login** → redireciona para login e, ao autenticar, retoma o `?atlas=` pendente.
   - **Sem acesso / inexistente** → erro claro ("sem permissão" vs "não encontrado", sem vazar
     existência de atlas privado).
4. **Sem nenhum dos acima** → tela cheia de seleção (logado) ou mapa local (anônimo).

### Notas de implementação
- Query param (`?atlas`/`?map`) e hash (`#view=…`) são **ortogonais** — o deep-link 3D/360 **não
  conflita** com a URL de atlas.
- Ao abrir/trocar atlas ou mapa, escrever a URL via `history.pushState` (sem reload).
- `map=<id>`: definir se `<id>` é o nome do mapa ou seu UUID. Dado o name-keying do `Principal` e o
  `map-resolver.service.js` (name↔UUID), **recomenda-se UUID** na URL por estabilidade (nomes podem
  repetir/mudar); resolver para nome internamente.
- Hoje a reconexão no F5 vem do `store-origin`. Com URL de atlas, a **URL passa a ser a fonte de
  verdade** do que abrir; o `store-origin` continua como guarda de consistência (origem remota vs
  local), não como roteador.

### Toque no backend
Nenhum novo — `getAtlas`/checagem de acesso já existem. Apenas garantir mensagens de erro que não
vazem existência de atlas privado (404 vs 403, como já se faz em `ng`/`sv360`).

---

## 6. Frente 4 — Expiração de login (idle timeout)

### Causa-raiz do "logado pra sempre"
O refresh token **rotaciona**: cada uso emite um novo refresh com +7d. Usuário ativo **nunca expira**
(sessão deslizante). O boot ainda renova de forma transparente.

### Decisão (tomada)
> **Idle timeout.** A sessão expira após um período de **inatividade** (sem ação do usuário). É o
> modelo mais próximo da intenção ("não pode ficar logado pra sempre") e pode ser majoritariamente
> **client-side**.

### Desenho
- **Cliente:** um detector de inatividade (sem interações de mouse/teclado/edição por *N* tempo)
  dispara `logoutAndDisconnect()` + UX de **"sua sessão expirou, entre novamente"**. Sem perda de
  dados: o trabalho remoto já é sincronizado continuamente (auto-flush). Ao expirar, o ambiente volta
  ao mapa local em branco (Frente 2).
- **Parâmetro:** definir *N* (ex.: 30–60 min de inatividade). Configurável.
- **Reforço opcional no backend (recomendado a seguir):** hoje a expiração mid-session tende a falhar
  silenciosamente. Um **cap absoluto** na família de refresh (emissão + tempo máx., sem estender na
  rotação) garante que mesmo abas "ativas artificialmente" expirem no servidor. Pode ficar para uma
  segunda etapa; o idle timeout client-side já entrega o requisito imediato.

### Tratamento do 401 mid-session
Adicionar um handler global de "auth perdida": quando o refresh final falhar (ou o idle disparar),
derrubar para anônimo de forma limpa (teardown de presença/socket/auto-flush) e abrir o modal de
login — em vez do comportamento atual de falha silenciosa.

### Toque no backend (opcional, etapa 2)
- `JWT_*_EXPIRY` já são configuráveis. Para o cap absoluto: registrar `family_issued_at` no refresh e
  recusar rotação além do limite. Migração **aditiva**; teste de regressão de auth obrigatório.

---

## 7. Frente 5 — Compartilhamento 3D/360 offline (invariante a preservar)

### O que é (não muda)
O share 3D/360 é um **hash auto-contido** (`#view=3d&tileset=<id>&…pose` /
`#view=360&photo=<uuid>&…`), referenciando `tilesetId`/`photoName` do config do backend
(`GET /api/config` é anônimo-OK; projetos `sv360` `enabled` são públicos). Está **fora do
sync de entidades** (emit-only / totalmente fora do atlas). Funciona anônimo/offline.

### Risco no redesenho e mitigação
O **único** risco é o novo boot (login forçado, `?atlas=`) **sequestrar** o caminho do hash. A regra,
já fixada na Frente 2 (item 1 do boot):

> Se há `#view=3d` / `#view=360`, **abre o viewer como anônimo**, com **precedência** sobre
> login/seleção/`?atlas=`. Nunca empurrar um deep-link de viewer para a tela de login ou Drive.

Com esse branch preservado, a Frente 5 permanece **intacta** — é uma garantia, não uma mudança.

---

## 8. Frente 6 — Criação de conta (signup) + confirmação por e-mail

### Objetivo
Permitir que um novo usuário **crie a própria conta** a partir do botão de login e que essa conta só
seja ativada após **confirmação por e-mail**. Hoje todo provisionamento é manual/administrativo (ou
pelo `POST /auth/register`, que vem **desligado em produção**).

### Decisão (tomada)
> 1. **Botão "Criar conta" no modal de login.** Abre um formulário de cadastro (mesma casca
>    `ModalBase`).
> 2. **Conta nasce *pendente* e exige confirmação por e-mail** antes do primeiro login — link de
>    verificação enviado ao e-mail informado.
> 3. **`username` continua sendo a chave de login.** O e-mail é um **atributo verificado adicional**
>    (confirmação + futura recuperação de senha). Não trocamos a identidade para e-mail — menos
>    disruptivo ao schema/índices atuais (`idx_users_username_lower`).

### Estado atual (as-is) — honesto
| Peça | Como está |
|------|-----------|
| Endpoint de registro | `POST /auth/register` **existe**, porém **montado condicionalmente** (`config.security.allowSelfRegistration` — **off em produção**, on em dev/test). Payload `{username, password, nome, posto_graduacao?, organizacao_militar?}` — **sem e-mail**. Cria a conta **já ativa**, **sem verificação**. |
| Cliente | `apiClient.register()` + `syncEngine.register()` **existem**, mas **sem nenhum chamador** (plumbing pronto, UI ausente). |
| E-mail | **Não existe coluna `email`** em `users`; **nenhuma** dependência de mail (sem nodemailer/SMTP), nenhum token de verificação, nenhum estado "pendente". → **100% novo.** |
| Modal de login | Só **Usuário/Senha + Cancelar/Entrar** (`login.modal.js`); sem afford. de cadastro. |

### Desenho do fluxo
1. **Login modal → "Criar conta"** → abre `signup.modal.js` (novo). Campos: `nome`, `username`,
   **`email`**, `senha` (+ confirmação) e os atributos do contexto militar (`posto_graduacao`,
   `organizacao_militar`) — coerentes com a tabela `users`.
2. **`POST /auth/register` (estendido)** cria o usuário em estado **não-verificado**
   (`email_verified = false` e/ou `is_active = false`), grava um **token de verificação** (com
   expiração) e dispara o e-mail.
3. **E-mail de confirmação** com link `…/?verify=<token>`.
4. **Boot trata `?verify=<token>`** → `POST /auth/verify-email` → marca verificado/ativo → tela
   "conta confirmada, faça login".
5. **Login bloqueia conta não-verificada** com mensagem clara + **"reenviar e-mail de confirmação"**
   (`POST /auth/resend-verification`).

### Net-new no backend
- **Migração aditiva** em `users`: `email` (único, case-insensitive), `email_verified BOOLEAN
  DEFAULT false`; **token de verificação** (`token`, `user_id`, `expires_at`, `consumed_at`) — ou
  reaproveitar um padrão de one-time-token.
- **Transporte de e-mail:** dependência de mail (ex. nodemailer) + **config SMTP**
  (host/port/credenciais/from). **Hoje não existe nada disso.**
- **Endpoints:** estender `register` (validar/gravar e-mail + emitir token + enviar),
  `POST /auth/verify-email`, `POST /auth/resend-verification`. Manter o `authLimiter`.
- **Gate:** ligar `allowSelfRegistration` no ambiente onde o self-signup é desejado (ver tensão).

### Net-new no frontend
- `signup.modal.js` (novo) + botão **"Criar conta"** no `login.modal.js` (callback `onRegister`
  paralelo ao `onSubmit`).
- Fiar `syncEngine.register()` (hoje **órfão**) ao submit do signup.
- Branch de boot para `?verify=<token>` (landing de confirmação) + UX de "verifique seu e-mail" e
  "reenviar".
- Mensagem de login bloqueado por conta não-verificada.

### ⚠️ Tensão de produto a decidir (rede militar)
O `allowSelfRegistration` vem **desligado em produção por desenho** (rede fechada) e **não há SMTP**
no deploy. Antes de implementar, decidir:
- **(a)** Há **relay SMTP interno** disponível para enviar o e-mail de confirmação? Sem ele, o fluxo
  por e-mail não fecha.
- **(b)** Alternativa/complemento institucional: **aprovação por administrador** como "confirmação"
  (conta pendente entra numa fila que o admin aprova no painel — Frente 7). Pode **coexistir** com o
  e-mail (e-mail confirma o endereço; admin libera o acesso).

> **Recomendação:** desenhar o fluxo de e-mail como pedido, mas tratá-lo como **configurável** e
> prever o **modo "aprovação por admin"** quando não houver SMTP — assim o produto funciona nos dois
> ambientes (institucional fechado vs. aberto).

### Esforço
Backend **Médio-Alto** (schema + mailer + tokens + endpoints) · frontend **Médio** (signup modal +
boot verify + reenvio).

---

## 9. Frente 7 — Painel do Administrador

Tela cheia de administração **global**, acessível só ao **admin do sistema**. Cobre quatro frentes:
**(9.1)** usuários, **(9.2)** configuração global, **(9.3)** catálogo 3D/360/dados/análises e
**(9.4)** estilos de basemap. A §9.0 fixa o fundamento de papéis; a §9.5, as invariantes.

### 9.0 Papéis: admin **global** vs. Gestor **de atlas** (fundamento)
Duas autoridades distintas — **não confundir**:
- **Admin global** (`users.role = 'admin'`): autoridade do **sistema**. Gerencia **usuários**,
  **config global** e o **catálogo global** (3D/360/dados/análises/basemaps). Gate no backend:
  `requireAdmin` (`role === 'admin'`).
- **Gestor de atlas** (papel por atlas owner/manager): autoridade de **um projeto**. **Não cadastra**
  recursos globais; apenas **restringe** (allow-list) quais recursos globais aparecem **naquele
  atlas**, via `atlas.settings` (overlay **já implementado** — `atlas-settings.modal.js`).
- **Composição:** o **admin define o universo** (catálogo/config global); o **Gestor escolhe um
  subconjunto por atlas**. O painel admin é **global**, **não** atrelado a `syncEngine.atlasId`.

> ⚠️ **Lacuna client-side a resolver (pré-requisito de toda a Frente 7):** hoje o `sessionContext`
> guarda `role: user.org_role || 'viewer'` — o papel **global** (`role`) é **descartado** no cliente.
> Para gatear o painel por **admin global**, o `login`/`getMe` precisam **expor o `role` global** e o
> `sessionContext` **armazená-lo** (separado do `org_role` por atlas).

### Onde vive na UI
- Item **"Administração"** no menu de conta (`account.control.js`), **visível só para admin global**
  (mesmo padrão de gating de `_updateShareVisibility`, mas **sem** depender de `atlasId`).
- Abre uma **tela cheia** (reusa o modo de visibilidade de UI da Frente 1 / `ApplicationModeManager`),
  com **abas**: **Usuários** · **Sistema (config)** · **Catálogo (3D/360/Dados/Análises)** ·
  **Basemaps & Estilos** (e, opcional, **Organizações**).
- **Métodos de cliente são net-new:** o `api-client.js` hoje só tem `searchUsers` na área de usuários
  e **nenhum** método admin de `resources`/`users`/`config`/`sv360-admin`. Toda a Frente 7 precisa de
  uma nova superfície no `api-client.js`.

### 9.1 Usuários — CRUD, atributos e desativação
**As-is (a favor):** o backend **já tem CRUD admin completo** em `/api/v1/users` (gated
`requireAdmin`): `GET /` (lista, `?includeInactive`), `POST /` (criar; admin define `role`
user/admin), `GET /:id`, `PUT /:id` (editar; pode setar `is_active` e `role`),
`POST /:id/reset-password`, `DELETE /:id` (**soft-delete**), `POST /:id/reactivate`,
`POST /:id/api-key/rotate`. **Desativação já modelada:** `is_active = false`, **não** pode
autodesativar, **exige `transferTo`** se o usuário **for dono de algum atlas** (reatribui
propriedade), revoga refresh tokens e grava `audit_trail` (`USER_DELETE`).

**Atributos do usuário (já existem na tabela `users`):** `username` (chave, único case-insensitive),
`nome`, `posto_graduacao`, `organizacao_militar`, `organization_id` (FK tenant) + `org_role`
(owner/admin/editor/viewer), `role` global (user/admin), `is_active`, `api_key` (rotação),
`last_login_at`, `created_at`. Com a Frente 6: `email` + `email_verified`. → A tela de criação/edição
mapeia **1:1** nesses campos.

**Net-new:** UI de listagem/edição + **métodos de cliente** (não existem). No backend, dois ajustes
pequenos: **(i)** **expor `role` global** no `/me`/login (lacuna §9.0); **(ii)** se quisermos editar
**`org_role`/`organization_id`** pela UI, **estender o `updateUserAdminSchema`** (hoje o schema admin
edita `role`/`is_active`, **não** `org_role`).

**Esforço:** backend **Baixo** (API existe; 2 ajustes de schema/claims) · frontend **Médio**.

### 9.2 Configurar todas as propriedades do config
**As-is — `GET /api/config` vem de 3 fontes:**
| Bloco | Fonte | Editável hoje? |
|-------|-------|----------------|
| `basemaps` (metadados: enabled/thumbnail/priority), `dataLayers`, `analysisLayers`, `tilesets` (3D) | **DB `resources`** | **Sim** — CRUD admin já existe (`/api/v1/resources`) |
| `app`, `features` (flags), `map2d` (bounds/zoom/lod), `map3d` (viewer/bounds), `basemapStyles` | **STATIC** (`config.static.js`) | **Não** — sem via de escrita |
| Todas as **URLs** de serviço/tiles/glyphs/terrain + `assets3dBaseUrl`, bloco `streetView360` | **ENV** (`src/config.js`) | **Não** — só process env |

**Decisão (proposta):** introduzir uma **camada de overrides em DB** (ex. tabela `config_settings`
chave→JSONB, ou colunas) que o `config.service.js` **mescla por cima** do STATIC/ENV, com
**precedência do override do admin**. Assim "todas as propriedades do config" passam a ser editáveis
**sem mexer em código/ENV**.

**UI:** formulário **"Sistema"** agrupado pelas seções do config — **App** (título/tutorial),
**Features** (flags `map_3d`/`imagens_panoramicas`/`grid`/`apisearch`), **Mapa 2D** (bounds,
min/maxZoom, maxPitch, globe, LOD), **Mapa 3D** (bounds + chrome do viewer Cesium), **Serviços/URLs**
(tiles, busca, terrain, glyphs, sv360…). Campos **tipados** (boolean=toggle, número, URL) + validação.

**Propagação:** `GET /config` já manda `Cache-Control: no-cache` → mudanças valem no **próximo fetch
de config** (boot). Prever aviso "recarregar para aplicar" (ou um sinal de invalidação).

**Esforço:** backend **Médio-Alto** (tabela de overrides + merge no `config.service` + endpoint admin
+ validação por seção) · frontend **Médio**.

### 9.3 Cadastrar 3D, 360, dados e análises (thumbnails + vídeos)
**Regra do usuário:** **thumbnail** para todos; **vídeo só para 3D**.

| Categoria | Armazenamento | As-is | Net-new |
|-----------|---------------|-------|---------|
| **3D** (tileset) | `resources` `category='tileset'`; **bytes** em `/api/v1/assets3d` | **config JSONB já tem `previewThumbnail` + `previewVideo`** (+ `url`, `heightOffset`, `keywords`, `locate`). CRUD de **metadados já funciona**. | **Upload dos bytes** do modelo (`tileset.json`/`.glb`) + **thumbnail/vídeo** — hoje os bytes são populados **fora de banda** (sem rota de upload admin). Storage de mídia + (opcional) rota de upload 3D. |
| **360** (panorama) | módulo `sv360` (schema próprio + SQLite por projeto) | **Rotas admin já existem:** `POST /admin/projects/upload` (multipart: manifest + SQLite + **thumbnail.webp**), `GET /admin/projects`, `PATCH …/status`, `DELETE …`. **Tem thumbnail; não tem vídeo** (coerente com a regra). | Wiring de UI + **métodos de cliente** (não existem). |
| **Dados** (data_layer) | `resources` `category='data_layer'` | CRUD existe; config = `source`/`sourceLayer`/`minzoom`/`maxzoom`/`style.border`. | UI + cliente; **validação por categoria** (hoje `config` é `Joi.object()` genérico). |
| **Análises** (analysis_layer) | `resources` `category='analysis_layer'` | CRUD existe; config = `source` (raster/raster-dem)/`bounds[4]`/`paint`. **`bounds` de 4 elementos é obrigatório** (senão a camada é descartada do payload). | UI + cliente; validar `bounds`. |

**UI:** uma versão **"gerência"** (escrita) do catálogo existente — reusa `catalog-card`/grid/filtros
já usados no modo *selectable* do `atlas-settings.modal.js` — com **formulários por categoria**:
upload de **thumbnail** (todas) e **vídeo** (só 3D), campos do `config` JSONB **tipados por
categoria**, preview.

**Atenção (storage de mídia):** definir **onde** thumbnails/vídeos enviados são guardados — módulo
`images`? `assets3d`? um media-store novo? Hoje os caminhos em `previewThumbnail`/`previewVideo`
apontam para assets servidos **fora de banda**; o upload pela UI precisa de um **destino real**.

**Esforço:** backend **Médio** (validação por categoria + storage/upload de mídia + opcional upload
de bytes 3D) · frontend **Alto** (formulários ricos + uploads + previews nas 4 categorias).

### 9.4 Editor de estilo dos basemaps (JSON MapLibre)
**As-is:** o **JSON de estilo** dos basemaps é **hardcoded** em `config.static.js`
(`buildBasemapStyles`); a linha `resources` do basemap guarda **só metadados** (enabled/thumbnail/
priority). Os `id`s do estilo estático são **casados** com os `id`s das linhas `resources`.

**Decisão (proposta):** mover o **estilo MapLibre** para o **`config` JSONB do recurso basemap**
(campo `style`); o `config.service.js` passa a **emitir `basemapStyles` a partir do DB** (fallback
para o estático em ids legados). Então o estilo vira editável.

**UI:** um **editor de JSON** por basemap (o usuário aceitou *"editor de JSON mesmo, pois é o padrão
do MapLibre"*): textarea/CodeMirror com **validação** (parse + checagens mínimas do style spec:
`version: 8`, `sources`, `layers`) **antes de salvar**, para não "brickar" o mapa. Opcional: botão de
preview.

**Esforço:** backend **Baixo-Médio** (relocar estilo p/ DB + emitir do DB) · frontend **Médio**
(editor JSON + validação + preview).

### 9.5 Invariantes e segurança (transversal)
- **Não confundir com entidades de sync.** `users`/`resources`/`config`/`sv360-admin` **não** são entidades
  colaborativas — por isso **rotas REST admin de escrita são legítimas** aqui (e várias **já
  existem**), diferente das entidades de feature/map/layer que viajam só por sync. **Não viola** o
  `ebgeo_backend/CLAUDE.md`.
- **Tudo gated `requireAdmin`** (admin global). Pré-requisito: **surfacing do `role` global** no
  cliente (§9.0).
- **Migrações aditivas + soft-delete** (já é o padrão de `users.is_active`, `resources.active`,
  `atlas.deleted_at`).
- **Auditoria:** o backend já grava `audit_trail` (ex. `USER_DELETE`); **estender** para
  create/update de recurso/config é desejável.

---

## 10. Resumo de decisões e esforço

| # | Frente | Decisão | Esforço | Toque backend |
|---|--------|---------|---------|---------------|
| 1 | Drive de atlas | Tela cheia só logado (P12 mantido); abas + busca + cards (thumbnail do atlas **descopado**) | **Médio** | Nenhum |
| 2 | Logout em branco | Já implementado; manter como invariante | **Nenhum** | Nenhum |
| 3 | URL por atlas | `?atlas=<uuid>&map=<id>` (UUID); branch de boot com precedências | **Médio** | Nenhum |
| 4 | Expiração | Idle timeout client-side (+ cap absoluto opcional no backend) | **Médio** | Opcional (etapa 2) |
| 5 | Share 3D/360 | Invariante; preservar precedência do hash no boot | **Baixo** (cuidado no boot) | Nenhum |
| 6 | Criação de conta + e-mail | "Criar conta" no login; conta pendente confirmada por e-mail (`username` segue a chave) | **Médio** (FE) / **Médio-Alto** (BE) | **Net-new**: coluna `email` + verificação + mailer/SMTP + endpoints; ligar `allowSelfRegistration` |
| 7 | Painel do admin | Tela cheia gated por **admin global**: usuários · config · catálogo 3D/360/dados/análises · estilos de basemap | **Alto** (4 frentes) | **Misto**: users/resources/sv360-admin **já existem**; net-new = overrides de config global, estilo de basemap em DB, upload de mídia/bytes 3D, surfacing do `role` global |

### Ordem de boot consolidada (contrato)
1. `#view=3d` / `#view=360` → viewer anônimo (precedência absoluta).
2. `?verify=<token>` → confirma e-mail (Frente 6); mostra resultado e segue para login.
3. `?atlasPublico=<link>` → público anônimo.
4. `?atlas=<uuid>[&map=<id>]` → logado+acesso conecta; senão login pendente / erro.
5. Logado, sem o acima → tela cheia de seleção (Drive).
6. Anônimo, sem o acima → mapa local (P12).

---

## 11. Benchmark open-source e ideias adicionais

Pesquisa de aplicações open-source com problemas parecidos (WebGIS, editores de mapa colaborativos,
sync offline-first). O objetivo é roubar padrões já validados e evitar reinventar.

### 11.1 Projetos analisados

| Projeto | O que é | Por que importa pro EBGeo | Padrões a roubar |
|---------|---------|---------------------------|------------------|
| **MapStore2** (GeoSolutions, GPL) | WebGIS modular; *homepage* de recursos (mapas, dashboards, geostories) | Análogo mais direto da **Frente 1** (Drive). Homepage = grid de cards | Grid de cards ⇄ lista; seções **Featured** + **Contents**; ordenação (recente / A-Z); painel de filtros; **favoritos** (só logado); por card: thumbnail, propriedades, menu de share, excluir; flags **Advertised** (visível a não-donos) e **Featured**; permissões View/Edit por grupo/usuário |
| **Mergin Maps** / **QFieldCloud** (MIT/AGPL) | Coleta de campo QGIS + nuvem; sync offline-first com merge automático | Análogo do **store/sync** do EBGeo | Conceito de **Workspace** (org/usuário) para agrupar projetos; **status de sync explícito** por projeto ("sincronizado" vs "alterações pendentes"); clonar projeto p/ trabalhar offline e sincronizar de volta = nosso connect/pull/flush |
| **TerriaJS** (Apache-2.0) | Explorador geoespacial 2D/3D sobre **Cesium** (mesmo motor 3D do EBGeo) | Análogo do **3D** e da **Frente 3** (URL) | **Share = serializa o estado** (câmera + camadas ativas + view) em URL com **encurtamento**; `#start=`/`share=` restauram no load; catálogo aninhado de milhares de camadas |
| **Placemark** (open-sourced, "Figma for maps") | Editor web de GeoJSON com pegada Figma | Referência de **UX** alinhada ao norte "Docs de mapas" | Edição teclado-first / acessível; autosave persistente; share com níveis de permissão; framing "Figma/Docs de X" |

### 11.2 Como isso reforça as decisões já tomadas

- **Frente 1 — thumbnail:** o MapStore, sendo maduro, **não auto-captura** — usa **upload manual**
  (300×180, ≤500KB, JPG/PNG). Isso valida uma estratégia **híbrida**: auto-snapshot do canvas MapLibre
  como *default* + permitir **substituir por upload**. Menos pressão para o snapshot ficar perfeito.
- **Frente 1 — abas:** as seções Featured/Contents + filtros + favoritos do MapStore confirmam que as
  4 abas propostas (Meus / Compartilhados / Públicos / Recentes) são o piso, não o teto.
- **Frente 3 — URL:** o TerriaJS mostra que dá para ir além de `?atlas=&map=` e serializar **a view**
  (câmera + camadas) num link encurtado — convergindo com o share 3D/360 que já temos por hash.
- **Sync UX:** Mergin/QFieldCloud mostram o valor de um **indicador de status de sync explícito** por
  atlas — encaixa com a luz de conexão já existente (`account/sync-status.control.js`).

### 11.3 Ideias próprias (a debater)

Aproveitando que vários só custam UI porque o backend **já suporta**:

1. **Lixeira / Restaurar** — o backend já faz **soft-delete** (`deleted_at`). Uma aba "Lixeira" no Drive
   com restauração em N dias é quase de graça e muito "Google Docs". *(Aditivo no frontend; backend já
   tem o dado.)*
2. **Presença no card do Drive** — já temos `presence/` (roster + cursores). Mostrar avatares de quem
   está **editando agora** direto no card ("2 pessoas online") é puro Google Docs e reusa o que existe.
3. **Recentes por usuário** — `last_opened_at` por (usuário, atlas) para alimentar a aba "Recentes" e a
   ordenação. *(Migração aditiva mínima no backend.)*
4. **Duplicar atlas ("Fazer uma cópia")** — ação clássica de Drive; vira um novo atlas server-side.
5. **Transferir propriedade** — o backend já reatribui dono (`?transferTo`); expor na UI de
   compartilhamento.
6. **Idle timeout com aviso (Frente 4)** — em vez de derrubar seco, modal "você será desconectado por
   inatividade em 1 min — Continuar conectado?" (padrão bancário/Google). Melhor percepção.
7. **Renomear inline no card** + **menu de contexto** (botão direito): renomear, compartilhar,
   duplicar, mover p/ lixeira — como no Drive.
8. **Título-documento na barra superior** — nome do atlas clicável p/ renomear (feedback de "onde
   estou"), como o título no topo do Google Docs.

> Nota: itens que tocam o backend devem respeitar as invariantes do `ebgeo_backend/CLAUDE.md` —
> migrações **aditivas**, **sem rotas REST de escrita** para entidades colaborativas (viajam por sync),
> **soft-delete sempre**. Lixeira, recentes e thumbnail cabem como **metadado de atlas**, não como
> entidade de sync.

### 11.4 Fontes

- MapStore2 — <https://github.com/geosolutions-it/MapStore2> · docs: <https://docs.mapstore.geosolutionsgroup.com/>
- Mergin Maps — <https://merginmaps.com/> · QFieldCloud — <https://qfield.cloud/>
- TerriaJS — <https://github.com/TerriaJS/terriajs> · <https://terria.io/>
- Placemark — <https://github.com/placemark/placemark>

---

## 12. Frente 8 — Modos viewer/editor e share colaborativo (padrões Felt)

> Origem: análise comparativa com o Felt ("Figma/Google Docs de mapas"; ver §11) e com a arquitetura
> de sync ([`arquitetura-sync.md`](./arquitetura-sync.md)). Quatro padrões hoje **greenfield** no
> EBGeo que reforçam o norte "Docs de mapas". **Pré-requisito comum:** expor o `role` global no
> cliente (a mesma lacuna da §9.0); o papel **por atlas** já é guardado (`session-context.setSession`).

### 12.1 Modo "edição" vs "visualização segura" (NORMAL)
**As-is:** o modo `NORMAL` é **sempre editável** — só o briefing tem perfis read-only
(`ui/ui-visibility.controller.js` `VisibilityProfile`/`PROFILES`). As toolbars **não reagem ao
papel**; o papel só barra na camada de store-op (`store/sync/permission-guard.js` `checkPermission`),
e o aviso é **errado**: todo `STORE_OPERATION_BLOCKED` mostra *"Mapa bloqueado. Desbloqueie para
editar."* (`store-error-listener.js`), inclusive para um Visualizador — que deveria ver "acesso
somente leitura". O único read-only de hoje é o lock de mapa (`locking/map-lock.controller.isReadOnly`),
estreito (padlock / nome / botão temporal).

> **Decisão (proposta):** um perfil de visibilidade `NORMAL_VIEW` (novo, via
> `ui-visibility.controller.defineProfile`) que esconde as toolbars de desenho/militar/análise e as
> affordances de edição, **aplicado automaticamente** quando o `permission-guard` indica sem-edição
> (Visualizador/Comentarista em atlas remoto), com **toggle manual** "Editar mapa" (à la *Shift+E* do
> Felt) para quem PODE editar alternar para um modo de leitura seguro. Não precisa de um novo
> `ApplicationMode`: basta o perfil + um driver assinando `SESSION_CHANGED`/`CONNECTION_STATE_CHANGED`.

- **Corrigir junto:** diferenciar o toast de `STORE_OPERATION_BLOCKED` por motivo (lock vs. permissão
  insuficiente) — o motivo já vem do `permission-guard` e é descartado hoje.
- **Esforço:** frontend **Médio** · backend **Nenhum**.

### 12.2 Legenda (viewer) vs Lista (editor)
**As-is:** existe só a **Lista/árvore** de edição (`features_tab/`), com add/lock/visibilidade/drag.
Não há "Legenda" read-only nem aba dedicada (`sidebar/sidebar.constants.js`).

> **Decisão (proposta):** uma superfície **Legenda** read-only (re-skin apresentacional lendo o mesmo
> `features_tab/feature-organizer.service.js`, sem controles de edição), exibida automaticamente sob o
> perfil `NORMAL_VIEW` (§12.1). É re-skin, não nova plumbing de dados.

- **Esforço:** frontend **Médio** · backend **Nenhum**.

### 12.3 Diálogo de compartilhamento estilo Google Docs
**As-is (`modals/sharing.modal.js`):** já tem convite por usuário (`searchUsers`), papéis por usuário
(Leitura/Comentário/Edição/Gestão), toggle de link público e transferência de dono. **Lacunas vs.
Google Docs:**
- **Link é só leitura** — sem link de *comentário*/*edição* (link-com-papel).
- **Sem "acesso geral"** (papel padrão do atlas / "qualquer um da organização").
- **A lista "Membros" é a config persistida, não quem está online** — a presença viva existe separada
  (`presence/online-users.control.js`) e **não** aparece no diálogo.

> **Decisão (proposta):** estender o `sharing.modal.js` com (a) **seletor de papel no link público**,
> (b) seção **"Acesso geral"** com papel padrão, e (c) linha **"vendo agora"** alimentada pelo
> `presenceStore` (merge de "quem tem acesso" com "quem está online") — o dado já existe, só está
> desacoplado.

- **Esforço:** frontend **Médio** · backend **Baixo** (link-com-papel exige o token público carregar o papel).

### 12.4 "Permissão padrão abaixa, nunca eleva"
**As-is:** **não existe** papel-padrão do atlas; cada share é grant absoluto (default de convite =
`write`). Não há baseline para fazer *clamp*.

> **Decisão (proposta):** metadado `defaultRole` / "acesso geral" por atlas (em `atlas.settings`,
> mesmo overlay da §9.0) + **clamp** em `sharing.modal` (add/update) e no `permission-guard`: um share
> nunca excede o papel padrão sem grant explícito. Espelha o *"project default permission lowers,
> never raises"* do Felt.

- **Esforço:** frontend **Baixo-Médio** · backend **Baixo** (campo em `atlas.settings` + validação).

### 12.5 Resumo
| # | Padrão Felt | Decisão | Esforço FE/BE |
|---|---|---|---|
| 12.1 | Edição ↔ visualização segura | Perfil `NORMAL_VIEW` + driver por sessão/conexão + toggle; corrigir toast de bloqueio | Médio / — |
| 12.2 | Legenda (viewer) vs Lista (editor) | Re-skin read-only do `features_tab` sob o perfil view | Médio / — |
| 12.3 | Share estilo Google Docs | Link-com-papel + acesso geral + "vendo agora" (`presenceStore`) | Médio / Baixo |
| 12.4 | Permissão padrão abaixa, nunca eleva | `defaultRole` por atlas + clamp no share/guard | Baixo-Médio / Baixo |

> Pré-requisito transversal das quatro: **surfacing do `role` global** (§9.0) e uso do papel por-atlas
> já guardado no `sessionContext`.

---