# URLs relativas resolvidas por /api/config

Os subsistemas 3D e 360 armazenam caminhos relativos e o cliente os resolve em runtime contra `assets3dBaseUrl` e `streetView360.serviceUrl` do `GET /api/config`, tornando os dados portáveis entre ambientes sem rebuild nem reescrita de banco.

## O problema que isso resolve

Um `tileset.json` ou uma thumbnail de projeto 360 são servidos de hosts diferentes em dev, homologação e rede interna do EB. Se o caminho absoluto estivesse gravado no banco (na linha do catálogo ou na tabela `sv360_projects`), trocar de ambiente exigiria um UPDATE em massa; se estivesse hardcoded no bundle, exigiria rebuild do frontend.

A decisão é gravar **só o caminho relativo** no dado e publicar a **base** no config público. Base trocada por env var, dado intacto, frontend intacto.

- 3D: `assets3dBaseUrl` vem de `config.assets3d.baseUrl` (env `ASSETS_3D_BASE_URL`, default `/api/v1/assets3d`), montado no payload em `ebgeo_backend/src/modules/config/config.service.js:150` e declarado em `src/config.js:63`.
- 360: `streetView360.serviceUrl` vem de `C.sv360ServiceUrl` (env `SV360_SERVICE_URL`), em `config.service.js:187-188` e `ebgeo_backend/src/config.js:139`.

Ver [[config-dinamico]] para o contrato completo do `/api/config`, [[deploy-backend]] para as env vars.

## Como o config chega ao cliente

`src/js/config.js` é uma **casca**: carrega apenas defaults estruturais (as chaves que `map_sig.js`/`map_3d.js` leem sem guarda, para o spread não estourar) e `tilesets: []`, `streetView360: {}` vazios. O catálogo real vem do backend.

`applyRuntimeConfig()` (`src/js/store/sync/runtime-config.js:62-73`) faz `GET /api/config` e **deep-merge in place** dentro do objeto `config` importado por todo o app, que nunca é substituído. Consequências práticas:

- O merge é por chave, e arrays são **sobrescritos** inteiros, não concatenados (`runtime-config.js:42-52`). Um `/api/config` parcial preserva as chaves que ele omite.
- Qualquer módulo que leia `config.streetView360.serviceUrl` no topo do módulo (fora de função) leria a casca vazia. Por isso `streetview-api.service.js:15-17` encapsula em `getServiceUrl()`, lido a cada chamada. **Nunca capture `serviceUrl` em uma constante de módulo.**
- Boot é fail-fast: sem backend o app mostra a tela "EBGeo indisponível" e não roda. Não existe modo "config estático de fallback".

## 360: o padrão está implementado como documentado

O backend devolve o `previewThumbnail` do metadado da foto como caminho relativo **sem o prefixo `/api/v1`** (`sv360.service.js:304-309`, valor `/thumbnails/{slug}.webp`). O cliente concatena com `serviceUrl` em três pontos:

- `src/js/street_view_tool/streetview_markers.js:131-133` e `:653-655`
- `src/js/catalog/catalog.service.js:197-199`
- `src/js/modals/atlas-settings.modal.js:200-203` (aqui com `|| ''` de fallback)

Todas as rotas do módulo saem do mesmo `serviceUrl`: `${serviceUrl}/photos/:uuid` (`streetview-api.service.js:43`), `${serviceUrl}/photos/:uuid/image?quality=` (`:76`), `${serviceUrl}/projects` (`:168`). As fontes MVT (`pointsSource`/`linesSource`) já vêm com o template **absoluto** montado no backend (`config.service.js:189`), então o cliente passa `config.streetView360.pointsSource` direto para `map.addSource` (`add_street_view_control.js:218`) sem concatenar nada. Duas convenções coexistindo no mesmo bloco de config: thumbnail relativo, tiles absolutos.

Armadilha operacional: se `streetView360.serviceUrl` não vier no config, `map_sig.js:551-552` desliga `features.imagens_panoramicas` antes mesmo do preflight, e o 360 some da UI sem erro visível. Config faltando parece "feature desabilitada".

Mais contexto em [[streetview-360]], [[ingestao-projetos-360]] e [[calibracao-e-grafo-360]].

## 3D: o web app NÃO usa assets3dBaseUrl

Aqui a prosa e o código divergem. A string `assets3dBaseUrl` **não aparece em nenhum arquivo de `src/`** do ebgeo_web. O caminho as-built é outro:

1. Os modelos 3D chegam em `config.tilesets`, hidratado pelo `/api/config` a partir da tabela `resources` (`config.service.js:103-106`, `:177`), não pelo `GET /nomes/catalogo3d`.
2. `listTilesets()` faz `{ id, name, ...r.config }`: o backend **não reescreve** a `url`, apenas espalha o JSON armazenado.
3. O cliente entrega `tilesetConfig.url` verbatim ao Cesium: `Cesium3DTileset.fromUrl(tilesetConfig.url, ...)` em `src/js/3d_models_viewer_tool/map_3d.js:259` e `url: tilesetConfig.url` para glTF em `map_3d.js:321`.
4. O template do painel admin grava um caminho raiz-relativo tipo `/catalogo/modelos_catalogo/3d/EXEMPLO/tileset.json` (`src/js/admin/catalog-tab.js:44-54`), resolvido pelo **navegador contra a origem da página**, não contra qualquer base do config.

> [!CONTRADICAO 2026-07-18] guia *14-catalogo3d-assets* (absorvido) (§2, §5 e o checklist) diz que o frontend deve ler `assets3dBaseUrl` e concatenar `assets3dBaseUrl + m.url`; no ebgeo_web o `url` de `config.tilesets` é passado sem prefixo algum ao Cesium em `src/js/3d_models_viewer_tool/map_3d.js:259` e `:321`, e `assets3dBaseUrl` não é lido em lugar nenhum de `src/`.

Como interpretar isso sem errar: `assets3dBaseUrl` é o contrato para **quem consome `GET /nomes/catalogo3d`** (fluxo de descoberta + `/assets3d/*`), que o web app hoje não consome. Se você editar a metadata do catálogo pelo painel admin, grave a `url` **já servível a partir da origem** (ex.: `/api/v1/assets3d/aman/tileset.json`) ou uma URL absoluta, porque ninguém vai prefixá-la. E se um dia o web app migrar para o `/nomes/catalogo3d`, aí sim a concatenação passa a ser obrigatória. Ver [[catalogo-3d]] e [[assets3d-distribuicao]].

Detalhe correlato: as thumbnails de tileset **não** passam por base nenhuma. `add_3d_models_viewer_control.js:288` e `:655` atribuem `previewThumbnail` direto em `img.src`; no painel admin a thumbnail 3D é gravada como **data URL** embutida no `config` do recurso, com teto de 256 KB para não inflar o `/api/config` (`catalog-tab.js:29-31`). Ou seja: 360 concatena, 3D embute. Ver [[resources-catalogo]].

## Armadilha: o shape de /sv360/projects

`GET /sv360/projects` devolve as **linhas cruas** do Postgres (`sv360.service.js:57-61` sobre `Q.LIST_PROJECTS`, cujas colunas são `id, slug, name, center_lat, center_long, entry_photo_id, photo_count, status` em `sv360.queries.js:12`). O cliente, porém, lê um shape legado camelCase, herdado do antigo serviço estático de arquivos:

- `streetview_markers.js:125` acessa `p.center.lon` / `p.center.lat` (objeto `center` que a lista não devolve)
- `streetview_markers.js:131,134` leem `p.previewThumbnail` e `p.entryPhotoId`
- `catalog.service.js:197-202` leem `p.previewThumbnail`, `p.captureDate`, `p.center`

> [!CONTRADICAO 2026-07-18] guia *16-streetview-360* (absorvido) §2 documenta a lista de projetos em snake_case (`center_lat`, `center_long`, `entry_photo_id`) e sem `previewThumbnail`, mas `src/js/street_view_tool/streetview_markers.js:125` lê `p.center.lon` e `:131` lê `p.previewThumbnail`, campos que o backend não emite nessa rota.

Efeito: em `loadMarkers()` o acesso a `p.center.lon` lança dentro do `.map()`, é engolido pelo `try/catch` de `streetview_markers.js:137-140` e os marcadores 360 simplesmente não aparecem, com um `console.error` genérico. Em `catalog.service.js` o guarda `p.center ? ... : null` degrada silenciosamente para item sem localização e thumbnail default. Antes de "consertar a concatenação do `previewThumbnail`", confirme de qual payload o campo veio: o relativo confirmado existe no **metadado da foto** (`/photos/:uuid`), não na lista de projetos.

## Regras práticas

- Leia sempre de `config.<...>` dentro da função, nunca em constante de módulo. O objeto é mutado in place depois do boot.
- Trate ausência de base como feature desligada, não como erro: é assim que `map_sig.js:550-563` faz.
- Ao gravar metadata de catálogo, grave o caminho **na convenção que o consumidor daquele campo espera**. Não existe uma regra única: `previewThumbnail` de foto 360 é relativo ao `serviceUrl`, `pointsSource.tiles` é absoluto, `tilesets[].url` é servível a partir da origem, thumbnail de tileset é data URL.
- Não hardcode `/api/v1/assets3d` nem `/api/v1/sv360` em código novo. Para o backend em geral use `resolveBackendBaseUrl()` (`runtime-config.js:22-24`), que honra o override `globalThis.__EBGEO_BACKEND_URL__` usado nos testes E2E.
- Os binários resolvidos por essas bases são imutáveis com cache de 1 ano e ETag/304/Range: ver [[sintese-cache-http-imutavel]]. Trocar a base **não** invalida cache do navegador do caminho antigo, só muda o caminho.
- Nenhum desses caminhos trafega pelo sync do atlas: 3D e 360 são módulos REST fora do WebSocket ([[sintese-modulos-fora-do-sync]]). Depois de uma escrita de calibração, recarregue o metadado; não espere evento.
- O envelope do `sv360` é **nu** (objeto/array) e o erro é plano `{error: "msg"}`, diferente do resto da API ([[erros-api]], [[sintese-contratos-congelados]]).
- A restrição por atlas (quais modelos 3D e quais projetos 360 aparecem) é aplicada **depois** da resolução de URL, filtrando o catálogo: ver [[atlas-settings]].

## Fontes

- guia *14-catalogo3d-assets* (absorvido): contrato `assets3dBaseUrl` + `url` relativa do catálogo 3D, rota pública `/assets3d/*` (ETag/304/Range/immutable), env `ASSETS_3D_BASE_URL`, dual-mode SQLite/filesystem.
- guia *16-streetview-360* (absorvido): bloco `streetView360` do `/api/config` (§11), `previewThumbnail` relativo sem prefixo `/api/v1` (§4), envelope nu e erro plano, shape da lista de projetos (§2).
- Código ebgeo_web: `src/js/config.js`, `src/js/store/sync/runtime-config.js`, `src/js/street_view_tool/streetview-api.service.js`, `streetview_markers.js`, `src/js/catalog/catalog.service.js`, `src/js/3d_models_viewer_tool/map_3d.js`, `src/js/admin/catalog-tab.js`, `src/js/map_sig.js`.
- Código ebgeo_backend: `src/config.js`, `src/modules/config/config.service.js`, `src/modules/streetview360/sv360.service.js`, `sv360.queries.js`.
