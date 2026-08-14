# EBGeo

GIS web para o Exército Brasileiro: visualização e edição de dados geoespaciais e símbolos
militares (APP-6 / milsymbol), briefings (Story Map), análise de terreno, 3D e StreetView 360.

**Monorepo, um repositório e dois pacotes:**

| Pacote | Onde | Stack |
|--------|------|-------|
| **web** | [`frontend/`](frontend/) | Vanilla JS (ES modules, sem framework) · Vite · MapLibre GL JS (2D) · Cesium (3D, lazy) · Three.js (360, lazy) · Turf.js · IndexedDB via LocalForage |
| **backend** | [`backend/`](backend/) | Express 4 · pg-promise (SQL direto, sem ORM) · `ws` · PostgreSQL + PostGIS · JWT |

Cada pacote é autocontido, com seu próprio `package.json`, `node_modules` e `.gitignore`. A raiz só
orquestra: os scripts dela delegam com `--prefix`, e o único lugar onde os dois se encontram é o
E2E, que sobe o backend real.

## Modos de operação

1. **Anônimo (padrão)**, sem login: os dados ficam no IndexedDB local e o projeto é exportado e
   importado como arquivo `.ebgeo`.
2. **Autenticado**, com login JWT: atlas hospedados no servidor, colaboração multiusuário em tempo
   real (feições, mapas e camadas via REST + WebSocket), presença e compartilhamento.
3. **Público**: abertura de um atlas por link, somente leitura.

> **Login é opcional, servidor não é.** O backend é aditivo no sentido de que o app é idêntico para
> quem não faz login, e nenhuma mudança pode quebrar esse caminho. Ele não é opcional para subir:
> `GET /api/config` é a fonte única de config e catálogo, e o boot faz 3 tentativas antes da tela
> "EBGeo indisponível" (`frontend/src/js/index.js`). O `frontend/src/js/config.js` empacotado é só o
> *shape* que o servidor hidrata, e não existe fallback estático. Passado o boot, a edição continua
> local-first: escreve no IndexedDB e sincroniza depois.

## Subir o ambiente

Requisitos: **Node >= 20.19** (o boot do backend usa `--env-file-if-exists`, que não existe antes
disso) e **PostgreSQL com PostGIS**.

```bash
npm run install:all                    # instala os dois pacotes
cp backend/.env.example backend/.env   # portas: backend :8080, Vite :3000 (inverter derruba o boot)
npm run db:setup --prefix backend      # cria o banco com o dono certo + extensões; ver o script
npm run db:migrate --prefix backend
npm run db:seed --prefix backend       # usuários de teste: admin/admin123 e cap.silva/test123
npm run dev                            # backend :8080 + Vite :3000, juntos
```

Peças soltas: `npm run dev:web` (só o Vite, que sozinho não boota) e `npm run dev:backend`.
Para publicar: `npm run build` compila para `dist/` e `npm run deploy` troca o symlink.

## Verificação

```bash
npm run lint         # OS DOIS pacotes: ESLint (--max-warnings 0) + Stylelint no frontend,
                     #   ESLint + o probe das regras de teste no backend
npm test             # OS DOIS pacotes + o E2E full-chain; exige o mesmo PostgreSQL do backend.
                     #   A suíte completa do backend se auto-eleva para c8 e verifica o piso de
                     #   cobertura do .c8rc.json
npm run test:e2e:ui  # Playwright: sobe o backend REAL de backend/ e dirige o browser
npm run knip         # detecção de código morto
```

Um pacote só: `lint:frontend`, `lint:backend`, `test:frontend`, `test:backend`. Também há
`test:watch` (Vitest do frontend) e `test:coverage` (os dois pacotes).

O E2E resolve o backend a partir de `backend/` no próprio repositório; `EBGEO_BACKEND_DIR`
sobrescreve se o seu checkout mantiver o servidor em outro lugar.

> Não há CI nem git hooks: tudo roda à mão. Lógica se verifica com `npm run lint` e `npm test`, em
> comandos separados e antes do commit. **UI se verifica com Playwright**, nunca com ferramenta de
> preview ou browser interativo. Ver [`.claude/rules/testing.md`](.claude/rules/testing.md).

## Onde ficam as coisas

- **[`docs/wiki/index.md`](docs/wiki/index.md)** é a documentação do projeto: o porquê das decisões,
  as armadilhas e os contratos congelados, incluindo o modelo de dados (Atlas → Mapas → Camadas →
  Feições) e o multiusuário. Comece pelo índice.
- **[`backend/README.md`](backend/README.md)**: subir, migrar e testar o servidor.
- **`CLAUDE.md`** (na raiz e em `backend/`) é o contrato de comportamento para quem trabalha aqui,
  com `.claude/rules/` para o detalhe de arquitetura e `.claude/skills/` para os procedimentos.
- **[`docs/MEMORY.md`](docs/MEMORY.md)** (fatos duráveis), [`docs/livro-razao.md`](docs/livro-razao.md)
  (lições de correções) e [`docs/decisions/`](docs/decisions/DECISIONS.md) (ADRs leves).
