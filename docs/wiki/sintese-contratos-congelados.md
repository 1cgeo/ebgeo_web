# Síntese: contratos congelados e envelopes divergentes

O backend serve mais de um envelope de resposta ao mesmo tempo, e o envelope é propriedade da rota, não da API. Esta página existe porque essa divergência não está declarada em nenhum arquivo isolado.

## Por que existem envelopes divergentes

Nenhuma divergência é acidente de estilo. Gazetteer e sv360 foram portados de serviços que já tinham clientes em produção (campo de busca, viewer Three.js). Congelar o shape saiu mais barato que reescrever os consumidores. A alternativa rejeitada foi unificar tudo em `{ data }`, o que teria quebrado clientes fora deste repositório.

Corolário: um cliente HTTP genérico que assume `{ data }` em tudo quebra em silêncio.

| Superfície | Sucesso | Erro |
|---|---|---|
| REST padrão (atlas, users, config admin) | `{ data }` | `{ error: { code, message } }` |
| `GET /nomes/busca` | array nu, máx. 5 | envelope padrão |
| Todo `/sv360/**` | objeto/array nu | **`{ error: "mensagem" }` plano** |
| `GET /api/config` | `{ data }` (envelope padrão) | envelope padrão |

Detalhe por superfície em [[gazetteer-nomes-geograficos]], [[assets3d-distribuicao]], [[streetview-360]]; envelope canônico em [[erros-api]] e [[sintese-contrato-erros-http]].

**`GET /api/config` não é contrato nu**, e esta tabela afirmou que era até 2026-07-25. Nele o congelado é o SHAPE do objeto de config, não o transporte, que é o `{ data }` de qualquer rota padrão (`backend/src/modules/config/config.controller.js`). A confusão nasce de o `ApiClient` esconder a diferença. Quem morde é o consumidor que não passa por ele, um health check de deploy ou um `fetch` cru: lê `cfg.basemaps`, recebe `undefined`, e o servidor respondeu 200. O guarda do shape (`frontend/tests/e2e/config-contract.e2e.test.js`) consulta pelo `ApiClient` e por isso não cobre essa ponta.

## A armadilha do unwrap

`ApiClient._unwrap` (`frontend/src/js/store/sync/api-client.js`) desembrulha qualquer objeto que tenha a chave `data`. Isso salva os contratos nus por acidente feliz (array e objeto sem `data` passam direto), e hoje não morde ninguém, porque o único envelope com `data` é o padrão, no qual `data` é a resposta inteira. **A armadilha é para a próxima rota paginada:** um `{ total, page, data }` atravessa o unwrap perdendo os irmãos de `data` sem erro nenhum, que era o defeito latente do segundo catálogo 3D enquanto ele existiu ([[resources-catalogo]]). Contrato nu ou paginado precisa de um caminho que não passe pelo unwrap.

O gazetteer contorna isso não usando o `ApiClient`: `frontend/src/js/search/gazetteer-url.js` deriva a URL da mesma base e os dois call sites fazem `fetch` cru validando com `Array.isArray`. Esse é o padrão a copiar para contrato nu.

## Shapes que não podem mudar

- **`/nomes/busca`**: array nu de no máximo 5, e o congelado é o campo `score` em [0,1] decrescente, não a fórmula que o produz. Os 7 pesos somando 1.00 saíram em 2026-07-26 para três chaves lexicográficas, e o `score` sobreviveu como a tupla dessas chaves codificada numa base que preserva a ordem, exatamente para que `ORDER BY score DESC` continuasse sendo o que o consumidor lê ([[ranking-busca-toponimos]]).
- **Metadado de foto 360**: campos de `camera` são planos, nunca aninhar em `position`/`orientation`. Em `targets`, a **leitura** usa `bearing`/`distance` e a **escrita** usa `bearing_deg`/`distance_m`. Assimetria intencional, e a fonte de bug mais provável de quem escreve o editor de grafo ([[calibracao-e-grafo-360]]).
- **Caminhos relativos**: `previewThumbnail` do 360 vem sem prefixo e resolve contra o `serviceUrl` do `/api/config`. Hardcodar `/api/v1/assets3d` quebra qualquer deploy com host de estáticos separado. A URL de modelo 3D não segue essa regra e nunca seguiu: a linha de catálogo guarda a URL pronta e o cliente a usa verbatim ([[config-runtime-urls-relativas]], [[config-dinamico]], [[assets3d-distribuicao]]).
- **Predicado de acesso no servidor**: para catálogo, assets 3D e sv360 a autorização está no `WHERE` ou num gate montado na rota, defesa em profundidade, e o cliente não deve filtrar nada nem assumir que recebe privados para esconder. O gazetteer é a exceção e não tem eixo de acesso nenhum desde 2026-08-19 ([[sintese-eixos-de-permissao]], [[acesso-a-recurso-privado]], [[sintese-modulos-fora-do-sync]]).
- **ETag de binários**: ver [[sintese-cache-http-imutavel]].
- **A gramática do link compartilhado (o fragmento `#view=`)**: é o único item desta página que não passa por HTTP, e ele é contrato entre VERSÕES do produto em vez de entre cliente e servidor. Um link copiado para um chat volta a ser aberto meses depois, por um build diferente, então três regras valem, e é delas que sai a forma conservadora do leitor:
  - chave nova só ADITIVA, porque renomear ou remover mata todo link já distribuído;
  - valor ausente ou ilegível cai no padrão do chamador e nunca no zero, porque zero é uma coordenada real (`parseDeepLink` recusa texto que não leia como número finito, e `resolveFpPose` mostra o molde: componente faltando volta ao padrão da cena, e pose meio montada é descartada inteira);
  - chave desconhecida se ignora em silêncio, que é o que deixa um build velho abrir um link novo perdendo só o que não sabe expressar.

  São quatro superfícies, todas lidas em `frontend/src/js/deep-link/parse.js`:

  ```
  #view=360&photo=<nome>&lon=<g>&lat=<g>&fov=<g>
  #view=3d&tileset=<id>&lon=<g>&lat=<g>&h=<m>&heading=<rad>&pitch=<rad>&roll=<rad>
  #view=fp&scene=<id>&x=<m>&y=<m>&z=<m>&yaw=<rad>&pitch=<rad>
  #view=base&base=<id>&lon=<g>&lat=<g>&z=<n>&b=<g>&p=<g>
  ```

  **A query é ORTOGONAL ao fragmento e nunca colide com ele** ([[dominio-local-vs-remoto]]): `?atlas=` diz qual atlas, `#view=` diz o que olhar e de onde. Por isso os construtores preservam `window.location.search`, coisa que não faziam até 2026-08-26.

  O guarda é `frontend/tests/unit/deep-link-gramatica.test.js`, e os vetores dele são **escritos à mão de propósito**: gerá-los pelo construtor que eles vigiam seria o teste conferindo o código contra ele mesmo, e passaria verde depois de qualquer renomeação de chave. Os MESMOS vetores existem no branch main, e essa duplicação é a única coisa que torna "o link abre nas duas versões" verificado em vez de afirmado. Quem editar um valor de vetor aqui e não lá quebra a promessa sem nada ficar vermelho.

  **O que a gramática não alcança:** que o recurso nomeado exista do outro lado. Um id que mudou de espaço entre as versões atravessa o leitor intacto e falha depois, na busca. Isso é medida contra o acervo, não teste ([[acervo-3d-convertido]]).

## Divergências verificadas contra o código

**A ambiguidade dos dois contratos 3D fechou, e a nota fica para não a reabrir.** Este parágrafo avisava que a descoberta documentada (uma rota de catálogo no schema do gazetteer, mais a junção de `assets3dBaseUrl` com o caminho da linha) convivia com a as-built (`config.tilesets`, lido em `frontend/src/js/3d_models_viewer_tool/map_3d.js`), e que quem fosse unificá-las tinha de escolher qual sobrevivia. A escolha aconteceu em 2026-08-19, e quem sobreviveu foi a as-built ([[resources-catalogo]]). O campo `assets3dBaseUrl` continua publicado pelo backend (`backend/src/modules/config/config.service.js`) e continua sem um leitor sequer em `frontend/src/`: ele é contrato oferecido, não caminho exercido.

> [!CONTRADICAO 2026-07-18, RESOLVIDO 2026-07-24] Três rotas admin do 360 passam pelo cliente genérico, e o parser de erro lia `parsed.error?.message`: com o envelope **plano** do sv360, `parsed.error` é string, então `frontend/src/js/admin/catalog-tab.js` exibia "HTTP 404" no lugar de "Project not found". O parser passou a aceitar os **dois** envelopes, com dois casos em `frontend/tests/integration/api-client.test.js`, um para o plano e um afirmando que o fallback `HTTP <status>` sobrevive para corpo sem erro utilizável. O `code` segue `undefined` no envelope plano, porque o sv360 não emite código.

> [!CONTRADICAO 2026-07-18, RESOLVIDO 2026-07-24] `streetview-api.service.js` prendia o nibble de versão do UUID em `4`, então `isUUID()` era `false` para todo id real de foto: `getPhotoDisplayName` desistia sem consultar a API e devolvia o UUID cru como nome exibido no editor de briefing e na aba de feições 360. A regex passou a casar a **forma** canônica em qualquer versão, que é o que de fato discrimina UUID de nome de arquivo legado. Controle negativo em `frontend/tests/unit/streetview-photo-id.repro.test.js`: 7/7 com o fix, 3 falham com a regex v4.

**Armadilha, `zoom` nunca é enviado.** A rota aceita `zoom` e o usa para encolher o platô e a escala do decaimento espacial; nenhum call site manda, os dois montam a query só com `q`, `lat`, `lon` (`frontend/src/js/search/search-bar.search-providers.js`, `frontend/src/js/search/feature-search.control.js`). O backend cai nos valores padrão, então em zoom alto a busca não prioriza o que está perto. Não é bug de contrato, é qualidade deixada na mesa. Ao ligar isso, saiba o que NÃO voltar: o antigo fator de zoom, que achatava o peso de tipo em zoom alto, foi removido por contradizer frontalmente a chave de categoria do ranking ([[ranking-busca-toponimos]]).

**Robustez, não contrato.** `normalizeProjects` (`frontend/src/js/street_view_tool/streetview-api.service.js`) aceita array nu e um legado `{ projects: [...] }`. Barato e defensivo, mas só o array nu é as-built. Não escreva código novo contra o legado.

## Regras operacionais

1. Nunca passe rota de contrato congelado pelo unwrap genérico sem checar o guard: envelope com irmãos de `data` perde os irmãos em silêncio.
2. Para o sv360, use um caminho que leia `parsed.error` como string. Não tente unificar com [[erros-api]].
3. Concatene sempre com a base do `/api/config`, nunca hardcode prefixo de asset.
4. Esses módulos estão fora do sync do atlas: sem `version`, sem snapshot, sem broadcast WS. Depois de calibrar uma foto ou ingerir um bundle, recarregue em vez de esperar evento ([[sintese-modulos-fora-do-sync]], [[ingestao-projetos-360]], [[sintese-rest-vs-sync]], [[envelope-operacao]]).
5. A visibilidade de catálogo e de 360 depende de quem está logado e não há push de invalidação: trocar de conta invalida esses resultados, refaça as consultas. A busca de topônimo **não** depende, e nunca precisa ser refeita por troca de conta ([[autenticacao-jwt]], [[auth-flexivel]]).
6. `/nomes/busca`, `/assets3d/*` e a leitura do sv360 são alcançáveis anonimamente e **precisam** continuar sendo. Endurecer a borda sem preservar o caminho anônimo derruba busca e galeria ([[hardening-borda-api]]). Rotas de atlas seguem o padrão em [[api-rest-atlas]].

## Histórico

- 2026-08-19: a tabela tinha duas linhas a mais, `GET /nomes/feicoes` (objeto nu, `200` mesmo sem achar) e `GET /nomes/catalogo3d` (envelope paginado), e três regras operacionais dependiam delas. As duas rotas saíram do sistema com as tabelas que serviam, então os contratos não foram quebrados, deixaram de existir. Também saiu o predicado de acesso do gazetteer, que esta página listava entre os shapes congelados.

