# Calibração e grafo de navegação 360

Escritas REST que ajustam a câmera plana e os links dirigidos entre fotos: as armadilhas ficam na coerção do Joi, nos três estados do override de link (definir, limpar, manter) e no fato de a ingestão de bundle apagar tudo.

Superfície de rotas, schemas e shapes: `backend/src/modules/streetview360/sv360.routes.js`, `backend/src/modules/streetview360/sv360.write.schemas.js`. O lado de leitura está em [[streetview-360]].

## Fora do sync, e isso muda o cliente

O módulo não participa do sync/CRDT/WebSocket do atlas (ver [[sintese-modulos-fora-do-sync]] e [[sintese-rest-vs-sync]]): `sv360.photos` tem `updated_at` mas nenhuma coluna `version`, e `sv360.targets` não tem nem isso (`backend/src/modules/streetview360/sv360.write.service.js`). Não há broadcast. Depois de escrever, **recarregue** `GET /sv360/photos/:uuid`; nenhum evento chegará, e duas sessões calibrando a mesma foto se sobrescrevem sem aviso e sem detecção.

A posse é resolvida no service, não em middleware, porque depende de carregar foto → projeto antes: 404 se nem lê (não vaza existência), 403 se lê mas não escreve (`enforceProjectWritable`, `backend/src/modules/streetview360/sv360.write.service.js`). Um `viewer` da própria OM cai no 403. Ver [[organizacoes-om]], [[gestao-usuarios]], [[autenticacao-jwt]]; a leitura usa [[auth-flexivel]].

## O contrato congelado é a ausência de faixa

Todo numérico é `Joi.number()` sem `min`/`max`, e as colunas são `DOUBLE PRECISION`/`INTEGER` sem `CHECK`. Isso é decisão, não esquecimento (`backend/src/modules/streetview360/sv360.write.schemas.js`): as faixas reais vivem no fonte não portado do `ebgeo_360`, e chutar um limite aqui devolveria 422 para valor que o cliente legitimamente manda e o banco aceitaria. **Não aperte** sem confirmar contra aquele fonte (ver [[sintese-contratos-congelados]]). São aceitos `heading: 400`, `distance_scale: 0`, escalas negativas, `floor_level: -2`.

## Armadilha: o comentário do próprio código mente sobre coerção

`backend/src/modules/streetview360/sv360.write.schemas.js` diz que `finiteNumber` "rejects NaN/Infinity/strings" e na linha seguinte admite que coerce `"45" -> 45`. A segunda metade é a verdadeira: com o `convert` padrão do Joi e o `VALIDATION_OPTIONS` de `backend/src/middleware/validate.js`, `{"heading": "45"}` e `{"calibration_reviewed": "true"}` **passam**. Não use a API como validador de tipo do seu cliente. `NaN`/`Infinity` esses sim são rejeitados.

Detalhe oposto ao esperado: `stripUnknown: true` é global, mas o `.unknown(false)` explícito de cada schema vence, então campo desconhecido dá 422 em vez de ser removido em silêncio.

## Override de link: leitura viva, escrita aposentada

Os campos `override_bearing`, `override_distance` e `override_height` continuam **servidos** em `targets[]` pela leitura do metadado, e continuam sendo gravados na criação do link (`INSERT_TARGET`). O que não existe mais é rota que os edite depois: o `PUT .../targets/:targetId/override` saiu junto com o modelo de marcador **absoluto**, substituído pelo **relativo**.

Por que a leitura importa no cliente: `override_bearing` é o **gatilho** de todo o caminho manual de projeção (`frontend/src/js/street_view_tool/navigation/navigator.js`), que só projeta por override se ele for não-nulo, e então usa `override_distance ?? 5` e `override_height ?? 0`. Um `override_height` igual a 0 é valor legítimo, não ausência: 0 é o solo.

A rota removida usava o patch por coluna de **três estados** (número define, `null` limpa, chave ausente mantém), separados por flag de presença (`campo !== undefined` no service, `CASE WHEN $N THEN $M ELSE coluna END` no SQL). O desenho existe porque `??`, `||` e `COALESCE` colapsam dois dos três estados, e `||` ainda comeria o `0` legítimo. Ele continua vivo e testado em `UPDATE_ATLAS`, `UPDATE_ORGANIZATION` e `UPDATE_RANK`, que é onde estudá-lo hoje.

## Armadilha: `mesh_rotation_y` tem dois defaults incompatíveis

O viewer trata `mesh_rotation_y` ausente como **180**, não 0 (`frontend/src/js/street_view_tool/street_view_viewer.js`), porque 180° alinha o centro da equirretangular com o +X da câmera. Mas a ingestão de bundle grava `num(p.mesh_rotation_y) ?? 0` (`backend/src/modules/streetview360/sv360.merge.js`) e a leitura sempre emite a coluna (`backend/src/modules/streetview360/sv360.service.js`). Resultado: um manifest que omite o campo persiste `0`, o fallback do viewer nunca dispara, e a foto aparece girada 180°. O `?? 180` só protege metadado legado de arquivo estático.

Some-se a isso que **não existe alias `rotation-y`**: `mesh_rotation_y` só é corrigível pela rota agregada `PUT /photos/:uuid/calibration`. Quem só conhece os aliases granulares conclui que o campo é imutável.

Ao mexer em rotação, lembre que a malha usa ordem Euler **ZXY** (`frontend/src/js/street_view_tool/street_view_viewer.js`) e a câmera **YXZ**, no mesmo arquivo: trocar a ordem em um dos dois quebra a calibração de todo o acervo. `ele` é informativo e não entra na projeção.

## Por que a posse ignora o tombstone

`GET_PHOTO_FOR_WRITE` deliberadamente **não** exclui fotos com tombstone (`backend/src/modules/streetview360/sv360.write.queries.js`), para que a posse resolva no caminho de delete e o re-delete siga idempotente. O efeito colateral: calibrar uma foto tombstoned passa pela posse, executa o UPDATE, e só então o rebuild (que filtra tombstone) lança 404. É por isso que **toda** escrita que termina em rebuild roda dentro de `tx()`: `updateCalibration`, `updateTargetVisibility` e `createTarget` (`backend/src/modules/streetview360/sv360.write.service.js`). Sem a transação a escrita persistia enquanto o cliente ouvia que nada aconteceu, e o caminho é alcançável porque o tombstone não apaga linhas de `sv360.targets`. Elas só ficaram simétricas em 2026-07-24; até ali só a calibração estava protegida. A quarta, a escrita de override por coluna, saiu com o modelo de marcador absoluto. `deleteTarget` fica de fora porque não relê nada.

Re-deletar uma foto é **204 idempotente**, não 404 (tombstone com `ON CONFLICT DO NOTHING` em `softDeletePhoto`, fixado em `backend/tests/integration/sv360-write.test.js`).

O link do grafo, ao contrário da foto, é **hard-delete**, o único do módulo: adjacência é regenerável a partir da geometria e não merece tombstone.

## Lote: 200 não significa sucesso

`POST /photos/batch-calibration` responde **200 com `{updated, failed}` mesmo que tudo falhe**. Trate `failed` sempre. Cada item roda em `t.tx()` aninhada, ou seja um SAVEPOINT (`batchCalibration`, `backend/src/modules/streetview360/sv360.write.service.js`): com um `t` compartilhado, um `floor_level` finito mas grande demais para o `INTEGER` colocaria o Postgres em estado abortado e **todos** os itens seguintes seriam descartados em silêncio. A posse é checada por item porque um lote pode atravessar OMs.

**Não exiba `failed[].error` na tela.** É `err.message` cru, o que inclui a mensagem do driver do Postgres quando a falha é do banco (`backend/src/modules/streetview360/sv360.write.service.js`), com nome de coluna e de constraint. O módulo tem política explícita em contrário e ela só cobre o caminho de erro HTTP: `backend/src/modules/streetview360/sv360-error.js` diz que a mensagem do driver nunca é encaminhada, e `sv360ErrorHandler` mascara 500 fora de dev. O lote fura isso por construção, porque o texto sai dentro de um corpo de **sucesso**, que nenhum error handler inspeciona. Contrato de fato hoje: trate como texto de diagnóstico de servidor, logue, e mostre ao usuário uma mensagem sua.

## A ingestão de bundle apaga a calibração feita por REST

Toda escrita re-lê e devolve o shape congelado montado por `buildPhotoMetadata`, então a resposta já vem com `targets` filtrado (`hidden` e tombstones) e ordenado por `is_next DESC, distance_m ASC` (`backend/src/modules/streetview360/sv360.queries.js`): não reordene no cliente. O envelope destas rotas (resposta nua, erro plano) é o do módulo inteiro, contrato congelado descrito em [[sintese-contratos-congelados]].

Mas nada disso sobrevive ao próximo upload. `mergeProject` é "último upload manda" por `(organization_id, slug)` e faz **purge + reinsert** dos filhos do projeto (`backend/src/modules/streetview360/sv360.merge.js`), ver [[ingestao-projetos-360]]. Duas consequências que mordem:

- calibração ajustada via REST em produção é **perdida** no próximo upload de manifest, a menos que o manifest já a contenha. O caminho REST é para correção pontual, não para estado durável.
- o purge alcança os tombstones do projeto: uma foto apagada por REST **volta a existir** se o bundle seguinte não a trouxer em `deleted_photos[]`.

O frontend web é consumidor somente-leitura (`frontend/src/js/street_view_tool/streetview-api.service.js` só faz `GET`/`HEAD`); quem escreve é o estúdio `ebgeo_360`. A base de URL vem de `streetView360.serviceUrl` do `/api/config` e o `previewThumbnail` é relativo, sem `/api/v1`, para ser concatenado a ela (`backend/src/modules/streetview360/sv360.service.js`). Ver [[config-runtime-urls-relativas]] e [[sintese-cache-http-imutavel]].
