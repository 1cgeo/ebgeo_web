# Calibração e grafo de navegação 360

Escritas REST diretas (agregada, aliases granulares, lote com falha parcial) que ajustam a câmera plana e os links dirigidos entre fotos, governadas pela escada de posse 404→403 e por validação apenas de tipo/finitude, sem faixas numéricas.

## O que está sendo calibrado

Duas coisas distintas vivem sob o mesmo grupo de rotas de escrita do `sv360` (ver [[streetview-360]] para o lado de leitura):

1. **Câmera plana da foto** (`sv360.photos`): `heading`, `camera_height`, `mesh_rotation_x/y/z`, `distance_scale`, `marker_scale`, `floor_level`, `calibration_reviewed`. O viewer Three.js usa modelo de **chão plano** e ordem Euler **ZXY** para a malha (`src/js/street_view_tool/street_view_viewer.js:470`), com a câmera em `YXZ` (`street_view_viewer.js:155`). `ele` é informativo, não entra na projeção.
2. **Grafo de navegação dirigido** (`sv360.targets`): um link `source_id → target_id` por par, com `distance_m`/`bearing_deg` calculados, `is_next`/`is_original`, `hidden` e os três overrides manuais `override_bearing`/`override_distance`/`override_height`.

O módulo está **fora** do sync/CRDT/WebSocket do atlas (ver [[sintese-modulos-fora-do-sync]] e [[sintese-rest-vs-sync]]). Não há versão, Lamport, nem broadcast: `sv360.photos` tem `updated_at` mas nenhuma coluna `version`, e `sv360.targets` não tem nem isso (`sv360.write.service.js:13-15`). Depois de escrever, **recarregue** `GET /sv360/photos/:uuid`; nenhum evento chegará.

## Escada de posse: 404 antes de 403

Toda escrita passa por `auth` estrito (401 sem token, `sv360.routes.js:152-228`), mas a posse é resolvida no **service**, não em middleware, porque ela depende de carregar a foto → projeto primeiro:

```
não consegue nem LER (projeto oculto/inexistente/foto inexistente) → 404  (não vaza existência)
consegue ler mas não escrever (ex.: viewer da OM)                  → 403
```

`enforceProjectWritable` (`sv360.write.service.js:49-52`) aplica exatamente essa ordem. `canWriteProject` (`:32-37`): admin global (`user.role === 'admin'`) em qualquer OM, **ou** mesma `organization_id` com `org_role ∈ {owner, admin, editor}`. Um `viewer` da própria OM lê e recebe 403 ao escrever. Ver [[organizacoes-om]], [[gestao-usuarios]] e [[autenticacao-jwt]]; a leitura usa [[auth-flexivel]].

Detalhe que confunde: `GET_PHOTO_FOR_WRITE` **não** exclui fotos com tombstone (`sv360.write.queries.js:30-34`). Isso é deliberado, para que a posse ainda resolva no caminho de delete e o re-delete continue idempotente. Consequência: uma calibração sobre foto tombstoned passa pela posse, executa o UPDATE, e só então `rebuildPhotoShape` (que usa `GET_PHOTO_BY_ID`, com filtro de tombstone) lança 404. Por isso `updateCalibration` roda dentro de `tx()` (`sv360.write.service.js:124-130`): sem a transação, a escrita persistia e o cliente recebia 404 dizendo que nada aconteceu.

## Validação: só tipo e finitude, nunca faixa

`sv360.write.schemas.js:6-17` documenta a decisão em prosa e a implementa: todo numérico é `Joi.number()` sem `min`/`max`. As colunas são `DOUBLE PRECISION`/`INTEGER` sem `CHECK`, e o contrato congelado não publica faixa alguma. Apertar uma faixa aqui devolveria 422 para valores que o cliente legitimamente envia e o banco aceitaria, que é exatamente a quebra de contrato que se quer evitar (ver [[sintese-contratos-congelados]]).

Portanto **são aceitos**: `heading: 400`, `distance_scale: 0`, escalas negativas, `floor_level: -2`. São **rejeitados**: `NaN`, `Infinity`, não-numéricos, `floor_level` fracionário, corpo vazio (`.min(1)`) e campo desconhecido (`.unknown(false)`).

Armadilhas de coerção, verificadas rodando os schemas reais contra `VALIDATION_OPTIONS` de `src/middleware/validate.js:3-6`:

- `{"heading": "45"}` **passa** e vira `45` (Joi converte por padrão). Não conte com rejeição de string.
- `{"calibration_reviewed": "true"}` **passa** e vira `true`.
- `stripUnknown: true` está ligado globalmente, mas `.unknown(false)` explícito no schema vence: campo desconhecido dá 422, não é silenciosamente removido.

> [!CONTRADICAO 2026-07-18] guia *16-streetview-360* (absorvido):386` diz que a validação numérica "rejeita `NaN`/`Infinity`/string" e que `calibration_reviewed` é "booleano estrito"; o código em `src/modules/streetview360/sv360.write.schemas.js:25,31` usa `Joi.number()`/`Joi.boolean()` com `convert` no padrão, então `"45"` e `"true"` são **coeridos e aceitos**. `NaN`/`Infinity` esses sim são rejeitados.

## Três formas de escrever calibração

| Rota | Uso |
|---|---|
| `PUT /photos/:uuid/calibration` | Subconjunto qualquer, mínimo 1 campo. Caminho canônico. |
| `PUT /photos/:uuid/{height,rotation-x,rotation-z,distance-scale,marker-scale,reviewed}` | Aliases de um campo só. |
| `POST /photos/batch-calibration` | Até 500 itens, `uuid` + ≥1 campo cada. |

Os aliases não são um caminho paralelo: cada controller apenas encaminha o campo único para `wsvc.updateCalibration` (`sv360.write.controller.js:26-79`). Mesma posse, mesma transação, mesma resposta.

**Não existe `rotation-y`.** `mesh_rotation_y` só é editável pela rota agregada. Isso importa porque o viewer trata `mesh_rotation_y` ausente como `180`, não `0` (`src/js/street_view_tool/street_view_viewer.js:121`), enquanto `x`/`z` caem para `0` (`:125,:129`).

O UPDATE é montado dinamicamente a partir de `CALIBRATION_COLUMN_WHITELIST` (`sv360.write.queries.js:18-28`): nomes de coluna **nunca** vêm das chaves de entrada, só valores são parametrizados. É onde `height` vira `camera_height`. Ver [[hardening-borda-api]].

### Lote com falha parcial e SAVEPOINT por item

`batchCalibration` (`sv360.write.service.js:248-272`) abre uma transação externa e roda **cada item em `t.tx()` aninhada**, ou seja um SAVEPOINT. O motivo é concreto: um `floor_level` finito mas gigante estoura o `INTEGER`; com um `t` compartilhado o Postgres entraria em estado abortado no primeiro erro de SQL e **todos** os itens seguintes seriam descartados em silêncio. Com savepoint, só o item ruim volta atrás.

A resposta é `{ updated: [<shape congelado>...], failed: [{uuid, error}] }` com **200**, mesmo que tudo falhe. Trate `failed` sempre; um 200 aqui não significa sucesso. A posse é verificada por item, porque um lote pode atravessar projetos de OMs diferentes.

## Grafo: criar, sobrescrever, ocultar, apagar

| Rota | Semântica |
|---|---|
| `POST /photos/:uuid/targets` | 201 + shape da foto de origem. Alvo tem que estar no **mesmo projeto** e sem tombstone (`CHECK_TARGET_SAME_PROJECT`, `sv360.write.queries.js:90-97`), senão 409. Link duplicado, 409. |
| `PUT /photos/:uuid/targets/:targetId/override` | 200; 404 se o link não existe (`GET_TARGET_LINK`). |
| `PUT /photos/:uuid/targets/:targetId/visibility` | `{hidden}`; `hidden=true` some do array `targets` na leitura. |
| `DELETE /photos/:uuid/targets/:targetId` | **Hard-delete**, 204 idempotente. |

O hard-delete do link é o **único** hard-delete de conteúdo do módulo, e é intencional: adjacência é regenerável a partir da geometria, não merece tombstone. Foto, ao contrário, é sempre soft-delete.

A criação usa os **nomes internos** `distance_m`/`bearing_deg` (`createTargetBodySchema`, `sv360.write.schemas.js:110-120`), enquanto a leitura devolve `distance`/`bearing` (`buildPhotoMetadata`, `sv360.service.js:317-318`). Não é inconsistência acidental: escrita de calibração fala a língua do banco, leitura fala o contrato congelado do viewer. O schema de criação também aceita `override_*` e `hidden` já na inserção, o que a tabela do guia não menciona.

### Armadilha nº 1: override é substituição total, não merge

`UPDATE_TARGET_OVERRIDE` escreve as **três** colunas de uma vez, e o service passa `overrides.override_X ?? null` para cada uma (`sv360.write.service.js:145-151`). Um `PUT` com apenas `{"override_bearing": 90}` **zera** `override_distance` e `override_height`. O schema exige "≥1 campo", o que sugere patch parcial, mas o efeito é PUT clássico: sempre envie os três valores desejados.

Isso pesa porque no cliente `override_bearing` é o **gatilho** de todo o caminho de override: `navigator.js:391` só projeta por override se `override_bearing != null`, e nesse caso usa `override_distance ?? 5` e `override_height ?? 0` (`:394-396`). Logo, limpar `override_bearing` sozinho desativa silenciosamente a distância e a altura ajustadas manualmente, e limpar a distância sozinho faz a projeção cair para 5 metros default.

> [!CONTRADICAO 2026-07-18] guia *16-streetview-360* (absorvido):436` descreve o override como "define (número) ou limpa (`null`) ... (≥1 campo)", sugerindo que campos omitidos são preservados; o código em `src/modules/streetview360/sv360.write.service.js:145-151` grava as três colunas em toda chamada, então campo omitido vira `NULL`.

### Armadilha nº 2: re-delete de foto devolve 204, não 404

`softDeletePhoto` (`sv360.write.service.js:229-234`) grava tombstone com `ON CONFLICT DO NOTHING` e a posse resolve pela query que **mantém** tombstoned. A segunda chamada é um no-op limpo: 204. O teste de integração fixa isso explicitamente (`tests/integration/sv360-write.test.js:497-501`). A foto some de todas as leituras, inclusive do blob da imagem, inclusive para anônimo em projeto `enabled`.

> [!CONTRADICAO 2026-07-18] guia *16-streetview-360* (absorvido):463` diz "1ª chamada → 204; chamadas seguintes → 404"; o código (`sv360.write.service.js:229-234` + `GET_PHOTO_FOR_WRITE` em `sv360.write.queries.js:35-38`) e o teste `tests/integration/sv360-write.test.js:497-501` dão **204 idempotente** no re-delete.

## Toda escrita devolve o shape congelado, re-lido

Nenhum handler de escrita monta resposta à mão. `rebuildPhotoShape` (`sv360.write.service.js:81-87`) re-executa as queries de leitura do estágio 1 e chama `buildPhotoMetadata`, fonte única do shape. Ganho prático: a resposta de um `PUT /targets/.../visibility` já traz o array `targets` **sem** o link ocultado, porque `GET_TARGETS_FOR_PHOTO` filtra `hidden = false` e tombstones, e ordena `is_next DESC, distance_m ASC` (`sv360.queries.js:99-110`). Você não precisa reordenar no cliente.

Respostas continuam **nuas** (nunca `{data}`) e erros no envelope **plano** `{ "error": "mensagem" }`, ao contrário do resto da API (ver [[erros-api]] e [[sintese-contrato-erros-http]]). Isso vale inclusive para os 422 de Joi, traduzidos pelo `sv360ErrorHandler` montado por último no router (`sv360.routes.js:308`).

Códigos: 401 sem token, 403 sem capacidade de escrita, 404 inexistente/tombstoned/oculto (e link ausente no override), 409 duplicado ou cross-project, 422 corpo inválido.

## Quem chama isso

O frontend web é **consumidor somente-leitura**: `src/js/street_view_tool/streetview-api.service.js` só faz `GET`/`HEAD` de `/photos/:uuid`, `/photos/:uuid/image` e `/photos/by-name/:nome`. A calibração é operada pelo estúdio de produção (`ebgeo_360`), e o estado completo volta ao backend pela ingestão de bundle (ver [[ingestao-projetos-360]]), que é "último upload manda" por `(organização, slug)`. Ou seja: uma calibração feita via REST em produção é sobrescrita pelo próximo upload de manifest daquele projeto, a menos que o manifest já a contenha.

A base de URL vem do bloco `streetView360.serviceUrl` do `/api/config`, e o `previewThumbnail` do metadado é relativo, sem o prefixo `/api/v1`, para ser concatenado a ela (`sv360.service.js:305-310`). Ver [[config-runtime-urls-relativas]] e [[sintese-cache-http-imutavel]] para o contrato de cache das imagens.


## Exemplos de payload (escrita)

## Exemplos de payload (escrita)

### Calibração agregada, `PUT /photos/:uuid/calibration`

Qualquer subconjunto, mínimo 1 campo (`.min(1)`, `.unknown(false)`, `sv360.write.schemas.js:25-55`):

```json
{
  "heading": 88.0,
  "height": 1.75,
  "mesh_rotation_x": 0,
  "mesh_rotation_y": 0,
  "mesh_rotation_z": 1.2,
  "distance_scale": 1,
  "marker_scale": 1,
  "floor_level": 0,
  "calibration_reviewed": true
}
```

Os aliases carregam só o campo homônimo do body, por exemplo `PUT /photos/:uuid/height` recebe `{ "height": 1.75 }` e `PUT /photos/:uuid/reviewed` recebe `{ "calibration_reviewed": true }`. Mapeamento de coluna: `height` grava em `camera_height` (`sv360.write.queries.js:18-28`).

### Lote, `POST /photos/batch-calibration`

Máximo **500 itens**, cada um com `uuid` mais pelo menos um campo de calibração:

```json
{
  "photos": [
    { "uuid": "1d8e...-uuidv5", "heading": 88.0 },
    { "uuid": "9a44...-uuidv5", "height": 1.7, "calibration_reviewed": true }
  ]
}
```

Resposta **200** mesmo com falha total:

```json
{
  "updated": [ { "camera": { "...": "shape congelado" }, "targets": [] } ],
  "failed": [ { "uuid": "bad-uuid", "error": "Photo not found" } ]
}
```

### Criação de link, `POST /photos/:uuid/targets`

```json
{
  "target_id": "9a44...-uuidv5",
  "is_next": true,
  "is_original": false,
  "distance_m": 8.2,
  "bearing_deg": 92.0
}
```

Aqui valem os nomes internos `distance_m`/`bearing_deg` e o booleano `is_next`, enquanto a leitura devolve `distance`/`bearing` e `next`. O schema também aceita `hidden` e os `override_*` já na inserção (`sv360.write.schemas.js:110-120`).

### Override, `PUT /photos/:uuid/targets/:targetId/override`

```json
{
  "override_bearing": 90,
  "override_distance": 7.5,
  "override_height": 0
}
```

Envie sempre os três: a gravação é substituição total, campo omitido vira `NULL` (ver armadilha nº 1 acima). Para limpar, mande `null` explícito.

### Visibilidade, `PUT /photos/:uuid/targets/:targetId/visibility`

```json
{ "hidden": true }
```

## Fontes

- guia *16-streetview-360* (absorvido): superfície de rotas de escrita (§8), escada 404→403, tabela de aliases, contrato do lote, shape congelado do metadado, códigos de erro e rotas que não existem.
- `ebgeo_backend/src/modules/streetview360/sv360.write.schemas.js`: decisão explícita de não impor faixas numéricas; schemas por endpoint; campos extras aceitos na criação de target.
- `ebgeo_backend/src/modules/streetview360/sv360.write.service.js`: `canWriteProject`/`enforceProjectWritable`, transação da calibração, substituição total dos overrides, savepoint por item no lote, soft-delete idempotente.
- `ebgeo_backend/src/modules/streetview360/sv360.write.queries.js`: whitelist de colunas, `GET_PHOTO_FOR_WRITE` mantendo tombstones, hard-delete de link, tombstone `ON CONFLICT DO NOTHING`.
- `ebgeo_backend/src/modules/streetview360/sv360.routes.js` e `sv360.write.controller.js`: `auth` estrito por rota, ordem de declaração, aliases encaminhando para a calibração agregada.
- `ebgeo_backend/src/modules/streetview360/sv360.queries.js` e `sv360.service.js`: filtro/ordem de `targets` e montagem do shape congelado.
- `ebgeo_backend/src/middleware/validate.js`: `stripUnknown`/`convert` que produzem a coerção de string documentada acima.
- `ebgeo_backend/tests/integration/sv360-write.test.js`: comportamento fixado de 204 no re-delete e de override.
- `ebgeo_web/src/js/street_view_tool/`: consumo somente-leitura, ordens Euler ZXY/YXZ, defaults `mesh_rotation_y=180`, `override_distance ?? 5`, `override_height ?? 0`.
