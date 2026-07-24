# EBGeo

GIS web para o Exército Brasileiro — visualização e edição de dados geoespaciais e símbolos
militares (APP-6 / milsymbol), briefings (Story Map), análise de terreno, 3D e StreetView 360.

**Monorepo — um repositório, dois pacotes:**

| Pacote | Onde | Stack |
|--------|------|-------|
| **web** | [`frontend/`](frontend/) | Vanilla JS (ES modules, sem framework) · Vite · MapLibre GL JS (2D) · Cesium (3D, lazy) · Three.js (360, lazy) · Turf.js · IndexedDB via LocalForage |
| **backend** | [`backend/`](backend/) | Express 4 · pg-promise (SQL direto, sem ORM) · `ws` · PostgreSQL + PostGIS · JWT |

Cada pacote é autocontido, com seu próprio `package.json`, `node_modules` e `.gitignore`. A raiz só
orquestra: os scripts dela delegam com `--prefix`, e o único lugar onde os dois se encontram é o
E2E do Playwright, que sobe o backend real.

A referência completa do servidor (rotas, env, migrações, permissões, protocolo WS) está em
[`backend/README.md`](backend/README.md); o porquê das decisões, na
[wiki](docs/wiki/index.md). Os guias numerados de integração foram absorvidos pela wiki e o
diretório que os continha não existe mais.

## Modos de operação

1. **Anônimo (padrão)** — sem login: todos os dados ficam no IndexedDB local e projetos são
   exportados/importados como arquivos `.ebgeo`. **O servidor precisa estar alcançável no boot** —
   ver a nota abaixo.
2. **Autenticado** — login JWT, atlas hospedados no servidor, **colaboração multiusuário em tempo real**
   (sync de feições/mapas/camadas via REST + WebSocket), presença e compartilhamento.
3. **Público** — abertura de um atlas por link público, somente leitura.

> **Login opcional, servidor obrigatório no boot.** O backend é **aditivo** no sentido de que a app
> é idêntica para quem não faz login, e nenhuma mudança pode quebrar esse caminho anônimo. Ele **não**
> é opcional para subir: `GET /api/config` é a fonte única de config/catálogo e o boot é **fail-fast**
> (`frontend/src/js/index.js` — 3 tentativas, depois a tela "EBGeo indisponível"). O `frontend/src/js/config.js`
> empacotado é apenas o *shape* que o servidor hidrata; **não há fallback estático**. Passado o boot,
> a edição permanece local-first: escreve no IndexedDB e sincroniza depois.

## Comandos

### Os dois modos

Login é opcional, **servidor não é**: o boot é fail-fast em `GET /api/config` e não há
fallback estático, então subir só o Vite dá a tela "EBGeo indisponível". Trabalhar aqui
exige o backend de pé, e ele exige **PostgreSQL com PostGIS**.

```bash
npm run install:all  # instala os dois pacotes
npm run dev          # DEV: backend :8080 + Vite :3000, juntos
npm run build        # PROD: compila para dist/
npm run deploy       # PROD: publica (deploy/deploy.sh, troca de symlink)
```

Peças soltas, quando você quer só uma delas:

```bash
npm run dev:web      # só o Vite (não boota sozinho; é o que o Playwright usa)
npm run dev:backend  # só o backend (node --watch)
```

### Verificação

```bash
npm run lint         # ESLint (--max-warnings 0) + Stylelint
npm run lint:fix     # correção automática
npm test             # Vitest (114 arquivos, execução única)
npm run test:watch   # Vitest em watch
npm run test:coverage# cobertura (sem threshold bloqueante)
npm run test:backend # backend: cria e dropa ebgeo_test, exige superusuário
npm run test:all     # suíte dos dois pacotes
npm run lint:all     # lint dos dois pacotes
npm run test:e2e:ui  # Playwright: sobe o backend REAL de backend/ e dirige o browser
npm run knip         # detecção de código morto
```

O E2E resolve o backend a partir de `backend/` no próprio repositório — `EBGEO_BACKEND_DIR`
sobrescreve se o seu checkout mantiver o servidor em outro lugar.

> Testes são executados manualmente (não há CI de testes nem git hooks). Lógica se verifica com
> `npm run lint` e `npm test`; **UI se verifica com `npm run test:e2e:ui`**, que sobe o backend real
> e é o guarda da fronteira entre os dois pacotes. O que não se usa é ferramenta de preview ou
> browser interativo. Ver [`.claude/rules/testing.md`](.claude/rules/testing.md).

## Arquitetura & convenções

A documentação detalhada para contribuir (estrutura de pastas, padrões de store/eventos, sync, tarefas
comuns e regras de teste) vive em:

- **`CLAUDE.md`** — contrato de comportamento e padrões não-negociáveis.
- **`.claude/rules/`** — `architecture.md` (estrutura + módulos + sync/colaboração),
  `common-tasks.md` (receitas), `testing.md` (regras de teste).
- **`.claude/skills/`** — `new-tool` (scaffold de ferramenta), `store-op` (operação de store).
- **`docs/`** — especificações, incluindo `docs/wiki/index.md` (multiusuário).

### Modelo de dados (resumo)

**Atlas** (contêiner do projeto) → **Mapas** (workspaces) → **Camadas** (visibilidade + bloqueio) →
**Feições** (elementos geográficos). Dados temporais opcionais por feição (janela de validade +
trajetória).

O metadado de sync **não é uniforme entre as entidades**, e tratá-lo como uniforme é erro fácil:
Atlas, Mapa e Grupo carregam os seis campos (`createdAt`, `updatedAt`, `version`, `ownerId`,
`dirty`, `deleted`), enquanto **feição carrega só três** — `createdAt`, `updatedAt` e `version`,
postos por `addCreatedTimestamp` (`frontend/src/js/store/feature.operations.js:29-41`).
