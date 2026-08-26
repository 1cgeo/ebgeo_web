# Pendência: o link de compartilhamento, e a estabilidade dele entre versões

Aberta em 2026-08-26, a pedido do dono. Este arquivo existe para que o trabalho não seja
redescoberto, e porque ele precisa acontecer em DOIS branches.

## O pedido, em uma frase

Compartilhar um recurso PÚBLICO específico (camada base, modelo 3D, foto 360) por um link que já
abre num lugar. E o link tem que ser ESTÁVEL entre versões, incluindo os do 360 e do 3D que já
existem hoje.

**Onde aplicar: nos dois branches, `main` e `integracao_backend`.** Não é escolha entre eles. Um
link emitido por uma versão precisa abrir na outra, e é isso que a seção de estabilidade cobra. O
trabalho de código é o mesmo nos dois; o que muda é a origem do identificador, e essa diferença é o
risco central deste documento.

## Estado medido em 2026-08-26

O que segue foi medido, não deduzido. Onde a medida não alcançou, está dito.

**A mecânica do deep link passa.** Playwright com backend e Postgres reais, alvo
`frontend/tests/e2e-ui/deep-link.spec.js`: 4 de 4. Detecção da gramática, limpeza do hash, DOM do
3D abrindo, e o ouvinte de mudança de hash reagindo a link colado em aba já aberta.

**O recurso público chega ao visitante deslogado.** Sonda temporária, depois apagada: semeei camada
base, tileset e foto 360 públicos com os semeadores de
`frontend/tests/e2e-ui/helpers/catalog-seed.js` e abri o app SEM sessão, com o link do 360 na URL.

```
autenticado? false
basemaps visiveis: ["carta-topografica","carta-ortoimagem","bdgex","osm","imagens","bm-e2e-…"]
tilesets visiveis: ["tileset-e2e-…"]
200 /api/v1/sv360/photos/by-name/foto-e2e-….jpg
viewer 360 aberto? true
```

**O que essa sonda NÃO prova.** Os pedidos seguintes (a pirâmide e a imagem) voltaram 422, porque o
id que `seedSv360Photo` grava não tem forma de UUIDv5 e as rotas validam a versão. É artefato do
semeador, não do produto. Ou seja: está provado que o link resolve o metadado e abre o
visualizador, e NÃO está provado que os bytes do panorama pintam.

## O contrato de URL

A gramática abaixo é IDÊNTICA nos dois branches hoje, chave a chave e casa decimal a casa decimal.
Conferida lendo a cópia de `main` contra a deste branch. A partir do momento em que o link vira
produto compartilhado, ela para de ser detalhe de implementação e passa a ser contrato congelado.

```
#view=360&photo=<nome>&lon=<g>&lat=<g>&fov=<g>
#view=3d&tileset=<id>&lon=<g>&lat=<g>&h=<m>&heading=<rad>&pitch=<rad>&roll=<rad>
#view=fp&scene=<id>&x=<m>&y=<m>&z=<m>&yaw=<rad>&pitch=<rad>
```

Regras que a estabilidade impõe, e que valem para o quarto tipo que este documento propõe:

- **Chave nova só ADITIVA.** Renomear ou remover chave mata todo link já distribuído.
- **Parâmetro ausente cai no padrão, nunca no zero.** `parseDeepLink` já recusa texto que não leia
  como número finito, e `resolveFpPose` já mostra o molde: componente faltando volta ao padrão da
  cena, e pose meio montada é descartada inteira.
- **Chave desconhecida se ignora em silêncio.** É o que deixa uma versão nova emitir link que uma
  versão velha ainda abre, perdendo só o que ela não entende.
- **A gramática entra em `docs/wiki/sintese-contratos-congelados.md`** no mesmo commit em que o link
  da camada base nascer. Contrato que não está na lista de congelados não é congelado.

## O que falta construir: o link da camada base

É a única das três superfícies sem link. A gramática proposta segue a família (nomes em prosa, sem
crase, porque o código ainda não existe):

```
#view=base&base=<id>&lon=<g>&lat=<g>&z=<n>&b=<bearing>&p=<pitch>
```

Os ids de camada base já são texto estável e legível (carta-topografica, bdgex, osm), então cabem
na URL sem tradução.

**Quatro pontos que decidem se funciona:**

1. **Aplicar DEPOIS do switch de mapa, e não dentro do evento de carga.** `switchMap` termina em
   `applyMapSavedPosition` (`frontend/src/js/baselayers/base-layer.control.js`), que faz `jumpTo`.
   Aplicado antes, o link é sobrescrito pela posição salva e o defeito é mudo. É a ordem INVERSA à
   do 360 e do 3D, que rodam dentro do manipulador de carga (`frontend/src/js/map_sig.js`).
2. **Trocar sem persistir.** `switchLayer` aceita a opção que pula a persistência. Nunca
   `setBaseLayer`: ele enfileira op de sync e mudaria a camada base do mapa para todos os
   colaboradores de quem apenas ABRIU um link.
3. **O fallback silencioso.** `getValidBasemapFallback` (`frontend/src/js/config.helpers.js`) só
   aceita camada com o campo de habilitação ligado. Um atlas que desligou aquela camada faz o link
   cair na primeira habilitada SEM dizer nada. O abridor precisa nomear a troca, pela mesma regra
   que o resto do app já segue: a recusa deriva da capacidade negada, e chega junto do gesto.
4. **O botão não é o que já existe.** O seletor de camada base já tem um botão por linha, com o
   `data-testid` de compartilhamento, e ele abre o modal de CONCESSÃO de recurso. Copiar link é
   outro gesto e precisa de outro posto. O utilitário de cópia já está pronto: `copyShareUrl`.

## Estabilidade: os três espaços de identificador

O link é estável se, e só se, o identificador que ele carrega significar a mesma coisa nas duas
versões. São três espaços, e eles têm três estados diferentes.

| recurso | o que o link carrega | estado |
|---|---|---|
| camada base | a chave da camada | **MEDIDO, estável.** As cinco chaves de `main` (carta-topografica, carta-ortoimagem, bdgex, osm, imagens) apareceram idênticas no config do visitante anônimo deste branch. |
| foto 360 | `currentPhotoName`, o nome original do arquivo | **PROVÁVEL, não medido.** Os dois branches emitem a mesma propriedade. Falta confirmar que o `original_name` do acervo ingerido é igual ao nome de arquivo que a versão estática servia. |
| modelo 3D | o id do tileset | **PERGUNTA ABERTA, e é o risco.** Ver abaixo. |

**O caso do 3D, por extenso.** Em `main` o catálogo vem do serviço ebgeo_3d, e o id do link é o id
que aquele serviço publica. Neste branch aquele módulo de serviço não existe mais: o catálogo vem
da tabela de tilesets do backend, cuja chave primária é texto escolhido no cadastro
(`backend/src/database/migrations/005_catalogo.sql`). Nada no repositório garante que a carga
preservou os ids antigos. **Se não preservou, todo link 3D já distribuído morre na virada, em
silêncio, com a mensagem de modelo não encontrado.**

Isso se resolve com uma medida, não com uma opinião: listar os ids que o serviço ebgeo_3d publica
em produção, listar os ids da tabela de tilesets, e comparar. A medida vem ANTES de qualquer código
deste documento, porque a resposta muda o trabalho. Se os conjuntos divergirem, o conserto é um
mapa de id antigo para id novo, consultado quando a busca direta falha, e ele precisa nascer junto
com o link, nunca depois.

## Dois defeitos que existem, e não mordem o caso público

Ficam registrados para não serem redescobertos, e porque mordem no dia em que alguém pedir link de
recurso privado.

1. **O construtor descarta a query.** Os três construtores de
   `frontend/src/js/deep-link/deep-link.js` montam a URL a partir da origem e do caminho, então os
   parâmetros de atlas e de mapa morrem. Medido com a query presente na entrada. Conserto barato:
   preservar a busca. Vale fazer junto, mesmo sem urgência.
2. **O escopo de atlas não alcança o deep link.** `handleDeepLink` roda dentro do manipulador de
   carga, e quem declara o escopo é `refreshVisibleResources`, chamado na conexão
   (`frontend/src/js/store/sync/sync-engine.js`), depois. Medido: com sessão viva e o parâmetro de
   atlas na URL, o pedido saiu para a rota de foto sem o parâmetro de atlas. O ramo de empréstimo
   de `readScope` (`backend/src/modules/streetview360/sv360.service.js`) morre, e o recurso
   emprestado volta 404.

Nenhum dos dois atinge recurso público, que é o pedido de hoje.

## Como isso se verifica

Sem controle negativo, nada disto é verificação.

1. **A vista compartilhada vence a posição salva.** Um spec carrega a URL e lê `__ebgeoMap` (já
   exposto por `frontend/src/js/map_sig.js`), conferindo centro, zoom, bearing, pitch e a camada
   base ativa contra o link. *Controle negativo:* aplicar o link ANTES do switch de mapa deixa a
   asserção de posição vermelha. Se ela ficar verde, o teste está medindo a posição salva e não a
   compartilhada.
2. **Abrir link não escreve.** Depois de abrir, a fila de saída não ganhou op de camada base.
   *Controle:* trocar `switchLayer` por `setBaseLayer` faz o teste reprovar.
3. **A gramática atravessa as versões.** Um vetor dourado de links, escrito à mão, lido pelo
   `parseDeepLink` dos DOIS branches, produzindo o mesmo descritor. É o único teste que prende a
   promessa de estabilidade, e ele precisa existir nos dois lados.
4. **O que teste nenhum daqui alcança:** que os ids de tileset de produção sejam os mesmos. Isso é
   sonda com data, rodada à mão contra o acervo, com o resultado anotado aqui.

