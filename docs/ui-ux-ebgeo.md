# EBGeo — UI/UX (como construída)

> Documento de referência **da interface como ela é hoje** — o "como" e o "onde" de cada superfície,
> não um plano. Consolida e substitui `proposta-ui-ux-atlas-drive.md`, `plano-implementacao-frentes-restantes.md`
> e `plano-implementacao-conta-admin.md` (planos de execução, já entregues). Para os princípios de
> produto (offline-first, isolamento por atlas, P12) veja `visao-e-principios.md`; para a arquitetura
> de sincronização veja `arquitetura-sync.md` e `.claude/rules/architecture.md`.

O modelo mental é um **"Google Docs de mapas"**: o app roda **anônimo** por padrão (um workspace
local + arquivos `.ebgeo`), e o **login** adiciona atlas hospedados no servidor, compartilhamento e
**colaboração multiusuário em tempo real**. *Anônimo não quer dizer sem servidor*: o boot é
fail-fast em `GET /api/config`, então o backend precisa estar alcançável mesmo sem ninguém logado. Tudo abaixo descreve as duas
realidades — o que aparece anônimo/local e o que aparece logado/conectado.

---

## 1. Sessão, acesso e boot

A UI tem **três estados de sessão** (`store/sync/session-context.js`):

- **Anônimo / local** — sem login. O store local é **sempre editável** (sem trava de papel). É o
  estado padrão; o app abre direto no mapa.
- **Logado / conectado a um atlas remoto** — após login, o usuário abre um atlas do servidor; o store
  passa a ser o atlas remoto e o **papel por atlas** passa a valer (ver §5).
- **Visitante público** — abertura anônima de um **link público** de atlas (`?atlasPublico=…`): sessão
  ONLINE somente-leitura, sem identidade de conta (o menu de conta não aparece).

**URL é a fonte de verdade do que abrir** (`deep-link/atlas-link.js` + `atlas-url-sync.js`):
- `?atlas=<uuid>&map=<uuid>` abre um atlas (e mapa) específico do servidor;
- `?atlasPublico=<link>` abre o visitante público;
- `#view=3d` / `#view=360` têm precedência absoluta (viewer dedicado).
A URL é **reescrita reativamente** quando o atlas/mapa muda (via `replaceState`, sem prender o botão
Voltar); `?map=` só é escrito quando o id é um UUID resolvido (evita expor nomes internos).

**Expiração de sessão (idle timeout)** — `session/idle-timeout.controller.js`: após **30 min** de
inatividade (configurável em `config.features.idle_timeout_minutes`) surge um **aviso** (overlay, 60 s
para continuar; Esc/clique mantém ativo); sem resposta, a sessão expira. Um 401 no meio da sessão
(`api-client.setAuthLostHandler`) cai no mesmo fluxo de "entre novamente".

**Logout** zera o IndexedDB do atlas remoto (não deixa rastros do mapa anterior) e volta ao store local.

---

## 2. Atlas Drive — a tela de projetos

A seleção de projeto é uma **tela cheia** (`modals/project-picker.modal.js`, classe `AtlasDrive`), no
espírito do Google Drive. Substitui o antigo modal, preservando o contrato de testids
(`project-picker-modal`/`-item`/`-create`/`-cancel`) e a API `onPick`/`onCreate`.

- **Abas / filtros:** Recentes · Meus · Compartilhados comigo · Públicos · **Lixeira**.
- **Busca** client-side por nome.
- **Cards:** cada atlas é um card com uma **faixa colorida no topo** com as iniciais — um identificador
  visual **estável** (cor derivada de forma determinística do nome, não muda ao reordenar). *(Não há
  thumbnail/snapshot do mapa — decisão de escopo.)*
- **Novo projeto** — cria um atlas no servidor.
- **Menu de ações (⋯)** por card: **Renomear**, **Fazer uma cópia** (duplica), **Mover para a lixeira**
  (soft-delete). As ações são **gated por papel** (renomear = Editor+, lixeira = dono).
- **Lixeira** — lista os atlas soft-deleted do próprio dono, cada um com **Restaurar**.

O **boot não passa pelo Drive**: F5 reconecta o último atlas automaticamente; o Drive abre no fluxo
explícito "abrir projeto do servidor" (menu da conta / aba Mapas).

---

## 3. Anatomia da interface do mapa

A tela principal (`map_sig.js`) tem:

- **Barra de ferramentas (direita)** — grupos colapsáveis (`toolbar/`): **Desenho** (ponto, linha,
  polígono, círculo, elipse, retângulo, setor, texto, imagem, pincel), **Militar** (símbolo militar,
  medida de coordenação, seta, limite, frente ocupada, declinação), **Análise** (visada/LOS,
  visibilidade) e os grupos **Principal** (seleção, medições) e de manipulação. Cada ferramenta de
  desenho segue o padrão de 3 arquivos (control + geometry + painel de atributos).
- **Sidebar (esquerda, colapsável)** — abas **Mapas**, **Camadas**, **Briefings**, **Importar**,
  **Exportar**. A aba **Camadas** é a árvore de camadas → feições, com visibilidade, lock, opacidade,
  excluir, arrastar, camada ativa e tabela de atributos.
- **Busca global** (topo) — lugares, modelos, feições.
- **Seletor de mapa-base** (BDGEx, OSM, satélite, topográfico).
- **Controles inferiores** — terreno/hillshade, **Modelos 3D** (Cesium, lazy), **Street View 360**
  (Three.js, lazy).
- **Coordenadas do mouse** (rodapé, formato configurável) e **grade UTM**.

**Modos de aplicação** (`mode/application-mode.manager.js`): `NORMAL` (padrão), `BRIEFING_EDIT`
(editor de Story Map) e `BRIEFING_PRESENT` (apresentação) — as duas últimas trocam o perfil de
visibilidade da UI.

---

## 4. Edição vs **visualização segura**

Há uma distinção clara entre **editar** e **visualizar** um mapa, dirigida pela classe `is-view-only`
no `<body>` (`ui/view-mode.controller.js` + `css/view-mode.css`):

- **Automático:** quem **não pode editar** o atlas remoto conectado (Visualizador/Comentarista) entra
  no **modo seguro** — os grupos de toolbar de **Desenho/Militar/Análise** somem e a árvore de camadas
  vira uma **Legenda read-only** (sem lock/excluir/arrastar/opacidade/"Nova camada"; a visibilidade
  vira indicador desabilitado). Mantém-se toda a navegação (busca, mapas-base, 3D/360, coordenadas).
- **Manual ("Editar mapa", `Shift+E`):** quem **pode** editar pode alternar voluntariamente para o
  modo seguro (pré-visualizar como leitor) e voltar. A preferência é por-atlas (não vaza entre
  sessões/atlas).
- **Defesa em profundidade:** além de esconder as affordances, a tecla **Delete** é bloqueada para
  quem não pode editar, e toda escrita passa pelo `permission-guard` no store.
- **Feedback correto:** uma tentativa bloqueada mostra o toast certo por motivo — **"Mapa bloqueado…"**
  quando é trava de mapa (`map_locked`/`target_map_locked`) e **"Acesso somente leitura…"** quando é
  papel insuficiente.

---

## 5. Papéis e permissões

Dois eixos ortogonais (`utils/roles.js` no backend → vocabulário do frontend):

- **Papel global (conta):** `admin` (Administrador) vs `user`.
- **Permissão por atlas** (armazenada): `read` · `comment` · `write` · `manage`; `owner` é sintetizado
  do dono. Mapeiam para os papéis de UI **Visualizador · Comentarista · Editor · Gestor** (+ **dono** e
  **Administrador global**).

O que cada um vê/faz:

| Papel | Edita feições | Comenta | Compartilha/Configura | Modo da UI |
|---|---|---|---|---|
| **Visualizador** | não | não | não | visualização segura (legenda) |
| **Comentarista** | não | sim (comentários espaciais) | não | visualização segura + comentar |
| **Editor** | sim | sim | não | edição completa |
| **Gestor** (co-gestor / dono) | sim | sim | sim (até `manage`) | edição completa + share/admin do atlas |
| **Administrador global** | sim (qualquer atlas) | sim | sim + Painel do Admin | edição completa |

O **gate de papel só vale para um atlas remoto conectado** — o store local é sempre editável. As
mudanças de papel **valem ao vivo**: rebaixar um membro conectado (write→read) **engata o modo seguro
sem reconectar** (o servidor envia o novo papel no evento de share; um Administrador global ignora,
mantendo acesso total).

**"A permissão padrão abaixa, nunca eleva"**: ao convidar alguém, o papel **padrão é Leitura** —
elevar é uma ação deliberada no seletor do membro, nunca um acidente de convite.

---

## 6. Compartilhamento e colaboração em tempo real

### Diálogo de compartilhamento (`modals/sharing.modal.js`)
Aberto por Gestores/dono (menu da conta → Compartilhar). Tem:
- **Link público** — alterna um link **anônimo somente-leitura** (copiar para a área de transferência).
- **Vendo agora** — avatares de **quem está conectado agora** ao atlas (presença ao vivo), com **dot
  verde** de online também nos membros (cruzamento "quem tem acesso × quem está online"). Exclui você
  mesmo, como nas demais superfícies de presença.
- **Membros** — lista de quem tem acesso, cada um com seletor de papel (Leitura/Comentário/Edição/
  Gestão) e remover; o dono tem o selo **"Gestor (dono)"** e pode **transferir a propriedade**.
- **Adicionar pessoas** — busca de usuários; ao escolher, concede **Leitura** por padrão.

### Presença / awareness (`presence/`)
Em um atlas compartilhado: **roster de usuários online**, **cursores remotos** e **seleção remota** —
quando outro usuário seleciona/arrasta uma feição (2D/3D/360), a caixa de seleção aparece e
**acompanha** o arraste nos pares. Broadcast de seleção é gated por edição (Visualizador/Comentarista
só observam).

### Comentários espaciais (`comment_tool/`)
Threads ancoradas no mapa (raiz/resposta/resolver), com overlay + painel. `Shift+C` alterna a
colocação. É a forma de participação do **Comentarista** (que não edita). O Visualizador **não recebe**
comentários (filtro de visibilidade no servidor).

A colaboração é **server-authoritative LWW por ordem de chegada** (não é CRDT verdadeiro); detalhes em
`arquitetura-sync.md`.

---

## 7. Conta

`account/` — quando anônimo, só o botão **Entrar**; logado, um menu de conta com identidade, atlas
atual, **Compartilhar**, **Configurar projeto**, **Salvar no servidor** (store local → atlas) e **Sair**.

- **Login** — modal → seleção de projeto (Atlas Drive) → conecta + inicia o flush de sincronização.
- **Criar conta (signup) + confirmação por e-mail** — botão "Criar conta" no login; a verificação é
  disparada **quando há e-mail** (registros sem e-mail — admin/legado — seguem ativos). O mailer é
  sem-dependência (loga o link em dev; *seam* para SMTP).
- **Luz de status de sincronização** — indicador de conexão (escondido quando anônimo).

---

## 8. Painel do Administrador

Disponível para o **Administrador global** (`admin/`). É um **app-shell**: barra superior + **rail de
navegação à esquerda** + área de conteúdo com cards. Seções:

- **Usuários** — data-table com busca client-side, avatares e chips de papel; CRUD, atributos e
  ativar/desativar.
- **Configuração global** — todas as propriedades do `config` (rico, com expressões MapLibre); editor
  JSON como modo "Avançado". O backend é a **fonte única** do config (sobrescreve o estático em todo
  boot, anônimo inclusive).
- **Catálogo** (3D / 360 / dados / análises) — cadastro com **upload de mídia**: **thumbnail** embutido
  no config como **data URL base64** (WebP, downscale, com cap e botão "Remover"); **vídeo** (só 3D) =
  campo URL out-of-band. *(Não há static público no backend, por isso o thumbnail vai embutido.)*
- **Estilo dos basemaps** — editor de estilo MapLibre (JSON, validado), como override em banco sobre
  o estático.

A disponibilidade de features/basemaps/dados/análises por atlas é um **overlay de `atlas-settings`** que
filtra o config → o catálogo.

---

## 9. Outras superfícies (referência rápida)

- **Briefings / Story Maps** (`briefing/`) — editor + apresentador; slides referenciam modelos 3D por
  `modelId`. Modos `BRIEFING_EDIT`/`BRIEFING_PRESENT`.
- **Dimensão temporal** (`temporal/`) — linha do tempo por mapa (janelas de validade + trajetórias de
  feições móveis); detalhes em `modulo-temporal.md`.
- **3D (Cesium)** e **360 (Three.js)** — viewers lazy; marcadores/orientações sincronizam e persistem
  (peers convergem em ops 3D/360 ao vivo). Compartilhamento 3D/360 funciona **offline** (invariante
  preservada no redesenho).
- **Importar/Exportar** — GeoJSON, KML, CSV, SHP, `.ebgeo`, PDF (export cartográfico com DPI 150/200/300).
- **Processamento** — Buffer, Voronoi, Convex Hull (registry de algoritmos).

---

## 10. Decisões-chave e pendências

**Decisões tomadas (e por quê):**
- **Um workspace local + Drive de atlas no servidor** (P12): atlas nomeados são um conceito de
  servidor; localmente é um workspace só + `.ebgeo`. O `store-origin` é o marcador local↔remoto.
- **Link público = somente leitura** e **"acesso geral" = só o link** (sem papel por organização) —
  decisão do usuário para um GIS sensível; convidar é sempre share explícito por usuário.
- **Sem thumbnail/snapshot de atlas** — cards usam a faixa colorida com iniciais.
- **Mídia do catálogo embutida (base64)** — não há static público no backend e `deploy/` é protegido.

**Pendências / follow-ups conhecidos:**
- Quando um membro conectado é **removido** (revogado) ao vivo, ele só perde o acesso ao reconectar
  (o downgrade de papel já engata ao vivo; a remoção total não auto-desconecta — comportamento
  pré-existente).
- Sobras opcionais do Drive (baixa prioridade): recentes reais por último-aberto, "vendo agora" nos
  cards (presença cross-atlas) e compartilhar direto do card.
