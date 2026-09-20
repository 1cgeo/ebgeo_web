# dev/

Ferramentas de operação que não são nem do `frontend/` nem do `backend/`: rodam à mão,
contra um banco, e não fazem parte de nenhum build. Não têm `package.json` próprio, elas
resolvem as dependências a partir de `backend/node_modules`.

**Esta é a ÚNICA pasta de script solto na raiz do monorepo**, por decisão do dono em
2026-09-19: a antiga `scripts/` foi dissolvida nesse dia, e os dois scripts que moravam lá
SAÍRAM em vez de migrar. O contador de relatórios de auditoria contava três arquivos que não
existem desde 2026-07-25; o inventário de vendors conferia uma pasta de cópias de terceiro que
fechou em zero em 2026-09-15, junto com o manifesto que ele regravava e o teste que os prendia
um ao outro. O método e as armadilhas de medição do segundo sobrevivem em prosa, em
[`docs/wiki/inventario-de-vendors.md`](../docs/wiki/inventario-de-vendors.md). Script que sirva
ao repositório inteiro entra aqui, com seção neste README; script que sirva a um pacote entra
no `scripts/` daquele pacote.

## `tile-privado/`

O ÚNICO item desta pasta que não é um script solto: um ambiente Docker completo (nginx,
backend, servidor de tiles e uma cópia do banco de configuração) para medir o gate do tile
privado, que é a única superfície de recurso privado cujos bytes não passam pelo Node.

Ele existe porque aquele gate não tem como ser testado pelas suítes: o `auth_request` mora
na configuração do nginx, que é do host e fica fora do versionamento. As seis conferências
de lá são sonda com data, não teste, e o README delas diz o que provam e o que não provam.

```bash
npm run build --prefix frontend                    # o nginx serve frontend/dist
dev/tile-privado/scripts/preparar.sh               # dump do banco de configuração local
cd dev/tile-privado && docker compose up -d --build
```

O porquê do desenho, as decisões e o custo medido estão em
[`docs/wiki/tile-privado.md`](../docs/wiki/tile-privado.md).

## `gerar-golden-busca.mjs` + `tune-busca.mjs`

Conjunto dourado e calibrador de `GET /nomes/busca`. Exigem um acervo carregado.

```bash
node dev/gerar-golden-busca.mjs            # (re)gera dev/busca-golden.json
node dev/tune-busca.mjs                    # avalia os pesos vigentes, por família
node dev/tune-busca.mjs --ablacao          # zera um critério por vez e mede a queda
node dev/tune-busca.mjs --buscar           # procura pesos melhores, com holdout 70/30
node dev/tune-busca.mjs --pesos=exato=0,trigrama=0.37,...   # compara candidato x vigente
node dev/tune-busca.mjs --modelo=gauss --plato=10 --escala=300 --gama=0.3
```

### Modelos de ordenação

`--modelo` troca a FORMA da função, não os pesos. Existe porque o conjunto dourado
mostrou que a forma importa mais que a calibração:

| modelo | forma |
|---|---|
| `soma` | produto escalar dos 7 critérios. O de produção. |
| `produto` | casamento **multiplica** o prior: casamento ruim não é resgatável. |
| `lexico` / `lexico-contem` | faixa de casamento, depois importância, depois proximidade. A doutrina ao pé da letra. |
| `gauss` | o padrão da indústria: `casamento × proeminência^γ × decay_gaussiano(distância)`, com **platô** (`--plato`, em km) dentro do qual a distância não penaliza nada. |
| `google` | a tríade em três chaves lexicográficas: **relevância** (faixa) → **categoria** (`--tier`) → **combinação** (gauss com platô). O melhor medido. |

O `google` é o `gauss` mais um degrau **categórico**: acima de `--tier` a feição vem
primeiro independente da distância. É o que nenhuma fórmula contínua consegue, porque
numa soma (ou num produto) distância suficiente sempre compra a diferença de categoria,
já que as duas moram na mesma unidade. Medido: a família H (Cidade consultada de ~330 km,
que tem de aparecer no topo) fica em 47,6% no `gauss` contínuo e em **100%** com o degrau.

Melhor configuração medida (584 casos, acervo de 2026-07-23):

```
--modelo=google --tier=1.0 --plato=10 --escala=300 --gama=0.3      92,6% de aprovação
```

contra 81,5% da soma em produção. `--tier=1.0` significa que só `Cidade` é a categoria
"muito importante"; baixar para 0.9 (incluindo aglomerados) mede 90,6%.

O `gauss` espelha o `function_score` do Elasticsearch (decay `gauss` sobre distância +
`field_value_factor` sobre popularidade, combinados por `score_mode: multiply`), que é
como o Pelias faz, e a tríade *relevância x distância x proeminência* que o Google
documenta para resultado local. `--gama` é o `modifier` do `field_value_factor`:
γ<1 comprime a proeminência (equivalente a `sqrt`/`log1p`) e evita que multiplicar por
`tipo_peso = 0.1` esmague em 10x quem está no piso, que é 29% do acervo.

`dev/busca-golden.json` é **versionado**: é ele o ativo. O cache
`dev/.busca-atributos.json` (~23 MB) é derivado e ignorado pelo git.

### Verdade objetiva x política

Caso gerado de uma linha que espera aquela linha de volta tem verdade **circular**:
assume que a linha sorteada é a que o usuário queria. Para nome único é inofensivo;
para homônimo é a própria pergunta em disputa. Por isso há dois tipos de expectativa:

| campo | significado |
|---|---|
| `espera.alvo` | verdade objetiva: exatamente esta coordenada |
| `espera.criterio` | **política declarada** (`max_dist_km`, `tipo_in`, `tipo_peso_min`) |
| `espera.ausente` | o que não pode aparecer no top-5 (o `unexpected` do Pelias) |
| `espera.vazio` | a busca não pode devolver nada |
| `espera.topo` | posição máxima aceitável (o `priorityThresh` do Pelias) |

Política é decisão de produto, escrita em texto no JSON para ser discutida e mudada de
propósito. **Quem calibra, calibra a política**: `--buscar` acha o vetor de pesos ótimo
*para as políticas declaradas*. Mudou a política, muda o ótimo.

### Por que a ablação existe

A primeira versão do conjunto era 300 cidades pelo nome exato: recall@1 de 100%, e
**zerar cinco dos sete critérios mantinha os 100%**. Um conjunto assim passa verde com
a fórmula quase toda desligada. A ablação é o meta-teste que detecta isso: critério
cujo Δ é ~0 não está sendo exercido, e a família que deveria tensioná-lo está morta ou
faltando.

### Peso não vira assert

Qualquer peso cravado num `assert` faz toda tunagem nascer vermelha. O que a suíte
prende é **posição** (`espera.topo`); este script produz o relatório que informa a
decisão de peso.

## `import-gazetteer.mjs`

Absorve o gazetteer do banco antigo (`servico_nomes_geograficos`, schema `ng`) para o
schema `ng` deste backend: `nomes_geograficos`, `edificacoes` e `catalogo_3d`.

```bash
# dry-run: conta o que faria, não escreve (default)
node dev/import-gazetteer.mjs --source=postgresql://user:senha@host:5432/nomes_geograficos

# escreve
node dev/import-gazetteer.mjs --source=... --dedup --apply
```

| Flag | Efeito |
|---|---|
| `--apply` | Executa a escrita. Sem ela é dry-run. |
| `--dedup` | Descarta linhas idênticas em `(nome, tipo, município, estado, geom)`. No backup de 2026-07-23 são 29.544 de 81.964 (36%). |
| `--truncate` | `TRUNCATE` no destino antes de inserir. **Sem ela a carga é aditiva**, e rodar duas vezes duplica tudo. |
| `--access-level=public\|private` | A origem não tem a coluna; o destino exige. Default `public`. |
| `--skip=nomes,edificacoes,catalogo3d` | Pula tabelas. |
| `--batch=2000` | Linhas por `INSERT`. |

`DATABASE_URL` (o **destino**) sai do ambiente ou de `backend/.env`.

### Por que não é um `pg_restore` do dump

O dump do serviço antigo traz o **DDL dele**, que não é o da baseline do gazetteer deste backend: recriaria as
tabelas sem `access_level`, sem as tabelas de zona/permissão, e com a função de
`tipo_peso` antiga. Aqui viaja só o dado; schema e regras são as do backend novo.

Três colunas **não** viajam, todas por serem derivadas no destino: `tipo_peso` (trigger),
`cluster_id` (só `ng.refresh_busca()`, que o script roda ao final) e o `search_vector` do
catálogo 3D (trigger). A geometria viaja como EWKB, não WKT, para não arredondar
coordenada. O `id` também não viaja: nada tem FK para o gazetteer, então o destino gera o
seu e não precisamos da extensão `uuid-ossp`.

### A dedup não mexe no cluster, e isso foi medido

A chave da dedup inclui `geom`, então só colapsa linhas na **mesma coordenada**: duas
ocorrências distintas do mesmo nome no mesmo município continuam duas linhas. Comparando
a carga completa com a deduplicada, ambas com `refresh_busca()` rodado: 0 localidades
perdidas e 0 inventadas; 44.815 grupos de `(nome, tipo, cluster_id)` nos dois; e a
estrutura de clusters (o conjunto de grupos `{nome, tipo, pontos}`) idêntica.

O que muda é a **numeração**: `ST_ClusterDBSCAN` numera por ordem de linha, então mudar o
conjunto de linhas renumera dentro da partição `(nome, tipo)`. Não é efeito da dedup: com
a tabela intacta, `refresh_busca()` rodado duas vezes não altera um único `cluster_id`.
`cluster_id` é rótulo, não identidade: nada fora do schema `ng` o persiste.

### O acervo 3D vai para `tilesets`, e `--truncate` NÃO o alcança

A origem guarda o catálogo de modelos numa tabela do schema `ng`, e essa tabela **não existe
mais neste backend**: era o segundo catálogo de modelo 3D, sem consumidor no frontend e com um
eixo de permissão próprio que nenhuma rota escrevia. O ramo `catalogo3d` do importador foi
repontado para `public.tilesets`, que é o catálogo servido no `/api/config`, convertendo a forma
da linha na passagem: `type` vira o discriminador `config.type` (`glb` para modelo isolado,
ausente para tileset), município e estado viram `config.local`, palavras-chave viram
`config.keywords`, e o resto (URL, miniatura, posição, orientação, estilo) vai para dentro de
`config`. O `id`, que a origem não tem, é um slug gerado a partir do nome.

**`--truncate` não se aplica a esse ramo**, de propósito: `tilesets` é catálogo CURADO por
administrador e tem outros escritores, então esvaziá-la por causa de uma flag de import de
gazetteer apagaria trabalho que este script não fez. Lá a colisão de id é resolvida por
`ON CONFLICT (id) DO NOTHING` (o curador vence), e o script diz na saída quando isso acontece.
Para não carregar o acervo 3D, use `--skip=catalogo3d`.

Uma **variante ficou sem rótulo**: `tilesets` distingue só modelo isolado de tileset, então a
nuvem de pontos da origem é mapeada para tileset (o carregador certo, já que o formato é parte
do 3D Tiles) e perde a identificação de nuvem. Declarar a taxonomia de tipo do catálogo é
trabalho próprio.

## `import-config-catalog.mjs`

Importa o `config.js` do deploy legado (o arquivo estático do branch `main`, de antes do
backend) para as tabelas de catálogo: `basemaps`, `analysis_layers`, `data_layers`,
`tilesets`, e o documento de override em `config_settings.app_config`.

```bash
# dry-run: não escreve nada, só mostra o que faria (default)
node dev/import-config-catalog.mjs caminho/para/config.js

# escreve
node dev/import-config-catalog.mjs caminho/para/config.js --apply
```

Opções:

| Flag | Efeito |
|---|---|
| `--apply` | Executa a escrita. Sem ela é dry-run. |
| `--assets3d-base=/api/v1/assets3d` | Reescreve o `url` de cada modelo 3D para o prefixo dado. Sem ela o `url` vai verbatim (caso do deploy que serve `/catalogo/...` pelo nginx). |
| `--strip-prefix=...` | O que remover do `url` antes de aplicar o de cima. Default `/catalogo/modelos_catalogo/3d`. |
| `--no-overrides` | Não escreve `config_settings.app_config`. |
| `--deactivate-missing` | `active = false` nas linhas que existem no banco e não no config de origem (soft-delete, o mesmo do DELETE no painel admin). |

`DATABASE_URL` sai do ambiente; se ausente, é lido de `backend/.env`.

### O que ele NÃO escreve, e por quê

`services.tileServerUrl`, `map2d.terrainSource`/`hillshadeSource` e `map3d.providers` são
URLs de deploy e o backend as resolve por env (`TILE_SERVER_URL`, `TERRAIN_URL`,
`HILLSHADE_URL`, `MAP3D_IMAGERY_URL`, `MAP3D_TERRAIN_URL`). Gravá-las no banco congelaria
lá um endereço que o env existe justamente para trocar por ambiente.

Também fica de fora `search.apiUrl` (o gazetteer é o próprio backend, `GET /nomes/busca`) e
`streetView360` (o shape mudou de propósito: MVT servido por este backend).

Miniatura e vídeo não viajam pelo banco: o `config` guarda só o caminho. Caminho relativo
(`./images/...`) precisa existir em `frontend/public/`; caminho absoluto (`/catalogo/...`) é
servido pelo host do deploy. O dry-run confere os relativos e conta os absolutos. A
alternativa é subir a miniatura pelo painel admin, que a embute como data URL no `config`.

### Cache

A escrita é direta no banco, então ela **não** passa pelo invalidador do memo do
`/api/config` (`config.cache.js`). É exatamente o caso que o TTL de segurança cobre: a
mudança aparece em até `CONFIG_CACHE_TTL_MS` (default 30 s), ou na hora se o backend for
reiniciado.

### Windows

Use o PowerShell para as flags com caminho POSIX. No Git Bash, o MSYS converte
`--assets3d-base=/api/v1/assets3d` em `C:/Program Files/Git/api/v1/assets3d` antes do node
ver o argumento; o script detecta e aborta em vez de gravar 98 urls quebradas.

### O que ele NÃO traz do `app`

`app.tutorialUrl`. O legado aponta `./docs/doc.html`, estático do `publicDir`; pela decisão
D16, de 2026-09-15, o tutorial virou `tutorial.html`, entrada do bundler, e o padrão passou a
ser `./tutorial.html` (`config.static.js:17`). Gravar o valor legado fossiliza o caminho morto
por cima do padrão vivo, e o sintoma não é erro: o servidor de desenvolvimento devolve
`index.html` com HTTP 200 para qualquer caminho desconhecido, então o botão do tutorial abre a
própria aplicação numa aba nova. Caminho de página é decisão do frontend.

## `import-catalogo-3d-legado.mjs`

Completa o catálogo dos modelos 3D já ADOTADOS, lendo o `index.db` do `ebgeo_3d` legado. É o
passo entre `models3d:adotar` e a paridade com o que a produção serve.

```bash
node dev/import-catalogo-3d-legado.mjs --index-db=<caminho>/index.db
node dev/import-catalogo-3d-legado.mjs --index-db=... --assets-dir=<caminho>/assets --apply
```

| Flag | Efeito |
|---|---|
| `--index-db=` | o `index.db` do `ebgeo_3d`. Obrigatório, aberto somente-leitura. |
| `--apply` | executa a escrita. Sem ela é dry-run. |
| `--assets-dir=` | pasta com `<id>.webp` e `<id>.webm`. Sem ela, miniatura e vídeo não viajam. |
| `--assets-base=` | prefixo público da mídia. Default `/api/v1/assets3d`. |
| `--publicados` | pula os despublicados na origem em vez de desativá-los. |
| `--so=a,b` | restringe a estes ids (o piloto). |

O `models3d:adotar` reconstrói a linha de catálogo a partir do cabeçalho `meta` do `.3dtiles`,
que guarda a PRODUÇÃO (token, contagem de tiles, envelope) e não o CATÁLOGO. Medido no acervo
de 2026-09-16, 105 modelos: `meta.name` é o slug, e os 105 têm nome amigável, descrição,
palavras-chave e local só no `index.db`, além de 6 com `heightOffset` não-zero. Sem este passo
a travessia publica 105 cartões chamados `13bib`, `4rcb`, `cmdo14bda`.

A miniatura só é gravada quando o arquivo EXISTE na pasta apontada: a origem tem
`preview_thumb` nulo nos 105 e o serviço antigo deriva o caminho por convenção, então derivar
sem conferir gravaria 105 URLs que respondem 404.

Readotar depois deste script devolve ao arquivo apenas `name` e `heightOffset` (o `UPSERT`
sobrescreve o nome e mescla o `config` com o lado do arquivo vencendo). A ordem é adotar,
enriquecer, e repetir o enriquecimento depois de qualquer readoção.

## `import-catalogo-360-legado.mjs`

Completa `description` e `location` dos projetos 360 já importados, lendo o `index.db` do
`ebgeo_360` legado.

```bash
node dev/import-catalogo-360-legado.mjs --index-db=<caminho>/index.db [--apply] [--so=a,b]
```

O `sv360-import.js` monta o manifesto do projeto com slug, nome, centro, foto de entrada, data
e arquivo (`sv360-import.js:359-373`), e nem ele nem o `mergeProject` tocam nesses dois campos,
embora as colunas existam nas duas pontas e a API nova as SIRVA (`sv360.queries.js:70`). Os 36
projetos do servidor têm as duas preenchidas. O conserto definitivo é uma linha no manifesto,
mas ele mexe no núcleo COMPARTILHADO com o envio online do painel e pede revisão do dono.

Ele só preenche campo VAZIO, nunca sobrescreve o que um administrador escreveu pela tela.

## `import-estilos-basemap.mjs`

Grava o estilo MapLibre exato de cada mapa base no catálogo, lendo `src/js/baselayers/*.js` do
checkout da `main`.

```bash
node dev/import-estilos-basemap.mjs --origem=<caminho>/ebgeo_web_main/src/js/baselayers [--apply]
```

| Flag | Efeito |
|---|---|
| `--origem=` | a pasta `src/js/baselayers` do checkout da `main`. Obrigatória. |
| `--apply` | executa a escrita. Sem ela é dry-run. |
| `--sprite-verbatim` | não reescreve o `sprite` absoluto. |
| `--so=a,b` | restringe a estes ids de mapa base. |

Os construtores estáticos de `config.static.js:214-225` cobrem cinco ids genéricos, montando um
raster de uma camada a partir das URLs do ambiente. O que a produção serve são outros quatro,
desenhados: a Topográfica do Overture (12 fontes, 190 camadas), a Ortoimagem do Overture (16 e
136), a DSG do atlas Perseu (5 e 97) e o BDGEx. Sem estilo, `osm-overture` e
`overture-ortoimagem` caem no fallback do frontend e a tela mostra DUAS cartas topográficas
iguais. São 237 KB, e o `/api/config` vai de 23 para 259 KB.

A única coisa que ele muda no estilo é o `sprite`, de URL absoluta do nome público para
caminho relativo ao documento (`./images/sprite`), que é a forma que o `glyphs` do mesmo
arquivo já usa. Caminho de raiz (`/ebgeo/images/...`) não serve: o app é servido sob `/ebgeo/`
em produção e na RAIZ pelo servidor de desenvolvimento, e ali ele cai no fallback de SPA e
volta o `index.html` com HTTP 200, com o sintoma de ícone que não desenha e console limpo.

**A ORDEM É CONTRATO.** `import-config-catalog.mjs` SUBSTITUI o `config` de cada mapa base, não
o mescla, então uma reimportação do config derruba os quatro `style` de volta a nada. Config
primeiro, estilos depois, sempre.
