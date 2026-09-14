# Revisão de lançamento: acesso a recurso (2026-09-13)

O eixo revisado é o de RECURSO, e só ele: catálogo (mapa base, camada de dados, camada de análise,
modelo 3D) mais projeto 360, com os quatro caminhos de acesso (papel global, produção da OM,
concessão pessoal ou por grupo, empréstimo pelo atlas) e as duas fronteiras de saída. O eixo POR
ATLAS e o papel global em si foram revisados em paralelo por outra linha de trabalho, e a revisão de
uploads de imagem do mesmo dia já está fundida.

Branch: `plano/b13rec`. Método: leitura do código e teste executado por arquivo, nunca a suíte
inteira; controle negativo obrigatório em cada correção, com a taxa relatada.

## O que foi verificado, e como

| # | Superfície (a porta) | Predicado | Gate da rota | Teste que a prende |
|---|---|---|---|---|
| 1 | `GET /api/config` | nenhum, por desenho (documento de boot, memoizado como UM) | limitador só | `backend/tests/integration/resource-access-visible.test.js` mede que o privado NÃO entra, nem para o beneficiário |
| 2 | estilo de mapa base dentro do `/api/config` | idem | idem | mesmo arquivo, caso do estilo que carrega URL de tile e de glifo |
| 3 | `GET /resource-access/visible` (a soma) | `fn_can_see_resource` composto, recortado a `access_level = 'private'` | `auth` + `requireAtlasScopeWhenPresent` | `resource-access-visible.test.js`, `resource-access-procedencia.test.js`, `resource-access-prazo-no-payload.test.js` |
| 4 | listagem e item do catálogo (`GET /` e `GET /:id` das quatro tabelas) | `catalogAuthorizationPredicate` | `auth` + `requireAtlasScopeWhenPresent` | `backend/tests/integration/catalogo-cru-concessao.test.js`, `resource-access-listagem-crua.test.js` |
| 5 | tile MVT do 360 | `sv360AccessPredicate` na CTE de projetos visíveis | `requireAtlasScopeWhenPresent` | `backend/tests/integration/sv360-privado.test.js`, `sv360-mvt.test.js` |
| 6 | metadado e BYTES de foto 360 (as cinco rotas) | `sv360AccessPredicate` no `WHERE` | `requireAtlasScopeWhenPresent` | `backend/tests/integration/sv360-foto-privada.test.js` |
| 7 | pirâmide da panorâmica (descritor e tile) | idem, herdado de `GET_PHOTO_PYRAMID` | idem | `backend/tests/integration/sv360-piramide-tiles.test.js` |
| 8 | download 3D, raiz e filhos `.b3dm` | `fn_can_see_resource` via `recursoPrivadoLiberado`, memoizado | `gateDeAsset3d` | `backend/tests/integration/assets3d-privado.test.js` (+ o caso de grupo desta revisão) |
| 9 | cena caminhável (splat e a pasta inteira) | idem, pelo mesmo gate por CAMINHO | `gateDeAsset3d` | `backend/tests/integration/models3d-cena.test.js` |
| 10 | tile raster/vetorial do servidor de tiles | `fn_can_see_resource` via `recursoPrivadoLiberado`, sobre o índice de regime | `requireTileAccess` (`auth_request` do nginx) | `backend/tests/integration/tile-access-auth-request.test.js` |
| 11 | vídeo de prévia hospedado | era NENHUM (público-por-URL, o token de 16 bytes no nome era a capacidade); desde 2026-09-14 é o predicado do recurso dono, por `FIND_RESOURCE_BY_PREVIEW_VIDEO` | era `flexibleAuth`; hoje `requireAtlasScopeWhenPresent` | `backend/tests/integration/video-de-previa-gateado.test.js`; ver R6 |
| 12 | busca (gazetteer) | não tem eixo público/privado (cláusula 2.2) | limitador | `frontend/tests/e2e/nomes-busca-anon.e2e.test.js` |
| 13 | snapshot de sync (definição de camada de catálogo) | `catalogAuthorizationPredicate` na reidratação | `requireAtlasPermission` | `backend/tests/integration/catalog-layer-cadeia-de-vazamento.test.js` |
| 14 | escrita por sync que REFERENCIA recurso | `unseenResourceDenialReason`, tabela de extratores por alvo | recusa POR OPERAÇÃO | `backend/tests/integration/sync-referencia-privada.test.js` |
| 15 | exportação `.ebgeo` e "Salvar como local" | keep-list no cliente (`RefVerdict`) | não há servidor no caminho | `frontend/tests/unit/poda-de-referencia-privada.test.js`, `poda-de-saida-fiacao.test.js`, `poda-fecha-no-desconhecido.test.js` |
| 16 | clone e import | `classifyResourceRefs` (o mesmo `fn_can_see_resource`, por destinatário) | `read` na origem + `requireAccountPrincipal` | `backend/tests/integration/clone-poda-por-destinatario.test.js`, `import-poda-referencia-privada.test.js` |
| 17 | as seis referências de `atlas.settings` | idem, pela mesma classificação em lote | idem | `backend/tests/integration/catalogo-referencias-de-recurso.test.js` |
| 18 | inventário de concessões (`issued` / `received`) | recorte na CONSULTA (autoria e beneficiário) | `auth` | `backend/tests/integration/resource-grants-inventario.test.js` |
| 19 | quem tem acesso, e quantos atlas emprestam | nenhum sobre a linha; o gate é o de repasse | `requireResourceShare` | `resource-grants-grupo.test.js`, `resource-access-emprestimos-contagem.test.js` |
| 20 | marcar público/privado | `fn_can_produce_resource` no `WHERE` da escrita | `requireResourceMaintainer` | `backend/tests/integration/produtor-define-visibilidade.test.js` |
| 21 | conceder, renovar e revogar | raiz por papel ou produção; revogar por AUTORIA | `requireResourceShare` / `requireGrantRevoker` | `produtor-concede-de-raiz.test.js`, `resource-grants-revogacao-credenciado.test.js` |
| 22 | a credencial no transporte (cliente) | origem MAIS fronteira de caminho | não é rota | `frontend/tests/unit/credencial-de-tile-por-origem.test.js` (+ o bloco same-origin desta revisão) |

O predicado em si é **uma definição só**, e isso se confirmou: `fn_can_see_resource` compõe
`fn_has_global_data_access`, `fn_can_produce_resource` e `fn_granted_resource_ids`, todas na
migração `008_acesso_a_recurso.sql`, sem nenhuma segunda cópia em JavaScript. Os três braços de
`fn_granted_resource_ids` (concessão pessoal, concessão por grupo, empréstimo pelo atlas) carregam
cada um `revoked_at IS NULL`, `expires_at > NOW()` e a vivacidade do concedente, e o braço de
empréstimo repete os três dentro do `EXISTS` que resolve o dono do atlas, que é onde eles seriam
mais fáceis de esquecer. `producer_org_id` é o que autoriza produção em todos os ramos;
`organization_id` só entra como termo de VIVACIDADE, e essa assimetria está registrada na cláusula
10.5 da [`CONSTITUICAO.md`](../../CONSTITUICAO.md).

## Achados

### R1: a credencial de asset 3D viajava para host de terceiro · CORRIGIDO

`cabecalhosDeAsset` (`frontend/src/js/store/sync/assets3d-request.js`) devolvia
`Authorization: Bearer` sem perguntar PARA ONDE, e os quatro chamadores dela grudavam o cabeçalho
numa URL derivada de `config.basePath` da linha de catálogo: o splat em
`frontend/src/js/first_person_3d_tool/first_person_viewer.js`, e `marcadores.json`,
`voxel-meta.json` e `voxel.bin` em `frontend/src/js/first_person_3d_tool/scene-config.service.js`.

Aquele campo é texto livre digitado por administrador **ou produtor**, `joinScenePath` honra um
valor absoluto como escrito, e o 422 que recusaria endereço de terceiro na ESCRITA não existe
(cláusula 10.1, em obra, e a mesma lacuna está escrita em [`tile-privado.md`](../wiki/tile-privado.md)).
Um produtor de uma OM podia, portanto, apontar a cena dele para o próprio servidor e colher o token
de sessão de quem abrisse a cena, administrador inclusive.

As duas irmãs do mesmo módulo já recusavam terceiro por escrito (`escoparUrlDeAsset` e
`descritorDeAsset`); esta era a única sem guarda, e era justamente a do caminho que
`frontend/tests/unit/cena-indoor-carimba-credencial.test.js` OBRIGA a carimbar, de modo que aquele
guarda empurrava para o defeito em vez de acusá-lo: ele mede a presença do cabeçalho, nunca o
destino.

Conserto: `cabecalhosDeAsset` passou a receber a URL e a comparar por `URL.origin`, nunca por
prefixo, pela mesma razão escrita em `frontend/src/js/map/credencial-de-tile.js`. Sem URL, e sem
`location` para comparar, o cabeçalho não sai: a direção de falha é o asset privado que não carrega,
que se vê na tela. Os dois `fetch` do voxel resolvem o cabeçalho por URL e **em série**, porque duas
chamadas concorrentes de `authHeader` podem disparar duas renovações e o detector de reuso de
refresh trata isso como roubo. Guardas: `frontend/tests/unit/credencial-de-asset-nao-vai-a-terceiro.test.js`
(sete casos) e o caso novo de `cena-indoor-carimba-credencial.test.js`, que reprova qualquer
`cabecalhosDeAsset()` sem argumento na pasta. Controle negativo: sem a linha da guarda, 5 dos 7
casos reprovam.

### R2: a fronteira de caminho do carimbo de tile não tinha caso same-origin · CORRIGIDO (teste)

O cabeçalho de `frontend/src/js/map/credencial-de-tile.js` diz que a metade de CAMINHO da regra
existe para o deploy same-origin, em que o app inteiro divide uma origem e a comparação por origem
sozinha carimbaria o token em todo tile de mapa base e em toda faixa de glifo do mesmo host. A suíte
media só hosts DEDICADOS: ali a origem já recusaria o glifo, e o par de casos de `/tilesextra` prova
a fronteira contra um vizinho TEXTUAL, nunca contra a irmandade de caminhos de um mesmo host. A
propriedade não tinha um caso, e a base RELATIVA (a forma daquele deploy) nunca havia sido
resolvida.

Não havia defeito no código: o bloco novo passa contra o produto de hoje. Controle negativo:
trocando a fronteira de caminho por comparação de origem sozinha, 7 dos 25 casos reprovam.

### R3: a classe `MISS-NULO` do censo do cache de 360 não era conferida por nada · CORRIGIDO (teste)

`frontend/tests/unit/cache-projetos-consumidores.test.js` classifica em quatro classes e conferia
três (o dono, o `MISS-BUSCA` e o homônimo da calibração). O cabeçalho promete que "consumidor que
perde o refetch reprova nomeando o arquivo", e bastava classificar o consumidor novo como
`MISS-NULO` para que nada o medisse: a gaveta sem discriminação, que é exatamente o que o próprio
arquivo escreve sobre a classe do homônimo três casos abaixo.

O caso novo cobra a justificativa da única entrada da classe, e ela é verificável: devolver `null`
no miss só é degradação certa porque `frontend/src/js/street_view_tool/streetview_markers.js` tem
outro caminho que chama `fetchProjects()` direto e portanto rebusca no escopo novo. Controle
negativo: apagando aquela chamada, o caso reprova nomeando o arquivo.

### R4: contagem de abas do credenciado desatualizada em `.claude/rules/architecture.md` · CORRIGIDO (doc)

A seção "O painel de administração" tira a aritmética do texto de propósito, com o motivo escrito, e
duas linhas depois afirmava que "o credenciado tem DUAS abas". São três desde 2026-08-25, quando
"Minha conta" entrou nas três audiências (`ABAS_DE_QUEM_ENTROU`). Nenhum guarda pega aritmética; a
frase foi trocada pela propriedade.

### R5: o braço de GRUPO nunca havia sido medido numa porta de BYTES · CORRIGIDO (teste)

`fn_granted_resource_ids` tem três braços. Os três eram medidos na função SQL
(`backend/tests/integration/resource-access-funcoes.test.js`) e na listagem
(`backend/tests/integration/resource-grants-grupo.test.js`); nas portas de BYTES só dois. Nenhum
arquivo de asset 3D, de foto 360 ou de tile exercitava a concessão COLETIVA.

É a forma exata do defeito-mãe do censo de superfícies: o predicado do MVT do 360 passou verde ao
ser revertido porque a privacidade era medida na listagem e nunca no tile. Um braço medido numa
porta não prova as outras.

Não havia defeito no código (o gate compõe o mesmo predicado, e o caso passa). O caso novo em
`assets3d-privado.test.js` usa um terceiro gêmeo de `forasteiro`, cuja única diferença no banco
inteiro é uma linha em `access_group_members`, e mede a raiz e o filho `.b3dm`. Controle negativo:
sem a linha de composição, o caso reprova (39 passam, 1 falha).

### R6: o vídeo de prévia é capacidade e a capacidade sobrevive ao público→privado · DECIDIDO E FECHADO EM 2026-09-14

> **Estado:** o dono decidiu (D14, [`../decisions/decisions-2026.md`](../decisions/decisions-2026.md)) pela
> primeira das duas saídas que este achado oferecia, e ela veio inteira. A rota resolve o recurso DONO do
> arquivo e aplica o MESMO predicado das outras mídias dele, com 404 (nunca 403) para quem não pode; marcar
> privado RE-CUNHA o nome do arquivo na mesma transação, de modo que a URL que circulou enquanto o recurso
> era público morre. O censo mudou de classe junto (a rota saiu de `recurso-publico-por-desenho` e o
> cabeçalho de cache deixou de ser `public` fixo). Guarda:
> `backend/tests/integration/video-de-previa-gateado.test.js`. O texto abaixo fica como foi escrito na
> revisão, porque é ele que descreve o mundo que a decisão fechou.

`GET /api/v1/catalog-videos/:file` (`backend/src/modules/catalog-video/catalog-video.routes.js`) é
público-por-URL: o nome do arquivo carrega 16 bytes aleatórios e a URL é a capacidade. O censo
declara o risco e o dono decidiu por essa forma em 2026-08-29.

A meia-verdade está na justificativa, e ela é curta: "a URL só chega a quem VÊ o recurso" é
verdadeira a cada instante e falsa ao longo do tempo. Um recurso que já foi PÚBLICO teve a URL do
vídeo servida a todo mundo dentro do `/api/config`, que é o documento anônimo e cacheável; marcá-lo
privado depois não revoga nada, porque `setResourceVisibility` não re-cunha o nome do arquivo. É a
única superfície de recurso em que a marca de privacidade não move byte nenhum, e a assimetria com
o tile (onde marcar privado FECHA os bytes, desde 2026-08-29) é o que a torna fácil de ler ao
contrário.

Conteúdo é uma prévia, então a gravidade é baixa e a decisão continua de pé. O que se pede é a
escolha explícita: ou re-cunhar o nome do arquivo quando a visibilidade vira `private` (uma linha no
mesmo `UPDATE`, com o `config.previewVideo` reescrito), ou escrever no censo que a capacidade
SOBREVIVE à marcação e que isso é aceito. Não corrigido aqui porque muda comportamento de produto
sem defeito medido que o motive.

### R7: o empréstimo por atlas continua sem alcançar o tile · CONFERIDO, pendência conhecida

Reconferido nesta revisão, e nada mudou: `requireTileAccess` (`backend/src/modules/auth/tile-access.js`)
lê o caminho de `X-Original-URI` e o predicado lê o atlas de `req.query.atlasId`, que na
subrequisição do `auth_request` é sempre vazia. Uma varredura por cabeçalho de atlas no repositório
inteiro (`.js`, `.conf`, `.sh`, `.md`) não devolve nada: as três pontas do conserto descritas na
cláusula 6.7 continuam por fazer. Fica como está, registrado onde já estava.

## O que foi conferido e não tinha defeito

- **Os quatro ramos do predicado, por rota.** Público, papel global, produção e as três formas de
  concessão têm caso de rota; a produção usa `producer_org_id` em todo ramo de autorização e
  `organization_id` só como vivacidade. `fn_produced_private_resource_ids` não tem ramo de
  administrador, e isso é o desenho: quem concede de raiz por papel não tem linha para listar.
- **Revogação por autoria.** `requireGrantRevoker` tem ramo largo por administração do sistema e
  ramo estreito por `granted_by`, e não pergunta por papel em lugar nenhum: um papel novo entra por
  autoria sem que ninguém edite o arquivo. O credenciado leva 403 ao revogar o que não deu.
- **Poda de saída.** A keep-list do `.ebgeo` e a poda por destinatário do clone são regras
  diferentes com motivos diferentes, e as duas têm teste. A armadilha das cinco allowlists de
  `atlas.settings` (lista vazia significa SEM restrição, então podar até zero alarga) está tratada
  em `ResourcePruner`, que desliga a categoria em vez de escrever a lista vazia, com `basemaps` como
  exceção declarada.
- **O carimbo de escopo do cliente.** `frontend/src/js/store/sync/resource-scope.js` é escrito ANTES
  da chamada e comparado na LEITURA, e os dois contadores de
  `frontend/src/js/store/sync/resource-access.service.js` distinguem soma superada de soma
  apagada de soma que falhou, que é o que permite ao aviso da barra acusar só o desfecho que é
  falha.
- **Os cinco consumidores do cache de projetos 360** rebuscam no miss, salvo o único declarado
  `MISS-NULO`, que tem outro caminho de refetch (agora asserido; ver R3).
- **A audiência do painel.** As três frases da administração batem com os gates: produtor marca
  visibilidade e concede de raiz o que produz, credenciado lê todo privado e concede mas não
  administra grupo alheio, administrador tudo. `adminAudience` recorta as abas no cliente para que
  produtor e credenciado não batam num 403 na montagem.

## Onde as lições foram codificadas

Duas entradas em [`../livro-razao.md`](../livro-razao.md), as duas da classe `verificacao-fantasma`:
o par negativo montado no eixo em que a outra metade da regra já responde (R2), e a classe de censo
sem discriminação somada ao braço de predicado medido numa porta só (R3 e R5). R1 é achado de
produto e por isso não entra lá, por regra daquele arquivo.
