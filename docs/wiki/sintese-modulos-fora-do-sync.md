# Síntese: o que fica fora do sync/CRDT do atlas

Gazetteer, zonas de acesso, sv360 e assets 3D são REST puro: sem `version`, sem snapshot, sem broadcast. A consequência que atravessa os quatro é a mesma e é a única coisa que importa lembrar: **não existe push de invalidação**.

## Por que ficaram fora

São dados de *deploy*, não de atlas: carregados por job externo (FME, ingestão de bundle) ou por administrador, com ciclo de vida em escala de dias. Colocá-los na [[fila-operacoes-outbound]] custaria versionamento e replay ([[snapshot-e-pull-incremental]]) para converter conteúdo que quase nunca muda, e ainda os arrastaria para dentro do [[formato-ebgeo-roundtrip]], mas o `.ebgeo` leva o conteúdo do atlas, e esses módulos são referências externas resolvidas por URL em tempo de execução. Ficam fora também de [[dominio-local-vs-remoto]].

O preço: toda mudança (calibração 360, ingestão, toggle de zona, alteração de permissão) só chega ao cliente na próxima requisição que ele decidir fazer. É o oposto do modelo assumido em [[canal-collab-websocket]] e [[presenca-colaborativa]], e é fácil escrever código novo assumindo o modelo errado.

## A armadilha central: ninguém invalida nada hoje

`_projectsCache` (`frontend/src/js/street_view_tool/streetview-api.service.js:151`) é populado **uma única vez** pelo `preflightCheck` no boot (`frontend/src/js/map_sig.js:555`), e só se invalida via `fetchProjects(true)`, que ninguém mais chama. O catálogo ([[resources-catalogo]]) e as configurações de atlas leem esse cache sem rede.

Efeito atravessado: login/logout **não** refazem nada, e nenhum desses módulos escuta `SESSION_CHANGED` ([[sessao-boot-e-ciclo-de-vida]]; grep sem ocorrências em `search/`, `catalog/`, `street_view_tool/`). Um usuário que faz login continua vendo a lista de projetos 360 que o anônimo enxergava. Se você adicionar um consumidor novo, prenda-o a `SESSION_CHANGED`; não confie em o cache estar correto para a sessão atual.

## Contratos congelados que quebram o cliente padrão

Três envelopes coexistem ([[erros-api]], [[sintese-contratos-congelados]]):

- `/nomes/busca` responde **array nu** (sem `{ data }`), no máximo 5 itens já ordenados ([[ranking-busca-toponimos]]).
- `/nomes/catalogo3d` responde `{ total, page, nr_records, data }`, com `page` **1-based**.
- `/nomes/feicoes` responde **200** com `{ message }` quando não acha nada. Não é `404`, não é array vazio: cheque `id` vs `message`.
- sv360 devolve sucesso nu e erro **plano** `{ "error": "mensagem" }`.

O parser de erro do cliente genérico aceita os **dois** envelopes desde `c3a49d8` (`_request`, `frontend/src/js/store/sync/api-client.js`): quando `parsed.error` é string ele a promove a `{ message }`, e só cai no fallback `HTTP <status>` para corpo sem erro utilizável. O `code` segue `undefined` no envelope plano, porque o sv360 não emite código: **não ramifique por `code` em rota do sv360**, ramifique por status.

Também congelado: `previewThumbnail` é relativo e **sem** o prefixo `/api/v1` ([[assets3d-distribuicao]], [[config-runtime-urls-relativas]]). Concatene com `serviceUrl` ou o thumbnail quebra em silêncio.

## Permissão por zona é um eixo separado

O predicado de acesso está embutido no SQL das rotas do gazetteer, não numa camada de middleware ([[zonas-acesso-geografico]], [[hardening-borda-api]]). Isso significa que um `owner` de atlas ([[permissoes-atlas]]) **não** enxerga um topônimo privado se não tiver a zona: papel no atlas, papel na OM ([[organizacoes-om]]) e zona geográfica são independentes ([[sintese-eixos-de-permissao]]).

Daí três regras que o código convida a violar:

- **Não filtre no cliente.** O que o usuário não pode ver não chega. Renderize o que vier.
- `PUT /zones/:id/permissions` é **replace-set**: `[]` remove todos. Read-modify-write sempre.
- O `total` do `/catalogo3d` conta só o visível. Nunca o use para inferir existência de itens ocultos.

## Capacidade do backend que o cliente não usa

Três rotas do gazetteer estão documentadas e testadas do lado do servidor e não têm um único consumidor no cliente web. Isso não é bug, é margem, mas quem lê só o backend conclui o contrário.

- **`Authorization` e `zoom` nunca são enviados em `/nomes/busca`.** Os dois call sites montam a query só com `q`, `lat`, `lon` (`frontend/src/js/search/search-bar.search-providers.js:279`, `frontend/src/js/search/feature-search.control.js:182`). Consequência: a barra de busca é **sempre anônima** (só topônimos `public`, mesmo com usuário logado que tenha zona) e o raio de decaimento fica fixo em 50 km, com o ajuste por tipo desligado.
- **`/nomes/catalogo3d` e `/nomes/feicoes` não são chamadas em `frontend/src/js/`.** O catálogo 3D do app vem de `config.tilesets` ([[config-dinamico]]), lido por `getDeployTilesets` (`frontend/src/js/store/sync/atlas-settings.service.js`).

## Sem detecção de conflito

Escrita de calibração 360 é `PUT` direto e não emite broadcast ([[calibracao-e-grafo-360]], [[ingestao-projetos-360]]). Dois usuários calibrando a mesma foto **não convergem**: o último `PUT` vence, sem `version`, sem [[ack-idempotencia]], sem aviso. Não é [[modelo-conflito-lww]] com ordem de chegada arbitrada pelo servidor; é sobrescrita silenciosa. Depois de escrever, releia (`GET /sv360/photos/:uuid`); não espere evento.

Nota de cache: a imagem WebP é imutável ([[sintese-cache-http-imutavel]]), mas os tiles MVT usam `max-age=60` justamente porque mudam a cada ingestão/toggle/tombstone. Não estenda esse TTL sem resolver a invalidação.

Ver também [[sintese-rest-vs-sync]], [[sintese-rest-vs-websocket]], [[sintese-limites-collab]], [[gazetteer-nomes-geograficos]], [[catalogo-3d]], [[streetview-360]] e [[auth-flexivel]].

## Histórico

- 2026-07-25: a página abria os contratos congelados dizendo "o backend não vive neste repositório". Vive desde a migração para monorepo (2026-07-18), e a frase autorizava exatamente o hábito que o resto da wiki combate, o de descrever o servidor de memória. Removida.
- 2026-07-25: apagada uma `[!CONTRADICAO]` que dizia que o erro plano do sv360 se perdia no parser genérico. O parser passou a aceitar os dois envelopes em `c3a49d8` (2026-07-24) e o marcador sobreviveu ao próprio conserto.
