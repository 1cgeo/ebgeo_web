# Guia de Testes — EBGeo Web

Objetivo desta estrutura: **impedir que bugs entrem**, não apenas validar o
happy path. Um teste só previne regressão se (1) alguém o roda de fato antes de
commitar e (2) cobre as **bordas** (null, NaN, vazio, limites, sinais, wrap), que
é onde os bugs realmente moram. Aqui o (1) é disciplina humana, não automação:
não há CI nem git hook neste repositório.

## Comandos (execução manual)

**A suíte tem três camadas, com comandos e pré-requisitos diferentes, e nenhum
comando único roda todas.** Este parágrafo existe porque o guia já cometeu o
defeito que a auditoria caça: até 2026-08-14 ele dizia que `npm test` "roda toda
a suíte", quando `frontend/vitest.config.js` exclui explicitamente `tests/e2e/**`
e `tests/e2e-ui/**`. Quem seguia o guia via verde sem jamais executar a camada
que sobe o backend real. Descrever um subconjunto e chamá-lo de conjunto é a
mesma classe de erro que os testes daqui procuram no código.

| Camada | O que é | Comando (em `frontend/`) | Pré-requisito |
|---|---|---|---|
| unit + store + integration | Vitest hermético, ambiente `node` | `npm test` | nenhum |
| e2e de contrato | Vitest contra o backend **real** | `npm run test:e2e` | PostgreSQL + PostGIS + superusuário |
| e2e de browser | Playwright contra app + backend reais | `npm run test:e2e:ui` | idem + browsers do Playwright |

```bash
npm test               # Vitest hermético: tests/unit, tests/store, tests/integration
npm run test:watch     # Watch mode durante desenvolvimento
npm run test:coverage  # Roda com relatório de cobertura → coverage/
npm run test:e2e       # tests/e2e/*.e2e.test.js contra o backend real
npm run test:e2e:ui    # tests/e2e-ui/*.spec.js no Playwright
npm run lint           # ESLint + Stylelint (--max-warnings 0)
```

**Cobertura:** `npm run test:coverage` gera o relatório em `coverage/`
(`coverage/index.html` para navegar; `text` no terminal; `lcov` para
ferramentas). É **report-only**, sem threshold que bloqueie — a meta é não
deixar a cobertura cair: ao adicionar lógica, adicione o teste junto. (O backend
é diferente: lá a cobertura tem piso, ver `backend/README.md`.)

**Disciplina:** antes de commitar, rode `npm run lint` e `npm test` **na raiz do
monorepo**, como dois comandos separados. O `npm test` da raiz encadeia
`test:frontend`, `test:backend` e `test:e2e` (ver `package.json` da raiz), então
ele cobre os dois pacotes e a camada de contrato; o Playwright continua de fora e
é o único comando que exercita a UI. Para um único arquivo:
`npx vitest run tests/unit/<arquivo>.test.js`.

**E2E de contrato (`tests/e2e/`, Vitest):** roda sob config própria
(`frontend/vitest.e2e.config.js`), não sob a hermética. O `globalSetup`
(`frontend/tests/e2e/global-setup.js`) cria um banco descartável, aplica as
migrações do backend e sobe `node src/index.js` numa porta efêmera, uma vez para
a run inteira. Sem Postgres alcançável ele **pula** os specs em vez de reprovar a
run, então um verde aqui não prova que a camada rodou: confira a contagem de
skips.

**E2E de browser (Playwright, `tests/e2e-ui/`):** sobe backend + DB descartáveis,
também exige PostgreSQL. Em máquina cujo Postgres só tem o superusuário
`postgres:postgres`, use
`DB_USER=postgres DB_PASSWORD=postgres npm run test:e2e:ui`. Detalhes e como
rodar um único spec: **`frontend/tests/e2e-ui/README.md`**.

## Taxonomia (onde cada teste mora)

```
tests/
├── unit/          # Lógica PURA: matemática, geometria, parsing, conversão, formatação.
│                  # Sem DOM, sem MapLibre, sem IndexedDB. É aqui que mais protege por hora.
├── store/         # Operações do store (feature/layer/map), undo/redo, transações.
├── integration/   # Fluxos que cruzam módulos: sync, queue, eventos, repository contract.
│   └── *.repro.test.js   # Regressão: reproduz um bug específico já corrigido.
├── e2e/           # *.e2e.test.js em Vitest contra o backend REAL (Express + Postgres).
│   │              # É o guarda da fronteira entre os dois pacotes: mudança que cruza
│   │              # envelope de sync, /api/config ou permissões se verifica aqui.
│   ├── global-setup.js   # Cria DB descartável, migra, sobe o backend uma vez por run.
│   └── helpers/harness.js  # ApiClient/WsClient próprios por teste + o flag E2E_SKIP.
├── e2e-ui/        # *.spec.js em Playwright: app + backend reais no browser.
│   ├── README.md         # Como rodar um único spec, variáveis de ambiente, SyncLedger.
│   └── helpers/          # trace-helpers/ledger (esperas determinísticas de sync), fixtures.
└── helpers/
    └── test-utils.js     # Factories (makeFeature/makeLineFeature/...), mocks (localforage), async helpers.
```

As duas camadas de e2e ficam **fora** do `npm test` deste pacote por decisão, não
por esquecimento: `frontend/vitest.config.js` as exclui para manter a run
hermética rápida e sem banco. Elas têm comando próprio (tabela acima).

## Regra de ouro: extraia a lógica pura

O ambiente de teste é `node` (sem jsdom). Código que toca DOM/MapLibre/Cesium
não é testável hoje. **A solução não é mockar o mundo — é separar o cálculo da
renderização.**

- ✅ Padrão do projeto: `add_*_geometry.js` (matemática) é separado de
  `add_*_control.js` (MapLibre) e `*_attributes_panel.js` (DOM). Teste o
  `_geometry`.
- Ao criar/alterar um tool, mantenha os cálculos em funções puras
  (entrada → saída, sem efeitos colaterais) e teste essas funções.
- Painéis/controles (DOM) ficam para a **fase 2** (suíte `jsdom` separada).

## Checklist de edge cases (não pare no happy path)

Para cada função, pergunte:

- **Vazio / nulo:** `''`, `null`, `undefined`, `[]`, `{}`.
- **Não-finito:** `NaN`, `Infinity` (lembre: `x ?? 0` **não** protege contra `NaN`;
  use `Number.isFinite`). Foi exatamente o bug da convergência meridiana.
- **Limites:** mínimo, máximo, e logo fora (`-90/90` lat, `±180` lng, `0/360`
  azimute, aperture `1/359`).
- **Sinais e wrap:** negativos, `-0`, módulo (`-45 % 360 === -45`, não `315`!),
  hemisférios (N/S, L/O), antimeridiano, polos.
- **Round-trip:** `parse(format(x)) ≈ x` para conversões (coord, azimute, SIDC).
- **Unidades:** graus↔milésimos, metros↔km, ida e volta.

## Property-based testing (fast-check)

Para matemática/geometria/coordenadas, prefira **invariantes** a exemplos. Uma
property gera centenas de entradas aleatórias e encontra a borda sozinha
(NaN, antimeridiano, módulo negativo — os bugs do último review).

```js
import fc from 'fast-check';

it('normalizeAzimuth sempre retorna [0, 360)', () => {
    fc.assert(fc.property(fc.double({ min: -100000, max: 100000, noNaN: true }), (a) => {
        const r = normalizeAzimuth(a);
        return r >= 0 && r < 360;
    }));
});
```

Invariantes úteis: round-trip (encode∘decode = id), idempotência
(`normalize(normalize(x)) = normalize(x)`), involução (`contra(contra(x)) = x`),
limites de saída (resultado sempre em uma faixa), monotonicidade.

## Convenção de regressão (`*.repro.test.js`)

**Todo bug corrigido vira teste.** Crie `tests/integration/<bug>.repro.test.js`
(ou em `unit/` se for lógica pura), documentando a causa-raiz em comentário e,
quando útil, um caso "pré-fix" (que falharia) e um "pós-fix" (que passa). Veja
`tests/integration/import-phantom-map.repro.test.js` como modelo.

## Factories e mocks

- **Features/maps:** use `makeFeature`, `makeLineFeature`, `makePolygonFeature`,
  `makeOperation` de `tests/helpers/test-utils.js`. Adicione factories lá quando
  reutilizáveis.
- **IndexedDB/localforage:** `createMockLocalforage()` (Map em memória).
- **Estado de módulo:** padrão `vi.hoisted()` + `vi.mock()` (veja
  `tests/store/feature-operations.test.js`).
- **`turf` global:** o app injeta `turf` via `<script>`. Em testes, stube
  `globalThis.turf` apenas com os métodos usados, ou prefira funções que não o
  usem.
- **Barrel `@tools` (DOM-coupled):** ao testar `add_*_geometry.js`, mocke
  `@tools` com um `BaseGeometry` trivial para não carregar a cadeia de DOM
  (veja `tests/unit/sector-geometry.test.js`).

## Suítes-piloto (modelos a copiar)

Os exemplos a seguir cobrem os 4 padrões principais e servem de template:

| Arquivo | Demonstra |
|---|---|
| `tests/unit/coordinate-converter.test.js` | parsing/format + **round-trip** com fast-check (UTM/MGRS/DMS) |
| `tests/unit/azimuth-distance-geometry.test.js` | funções puras + **invariantes** + stub de `turf` |
| `tests/unit/sector-geometry.test.js` | geometria de tool com **mock do barrel `@tools`** |
| `tests/unit/brazilian-sidc.test.js` | **encode/decode round-trip** (bit-packing) com fast-check |

## Roadmap de cobertura (prioridade por risco × facilidade)

Esta lista **não é um inventário de cobertura**, e não tente usá-la como um: o
inventário real é `ls tests/unit`. Ela envelhece a cada suíte escrita, e foi
exatamente assim que envelheceu: até 2026-08-14 listava como "ainda sem teste"
quatro alvos que já tinham suíte própria (CSV, círculo, elipse e símbolo
militar), mandando reescrever trabalho pronto. **Antes de pegar um item daqui,
confirme com `ls tests/unit` que a suíte não existe.**

Próximos alvos (lógica pura, alto ROI, sem suíte em disco na última conferência):

1. `frontend/src/js/import_export/qan/qan-export.js` — `generateQAN` (normalização de azimute, mapeamento de observações).
2. `frontend/src/js/draw_tools/rectangle_tool/add_rectangle_geometry.js` — cantos rotacionados, mistura de `atan2` (leste=0) com bearing de turf (norte=0). Círculo e elipse, que já moraram nesta linha, saíram: têm `tests/unit/circle-geometry.test.js` e `tests/unit/ellipse-geometry.test.js`.
3. `frontend/src/js/processing/algorithms/buffer.algorithm.js` e `frontend/src/js/processing/algorithms/voronoi.algorithm.js` — `execute(features, params)`, fan-out de MultiPolygon, alinhamento das células.

Saíram do roadmap por já estarem cobertos (a suíte existe, confira antes de
duvidar): CSV inteiro (`csv-parser.js` + `csv-coordinate-converter.js` +
`csv-to-geojson.js`) em `tests/unit/csv-import.test.js`; círculo e elipse em
`tests/unit/circle-geometry.test.js` e `tests/unit/ellipse-geometry.test.js`;
`buildSIDC`/`parseSIDC` em `tests/unit/military-symbol-generator.test.js`.

O backlog detalhado, por domínio e com edge cases já levantados, está em
`frontend/tests/TESTING-BACKLOG.md`.

**Fase 2 (não agora):** ambiente `jsdom` separado para painéis e controles
MapLibre (exige mock de `map`).

## Antes de abrir PR

- [ ] `npm run lint` passa (na raiz: cobre os dois pacotes).
- [ ] `npm test` passa (na raiz: frontend + backend + e2e de contrato).
- [ ] Mudança que cruza os dois pacotes (sync, `/api/config`, permissões) tem
      `npm run test:e2e` verde **com o Postgres de pé** — sem ele os specs pulam
      e o verde não prova nada.
- [ ] Mudança de UI tem captura do Playwright lida como imagem, não só teste verde.
- [ ] Lógica nova vem com teste (incluindo ≥1 edge case do checklist).
- [ ] Bug corrigido tem `*.repro.test.js`.
