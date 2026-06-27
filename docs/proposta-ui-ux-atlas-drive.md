# Proposta: EBGeo — Redesenho de UI/UX no modelo "Google Docs de mapas"

> Status: **PROPOSTA / EM DISCUSSÃO** — nada implementado. Este documento registra o
> diagnóstico do estado atual, as decisões de design já tomadas e o escopo de trabalho por frente.
> Escopo: `ebgeo_web` (frontend) + pontos de toque em `ebgeo_backend` (auth, metadado de atlas).
>
> Documentos relacionados: [`visao-e-principios.md`](./visao-e-principios.md) (princípios; **P12**),
> [`acoes-interface-multiusuario.md`](./acoes-interface-multiusuario.md),
> arquitetura do cliente em [`.claude/rules/architecture.md`](../.claude/rules/architecture.md) (§Sync).

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
| Share 3D/360 offline | Via **hash auto-contido** (`#view=3d&tileset=…` / `#view=360&photo=…`), referenciando `tilesetId`/`photoName` do config. **Fora do sync/CRDT** (emit-only). Funciona anônimo. | `deep-link/deep-link.js`, `3d_models_viewer_tool/`, `street_view_tool/` |

---

## 3. Frente 1 — Tela cheia de seleção de atlas ("Drive")

### Objetivo
Substituir o modal por uma **tela cheia** estilo Google Drive, exibida ao entrar logado e acessível
a qualquer momento. Recursos: abas/filtros (**Meus** / **Compartilhados comigo** / **Públicos** /
**Recentes**), **busca por nome**, e **thumbnail** por atlas.

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
- Pipeline de thumbnail (captura + persistência + exibição). **Maior item de esforço.**

### Toque no backend
- Campo de metadado do atlas para o thumbnail (blob ou referência). Migração **aditiva**
  (`ADD COLUMN`). Sem rota de escrita nova de entidade colaborativa — thumbnail é metadado de atlas,
  não entidade CRDT.

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
sync/CRDT** (emit-only / totalmente fora do atlas). Funciona anônimo/offline.

### Risco no redesenho e mitigação
O **único** risco é o novo boot (login forçado, `?atlas=`) **sequestrar** o caminho do hash. A regra,
já fixada na Frente 2 (item 1 do boot):

> Se há `#view=3d` / `#view=360`, **abre o viewer como anônimo**, com **precedência** sobre
> login/seleção/`?atlas=`. Nunca empurrar um deep-link de viewer para a tela de login ou Drive.

Com esse branch preservado, a Frente 5 permanece **intacta** — é uma garantia, não uma mudança.

---

## 8. Resumo de decisões e esforço

| # | Frente | Decisão | Esforço | Toque backend |
|---|--------|---------|---------|---------------|
| 1 | Drive de atlas | Tela cheia só logado (P12 mantido); abas + busca + thumbnail | **Alto** (thumbnail) | Aditivo (metadado de thumbnail) |
| 2 | Logout em branco | Já implementado; manter como invariante | **Nenhum** | Nenhum |
| 3 | URL por atlas | `?atlas=<uuid>&map=<id>` (UUID); branch de boot com precedências | **Médio** | Nenhum |
| 4 | Expiração | Idle timeout client-side (+ cap absoluto opcional no backend) | **Médio** | Opcional (etapa 2) |
| 5 | Share 3D/360 | Invariante; preservar precedência do hash no boot | **Baixo** (cuidado no boot) | Nenhum |

### Ordem de boot consolidada (contrato)
1. `#view=3d` / `#view=360` → viewer anônimo (precedência absoluta).
2. `?atlasPublico=<link>` → público anônimo.
3. `?atlas=<uuid>[&map=<id>]` → logado+acesso conecta; senão login pendente / erro.
4. Logado, sem o acima → tela cheia de seleção (Drive).
5. Anônimo, sem o acima → mapa local (P12).

---

## 9. Benchmark open-source e ideias adicionais

Pesquisa de aplicações open-source com problemas parecidos (WebGIS, editores de mapa colaborativos,
sync offline-first). O objetivo é roubar padrões já validados e evitar reinventar.

### 9.1 Projetos analisados

| Projeto | O que é | Por que importa pro EBGeo | Padrões a roubar |
|---------|---------|---------------------------|------------------|
| **MapStore2** (GeoSolutions, GPL) | WebGIS modular; *homepage* de recursos (mapas, dashboards, geostories) | Análogo mais direto da **Frente 1** (Drive). Homepage = grid de cards | Grid de cards ⇄ lista; seções **Featured** + **Contents**; ordenação (recente / A-Z); painel de filtros; **favoritos** (só logado); por card: thumbnail, propriedades, menu de share, excluir; flags **Advertised** (visível a não-donos) e **Featured**; permissões View/Edit por grupo/usuário |
| **Mergin Maps** / **QFieldCloud** (MIT/AGPL) | Coleta de campo QGIS + nuvem; sync offline-first com merge automático | Análogo do **store/sync** do EBGeo | Conceito de **Workspace** (org/usuário) para agrupar projetos; **status de sync explícito** por projeto ("sincronizado" vs "alterações pendentes"); clonar projeto p/ trabalhar offline e sincronizar de volta = nosso connect/pull/flush |
| **TerriaJS** (Apache-2.0) | Explorador geoespacial 2D/3D sobre **Cesium** (mesmo motor 3D do EBGeo) | Análogo do **3D** e da **Frente 3** (URL) | **Share = serializa o estado** (câmera + camadas ativas + view) em URL com **encurtamento**; `#start=`/`share=` restauram no load; catálogo aninhado de milhares de camadas |
| **Placemark** (open-sourced, "Figma for maps") | Editor web de GeoJSON com pegada Figma | Referência de **UX** alinhada ao norte "Docs de mapas" | Edição teclado-first / acessível; autosave persistente; share com níveis de permissão; framing "Figma/Docs de X" |

### 9.2 Como isso reforça as decisões já tomadas

- **Frente 1 — thumbnail:** o MapStore, sendo maduro, **não auto-captura** — usa **upload manual**
  (300×180, ≤500KB, JPG/PNG). Isso valida uma estratégia **híbrida**: auto-snapshot do canvas MapLibre
  como *default* + permitir **substituir por upload**. Menos pressão para o snapshot ficar perfeito.
- **Frente 1 — abas:** as seções Featured/Contents + filtros + favoritos do MapStore confirmam que as
  4 abas propostas (Meus / Compartilhados / Públicos / Recentes) são o piso, não o teto.
- **Frente 3 — URL:** o TerriaJS mostra que dá para ir além de `?atlas=&map=` e serializar **a view**
  (câmera + camadas) num link encurtado — convergindo com o share 3D/360 que já temos por hash.
- **Sync UX:** Mergin/QFieldCloud mostram o valor de um **indicador de status de sync explícito** por
  atlas — encaixa com a luz de conexão já existente (`account/sync-status.control.js`).

### 9.3 Ideias próprias (a debater)

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
> entidade CRDT.

### 9.4 Fontes

- MapStore2 — <https://github.com/geosolutions-it/MapStore2> · docs: <https://docs.mapstore.geosolutionsgroup.com/>
- Mergin Maps — <https://merginmaps.com/> · QFieldCloud — <https://qfield.cloud/>
- TerriaJS — <https://github.com/TerriaJS/terriajs> · <https://terria.io/>
- Placemark — <https://github.com/placemark/placemark>

---