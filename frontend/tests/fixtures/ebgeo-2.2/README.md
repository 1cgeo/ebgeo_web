# Fixtures `.ebgeo` do schema 2.2

Cópias byte-a-byte de `_ebgeo_dados_teste/` (sha256 conferido na cópia), geradas dirigindo o
app de `main` e exportando pelo caminho de produção. Nada neste repositório as edita.

| arquivo | sha256 | conteúdo |
|---|---|---|
| `01-completo.ebgeo` | `309ecc2c…6488c` | 11 mapas, 262 feições, 17 camadas, 2 grupos, 2 briefings (2+3 slides), 2 ícones customizados, 5 PNG |
| `02-minimo.ebgeo` | `f26b044e…3130b` | 1 mapa, 1 feição, 1 camada, nada mais |

Quem as lê: `tests/helpers/ebgeo-fixture.js` (leitor + semeador) e
`tests/integration/migracao-22-para-23-fixture-real.test.js`.

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

2. **`data.version` é `'2.2'` e `data.currentMap` é `'Principal'`.** O primeiro é a versão de
   partida da migração; o segundo é comparado com o valor que `initializeRepository()`
   devolve.

## O que o arquivo NÃO é

O `.ebgeo` **não é um dump do IndexedDB**. `exportProject` reconstrói o payload de cada mapa
(`hillshadeEnabled` e `analysisLayers` são hardcoded, e posição/basemap vêm de acessores
separados), não exporta a camada ativa por mapa, e guarda `mapOrder` num campo próprio
enquanto o disco o guarda em `ebgeo_app_settings`. A lista completa está no `@fileoverview`
de `tests/helpers/ebgeo-fixture.js`. Um verde do teste da migração diz que ela sobrevive a
ESSA forma, não a todo campo que o disco de um usuário carrega.
