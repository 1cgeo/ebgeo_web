# MEMORY

Fatos **duráveis** do sistema EBGeo. Injetado em toda sessão, teto de 200 linhas / 25KB (acima disso o excedente é descartado em silêncio; há teste que falha antes). Ao passar de ~80%, consolide na retrospectiva e mova o detalhe para [`docs/wiki/`](wiki/index.md).

**Fato, não estado.** Fato: "a transação do store é persistence-first". Estado: "a fase B está em andamento" — isso o git, o código e os testes sabem melhor, e apodrece em dias. Estado gravado aqui envenena decisões futuras, porque o agente não distingue crença desatualizada de contexto legítimo.

Quando um fato aqui conflitar com o código, **o código vence** e este arquivo se corrige (doutrina, princípio 2).

## O que é o projeto

- Monorepo de dois pacotes simétricos: **web** em `frontend/` (Vanilla JS + Vite + MapLibre + Cesium + Three.js) e **backend** em `backend/` (Express + pg-promise + `ws` + PostgreSQL/PostGIS). GIS militar do Exército Brasileiro com colaboração multiusuário em tempo real.
- O web morou na raiz até 2026-07-18, quando virou `frontend/`. Consequência permanente: `git log -- frontend/src/...` não enxerga o histórico anterior ao movimento; use `--follow` no arquivo, ou o caminho antigo (`git log --all -- src/js/...`). O backend, integrado por subtree, **manteve** os caminhos originais e não tem esse problema.
- O backend veio de um repositório separado (`1cgeo/ebgeo_backend`), integrado por `git subtree` em 2026-07-18 no branch `integracao_backend`. Os 44 commits foram preservados, **mantendo os caminhos originais**: `git log --all -- src/middleware/auth.js` acha o histórico; `--follow` não atravessa o enxerto.
- `main` é outra linha do produto. **Não sincronize `integracao_backend` com `main`** sem pedir.
- Cada pacote tem CLAUDE.md próprio; [`backend/CLAUDE.md`](../backend/CLAUDE.md) é o contrato de comportamento de quem mexe no servidor.

## Invariantes de arquitetura (não violar sem decisão registrada)

- **Login é opcional; servidor não é.** O app roda anônimo (sem conta), mas o boot é fail-fast em `GET /api/config`: sem backend alcançável, tela "EBGeo indisponível". Não existe fallback estático — `frontend/src/js/config.js` é só o *shape* que o servidor hidrata.
- **Permissão por atlas tem CINCO níveis**: `read < comment < write < manage < owner`. `owner` é sintetizado de `atlas.owner_id`; o CHECK da coluna é `read|comment|write|manage`. Sempre gate pela hierarquia. Lista fechada tipo `permission === 'write' || 'owner'` exclui o `manage` em silêncio, e já causou bug real.
- **Escrita de entidade colaborativa é só via sync** (`POST /atlas/:id/sync` ou WS `operation`). Não crie rota REST de escrita para feature/layer/group/map/briefing/slide/3D/360.
- **Conflito = LWW por ordem de chegada ao servidor**, não por timestamp; idempotência por `op_id`. Não é CRDT de verdade: o servidor define a ordem total.
- **Geometria do atlas é JSONB**; PostGIS vive só nos schemas `ng` e `sv360`. Nunca adicione PostGIS ao schema do atlas.
- **Soft-delete sempre** (`deleted_at`, `is_active` para usuários, tombstone para fotos 360).
- **`sv360` está fora do sync/CRDT/WS**: envelope de erro plano `{ error }`, BLOBs em SQLite por projeto, sem broadcast após escrita.
- Contratos congelados do frontend (mudar o shape exige teste de contrato): `GET /api/config`, `GET /nomes/busca` (array nu), metadado de foto sv360, envelope de operação de sync, snapshot.

## Armadilhas que já custaram caro

- **Documentação sobre código é hipótese; o arquivo é a fonte.** O doc que se dizia "referência única" errava o vocabulário de permissões e mandava implementar um fallback de config inexistente.
- **URL de serviço interno deve ser relativa.** O deploy real serve tudo same-origin atrás de proxy. Default absoluto `http://localhost:*` funciona por acidente do proxy do Vite e quebra em produção.
- **Migração é rastreada por NOME de arquivo, não por conteúdo.** Migrations foram consolidadas no lugar pré-release: todo banco criado antes disso ficou preso no schema antigo com o runner reportando "already applied". Sintoma: tabela que some (`basemaps` não existe → `/api/config` 500). Conserto em dev: `node scripts/dev-db.js recreate`.
- **`pkill` do Git Bash não mata processo Node do Windows.** Matar por PID (`Get-NetTCPConnection` + `Stop-Process`) e conferir a porta antes de medir.
- **`db.none()` num `SELECT` falha** — inclusive em `SELECT pg_advisory_lock(...)`, que retorna linha. Erro cometido três vezes numa sessão.
- **Postgres 15+**: só o dono do banco cria no schema `public`. O runner de teste acerta por acidente (cria o banco como o papel da app); dev precisa de `npm run db:setup`.
- **`setStyle()` do MapLibre não emite `styledata` quando o diff é vazio.** `Style.setState` sai com `return false` se `operations.length === 0`, sem disparar evento nenhum. Quem espera o evento para prosseguir trava até o timeout. Dispara sempre que dois basemaps do `STYLE_MAP` guardam o mesmo estilo — e `carta_topografica.js` é byte a byte igual a `osm_layer.js` nas duas linhas do produto. Preso por `baselayer-style-uniqueness.repro.test.js`.
- **Data do catálogo chega em dois formatos do backend**: `data_captura` dos modelos 3D é `DD/MM/YYYY` (seed da migração 003) e `capture_date` das fotos 360 é `TIMESTAMPTZ` (migração 005, validado como `isoDate`). Parser que só lê um formato devolve `NaN`, e comparador que devolve `NaN` deixa o `Array.sort` **indefinido** — a lista parece ordenada e não está. Preso por `catalog-sort.test.js`.
- **Esperar um evento de disparo único é corrida, e a versão perdedora trava para sempre.** `if (!map.loaded()) await new Promise(r => map.on('load', r))` nunca resolve se o `load` passou entre o teste e o registro do listener. Quando esse `await` está numa cadeia de abertura, o que se vê é a feature parando **antes** da primeira requisição: sem erro, sem pedido falho, intermitente. Foi assim que o link 360 compartilhado abria preto em ~metade dos boots. O padrão certo já existe no repo (`waitForGlobal`, `frontend/src/js/3d_models_viewer_tool/map_3d.js`): pré-checagem, polling e timeout que **resolve** em vez de rejeitar, porque dependência auxiliar não pode barrar a principal. Preso por `streetview-minimap-sync-race.test.js`.
- **Sonda que faz `import()` no dev server pode receber outra instância do módulo.** O Vite serve o arquivo recém-editado com `?t=` de HMR, então o `import()` de um `page.evaluate` carrega uma segunda cópia, com estado próprio e vazio. Sintoma: a função do app comprovadamente rodou (efeito visível no DOM) e mesmo assim o estado lido diz que não. Meça por rede, DOM ou pixel, que não dependem de identidade de módulo.
- **Regra de `.gitignore` sem barra no meio não é ancorada e alcança os subdiretórios.** Foi assim que `frontend/package-lock.json` ficou fora do git em silêncio: sem lockfile versionado o Dependabot analisa só o range do manifesto, então instalação limpa podia resolver para versão vulnerável sem nada acusar. Hoje os dois lockfiles são versionados.

## Como verificar (a realidade manda)

- Frontend: `npm test` (vitest, sem banco). Backend: `npm run test:backend` (exige PostgreSQL + PostGIS + superusuário; cria e dropa `ebgeo_test`).
- E2E: `npm run test:e2e:ui` (Playwright sobe o backend real de `backend/`). É o guarda da fronteira entre os pacotes.
- **Controle negativo é obrigatório** para teste de regressão: reverter o fix e confirmar que o teste falha. Sem isso não se sabe se o teste prende alguma coisa.
- **Lint e teste em comando separado, ANTES do `git commit`.** Na mesma linha de comando a saída chega depois do commit já ter passado — verificação que chega depois da ação não é verificação.
- Topologia de dev: Vite em **:3000**, backend em **:8080** (o Vite faz proxy de `/api`). Inverter derruba o boot.
- Não use ferramenta de preview/browser para validar UI; o E2E do Playwright é o caminho aprovado.

## Onde mora o conhecimento

- [`docs/wiki/index.md`](wiki/index.md) — **é** a documentação do projeto. Os 17 guias de integração e o docs/deploy.md (removido) foram absorvidos e removidos; não procure por eles. Critério das páginas: o código já é a evidência, então a wiki carrega o porquê, a armadilha e o contrato, não a descrição do que o código faz. Antes de pesquisar do zero, cheque se já existe página.
- [`docs/decisions/DECISIONS.md`](decisions/DECISIONS.md) — decisões de arquitetura.
- [`docs/livro-razao.md`](livro-razao.md) — o espelho das correções; a retrospectiva lê para achar recorrência.
- [`docs/doutrina.md`](doutrina.md) — os seis princípios, texto integral.
