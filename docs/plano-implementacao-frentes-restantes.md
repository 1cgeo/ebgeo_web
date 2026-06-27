# Plano de Implementação — Frentes restantes + Redesenho do Painel Admin

> Status: **PLANO** — define escopo, fases, arquivos-tocados, toque no backend, testes e esforço
> para concluir o `proposta-ui-ux-atlas-drive.md`. Já implementado nesta linha de trabalho: **Frente 2**
> (logout limpa o ambiente — bug de regressão corrigido), **Frente 5** (share 3D/360 — invariante
> preservada), **Frente 6** (signup + e-mail) e **Frente 7** (painel admin, funcional). Falta: **Frente 1**
> (Drive), **Frente 3** (URL por atlas), **Frente 4** (idle timeout), **Frente 8** (padrões Felt), o
> **upload de mídia da §9.3** (desvio aceito) e o **redesenho de UI/UX do painel admin**.

## Invariantes a respeitar (todas as fases)

- **P12** — local = 1 workspace (`Principal` + `.ebgeo`); a tela cheia de atlas é feature **só logado**.
- **Offline/anônimo idêntico** — nada quebra o caminho sem login; o hash `#view=3d/360` tem precedência absoluta no boot.
- **Sync** — `users`/`resources`/`config`/`sv360-admin`/metadado de atlas **não** são entidades de sync → rotas REST admin de escrita são legítimas. Entidades de feature/map/layer viajam **só por sync**.
- **Migrações aditivas + soft-delete**; dev sempre **fresh DB** (editar SQL in-place).
- **Pré-requisito da Frente 8 já resolvido:** o `role` global está exposto no cliente (`sessionContext.globalRole`/`isAdmin()`), implementado na Frente 7.
- **Cada operação ganha teste** (unit para lógica pura; e2e Playwright para fluxo). UI verificada por screenshot-then-read (memória do projeto).

---

## Ordem recomendada e esforço

| Fase | Conteúdo | Esforço | Por que nessa ordem |
|------|----------|---------|---------------------|
| **A** | Frente 3 (URL por atlas) + Frente 4 (idle timeout + handler de 401) | **Médio** | Quick wins de fundação; destravam deep-link/F5 e a percepção de sessão. Baixo risco. |
| **B** | **Redesenho do painel admin** + upload de mídia §9.3 | **Alto** | Pedido explícito ("está muito feio"); a §9.3 (forms tipados + upload) cai naturalmente na aba Catálogo redesenhada. |
| **C** | Frente 1 (Drive de atlas — tela cheia) | **Alto** | Maior valor de UX; reusa a casca tela-cheia/cards consolidada na Fase B. |
| **D** | Frente 8 (modos viewer/editor + share Google Docs) | **Médio** | Fecha o norte "Docs de mapas"; pré-req já pronto. |

> A Fase B pode ir **primeiro** se a prioridade for o painel admin. As Fases A/C/D são independentes entre si (salvo C reusar componentes da B).

---

# Fase A — Fundação

## A1. Frente 3 — URL por atlas (`?atlas=<uuid>&map=<id>`)

**Objetivo:** a URL passa a ser a fonte de verdade do que abrir; `store-origin` vira guarda de consistência (não roteador).

**Contrato de boot (ordem do §10 da proposta):**
1. `#view=3d` / `#view=360` → viewer anônimo (**precedência absoluta**).
2. `?verify=<token>` → confirmação de e-mail (Frente 6).
3. `?atlasPublico=<link>` → público anônimo (já existe).
4. `?atlas=<uuid>[&map=<id>]` → logado+acesso conecta; sem login → login pendente; sem acesso/inexistente → erro 404 vs 403 (sem vazar existência).
5. Logado, sem o acima → Drive (Frente 1) ou, hoje, picker.
6. Anônimo, sem o acima → mapa local.

**Frontend:**
- Novo roteador de boot em `index.js` (ou `deep-link/atlas-link.js` novo) que lê `URLSearchParams`, decide o branch e resolve precedências.
- `?map=<id>` = **UUID** (estável); resolver para nome via `store/services/map-resolver.service.js`.
- Ao abrir/trocar atlas ou mapa → `history.pushState` (sem reload); ouvir `MAP_CREATED/MODIFIED`/troca de mapa e `connect`/`disconnect` para reescrever a URL.
- "Atlas pendente": ao cair sem login com `?atlas=`, guardar e retomar no pós-login (`account.control` openProjectPicker/connect).
- Integra com o fix de F5 desta sessão (`reconnectLastAtlas` → `activateAtlasInitialMap`): a URL, quando presente, **substitui** o reconnect por store-origin.

**Backend:** nenhum novo — `getAtlas`/checagem de acesso existem. Garantir 404 (inexistente) vs 403 (sem permissão) sem vazar.

**Testes:**
- e2e: deep-link `?atlas=` logado → conecta no mapa certo; `?atlas=&map=<uuid>` → mapa específico ativo; sem login → login → retoma; atlas inexistente → erro claro; F5 com `?atlas=` mantém.
- unit: parser de boot (precedências) puro/testável.

**Esforço:** FE **Médio** · BE **Nenhum**.

## A2. Frente 4 — Idle timeout + handler global de 401

**Objetivo:** sessão não fica "logada pra sempre"; expira por **inatividade** com aviso, e o 401 mid-session cai para anônimo de forma limpa.

**Frontend:**
- Módulo novo `session/idle-timeout.controller.js`:
  - detector de inatividade (mouse/teclado/edição; debounce de reset) com timer configurável **N** (default **30 min**; ler de config/feature flag).
  - aos N−1 min: **modal de aviso** "Você será desconectado por inatividade em 1 min — Continuar conectado?" (padrão bancário/Google, §11.3.6). Sem resposta → `logoutAndDisconnect()` + UX "sua sessão expirou, entre novamente".
  - só ativo quando **logado** (no-op anônimo); teardown no logout.
- **Handler global de auth perdida:** quando o refresh final falhar (`api-client.refresh` → 401), emitir um evento de sessão perdida; um listener faz teardown (presença/socket/auto-flush) e abre o modal de login — em vez de falhar em silêncio.

**Backend (etapa 2, opcional):** cap absoluto na família de refresh (`family_issued_at` + recusar rotação além do limite) — migração aditiva + **teste de regressão de auth obrigatório**. Pode ficar para depois; o idle client-side já entrega o requisito.

**Testes:**
- unit: a máquina do idle timer (pura — agendar/reset/expirar) com tempo injetável.
- e2e: inatividade → aviso → "Continuar" reinicia; sem resposta → logout + login modal + ambiente limpo (reusa asserts do teste de logout). 401 simulado → cai para anônimo limpo.

**Esforço:** FE **Médio** · BE **Opcional/Baixo** (etapa 2).

---

# Fase B — Redesenho do Painel do Administrador (+ §9.3 mídia)

## B0. Diagnóstico do que está feio (as-is)

A funcionalidade existe (Frente 7), mas a apresentação é crua:
- **Sem hierarquia/escala:** corpo é um scroll plano; um `<table>` simples **ou** um form de `max-width:480px` flutuando num corpo enorme e vazio.
- **Navegação fraca:** abas-sublinhado finas no topo — não escalam para 4–6 seções nem comunicam "onde estou".
- **Edição destrutiva de contexto:** os forms inline **substituem o corpo inteiro** (some a lista). Jarring.
- **Tabela sem affordance:** sem avatar, sem hover claro, sem menu de ações, sem densidade.
- **Catálogo:** pílulas de nav + (hoje) edição por **JSON cru** — sem grid de cards com thumbnail/preview nem forms tipados.
- **Config:** um form largo e longo, sem agrupamento em cards/âncoras nem barra de salvar fixa.
- **Faltam:** estados vazios, skeleton de carregamento, toasts de sucesso integrados, responsividade.

## B1. Direção visual (recomendada)

**App-shell de administração:** top bar enxuta + **rail de navegação à esquerda** + área de conteúdo com container de largura máxima, **section header** (título + ação primária) e conteúdo em **cards/painéis**. Edição em **drawer lateral** (a lista permanece visível), não troca de corpo.

```
┌─────────────────────────────────────────────────────────────────────┐
│  EBGeo · Administração          [ambiente: dev]         diniz   ✕    │  top bar
├───────────────┬─────────────────────────────────────────────────────┤
│ ◧ Usuários    │  Usuários                              [ + Novo ]    │  section header
│ ⚙ Sistema     │  ┌───────────────────────────────────────────────┐  │
│ ▦ Catálogo    │  │ 🔎 Buscar usuário…        [ Ativos ▾ ]         │  │  toolbar
│ ◳ Basemaps    │  ├───────────────────────────────────────────────┤  │
│               │  │  (MF) Marcel Fragoso   Editor   ● Ativo     ⋯  │  │  linhas com avatar,
│               │  │  (DI) Diniz            Admin    ● Ativo     ⋯  │  │  chip de papel, status
│               │  │  (JS) João Silva       Visual.  ○ Inativo   ⋯  │  │
│  ───────────  │  └───────────────────────────────────────────────┘  │
│  ↩ Sair       │                                    ┌─ drawer edição ┐│  drawer desliza
└───────────────┴────────────────────────────────────┴────────────────┘
```

**Princípios:**
- 100% **design tokens** (cores/spacing/radius/shadow/transition já existem); cards com `--shadow-sm`/`--radius-lg`.
- Reusar componentes existentes: `ConfirmModal`/`PromptModal`, `showToast`, `catalog-card`, avatar com cor estável (mesma `getPresenceColor`/iniciais).
- Estados: **vazio** (ilustração + CTA), **carregando** (skeleton), **erro** (inline). Sucesso → `showToast`.
- Acessibilidade: `role=tablist`/`tab`, foco visível, Esc fecha drawer (não o painel) — já há guarda de Esc no shell.
- Sem inline styles (BEM em `admin.css`); strings pt-BR; comentários em inglês.

## B2. Casca (`admin-panel.js` + `admin.css`)

- Trocar **abas-topo** por **rail à esquerda** (ícone + label, item ativo destacado) — manter a API de `AdminTab { id, label, testid, mount }` (só muda a renderização da nav).
- Top bar: título + badge de ambiente (opcional) + identidade do admin + fechar.
- Container de conteúdo com `max-width` e `section header` padronizado (componente helper `admin-section-header`).
- Novo helper `admin/admin-dom.js`: builders compartilhados (card, section-header, drawer, toolbar, empty-state, skeleton) — **dedupe** dos 3 tabs (item de review adiado anteriormente).
- Novo `admin/admin-drawer.js`: drawer lateral reutilizável (abre/fecha, foco, Esc, overlay) para todos os forms de edição.

## B3. Aba **Usuários** (`users-tab.js`)

- **Data-table** com: avatar (iniciais + cor estável), nome + `@username`, chip de papel (Admin/Editor/…), badge de status (Ativo/Inativo/**Pendente** e-mail), último login.
- **Toolbar:** busca (debounce — já existe, manter o timer rastreado no cleanup), filtro Ativos/Inativos/Pendentes, botão **Novo usuário**.
- Ações por linha num menu **⋯** (editar, redefinir senha, ativar/desativar, transferir propriedade) — manter os guardas já existentes (auto-desativação/rebaixamento bloqueados; `transferTo` quando dono).
- Criar/editar em **drawer** (não troca de corpo). Mapeia 1:1 os campos de `users` (+ `email`/`email_verified`).
- Confirmações destrutivas via `ConfirmModal`; sucesso via `showToast`.

**Backend:** já completo (`/api/v1/users` admin). Opcional: estender `updateUserAdminSchema` para `org_role`/`organization_id` se quiser editá-los pela UI.

## B4. Aba **Sistema (config)** (`config-tab.js`)

- Conteúdo em **cards por seção**: App, Features (toggles), Mapa 2D (bounds/zoom/pitch/globe/LOD), Mapa 3D, Serviços/URLs.
- **Âncora/sub-nav** lateral interna (sticky) para saltar entre seções.
- Campos **tipados** (toggle/número/URL) com validação inline; **"Avançado (JSON)"** colapsável por seção (mantém o que já existe).
- **Barra de salvar fixa** no rodapé: Salvar · Descartar · **Limpar overrides** (DELETE já implementado).
- Aviso honesto "recarregar para aplicar" (config vale no próximo boot).

**Backend:** já implementado (overrides em `config_settings` + merge + endpoints admin). Sem mudança.

## B5. Aba **Catálogo** (`catalog-tab.js`) — **inclui §9.3 (mídia)**

- **Grid de cards** com thumbnail/preview, filtro por categoria (3D/360/Dados/Análises) em chips, status e busca — reusa `catalog-card`/grid do modo *selectable* do `atlas-settings.modal.js`.
- Criar/editar em **drawer** com **forms tipados por categoria** (substitui o JSON cru como caminho padrão; JSON vira "Avançado"):
  - **3D:** `url`, `heightOffset`, `keywords`, `locate` + **thumbnail** + **vídeo**.
  - **360:** wiring das rotas admin já existentes (`/admin/projects` upload/status/delete) + thumbnail.
  - **Dados:** `source`/`sourceLayer`/`minzoom`/`maxzoom`/`style.border` + **thumbnail**.
  - **Análises:** `source`/`bounds[4]`/`paint` (validar `bounds` obrigatório) + **thumbnail**.
- **§9.3 — upload de mídia (desvio a fechar):**
  - **Decisão de storage** (ver Decisões em aberto): reusar módulo `images` **ou** um media-store novo; thumbnail (todas) + vídeo (só 3D); bytes do tileset 3D opcional.
  - Métodos de cliente net-new no `api-client.js` (upload de mídia + admin sv360).
- **Validação por categoria** no backend (hoje `config` é `Joi.object()` genérico).

**Esforço B (total):** FE **Alto** · BE **Médio** (validação por categoria + storage/upload de mídia).

**Testes Fase B:**
- e2e por aba: criar/editar usuário no drawer (lista permanece); salvar config + limpar overrides; criar recurso de catálogo com upload de thumbnail/vídeo; editor de basemap valida JSON inválido.
- unit: validadores por categoria (bounds, style spec) — puros.
- screenshot-then-read de cada aba redesenhada (memória do projeto).

## B6. Aba **Basemaps & Estilos** (§9.4 — refinar)

- Lista de basemaps + **editor JSON** focado por basemap (textarea/CodeMirror) com validação `validateMapLibreStyle` (já existe) **antes de salvar** + feedback inline; botão de preview opcional.
- (Já há base implementada na Frente 7 — aqui é polimento visual + preview.)

---

# Fase C — Frente 1: Drive de atlas (tela cheia)

**Objetivo:** substituir o `project-picker.modal.js` por uma **tela cheia** estilo Drive — reusa a casca/cards/drawer da Fase B.

**C1 — Núcleo (tela cheia + abas + busca + abrir) — ✅ FEITO:**
- Componente tela cheia (`AtlasDrive`), preservando os testids do picker.
- Abas/filtros client-side sobre `apiClient.listAtlas()`: **Recentes / Meus / Compartilhados comigo / Públicos**.
- Busca por nome (client-side; lista pequena).
- Pipeline de seleção reaproveitado integralmente (`onPick` → `clearAllDataStore` → `markStoreRemote` → `connect` → `activateAtlasInitialMap` → `startAutoFlush`).
- Cada card tem uma faixa colorida com iniciais (identificador visual por cor, NÃO um snapshot do mapa).

> **C2 — Thumbnail do atlas: DESCOPADO** (a pedido do usuário). Não haverá snapshot/upload de miniatura do mapa por atlas; os cards usam a faixa colorida com iniciais como identificador. (O upload de thumbnail do **catálogo** na §9.3 é outra coisa e permanece.)

**C3 — Ações de card (Drive-like) — ✅ FEITO (núcleo):**
- Menu ⋯ por card: **Renomear** (`PUT /atlas/:id`), **Fazer uma cópia** (`POST /atlas/:id/clone`), **Mover para lixeira** (`DELETE` soft-delete) — todos reusam endpoints já existentes; gated por papel.
- **Restante de C3 (a fazer):** **restaurar da lixeira** (precisa endpoint `restore` no backend + aba "Lixeira"); **Recentes** real via `last_opened_at` (hoje ordena por `updated_at`); **"vendo agora"** (avatares do `presenceStore`); **Compartilhar** direto do card (abre `sharing.modal`).

**Esforço restante:** FE/BE **Baixo-Médio** (endpoint de restore + coluna `last_opened_at` aditivos).

---

# Fase D — Frente 8: modos viewer/editor + share colaborativo (Felt)

> Pré-requisito (`role` global no cliente) **já resolvido**. Papel por atlas já no `sessionContext`.

**D1 — Modo "edição" vs "visualização segura" (§12.1):**
- Perfil `NORMAL_VIEW` via `ui-visibility.controller.defineProfile` (esconde toolbars de desenho/militar/análise + affordances de edição).
- Driver assinando `SESSION_CHANGED`/`CONNECTION_STATE_CHANGED`: aplica automático para Visualizador/Comentarista em atlas remoto; **toggle manual "Editar mapa"** (Shift+E) para quem pode editar.
- **Corrigir junto:** o toast de `STORE_OPERATION_BLOCKED` diferenciar **lock** vs **permissão insuficiente** (o motivo já vem do `permission-guard` e hoje é descartado em `store-error-listener.js`).

**D2 — Legenda (viewer) vs Lista (editor) (§12.2):**
- Superfície **Legenda** read-only (re-skin de `features_tab/feature-organizer.service.js`, sem controles), exibida sob `NORMAL_VIEW`. Re-skin, não nova plumbing.

**D3 — Share estilo Google Docs (§12.3):**
- Estender `modals/sharing.modal.js`: (a) **seletor de papel no link público** (link-com-papel), (b) **"Acesso geral"** (papel padrão), (c) linha **"vendo agora"** do `presenceStore` (merge acesso×online).
- Backend **Baixo**: token público carregar o papel.

**D4 — "Permissão padrão abaixa, nunca eleva" (§12.4):**
- `defaultRole`/"acesso geral" por atlas em `atlas.settings` (mesmo overlay) + **clamp** no `sharing.modal` (add/update) e no `permission-guard`.
- Backend **Baixo**: campo em `atlas.settings` + validação.

**Testes:** e2e (viewer cai em NORMAL_VIEW + Legenda; editor alterna com Shift+E; toast correto por motivo; link-com-papel concede papel certo; clamp impede exceder o default). unit do clamp (puro).

**Esforço:** FE **Médio** · BE **Baixo**.

---

## Decisões em aberto (recomendações)

1. **Storage de mídia (§9.3)** — *Recomendo* reusar o módulo `images` (já há blob store + sync) para thumbnails/vídeos do catálogo, evitando um media-store novo; bytes de tileset 3D ficam fora de banda (como hoje) até haver demanda.
2. **N do idle timeout** — *Recomendo* **30 min** com aviso a 1 min, configurável via `config.features`.
3. **Cap absoluto de refresh no backend (A2 etapa 2)** — *Recomendo* adiar; o idle client-side entrega o requisito; agendar como hardening posterior.
4. **Ordem** — *Recomendo* A → B → C → D; mas se o painel admin é a dor imediata, **B primeiro**.
5. **Drive vs picker** — manter o `project-picker.modal.js` funcionando até o Drive (C1) estar verde, e então trocar a casca.

## Atualização de documentação (rápida, fora de fase)

- Corrigir o cabeçalho do `proposta-ui-ux-atlas-drive.md` ("nada implementado" → status por frente) e remover o aviso "⚠️ Bug reportado (a investigar)" da Frente 2 (resolvido com teste de regressão).
