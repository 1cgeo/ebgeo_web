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

Toda imagem/thumbnail é imutável, mas o **escopo** depende do status do projeto (`backend/src/modules/streetview360/sv360.controller.js`): `enabled` recebe `public`, `disabled` recebe `private` + `Vary: Authorization, Cookie`. Um cache compartilhado só pode guardar resposta que todo mundo pode ver; sem essa distinção um proxy replicaria para anônimos uma resposta autorizada de projeto oculto.

Não existe um `immutable` uniforme para todo o 360, apesar de a documentação de origem tabelar assim. O TTL longo vale só para imagem e thumbnail; o tile MVT e o feed GeoJSON usam 60 s, porque a camada de pontos muda a cada ingestão, tombstone ou toggle. E os dois seguem a mesma regra de escopo das imagens, por motivo diferente: o corpo do tile **varia com o chamador** (a query embute `isAdmin`/`orgId` e inclui projeto `disabled` para quem pode vê-lo), então chamada credenciada sai `private` + `Vary`, e só a anônima sai `public`. Marcar o tile de um membro como `public` autorizaria um cache compartilhado a servi-lo a anônimos pelo TTL seguinte, sem a aplicação ser consultada.

Armadilha deliberada no protocolo de Range: `Content-Length`/`Content-Range` derivam do **buffer realmente lido**, não do `size_bytes` do Postgres. Em regime normal coincidem; na janela entre o swap do arquivo e o commit da ingestão podem divergir, e confiar no buffer mantém toda resposta protocolarmente correta. Não "otimize" isso lendo o tamanho do Postgres. Mesma família de [[assets3d-distribuicao]] e [[sintese-cache-http-imutavel]].

O 304 acontece **antes** de abrir o SQLite e **antes** do semáforo de concorrência: é isso que torna revalidação barata, e é a razão de o ETag vir só de colunas de tamanho no Postgres. Mover o cálculo do ETag para o BLOB destruiria a propriedade.

## Ocultação: 404 é ambíguo por decisão

Projeto `enabled` é público; `disabled` só admin global ou membro da OM dona ([[auth-flexivel]], [[organizacoes-om]], [[permissoes-atlas]]), e projeto oculto responde **404**, indistinguível de inexistente. Nas escritas a escada é **404 para 403** (`backend/src/modules/streetview360/sv360.write.service.js`): quem não lê nem sabe que existe; quem lê mas não escreve (um `viewer` da própria OM) recebe 403. Portanto **não trate 404 do sv360 como "não existe"**: pode ser "existe e não é seu".

**Onde a regra mora, exatamente.** Esta seção dizia sem ressalva que ela está "embutida no SQL das leituras, não só no service", ecoando a promessa de `backend/CLAUDE.md`. Vale para as leituras de **projeto** e para o feed de tiles (`backend/src/modules/streetview360/sv360.queries.js`). As leituras de **foto** fazem o oposto por desenho: projetam `organization_id` e `project_status` e deixam a decisão para o service (`isProjectReadable` / `enforceProjectReadable`, `backend/src/modules/streetview360/sv360.service.js`). É o que permite a escada de 404 para 403 acima, que um `WHERE` cego não sabe distinguir. O preço, e é o que interessa aqui, é que **no caminho de foto a garantia vale só enquanto cada call site lembrar de chamar o gate**: uma query nova que devolva linha de foto sem passar por lá vaza projeto oculto, e não existe teste de SQL que pegue isso, porque não há nada no SQL para testar.

## Contrato congelado do metadado

`buildPhotoMetadata` (`backend/src/modules/streetview360/sv360.service.js`) é o **único** lugar que define o shape; toda escrita que devolve foto re-lê por ali em vez de montar à mão. Ver [[sintese-contratos-congelados]]. O que quebra o viewer se mudar:

- `camera` é **plana**. Aninhar em `position`/`orientation` quebra.
- Leitura expõe `distance`/`bearing`; a **criação** de link pede `distance_m`/`bearing_deg` (`backend/src/modules/streetview360/sv360.write.schemas.js`). Assimetria intencional: escrita fala a linguagem do banco, leitura a do contrato. Os três `override_*` são número **ou `null`**, nunca ausentes.
- `previewThumbnail` é relativo e **sem `/api/v1`**; o cliente concatena com `streetView360.serviceUrl`. Ver [[config-runtime-urls-relativas]].
- Modelo geométrico: **chão plano**, Euler **ZXY**, `ele` informativo e fora da projeção. Detalhe em [[calibracao-e-grafo-360]].

Filtro e ordenação de `targets` vêm do SQL, não do JS: alvo oculto ou apontando para foto com tombstone simplesmente **não existe** para o viewer. Não replique essa filtragem no cliente.

**`/projects` tem contrato próprio, e ele NÃO é a linha do Postgres.** O shape público é o do serviço legado que o frontend consome: camelCase, com as coordenadas **aninhadas** em `center: { lat, lon }`. A coluna se chama `center_long`; o campo exposto é `center.lon`. Esta linha dizia só "em `/projects` o campo é `center_long`", que descrevia a coluna e dava a entender que a linha saía crua, e ela saía, até 2026-07-26. Com dado real isso quebrou os três consumidores de uma vez e em silêncio: a camada 360 do mapa 2D nunca aparecia (lançava em `p.center.lon`), a busca perdia as coordenadas e o catálogo de atlas perdia as miniaturas. Preso por `sv360-contract.test.js` (o shape, não só os slugs); a forma nasce em `publicProjectView` (`backend/src/modules/streetview360/sv360.service.js`).

**Id de foto é UUID v4 OU v5.** O estúdio cunha v5 determinístico, mas o acervo legado importado do `index.db` é **100% v4** (98.690 de 98.690 no dump de produção). As rotas validavam só v5, então toda foto migrada respondia 422 em `/photos/:uuid` e `/photos/:uuid/image` enquanto `/projects` seguia listando tudo: o acervo inteiro inalcançável, com cara de saúde. O nibble de versão nunca foi controle de acesso: a legibilidade é imposta no SQL e no service. Ver [[ingestao-projetos-360]].

## Validação de calibração não tem faixas (de propósito)

Todo numérico é `Joi.number()` finito, sem `min`/`max`, e as colunas não têm CHECK (`backend/src/modules/streetview360/sv360.write.schemas.js`). `heading: 400` e `distance_scale: 0` são **aceitos**. Não adivinhe faixas: as reais vivem no fonte não portado `1cgeo/ebgeo_360`, e apertar aqui rejeitaria valores que o cliente legítimo já envia. Corpo vazio ou campo desconhecido dá 422 (todos os schemas são `.min(1)` + `.unknown(false)`).

## Tiles e o quirk do cliente

`fotos_linha` é a **trajetória de captura**, não o grafo dirigido de navegação; o grafo está por-foto em `targets`. A geometria vem de `sv360.tracks`, um trecho por percurso, e só cai na síntese antiga (um `ST_MakeLine` por projeto) para projeto sem track. A síntese é má substituta sempre que o projeto foi capturado em mais de uma passada: a linha salta de um percurso ao outro e o mapa desenha um emaranhado que não corresponde a caminho nenhum. No acervo real o `1pef` tem **34 trechos** para 2.249 fotos, e colapsá-los em uma polilinha era exatamente esse emaranhado. Ver [[ingestao-projetos-360]]. Tile sem features é **200 com Buffer vazio** (MVT vazio é válido): não trate corpo vazio como erro.

**Custo escondido: o tile escala com o acervo, não com o que cabe nele.** Na `MVT_TILE` a CTE `visible` não tem filtro de bbox e é referenciada duas vezes (`backend/src/modules/streetview360/sv360.tiles.queries.js`), o que no Postgres a materializa: o `&&` contra a envelope só entra depois dela, nos dois ramos. Pior no ramo das linhas, que monta um `ST_MakeLine` por projeto sobre **todas** as fotos legíveis antes de descartar os projetos que não tocam o tile. O comentário `PERFORMANCE` do próprio arquivo promete o contrário, poda por índice GiST antes do `ST_AsMVTGeom`, e isso vale só depois da materialização. Trate como limite operacional: a latência do tile cresce com o tamanho do acervo, inclusive para tile vazio, e o cache curto não amortiza. Um bbox dentro da `visible` é a correção óbvia, e a razão de ela não estar lá não está registrada em lugar nenhum.

Quirk que confunde na leitura do cliente: a camada de pontos usa o source id literal `'streetViewPointsSource'`, mas as camadas de linha usam como **source id** o próprio `config.streetView360.linesSourceLayer` (`frontend/src/js/street_view_tool/add_street_view_control.js`), ou seja o id da source acaba sendo a string `fotos_linha`, igual ao `source-layer`. Funciona; só não confunda os dois ao mexer ali. `pointsSource` e `linesSource` apontam para o **mesmo** template de tiles ([[config-dinamico]]).

## Upload de bundle: duas defesas antes do primeiro byte

`authDraining` e `requireUploadCapability` rejeitam **antes do multer** e **drenam** o corpo multipart antes de responder (`backend/src/modules/streetview360/sv360.routes.js`). Sem o dreno, rejeitar cedo derruba a conexão (ECONNRESET) e o cliente nunca vê o 4xx limpo; é a parte que se esquece ao copiar esse padrão para outro upload. Quem não tem capacidade de escrita alguma leva 403 com zero bytes em disco, fechando um DoS autenticado de enchimento de disco ([[upload-imagens-seguranca]]). O `diskStorage` grava no mesmo volume de `SV360_DB_DIR` para que o rename final seja atômico, não cross-device.

`PATCH /admin/projects/:slug/status` é o soft delete de verdade; `DELETE` é hard delete com CASCADE e remoção do `.db`. Fluxo do bundle em [[ingestao-projetos-360]]; aba cliente em `frontend/src/js/admin/catalog-tab.js`, ao lado de [[catalogo-3d]] e [[resources-catalogo]].

Thumbnail: a **URL** é por slug, mas o **arquivo em disco é org-keyed** (`{orgId}__{slug}.webp`), então duas OMs com o mesmo slug não colidem nem vazam. O `:slug` passa por `path.basename` ([[hardening-borda-api]]) e o **underscore** faz parte do charset aceito, por uma razão que importa: ele é o que `sanitizeSlug` (`backend/src/modules/streetview360/sv360.merge.js`) define como seguro em disco, e slug real tem underscore (14 dos 28 projetos do acervo). Enquanto o padrão aqui era kebab-only, metade do acervo respondia 422 na própria miniatura. O que o padrão precisa barrar é separador de caminho, e `_` não é.

## Não programe contra isto

`NEARBY_PHOTOS` existe como service e query (`backend/src/modules/streetview360/sv360.queries.js`) mas **não tem rota montada**, embora o schema já esteja escrito e rotulado para uma segunda etapa. Quem for montá-la herda duas coisas que a query não avisa:

- É a leitura **sem nenhum predicado de acesso**; o filtro roda em JS depois (`backend/src/modules/streetview360/sv360.service.js`). Montar a rota exige embutir o predicado no SQL **antes**, com teste negativo, que é a regra de `backend/CLAUDE.md` para toda query com filtro de acesso.
- O filtro em JS roda **depois do `LIMIT`**, então foto de projeto oculto consome vaga do orçamento: um chamador cercado de projetos `disabled` recebe menos resultados legítimos do que deveria, sem sinal nenhum. É a mesma classe de "o corte acontece antes do filtro" documentada em [[ranking-busca-toponimos]], e some sozinha quando o predicado descer para o SQL.

`metadata` e `position` do 360 legado nunca foram portados. Não há alias `rotation-y` entre os PUTs de campo único, embora haja para os outros eixos.

Escritas exigem `auth` estrito ([[autenticacao-jwt]]); leituras são `flexibleAuth`.
