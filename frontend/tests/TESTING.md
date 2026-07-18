# Guia de Testes — EBGeo Web

Objetivo desta estrutura: **impedir que bugs entrem**, não apenas validar o
happy path. Um teste só previne regressão se (1) roda automaticamente em CI e
(2) cobre as **bordas** (null, NaN, vazio, limites, sinais, wrap), que é onde os
bugs realmente moram.

## Comandos (execução manual)

Este projeto **não usa CI nem git hooks** — os testes são rodados **manualmente**.
Tudo já está configurado; basta:

```bash
npm test               # Roda toda a suíte (Vitest, modo run)
npm run test:watch     # Watch mode durante desenvolvimento
npm run test:coverage  # Roda com relatório de cobertura → coverage/
npm run lint           # ESLint + Stylelint (--max-warnings 0)
```

**Cobertura:** `npm run test:coverage` gera o relatório em `coverage/`
(`coverage/index.html` para navegar; `text` no terminal; `lcov` para
ferramentas). É **report-only**, sem threshold que bloqueie — a meta é não
deixar a cobertura cair: ao adicionar lógica, adicione o teste junto.

**Disciplina:** antes de commitar, rode `npm run lint` e `npm test`. Para um
único arquivo: `npx vitest run tests/unit/<arquivo>.test.js`.

**E2E de browser (Playwright):** a suíte `npm test` acima é Vitest em `node` (sem
banco). Os testes de browser ficam em `tests/e2e-ui/` e sobem um backend + DB
descartáveis — exigem PostgreSQL. Rodam com `npm run test:e2e:ui`; em máquina cujo
Postgres só tem o superusuário `postgres:postgres`, use
`DB_USER=postgres DB_PASSWORD=postgres npm run test:e2e:ui`. Detalhes e como rodar
um único spec: **`tests/e2e-ui/README.md`**.

## Taxonomia (onde cada teste mora)

```
tests/
├── unit/          # Lógica PURA: matemática, geometria, parsing, conversão, formatação.
│                  # Sem DOM, sem MapLibre, sem IndexedDB. É aqui que mais protege por hora.
├── store/         # Operações do store (feature/layer/map), undo/redo, transações.
├── integration/   # Fluxos que cruzam módulos: sync, queue, eventos, repository contract.
│   └── *.repro.test.js   # Regressão: reproduz um bug específico já corrigido.
└── helpers/
    └── test-utils.js     # Factories (makeFeature/makeLineFeature/...), mocks (localforage), async helpers.
```

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

Já cobertos: store/sync, geometry-utils, deep-utils, lru-cache, uuid,
meridian-convergence, e as 4 suítes-piloto acima.

Próximos alvos (lógica pura, alto ROI, ainda sem teste):

1. `import_export/csv/csv-coordinate-converter.js` — `_parseSingleDMS`, `_parseUTMZone` (3 regex, direção O/E, `23K`).
2. `import_export/qan/qan-export.js` — `generateQAN` (normalização de azimute, mapeamento de observações).
3. `draw_tools/circle|ellipse|rectangle/*_geometry.js` — projeção, cantos rotacionados.
4. `military_tools/military_symbol_tool/military_symbol_generator.js` — `buildSIDC`/`parseSIDC`.
5. `processing/algorithms/*.algorithm.js` — `execute(features, params)`.
6. `import_export/csv/csv-parser.js` — RFC-4180, separador, CRLF.

**Fase 2 (não agora):** ambiente `jsdom` separado para painéis e controles
MapLibre (exige mock de `map`).

## Antes de abrir PR

- [ ] `npm run lint` passa.
- [ ] `npm test` passa.
- [ ] Lógica nova vem com teste (incluindo ≥1 edge case do checklist).
- [ ] Bug corrigido tem `*.repro.test.js`.
