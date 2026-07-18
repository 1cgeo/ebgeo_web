# EBGeo

GIS web para o Exército Brasileiro — visualização e edição de dados geoespaciais e símbolos
militares (APP-6 / milsymbol), briefings (Story Map), análise de terreno, 3D e StreetView 360.

**Monorepo — um repositório, dois pacotes:**

| Pacote | Onde | Stack |
|--------|------|-------|
| **web** | raiz (`src/`, `tests/`) | Vanilla JS (ES modules, sem framework) · Vite · MapLibre GL JS (2D) · Cesium (3D, lazy) · Three.js (360, lazy) · Turf.js · IndexedDB via LocalForage |
| **backend** | [`backend/`](backend/) | Express 4 · pg-promise (SQL direto, sem ORM) · `ws` · PostgreSQL + PostGIS · JWT |

A referência completa do servidor (rotas, env, migrações, permissões, protocolo WS) está em
[`backend/README.md`](backend/README.md); os guias de integração em
[`backend/docs/implementado/`](backend/docs/implementado/).

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
> (`src/js/index.js` — 3 tentativas, depois a tela "EBGeo indisponível"). O `src/js/config.js`
> empacotado é apenas o *shape* que o servidor hidrata; **não há fallback estático**. Passado o boot,
> a edição permanece local-first: escreve no IndexedDB e sincroniza depois.

## Comandos

### Só o frontend (não precisa de banco)

```bash
npm run dev          # Servidor de desenvolvimento (porta 3000)
npm run build        # Build de produção (deploy/deploy.sh)
npm run lint         # ESLint (--max-warnings 0) + Stylelint
npm run lint:fix     # Correção automática de lint
npm test             # Vitest (execução única)
npm run test:watch   # Vitest em watch
npm run test:coverage# Relatório de cobertura (sem threshold bloqueante)
npm run knip         # Detecção de código morto
npm run preview      # Preview do build de produção
```

### Monorepo (backend + frontend)

O backend exige **PostgreSQL com PostGIS**; os testes dele criam/dropam um banco `ebgeo_test` e
precisam de um superusuário para habilitar as extensões (PostGIS é *untrusted*).

```bash
npm run install:all  # instala os dois pacotes
npm run dev:all      # sobe backend + frontend juntos
npm run dev:backend  # só o backend (node --watch)
npm run test:all     # suíte dos dois
npm run test:backend # só o backend
npm run lint:all     # lint dos dois
npm run test:e2e:ui  # Playwright: sobe o backend REAL de backend/ e dirige o browser
```

O E2E resolve o backend a partir de `backend/` no próprio repositório — `EBGEO_BACKEND_DIR`
sobrescreve se o seu checkout mantiver o servidor em outro lugar.

> Testes são executados manualmente (não há CI de testes nem git hooks). A UI é testada manualmente —
> verifique mudanças via `npm run lint` e `npm test`.

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
**Feições** (elementos geográficos com metadados de sync: `createdAt`, `updatedAt`, `version`,
`ownerId`, `dirty`, `deleted`). Dados temporais opcionais por feição (janela de validade + trajetória).
