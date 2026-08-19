# Síntese: o que fica fora do sync/CRDT do atlas

Gazetteer, sv360 e assets 3D são REST puro: sem `version`, sem snapshot, sem broadcast. A consequência que atravessa os três é a mesma e é a única coisa que importa lembrar: **não existe push de invalidação**.

## Por que ficaram fora

São dados de *deploy*, não de atlas: carregados por job externo (FME, ingestão de bundle) ou por administrador, com ciclo de vida em escala de dias. Colocá-los na [[fila-operacoes-outbound]] custaria versionamento e replay ([[snapshot-e-pull-incremental]]) para converter conteúdo que quase nunca muda, e ainda os arrastaria para dentro do [[formato-ebgeo-roundtrip]], mas o `.ebgeo` leva o conteúdo do atlas, e esses módulos são referências externas resolvidas por URL em tempo de execução. Ficam fora também de [[dominio-local-vs-remoto]].

O preço: toda mudança (calibração 360, ingestão, revogação de concessão) só chega ao cliente na próxima requisição que ele decidir fazer. É o oposto do modelo assumido em [[canal-collab-websocket]] e [[presenca-colaborativa]], e é fácil escrever código novo assumindo o modelo errado.

## A armadilha central: ninguém invalida nada hoje

`_projectsCache` (`frontend/src/js/street_view_tool/streetview-api.service.js`) é populado **uma única vez** pelo `preflightCheck` no boot (`frontend/src/js/map_sig.js`), e só se invalida via `fetchProjects(true)`, que ninguém mais chama. O catálogo ([[resources-catalogo]]) e as configurações de atlas leem esse cache sem rede.

Efeito atravessado: login/logout **não** refazem nada, e nenhum desses módulos escuta `SESSION_CHANGED` ([[sessao-boot-e-ciclo-de-vida]]; grep sem ocorrências em `search/`, `catalog/`, `street_view_tool/`). Um usuário que faz login continua vendo a lista de projetos 360 que o anônimo enxergava. Se você adicionar um consumidor novo, prenda-o a `SESSION_CHANGED`; não confie em o cache estar correto para a sessão atual.

## Contratos congelados que quebram o cliente padrão

Os três divergem do envelope global, e a tabela canônica dessa divergência é [[sintese-contratos-congelados]]. O que interessa aqui é a consequência para quem escreve consumidor novo:

- O parser de erro do cliente genérico aceita os **dois** envelopes desde `c3a49d8` (`_request`, `frontend/src/js/store/sync/api-client.js`), promovendo `parsed.error` string a `{ message }`. Mas o `code` segue `undefined` no envelope plano do sv360: **não ramifique por `code` em rota do sv360**, ramifique por status.
- `previewThumbnail` é relativo e **sem** o prefixo `/api/v1` ([[assets3d-distribuicao]], [[config-runtime-urls-relativas]]). Concatene com `serviceUrl` ou o thumbnail quebra em silêncio.
- O catálogo 3D do app não é rota própria: vem de `config.tilesets` ([[config-dinamico]]), lido por `getDeployTilesets` (`frontend/src/js/store/sync/atlas-settings.service.js`), e portanto herda o cache e a ausência de invalidação do `/api/config`.

## O eixo de acesso não é uniforme entre estes módulos

Catálogo, assets 3D e sv360 decidem visibilidade no servidor, cada um no seu ponto ([[acesso-a-recurso-privado]], [[assets3d-distribuicao]], [[hardening-borda-api]]): o que o chamador não pode ver não chega, então **não filtre no cliente**, renderize o que vier. Papel no atlas ([[permissoes-atlas]]), papel na OM ([[organizacoes-om]]) e concessão de recurso são eixos independentes ([[sintese-eixos-de-permissao]]).

A armadilha é generalizar isso para o módulo vizinho. O gazetteer **não tem eixo de acesso nenhum**: a marca de privacidade na linha e a concessão espacial por zona saíram em 2026-08-19, medidas como resíduo (as rotas de administração de zona não tinham tela, e a tabela de membros de grupo nunca teve escritor, então aquele ramo do predicado jamais devolveu linha), e busca de topônimo é aberta por decisão de produto. Quem for endurecer a borda aqui está reintroduzindo um sistema morto, e o cabeçalho de `backend/src/modules/nomes/nomes.queries.js` diz isso ao lado da consulta.

## Capacidade do backend que o cliente não usa

- **`zoom` nunca é enviado em `/nomes/busca`.** Os dois call sites montam a query só com `q`, `lat`, `lon` (`frontend/src/js/search/search-bar.search-providers.js`, `frontend/src/js/search/feature-search.control.js`), então o ranking cai sempre no platô e na escala padrão em vez de encolhê-los com o zoom ([[ranking-busca-toponimos]]). Não é bug, é qualidade deixada na mesa; quem lê só o backend conclui o contrário.

## Sem detecção de conflito

Escrita de calibração 360 é `PUT` direto e não emite broadcast ([[calibracao-e-grafo-360]], [[ingestao-projetos-360]]). Dois usuários calibrando a mesma foto **não convergem**: o último `PUT` vence, sem `version`, sem [[ack-idempotencia]], sem aviso. Não é [[modelo-conflito-lww]] com ordem de chegada arbitrada pelo servidor; é sobrescrita silenciosa. Depois de escrever, releia (`GET /sv360/photos/:uuid`); não espere evento.

Nota de cache: a imagem WebP é imutável ([[sintese-cache-http-imutavel]]), mas os tiles MVT usam `max-age=60` justamente porque mudam a cada ingestão/toggle/tombstone. Não estenda esse TTL sem resolver a invalidação.

Ver também [[sintese-rest-vs-sync]], [[sintese-rest-vs-websocket]], [[sintese-limites-collab]], [[gazetteer-nomes-geograficos]], [[resources-catalogo]], [[streetview-360]] e [[auth-flexivel]].

## Histórico

- 2026-08-19: a página contava **quatro** módulos fora do sync, e o quarto eram as zonas de acesso geográfico, removidas com o eixo de acesso do gazetteer, com a tabela de edificações e com o segundo catálogo 3D. Saíram junto os contratos de `/nomes/feicoes` e `/nomes/catalogo3d` e a seção que ensinava a zona como eixo de permissão.
- 2026-07-25: a página abria os contratos congelados dizendo "o backend não vive neste repositório". Vive desde a migração para monorepo (2026-07-18), e a frase autorizava exatamente o hábito que o resto da wiki combate, o de descrever o servidor de memória. Removida.
- 2026-07-25: apagada uma `[!CONTRADICAO]` que dizia que o erro plano do sv360 se perdia no parser genérico. O parser passou a aceitar os dois envelopes em `c3a49d8` (2026-07-24) e o marcador sobreviveu ao próprio conserto.
