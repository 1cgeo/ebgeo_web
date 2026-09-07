# Fixtures `.ebgeo` da outra linha do produto

Cópias byte-a-byte de `_ebgeo_dados_teste/` (sha256 conferido na cópia), geradas dirigindo o
app da outra linha e exportando pelo caminho de produção. Nada neste repositório as edita.

**A pasta se chama `ebgeo-2.2` por história, e o nome ficou estreito**: desde 2026-09-07 ela
guarda também um arquivo 2.4, porque a outra linha andou (2.3 em 2026-09-03, 2.4 em 2026-09-06) e
a travessia precisa ser medida com o que ela produz HOJE, não com o que produzia em agosto.
Renomear a pasta move o `FIXTURE_DIR` de `tests/helpers/ebgeo-fixture.js` e nada mais; não foi
feito para não misturar a renomeação com a subida de esquema.

| arquivo | sha256 | conteúdo |
|---|---|---|
| `01-completo.ebgeo` | `309ecc2c…6488c` | 2.2: 11 mapas, 262 feições, 17 camadas, 2 grupos, 2 briefings (2+3 slides), 2 ícones customizados, 5 PNG |
| `02-minimo.ebgeo` | `f26b044e…3130b` | 2.2: 1 mapa, 1 feição, 1 camada, nada mais |
| `03-completo-2.4.ebgeo` | `50fc7fe2…d17e7` | 2.4: 14 mapas, 805 feições, 21 camadas, 3 grupos, 2 briefings (7 slides), 3 ícones, 149 PNG (146 alcançáveis por feição) |

Quem as lê, hoje CINCO arquivos (a lista sai de `git ls-files` mais um grep por
`loadEbgeoFixture` e pelo nome do arquivo, não de memória):

- `tests/helpers/ebgeo-fixture.js`, o leitor e semeador que os outros quatro usam;
- `tests/integration/migracao-22-para-23-fixture-real.test.js`, os 22 casos da migração de um
  repositório 2.2 real sobre `fake-indexeddb`;
- `tests/integration/degrau-3.0-entradas-da-transicao.test.js`, as quatro entradas da travessia
  (2.2, 2.3, 2.4 e a desta linha) e a entrada "1.7 no settings com 2.4 no registro", que é a que
  usa o `03-completo-2.4.ebgeo` e os 146 blobs alcançáveis;
- `tests/e2e-ui/browser-migracao-2.2.spec.js`, a mesma migração em Chromium de verdade;
- `tests/e2e-ui/atlas-local-ebgeo-e-teardown.spec.js`, que abre o `01-completo.ebgeo` pela TELA e
  compara o que chegou com o que o arquivo declara.

## O que uma regeração quebra, e onde

Duas propriedades destes arquivos são LOAD-BEARING para o teste da migração, e nenhuma delas
é garantida pelo formato. Se as fixtures forem regeradas, confira as duas:

1. **As 168 feições de ponto não carregam `sizeCreatedAtZoom`.** É a marca que o teste usa
   para dizer se o passo v2.0→v2.1 rodou num slot. A ausência NÃO é o que a ferramenta de
   ponto grava: `add_point_control.js` do `main` escreve `sizeCreatedAtZoom: currentZoom` em
   todo ponto criado por ela. As fixtures não a têm porque o gerador
   (`_ebgeo_dados_teste/_geradores/_gera-fixtures.mjs`) monta GeoJSON à mão e chama
   `store.addFeature`, contornando a ferramenta.
   Se uma fixture nova chegar COM a propriedade, o teste fica **vermelho** na asserção
   positiva `expect(before.withProp).toBe(0)`, e não silenciosamente sem observável. O
   conserto é escolher outro observável, não afrouxar a asserção.

2. **`data.version` é `'2.2'` nos dois primeiros arquivos e `'2.4'` no terceiro, e
   `data.currentMap` é `'Principal'`.** O primeiro é a versão de partida da migração; o segundo é
   comparado com o valor que `initializeRepository()` devolve.

3. **No `03-completo-2.4.ebgeo`, 146 dos 149 PNG são alcançáveis por alguma feição.** É a medida
   que o caso da entrada "1.7" usa para dizer se os blobs ficaram órfãos, e `ebgeo_images` é
   chaveado pelo `properties.id` da feição. Um arquivo regerado com outra proporção muda o número
   e o teste fica vermelho na asserção positiva, não sem observável.

## O que o arquivo NÃO é

O `.ebgeo` **não é um dump do IndexedDB**. `exportProject` reconstrói o payload de cada mapa
(`hillshadeEnabled` e `analysisLayers` são hardcoded, e posição/basemap vêm de acessores
separados), não exporta a camada ativa por mapa, e guarda `mapOrder` num campo próprio
enquanto o disco o guarda em `ebgeo_app_settings`. A lista completa está no `@fileoverview`
de `tests/helpers/ebgeo-fixture.js`. Um verde do teste da migração diz que ela sobrevive a
ESSA forma, não a todo campo que o disco de um usuário carrega.
