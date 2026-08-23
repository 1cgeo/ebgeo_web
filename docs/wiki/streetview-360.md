# Módulo StreetView 360 (sv360)

Repositório de panoramas em `/api/v1/sv360`: é a exceção do backend em envelope, em cache e em sync, e quase toda armadilha do módulo nasce de uma dessas três exceções.

## Duas coisas chamadas "360" (a confusão mais cara)

- O módulo `sv360` (backend, `src/modules/streetview360/`) é o acervo de panoramas do servidor: projetos, fotos, grafo de navegação, imagem WebP.
- A entidade de sync `streetview360` é outra coisa: marcadores e orientações que o usuário salva **por mapa do atlas**, que trafegam pelo [[canal-collab-websocket]] e vivem no side-store do cliente.

Cuidado adicional desde 2026-08-14: **existem agora três superfícies imersivas**, não duas. A cena de primeira pessoa ([[primeira-pessoa-3d]]) é a terceira, e ela não segue o desenho do 360 em dois pontos que costumam ser copiados por analogia: ela não tem minimapa (a posição do observador é local, em metros, e não há como saber onde aquele metro cai no mundo) e **nada do que acontece dentro dela persiste**, nem local nem por sync. Antes de estender um comportamento "das duas superfícies" para as três, confira qual das duas premissas ele usa.

O módulo `sv360` está **fora** do sync: nenhuma escrita 360 vira operação, nenhum peer recebe broadcast. Depois de um `PUT .../calibration` o cliente **recarrega** `GET /sv360/photos/:uuid`; quem esperar evento espera para sempre. Ver [[sintese-modulos-fora-do-sync]]. Consequência de esquema: `sv360.photos` tem `updated_at` mas nenhuma coluna `version`, e `sv360.targets` não tem nenhuma das duas; não há como enxertar LWW aqui sem migração.

## Envelope: por que o módulo destoa do resto da API

O envelope nu e o erro plano são contrato congelado herdado do viewer legado, declarado em [[sintese-contratos-congelados]] (dono canônico do fato). O que importa aqui é quem o impõe: um error handler de **router**, montado por último, que intercepta antes do global (`backend/src/modules/streetview360/sv360-error.js`). É por isso que corrigir o envelope do módulo pelo handler global não tem efeito nenhum ([[erros-api]], [[sintese-contrato-erros-http]]).

Armadilha de cliente: o REST genérico desembrulha `data` sempre que a resposta é objeto não-array contendo essa chave. Hoje nenhum shape do sv360 tem `data`, então tudo passa intacto, mas **acrescentar um campo `data` a qualquer resposta do sv360 mutila o corpo silenciosamente no cliente**, sem erro. Por isso as chamadas sv360 vivem apartadas em `frontend/src/js/store/sync/api-client.js`.

Do handler, o que não é óbvio: erro Joi vira **422**, mas os params de tile viram **400** por caminho próprio (`backend/src/modules/streetview360/sv360.routes.js`), porque o contrato MVT quer 400 em coordenada malformada. E `23505`/`23503` são mapeados para **409** dentro do handler de router; o global já fazia isso, mas o de router intercepta primeiro, e sem essa branch um target duplicado voltava 500.

## Cache: o único ponto onde o "immutable" tem escopo variável

Toda imagem/thumbnail é imutável, mas o **escopo** depende dos **dois** eixos (`setImmutableHeaders`, `backend/src/modules/streetview360/sv360.controller.js`): só `enabled` **e** `public` sai `public, immutable`; qualquer outra combinação sai `private` + `Vary: Authorization, Cookie`. Um cache compartilhado só pode guardar resposta que todo mundo pode ver.

Até 2026-08-18 essa decisão olhava **só o status**, e a imagem de um projeto `enabled + private` (um recurso que só alcança quem tem concessão ou empréstimo) saía `public, max-age=1ano, immutable`, ou seja, entregue a um proxy para repor a qualquer um pelo ano seguinte. O eixo de privacidade nasceu antes e nem a prosa nem o código o tinham aprendido. É a razão de `enabled + public` continuar público sem consultar empréstimo nenhum: **recurso público nunca dependeu de empréstimo para ser entregue**.

Não existe um `immutable` uniforme para todo o 360, apesar de a documentação de origem tabelar assim. O TTL longo vale só para imagem e thumbnail; o tile MVT e o feed GeoJSON usam 60 s, porque a camada de pontos muda a cada ingestão, tombstone ou toggle. As rotas JSON ganharam `private, no-cache`, e todas seguem a mesma regra, que hoje mora num lugar só e serve também catálogo e payload aditivo (`respostaEscopada`, `backend/src/utils/cache-scope.js`): resposta que dependeu de quem pediu não é publicamente cacheável, e "quem pediu" inclui o **atlas em foco**, porque um atlas `is_public` dá `read` a chamador anônimo e a resposta dele pode carregar recurso emprestado.

**O ETag do tile é hash do corpo, e isso não é detalhe de implementação.** Um ETag que identificasse a tile (z/x/y) prometeria que o mesmo endereço tem o mesmo conteúdo para todo mundo, que é o vazamento do `Cache-Control: public` pela porta dos fundos; derivá-lo do corpo incorpora o conjunto de visibilidade por construção, sem consulta extra. Ele é **fraco** de propósito (`ST_AsMVT` nunca teve `ORDER BY`, então dois tiles com as mesmas feições podem diferir em bytes), e por isso nenhum teste pode afirmar um ETag literal.

Armadilha deliberada no protocolo de Range: `Content-Length`/`Content-Range` derivam do **buffer realmente lido**, não do `size_bytes` do Postgres. Em regime normal coincidem; na janela entre o swap do arquivo e o commit da ingestão podem divergir, e confiar no buffer mantém toda resposta protocolarmente correta. Não "otimize" isso lendo o tamanho do Postgres. Mesma família de [[assets3d-distribuicao]] e [[sintese-cache-http-imutavel]].

O 304 acontece **antes** de abrir o SQLite e **antes** do semáforo de concorrência: é isso que torna revalidação barata, e é a razão de o ETag vir só de colunas de tamanho no Postgres. Mover o cálculo do ETag para o BLOB destruiria a propriedade.

## São DOIS eixos de acesso, e só um deles mora aqui

- **Ocultação** (`status`): `disabled` esconde de todo mundo fora da OM **produtora**, inclusive de quem tem concessão e do credenciado. É o eixo que `isProjectReadable` decide, em JavaScript.
- **Privacidade** (`access_level`): `private` restringe quem está de fora e nunca a OM produtora. Ele **não** é decidido ali, e sim no `WHERE` das nove consultas do módulo, porque resolvê-lo exige saber de concessão e de empréstimo ([[acesso-a-recurso-privado]]). Consequência que confunde na leitura: um projeto `enabled + private` é considerado legível por `isProjectReadable`; quem o entregou foi o SQL, que só o entrega a quem pode vê-lo.

**A OM comparada é a de PRODUÇÃO, nunca mais a de lotação.** Até 2026-08-17 a comparação era com `users.organization_id`, que o auto-cadastro deixa a pessoa escolher: escolher a OM certa num formulário anônimo comprava o acervo oculto e privado dela. Hoje é `producer_org_id`, que só um administrador concede.

Isso mudou **quem** recebe cada código. Projeto oculto responde **404**, indistinguível de inexistente, e nas escritas a escada é **404 para 403** (`backend/src/modules/streetview360/sv360.write.service.js`): quem não lê nem sabe que existe; quem lê e não escreve recebe 403. O que mudou é o segundo caso: um membro comum da OM dona **não** lê mais o projeto oculto, então ele recebe 404 onde a versão anterior desta página prometia 403; quem recebe 403 é quem enxerga o projeto (qualquer conta, num projeto `enabled`) e não o produz. **Não trate 404 do sv360 como "não existe"**: pode ser "existe e não é seu".

**Onde a regra mora, exatamente, e o buraco que ficou um tempo aberto.** As leituras de projeto e o feed de tiles sempre carregaram o predicado no SQL. As **quatro consultas de foto** (`GET_PHOTO_BY_ID`, `GET_PHOTO_BY_NAME`, `GET_PHOTO_SIZES`, `NEARBY_PHOTOS`) não carregavam nenhum, e a decisão ficava só no service, enquanto o comentário de `isProjectReadable` afirmava em voz alta que "nenhuma linha chega aqui sem ter passado pelo SQL". A afirmação era falsa e nada ficava vermelho, porque uma foto entregue é uma resposta bem-formada: um projeto `enabled + private` entregava metadado, imagem e vizinhança a quem soubesse o uuid, e `/photos/nearest` os entregava **por coordenada**. As quatro passaram a carregar `sv360AccessPredicate` em 2026-08-18, e quem cobra a propriedade hoje não é a frase, é o censo de superfícies: uma quinta consulta de foto sem predicado reprova **por nome**.

Duas consequências do formato do predicado, que ninguém adivinha: ele entra no `WHERE` de `GET_PHOTO_BY_NAME` e não no desempate, então um `original_name` que colida entre um projeto privado e um público entrega o **público** ao anônimo; e a releitura que monta a resposta de uma escrita de calibração passou a receber o principal, porque relê-la sem ele devolveria zero linha e a escrita responderia 404 **depois** de gravar.

## `?atlasId=` nas leituras: o empréstimo alcança o 360, e o UUID não autoriza

Um atlas empresta os recursos privados que anexou a quem o abre, e desde 2026-08-18 isso vale também para o 360 sobre HTTP: o parâmetro `?atlasId=` é aceito por **todas** as leituras do módulo e vai para o braço de empréstimo do predicado.

O que precisa estar escrito, porque a leitura de uma rota isolada não entrega: **o UUID do atlas não é senha**. Ele diz qual empréstimo o chamador quer usar, nunca que ele pode usá-lo, e o predicado sozinho não pergunta se o chamador participa daquele atlas. Por isso toda rota de leitura carrega a mesma tripa, e a ordem é contrato: `validate` (não-UUID vira 422 na borda) → `liftOptionalAtlasId` (os gates de atlas leem `req.params`) → `requireAtlasScopeWhenPresent`. Atlas inalcançável **propaga o 404** em vez de degradar para escopo vazio, escolha deliberada: degradar tornaria falha de autorização indistinguível de "este atlas não empresta nada". Sem `atlasId` não há gate, porque abrir o 360 pela URL sem atlas em foco é o caminho anônimo normal.

Esta é a virada de uma decisão anterior: enquanto o eixo estava desligado, o argumento registrado era exatamente que ligá-lo sem gate de atlas e sem rever o escopo de cache entregaria panorama emprestado a quem soubesse o UUID, e o deixaria num cache compartilhado. Foi ligado com as duas condições juntas. Ver [[acesso-a-recurso-privado]].

## Contrato congelado do metadado

`buildPhotoMetadata` (`backend/src/modules/streetview360/sv360.service.js`) é o **único** lugar que define o shape; toda escrita que devolve foto re-lê por ali em vez de montar à mão. Ver [[sintese-contratos-congelados]]. O que quebra o viewer se mudar:

- `camera` é **plana**. Aninhar em `position`/`orientation` quebra.
- Leitura expõe `distance`/`bearing`; a **criação** de link pede `distance_m`/`bearing_deg` (`backend/src/modules/streetview360/sv360.write.schemas.js`). Assimetria intencional: escrita fala a linguagem do banco, leitura a do contrato. Os três `override_*` são número **ou `null`**, nunca ausentes.
- `previewThumbnail` é relativo e **sem `/api/v1`**; o cliente concatena com `streetView360.serviceUrl`. Ver [[config-runtime-urls-relativas]].
- Modelo geométrico: **chão plano**, Euler **ZXY**, `ele` informativo e fora da projeção. Detalhe em [[calibracao-e-grafo-360]].

Filtro e ordenação de `targets` vêm do SQL, não do JS: alvo oculto ou apontando para foto com tombstone simplesmente **não existe** para o viewer. Não replique essa filtragem no cliente.

**E o "viewer" são DOIS.** `frontend/src/js/calibration/` carrega uma cópia deliberada de cinco arquivos de `frontend/src/js/street_view_tool/navigation/`, porque a página de calibração não pode arrastar a store nem o MapLibre. Toda mudança de desenho de marcador precisa ser feita nos dois lados, e a guarda que existe (`frontend/tests/unit/calibracao-espelha-marcador-andar.test.js`) cobre só uma parte. Detalhe em [[calibracao-e-grafo-360]].

**`/projects` tem contrato próprio, e ele NÃO é a linha do Postgres.** O shape público é o do serviço legado que o frontend consome: camelCase, com as coordenadas **aninhadas** em `center: { lat, lon }`. A coluna se chama `center_long`; o campo exposto é `center.lon`. Esta linha dizia só "em `/projects` o campo é `center_long`", que descrevia a coluna e dava a entender que a linha saía crua, e ela saía, até 2026-07-26. Com dado real isso quebrou os três consumidores de uma vez e em silêncio: a camada 360 do mapa 2D nunca aparecia (lançava em `p.center.lon`), a busca perdia as coordenadas e o catálogo de atlas perdia as miniaturas. Preso por `sv360-contract.test.js` (o shape, não só os slugs); a forma nasce em `publicProjectView` (`backend/src/modules/streetview360/sv360.service.js`).

A forma pública ganhou `previewVideo` em 2026-08-21, e ele ilustra a regra: a coluna é `preview_video`, o campo exposto é camelCase, e `sv360-contract.test.js` afirma a ausência de snake_case no payload. O valor vem de coluna e não de um `config`, porque `sv360.projects` é a única das cinco tabelas de recurso sem JSONB de configuração, e daí a rota de escrita própria `PATCH /admin/projects/:slug`, que nasce com um campo só de propósito. Ver [[resources-catalogo]].

**Id de foto é UUID v4 OU v5.** O estúdio cunha v5 determinístico, mas o acervo legado importado do `index.db` é **100% v4** (98.690 de 98.690 no dump de produção). As rotas validavam só v5, então toda foto migrada respondia 422 em `/photos/:uuid` e `/photos/:uuid/image` enquanto `/projects` seguia listando tudo: o acervo inteiro inalcançável, com cara de saúde. O nibble de versão nunca foi controle de acesso: a legibilidade é imposta no SQL e no service. Ver [[ingestao-projetos-360]].

## Validação de calibração não tem faixas (de propósito)

Todo numérico é `Joi.number()` finito, sem `min`/`max`, e as colunas não têm CHECK (`backend/src/modules/streetview360/sv360.write.schemas.js`). `heading: 400` e `distance_scale: 0` são **aceitos**. Não adivinhe faixas: apertar aqui rejeitaria valores que o acervo já carrega, gerados pelo pipeline de ingestão e não pelo estúdio. As únicas faixas do produto são de tela, valem só para as três rotações de malha e vivem no estúdio, que hoje mora aqui: ver [[calibracao-e-grafo-360]]. Corpo vazio ou campo desconhecido dá 422 (todos os schemas são `.min(1)` + `.unknown(false)`).

## Tiles e o quirk do cliente

`fotos_linha` é a **trajetória de captura**, não o grafo dirigido de navegação; o grafo está por-foto em `targets`. A geometria vem de `sv360.tracks`, um trecho por percurso, e só cai na síntese antiga (um `ST_MakeLine` por projeto) para projeto sem track. A síntese é má substituta sempre que o projeto foi capturado em mais de uma passada: a linha salta de um percurso ao outro e o mapa desenha um emaranhado que não corresponde a caminho nenhum. No acervo real o `1pef` tem **34 trechos** para 2.249 fotos, e colapsá-los em uma polilinha era exatamente esse emaranhado. Ver [[ingestao-projetos-360]]. Tile sem features é **200 com Buffer vazio** (MVT vazio é válido): não trate corpo vazio como erro.

**O bbox entra DENTRO da CTE, e a forma da consulta é decisão de latência.** Enquanto a CTE `visible` era uma só, sem filtro espacial e referenciada quatro vezes, o Postgres a materializava: o `&&` contra a envelope só entrava depois, o índice GiST nunca era usado, e a latência crescia com o **acervo inteiro** em vez de com o que cabe no tile, inclusive para tile vazio. Medido no acervo real (29 projetos, 99.040 fotos), a separação em três CTEs levou z14 de 166,5 ms para 5,0 ms e o tile vazio de 296,7 ms para 4,8 ms. A armadilha para quem for mexer ali: a forma ingênua (empurrar o bbox para dentro sem separar as CTEs) foi medida e **regride** para 5,4 s em z0. Ver `backend/src/modules/streetview360/sv360.tiles.queries.js`, onde o EXPLAIN de antes e depois está registrado.

Quirk que confunde na leitura do cliente: a camada de pontos usa o source id literal `'streetViewPointsSource'`, mas as camadas de linha usam como **source id** o próprio `config.streetView360.linesSourceLayer` (`frontend/src/js/street_view_tool/add_street_view_control.js`), ou seja o id da source acaba sendo a string `fotos_linha`, igual ao `source-layer`. Funciona; só não confunda os dois ao mexer ali. `pointsSource` e `linesSource` apontam para o **mesmo** template de tiles ([[config-dinamico]]).

## Upload de bundle: duas defesas antes do primeiro byte

`authDraining` e `requireUploadCapability` rejeitam **antes do multer** e **drenam** o corpo multipart antes de responder (`backend/src/modules/streetview360/sv360.routes.js`). Sem o dreno, rejeitar cedo derruba a conexão (ECONNRESET) e o cliente nunca vê o 4xx limpo; é a parte que se esquece ao copiar esse padrão para outro upload. Quem não tem capacidade de escrita alguma leva 403 com zero bytes em disco, fechando um DoS autenticado de enchimento de disco ([[upload-imagens-seguranca]]).

O pré-filtro passou a perguntar pelo **escopo de produção**, e a troca fechou o buraco em vez de renomeá-lo: enquanto ele perguntava por `org_role`, qualquer conta que se dissesse editora de qualquer OM (crachá dentro de uma lotação auto-declarada) passava por ali e escrevia o teto inteiro de upload em disco antes do 403 do serviço. `producer_org_id` só um administrador concede, e o caminho é `auth` estrito, que o reconcilia contra o banco antes de chegar aqui. O `diskStorage` grava no mesmo volume de `SV360_DB_DIR` para que o rename final seja atômico, não cross-device.

`PATCH /admin/projects/:slug/status` é o soft delete de verdade; `DELETE` é hard delete com CASCADE e remoção do `.db`. Fluxo do bundle em [[ingestao-projetos-360]]; aba cliente em `frontend/src/js/admin/catalog-tab.js`, ao lado de [[resources-catalogo]].

Thumbnail: a **URL** é por slug, mas o **arquivo em disco é org-keyed** (`{orgId}__{slug}.webp`), então duas OMs com o mesmo slug não colidem nem vazam. O `:slug` passa por `path.basename` ([[hardening-borda-api]]) e o **underscore** faz parte do charset aceito, por uma razão que importa: ele é o que `sanitizeSlug` (`backend/src/modules/streetview360/sv360.merge.js`) define como seguro em disco, e slug real tem underscore (14 dos 28 projetos do acervo). Enquanto o padrão aqui era kebab-only, metade do acervo respondia 422 na própria miniatura. O que o padrão precisa barrar é separador de caminho, e `_` não é.

## Não programe contra isto

`metadata` e `position` do 360 legado nunca foram portados. Não há alias `rotation-y` entre os PUTs de campo único, embora haja para os outros eixos.

**O corte por distância acontece antes do filtro de ocultação, e isso é um limite do desenho.** `NEARBY_PHOTOS` corta nas 100 fotos mais próximas dentro do SQL; a privacidade já foi decidida ali, mas o eixo de `status` ainda é filtrado em JS depois. Um chamador cercado de projetos `disabled` recebe menos resultados legítimos do que deveria, sem sinal nenhum, e `/photos/nearest`, que reusa a mesma função, responderia "não há nada por perto". Todo projeto do acervo atual é `enabled`, então hoje não se manifesta. É a mesma classe de "o corte acontece antes do filtro" de [[ranking-busca-toponimos]], e some quando o eixo de `status` também descer para o `WHERE`.

*(Esta seção também descrevia `NEARBY_PHOTOS` como query sem rota montada e sem predicado de acesso nenhum. As duas coisas deixaram de valer.)*

Escritas exigem `auth` estrito ([[autenticacao-jwt]]); leituras são `flexibleAuth`.
