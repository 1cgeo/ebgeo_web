# E0 — relatório do instrumento

Fechado em 2026-08-15. **Nenhuma linha de `frontend/src/` foi alterada por esta etapa**
(os 9 arquivos modificados em `src/` são os mesmos da fase anterior do namespace).

Estado da suíte do frontend: **3803 passando, 16 `expected fail`, 7 todo, em 5,92 s.**

---

## 1. O que existe agora

| arquivo | papel |
|---|---|
| `package.json` / `vitest.config.js` / `tests/setup/` | `fake-indexeddb@6.2.5` ligado |
| `tests/helpers/idb-helpers.js` | semear e ler banco por NOME ABSOLUTO, listar, distinguir banco ausente de banco vazio |
| `tests/unit/idb-instrumento.test.js` | prova que o localforage está no driver INDEXEDDB e não caiu para memória |
| `tests/unit/idb-decisao4-medicao.test.js` | re-medição da Decisão 4 de `atlas-namespace.js` |
| `tests/unit/multiaba-invariantes.test.js` | a sonda temporária virou instrumento permanente (21 casos) |
| `tests/integration/migracao-22-para-23-fixture-real.test.js` | migração dirigida pelas fixtures reais do `main` |
| `tests/helpers/ebgeo-fixture.js` + `tests/fixtures/` | leitura do `.ebgeo` e semeadura de uma instalação 2.2 |
| `tests/e2e-ui/browser-multi-tab-namespace.spec.js` + `helpers/two-tabs.js` | duas páginas no MESMO contexto (compartilham IndexedDB) |
| `browser-save-local-to-server.spec.js` | ganhou a leitura de `indexedDB.databases()` depois do save |

## 2. O que o instrumento PROVA

Medido, não suposto:

- **Não está medindo outra cópia do sujeito.** Depois de `vi.resetModules()`, o app e os
  helpers usam a MESMA instância de módulo do localforage (`lfApp === localforage`), e
  `getStore(MAPS)` / `getStore(OPERATION_QUEUE)` / `getGlobalStore()` resolvem para
  `asyncStorage` com o banco aparecendo em `indexedDB.databases()`.
- **Os 16 `it.fails` falham por AssertionError**, nunca por erro de import ou setup. Foram
  convertidos em `it` normal um a um e as 16 mensagens lidas
  (`expected 'local' to be 'remote'`, `expected '2.1' to be '2.3'`, `expected +0 to be 168`...).
  Um `it.fails` que falha por `ReferenceError` também ficaria verde, e não é o caso de nenhum.
- **Sensibilidade medida por mutação em `src/`, com reversão conferida por hash:** colapsar
  `resolveDbName` para ignorar o sufixo produz 14 vermelhos; desligar o backfill de
  `v2-to-v2.1` produz exatamente 1, o certo; remover o carimbo do slot montado em
  `migrateToV2_3` produz exatamente 1, o certo; quebrar `adoptRemoteAtlasAsLocal` produz 3.
- **Determinismo:** 8/8 rodadas em série idênticas no arquivo de invariantes, 10/10 no de
  migração, e 3 rodadas da suíte completa sem outra falha.
- **As fixtures conferem por caminho independente.** Reabertas em Python sem tocar no código
  do harness: `01-completo` tem 11 mapas, 262 feições, 17 camadas, 2 grupos, 2 briefings com
  5 slides, 2 ícones, 5 PNG, `version 2.2`. O sha256 das cópias no repositório é idêntico ao
  de `_ebgeo_dados_teste`, então nada foi derivado ou transcrito.

## 3. O que o instrumento NÃO prova

Escrito por extenso, porque instrumento que se anuncia completo e não é vale menos que nenhum:

- **`fake-indexeddb` é uma implementação em processo.** Ele não reproduz o comportamento de
  `blocked` entre ABAS reais. Todo caso "duas abas" no vitest é, na verdade, uma aba que trocou
  de escopo, e uma implementação que apenas pule o escopo ATIVO satisfaz esses testes sem
  nenhum Web Lock. O requisito cross-tab só vive no caso A3 do Playwright.
- **O `.ebgeo` NÃO é o registro de disco.** `exportProject` reconstrói cada mapa, com
  `hillshadeEnabled` e `analysisLayers` embutidos, e `id: null` onde o `main` grava
  `id: <nome do mapa>`. A semeadura prova que a migração sobrevive à reconstrução do
  exportador, não ao registro que o usuário tem no disco.
- **As fixtures não cobrem sincronização.** `main` roda sem backend, então nada de atlas
  remoto, comentário espacial ou feição de análise processada.

## 4. Achados sobre `src/`, com a etapa que os fecha

### 4.1 A medição da Decisão 4 se confirmou na substância, e o texto está errado no detalhe

Reproduzida com o localforage REAL: criar banco novo completou 21/21; criar object store dentro
de banco compartilhado deu 0/21 com `blocked` 21/21. **A decisão de pôr o namespace no nome do
banco está certa.**

Mas o `@fileoverview` de `src/js/store/atlas-namespace.js` (linhas ~23-28 e ~121-125) afirma o
`pending` como propriedade da OPERAÇÃO, e a medição mostra que com a válvula
`db.onversionchange` do localforage os cenários C e E completam 21/21. O texto precisa dizer
"sem a válvula". **Pendência de E1**, porque E0 não pode tocar `src/`. Nenhum guarda da casa
pega isso: `docs-integridade` valida caminho e símbolo, nunca a veracidade de uma medição
citada em prosa.

### 4.2 O furo do ATAQUE 1b: veredito

O caso foi partido em dois e o corpo do ataque finalmente executou. Registrado em
`multiaba-invariantes.test.js`, grupo 2, com a ressalva do item 3 acima: o cenário é
single-process, então ele cobra um invariante mais fraco que o de E2.

### 4.3 A cadeia de migração está ancorada em nomes FIXOS

Confirmado e vermelho pela razão certa (`expected '2.1' to be '2.3'`, `expected +0 to be 168`,
sem `ReferenceError`): `v2.2-to-v2.3.migration.js:211-212` carimba o slot montado enquanto os
quatro degraus rodam contra os nomes fixos de `migration.service.js:17-18`. Um slot #2 com dado
antigo nunca migra. **Fecha em E5.**

## 5. Pendências registradas, por decisão

### 5.1 Flake do Playwright: 1 em 6 — REGISTRADO, NÃO CORRIGIDO

`browser-multi-tab-namespace.spec.js` reprova a rodada inteira por timeout em 1 de 6 execuções,
e `test.fail` não cobre timeout. **Decisão do dono em 2026-08-15: registrar e seguir.** O caso
fica marcado como instável até E7, que é quando ele vira portão de verdade. Antes de E7 esse
flake precisa estar fechado, ou o portão não vale: um caso instável no portão é pior que portão
nenhum, porque a próxima falha real é lida como "é o de sempre".

### 5.2 a 5.5 — CORRIGIDOS antes do fecho. Ficam aqui como registro do que foi consertado.

> **Correção deste relatório, 2026-08-15.** A primeira versão listou os itens 5.2 a 5.5 como
> pendências abertas. Estava errado: o agente de fecho já os havia aplicado, e a conferência
> no código confirma. O que segue descreve o defeito que existiu e a correção que está no
> arquivo hoje, porque a forma do defeito é reaproveitável e vale mais que o registro de que
> ele existiu.

**Verificado no código, item a item:**

- Grupo 2 (`multiaba-invariantes.test.js`): o controle agora registra um TERCEIRO atlas remoto
  que DEVE morrer, e chama `purgeAllRemoteAtlases()`, sob o comentário "a MESMA chamada de que
  os dois `it.fails` abaixo dependem".
- Grupo 3: o controle passou a chamar o helper real do cenário, e o comentário registra a
  medição que condenou a versão anterior ("with a `throw` on the first line of the wipe, the
  control and both `it.fails` of this group stayed green").
- Controle do resgate: ganhou o atlas `Z` não adotado, com asserção de que ele morre na mesma
  varredura em que o adotado sobrevive. "Poupou" e "não varreu" deixaram de ser a mesma resposta.
- Migração: `ATLAS_SCHEMA_VERSION` é importado e asserido; `activeMap` é capturado do
  `runBoot()` e comparado com `fixture.data.currentMap`, mais a conferência de que ele existe
  entre as chaves reais de `ebgeo_maps`; `mapOrder` passou a ser semeado e asserido.
- O `@fileoverview` passou a declarar a proveniência honesta do observável `sizeCreatedAtZoom`
  (o gerador cria feições pela API do store, e não é o que a ferramenta de ponto grava), e o
  braço do marcador legado (`readLegacyOrigin` / `promoteLegacyOrigin`) foi endereçado.

**A forma do defeito, que é o que vale reaproveitar:** um controle que exercita o HELPER
compartilhado do grupo, mas para antes do passo destrutivo de que os casos dependem. Harness
morto e defeito vivo ficam indistinguíveis exatamente onde importa. Ao escrever controle para
`it.fails`, o controle tem que executar a MESMA chamada destrutiva, e o cenário precisa de um
segundo alvo que DEVE morrer.

<details>
<summary>Descrição original dos três casos (histórico)</summary>

Três casos, todos medidos por mutação:

- **Grupo 3 (link público)**, `multiaba-invariantes.test.js:355`. Com `clearAllDataStore`
  lançando, o controle E os dois `it.fails` seguem verdes. O controle inlina uma cópia do
  cenário que para ANTES do wipe, em vez de chamar o mesmo helper dos `it.fails`. Quando E1
  fechar, se o wipe quebrar no mesmo commit ninguém percebe.
- **Grupo 2 (expurgo)**, `:284`. Com `purgeAllRemoteAtlases` lançando, o par que precisa ser
  promovido em E2 fica verde. Quem denunciou a mutação foi o controle de OUTRO grupo.
- **Controle positivo do resgate**, `:481`. Com o expurgo virado no-op o teste fica verde,
  porque só existe um atlas remoto no cenário e "poupou o adotado" e "não varreu nada" são a
  mesma resposta.

**A correção dos três é a mesma forma:** o controle precisa executar o MESMO passo destrutivo
de que os `it.fails` dependem, e o cenário precisa de um segundo atlas que DEVE morrer.

### 5.3 Asserções que não olham para o que o comentário promete

- `migracao-22-para-23-fixture-real.test.js:294`: sob o comentário "o boot escolheu um mapa do
  dado do usuário", a asserção é sobre o ARQUIVO `.ebgeo`. `runBoot()` devolve `activeMap` e o
  valor é descartado. Este verde sobrevive à chamada de `runBoot` inteira comentada.
- `ATLAS_SCHEMA_VERSION` nunca é importado pelo harness: todos os `'2.3'` são literais. A forma
  mais cara de errar uma migração (criar o degrau e esquecer de subir a constante) passa verde.

### 5.4 O observável do teste de migração é artefato do gerador

O `@fileoverview` afirma que as 168 feições de ponto não carregam `sizeCreatedAtZoom` porque
"essa é a forma que o app de `main` grava". É falso: `add_point_control.js:548` grava a
propriedade em todo ponto criado pela ferramenta. Elas não a têm porque o gerador chama
`store.addFeature` com GeoJSON montado à mão. **Se as fixtures forem regeradas pela ferramenta,
o controle positivo fica vermelho sem que nada no código mude.** Ou o observável muda, ou o
texto passa a dizer a verdade e o README das fixtures registra a dependência.

### 5.5 O braço `origem = REMOTE` testava um estado impossível (corrigido, ver 5.2)

`seedRemoteOriginInstall` semeia o marcador em `ebgeo_global`, que é o home PÓS-namespace,
enquanto o teste vizinho assere que uma instalação 2.2 NÃO tem `ebgeo_global`. O caminho real
de quem sobe de 2.2 é `readLegacyOrigin()` + `promoteLegacyOrigin()`
(`store-origin.js:82-115`), que nunca executam nesse harness. Sondado à parte: **o app está
certo, converge igual.** O que não está provado é que o teste prova isso.

</details>

### 5.6 Pendências que seguem ABERTAS depois do fecho

Só duas:

1. **O flake de 1 em 6 do Playwright** (item 5.1). Registrado por decisão, fecha antes de E7.
2. **O texto da Decisão 4** no `@fileoverview` de `atlas-namespace.js` (item 4.1). Correção de
   prosa, entra em E1 junto com as mudanças daquele arquivo.

---

## 6. Nota de processo

Uma rodada de medição foi contaminada: `atlas-namespace.js` e `store.js` foram reescritos
durante a execução de outro agente, o que tornou aquela medição suspeita e produziu 6 falsos
vermelhos. As medições relatadas aqui são as refeitas depois que as escritas pararam. A lição
é de orquestração, não de código: **agente que muta `src/` para testar sensibilidade não pode
rodar em paralelo com agente que mede.**
