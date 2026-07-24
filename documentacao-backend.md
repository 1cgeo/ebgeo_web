# Documentação: backend

> **ESTADO EM 2026-07-19: NÃO INICIADO.** Nenhum dos 155 itens foi tratado. A primeira
> ação recomendada continua sendo inverter a regex do `docs-integridade.test.js`, que
> sozinha converte 14 itens (53 citações em 22 páginas) de erro silencioso em falha de
> teste. Retomada: [`auditoria-continuacao.md`](auditoria-continuacao.md).


Auditoria da documentação que cobre `backend/src`, rodada em 2026-07-19 sobre o commit `e1bb74e`. Alvos: as 67 páginas de `docs/wiki/`, `CLAUDE.md`, `backend/CLAUDE.md`, `.claude/rules/` e `README.md`.

## O critério aplicado

Vale um critério só, o do `wiki-schema.md`: **o código já é a evidência**. Uma página se justifica onde ler o código não resolve, ou seja, o porquê e a alternativa rejeitada, a armadilha, o contrato congelado, o não-óbvio que atravessa arquivos, o custo escondido. Prosa que reconta código é defeito, não enchimento neutro: custa manutenção, apodrece a cada refatoração e compete com o código pela autoridade, perdendo, porque só o código executa.

Por isso a auditoria olhou nos dois sentidos, o que falta e o que sobra. O resultado dessa dupla checagem é a primeira coisa que vale saber.

## O diagnóstico em uma linha

**49 divergências contra 4 recontagens.**

Essa proporção é o retrato da saúde documental deste projeto, e é uma boa notícia disfarçada. A disciplina sobre *o que escrever* está funcionando: quase não há página inchada recontando o que o código já diz. O problema é outro, e é de *manutenção*: a wiki afirma coisas que já não são verdade.

São dois modos de falha diferentes com remédios opostos. Recontagem se resolve podando. Divergência se resolve verificando, e verificar é justamente o que o guarda existente deixou de fazer.

## O achado que vale mais: o guarda que não guarda

O teste `frontend/tests/unit/docs-integridade.test.js` existe para impedir que a documentação apodreça, e o `wiki-schema.md` o cita como o mecanismo que devolve verificabilidade a um formato que o Claude Code não resolve nativamente. Ele está verde. E está verde porque não olha.

A regra que coleta citações de código exige que o caminho comece por um prefixo de uma lista fechada:

```js
/`((?:frontend|backend|src|tests|docs|scripts|deploy|public)\/...
```

Acontece que **53 citações da wiki ainda usam os prefixos do layout pré-monorepo**, `ebgeo_backend/` e `ebgeo_web/`, que não existem como diretório. Como não batem com nenhuma alternativa da lista, não são coletadas. Como não são coletadas, não são verificadas. O teste passa.

Verificado diretamente, e a prova cabe em duas linhas:

```
ESCAPA  `backend/src/modules/auth/auth.service.js:24-42`
CASA    `backend/src/modules/auth/auth.service.js:24-42`
```

São 36 ocorrências de `ebgeo_backend/` e 17 de `ebgeo_web/`, espalhadas por 22 páginas. `docs/wiki/ack-idempotencia.md:44` é a ilustração perfeita: a mesma linha cita `backend/src/modules/sync/sync.service.js` (escapa) e `backend/src/modules/collab/collab.handlers.js` (é verificada). Uma linha, duas citações, metade guardada.

**Isto é uma recorrência, e é o que mais importa aqui.** O livro-razão já registra, no mesmo arquivo de teste, um defeito de forma idêntica: a regex exigia crase logo após a extensão, então toda citação `arquivo:linha` escapava, "1116 não verificadas contra 210 verificadas", e o teste "passava verde medindo a minoria". Aquilo foi corrigido tornando o sufixo `:linha` opcional. Agora o mesmo teste falha de novo pelo mesmo motivo estrutural, só que pelo prefixo em vez do sufixo.

O livro-razão diz o que fazer quando uma correção recorre: **mude a abordagem, não re-anote.** A abordagem atual é uma lista fechada de prefixos aceitos, e lista fechada silencia o que não conhece, que é exatamente a armadilha que a constituição proíbe em outro contexto (permissão). A inversão resolve a classe inteira: colete **qualquer** token entre crases que pareça caminho com extensão conhecida, e então **afirme** que o prefixo é de um pacote existente. Assim um prefixo desconhecido falha em vez de escapar, e a próxima renomeação de pasta acusa em vez de silenciar.

Corrigir isso primeiro converte **14 itens** deste relatório, e as 53 citações que eles cobrem, em falhas de teste que se auto-reportam, o que vale mais que corrigi-los à mão. Os outros 20 itens de link quebrado têm causa distinta (wikilink duplicado, deriva de número de linha depois de um commit deslocar o arquivo) e continuam exigindo correção manual.

Uma limitação honesta que fica de pé mesmo assim: o teste valida o **caminho**, nunca o **número da linha**, e o próprio comentário do arquivo diz que fingir o contrário seria repetir o erro. Então citação cujo arquivo existe mas cuja linha derivou (o commit `93d205b` deslocou todas as citações a `sync.service.js` posteriores à linha ~650) continua apodrecendo em silêncio, por construção.

## Doc que nunca foi verdadeira

O padrão mais perigoso encontrado não é doc desatualizada. É doc que afirma uma propriedade de segurança que o código **nunca teve**, escrita como intenção no momento do commit, e escrita em **comentário de código**, que é o lugar onde um agente mais confia.

Quatro casos confirmados:

- `auth.service.js:210-212` afirma que "o atacante não sabe se um e-mail está cadastrado". O register é um oráculo de e-mail.
- `auth.service.js:140-141` afirma "forçando novo login". Nenhum access token existente é invalidado por detecção de reuso, logout ou troca de senha (tema T5 do relatório de bugs).
- `atlas.service.js:115` e `api-client.js:636` descrevem "partial/deep merge". O merge é raso, e existe um teste de caracterização que afirma o comportamento raso como esperado.
- `middleware/auth.js:76-78` afirma que algo é "enforced by requireAtlasPermission". Não é, na superfície WebSocket.

Não há nada que amarre comentário a comportamento, e não há como haver por lint. O que dá para fazer é o que o projeto já sabe fazer: onde o comentário afirma propriedade de segurança, o teste correspondente deve existir e ser nomeado no comentário. Comentário que promete garantia sem teste é a forma mais cara de `doc-sobre-codigo`, porque um agente lê o comentário e para de investigar.

## O que este projeto sistematicamente não registra

As páginas descrevem bem cada mecanismo isolado: o merge, o link público, a presença, o cache, a rotação de token. O que nunca é registrado é a **assimetria**:

- "este efeito tem duas portas e só uma é guardada";
- "este dado tem três shapes conforme o caminho de chegada";
- "esta remediação não alcança quem já tem token".

A wiki tem sínteses por tema (`sintese-rest-vs-sync`, `sintese-limites-collab`), e nenhuma síntese **por invariante atravessando superfícies**. E é exatamente aí que moram os bugs desta auditoria: o tema T3 do relatório de bugs (assimetria entre caminhos que produzem o mesmo efeito) tem cinco ocorrências independentes, nenhuma delas documentada em lugar nenhum.

Essa é a página que falta, e ela passa no critério com folga: ninguém chega nela lendo o código, porque por definição ela só existe na comparação entre arquivos distantes.

## A verificação que não verifica

Registrado aqui porque é defeito de documentação, não de código: `CLAUDE.md` e `.claude/rules/testing.md` prescrevem `npm run lint` + `npm test` como *a* verificação de lógica antes de qualquer commit, e na raiz os dois delegam com `--prefix frontend`. Uma mudança só de backend, verificada exatamente como a constituição instrui, roda zero teste e zero lint de backend, e volta verde.

Existem `lint:all` e `test:all`; não são o que a documentação manda rodar. Verificado por execução: os dois pacotes estão limpos hoje, então o defeito está no guarda, não no código. É a terceira ocorrência da classe `verificacao-fantasma` no livro-razão, e a segunda em que a própria constituição é o veículo.

Correção: apontar `test` e `lint` da raiz para `test:all`/`lint:all`, acrescentar `--max-warnings 0` ao lint do backend (hoje o frontend reprova em warning e o backend não), e corrigir as duas linhas que prescrevem o comando incompleto.

## Como ler os itens

| Tipo | Itens | O que é |
|---|---|---|
| `divergencia` | 49 | A doc afirma A, o código faz B |
| `link-quebrado` | 31 | Citação ou wikilink que não resolve |
| `armadilha-nao-documentada` | 24 | Armadilha real no código sem registro |
| `ausencia` | 22 | Porquê, contrato ou custo escondido não registrado |
| `desatualizada` | 19 | Estado que avançou (supersessão temporal) |
| `contrato-nao-documentado` | 5 | Contrato congelado sem página |
| `recontagem` | 4 | Página que só reconta o código |
| `orfa` | 1 | Nenhuma página aponta para ela |

Severidade: 45 alto, 77 médio, 33 baixo.

Ausência só entrou na lista quando passou no teste do critério: um engenheiro competente lendo o código **não** chegaria nisso sozinho em poucos minutos. Ausência sem porquê, armadilha ou contrato por trás foi descartada na origem.

---

## Itens


---

## Severidade alta

### 1. docs/wiki/api-rest-atlas.md §"Merge de mapas" (:69-77)

- **Tipo:** armadilha não documentada · **Fatia:** `be-maps-briefings`
- **Documento:** `docs/wiki/api-rest-atlas.md:75`
- **Código:** `backend/src/modules/maps/maps.service.js:9-16`

**Evidência.** api-rest-atlas.md:75 enuncia o contrato como risco FUTURO: "Adicionar tabela filha nova ao schema exige acrescentá-la ali, senão o conteúdo dela fica órfão no mapa de origem após o merge, sem erro". A armadilha já disparou: `comments` é tabela filha escopada por mapa (`map_id UUID NOT NULL REFERENCES maps(id)`, com `version`/`deleted_at`, backend/src/database/migrations/002_atlas.sql:220-239) e o snapshot a entrega agrupada POR MAPA (`map.comments = commentsByMap[map.id]`, backend/src/modules/sync/sync.service.js:461-494), mas ela NÃO está em MAP_CHILD_TABLES (backend/src/modules/maps/maps.service.js:9-16). Consequência silenciosa: mesclar mapas move as feições e deixa os comentários espaciais ancorados no mapa de origem, descolados das feições que anotam, sem erro e sem contagem em `moved`. O teste de cobertura (backend/tests/integration/maps-briefings-gaps.test.js:83) itera exatamente a mesma lista de seis tabelas do código, então é cobertura vazia para este caso: passaria verde com ou sem o defeito.

**Ação.** Resolver contra o código primeiro (é bug ou exclusão deliberada?) e registrar o resultado em api-rest-atlas.md:75. Se deliberado, dizer por quê em uma linha; se bug, corrigir maps.service.js:9-16 e trocar a frase de risco futuro por registro do caso. Em qualquer hipótese, o teste precisa de uma lista de tabelas derivada do schema (ou uma asserção explícita sobre comentários), não da mesma constante que ele deveria vigiar.

### 2. docs/wiki/api-rest-atlas.md §"Merge de mapas" (:69-77) / docs/wiki/sintese-rest-vs-sync.md

- **Tipo:** armadilha não documentada · **Fatia:** `be-maps-briefings`
- **Documento:** `docs/wiki/api-rest-atlas.md:69-77`
- **Código:** `backend/src/modules/maps/maps.service.js:39-69`

**Evidência.** O caminho de sync recusa mutação de entidade filha quando o mapa está travado: `SELECT locked FROM maps ...; if (m && m.locked) throw new ConflictError('Map is locked')` (backend/src/modules/sync/sync.service.js:1306-1312, alcançado pelos alvos de LOCKABLE_CHILD_TARGETS em :586-588), e travar/destravar é reservado ao dono (:616). O merge REST move exatamente essas mesmas entidades e nunca lê `maps.locked`: não há uma única ocorrência da coluna em backend/src/modules/maps/maps.service.js (mergeMaps, :39-69). Logo um usuário `write` esvazia um mapa travado, ou despeja conteúdo dentro de um mapa travado, pela rota REST, contornando um gate que o canal de sync aplica com 409. É comportamento que só emerge cruzando dois módulos e não está visível em nenhum dos dois arquivos sozinho, que é precisamente o critério da wiki.

**Ação.** Acrescentar uma linha a api-rest-atlas.md:69-77 registrando que o merge não honra `maps.locked` (com as duas âncoras), e decidir explicitamente se é lacuna a corrigir ou exceção deliberada. Se for lacuna, o fix é uma checagem dentro do `tx` de mergeMaps mais teste negativo (mapa travado como origem e como destino).

### 3. docs/wiki/organizacoes-om.md

- **Tipo:** armadilha não documentada · **Fatia:** `be-users-orgs`
- **Documento:** `docs/wiki/organizacoes-om.md:3 e :32-38`
- **Código:** `backend/src/middleware/auth.js:97-99`

**Evidência.** A pagina abre com "Desativa-la nao esconde, expulsa: derruba login, refresh e sockets abertos dos membros em segundos" e lista cinco armadilhas de CRUD, mas nunca diz que o admin que executa a acao e um dos membros expulsos. O gate de org roda ANTES de qualquer checagem de papel: `auth` devolve 403 'Organization is inactive' sem olhar `role` (middleware/auth.js:97-99) e o login idem (auth.service.js:91-93). Como `DELETE|PUT /organizations/:id` exige `auth` + `requireAdmin` (organizations.routes.js:14-15), um admin cujo `organization_id` aponta para a OM que ele acabou de desativar nao consegue mais logar nem reativar: nao ha rota de recuperacao. Nao existe admin de bootstrap em `backend/src/` (grep por bootstrap/BOOTSTRAP nao retorna nada); a unica saida e SQL direto ou `npm run db:seed`, e o seed so escapa por acidente, porque cria o admin com OM nula (database/seed.js:29-33) e `orgIsActive` isenta quem nao tem org (utils/org-status.js:17). Em deployment de OM unica sobre a org default, desativar a OM inutiliza a API inteira. O contraste esta no modulo irmao: `users.service.js:140-149` implementa explicitamente a guarda analoga ("Voce nao pode desativar a propria conta", comentada como defesa contra last-admin lockout) e `organizations` nao tem equivalente nenhum.

**Ação.** Adicionar em "Armadilhas do CRUD" um item: desativar a OM expulsa tambem quem desativou, o gate de org precede o de papel, e nao ha caminho de volta pela API. Citar middleware/auth.js:97-99 e a ausencia de self-guard em organizations.service.js:35-39 contra a guarda existente em users.service.js:140-149.

### 4. docs/wiki/permissoes-atlas.md

> **CORRIGIDO em 2026-07-24.** A ação pedida era codificar a regressão, não escrever doc — e foi o que aconteceu. `canToggleLock` passou a gatear pelo STORE (`!isRemoteStoreSync()`) em vez de pela sessão, que é a mesma distinção que `isReadOnly()` já fazia logo abaixo; um editor logado voltou a poder travar o próprio mapa LOCAL. Cinco testes reprovaram o fix porque montavam a cena só com `setOnline()`, deixando o store local, ou seja, congelavam o defeito como esperado. Controle negativo em `frontend/tests/integration/map-lock.test.js`: 28/28 com o fix, 3 caem sem ele. A exclusão do `manager` de `LOCK_CAPABLE_ROLES` NÃO foi mexida: o servidor exige estritamente `owner` para travar mapa, então a lista fechada do cliente concorda com o servidor; o desalinhamento das três camadas segue documentado como armadilha na página.

- **Tipo:** armadilha não documentada · **Fatia:** `estrutural`
- **Código:** `frontend/src/js/locking/map-lock.controller.js:39`

**Evidência.** A [!CONTRADICAO 2026-07-18] de permissoes-atlas.md:56 continua VÁLIDA e é uma quarta ocorrência da classe C1 (lista fechada de permissão), que a constituição diz já ter causado bug real duas vezes. `map-lock.controller.js:39` declara `const LOCK_CAPABLE_ROLES = Object.freeze([UserRole.OWNER, UserRole.ADMIN])` e `:75` faz `LOCK_CAPABLE_ROLES.includes(sessionContext.role)` sem consultar `isRemoteStoreSync()`, ao contrário de `isReadOnly()` logo abaixo. O `manager` (co-Gestor) some em silêncio, e um `editor` logado é bloqueado no próprio mapa LOCAL. A página descreve o defeito mas ele não virou teste de regressão nem entrou como armadilha nomeada; a wiki registra e o código segue.

**Ação.** Não é item de doc que se resolve escrevendo: codificar a lição (teste de regressão sobre canToggleLock com role=manager e com sessão ONLINE sobre store local), corrigir para gate por hierarquia + isRemoteStoreSync(), então apagar o marcador e registrar no livro-razao.md onde a lição foi codificada.

### 5. nenhuma pagina

- **Tipo:** armadilha não documentada · **Fatia:** `be-database`
- **Documento:** `docs/wiki/envelope-operacao.md:31, docs/wiki/atlas-modelo-de-dados.md:54, docs/wiki/modelo-conflito-lww.md:42, docs/wiki/tipos-entidade-sync.md:25`
- **Código:** `backend/src/database/migrations/002_atlas.sql:118 (layers.name VARCHAR(255)) + backend/src/modules/sync/sync.schemas.js:13-46`

**Evidência.** A classe "poison pill" e documentada em NOVE paginas, e sempre com o mesmo unico gatilho: id nao-UUID gerando 22P02. Existe uma segunda porta para o MESMO deadlock permanente que nenhuma pagina cita e nenhum guard cobre: o TETO DE VARCHAR. sync.schemas.js:13-46 nao tem um unico .max() e trata data/changes como Joi.object().unknown(true), entao um nome com mais de 255 caracteres chega intacto a layers.name/maps.name/groups.name/briefings.name VARCHAR(255) (002_atlas.sql:118,81,142,330) e levanta 22001. O lote inteiro roda numa transacao so (sync.service.js:632-651), o cliente nao faz dequeue de lote rejeitado e re-peeka as mesmas ops para sempre (sintese-limites-collab.md:52): sync travado, nao degradado, identico em sintoma ao 22P02. E alcancavel pela UI: o input de rename de camada nao tem maxLength, so .trim() (frontend/src/js/features_tab/layer-list.component.js:210-221). O dispatcher pre-flush, que e o guard que o projeto construiu para essa classe, so testa UUID-ness e nao ve isso passar.

**Ação.** Registrar a variante 22001 junto da 22P02 em envelope-operacao.md:31 (a pagina que enuncia a regra "uma op malformada envenena o lote"), dizendo que o gatilho nao e so id nao-UUID mas qualquer valor que o Postgres recuse no cast ou no comprimento. A licao so fica codificada com teste: Joi .max(255) nos campos de nome do envelope OU cap no cliente, mais um teste de regressao que empurre um nome de 300 chars e afirme 422 em vez de 500.

### 6. nenhuma pagina (candidata: docs/wiki/config-dinamico.md, secao 'Precedencia das quatro camadas')

- **Tipo:** armadilha não documentada · **Fatia:** `be-catalog-config-audit`
- **Documento:** `docs/wiki/config-dinamico.md:15-23`
- **Código:** `backend/src/modules/config/config.service.js:236`

**Evidência.** O override de admin e aplicado por deepMerge DEPOIS que o payload ja foi montado (backend/src/modules/config/config.service.js:236), entao todo campo DERIVADO de uma env fica velho quando o admin sobrescreve a fonte. Dois casos reais e alcancaveis pela UI: (1) `map3d.providers.terrain.enabled` e calculado em config.service.js:208 como `Boolean(C.map3dTerrainUrl)`; sobrescrever `map3d.providers.terrain.url` deixa `enabled:false` e o terreno 3D simplesmente nao liga. (2) `streetView360.pointsSource/linesSource` sao montados de `C.sv360ServiceUrl` em config.service.js:227,229; sobrescrever `streetView360.serviceUrl` deixa os templates MVT apontando para a base ANTIGA. O schema abre as duas secoes de proposito (config.admin.schemas.js:34-36,44) e a UI manda o admin usa-las: o hint do editor avancado cita nominalmente 'map3d.initialCamera/providers/bounds, streetView360' (frontend/src/js/admin/config-tab.js:115-116). Nada prende: backend/tests/integration/config-admin.test.js:96-110 faz exatamente esse override de serviceUrl e so afirma o proprio serviceUrl, nunca os tiles. A pagina documenta as derivacoes (linhas 40,42,50) e a precedencia do override (linhas 17,21) em secoes separadas e nunca junta as duas.

**Ação.** Acrescentar um paragrafo curto na secao de precedencia: "O merge do override e a ULTIMA etapa (config.service.js:236), depois das derivacoes. Sobrescrever uma fonte nao recomputa o que dela deriva: `map3d.providers.terrain.url` nao liga `enabled` (:208) e `streetView360.serviceUrl` nao regenera os templates de tiles (:227,229). Ao sobrescrever, escreva TAMBEM o campo derivado."

### 7. nenhuma pagina (candidata: presenca-colaborativa.md)

- **Tipo:** armadilha não documentada · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/canal-collab-websocket.md:27 e docs/wiki/link-publico.md:23 mencionam active_sessions so como restricao de FK`
- **Código:** `backend/src/modules/collab/collab.service.js:8-18, backend/src/database/migrations/003_sync.sql:74-92, backend/src/modules/collab/collab.gateway.js:354,478, backend/src/index.js:50-55`

**Evidência.** A tabela `active_sessions` e escrita a cada connect/disconnect e NUNCA lida: em todo `backend/src` as unicas referencias sao o INSERT e o DELETE de collab.service.js:8-18. O schema engana ativamente em duas frentes: as colunas de presenca `cursor_position`/`current_map_id`/`selected_features` (003_sync.sql:83-86) nunca recebem escrita (a propria NOTE em collab.service.js:20-25 diz que os helpers foram removidos), e `last_heartbeat` so e setado no INSERT (collab.service.js:11) embora exista `CREATE INDEX idx_sessions_heartbeat` (003_sync.sql:92), como se algum sweeper varresse sessao velha. Alem disso as linhas vazam: `createSession`/`deleteSession` sao disparados sem await (gateway:354 e :478) e o shutdown faz `closeAllSockets()` seguido de `pgp.end()` + `process.exit(0)` (index.js:50-55) sem esperar os DELETEs, entao todo restart com usuario conectado orfaniza linhas, e nao existe reaper nem TTL. Nenhum teste prende isso (collab-shutdown-presence.test.js so afirma fechamento de socket e user_left). Um engenheiro lendo collab.service.js conclui o oposto do verdadeiro: que a tabela e a fonte de presenca; provar que e write-only exige grep no backend inteiro.

**Ação.** Um paragrafo em [[presenca-colaborativa]] (secao "O que nao existe"): active_sessions e vestigial, write-only e sem reaper; colunas de presenca e idx_sessions_heartbeat sao restos de um desenho abandonado; nao construa "quem esta online" a partir dela (a verdade e o Map em memoria de collab.rooms.js:6); crescimento monotonico e esperado ate alguem podar tabela ou colunas.

### 8. nenhuma pagina (clone-atlas.md, atlas-import-offline.md e api-rest-atlas.md cobrem perdas vizinhas e omitem esta)

- **Tipo:** armadilha não documentada · **Fatia:** `be-atlas`
- **Documento:** `docs/wiki/atlas-import-offline.md:11`
- **Código:** `backend/src/modules/atlas/atlas.service.js:586`

**Evidência.** Clone, duplicate e import gravam camadas de catalogo APENAS na coluna legada `maps.catalog_layers` (`atlas.service.js:306,321` clone; `:416,431` duplicate; `:586,602` import). Nenhum caminho do modulo atlas insere na tabela dedicada `catalog_layers` (unico INSERT do backend inteiro: `backend/src/modules/sync/sync.service.js:1201`). Mas o snapshot que o cliente recebe monta `map.catalogLayers` a partir da TABELA (`backend/src/modules/sync/sync.queries.js:51-56` + `sync.service.js:485-491`), e o cliente le exatamente `mapData.catalogLayers` (`frontend/src/js/store/catalog.operations.js:74`); `reshapeSnapshotMap` faz spread do resto (`frontend/src/js/store/sync/remote-operation-handler.js:1132`), entao a coluna legada trafega e nunca e lida. Resultado: 'Salvar no servidor' envia as camadas (`frontend/src/js/import_export/local-atlas-to-server.js:316`), o servidor as guarda na coluna morta, o fluxo obrigatorio limpa o store e puxa snapshot (`docs/wiki/atlas-import-offline.md:57`), e o usuario recebe `catalogLayers: []`. Perda silenciosa, mesma classe do `grid_style`/`temporal_config` ja documentada em api-rest-atlas.md:51, e contradiz a afirmacao de paridade em atlas-import-offline.md:11 ('o payload de import cobre o MESMO conjunto do .ebgeo, nao um subconjunto'). Emerge de 4 arquivos e nenhum deles denuncia sozinho.

**Ação.** Uma linha em clone-atlas.md (secao 'Armadilhas') e uma em atlas-import-offline.md: clone/duplicate/import preservam so `maps.catalog_layers` (coluna legada), o snapshot le a tabela `catalog_layers`, logo as camadas de catalogo somem sem erro. Ajustar a frase de paridade em atlas-import-offline.md:11 para 'mesmo conjunto exceto camadas de catalogo'. Registrar como bug de omissao (nao decisao), como ja foi feito para grid_style/temporal_config.

### 9. nenhuma pagina (gestao-usuarios.md:27 discute o caso sem SMTP e para antes)

- **Tipo:** armadilha não documentada · **Fatia:** `be-auth`
- **Documento:** `docs/wiki/gestao-usuarios.md:27`
- **Código:** `backend/src/utils/mailer.js:67-76 + backend/src/config.js:128`

**Evidência.** gestao-usuarios.md:27 diz "Quando nao ha SMTP configurado, o desbloqueio oficial e o admin enviar `email_verified: true`", e nao menciona o que o servidor faz de fato: `if (!isSmtpConfigured()) logger.info({ to, link }, ...)` (mailer.js:68) grava o LINK COMPLETO, com o token de ativacao, no log em nivel info. O ramo e decidido so por `config.mail.host` (mailer.js:21), cujo default e '' (config.js:128), sem nenhum guard de `isProd`. Ou seja, numa instalacao de rede fechada sem relay (o cenario que o proprio comentario de config.js:124-126 antecipa como normal), TODO token de verificacao de TODA conta vai para o stream de log em producao. Quem tem leitura de log tem ativacao de conta alheia. O mesmo vale para o ramo nodemailer ausente (mailer.js:74, nivel warn).

**Ação.** Acrescentar em gestao-usuarios.md:27 (ou na secao de verificacao de autenticacao-jwt.md) uma linha: sem SMTP o token vai para o log (`backend/src/utils/mailer.js:67-70`), portanto o log passa a ser material de credencial. Se a decisao for aceitar isso em dev e nao em prod, registrar como decisao com a alternativa rejeitada.

### 10. sintese-rest-vs-sync

- **Tipo:** armadilha não documentada · **Fatia:** `be-sync`
- **Documento:** `docs/wiki/sintese-rest-vs-sync.md:15-19`
- **Código:** `backend/src/modules/sync/sync.service.js:1349`

**Evidência.** `mapOrder` tem DOIS donos no servidor com o mesmo nome e vocabularios diferentes, e os dois viajam no MESMO snapshot. (1) A whitelist de settings do sync aceita `patch.mapOrder` para dentro de atlas.settings (sync.service.js:1347-1349), alimentada por frontend/src/js/store/map.operations.js:157-161 com um array de NOMES de mapa (JSDoc em :145). (2) A coluna `atlas.map_order` e UUID[] (backend/src/database/migrations/002_atlas.sql:17), escrita so por REST (backend/src/modules/atlas/atlas.service.js:333, :440 no duplicate, :711 no import) e servida no snapshot como `snapshot.atlas.mapOrder` (sync.service.js:572), consumida como lista de IDS em frontend/src/js/store/services/map-resolver.service.js:34-35. Nao ha reconciliacao entre as duas: reordenar por sync nunca atualiza a coluna, e duplicar um mapa (que da append em map_order) nunca atualiza o settings. A pagina que existe justamente para isto ("A armadilha central: atlas.settings tem dois donos", :15-19, que manda "decida a qual lado a chave pertence antes da primeira linha de codigo") lista a whitelist como "preferencias de app" e nao registra que uma das chaves colide com uma coluna de primeira classe. Nenhuma pagina da wiki menciona a whitelist mapOrder (grep por mapOrder/map_order no corpus so acha atlas-import-offline.md:71, clone-atlas.md:27 e api-rest-atlas.md:84, todos sobre a coluna).

**Ação.** Acrescentar o item a sintese-rest-vs-sync.md:21-24 (as "duas consequencias que economizam depuracao"): `mapOrder` e a excecao a regra da propria pagina, a mesma nocao mora nos dois lados da fronteira, por nomes na settings e por UUIDs na coluna, e o snapshot entrega ambos. Dizer qual e autoritativo para qual leitor, ou registrar como [!DEBATE] se a duplicidade for intencional.

### 11. nenhuma pagina

- **Tipo:** ausência · **Fatia:** `be-sv360`
- **Código:** `backend/src/modules/streetview360/sv360.merge.js:169-173`

**Evidência.** Comportamento silencioso que emerge de quatro arquivos e nenhuma pagina cobre: DELETE /admin/projects/:slug e hard-delete (sv360.admin.queries.js:206-210) e o CASCADE so alcanca photos e targets; sv360.deleted_photos nao tem FK por decisao (005_sv360.sql:94-96), entao os tombstones do projeto sobrevivem. Na reingestao, mergeProject so limpa tombstone dos ids devolvidos por PURGE_PROJECT_PHOTOS (sv360.merge.js:169-173) e, depois de um hard-delete, esse retorno e vazio. Como os ids de foto sao UUID v5 deterministicos, o reupload reinsere as MESMAS fotos, e todo read faz NOT EXISTS deleted_photos (sv360.queries.js:51, :75, :90, :149): as fotos existem no Postgres e sao invisiveis em toda rota, sem erro, sem 404 explicavel. Os proprios testes limpam sv360.deleted_photos a mao (backend/tests/integration/sv360-gaps.test.js:227, sv360-coverage.test.js:230), sinal de que ja bateram nisso.

**Ação.** Adicionar a ingestao-projetos-360.md, ao lado da consequencia inversa ja documentada em calibracao-e-grafo-360.md:60 ("foto apagada por REST volta a existir"), o caso hard-delete: apagar o projeto e reingerir devolve fotos invisiveis; a limpeza de sv360.deleted_photos precisa ser explicita no deleteProject ou registrada como passo manual.

### 12. nenhuma pagina (candidata: autenticacao-jwt.md secao "Registro e verificacao", ou gestao-usuarios.md:27)

- **Tipo:** ausência · **Fatia:** `be-auth`
- **Documento:** `docs/wiki/gestao-usuarios.md:27 (fala do caso sem SMTP e omite isto)`
- **Código:** `backend/src/utils/mailer.js:31-34 + backend/src/modules/auth/auth.controller.js:29-31 + backend/src/config.js:133`

**Evidência.** O link de confirmacao e montado com `config.mail.appBaseUrl || origin` (mailer.js:32), onde `origin` vem de `req.headers.origin` (auth.controller.js:30, `requestOrigin`) e `appBaseUrl` tem default '' (config.js:133, `optional('APP_BASE_URL', '')`). Com APP_BASE_URL nao setado, o host do link de ativacao de conta e controlado pelo atacante: um POST /auth/resend-verification com `Origin: https://atacante.tld` e o e-mail da vitima faz o servidor enviar A ELA um link de verificacao apontando para o dominio do atacante, com o token real na query. E injecao de host em e-mail de credencial, classica e nao obvia: emerge de tres arquivos (controller, mailer, config) e de um default vazio. APP_BASE_URL nao aparece em NENHUMA das 67 paginas da wiki nem em backend/.env.example. Nenhuma pagina cobre `u/mailer.js` (o proprio indice ja registra o modulo como buraco).

**Ação.** Uma secao curta em autenticacao-jwt.md (ou pagina nova `verificacao-de-email`) registrando: (a) o link e derivado do header Origin quando APP_BASE_URL falta; (b) por isso APP_BASE_URL e obrigatoria em producao, do lado de CORS_ORIGIN em deploy-backend.md:48; (c) a armadilha de tratar `origin` de request como base confiavel. Citar mailer.js:32 e auth.controller.js:30.

### 13. nenhuma pagina (candidatas: hardening-borda-api.md, ranking-busca-toponimos.md)

- **Tipo:** ausência · **Fatia:** `be-nomes-zones`
- **Documento:** `docs/wiki/ranking-busca-toponimos.md:40`
- **Código:** `backend/src/modules/nomes/nomes.routes.js:15`

**Evidência.** GET /nomes/busca e o unico endpoint anonimo, sem rate limit e com custo de CPU proporcional a tabela inteira, e nenhuma pagina registra isso como superficie de abuso. As tres pecas estao em arquivos diferentes e nenhuma delas, lida sozinha, denuncia o problema: (1) a rota nao tem limitador nem auth estrito (backend/src/modules/nomes/nomes.routes.js:15, deliberado, documentado em gazetteer-nomes-geograficos.md:23); (2) so existem dois limitadores no backend inteiro (backend/src/middleware/rate-limit.js:25 e :39) e eles sao montados exclusivamente em backend/src/modules/auth/auth.routes.js:15-21 e backend/src/modules/atlas/atlas.routes.js:23, sem limitador global em app.js; (3) o pre-filtro e escrito como similarity(...) > 0.25 (backend/src/modules/nomes/nomes.queries.js:21), forma que o planner NAO casa com o GIN trigram de 004_ng.sql:43-44, logo seq scan sobre ng.nomes_geograficos a cada request. ranking-busca-toponimos.md:40 documenta o seq scan, mas so como proibicao de otimizacao (nao troque por % porque muda o ranking congelado), nunca como capacidade: fica a impressao de que o custo e aceito, quando ele e pago por qualquer anonimo em loop. hardening-borda-api.md fala de rate limiting apenas do authLimiter (:7-20) e nao menciona quais rotas ficam de fora.

**Ação.** Acrescentar em hardening-borda-api.md (secao de rate limiting, que hoje so cobre authLimiter) um paragrafo nomeando /nomes/busca como o unico endpoint anonimo sem balde, cruzando com o seq scan ja descrito em ranking-busca-toponimos.md:40, e dizendo o que fazer (limitador por IP na rota, ou aceitar explicitamente e registrar a decisao). Cruzar com um link de ranking-busca-toponimos.md:40 para hardening-borda-api.md.

### 14. snapshot-e-pull-incremental

- **Tipo:** contrato não documentado · **Fatia:** `be-sync`
- **Documento:** `docs/wiki/snapshot-e-pull-incremental.md:9`
- **Código:** `backend/src/modules/sync/sync.service.js:445`

**Evidência.** A pagina diz que o snapshot "e reconstruido das tabelas de entidade numa leitura so", o que se le como atomicidade e e o oposto do as-built: getAtlasSnapshot usa `task()` (sync.service.js:443), que e conexao compartilhada SEM transacao (backend/src/database/index.js:96-102), e emite cerca de 4 + 7 por mapa + 2 por briefing consultas sequenciais (sync.service.js:475-548 e 551-564). Ou seja, um push concorrente pode commitar NO MEIO da montagem do snapshot. O que salva e um detalhe de ordenacao que nenhuma pagina registra: `current_version` vem na PRIMEIRA query (GET_ATLAS_METADATA, sync.service.js:445) e e devolvido como cursor do cliente (sync.service.js:578). Com o cursor lido ANTES dos dados, a op concorrente cai acima do cursor e volta no pull incremental (reaplicacao idempotente, direcao segura). Invertido, lendo o cursor no fim (por exemplo com o GET_CURRENT_VERSION que ja existe em sync.queries.js:21-25 e que pushOperations usa em :766), a op comitada durante a montagem ficaria abaixo do cursor e ABAIXO do corte `server_version > $2`: perdida para sempre, sem erro. E a mesma classe de falha silenciosa que justificou o advisory lock e ganhou secao propria em modelo-conflito-lww.md:21-25, mas aqui nao ha lock nenhum protegendo.

**Ação.** Corrigir "numa leitura so" e acrescentar o invariante em snapshot-e-pull-incremental.md: o cursor e lido antes dos dados, de proposito, e essa ordem e o que torna o snapshot nao-transacional seguro. Formular como proibicao (nao mova a leitura de current_version para o fim, nao a troque por GET_CURRENT_VERSION), que e a forma que pega o refatorador.

### 15. canal-collab-websocket.md

- **Tipo:** desatualizada · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/canal-collab-websocket.md:17,19,27,42,46`
- **Código:** `backend/src/modules/collab/collab.gateway.js:180,250,323,353,486,501`

**Evidência.** Cinco citacoes arquivo:linha da pagina apontam para linhas que nao contem mais o que ela afirma, com deriva sistematica: :160 ("chamada de heartbeatSweep") cai num `} catch (err) {`, a chamada real esta em :180 dentro de heartbeatSweep :173-182; :230 e :303 (fallback de clientId / `crypto.randomUUID()`) caem em `server.on('upgrade'` e num `});`, o codigo real esta em :249-250 e :323; :333 (pular sessao de visitante publico) cai num `}`, o real e :351-355; :468 (onClose) cai num `}` do switch, `function onClose` esta em :501; :453 (user_left so no ultimo socket) cai num comentario do case 'leave', o guard real esta em :481-489. A deriva e +20 apos o bloco `closeAllSockets` (:184-210) e +33 apos o bloco de serializacao `_messageChain` (:379-400), ambos adicionados depois da pagina. Prova de que e deriva local e nao renumeracao do repo: sintese-limites-collab.md:23,62 cita as MESMAS funcoes corretamente (:34, :173-182, :522-530). O guard docs-integridade.test.js valida so o caminho, nunca a linha (comentario explicito em :76-77), entao isso apodrece verde.

**Ação.** Reancorar as cinco citacoes para :180, :249-250, :323, :351-355, :481-489. Como o teste nao pega linha, preferir ancorar em NOME de funcao mais faixa curta (ex.: `reconcileAuthorization` em :118-163) em vez de linha solta.

### 16. docs/wiki/api-rest-atlas.md

> **CORRIGIDO em 2026-07-24.** Resolvido pela inversão da regex do `frontend/tests/unit/docs-integridade.test.js`: o prefixo deixou de ser lista fechada e virou asserção (coleta qualquer token com cara de caminho, resolve contra as raízes reais dos pacotes e contra o diretório do próprio documento). As 55 citações com prefixo pré-monorepo foram reescritas com verificação de existência do destino, mais 29 referências de diretório e os 3 ponteiros `MUST stay in lockstep` que viviam em comentário de CÓDIGO, fora do alcance de qualquer varredura de .md. O ponteiro de `trace-stages.js` estava morto duas vezes (prefixo legado + diretório `collab/trace/` que nunca existiu); aponta agora para `backend/src/utils/sync-trace.js`.


- **Tipo:** desatualizada · **Fatia:** `be-atlas`
- **Documento:** `docs/wiki/api-rest-atlas.md:13`
- **Código:** `frontend/src/js/modals/project-picker.modal.js:375`

**Evidência.** A 'Nota historica' afirma: "O proprio frontend cai nessa armadilha: `frontend/src/js/modals/project-picker.modal.js:369-370` faz `perm === 'owner' || perm === 'write'`, entao o co-Gestor nao ve 'Renomear' no card". O codigo ja foi corrigido: `project-picker.modal.js:375` faz `const canWrite = perm === 'owner' || perm === 'manage' || perm === 'write';`, e as linhas 369-374 (que a doc cita como sendo o bug) sao hoje o comentario que EXPLICA a correcao ("Hierarquia de CINCO niveis... Uma lista fechada `=== 'owner' || === 'write'` exclui o co-Gestor"). Ou seja: a citacao arquivo:linha aponta para a explicacao do fix, e a pagina mais autoritativa sobre a armadilha C1 apresenta um bug ja morto como vivo. E supersessao temporal, nao contradicao.

**Ação.** Remover a nota ou move-la para `## Historico` como 'corrigido em <commit>', mantendo o exemplo do bug apenas como ilustracao passada. Reapontar qualquer citacao para `frontend/src/js/modals/project-picker.modal.js:375` (e corrigir o prefixo `ebgeo_web/` -> `frontend/`).

### 17. docs/wiki/config-dinamico.md

> **CORRIGIDO em 2026-07-24.** O marcador `[!CONTRADICAO 2026-07-18]` de `docs/wiki/config-dinamico.md` foi marcado RESOLVIDO com a referência ao commit `14f703f`, que já havia corrigido o teste. Era nota pendente sobre defeito morto.

- **Tipo:** desatualizada · **Fatia:** `be-boot`
- **Documento:** `docs/wiki/config-dinamico.md:34 (e a repeticao em :71)`
- **Código:** `frontend/tests/e2e/config-contract.e2e.test.js:56-70`

**Evidência.** O marcador `> [!CONTRADICAO 2026-07-18]` diz que o teste de contrato "exige `cfg.search.apiUrl` como string nao vazia e `cfg.services.tileServerUrl.length > 0`". O teste ja foi corrigido (commit 14f703f, "config-contract afirma o shape e o invariante, nao o deployment"): hoje ele afirma `typeof cfg.services.tileServerUrl === 'string'` e afirma a AUSENCIA de `apiUrl` (`expect(cfg.search).not.toHaveProperty('apiUrl')`), citando `backend/src/config.js:140` como o porque de vazio ser o sinal deliberado de "nao configurado". A citacao do proprio marcador tambem nao resolve mais: `config-contract.e2e.test.js:50-57` e hoje o bloco de chaves de topo congeladas, nao os asserts nomeados. Contradicao pendente e o unico estado que acorda o gate da wiki, e esta ja esta resolvida contra o codigo. O checklist em :71 ("ciente de que o teste ja esta desatualizado em `search`/`services`") propaga a mesma informacao morta.

**Ação.** Apagar o marcador de :34 e o paretenses de :71, e registrar a resolucao no `## Historico` da pagina como supersessao temporal (o teste foi realinhado ao contrato, nao o contrario).

### 18. docs/wiki/config-dinamico.md:34 (marcador [!CONTRADICAO 2026-07-18] pendente) e a linha 71

> **CORRIGIDO em 2026-07-24.** Mesmo marcador do item #17, resolvido na mesma passada.

- **Tipo:** desatualizada · **Fatia:** `be-catalog-config-audit`
- **Documento:** `docs/wiki/config-dinamico.md:34`
- **Código:** `frontend/tests/e2e/config-contract.e2e.test.js:56-71`

**Evidência.** O marcador afirma que `frontend/tests/e2e/config-contract.e2e.test.js:50-57` exige `cfg.search.apiUrl` como string nao vazia e `cfg.services.tileServerUrl.length > 0`, e conclui que "o teste que deveria guardar o contrato congelado esta desatualizado". O teste foi reescrito (commit 14f703f, "config-contract afirma o shape e o invariante, nao o deployment"): hoje afirma a AUSENCIA de apiUrl (`expect(cfg.search).not.toHaveProperty('apiUrl')`, linha 70) e so `typeof cfg.services.tileServerUrl === 'string'` (linha 61), alem de trocar `terrain.enabled === true` pelo invariante `terrain.enabled === Boolean(terrain.url)` (linha 121). O conflito nao existe mais, e a linha 71 do checklist ainda avisa ao leitor para agir "ciente de que o teste ja esta desatualizado em search/services", o que hoje desqualifica o guarda correto.

**Ação.** Apagar o marcador [!CONTRADICAO 2026-07-18], remover a ressalva da linha 71 e registrar uma linha no ## Historico (supersessao temporal, nao contradicao). Opcionalmente citar config-contract.e2e.test.js:121 como o teste que hoje prende o invariante terrain.enabled === Boolean(terrain.url).

### 19. presenca-colaborativa.md

- **Tipo:** desatualizada · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/presenca-colaborativa.md:23,51,53`
- **Código:** `backend/src/modules/collab/collab.gateway.js:327-333,475-490,502`

**Evidência.** Mesma deriva da pagina irma, em tres citacoes que sustentam as armadilhas centrais da pagina: :440-460 (removeConnection / user_left so no ultimo socket) cai dentro do switch de handleMessage, o codigo real e :475-490; :469 (discriminador `code === 1006 && ws.intentionalLeave !== true`) cai no fecho de handleMessage, a linha real e :502; :300-313 (onConnection cancela o timer e faz leaveRoom do socket morto antes de tudo) cai no meio do handler de upgrade, o codigo real e :327-333. As tres sao justamente os pontos onde a pagina diz "so aparece cruzando os arquivos", ou seja, as citacoes que o leitor mais vai seguir.

**Ação.** Reancorar para :475-490, :502 e :327-333.

### 20. autenticacao-jwt.md e hardening-borda-api.md (mesma citacao propagada)

> **CORRIGIDO em 2026-07-24.** A âncora da allowlist HS256 apontava para `backend/src/config.js:45`, que é `poolMax` do Postgres. Corrigida para `:53` (`algorithms: ['HS256']`) nas duas páginas que propagavam a citação, `autenticacao-jwt.md` e `hardening-borda-api.md`. Importa mais que uma linha errada qualquer: é a âncora da defesa contra `alg: none`, que a própria página chama de risco mais provável.

- **Tipo:** divergência · **Fatia:** `be-auth`
- **Documento:** `docs/wiki/autenticacao-jwt.md:39 e docs/wiki/hardening-borda-api.md:32`
- **Código:** `backend/src/config.js:53`

**Evidência.** As duas paginas ancoram a allowlist HS256 em `backend/src/config.js:45`. A linha 45 e `poolMax: parseInt(optional('DATABASE_POOL_MAX', '10'), 10)`, do pool do Postgres. `algorithms: ['HS256']` esta em backend/src/config.js:53. A citacao errada foi copiada de uma pagina para a outra, e e justamente a ancora da defesa contra `alg: none`, que hardening-borda-api.md:34 chama de "o risco mais provavel desta pagina". Um agente que abrir config.js:45 para confirmar a allowlist encontra configuracao de pool e conclui que a doc esta obsoleta em bloco. O teste de integridade nao pega: RE_CAMINHO em frontend/tests/unit/docs-integridade.test.js:81 valida so o caminho, e o proprio comentario em :77-79 declara que o numero da linha nao e verificavel ali.

**Ação.** Trocar `config.js:45` por `backend/src/config.js:53` nas duas paginas na mesma edicao (a duplicata e o mecanismo do apodrecimento).

### 21. backend/CLAUDE.md

> **CORRIGIDO em 2026-07-24.** `backend/CLAUDE.md` deixou de afirmar que `maps` tem apenas GET. A regra foi reescrita como escrita INCREMENTAL só via sync, com as três exceções estruturais nomeadas e o critério que as une (operação de ENTIDADE INTEIRA, cujo efeito não é representável como sequência de ops): `POST /maps/:mapId/merge`, `POST /atlas/import` e `POST /atlas/:atlasId/maps/:mapId/duplicate`. Ficaram registradas junto as duas armadilhas conhecidas: escrita por REST não avança `atlas.current_version` (o merge compensa com op marcadora) e o gate do merge protege uma rota que este cliente não chama.

- **Tipo:** divergência · **Fatia:** `estrutural`
- **Código:** `backend/src/modules/maps/maps.routes.js:17`

**Evidência.** backend/CLAUDE.md (§Decisões de arquitetura, bloco 1) afirma "`maps`/`briefings` têm apenas GET". Falso para maps: `maps.routes.js:17` é `router.post('/:mapId/merge', auth, requireAtlasPermission('write'), …)`. E há mais duas escritas REST sobre entidade colaborativa: `backend/src/modules/atlas/atlas.routes.js:22` (POST /import) e `:44` (POST /:atlasId/maps/:mapId/duplicate). Briefings sim é GET-only (briefings.routes.js:11-12). A wiki já corrigiu isso em sintese-decisoes-arquiteturais.md:66 ("leia a regra como escrita INCREMENTAL só via sync"), mas a correção nunca voltou ao backend/CLAUDE.md, que é a fonte que o agente lê primeiro.

**Ação.** Reescrever o invariante em backend/CLAUDE.md como "escrita INCREMENTAL só via sync", nomeando as três exceções atômicas com arquivo:linha, e propagar a mesma redação para modelo-conflito-lww.md:51 e sintese-nao-e-crdt.md:31, que ainda repetem a formulação ampla demais.

### 22. backend/CLAUDE.md

> **CORRIGIDO em 2026-07-24.** A enumeração de módulos saiu de `backend/CLAUDE.md`. Estava errada em dois pontos (dizia `resources`, que não existe — o diretório é `catalog/` — e omitia `ranks/` inteiro), e é a mesma classe da árvore de diretórios que apodreceu em `.claude/rules/architecture.md`. Foi substituída por um ponteiro para `ls src/modules/`, mantendo só o que não se adivinha: `debug` só é montado com o tracer ligado.

- **Tipo:** divergência · **Fatia:** `estrutural`
- **Código:** `backend/src/modules/ranks/ranks.routes.js`

**Evidência.** A linha de layout de backend/CLAUDE.md (§Stack & layout) lista os módulos como `auth users organizations atlas maps briefings resources sharing images sync collab config nomes zones streetview360 audit debug`. Dois erros contra `ls backend/src/modules/`: (a) não existe módulo `resources`, o diretório real é `catalog/`; (b) o módulo `ranks/` (6 arquivos: routes/controller/service/queries/schemas/index) está OMITIDO. É a mesma classe da árvore de diretórios que apodreceu em .claude/rules/architecture.md.

**Ação.** Corrigir `resources`→`catalog` e acrescentar `ranks`; ou trocar a enumeração por uma linha dizendo que `ls src/modules/` é a fonte, mantendo só os módulos cujo nome não se autoexplica (`debug`, `catalog`).

### 23. backend/CLAUDE.md (constituição do pacote) + CLAUDE.md raiz + backend/README.md

> **CORRIGIDO em 2026-07-24.** As três fontes foram alinhadas na mesma passada: `backend/CLAUDE.md`, o `CLAUDE.md` da raiz e `backend/README.md`. Nota sobre o relatório: ele cita o merge como `write` em `maps.routes.js:17`; hoje é `manage` em `:23`, porque um achado anterior elevou o gate. A substância do item continuava válida — a rota de escrita existe.

- **Tipo:** divergência · **Fatia:** `be-maps-briefings`
- **Documento:** `backend/CLAUDE.md:46 ; CLAUDE.md:33 ; backend/README.md:49`
- **Código:** `backend/src/modules/maps/maps.routes.js:17`

**Evidência.** backend/CLAUDE.md:46 afirma literalmente "`maps`/`briefings` têm **apenas GET**" e CLAUDE.md:33 (raiz) proíbe "rota REST de escrita para feature/map/layer/group/briefing/slide". O código tem `router.post('/:mapId/merge', auth, requireAtlasPermission('write'), validate(...), ctrl.mergeMaps)` em backend/src/modules/maps/maps.routes.js:17, que faz UPDATE em seis tabelas filhas (maps.service.js:57-65). backend/README.md:49 repete o erro ("maps ... escrita só via sync") enquanto o próprio README.md:327 documenta a rota corretamente. A wiki já resolveu isso (sintese-decisoes-arquiteturais.md:66 e sintese-rest-vs-sync.md:28), mas a constituição, que é o que o agente lê PRIMEIRO e trata como invariante, ficou desatualizada. O efeito prático é o pior possível: um agente que siga a regra ao pé da letra lê a rota `merge` como violação de invariante e a remove, ou recusa mexer nela.

**Ação.** Corrigir backend/CLAUDE.md:46 e CLAUDE.md:33 para "escrita INCREMENTAL de entidade colaborativa é só via sync; as exceções estruturais atômicas (merge, duplicate, clone, import) são REST por decisão registrada, ver [[sintese-rest-vs-sync]]". Corrigir backend/README.md:49 na mesma linha. É mudança de uma linha em cada, e alinha a constituição com o que a wiki já concluiu.

### 24. canal-collab-websocket.md / presenca-colaborativa.md

- **Tipo:** divergência · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/canal-collab-websocket.md:23 e docs/wiki/presenca-colaborativa.md:39`
- **Código:** `backend/src/modules/sync/sync.service.js:600-611`

**Evidência.** As duas paginas prescrevem o gate de escrita como `permission !== 'read'` (canal:23 "O contrato manda decidir escrita por `permission !== 'read'`"; presenca:39 "para autorizar escrita cheque `permission !== 'read'`, nao `role`"). O gate AUTORITATIVO do servidor e `assertOperationAllowed` (sync.service.js:600-611): alem de `read`, o nivel `comment` so pode escrever `op.target === 'comment'`, qualquer outra op lanca ForbiddenError. Os handlers de collab so fazem a checagem rasa `ws.permission === 'read'` (collab.handlers.js:115 e :166), entao quem confia na doc deixa o Comentarista enfileirar op de feicao; e como o lote e atomico com advisory lock (sync.service.js:653-672, fato ja documentado em sintese-limites-collab.md:50-52), a op recusada faz rollback do lote inteiro e a fila outbound trava em poison batch. A doc publica exatamente a lista fechada de permissao que a constituicao proibe (C1/I2), e desta vez como prescricao.

**Ação.** Corrigir as duas linhas para o gate real: `read` nao escreve nada; `comment` escreve SO `target:'comment'`; `write`/`manage`/`owner` escrevem tudo (com map-delete e map-lock reservados a `owner`). Citar `backend/src/modules/sync/sync.service.js:600-611` como fonte e apontar a consequencia (poison batch) para [[sintese-limites-collab]] §6.

### 25. docs/wiki/api-rest-atlas.md

- **Tipo:** divergência · **Fatia:** `be-atlas`
- **Documento:** `docs/wiki/api-rest-atlas.md:29`
- **Código:** `backend/src/modules/atlas/atlas.schemas.js:10`

**Evidência.** A doc afirma, em negrito, uma 'Assimetria perigosa': "`name: ""` vira `null`, o `COALESCE` preserva o nome antigo e a API responde **200 com o nome inalterado**. Falha silenciosa, nao 422." O codigo faz exatamente o oposto: a rota valida na borda (`backend/src/modules/atlas/atlas.routes.js:27` -> `validate({ body: updateAtlasSchema })`) e `updateAtlasSchema.name` e `Joi.string().max(255)` (`atlas.schemas.js:10`), que por default REJEITA string vazia. Verifiquei executando o schema real com as opcoes reais do `validate` (`backend/src/middleware/validate.js:3-6`): `{name:''}` => ERROR "name is not allowed to be empty", `{name:null}` => ERROR "name must be a string". O `errorHandler` mapeia `err.isJoi` para 422 VALIDATION_ERROR (`backend/src/middleware/error-handler.js:28-39`), e ha teste que fixa esse comportamento no POST irmao (`backend/tests/integration/atlas-gaps.test.js:326-333`). O ramo `data.name || null` (`atlas.service.js:54`) e defensivo e inalcancavel para `''`. A doc engana em dobro: nega o 422 que realmente acontece e manda o cliente tratar um no-op silencioso que nao existe.

**Ação.** Apagar o bullet do `name` (o bullet do `description` esta correto e deve ficar). Se quiser preservar a licao, reescrever como o oposto: a borda Joi impede o caso, entao `name` NUNCA chega ao COALESCE vazio; o COALESCE so importa para `description`/`map_order`.

### 26. docs/wiki/compartilhamento-atlas.md

- **Tipo:** divergência · **Fatia:** `be-sharing`
- **Documento:** `docs/wiki/compartilhamento-atlas.md:41`
- **Código:** `backend/src/modules/collab/collab.gateway.js:118-158`

**Evidência.** A pagina afirma (linha 41) que "A permissao do WebSocket tambem e resolvida uma vez, na conexao (backend/src/modules/collab/collab.gateway.js:86-100), nao a cada frame, entao a remocao so morde de fato na proxima sessao ou no proximo push" e que "Quem for removido continua com a UI de edicao ate o proximo reconnect ou ate um 403". O codigo faz o oposto: reconcileAuthorization roda em TODA batida de heartbeat (~30s, setInterval em backend/src/modules/collab/collab.gateway.js:309), rechama a mesma resolvePermission e, quando o share sumiu e o atlas nao e publico, FECHA o socket com ws.close(4003, 'access revoked') (backend/src/modules/collab/collab.gateway.js:150). Se o atlas for publico a resolucao cai para 'read' e o socket so e rebaixado (ws.permission = current, :158). Quatro paginas irmas ja descrevem o comportamento certo e contradizem esta: permissoes-atlas.md:32, sintese-eixos-de-permissao.md:25, link-publico.md:31 e atlas-modelo-de-dados.md:9. A citacao :86-100 resolve (e a resolucao de handshake), mas a conclusao tirada dela e falsa porque a mesma funcao e re-chamada pelo sweep.

**Ação.** Reescrever a secao "Re-gate ao vivo" da linha 41: manter o buraco real (o frontend so trata user_added/user_updated em frontend/src/js/store/sync/sync-engine.js:465-472), mas trocar a afirmacao sobre o WS por: a remocao de share fecha o socket com 4003 dentro de um heartbeat (~30s, collab.gateway.js:150), exceto em atlas publico, onde vira rebaixamento para 'read' (:158). Citar collab.gateway.js:118-158 no lugar de :86-100.

### 27. docs/wiki/config-dinamico.md:21

- **Tipo:** divergência · **Fatia:** `be-catalog-config-audit`
- **Documento:** `docs/wiki/config-dinamico.md:21`
- **Código:** `backend/src/modules/config/config.service.js:44-53`

**Evidência.** A pagina afirma sobre os overrides de admin: "Mudancas sao auditaveis via [[auditoria]]". Nao existe nenhuma chamada a createAudit em backend/src/modules/config/ (nem em catalog/): `grep -rn createAudit backend/src` devolve exatamente 6 call sites, todos em modules/organizations, modules/users e modules/zones. O unico rastro de uma escrita de config e a coluna updated_by gravada em config_settings (backend/src/modules/config/config.service.js:47-51). A propria wiki diz o contrario para o modulo irmao: docs/wiki/resources-catalogo.md:34 registra "Escritas de catalogo nao sao auditadas... Trabalho a fazer, nao algo existente", e docs/wiki/auditoria.md:23 confirma os 6 call sites. Um admin que gravou uma URL errada no override e procurar rastro em audit_trail nao acha nada.

**Ação.** Trocar a frase por "PUT/DELETE /config/admin NAO geram evento em audit_trail: o unico rastro e a coluna updated_by de config_settings (config.service.js:47-51). Mesma lacuna do catalogo ([[resources-catalogo]] secao 'O que nao existe')." Manter o wikilink para [[auditoria]] so como referencia do que existe hoje.

### 28. docs/wiki/config-dinamico.md:23

- **Tipo:** divergência · **Fatia:** `be-catalog-config-audit`
- **Documento:** `docs/wiki/config-dinamico.md:23`
- **Código:** `backend/src/modules/config/config.admin.schemas.js:45-46`

**Evidência.** A pagina justifica a rejeicao de chaves de topo desconhecidas assim: "basemaps/tilesets/camadas tem CRUD proprio de catalogo e injeta-los por aqui contornaria esse CRUD". O schema aceita explicitamente `analysisLayers` e `dataLayers` como chaves de topo abertas (backend/src/modules/config/config.admin.schemas.js:45-46, `Joi.object().unknown(true)`), e o deepMerge SUBSTITUI arrays inteiros (config.service.js:27). Logo `PUT /config/admin {"analysisLayers":{"layers":[...]}}` troca o array vindo do catalogo por completo, contornando o CRUD que a frase diz proteger E o filtro de bounds de config.service.js:93-95, que a propria pagina (linha 38) descreve como a defesa que existe "para que /api/config nao consiga emitir payload fora do contrato". So basemaps e tilesets sao de fato rejeitados; 'camadas' nao.

**Ação.** Corrigir a frase para nomear so basemaps/tilesets como bloqueados e acrescentar a armadilha: analysisLayers/dataLayers SAO sobrescreviveis pelo override e o array substitui o do catalogo sem passar pelo filtro de bounds, ou seja, o override e o unico caminho pelo qual /api/config volta a emitir camada sem bounds.

### 29. docs/wiki/deploy-backend.md

- **Tipo:** divergência · **Fatia:** `be-database`
- **Documento:** `docs/wiki/deploy-backend.md:28`
- **Código:** `backend/src/database/migrations/004_ng.sql:154-169`

**Evidência.** deploy-backend.md:28 afirma como fato o racional que gazetteer-nomes-geograficos.md:76 ja marcou como FALSO: "COPY bypassa o trigger BEFORE INSERT". No PostgreSQL, COPY DISPARA triggers de linha BEFORE INSERT (so regras e triggers de statement ficam de fora), e alem disso tipo_peso tem DEFAULT 0.1 (004_ng.sql:36) e a query usa COALESCE(d.tipo_peso, 0.1) (backend/src/modules/nomes/nomes.queries.js:46). O motivo verdadeiro pelo qual ng.refresh_busca() e obrigatorio e outro e esta no proprio arquivo: NENHUM trigger calcula cluster_id, so ng.recomputar_clusters() (004_ng.sql:154-161) o preenche. Duas paginas da wiki se contradizem e a que esta sem a ressalva e justamente o runbook de deploy, que e o que alguem le antes de carregar toponimos em massa. Se um dia alguem testar a metade errada do racional ("COPY dispara o trigger, entao o refresh e desnecessario"), remove a chamada e a busca degrada em silencio pelo cluster_id.

**Ação.** Reescrever deploy-backend.md:28 ancorando o "obrigatorio e manual" em cluster_id (004_ng.sql:154-161, unico produtor do campo) e nao em COPY/BEFORE INSERT; adicionar o link [[gazetteer-nomes-geograficos]] para a CONTRADICAO ja registrada, de modo que as duas paginas parem de discordar.

### 30. docs/wiki/deploy-backend.md e docs/wiki/hardening-borda-api.md (boot fail-fast)

> **CORRIGIDO em 2026-07-24.** As duas páginas afirmavam que o boot acumula TODOS os erros numa única mensagem `Configuração inválida:`. Falso para as duas variáveis mais importantes: `DATABASE_URL` e `JWT_SECRET` passam por `required()`, que lança na AVALIAÇÃO DO MÓDULO, e `index.js` importa `app.js` → `config.js` antes de a validação rodar — a saída real é `Missing required env var: X`, em inglês e uma por vez. `deploy-backend.md` e `hardening-borda-api.md` passaram a dizer o que o acumulador de fato governa: o que é `optional()` e as regras condicionais de produção.

- **Tipo:** divergência · **Fatia:** `be-boot`
- **Documento:** `docs/wiki/deploy-backend.md:42 e :48; docs/wiki/hardening-borda-api.md:54`
- **Código:** `backend/src/config.js:43`

**Evidência.** As duas paginas descrevem o boot como "acumula todos os erros e lanca um unico `Configuracao invalida:`" e listam `DATABASE_URL`, `JWT_SECRET` e `CORS_ORIGIN` como "as tres obrigatorias" desse mecanismo. O codigo nao faz isso para duas das tres: `required('DATABASE_URL')` (config.js:43) e `required('JWT_SECRET')` (config.js:49) lancam na AVALIACAO DO MODULO, e backend/src/index.js:3 importa `app.js` (que importa config.js na linha 7) ANTES de a linha 11 chamar `validateEnvVariables()`. Um boot sem DATABASE_URL morre com `Missing required env var: DATABASE_URL` (config.js:5), uma linha so, e nunca chega a lista acumulada; os ramos de config.js:223 e :227 sao inalcancaveis no caminho de boot. O "um ciclo de correcao, nao cinco" (hardening:54) nao vale justamente para as variaveis mais provaveis de faltar num deploy novo. O comportamento so e visivel cruzando dois arquivos (ordem de import ESM + `required` em top-level), e o teste que deveria prender isso nao prende: backend/tests/unit/config.test.js:95-123 apaga `process.env.DATABASE_URL` DEPOIS de config.js ja ter sido importado com a variavel setada (linha 7 do teste), entao exercita um caminho que o boot nunca toma, e fica verde com ou sem os `required()`.

**Ação.** Corrigir a frase nas duas paginas: a acumulacao vale para as regras de faixa/gramatica/CORS; `DATABASE_URL` e `JWT_SECRET` abortam antes, no import de config.js, com mensagem de uma linha. Registrar a armadilha (ordem de import preempta o fail-fast declarado) em deploy-backend.md §Boot fail-fast, citando config.js:43,49 e index.js:3,11.

### 31. docs/wiki/gestao-usuarios.md

> **CORRIGIDO em 2026-07-24.** Tratado como DEFEITO, não como doc: a assimetria era alcançável pela UI. O botão "Desativar" do painel usa DELETE, que conta os atlas do usuário e exige um destinatário, audita e revoga os tokens; mas o checkbox "Ativo" do formulário de edição manda `is_active` por PUT (`frontend/src/js/admin/users-tab.js:357`), e `updateUser` escrevia a coluna direto, sem nenhuma das três. Desmarcar a caixa deixava os atlas do usuário órfãos — dono inativo é recusado no middleware `auth`, então só outro admin global consegue mexer neles depois. É o estado que o ConflictError de `deleteUser` existe para impedir, alcançado pela porta ao lado.
>
> A correção RECUSA a transição em vez de replicar a guarda, porque o PUT não tem como receber o destinatário da transferência: não existe forma de ele completar a operação com segurança. Reativar segue livre, e reenviar `false` para quem já está inativo passa (a guarda olha a TRANSIÇÃO, não o valor — senão editar o nome de um usuário inativo quebraria).
>
> Teste: `backend/tests/integration/user-deactivate-via-put.repro.test.js` (4 casos). Controle negativo: removida a guarda, cai o caso do atlas órfão e só ele — os outros três não dependem dela.

- **Tipo:** divergência · **Fatia:** `be-users-orgs`
- **Documento:** `docs/wiki/gestao-usuarios.md:40`
- **Código:** `backend/src/modules/users/users.service.js:159-170`

**Evidência.** A pagina diz que auto-desativacao via DELETE e 403 e via PUT e 409, "caminhos distintos, mesma intencao do usuario", tratando os dois como equivalentes que so diferem no status HTTP. O codigo faz outra coisa: `PUT /users/:userId` com `is_active:false` cai em `updateUser`, que escreve `is_active` direto pelo UPDATE_USER_ADMIN (users.service.js:159-170) e NAO executa nada da guarda que a secao inteira descreve. Faltam os tres efeitos do caminho DELETE: a contagem de atlas + transferencia obrigatoria (`COUNT_USER_ATLAS`/`TRANSFER_ATLAS_OWNERSHIP`, users.service.js:220-234), a auditoria `USER_DELETE` (:242) e a revogacao dos refresh tokens (`REVOKE_ALL_USER_TOKENS`, :239, presente tambem em :67 e :197 mas ausente em `updateUser`). Efeito real: desativar por PUT orfana em silencio todos os atlas do usuario, sem 409, sem trilha e com o refresh token vivo. O proprio comentario de `middleware/auth.js:93-94` ("deactivation also revoked its refresh token, so the retry fails too") assume a premissa que so vale no caminho DELETE. A secao se chama "Desativacao: o que ela nao faz" e enumera os limites da transferencia, entao o leitor conclui que a guarda cobre desativacao em geral.

**Ação.** Reescrever o bullet :40: a guarda de transferencia, a auditoria e a revogacao de token existem SO em `DELETE /users/:userId`. `PUT /users/:userId {is_active:false}` e uma porta dos fundos que desativa sem nenhuma das tres. Ou o backend passa a barrar `is_active:false` no PUT (encaminhando para o DELETE), ou a pagina declara a assimetria como armadilha de primeira linha, nao como diferenca de status.

### 32. docs/wiki/hardening-borda-api.md

> **CORRIGIDO em 2026-07-24.** A página dizia que o default de CORS é `http://localhost:8080` (`config.js:49`). Valor e linha errados: é `http://localhost:3000` em `backend/src/config.js:63`, e o comentário do próprio código registra que `:8080` era o default antigo e estava errado, porque liberava a origem do backend (que nunca faz cross-origin) e bloqueava a do Vite (que faz). Pior que a linha: `deploy-backend.md` já dizia o valor certo, então duas páginas se contradiziam e a errada era a de segurança de borda. Corrigido com ponteiro para a página dona do assunto.

- **Tipo:** divergência · **Fatia:** `be-boot`
- **Documento:** `docs/wiki/hardening-borda-api.md:44`
- **Código:** `backend/src/config.js:63`

**Evidência.** A pagina diz "O default de CORS e `http://localhost:8080` (`config.js:49`)". O codigo em backend/src/config.js:63 faz `origin: optional('CORS_ORIGIN', 'http://localhost:3000')`, e o comentario em config.js:57-62 registra explicitamente que `:8080` ERA o default e estava ERRADO (liberava a origem do proprio backend, que nunca faz requisicao cross-origin, e bloqueava a do Vite, que faz). A citacao de linha tambem esta quebrada: config.js:49 e `secret: required('JWT_SECRET')`. Pior, duas paginas da wiki se contradizem: deploy-backend.md:48 afirma corretamente "O default e `http://localhost:3000`, a origem do Vite, e nao a porta do backend". Quem lê a pagina de seguranca inverte exatamente o par de portas que deploy-backend.md:52 documenta como ja tendo derrubado o boot uma vez.

**Ação.** Corrigir hardening-borda-api.md:44 para `http://localhost:3000` (`backend/src/config.js:63`) e apontar para [[deploy-backend]] §topologia de porta em vez de repetir o valor, para nao haver duas fontes do mesmo default.

### 33. docs/wiki/imagens-atlas.md (linha 51) e docs/wiki/sintese-cache-http-imutavel.md (linha 7)

- **Tipo:** divergência · **Fatia:** `be-images`
- **Código:** `backend/src/modules/images/images.queries.js:13-17 e :23-25; backend/src/modules/images/images.service.js:97-111 e :202; backend/src/modules/images/images.controller.js:20`

**Evidência.** imagens-atlas.md:51 afirma "O cache de download e `immutable` porque **o id e imutavel**: upload novo gera id novo, nunca sobrescreve bytes", e sintese-cache-http-imutavel.md:7 eleva isso a invariante ("O byte nunca muda para um mesmo identificador... So isso justifica max-age=31536000, immutable"). O codigo permite reuso de id com bytes diferentes por dois caminhos que se combinam: (a) DELETE e hard-delete que LIBERA a PK (backend/src/modules/images/images.queries.js:23-25 `DELETE FROM images WHERE id = $1 AND atlas_id = $2`, chamado em backend/src/modules/images/images.service.js:97-111); (b) o lote deixa o CLIENTE escolher a PK (backend/src/modules/images/images.queries.js:13-17 INSERT_IMAGE_WITH_ID, usado em backend/src/modules/images/images.service.js:202). Sequencia real e alcancavel com permissao `write`: DELETE da imagem X, depois re-salvar o atlas local com o mesmo localId X e bytes editados -> mesma URL, bytes novos, ja cacheados com `private, max-age=31536000, immutable` (backend/src/modules/images/images.controller.js:20). O navegador nao revalida dentro do ano. Nao ha teste cobrindo reuso de id apos delete (backend/tests/integration/images-gaps.test.js:325-360 cobre hard-delete e duplo-delete, nao o re-insert).

**Ação.** Corrigir a frase de imagens-atlas.md:51: o id NAO e imutavel, a PK e reciclavel porque o delete e fisico e o lote aceita id do cliente. Trocar por uma linha de armadilha ('a janela de reuso e delete + re-import do mesmo localId; nessa janela o `immutable` serve bytes velhos por ate um ano') e ajustar sintese-cache-http-imutavel.md:7 para excluir imagens de atlas do invariante, ja que a pagina ja as trata como caso a parte na linha 47.

### 34. docs/wiki/modelo-conflito-lww.md

- **Tipo:** divergência · **Fatia:** `be-utils`
- **Documento:** `docs/wiki/modelo-conflito-lww.md:27-28`
- **Código:** `backend/src/modules/sync/sync.service.js:656`

**Evidência.** A pagina carrega um marcador pendente que NEGA a existencia do mitigador: '> [!CONTRADICAO] Esta pagina afirmava que havia `SET LOCAL lock_timeout = 5s` ... **Nao existe:** `grep -rn lock_timeout` no backend nao retorna nada. O risco descrito e real e esta **nao mitigado** ... Tratar como divida aberta, nao como resolvido.' O codigo faz o oposto: `sync.service.js:656` executa `await t.none("SET LOCAL lock_timeout = '5s'")` ANTES do `pg_advisory_xact_lock` (:658), captura o SQLSTATE 55P03 (:663) e lanca `ServiceUnavailableError` (:665), classe definida na minha fatia em `backend/src/utils/errors.js:54-58` com JSDoc que cita nominalmente este caso (':52 ex.: o advisory lock por atlas do push de sync estourou o lock_timeout'). O fix esta registrado em livro-razao.md:48 (2026-07-18) e OUTRA pagina da wiki ja o descreve corretamente (sintese-limites-collab.md:58, citando sync.service.js:654-670). Duas paginas da wiki agora se contradizem entre si e a errada e a que carrega o marcador que acorda o gate. Pior caso do criterio do projeto: um agente lendo esta pagina trata como divida aberta um risco fechado, e pode 'consertar' de novo ou remover a serializacao por achar que nao existe.

**Ação.** Apagar o marcador [!CONTRADICAO] de :27-28. Pelo wiki-schema isto e SUPERSESSAO TEMPORAL (o estado avancou), nao contradicao: atualizar o paragrafo do advisory lock (:23-25) para dizer que a espera e limitada a 5s e que contencao vira 503 retentavel, citando sync.service.js:656,663-665 e utils/errors.js:54-58, e registrar uma linha em '## Historico'. Conferir de passagem a citacao :23 `sync.service.js:650`, que hoje aponta para a linha de comentario do lock_timeout; a chamada `pg_advisory_xact_lock` esta em :658.

### 35. docs/wiki/permissoes-atlas.md

- **Tipo:** divergência · **Fatia:** `be-middleware`
- **Documento:** `docs/wiki/permissoes-atlas.md:60`
- **Código:** `backend/src/middleware/permissions.js:115-120`

**Evidência.** A doc diz, na secao "Adicionou um nivel de permissao?": "Cinco lugares, e esquecer qualquer um degrada para `viewer` sem erro: `PERMISSION_LEVELS`, `toFrontendRole`, ...". O codigo faz o OPOSTO para o primeiro dos cinco. Em `permissions.js:115-118`, `const resolvedLevel = PERMISSION_LEVELS[resolvedPermission]` devolve `undefined` para um tier ausente do mapa, e o gate e `if (resolvedLevel < requiredLevelNum)`: `undefined < 3` avalia como `false`, entao o middleware chama `next()` e LIBERA. Falha aberta, nao fechada, e no nivel maximo: passa inclusive em `requireAtlasPermission('owner')`, que gateia `DELETE /:atlasId` (atlas.routes.js:28) e `POST /:atlasId/transfer` (atlas.routes.js:38). A simetria e dupla: um erro de digitacao no argumento (`requireAtlasPermission('writes')`) faz `requiredLevelNum` ser `undefined` e `3 < undefined` tambem ser `false`, desligando o gate da rota inteira em silencio. A propria pagina contrasta em :15 que "`toFrontendRole` e fail-closed: entrada nao reconhecida vira `viewer`", o que reforca a leitura errada de que os cinco lugares se comportam igual. Nenhum teste cobre: `backend/tests/unit/middleware-permissions.test.js` so exercita `resolvePermission` (funcao pura), nunca a comparacao numerica; `permission-resolver.test.js` e uma segunda copia dos mesmos casos.

**Ação.** Corrigir a linha 60 de `permissoes-atlas.md`: separar `PERMISSION_LEVELS` dos demais quatro e declarar que ele e o unico fail-OPEN do conjunto, com a razao (`undefined < N === false`), citando `backend/src/middleware/permissions.js:115-118`. Registrar como armadilha na secao "## Armadilhas" da mesma pagina, ao lado do ja existente `permission === 'write' || 'owner'`, porque e a mesma familia de bug (comparacao que silencia um nivel). Ideal: acompanhar de um teste unitario negativo em `middleware-permissions.test.js` que monte `requireAtlasPermission('owner')` contra um share de tier desconhecido e afirme 403 (hoje passaria).

### 36. docs/wiki/sintese-contrato-erros-http.md

> **CORRIGIDO em 2026-07-24.** A seção afirmava três coisas, todas falsas hoje: que `/health` é o único emissor de 503, que o faz sem passar pelo `errorHandler`, e que falha de banco em qualquer outra rota vira 500. São dois emissores — o segundo é o push de sync, que lança `ServiceUnavailableError` quando o `lock_timeout` do advisory lock dispara (`55P03`), acrescentado junto do próprio `lock_timeout` para que contenção vire retry em vez de conexão de pool retida. A página passou a separar os dois caminhos e a dizer o que importa ao cliente: 503 do push é transitório e vale retry.

- **Tipo:** divergência · **Fatia:** `be-utils`
- **Documento:** `docs/wiki/sintese-contrato-erros-http.md:55-57`
- **Código:** `backend/src/utils/errors.js:54-58`

**Evidência.** A secao inteira se chama '## 503 e para o orquestrador, nao para o boot' e afirma: 'GET /api/v1/health e o unico emissor de 503 SERVICE_UNAVAILABLE, e o faz inline, sem passar pelo errorHandler (backend/src/app.js:78-87). Falha de banco em qualquer outra rota vira 500.' As tres afirmacoes estao erradas hoje: (a) `utils/errors.js:54-58` define `ServiceUnavailableError` com statusCode 503 e code 'SERVICE_UNAVAILABLE'; (b) ela e lancada no caminho quente de colaboracao, `sync.service.js:665`, em `POST /atlas/:atlasId/sync`; (c) por ser subclasse de `AppError`, ela passa SIM pelo errorHandler, no ramo 2 (`error-handler.js:42-54`, `res.status(err.statusCode)`), saindo com o envelope padrao. Esta e a pagina que o proprio digest classifica como 'matriz completa de status HTTP por rota' e a mais fragil do corpus; uma exclusividade falsa aqui propaga para todo cliente que montar switch de status a partir dela.

**Ação.** Reescrever a secao: 503 tem duas origens com contratos diferentes, o /health inline (app.js:78-87, sem envelope, para o orquestrador) e o `ServiceUnavailableError` do push de sync (utils/errors.js:54-58 -> sync.service.js:665 -> error-handler.js:42-54, com envelope). Renomear o titulo, que hoje afirma o oposto do comportamento.

### 37. docs/wiki/streetview-360.md

- **Tipo:** divergência · **Fatia:** `be-sv360`
- **Documento:** `docs/wiki/streetview-360.md:32`
- **Código:** `backend/src/modules/streetview360/sv360.queries.js:115-133`

**Evidência.** A pagina afirma sem ressalva que a regra de acesso (enabled publico / disabled so admin ou OM dona) esta "embutida no SQL das leituras, nao so no service". NEARBY_PHOTOS (sv360.queries.js:115-133) NAO tem nenhum predicado de acesso: o filtro roda em JS depois da query, em sv360.service.js:161-164 (rows.filter(isProjectReadable)). Isso e exatamente o que backend/CLAUDE.md proibe ("Controle de acesso embutido na query SQL (ng/sv360): o dado privado nao vaza nem com bug de app"). A rota nao esta montada hoje (a propria pagina diz isso em :67), mas nearbyQuerySchema ja esta escrito e rotulado "Reserved for stage-2 /nearby" (sv360.schemas.js:61-67): quem montar a rota herda um filtro so de app enquanto a pagina lhe garante que o SQL cobre.

**Ação.** Qualificar a frase de :32 ("em todas as leituras montadas; a excecao e NEARBY_PHOTOS") e mover a armadilha para o bloco "Nao programe contra isto" (:67): montar /nearby exige embutir o predicado no SQL antes, com teste negativo.

### 38. docs/wiki/syncledger.md

> **CORRIGIDO em 2026-07-24.** As duas pontas foram corrigidas. O JSDoc de `frontend/src/js/store/sync/diag/trace-stages.js:7` apontava para um caminho morto duas vezes (prefixo pré-monorepo mais um diretório `collab/trace/` que nunca existiu) e passou a apontar para `backend/src/utils/sync-trace.js`; o espelho do backend passou a citar o frontend pelo caminho real. O marcador de `docs/wiki/syncledger.md` virou uma afirmação RESOLVIDO. Os outros dois ponteiros `MUST stay in lockstep` do par (em `backend/src/utils/maplibre-style-validate.js` e `backend/src/utils/sync-trace.js`) tinham o mesmo prefixo morto e foram corrigidos junto.

- **Tipo:** divergência · **Fatia:** `estrutural`
- **Código:** `backend/src/utils/sync-trace.js`

**Evidência.** syncledger.md:40 mantém [!CONTRADICAO] sobre o caminho do espelho de backend do enum de estágios. A contradição JÁ É RESOLVÍVEL contra o código: `backend/src/utils/sync-trace.js` existe e `backend/src/modules/collab/trace/` não existe (varredura de backend/src: zero arquivos terminando em `collab/trace/trace-stages.js`). O defeito real não está na wiki, está no JSDoc de `frontend/src/js/store/sync/diag/trace-stages.js:6-7`, que apontava para ebgeo_backend/src/modules/collab/trace/trace-stages.js (sem crase: o caminho não existe), morto duas vezes — prefixo legado mais diretório inexistente.

**Ação.** Corrigir o @fileoverview de frontend/src/js/store/sync/diag/trace-stages.js:6-7 para `backend/src/utils/sync-trace.js`, apagar o marcador de syncledger.md:40 e registrar uma linha no `## Histórico` da página.

### 39. hardening-borda-api.md

> **CORRIGIDO em 2026-07-24.** Mesma citação do item #32, corrigida na mesma passada.

- **Tipo:** divergência · **Fatia:** `be-auth`
- **Documento:** `docs/wiki/hardening-borda-api.md:44`
- **Código:** `backend/src/config.js:63`

**Evidência.** A pagina afirma "O default de CORS e `http://localhost:8080` (`config.js:49`), placeholder de dev". O codigo tem `origin: optional('CORS_ORIGIN', 'http://localhost:3000')` em backend/src/config.js:63, com comentario em :57-62 explicando que o default FOI mudado de :8080 (porta do proprio backend, que nunca faz cross-origin) para :3000 (Vite). A linha citada, config.js:49, e `secret: required('JWT_SECRET')`. Valor errado e linha errada. Pior: docs/wiki/deploy-backend.md:48 afirma o valor CERTO ("O default e `http://localhost:3000`, a origem do Vite, e nao a porta do backend"), entao duas paginas da wiki se contradizem e a errada e a que fala de seguranca de borda. Quem seguir hardening-borda-api ao configurar CORS em producao parte do valor superseded.

**Ação.** Corrigir hardening-borda-api.md:44 para `http://localhost:3000` (`backend/src/config.js:63`), ou substituir a frase por um wikilink para [[deploy-backend]], que ja e dono do assunto e esta certo. Registrar como supersessao temporal no `## Historico`, nao como CONTRADICAO (o codigo avancou, a pagina nao acompanhou).

### 40. modelo-conflito-lww

- **Tipo:** divergência · **Fatia:** `be-sync`
- **Documento:** `docs/wiki/modelo-conflito-lww.md:27-28`
- **Código:** `backend/src/modules/sync/sync.service.js:656`

**Evidência.** A pagina carrega um [!CONTRADICAO] PENDENTE afirmando que o `SET LOCAL lock_timeout = '5s'` antes da espera do advisory lock "NAO existe" ("grep -rn lock_timeout no backend nao retorna nada") e que o risco de esgotamento de pool esta "nao mitigado", a tratar como "divida aberta, nao resolvido". O codigo faz exatamente o que a pagina nega: sync.service.js:656 `await t.none("SET LOCAL lock_timeout = '5s'")`, sync.service.js:664-667 mapeia 55P03 para `ServiceUnavailableError` (503 retentavel), classe declarada em backend/src/utils/errors.js:49-58 com o proprio JSDoc citando o push de sync. A mitigacao entrou no commit 93d205b, que nao tocou nenhuma pagina da wiki. Pior: sintese-limites-collab.md:58 documenta a mitigacao CORRETAMENTE e com citacao valida (sync.service.js:654-670), entao duas paginas da mesma wiki afirmam o oposto sobre as mesmas linhas, e a errada e a que ostenta o marcador que, pelo wiki-schema, e o unico estado pendente que acorda o gate. Um agente lendo esta pagina re-implementa um fix que ja existe.

**Ação.** Apagar o bloco [!CONTRADICAO] (linhas 27-28) e substituir por uma linha afirmando a mitigacao as-built: espera do lock com `lock_timeout` de 5s, estouro vira 503 SERVICE_UNAVAILABLE retentavel, com a consequencia que so essa pagina pode dar: o 503 e o UNICO erro TRANSITORIO do push, entao o re-oferecimento eterno do lote descrito em sintese-contrato-erros-http.md:63 e correto aqui e patologico no 403/409. Registrar a mudanca em `## Historico` como supersessao temporal (nao como contradicao).

### 41. README.md

> **CORRIGIDO em 2026-07-24.** O §Modelo de dados do README atribuía os seis campos de sync às feições. `addCreatedTimestamp` (`frontend/src/js/store/feature.operations.js:29-41`) põe três: `createdAt`, `updatedAt` e `version`. Os seis são de Atlas/Mapa/Grupo. O README passou a declarar a assimetria explicitamente, como `.claude/rules/architecture.md` já fazia.

- **Tipo:** divergência · **Fatia:** `estrutural`
- **Código:** `frontend/src/js/store/feature.operations.js:29-41`

**Evidência.** O §"Modelo de dados (resumo)" do README (últimas 3 linhas) afirma que Feições carregam metadados de sync `createdAt`, `updatedAt`, `version`, `ownerId`, `dirty`, `deleted`. `addCreatedTimestamp` (feature.operations.js:29-41) põe APENAS três: createdAt, updatedAt e version. Os seis campos são de Atlas/Map/Group. .claude/rules/architecture.md (§Data Model) declara essa assimetria e avisa que "tratá-lo como uniforme é erro fácil"; o README comete o erro que a regra nomeia.

**Ação.** Corrigir o README para os três campos da feição, ou apagar a enumeração e apontar para .claude/rules/architecture.md §Data Model, que é onde a distinção já está codificada.

### 42. README.md

> **CORRIGIDO em 2026-07-24.** O blockquote do §Verificação dizia que a UI é testada manualmente e que se verifica com lint e test. Contradizia a linha logo acima no próprio README, que documenta `npm run test:e2e:ui` subindo o backend real, e a regra em `.claude/rules/testing.md`. Reescrito: lógica por lint e test, UI pelo e2e do Playwright, e o que não se usa é preview ou browser interativo.

- **Tipo:** divergência · **Fatia:** `estrutural`
- **Código:** `.claude/rules/testing.md`

**Evidência.** README.md, blockquote final do §Verificação: "A UI é testada manualmente, verifique mudanças via `npm run lint` e `npm test`." Contradiz (a) a linha imediatamente acima no próprio README, que documenta `npm run test:e2e:ui` subindo o backend real, (b) .claude/rules/testing.md §Before claiming done ("no preview or interactive-browser tool. The approved loop is a Playwright capture driving the real app and backend, then READING the produced image") e (c) a preferência explícita registrada em MEMORY.md. Um agente que segue o README pula a verificação visual obrigatória.

**Ação.** Substituir por: UI se verifica com captura Playwright (`npm run test:e2e:ui`) lendo a imagem produzida; lint+test cobrem lógica. Manter só a parte verdadeira do aviso (não há CI nem git hooks).

### 43. docs/wiki/ (22 páginas)

> **CORRIGIDO em 2026-07-24.** Resolvido pela inversão da regex do `frontend/tests/unit/docs-integridade.test.js`: o prefixo deixou de ser lista fechada e virou asserção (coleta qualquer token com cara de caminho, resolve contra as raízes reais dos pacotes e contra o diretório do próprio documento). As 55 citações com prefixo pré-monorepo foram reescritas com verificação de existência do destino, mais 29 referências de diretório e os 3 ponteiros `MUST stay in lockstep` que viviam em comentário de CÓDIGO, fora do alcance de qualquer varredura de .md. O ponteiro de `trace-stages.js` estava morto duas vezes (prefixo legado + diretório `collab/trace/` que nunca existiu); aponta agora para `backend/src/utils/sync-trace.js`.


- **Tipo:** link quebrado · **Fatia:** `estrutural`
- **Código:** `frontend/tests/unit/docs-integridade.test.js:78`

**Evidência.** 53 citações em 22 páginas usam os prefixos MORTOS `ebgeo_backend/` e `ebgeo_web/` (nomes dos repositórios pré-monorepo). Nenhum dos dois diretórios existe: a raiz tem `backend/` e `frontend/`. Exemplos: permissoes-atlas.md:5 `backend/src/middleware/permissions.js`, jwt-emissor-unico.md:3 `backend/src/modules/auth/auth.service.js`, api-rest-atlas.md:5 `frontend/src/js/store/sync/api-client.js`, sync-admin-operacoes.md:49 (três de uma vez), ranking-busca-toponimos.md:53-55, organizacoes-om.md:53-56, canal-collab-websocket.md:94-97, atlas-settings.md:5,13,23. O guarda NÃO pega: a RE_CAMINHO em docs-integridade.test.js:78-79 ancora em `(?:frontend|backend|src|tests|docs|scripts|deploy|public)/`, então tudo que começa com `ebgeo_` nem entra na varredura. É C4 cobertura vazia: o teste verde estaria provando nada sobre estas 53 citações.

**Ação.** Substituir `ebgeo_backend/` por `backend/` e `ebgeo_web/` por `frontend/` nas 53 ocorrências, e ampliar a RE_CAMINHO do teste para casar qualquer caminho com extensão conhecida (ou pelo menos falhar explicitamente ao ver o prefixo legado), contando quantas citações foram efetivamente checadas.

### 44. README.md

> **CORRIGIDO em 2026-07-24.** O link para `backend/docs/implementado/` apontava para um diretório que a wiki absorveu e que não existe mais. Era o único link markdown morto de todo o corpus vigiado, e escapava porque `RE_LINK` exige extensão conhecida — link para DIRETÓRIO nunca era checado. Além de corrigir o link, o teste ganhou `RE_LINK_DIR`, fechando a terceira instância da mesma classe neste arquivo (prefixo, sufixo e agora diretório): o que a regra não casa, ela abençoa. Controle negativo: com o link morto de volta, o teste acusa `README.md → backend/docs/implementado/ (diretório)`.

- **Tipo:** link quebrado · **Fatia:** `estrutural`
- **Código:** `frontend/tests/unit/docs-integridade.test.js:82`

**Evidência.** README.md:19 linka [`backend/docs/implementado/`](backend/docs/implementado/) como "os guias de integração". O diretório NÃO existe (`ls backend/docs/implementado` → No such file or directory). É exatamente o vão conhecido: RE_LINK (docs-integridade.test.js:82) exige que o alvo termine em `.md|.js|.sql|.json|.sh|.yml`, então link para DIRETÓRIO nunca é checado. Foi o único link markdown morto em todo o corpus vigiado (varri README, CLAUDE.md, backend/CLAUDE.md, backend/README.md, MEMORY.md, livro-razao.md, .claude/rules/ e as 67 páginas da wiki).

**Ação.** Remover o link ou apontar para docs/wiki/index.md; e estender RE_LINK para validar também alvo sem extensão, falhando quando não existir (hoje um diretório renomeado apodrece em silêncio).

### 45. tabela-operations, ack-idempotencia, sync-admin-operacoes, snapshot-e-pull-incremental, sintese-rest-vs-sync, sintese-contrato-erros-http

- **Tipo:** link quebrado · **Fatia:** `be-sync`
- **Documento:** `docs/wiki/ack-idempotencia.md:13`
- **Código:** `backend/src/modules/sync/sync.service.js:772`

**Evidência.** O commit 93d205b inseriu 17 linhas dentro de pushOperations (comentario + SET LOCAL + try/catch do 55P03), deslocando TODA citacao a sync.service.js posterior a linha ~650. As citacoes anteriores ao ponto de insercao continuam exatas (ENTITY_TYPE_MAP 23-38, toFrontendOperation 243-256, tx 633, assertOperationAllowed 600-620), o que confirma o offset unico. Exemplos verificados: ack-idempotencia.md:13 cita :755 para o literal `success: true` (hoje esta em :772; :755 caiu dentro do span SERVER_APPLIED) e :27 cita :758 para o fallback de currentVersion (hoje :775); tabela-operations.md:28 cita 683-705 para o ramo idempotente (hoje 700-722), :30 cita :679 para `rawOp.id ?? null` (hoje :696), :40 cita :672 e :717 para o restamp de entityId (hoje :689 e :734), :54 cita 737-744 para o span SERVER_APPLIED (hoje 754-761), :58 cita :816 para cleanupOldOperations (hoje :833); sync-admin-operacoes.md:24 cita :781 para o teste `sinceVersion < minVersion` (hoje :798) e :25 cita 835-838 (hoje 852-855); snapshot-e-pull-incremental.md:3 cita :765 como "contrato" de pullOperations, linha que hoje esta dentro de pushOperations (pullOperations comeca em :787); sintese-rest-vs-sync.md:17 cita 1315-1345 para a whitelist de settings (hoje 1332-1356) e :30 cita 770-804 para pullOperations (hoje 787-823); sintese-contrato-erros-http.md:61 cita :1295 para o 409 'Map is locked' (hoje :1312). idempotencia-e-convergence-guard.md:27 esta deslocada em 8 (o lock em si moveu 8, o resto 17). O teste docs-integridade so valida o CAMINHO, nunca a linha, entao nada fica vermelho.

**Ação.** Reancorar as citacoes das seis paginas (+17 apos o bloco do lock, +8 para as que apontam o proprio `pg_advisory_xact_lock`). Como isto ja e a segunda geracao do mesmo apodrecimento e o guard nao pega, avaliar reancorar por SIMBOLO (nome da funcao/constante) em vez de numero de linha nas citacoes de dentro de pushOperations, que e a funcao que mais muda no modulo.

---

## Severidade média

### 46. ack-idempotencia, tabela-operations, syncledger

- **Tipo:** armadilha não documentada · **Fatia:** `be-sync`
- **Documento:** `docs/wiki/ack-idempotencia.md:19`
- **Código:** `backend/src/modules/sync/sync.service.js:1442`

**Evidência.** As paginas apresentam `rowsAffected` do span SERVER_APPLIED como "o sinal real de 'aplicou algo'" (ack-idempotencia.md:19) e como o que existe para expor a cegueira do ack (tabela-operations.md:52-54). O sinal so cobre parte das operacoes: applyOperation so mede com `t.result` o create de FEATURE (sync.service.js:1442), os updates (:1597-1598) e os deletes (:1613, :1620-1621). Todos os demais creates usam `t.none` e deixam rowsAffected `undefined`: group (:1445), layer (:1462), group_feature (:1482), map (:1491), briefing (:1515), slide (:1531), cesium3d (:1552), streetview360 (:1567). Como o span grava `rowsAffected: rowsAffected ?? null` e `outcome: rowsAffected === 0 ? NO_EFFECT : OK` (:754-761), um create de layer/grupo/3D/360 que insere ZERO linhas (guarda EXISTS de mapa de outro atlas, ou mapa inexistente) e tracado como OK, indistinguivel de um create real. O comentario do codigo em :1301-1304 admite o buraco ("unmeasured creates"), mas quem monta assercao full-chain em cima do ledger le a wiki, nao o comentario, e uma espera por NO_EFFect nesses tipos nunca dispara.

**Ação.** Uma linha em ack-idempotencia.md (ou em syncledger.md, nas "Armadilhas de leitura") delimitando o alcance: rowsAffected e conclusivo para update, delete e create de feicao; para os demais creates ausencia de NO_EFFECT nao prova efeito. Sem isso o guard mais citado do ledger e lido como universal.

### 47. docs/wiki/gestao-usuarios.md

- **Tipo:** armadilha não documentada · **Fatia:** `be-users-orgs`
- **Documento:** `docs/wiki/gestao-usuarios.md:37-38`
- **Código:** `backend/src/modules/users/users.queries.js:170-179`

**Evidência.** A pagina enumera os limites da transferencia de atlas de forma que se le como completa ("tudo ou nada por usuario", "so atlas de propriedade viajam", compartilhamentos ficam apontando para conta inativa). Falta o limite que causa perda: tanto `COUNT_USER_ATLAS` quanto `TRANSFER_ATLAS_OWNERSHIP` filtram `deleted_at IS NULL` (users.queries.js:170-179), entao atlas na lixeira nao entram na contagem nem na transferencia. Duas consequencias que nao se descobre lendo o modulo users: (a) um usuario cujos atlas estao todos na lixeira passa com `count = 0` e e desativado sem nenhum pedido de `?transferTo`; (b) os atlas na lixeira continuam com `owner_id` da conta inativa, e `RESTORE_ATLAS` e escopado a `owner_id = $2` sem bypass de admin (atlas.queries.js:60-66, atlas.service.js:91-96, rota sem `requireAtlasPermission` em atlas.routes.js:31). O destinatario da transferencia nao consegue restaura-los; a unica recuperacao e reativar a conta que se quis fechar. O comportamento so aparece cruzando users.queries.js com atlas.queries.js.

**Ação.** Acrescentar um bullet na secao de desativacao: a transferencia cobre so atlas nao-lixeira; os da lixeira ficam presos a conta desativada e nem o destinatario nem um admin global conseguem restaura-los, porque `RESTORE_ATLAS` exige `owner_id = chamador`. Ancorar em users.queries.js:170-179 e atlas.queries.js:60-66.

### 48. docs/wiki/hardening-borda-api.md

- **Tipo:** armadilha não documentada · **Fatia:** `be-middleware`
- **Documento:** `docs/wiki/hardening-borda-api.md:9-16`
- **Código:** `backend/src/middleware/rate-limit.js:30-33`

**Evidência.** A pagina enumera explicitamente "quatro armadilhas" do preco da chave composta do `authLimiter`, e a mais severa nao esta entre elas: cliente IPv6 contorna o limitador inteiro trocando de endereco dentro do proprio /64. O `keyGenerator` de `rate-limit.js:32` usa `req.ip` cru; em `express-rate-limit` 8.5.2 (versao instalada, `backend/package.json:35`) o keyGenerator padrao normaliza IPv6 para /64 via `ipKeyGenerator`, e existe um validador dedicado que recusa exatamente esta forma: `node_modules/express-rate-limit/dist/index.cjs:647-658` (`keyGeneratorIpFallback`) lanca `ERR_ERL_KEY_GEN_IPV6` com a mensagem "Custom keyGenerator appears to use request IP without calling the ipKeyGenerator helper function for IPv6 addresses. This could allow IPv6 users to bypass limits." Esse erro nunca aparece porque `validate: false` em `rate-limit.js:30` desliga o conjunto de validadores. A pagina ja cita `validate: false` em :11, mas so pelo efeito de esconder o aviso de trust proxy. Passa no criterio: nao se descobre lendo `rate-limit.js` (exige conhecer o interno da lib), o custo e de seguranca (forca-bruta em `/auth/login` sem estrangulamento, mais `/auth/refresh` e `/auth/resend-verification` que compartilham o balde) e atravessa dois arquivos que, lidos isolados, nao denunciam nada. Nota: nao ha bug de opcao deprecada junto, `max` continua honrado em v8 (`dist/index.cjs:784`, `limit: passedOptions.max ?? 5`).

**Ação.** Acrescentar uma quinta armadilha em `hardening-borda-api.md` (secao "Rate limiting: a chave composta e o que ela custa"): `validate: false` tambem suprime `ERR_ERL_KEY_GEN_IPV6`, e a chave por `req.ip` cru da um balde por endereco IPv6 em vez de por /64, o que torna o limitador contornavel por rotacao de endereco. Citar `backend/src/middleware/rate-limit.js:30-32` e apontar a correcao de uma linha (envolver a parte de IP com o helper `ipKeyGenerator` da propria lib). Referenciar cruzado de `docs/wiki/refresh-token-rotacao.md:31`, que discute o mesmo balde pelo lado do NAT.

### 49. docs/wiki/upload-imagens-seguranca.md, secao 'Custo escondido e notas de integracao' (linhas 57-62)

- **Tipo:** armadilha não documentada · **Fatia:** `be-images`
- **Código:** `backend/src/modules/images/images.routes.js:64-68; backend/src/config.js:66-73`

**Evidência.** A secao documenta os caps de corpo (10 MB global, 50 MB do lote, 50 itens) e a pagina termina em 'Permissao de atlas: write para POST/DELETE'. Nao registra que esses sao os UNICOS limites: nao ha rate limit no router de imagens (backend/src/modules/images/images.routes.js:64-68, so `auth` + `requireAtlasPermission`; `grep rateLimit` no modulo nao retorna nada) e nao existe quota por atlas, por organizacao ou por usuario em lugar nenhum (backend/src/config.js:66-73 tem so `maxSizeMb` e `maxBulkUploadMb`). Efeito que atravessa arquivos: qualquer membro com `write` pode gravar 50 x 10 MB por requisicao, em requisicoes ilimitadas, direto no volume `IMAGES_DIR` (backend/src/config.js:67, default `./data/images`), e a unica limpeza e hard-delete manual imagem a imagem. hardening-borda-api documenta rate limit so em /auth/* e /atlas/public/:link, entao nenhuma pagina cobre isso. Um engenheiro nao chega nisso lendo o modulo: e a AUSENCIA de um middleware que ele teria de conferir em tres arquivos para concluir.

**Ação.** Uma linha em 'Custo escendido': upload nao tem rate limit nem quota; o unico teto e por requisicao (50 itens x MAX_IMAGE_SIZE_MB), o disco e ilimitado por membro `write`, e a limpeza e hard-delete manual. Apontar como limite operacional conhecido, nao como bug.

### 50. docs/wiki/upload-imagens-seguranca.md, secao 'Validacoes do service que sao codigo morto pela rota HTTP' (linhas 21-30)

- **Tipo:** armadilha não documentada · **Fatia:** `be-images`
- **Código:** `backend/src/modules/images/images.service.js:152-163`

**Evidência.** A secao enumera EXATAMENTE dois ramos mortos (tamanho em images.service.js:38-41 e tipo em :35) e ensina 'teste contra a rota, nao contra o service'. Existe um terceiro, da mesma familia e nao listado: o try/catch em volta do decode base64 (backend/src/modules/images/images.service.js:152-163) que produziria `'Invalid base64 data'` e inalcancavel. `Buffer.from(str, 'base64')` nunca lanca com lixo (verificado em node 20: `Buffer.from('!!!not base64@@@','base64')` devolve buffer de 6 bytes, sem excecao) e o Joi ja garante que `data` e string (backend/src/modules/images/images.schemas.js:13), entao o unico input que faria `Buffer.from` lancar (undefined) nao chega ao service. Base64 corrompido produz buffer-lixo e sai como 'Content does not match declared type' (:175-181), nunca como 'Invalid base64 data'. Um cliente que ramifique pela lista documentada de motivos de `failed[]` espera uma string que nunca e emitida.

**Ação.** Acrescentar o terceiro ramo morto a lista da secao, com a razao (Buffer.from base64 nao lanca) e a consequencia para o consumidor: base64 invalido chega como erro de magic-bytes, nao como erro de decode.

### 51. hardening-borda-api.md (secao "Rate limiting: a chave composta e o que ela custa")

- **Tipo:** armadilha não documentada · **Fatia:** `be-auth`
- **Documento:** `docs/wiki/hardening-borda-api.md:9-14`
- **Código:** `backend/src/middleware/rate-limit.js:32 + backend/src/modules/auth/auth.routes.js:15`

**Evidência.** A pagina enumera QUATRO precos da chave `${req.ip}:${username}` e cobre bem o caso espelho (rotas sem username caem no balde `"<ip>:"`, :12). Falta o quinto, que e o inverso e vale para /register: ali o username vem do ATACANTE (auth.routes.js:15 monta authLimiter no register, rate-limit.js:32 le `req.body?.username`), entao cada tentativa com um username novo estreia um balde novo de 10/15min. Somado ao achado anterior (409 vs 201 revela e-mail cadastrado), /auth/register e um oraculo de existencia de e-mail SEM throttling efetivo sempre que ALLOW_SELF_REGISTRATION estiver ligado. A pagina apresenta a chave composta como "forca-bruta contra uma conta e estrangulada", o que e verdade para /login e falso para /register, onde a conta alvo nao esta no campo que compoe a chave. Comportamento que so aparece cruzando tres arquivos.

**Ação.** Acrescentar o quinto marcador em hardening-borda-api.md:9-14: em /register o username e escolhido pelo cliente, logo a chave composta nao throttla enumeracao (o alvo e o e-mail, que nao entra na chave). Citar `backend/src/middleware/rate-limit.js:32` e `backend/src/modules/auth/auth.routes.js:15`.

### 52. nenhuma pagina

- **Tipo:** armadilha não documentada · **Fatia:** `be-database`
- **Documento:** `docs/wiki/atlas-modelo-de-dados.md (secao "Detalhes que costumam morder", sem item sobre grupos aninhados)`
- **Código:** `backend/src/modules/sync/sync.service.js:1445-1459 vs backend/src/database/migrations/002_atlas.sql:146`

**Evidência.** groups.parent_id UUID REFERENCES groups(id) ON DELETE SET NULL (002_atlas.sql:146) e a unica FK do caminho de escrita do sync que o apply NAO protege. O INSERT de grupo (sync.service.js:1445-1449) tem EXISTS so para o mapa ("WHERE EXISTS (SELECT 1 FROM maps WHERE id = $2 AND atlas_id = $8)") e passa data.parent_id cru em $7. O insert estruturalmente identico de comentario faz o contrario e explica o porque em comentario de codigo: "A reply whose parent no longer exists soft-fails (inserts zero rows via the EXISTS guard) instead of raising a 23503 FK violation" (sync.service.js:1247), implementado em :1254. Caminho real de disparo: a compactacao da fila outbound remove CREATE+DELETE do par (documentada em .claude/rules/architecture.md), entao o create do grupo-pai pode sumir e o create do grupo-filho chegar com parent_id pendurado, 23503, lote abortado, sync travado. A assimetria nao esta visivel em nenhum dos dois arquivos isoladamente: e preciso ler o schema e os dois applies lado a lado.

**Ação.** Uma linha em atlas-modelo-de-dados.md (secao "Detalhes que costumam morder") registrando que toda escrita do sync e INSERT...SELECT...WHERE EXISTS por causa do 23503, e que groups.parent_id e a excecao aberta. Fix duravel: replicar o guard de :1254 em :1447 e um teste de regressao com parent inexistente.

### 53. nenhuma pagina (candidatas: canal-collab-websocket.md:46 ou presenca-colaborativa.md:23)

- **Tipo:** armadilha não documentada · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/canal-collab-websocket.md:46 e docs/wiki/presenca-colaborativa.md:23 explicam o guard, nao o efeito colateral`
- **Código:** `backend/src/modules/collab/collab.gateway.js:486-489 e :517-519`

**Evidência.** As duas paginas explicam por que `user_left` so sai no ultimo socket do userId, mas nenhuma nota o efeito colateral: o socket em `away` PERMANECE na sala (gateway:517-519 nao chama leaveRoom) e o guard de sobrevivente itera os clientes da sala sem filtrar `readyState` (gateway:486-489). Logo, um usuario com uma aba fantasma em away e outra viva que fecha LIMPAMENTE nao gera `user_left` nenhum: os pares seguem exibindo o usuario ate o timer de graca disparar, ate 120s depois (WS_AWAY_GRACE_MS, config.js:103). Auto-cura, mas o sintoma ("o cara saiu e continua na lista por dois minutos apesar de ter fechado direito") seria depurado como bug de presenca no cliente, longe da causa, que e a interacao entre manter o socket morto na sala e o guard nao filtrar socket fechado.

**Ação.** Uma frase no ponto 1 de [[canal-collab-websocket]] §away ou na consequencia 3 de [[presenca-colaborativa]]: socket em away conta como sobrevivente no guard de user_left, entao saida limpa com fantasma pendente atrasa a remocao ate o fim da janela de graca.

### 54. nenhuma pagina (fronteira redact-url / mailer)

- **Tipo:** armadilha não documentada · **Fatia:** `be-utils`
- **Documento:** `docs/wiki/auth-flexivel.md:19 e docs/wiki/api-keys.md:42`
- **Código:** `backend/src/utils/mailer.js:68`

**Evidência.** As paginas de credencial afirmam um invariante sem excecao. `redact-url.js:4-5` diz 'Neither must ever land in plaintext in pino output' para `api_key` e `token`, e a wiki repete isso como garantia (auth-flexivel.md:19: 'removeu a entrada sem remover o transporte, vazou credencial permanente em texto puro no pino'; api-keys.md:42). A redacao esta de fato aplicada nos dois pontos de log de URL (`error-handler.js:23` e `request-logger.js`, ambos via `redactUrl`). Mas o mailer grava DELIBERADAMENTE outra classe de credencial em texto puro: `mailer.js:68` faz `logger.info({ to, link }, ...)` e `:74` faz `logger.warn({ to, link }, ...)`, e `link` e o `buildVerificationLink(token)` (:31-34) que carrega o token de verificacao vindo de `INSERT_VERIFICATION_TOKEN` (auth.service.js:267-269). Como o achado anterior mostra que esses dois ramos sao os UNICOS alcancaveis, todo token de confirmacao de conta do sistema vai para o log. Quem tem posse do log assume a conta antes do usuario. A tensao entre 'nunca em texto puro' e 'sempre em texto puro' atravessa redact-url.js, mailer.js, request-logger.js e auth.service.js e nao e visivel em nenhum deles.

**Ação.** Uma linha em [[api-keys]] ou [[gestao-usuarios]] delimitando o invariante: a redacao cobre credencial que viaja na URL da requisicao, nao campo de log estruturado; o token de verificacao e escrito de proposito (mailer.js:68,74) porque e o unico canal de entrega enquanto nao ha transporte SMTP, e por isso o log de um ambiente com signup aberto tem valor de credencial.

### 55. permissoes-atlas

- **Tipo:** armadilha não documentada · **Fatia:** `be-sync`
- **Documento:** `docs/wiki/permissoes-atlas.md:60`
- **Código:** `backend/src/modules/sync/sync.service.js:1241`

**Evidência.** A secao "Adicionou um nivel de permissao?" lista CINCO lugares a tocar (PERMISSION_LEVELS, toFrontendRole, assertOperationAllowed, UserRole, ROLE_PERMISSIONS) e avisa que esquecer qualquer um "degrada para viewer sem erro". Existe um sexto que ela nao lista, e e literalmente o padrao que a constituicao proibe: applyCommentOp faz `const isEditor = permission === 'write' || permission === 'manage' || permission === 'owner'` (sync.service.js:1241), lista fechada por igualdade que decide o gate de autoria de comentario (quem pode editar/apagar comentario alheio, usada nas queries de :1273 e :1289). Hoje esta completa por sorte, ja que `read` nunca chega ali e `comment` cai no ramo do autor. Um nivel novo acima de comment nasce sem poder moderar comentario, em silencio, que e exatamente o sintoma dos dois bugs reais ja registrados (o `manage` sumindo de lista fechada). A propria pagina ensina a regra na armadilha :44 ("sempre compare por nivel numerico") mas nao aponta a unica ocorrencia viva dela no modulo de sync.

**Ação.** Somar o sexto lugar a lista de permissoes-atlas.md:60 citando sync.service.js:1241, ou tratar como divida a converter para comparacao por indice em PERMISSION_LEVELS. A pagina e o lugar certo porque so ali se ve que a lista da autoria de comentario e um eixo separado do assertOperationAllowed que ja esta documentado em :23.

### 56. sintese-limites-collab.md (§7 cobre so a janela de staleness)

- **Tipo:** armadilha não documentada · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/sintese-limites-collab.md:62 e docs/wiki/canal-collab-websocket.md:19`
- **Código:** `backend/src/modules/collab/collab.gateway.js:173-182, backend/src/utils/org-status.js:53-55, backend/src/config.js:45`

**Evidência.** As duas paginas descrevem o sweep de heartbeat apenas como janela de staleness de ~30s. O custo de banco fica invisivel: `heartbeatSweep` chama `reconcileAuthorization(ws)` SEM await (gateway:180), e cada chamada dispara ate tres queries (getLiveAuthState em org-status.js:53-55, mais o SELECT de atlas e o SELECT de atlas_shares em gateway:70-96). Com N sockets, cada tique de 30s abre ate 3N queries concorrentes contra `DATABASE_POOL_MAX` default 10 (config.js:45). E exatamente a classe C5 que ja mordeu neste mesmo arquivo: o comentario de gateway:381-386 registra que o dispatch de mensagem sem await esgotava o pool e por isso foi serializado por socket, mas o sweep ficou com o padrao antigo. Lendo a funcao de 6 linhas ninguem calcula esse fan-out; ele so emerge de tres arquivos mais o config.

**Ação.** Acrescentar a [[sintese-limites-collab]] §7 uma frase sobre o custo: o sweep e fan-out nao-aguardado de 2 a 3 queries por socket a cada 30s contra um pool de 10, logo sala grande faz o sweep competir com o trafego HTTP; se for mexer, serialize ou limite concorrencia, como ja foi feito no caminho de mensagem.

### 57. docs/wiki/api-rest-atlas.md:69-77 e docs/wiki/sintese-rest-vs-sync.md:26-34

- **Tipo:** ausência · **Fatia:** `be-maps-briefings`
- **Documento:** `docs/wiki/api-rest-atlas.md:71 ; docs/wiki/sintese-rest-vs-sync.md:34`
- **Código:** `frontend/src/js/store/sync/ws-client.js:352-358`

**Evidência.** As duas páginas descrevem o merge como fluxo vivo e derivam dele uma regra de manutenção ("toda rota REST nova que escreva entidades filhas obriga um broadcast que o cliente mapeie para serverResync", sintese-rest-vs-sync.md:34). Nenhum cliente chama o módulo: grep por `merge`, `/maps` e `/briefings` em frontend/src/js/ não encontra nenhuma chamada a `POST /atlas/:id/maps/:id/merge`, `GET /atlas/:id/maps` ou `GET /atlas/:id/briefings` (frontend/src/js/store/sync/api-client.js não tem nenhum dos três). O handler `maps_merged` existe em frontend/src/js/store/sync/ws-client.js:352-358, mas nada no produto dispara um merge; os únicos chamadores são backend/tests/integration/maps-merge.test.js e maps-briefings-gaps.test.js. O leitor sai das duas páginas achando que existe uma UI de mesclagem, e a inferência de que o cliente já exercita o caminho `serverResync` está errada: o ramo do ws-client nunca é acionado por merge em produção.

**Ação.** Uma linha em api-rest-atlas.md:69-77: "nenhum cliente web chama estas rotas hoje; o handler de `maps_merged` existe mas o gesto que o dispara não". Precedente exato de forma e de valor: auditoria.md:53 ("O cliente web não consome a rota").

### 58. docs/wiki/atlas-import-offline.md

- **Tipo:** ausência · **Fatia:** `be-atlas`
- **Documento:** `docs/wiki/atlas-import-offline.md:30-34`
- **Código:** `backend/src/app.js:59`

**Evidência.** `POST /atlas/import` cai no parser global `express.json({ limit: '10mb' })` (`backend/src/app.js:59`); so `/images/bulk` ganha limite maior (`app.js:60-66`). Como o import e transacao unica, all-or-nothing, sem chunking e nao idempotente (a propria pagina documenta que reenviar colide na PK, :30-34), o teto de 10mb e o teto pratico de 'Salvar no servidor': um atlas grande recebe 413 PAYLOAD_TOO_LARGE (`error-handler.js:86-107`) e simplesmente nao tem caminho para o servidor. A pagina enumera com cuidado todos os outros modos de perda (feicoes descartadas, groupFeatures nao contados, SVG pulado, localId duplicado) e omite o unico que impede a operacao inteira. Nenhuma pagina cita esse cap: hardening-borda-api fala de body caps so no contexto de `MAX_BULK_UPLOAD_MB`.

**Ação.** Uma linha na secao de custos/limites de atlas-import-offline.md: teto de 10mb de body (`backend/src/app.js:59`), sem chunking e sem retry seguro; acima disso o unico caminho e reduzir o atlas local ou dividir em atlas menores.

### 59. docs/wiki/calibracao-e-grafo-360.md

- **Tipo:** ausência · **Fatia:** `be-sv360`
- **Código:** `backend/src/modules/streetview360/sv360.write.service.js:266`

**Evidência.** A pagina avisa que "200 nao significa sucesso" e manda tratar `failed` (:51), mas nao diz o que ha dentro de failed[].error: batchCalibration devolve `err.message` cru (sv360.write.service.js:266) dentro de um 200. Isso contorna a politica de mascaramento do proprio modulo, declarada no arquivo vizinho: sv360-error.js:26 diz explicitamente "The driver message can name columns/constraints, so it is never forwarded" e :35 mascara 500 fora de dev. Ou seja, a mesma mensagem de driver que o handler de erro do modulo recusa a encaminhar sai pelo corpo de sucesso do lote.

**Ação.** Registrar em calibracao-e-grafo-360.md que failed[].error e texto de driver nao mascarado (contrato de fato hoje), e que exibi-lo na UI vaza nome de coluna/constraint. Se a intencao era mascarar, a divergencia entre sv360-error.js:26 e write.service.js:266 vira item de codigo.

### 60. docs/wiki/compartilhamento-atlas.md

- **Tipo:** ausência · **Fatia:** `be-sharing`
- **Documento:** `docs/wiki/compartilhamento-atlas.md:19-25`
- **Código:** `backend/src/modules/sharing/sharing.queries.js:26-38`

**Evidência.** Nao existe NENHUM rastro de quem mudou uma permissao de atlas, nem quando, e isso so aparece cruzando tres arquivos: (1) o upsert de POST atualiza apenas a permissao, deixando added_by congelado no primeiro concedente (ON CONFLICT (atlas_id, user_id) DO UPDATE SET permission = EXCLUDED.permission, backend/src/modules/sharing/sharing.queries.js:29); (2) UPDATE_USER_SHARE tambem nao toca added_by nem added_at (backend/src/modules/sharing/sharing.queries.js:33-38) e a tabela nao tem coluna updated_at (backend/src/database/migrations/002_atlas.sql:59-68), entao o addedAt devolvido pelo GET e sempre a data da concessao original; (3) o modulo sharing nao tem nenhuma chamada a createAudit, e docs/wiki/auditoria.md:26 confirma que a acao SHARING_CHANGE existe no CHECK mas nunca e emitida. Resultado: depois que um co-Gestor rebaixa ou promove alguem concedido por outro, added_by aponta para a pessoa errada e nada registra a mudanca. A pagina cobre o upsert (linha 21) e o assimetrico is_active entre POST e PUT (linha 23), mas nao esse custo escondido, que e o unico ponto de atribuicao de uma superficie de governanca.

**Ação.** Acrescentar em "Armadilhas de comportamento" um paragrafo curto: added_by e escrito uma unica vez e nunca atualizado pelo upsert nem pelo PUT; nao ha updated_at; e SHARING_CHANGE nunca e emitida (ver [[auditoria]]). Portanto nao existe atribuicao confiavel de quem concedeu o nivel atual. Citar sharing.queries.js:26-38 e 002_atlas.sql:59-68.

### 61. docs/wiki/ingestao-projetos-360.md

- **Tipo:** ausência · **Fatia:** `be-sv360`
- **Código:** `backend/src/modules/streetview360/sv360.ingest.js:406-412`

**Evidência.** A pagina lista sete armadilhas da ingestao e nenhuma e o custo do lock. ingestBundle toma pg_advisory_lock de SESSAO numa conexao do pool (sv360.ingest.js:408) SEM lock_timeout e mantem a conexao presa durante o installSwap, que e um copyFileSync + fsync de um images.db multi-GB (ingest.js:412, 222-223). A licao oposta ja esta codificada no mesmo repositorio, com comentario explicando: sync.service.js:650-656 faz `SET LOCAL lock_timeout = '5s'` antes do advisory lock exatamente porque "a conexao do pool ja esta retida enquanto bloqueamos... uma espera ilimitada converte contencao em ESGOTAMENTO DO POOL", e converte o estouro em ServiceUnavailableError. O modulo 360 nao adotou nada disso, e nem o comentario do ingest nem a wiki registram a diferenca.

**Ação.** Registrar em ingestao-projetos-360.md, na secao de armadilhas, o custo escondido: dois uploads concorrentes do mesmo (org, slug) fazem o segundo esperar indefinidamente segurando conexao do pool, e a espera tem a duracao de uma copia multi-GB, nao de uma transacao. Apontar sync.service.js:650-656 como o padrao ja adotado no outro modulo.

### 62. docs/wiki/sintese-contrato-erros-http.md (secao 'Poison batch')

- **Tipo:** ausência · **Fatia:** `be-utils`
- **Documento:** `docs/wiki/sintese-contrato-erros-http.md:59-65`
- **Código:** `backend/src/utils/errors.js:49-58`

**Evidência.** A secao ensina a distincao que importa no push de sync (erro permanente tratado como transitorio: o cliente nunca faz dequeue de lote rejeitado, `sync-engine.js:271-283`, e o auto-flush engole a excecao, `sync-flush.js:82-83`), mas nunca nomeia o unico erro do caminho que e de fato transitorio. O JSDoc de `utils/errors.js:49-53` existe justamente para marcar essa fronteira ('503 - sobrecarga TRANSITORIA: o cliente deve tentar de novo. Distinto do 500: nada quebrou'). Do lado do cliente, `grep -rn '503\|SERVICE_UNAVAILABLE' frontend/src/js/store/sync/` nao retorna nada: nao ha ramo dedicado, o 503 cai na reoferta generica, e nesse caso especifico o comportamento cego esta CERTO. Isso atravessa tres arquivos em dois pacotes (errors.js + sync.service.js + sync-engine.js) e nao e visivel em nenhum deles isoladamente; agravado por :57, que hoje diz ao leitor que 503 nunca chega a um cliente.

**Ação.** Acrescentar uma linha a secao 'Poison batch': o 503 de `lock_timeout` e a unica rejeicao transitoria do push, e a reoferta sem dequeue e o tratamento correto para ele, ao contrario do 403/409 permanentes que travam a fila. Citar utils/errors.js:49-58 e sync.service.js:663-665.

### 63. docs/wiki/streetview-360.md

- **Tipo:** ausência · **Fatia:** `be-sv360`
- **Código:** `backend/src/modules/streetview360/sv360.tiles.queries.js:39-49`

**Evidência.** A pagina cobre a semantica de fotos_linha e o Cache-Control curto do MVT (:53) mas nao o custo por requisicao. Na MVT_TILE a CTE `visible` (tiles.queries.js:39-49) nao tem filtro de bbox e e referenciada DUAS vezes (fotos em :59 e trajectories em :69), entao o `&&` contra env4326 so e aplicado depois dela: cada tile varre sv360.photos inteiro com o join de projects, e `trajectories` (:63-70) monta um ST_MakeLine por projeto de TODO o acervo antes de descartar os que nao tocam o tile. O comentario PERFORMANCE do proprio arquivo (:26-29) promete o contrario ("o bbox e usado com o operador && contra p.geom para o indice GiST podar linhas ANTES do ST_AsMVTGeom"), o que so vale para o ramo fotos e mesmo assim apos a materializacao.

**Ação.** Registrar o custo em streetview-360.md (secao Tiles): o custo do tile escala com o acervo inteiro, nao com o conteudo do tile, e o comentario de performance do arquivo promete uma poda por indice que a CTE sem bbox nao entrega. E limite operacional, nao detalhe de implementacao.

### 64. docs/wiki/tipos-entidade-sync.md:40 / docs/wiki/api-rest-atlas.md:75

- **Tipo:** ausência · **Fatia:** `be-maps-briefings`
- **Documento:** `docs/wiki/tipos-entidade-sync.md:40`
- **Código:** `backend/src/modules/maps/maps.service.js:15`

**Evidência.** `catalogLayer` é dual-mode: tabela `catalog_layers` E coluna legada `maps.catalog_layers` JSONB (backend/src/database/migrations/002_atlas.sql:98 e :250-258; o backend decide pelo shape em backend/src/modules/sync/sync.service.js:1186-1217). tipos-entidade-sync.md:40 avisa "no snapshot as duas formas coexistem: não assuma que só uma está preenchida". O merge trata apenas UMA das duas: MAP_CHILD_TABLES inclui a tabela (backend/src/modules/maps/maps.service.js:15) e nada toca a coluna `maps.catalog_layers` do mapa de origem nem a do destino. Cliente que usa a forma legada de array perde as camadas de catálogo no merge, em silêncio, e o `moved.catalog_layers` da resposta reporta 0 sem indicar problema.

**Ação.** Acrescentar o caso concreto ao aviso já existente em tipos-entidade-sync.md:40 (ou como bullet em api-rest-atlas.md:75): "o merge move a tabela e ignora a coluna legada". É a instância real da regra genérica que api-rest-atlas.md:75 enuncia, e sem ela a regra parece hipotética.

### 65. docs/wiki/zonas-acesso-geografico.md e docs/wiki/auditoria.md

- **Tipo:** ausência · **Fatia:** `be-nomes-zones`
- **Documento:** `docs/wiki/zonas-acesso-geografico.md:47`
- **Código:** `backend/src/modules/zones/zones.service.js:56-60`

**Evidência.** A revogacao em massa de acesso geografico nao deixa rastro nenhum na trilha de auditoria, e as duas paginas que tocam o assunto param um passo antes de dizer isso. zonas-acesso-geografico.md:40 documenta que PUT /zones/:id/permissions grava PERMISSION_GRANT com before/after (backend/src/modules/zones/zones.service.js:85-88), e :47 documenta que DELETE cascateia os grants e nao tem undo. Mas createZone/updateZone/deleteZone nao chamam createAudit em ponto nenhum (backend/src/modules/zones/zones.service.js:33-60), enquanto o DELETE apaga por CASCADE toda linha de ng.zone_permissions e ng.zone_group_permissions (backend/src/database/migrations/004_ng.sql:229 e :237). Ou seja: tirar um usuario de uma zona fica auditado, apagar a zona e tirar todos de uma vez nao fica. O vocabulario para auditar ja existe e esta ocioso: o CHECK tem PERMISSION_REVOKE e target_type ZONE (backend/src/database/migrations/001_core.sql:172-176). auditoria.md:27 registra que PERMISSION_REVOKE nunca e emitida, mas atribui isso somente a semantica replace-set de setZonePermissions, sem notar que o caminho de revogacao total tambem existe e tambem e mudo.

**Ação.** Em zonas-acesso-geografico.md:47, completar o bullet do DELETE com o ponto cego de auditoria (cascade de 004_ng.sql:229,:237 + ausencia de createAudit em zones.service.js:56-60) e a assimetria com o PUT de permissoes. Em auditoria.md:27, estender a nota de PERMISSION_REVOKE para o DELETE de zona.

### 66. nenhuma pagina

- **Tipo:** ausência · **Fatia:** `be-database`
- **Documento:** `docs/wiki/deploy-backend.md:23-24, docs/wiki/sintese-decisoes-arquiteturais.md:96`
- **Código:** `backend/src/database/migrate.js:55-56,67-68,78`

**Evidência.** O tracking em _migrations e so por NOME de arquivo, sem checksum (migrate.js:55-56 le os nomes, :67 compara por nome, :78 insere so o nome). Logo, editar o CONTEUDO de uma migracao ja aplicada e indetectavel por construcao, e o projeto ja fez exatamente isso: a tabela comments entrou editando o baseline 002 in-place (sintese-decisoes-arquiteturais.md:96). A evidencia esta no proprio arquivo: o cabecalho de 002_atlas.sql:2-5 enumera as tabelas que o arquivo cria e NAO lista comments, que existe em 002_atlas.sql:220. Consequencia que nenhuma pagina enuncia: um banco que aplicou 002 ANTES daquela edicao nao tem a tabela comments, nenhuma migracao futura vai corrigi-lo (forward-only, 002 ja consta em _migrations) e a falha so aparece no primeiro uso, como 42P01 em GET_ATLAS_COMMENTS (backend/src/modules/sync/sync.queries.js:57-63) e em applyCommentOp. deploy-backend.md:23-24 cobre "nunca renomeie nem renumere" e e silencioso sobre editar conteudo, que e a variante que de fato ocorreu.

**Ação.** Acrescentar em deploy-backend.md (secao "Migracoes: o que quebra") o terceiro item da regra: renomear reaplica, renumerar reordena, e EDITAR conteudo nao faz nada e nao avisa, com o caso comments como exemplo e o remedio operacional (conferir a existencia da tabela em ambiente pre-existente, ou emitir uma 006 idempotente com CREATE TABLE IF NOT EXISTS comments).

### 67. nenhuma pagina

- **Tipo:** ausência · **Fatia:** `be-database`
- **Documento:** `docs/wiki/refresh-token-rotacao.md:21 (mesma classe de armadilha, documentada para outra tabela)`
- **Código:** `backend/src/database/migrations/002_atlas.sql:199,134,155,346,375 vs :242,260`

**Evidência.** Cinco indices parciais tem a forma (id) WHERE deleted_at IS NULL: idx_features_not_deleted (002:199), idx_layers_not_deleted (:134), idx_groups_not_deleted (:155), idx_briefings_not_deleted (:346), idx_slides_not_deleted (:375). A leitura quente dessas tabelas nao e por id: e por chave do pai mais deleted_at (sync.queries.js:65-108, GET_MAP_FEATURES/GET_MAP_LAYERS/GET_MAP_GROUPS/GET_ATLAS_BRIEFINGS/GET_BRIEFING_SLIDES), o snapshot que roda em todo connect. Um grep nao encontra nenhuma query dessas cinco tabelas na forma "WHERE id = $1 AND deleted_at IS NULL", entao os indices nao tem leitor e so custam amplificacao de escrita, justamente na tabela de maior volume (features). No MESMO arquivo, duas tabelas usam a forma que funciona: idx_comments_map (002:242) e idx_catalog_layers_map (002:260), ambos (map_id) WHERE deleted_at IS NULL. O projeto ja reconhece exatamente essa armadilha para outra tabela em refresh-token-rotacao.md:21 ("O indice parcial nao cobre o lookup real"), o que confirma que ela passa no criterio: nao e obvio a leitura.

**Ação.** Uma linha em atlas-modelo-de-dados.md registrando a armadilha (indice parcial ancorado na PK parece indice de soft-delete e nao serve a leitura por pai) e apontando :242/:260 como a forma correta. Correcao de schema, se houver, e migracao 006 nova, nunca edicao da 002.

### 68. nenhuma página

- **Tipo:** ausência · **Fatia:** `estrutural`
- **Código:** `backend/src/modules/ranks/ranks.service.js`

**Evidência.** O módulo `ranks/` (postos e graduações, 6 arquivos) não tem NENHUMA citação arquivo:linha em nenhuma das 67 páginas da wiki (grep 'modules/ranks' em docs/wiki/ → zero). É o único módulo REST inteiro invisível na documentação, e ao mesmo tempo está omitido da lista de módulos de backend/CLAUDE.md. Mesma situação, menos grave, para `modules/briefings/*` (citado 17 vezes como entityType de sync, nunca como módulo REST), `modules/debug/debug.routes.js` (syncledger.md descreve a rota GET/DELETE /api/v1/debug/trace sem nunca citar o arquivo) e `utils/mailer.js` (e-mail de signup, zero citação).

**Ação.** Antes de escrever página: aplicar o critério. `ranks` provavelmente só merece uma linha em gestao-usuarios.md (listas controladas de posto/OM), não página própria. `debug.routes.js` merece a âncora arquivo:linha dentro de syncledger.md, porque o invariante "nunca em prod" precisa de caminho verificável. `mailer.js` merece menção em gestao-usuarios.md só se houver armadilha (falha silenciosa de envio).

### 69. nenhuma página (candidato: docs/wiki/api-rest-atlas.md §"Merge de mapas")

- **Tipo:** ausência · **Fatia:** `be-maps-briefings`
- **Documento:** `docs/wiki/api-rest-atlas.md:73`
- **Código:** `backend/src/modules/maps/maps.service.js:57-65`

**Evidência.** O merge é a operação REST mais destrutiva sobre conteúdo e é irreversível sem rastro. Não grava linha em `operations` nem incrementa `current_version` (isso a wiki cobre, api-rest-atlas.md:73), mas além disso: não chama `createAudit` (zero ocorrências em backend/src/modules/maps/), e o UPDATE `SET map_id = $1` (backend/src/modules/maps/maps.service.js:60-63) não preserva em lugar nenhum de qual mapa de origem cada linha veio. Somado ao fato de que undo é local e só cobre ops de sync, não existe caminho de desfazer um merge, nem manual pelo banco. O que a resposta devolve são apenas contagens agregadas por tabela (`moved`, :64). A wiki documenta o custo de CONVERGÊNCIA do merge e omite o custo de IRREVERSIBILIDADE, que é o que morde o usuário.

**Ação.** Uma linha em api-rest-atlas.md:69-77: "merge não é desfazível: não há op, não há auditoria e a origem de cada linha movida não é registrada; confirmar na UI antes de chamar". Precedente de forma: ingestao-projetos-360.md:34 registra ausência análoga de trilha.

### 70. nenhuma página (comportamento entre backend/src/modules/maps/ e o gatilho de 002_atlas.sql)

- **Tipo:** ausência · **Fatia:** `be-maps-briefings`
- **Documento:** `docs/wiki/api-rest-atlas.md:69-77`
- **Código:** `backend/src/database/migrations/002_atlas.sql:378-396`

**Evidência.** O gatilho `trg_mark_slides_broken` marca `is_broken = TRUE` nos slides quando um mapa é soft-deletado (backend/src/database/migrations/002_atlas.sql:378-396), e `slides.map_id` é `ON DELETE SET NULL` (:357). O merge não deleta os mapas de origem, só os esvazia (backend/src/modules/maps/maps.service.js:36 e :57-65), então o gatilho nunca dispara: um slide que aponta para o mapa de origem continua com `is_broken = FALSE` e passa a apresentar um mapa vazio. A detecção de slide quebrado, que existe justamente para esse sintoma, é cega para o único caminho que produz um mapa vazio sem deletá-lo. Comportamento que emerge de três lugares (merge, gatilho, coluna) e não está legível em nenhum deles.

**Ação.** Registrar em uma linha na seção de merge de api-rest-atlas.md (:69-77), referenciando o gatilho: "o merge esvazia sem deletar, então slides de briefing que apontam para a origem continuam is_broken=FALSE e passam a mostrar mapa vazio".

### 71. refresh-token-rotacao.md (secao "Armadilhas")

- **Tipo:** ausência · **Fatia:** `be-auth`
- **Documento:** `docs/wiki/refresh-token-rotacao.md:27-29`
- **Código:** `backend/src/modules/auth/auth.service.js:87-89 vs backend/src/modules/auth/auth.queries.js:15-23`

**Evidência.** A pagina enumera com cuidado o que o refresh RE-CHECA (expiracao em :27, OM inativa em :29) e o que a revogacao em massa nao faz (:35), mas nao registra que o portao de e-mail e exclusivo do login. `login` gateia em `if (user.email && !user.email_verified)` (auth.service.js:87-89), enquanto `refresh` resolve o usuario por FIND_USER_BY_ID (auth.service.js:157), query que NAO seleciona `email` nem `email_verified` (auth.queries.js:15-23) e so filtra `is_active = true`. Consequencia nao obvia: uma sessao que ja tem refresh token continua se renovando indefinidamente depois que um admin poe `email_verified: false` via PUT /users/:userId (caminho que gestao-usuarios.md:27 documenta como existente). Nao-verificar nao corta sessao, so impede login novo. A assimetria e invisivel lendo qualquer um dos dois arquivos sozinho, porque a query e que carrega a omissao.

**Ação.** Uma linha na secao "Armadilhas" de refresh-token-rotacao.md: o gate EMAIL_NOT_VERIFIED e login-only; FIND_USER_BY_ID (`backend/src/modules/auth/auth.queries.js:15-23`) nao traz `email_verified`, entao des-verificar uma conta nao derruba a sessao viva, so o proximo login. Se corte imediato for requisito, revogar os refresh tokens junto.

### 72. docs/wiki/compartilhamento-atlas.md

- **Tipo:** contrato não documentado · **Fatia:** `be-sharing`
- **Documento:** `docs/wiki/compartilhamento-atlas.md:9,17`
- **Código:** `backend/src/modules/sharing/sharing.routes.js:11-20`

**Evidência.** Os dois marcadores da pagina estao sem a data exigida: "> [!CONTRADICAO] O comentario em backend/src/modules/sharing/sharing.routes.js:11-14..." (linha 9) e "> [!CONTRADICAO] O JSDoc do modal (frontend/src/js/modals/sharing.modal.js:15-16 e 735-736)..." (linha 17). docs/wiki/wiki-schema.md:59 fixa o formato "> [!CONTRADICAO AAAA-MM-DD]" e diz que so a CONTRADICAO pendente acorda o gate; frontend/tests/unit/docs-integridade.test.js nao verifica marcador algum (grep por CONTRADI no arquivo nao retorna nada), entao marcador sem data apodrece sem quebrar teste. Alem da forma, as duas sao resolviveis hoje contra o codigo: verifiquei que o comentario de sharing.routes.js:11-14 mente (e 404, nao no-op) e que o JSDoc de sharing.modal.js:15-16 e :735-736 diz "the backend also enforces owner-only on every mutation" enquanto o gate real e requireAtlasPermission('manage') em sharing.routes.js:15-20.

**Ação.** Resolver as duas contra o codigo: corrigir o comentario de sharing.routes.js:11-14 (trocar "no-op on them" por "remover o dono responde 404: ele nao tem linha em atlas_shares") e o JSDoc de sharing.modal.js:15-16 e :735-736 (trocar "owner-only" por "manage"), depois apagar os dois marcadores. Enquanto ficarem pendentes, acrescentar a data no formato [!CONTRADICAO 2026-07-18].

### 73. docs/wiki/ingestao-projetos-360.md

- **Tipo:** contrato não documentado · **Fatia:** `be-sv360`
- **Documento:** `docs/wiki/ingestao-projetos-360.md:23`
- **Código:** `backend/src/modules/streetview360/sv360.admin.service.js:255`

**Evidência.** As duas CONTRADICOES pendentes da pagina (:23 e :25) sao reais e eu as verifiquei: admin.service.js:224-225 diz "Postgres merge tx FIRST, then the atomic {slug}.db swap" e ingest.js:336-346 e :411-428 fazem swap-first-then-commit; service.js:306-309 diz "{slug}.webp" e admin.service.js:269 grava {orgId}__{slug}.webp. Ambas sao resolviveis agora, contra o codigo, corrigindo os comentarios. Alem disso a marcacao esta incompleta: a inversao se repete em admin.service.js:255 ("Ingest (validateImagesDb size-check -> merge tx -> atomic swap)"), linha que a pagina nao cita, entao quem for corrigir pelo marcador deixa metade do erro no lugar.

**Ação.** Corrigir os tres comentarios (admin.service.js:224-225 e :255, service.js:306-309), apagar os dois marcadores e registrar a resolucao no ## Historico. Contradicao pendente e o unico marcador que acorda o gate; deixa-la aberta quando ja da para resolver gasta o sinal.

### 74. docs/wiki/config-dinamico.md

- **Tipo:** desatualizada · **Fatia:** `estrutural`
- **Código:** `frontend/tests/e2e/config-contract.e2e.test.js:70`

**Evidência.** config-dinamico.md:34 traz [!CONTRADICAO 2026-07-18] afirmando que `frontend/tests/e2e/config-contract.e2e.test.js:50-57` exige `cfg.search.apiUrl` como string não vazia e `cfg.services.tileServerUrl.length > 0`. O teste JÁ FOI CORRIGIDO: hoje ele afirma a AUSÊNCIA do campo (`expect(cfg.search).not.toHaveProperty('apiUrl')`, :70) e comenta explicitamente que exigir comprimento > 0 em tileServerUrl era exigir um deployment completo. É supersessão temporal, não contradição pendente, e contradição pendente é o único estado que deveria acordar o gate.

**Ação.** Apagar o marcador de config-dinamico.md:34 e mover o fato para o `## Histórico` da página.

### 75. docs/wiki/gestao-usuarios.md (secao "Efeito imediato, e o que nao e reconciliado")

- **Tipo:** desatualizada · **Fatia:** `be-users-orgs`
- **Documento:** `docs/wiki/gestao-usuarios.md:44`
- **Código:** `backend/src/modules/collab/collab.gateway.js:125-137`

**Evidência.** A pagina atribui a imediaticidade da desativacao apenas ao middleware HTTP ("o middleware reconcilia com o banco a cada requisicao", auth.js:84-108) e nao menciona socket. O codigo evoluiu: `reconcileAuthorization` passou a consultar `getLiveAuthState` e fecha o socket com `4003 'account deactivated'` quando `!live.userIsActive` (collab.gateway.js:128-131), alem de adotar o papel global vivo antes de resolver a permissao (:137). O comentario em :120-124 registra isso como correcao de lacuna real: "um socket JA ABERTO sobrevivia a desativacao do usuario indefinidamente... o sweep nunca reexaminava `users.is_active`". Ou seja, ha um segundo mecanismo, com janela propria de ~30s, que a pagina dona do ciclo de vida omite. O mesmo atraso aparece em todas as paginas que enumeram os gatilhos do sweep, e todas listam so tres ("share revogado / atlas despublicado / org desativada"): canal-collab-websocket.md:19, permissoes-atlas.md:32, sintese-eixos-de-permissao.md:25, sintese-limites-collab.md:62, organizacoes-om.md:26. Sao enumeracoes fechadas que perderam dois itens, exatamente a forma de erro que a constituicao proibe para nivel de permissao.

**Ação.** Em gestao-usuarios, acrescentar uma linha: desativar conta ou rebaixar admin tambem derruba sockets de colaboracao abertos, pelo sweep de heartbeat (~30s), nao pela revogacao de token; citar collab.gateway.js:128-137. Nas cinco paginas que enumeram os gatilhos do 4003, trocar a lista fechada por "o que `getLiveAuthState` reprova (conta inativa, org inativa) mais permissao nao resolvivel", para a enumeracao parar de apodrecer a cada gatilho novo.

### 76. docs/wiki/ingestao-projetos-360.md

- **Tipo:** desatualizada · **Fatia:** `be-utils`
- **Documento:** `docs/wiki/ingestao-projetos-360.md:32`
- **Código:** `backend/src/utils/sqlite-blob-pool.js:124-135`

**Evidência.** O bullet '**Custo escondido no Windows:** se `blobPool.evict` nao existir, o codigo degrada para `closeAll()` (sv360.ingest.js:146-154), que derruba **todas** as conexoes, inclusive as de assets 3D' descreve um dano colateral que nao pode ocorrer hoje. `blobPool.evict` existe: metodo em `sqlite-blob-pool.js:124-135` (mais o binding exportado em :154), com o ack por worker implementado em `sqlite-blob-worker.js:38-50`. Os dois guardas `typeof blobPool.evict === 'function'` (sv360.ingest.js:147 e sv360.admin.service.js:32) sao shim de integrador morto, resquicio da 'INTEGRATOR NOTE' de sv360.ingest.js:15-29. A pagina lista como custo vivo um ramo inalcancavel, e o resto da cobertura de evict/EBUSY (assets3d-distribuicao.md:29-31, deploy-backend.md:115-120) esta correta e proporcional.

**Ação.** Reescrever o bullet como fato fechado: o evict cirurgico existe e fecha so o dbPath alvo em todos os workers, o `closeAll()` e fallback morto. Se o valor era alertar sobre o dano colateral, ele agora pertence a [[assets3d-distribuicao]], que ja registra corretamente que o assets3d nao chama evict.

### 77. docs/wiki/sintese-contrato-erros-http.md

- **Tipo:** desatualizada · **Fatia:** `be-utils`
- **Documento:** `docs/wiki/sintese-contrato-erros-http.md:5`
- **Código:** `backend/src/utils/errors.js:49-58`

**Evidência.** A linha de ancoragem da pagina diz 'os pares status/codigo em `utils/errors.js:12-47`'. O intervalo 12-47 cobre de `NotFoundError` (12-16) ate `BadRequestError` (43-47) e EXCLUI `ServiceUnavailableError`, que vive em 49-58. A citacao era exata quando escrita e apodreceu por adicao no fim do arquivo. Quem montar a matriz de status lendo exatamente o intervalo citado perde o 503, que e precisamente o par que a pagina ja erra em :57.

**Ação.** Trocar por `utils/errors.js:12-58` (ou citar o arquivo sem intervalo, ja que ele e inteiramente a lista de pares). Mesma correcao vale para a linha de Fontes :69, que cita o arquivo sem intervalo e esta ok.

### 78. docs/wiki/streetview-360.md

- **Tipo:** desatualizada · **Fatia:** `be-sv360`
- **Documento:** `docs/wiki/streetview-360.md:24`
- **Código:** `backend/src/modules/streetview360/sv360.controller.js:52-63`

**Evidência.** O marcador `> [!CONTRADICAO]` de :24 nao tem data (wiki-schema exige AAAA-MM-DD) e aponta contra prosa que nao existe mais: o guia 16-streetview-360 foi absorvido e docs/guias/ nao existe no repositorio. E o padrao que ja gerou 117 falsos positivos de 125. A pagina irma trata o caso identico da forma certa, com `> **Nota historica.**` (calibracao-e-grafo-360.md:23, :31, :45), inclusive citando o mesmo guia absorvido.

**Ação.** Converter :24 em Nota historica (o codigo em sv360.controller.js:52-63 ja e a autoridade e a decisao de escopo variavel esta explicada logo acima), liberando o marcador CONTRADICAO para conflito realmente pendente.

### 79. docs/wiki/syncledger.md:40 (marcador [!CONTRADICAO] pendente)

> **CORRIGIDO em 2026-07-24.** Resolvido pela inversão da regex do `frontend/tests/unit/docs-integridade.test.js`: o prefixo deixou de ser lista fechada e virou asserção (coleta qualquer token com cara de caminho, resolve contra as raízes reais dos pacotes e contra o diretório do próprio documento). As 55 citações com prefixo pré-monorepo foram reescritas com verificação de existência do destino, mais 29 referências de diretório e os 3 ponteiros `MUST stay in lockstep` que viviam em comentário de CÓDIGO, fora do alcance de qualquer varredura de .md. O ponteiro de `trace-stages.js` estava morto duas vezes (prefixo legado + diretório `collab/trace/` que nunca existiu); aponta agora para `backend/src/utils/sync-trace.js`.


- **Tipo:** desatualizada · **Fatia:** `be-catalog-config-audit`
- **Documento:** `docs/wiki/syncledger.md:40`
- **Código:** `backend/src/modules/debug/debug.routes.js:21`

**Evidência.** O marcador diz que o espelho de backend do enum de estagios pode ser `backend/src/utils/sync-trace.js` ou ebgeo_backend/src/modules/collab/trace/trace-stages.js (sem crase: caminho inexistente) e manda "confirmar o caminho real no repo do backend". O repo e o mesmo monorepo e a resposta e verificavel agora: backend/src/utils/sync-trace.js existe e e o que debug.routes.js:21 importa (getTrace/clearTrace/isTraceEnabled); backend/src/modules/collab/ nao tem subpasta trace/. O ponteiro morto e o JSDoc do frontend (frontend/src/js/store/sync/diag/trace-stages.js:7), que ainda cita o caminho inexistente e ainda usa o prefixo morto ebgeo_backend/.

**Ação.** Resolver contra o codigo: corrigir o JSDoc de frontend/src/js/store/sync/diag/trace-stages.js:7 para backend/src/utils/sync-trace.js, apagar o marcador e registrar a resolucao no ## Historico da pagina.

### 80. docs/wiki/upload-imagens-seguranca.md (linha 32) e docs/wiki/imagens-atlas.md (linhas 16 e 37)

- **Tipo:** desatualizada · **Fatia:** `be-images`
- **Código:** `backend/src/modules/images/images.routes.js:66; backend/src/modules/images/images.schemas.js:12; backend/src/modules/images/images.service.js:142`

**Evidência.** Tres marcadores CONTRADICAO malformados e, pelo criterio do projeto, mal classificados. Forma: upload-imagens-seguranca.md:32 usa `## [!CONTRADICAO] Um SVG no lote...` como CABECALHO, sem data e sem blockquote, quando docs/wiki/wiki-schema.md:59 exige `> [!CONTRADICAO AAAA-MM-DD]`; imagens-atlas.md:16 e :37 usam blockquote mas tambem sem data. Classificacao: os tres marcam divergencia contra prosa que ja nao existe ('A documentacao anterior mostrava...', 'os guias absorvidos 06-presenca-imagens e 08-offline-import dizem...'), e docs/wiki/wiki-schema.md:60 define exatamente isso como supersessao temporal: 'Nao e contradicao: atualize o conteudo e registre no ## Historico da pagina. Sem marcador.' Marcar contradicao contra prosa ja apagada e o padrao que gerou 117 falsos positivos de 125. O conteudo dos tres e correto e valioso (verifiquei o de upload:34: `validate({ body: bulkUploadSchema })` esta mesmo em images.routes.js:66, o Joi restringe o MIME em images.schemas.js:12, e o ramo `Invalid file type: <mime>` em images.service.js:142 e de fato inalcancavel por HTTP) - o defeito e so o marcador.

**Ação.** Apagar os tres marcadores mantendo o texto. Em upload-imagens-seguranca.md:32 transformar o cabecalho em secao normal (ex.: 'Um SVG no lote nao gera falha parcial: derruba o lote inteiro'), que e onde a armadilha pertence. Mover a nota de proveniencia (qual guia absorvido dizia o contrario) para um `## Historico` em cada pagina.

### 81. link-publico.md

- **Tipo:** desatualizada · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/link-publico.md:23`
- **Código:** `backend/src/modules/collab/collab.gateway.js:351-355 e :476-479`

**Evidência.** A pagina cita `backend/src/modules/collab/collab.gateway.js:331-335,444` para "nao cria nem apaga linha em active_sessions, senao a FK para users quebraria". :331-335 cai no fim do bloco de cancelamento do timer de away e no inicio da atribuicao de campos do ws; :444 e `case 'sync_request':`. As guardas reais de `isPublic` sao :351-355 (skip do createSession) e :476-479 (skip do deleteSession em removeConnection). Mesma deriva das outras paginas, so que numa pagina fora da fatia collab.

**Ação.** Reancorar para :351-355 e :476-479.

### 82. backend/CLAUDE.md (secao 'Decisoes de arquitetura'), refletido em docs/wiki/zonas-acesso-geografico.md:47

- **Tipo:** divergência · **Fatia:** `be-nomes-zones`
- **Documento:** `backend/CLAUDE.md`
- **Código:** `backend/src/modules/zones/zones.queries.js:34`

**Evidência.** backend/CLAUDE.md afirma sem condicao: 'Soft-delete sempre (deleted_at, ou is_active p/ usuarios; tombstone p/ fotos 360). Nunca faca hard-DELETE de entidade principal.' O codigo desta fatia faz hard-DELETE de entidade principal: backend/src/modules/zones/zones.queries.js:34 e 'DELETE FROM ng.geographic_access_zones WHERE id = $1 RETURNING id', exposto em rota (backend/src/modules/zones/zones.routes.js:15) e sem coluna deleted_at na tabela (backend/src/database/migrations/004_ng.sql:218-225). Nenhuma pagina reconcilia os dois. zonas-acesso-geografico.md:47 descreve o efeito ('nao tem undo') como se fosse propriedade natural da rota, nao como excecao a uma regra declarada nao negociavel. O leitor agente que confia na constituicao conclui que existe soft-delete aqui, e o leitor que confia na pagina nao sabe que esta diante de uma excecao.

**Ação.** Resolver contra o codigo: ou registrar a excecao (schema ng e dado de referencia carregado por FME, nao entidade de usuario, logo hard-delete e aceito) qualificando a regra em backend/CLAUDE.md e citando zones.queries.js:34 em zonas-acesso-geografico.md:47, ou tratar como divida e abrir soft-delete na zona. Nao deixar as duas prosas em pe ao mesmo tempo.

### 83. backend/CLAUDE.md:115

- **Tipo:** divergência · **Fatia:** `be-catalog-config-audit`
- **Documento:** `backend/CLAUDE.md:115`
- **Código:** `backend/src/modules/debug/debug.routes.js:45`

**Evidência.** A constituicao descreve o endpoint do SyncLedger como "`GET/DELETE /api/v1/debug/trace` (auth) expoe o ring". O gate nao e apenas `auth`: GET exige `auth + liftAtlasIdToParams + requireAtlasPermission('read')` (backend/src/modules/debug/debug.routes.js:45) e DELETE exige `requireAtlasPermission('manage')` (:55); sem `?atlasId=` a requisicao morre em 400 antes de qualquer gate (:31-38). O JSDoc do proprio arquivo abre contradizendo a frase: "Per-atlas authorization (NOT just `auth`)" (debug.routes.js:11), e explica o porque (o ring e por atlas; sem isso qualquer portador de token lia ou apagava o ring de qualquer atlas, IDOR cross-atlas). Quem escrever helper de teste a partir de CLAUDE.md recebe 400 ou 403 e vai depurar no lugar errado.

**Ação.** Trocar "(auth)" por "(auth + permissao NO ATLAS: read no GET, manage no DELETE; `?atlasId=` obrigatorio, 400 sem ele)".

### 84. backend/CLAUDE.md:25

- **Tipo:** divergência · **Fatia:** `be-catalog-config-audit`
- **Documento:** `backend/CLAUDE.md:25`
- **Código:** `backend/src/modules/catalog/catalog.tables.js:5-11`

**Evidência.** A lista de modulos da constituicao do backend nomeia `resources`: "src/modules/<nome>/ - auth users organizations atlas maps briefings resources sharing images sync collab config nomes zones streetview360 audit debug". Nao existe backend/src/modules/resources/; `ls backend/src/modules/` devolve catalog, e nenhum modulo chamado resources. O modulo real e `catalog` (backend/src/modules/catalog/, montado em app.js:102-106 como cinco routers por tipo). A propria wiki ja registra que a superficie /api/v1/resources nao existe (docs/wiki/resources-catalogo.md:53). Como CLAUDE.md e lido em toda sessao, o agente procura um diretorio inexistente e nao encontra o modulo que existe.

**Ação.** Trocar `resources` por `catalog` na lista de modulos de backend/CLAUDE.md:25.

### 85. backend/src/modules/sync/sync.service.js (comentario de codigo) e nenhuma pagina

- **Tipo:** divergência · **Fatia:** `be-database`
- **Documento:** `backend/src/modules/sync/sync.service.js:167`
- **Código:** `backend/src/database/migrations/002_atlas.sql:178`

**Evidência.** O comentario em sync.service.js:167 abre com "features.layer_id is a UUID FK". Nao e FK: 002_atlas.sql:178 declara apenas "layer_id UUID," sem REFERENCES, ao contrario de todas as irmas do arquivo (groups.parent_id :146, comments.parent_id :224, group_features :206-207). O resto do comentario esta certo (o problema real e o CAST para UUID, 22P02), mas a palavra FK inverte o sentido: a AUSENCIA da FK e load-bearing, porque feicao pode referenciar uma camada cujo create ainda nao chegou ou foi removido pela compactacao da fila, e uma FK ali transformaria isso em 23503 e envenenaria o lote. Ninguem registrou esse porque, entao a "correcao" obvia (adicionar a FK que o comentario diz existir) parece higiene de schema e e regressao de sync.

**Ação.** Corrigir o comentario para "features.layer_id e UUID puro, sem FK, de proposito" e registrar o porque numa linha de atlas-modelo-de-dados.md junto do item de groups.parent_id: integridade referencial nao e imponivel num log de aplicacao por ordem de chegada.

### 86. canal-collab-websocket.md

- **Tipo:** divergência · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/canal-collab-websocket.md:17`
- **Código:** `frontend/src/js/store/sync/ws-client.js:397 e backend/src/modules/collab/collab.gateway.js:250,323`

**Evidência.** A pagina afirma que com clientId ausente ou malformado "voce perde silenciosamente a janela `away` E A DEDUPE". A parte da dedupe esta errada: o descarte de eco proprio compara `op.clientId === this._clientId` (ws-client.js:397), dois valores do lado do cliente que nunca passam pelo query param; o `crypto.randomUUID()` do servidor (gateway:250 e :323) so substitui a chave de sala/presenca e nunca volta ao cliente. A dedupe quebra por outra causa, `_clientId` nulo no singleton, documentada no proprio ws-client.js:568-572. Como esta, a pagina manda o depurador de "estou reaplicando minhas proprias ops" olhar o handshake do WS em vez do singleton.

**Ação.** Restringir a frase: clientId malformado degrada continuidade de presenca (janela away, user_back) e nada mais; a dedupe de eco depende do `_clientId` do singleton, ver ws-client.js:568-572 e [[client-id-estavel]].

### 87. docs/wiki/ (15 marcadores em ~12 páginas)

- **Tipo:** divergência · **Fatia:** `estrutural`
- **Código:** `docs/wiki/wiki-schema.md`

**Evidência.** São 39 marcadores [!CONTRADICAO] em 28 páginas. ~15 deles são marcados contra GUIAS ABSORVIDOS, isto é, contra prosa que já foi apagada: streetview-360.md:24 ("guia absorvido 16 §5/§7"), envelope-operacao.md:29 ("guia 05-sync-crdt absorvido"), imagens-atlas.md:16 e :37 ("guias absorvidos 06 e 08"), organizacoes-om.md:15, resources-catalogo.md:53, sintese-contrato-erros-http.md:25 e :33, sintese-contratos-congelados.md:40,42,44, sintese-modulos-fora-do-sync.md:42,44, config-runtime-urls-relativas.md:32,38. O próprio wiki-schema.md registra que marcar contradição contra prosa já apagada gerou 117 falsos positivos de 125. Contradição contra documento inexistente é irresolvível por construção: não há como "resolver contra o código" algo cuja outra ponta não existe.

**Ação.** Converter esses 15 em prosa afirmativa da própria página ("o comportamento é X; a versão antiga dizia Y, não confie nela") ou em linha de `## Histórico`, e apagar o marcador. Reservar [!CONTRADICAO] para conflito com prosa ou comentário VIVO no repositório, que é o caso legítimo de compartilhamento-atlas.md:9,17, ingestao-projetos-360.md:23,25 e gazetteer-nomes-geograficos.md:76.

### 88. docs/wiki/api-rest-atlas.md

- **Tipo:** divergência · **Fatia:** `be-atlas`
- **Documento:** `docs/wiki/api-rest-atlas.md:17`
- **Código:** `backend/src/modules/atlas/atlas.queries.js:60`

**Evidência.** A doc afirma: "**Admin global tem bypass total**, resolvido como `owner` em qualquer atlas antes de consultar shares. Toda auditoria de acesso precisa contar com isso." O bypass existe apenas dentro de `requireAtlasPermission` (`backend/src/middleware/permissions.js:82-87`), e duas rotas da familia nao passam por ele: `GET /atlas/trash` e `POST /:atlasId/restore` (`atlas.routes.js:25,31`). Ambas escopam por dono direto na query, sem qualquer checagem de `role`: `LIST_DELETED_USER_ATLAS ... WHERE a.owner_id = $1` (`atlas.queries.js:49-56`) e `RESTORE_ATLAS ... WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL` (`atlas.queries.js:60-67`, chamada em `atlas.service.js:92`). Um admin global nao ve nem restaura atlas alheio na lixeira: recebe 404. A propria pagina explica, em :47, por que o restore nao e gateado, sem notar que a excecao tambem apaga o bypass de admin. compartilhamento-atlas.md:55 documenta o caso do membro compartilhado, nao o do admin.

**Ação.** Trocar 'bypass total' por 'bypass em toda rota que passa por `requireAtlasPermission`' e acrescentar uma linha em :47: lixeira e restore sao os dois pontos cegos, porque a posse e checada dentro da query e nao pelo middleware. Se o suporte precisa restaurar atlas alheio, isso e requisito ausente, nao bug de doc.

### 89. docs/wiki/api-rest-atlas.md

- **Tipo:** divergência · **Fatia:** `be-sharing`
- **Documento:** `docs/wiki/api-rest-atlas.md:60`
- **Código:** `backend/src/modules/sharing/sharing.service.js:51-56`

**Evidência.** A linha 60 diz "Remover o dono e no-op silencioso, retorna 404 Share". "Silencioso" e precisamente o termo que docs/wiki/compartilhamento-atlas.md:7-9 refuta e marca como CONTRADICAO contra o comentario de backend/src/modules/sharing/sharing.routes.js:11-14. O codigo nao e silencioso: DELETE_USER_SHARE ... RETURNING id (backend/src/modules/sharing/sharing.queries.js:40-44) nao casa linha para o dono, e removeUserShare lanca NotFoundError('Share') (backend/src/modules/sharing/sharing.service.js:51-56), ou seja, o chamador recebe um erro 404 explicito, nao um 204 mudo. Duas paginas da mesma wiki descrevem o mesmo comportamento com rotulos opostos.

**Ação.** Reescrever a linha 60 como "Remover o dono responde 404 NOT_FOUND 'Share' (o dono nao tem linha em atlas_shares), nao 204", eliminando a palavra "no-op silencioso" que colide com compartilhamento-atlas.md:7-9.

### 90. docs/wiki/atlas-modelo-de-dados.md

- **Tipo:** divergência · **Fatia:** `be-database`
- **Documento:** `docs/wiki/atlas-modelo-de-dados.md:21,24`
- **Código:** `docs/wiki/wiki-schema.md:59,63`

**Evidência.** Os dois marcadores da pagina sao escritos como "> [!CONTRADICAO]" sem data, contra a forma exigida em wiki-schema.md:59 ("> [!CONTRADICAO AAAA-MM-DD]"); gazetteer-nomes-geograficos.md:76 usa a forma datada, entao a divergencia e interna a wiki. Mais grave que a forma: nenhum dos dois e contradicao doc-codigo. Em ambos a pagina CONCORDA com o codigo e esta descrevendo uma inconsistencia interna do codigo (o trigger sem GREATEST em 003_sync.sql:59; o comentario "-- 18 valid feature types" em 002_atlas.sql:168 contra o CHECK de 20 em :186-193). Como wiki-schema.md:63 diz que so CONTRADICAO pendente acorda o gate, esses dois ficam pendentes para sempre: resolve-los exigiria editar migracao ja aplicada, que a propria regra de migracoes proibe.

**Ação.** Manter a prosa (o conteudo dos dois e armadilha legitima e bem ancorada) e remover os marcadores [!CONTRADICAO], rebaixando-os a texto normal na secao de armadilhas. Assim o gate volta a sinalizar so pendencia real.

### 91. docs/wiki/calibracao-e-grafo-360.md

- **Tipo:** divergência · **Fatia:** `be-sv360`
- **Documento:** `docs/wiki/calibracao-e-grafo-360.md:43`
- **Código:** `backend/src/modules/streetview360/sv360.write.service.js:141-153`

**Evidência.** A pagina explica que GET_PHOTO_FOR_WRITE nao exclui tombstone e conclui: "e por isso que updateCalibration roda dentro de tx(); sem a transacao a escrita persistia enquanto o cliente ouvia que nada aconteceu". O leitor conclui que o risco esta resolvido no modulo. As quatro escritas de target seguem FORA de transacao e mantem exatamente o bug: updateTargetOverride (:141-153), updateTargetVisibility (:164-170) e createTarget (:180-204) chamam query() direto e so depois rebuildPhotoShape, que usa GET_PHOTO_BY_ID (exclui tombstone) e lanca 404 com o UPDATE/INSERT ja commitado. O caminho e alcancavel: o tombstone nao apaga linhas de sv360.targets, entao GET_TARGET_LINK ainda casa.

**Ação.** Corrigir :43 para dizer que a protecao e SO do caminho de calibracao (agregado e lote), e nomear as tres rotas de target que ainda persistem antes do 404, ou registrar como CONTRADICAO datada ate o codigo igualar.

### 92. docs/wiki/clone-atlas.md

- **Tipo:** divergência · **Fatia:** `be-atlas`
- **Documento:** `docs/wiki/clone-atlas.md:7`
- **Código:** `backend/src/modules/atlas/atlas.service.js:282`

**Evidência.** A doc afirma como capacidade real: "quem consegue ler um atlas pode forkar o conteudo inteiro e virar `owner` da copia... **Inclui quem chegou por [[link-publico]] com permissao sintetizada `read`**". O visitante publico chega ate a rota (o `auth` estrito aceita o token de visitante e pula a reconciliacao por o `sub` ser `public-<uuid>`, `backend/src/middleware/auth.js:80-82`; `requireAtlasPermission('read')` pula o lookup de share e resolve `read` por `is_public`, `backend/src/middleware/permissions.js:42-44,92`), mas o clone insere `owner_id = req.user.id` = `'public-<uuid>'` numa coluna `UUID NOT NULL REFERENCES users(id)` (`atlas.service.js:282-292`, `backend/src/database/migrations/002_atlas.sql:14`). Isso estoura SQLSTATE 22P02, que o errorHandler mapeia para **400 BAD_REQUEST 'Malformed value (invalid id or type)'** (`backend/src/middleware/error-handler.js:65`). O visitante publico NAO clona: recebe 400. A afirmacao central da pagina (membro `read` autenticado forka e vira dono) continua verdadeira; so o caso mais alarmante e falso, e o modo de falha real (400 opaco em vez de 403) nao esta em lugar nenhum.

**Ação.** Corrigir a frase: o portador de link publico alcanca o gate mas falha na insercao com 400 (`owner_id` nao e UUID de usuario). Vale registrar como limite acidental, nao gate deliberado, ja que um 403 explicito seria o comportamento pretendido.

### 93. docs/wiki/erros-api.md

- **Tipo:** divergência · **Fatia:** `be-middleware`
- **Documento:** `docs/wiki/erros-api.md:47`
- **Código:** `backend/src/middleware/request-logger.js:11-25`

**Evidência.** A doc diz, na Nota historica: "o 429 vem direto do limitador, `backend/src/middleware/rate-limit.js:6-8`, sem passar pelo `errorHandler` e portanto sem virar log de request". A primeira metade e verdadeira, a conclusao nao. `requestLogger` e registrado globalmente em `backend/src/app.js:73-75`, ANTES de todos os routers (:98+), e registra um listener `res.on('finish')` (`request-logger.js:11`) que dispara para toda resposta, independente de quem a escreveu. O 429 do `handler` de `rate-limit.js:5-12` fecha a resposta normalmente, entao `finish` dispara e `request-logger.js:21-22` loga em `logger.warn` com `'request error'`, por ser `statusCode >= 400`. Nao passar pelo `errorHandler` custa o log enriquecido (`{err, userId}` de `error-handler.js:20-25`) e o `details`, nao o log de request. `docs/wiki/hardening-borda-api.md:20` descreve o MESMO fato corretamente ("nao espere dele log enriquecido nem `details`"), entao as duas paginas se contradizem e a de `erros-api` e a errada. Detalhe que explica a sobrevivencia do erro: `requestLogger` nao e montado sob `config.isTest` (`app.js:73`), entao nenhum teste de integracao jamais observaria o log do 429.

**Ação.** Corrigir a Nota historica de `erros-api.md:47` para "sem passar pelo `errorHandler`, e portanto sem log enriquecido nem `details` (o log de request comum sai normalmente, `backend/src/middleware/request-logger.js:11-25`)", alinhando com a formulacao ja correta de `hardening-borda-api.md:20`.

### 94. docs/wiki/gestao-usuarios.md

- **Tipo:** divergência · **Fatia:** `be-users-orgs`
- **Documento:** `docs/wiki/gestao-usuarios.md:11`
- **Código:** `backend/src/modules/users/users.schemas.js:47-52`

**Evidência.** A pagina afirma que fora de `rank_id`/`organization_id` os campos sao COALESCE puro e portanto "mandar `null` neles e no-op silencioso, nao erro: a resposta 200 volta com o valor antigo e parece que a gravacao funcionou". Esse 200 nao existe. Os campos restantes de `updateUserAdminSchema` sao `Joi.string()`/`Joi.boolean()` sem `.allow(null)` (users.schemas.js:47-52), a validacao roda na borda da rota (users.routes.js:22) e `validate` devolve o erro Joi ao errorHandler antes de qualquer SQL (middleware/validate.js:20-23). `PUT /users/:id {"nome": null}` responde 422, nunca 200. A observacao sobre COALESCE e correta no nivel do SQL, mas o modo de falha que a pagina descreve e inalcancavel pela API, e e justamente ele que o leitor vai tentar reproduzir. Documentacao que inventa um sintoma engana mais que o silencio.

**Ação.** Corrigir a frase: o COALESCE puro so implementa "omitido = inalterado"; `null` explicito nesses campos e barrado por Joi com 422. A assimetria real que vale documentar e outra: `rank_id`/`organization_id` ACEITAM `null` (schema `.allow(null,'')` + flag de presenca) e os demais nao, entao o mesmo gesto de UI ("limpar campo") tem dois resultados conforme o campo.

### 95. docs/wiki/gestao-usuarios.md

- **Tipo:** divergência · **Fatia:** `be-utils`
- **Documento:** `docs/wiki/gestao-usuarios.md:27`
- **Código:** `backend/src/utils/mailer.js:41-53`

**Evidência.** A pagina enquadra a ausencia de SMTP como o caso excepcional: 'Quando nao ha SMTP configurado, o desbloqueio oficial e o admin enviar `email_verified: true`', o que implica que com SMTP configurado o e-mail flui. Nao flui em nenhuma configuracao hoje. `mailer.js:41-53` resolve o transporte por `await import('nodemailer')` dentro de try/catch, e `nodemailer` NAO esta em `backend/package.json` (deps: bcrypt better-sqlite3 compression cookie-parser cors express express-rate-limit file-type helmet joi jsonwebtoken multer pg-promise pino pino-pretty ws; devDeps sem nodemailer). O import sempre lanca, `getTransport()` sempre devolve null, e `sendVerificationEmail` cai no ramo :73-76, que loga um warn e retorna `{ sent: false }`. O ramo 'SMTP configurado + nodemailer instalado -> envia' descrito no proprio JSDoc (mailer.js:6-8) e inalcancavel neste repositorio. Fecha o circuito: `auth.service.js:270` faz `await sendVerificationEmail(...)` e DESCARTA o retorno, entao `sent:false` e indistinguivel de sucesso para o chamador e para a resposta HTTP. Um operador que setar SMTP_HOST em producao acredita que confirmacoes saem; ninguem recebe e-mail e nada erra.

**Ação.** Corrigir :27 para dizer que hoje NENHUM e-mail e enviado (o transporte e opcional por desenho e a dependencia nao esta instalada), portanto o desbloqueio por admin com `email_verified: true` e o unico caminho real, e nao um plano B. Registrar que habilitar SMTP e um follow-up de deploy que exige adicionar a dependencia, citando mailer.js:41-53 e a ausencia em backend/package.json.

### 96. docs/wiki/organizacoes-om.md

- **Tipo:** divergência · **Fatia:** `be-users-orgs`
- **Documento:** `docs/wiki/organizacoes-om.md:35`
- **Código:** `frontend/src/js/admin/personnel-tab.js:45`

**Evidência.** A pagina descreve corretamente o mecanismo (`COALESCE($3, sigla)` mais `data.sigla ?? null` em organizations.service.js:28 fazem `null` preservar o valor antigo) e prescreve a saida: "Para esvaziar, envie `\"\"`". Mas o painel admin embarcado faz o oposto: `update: (id, v) => apiClient.updateOrganization(id, { nome: v.nome, sigla: v.sigla || null })` (personnel-tab.js:45) converte string vazia em `null` justamente no gesto de limpar o campo. Como o schema aceita `null` (organizations.schemas.js:14, `.allow(null, '')`), a requisicao passa, o servidor responde 200 e a sigla antiga permanece. Ou seja, a armadilha nao e hipotetica: a unica UI que existe para editar OM cai nela toda vez, e a pagina documenta o remedio sem dizer que o produto nao o aplica.

**Ação.** Atualizar :35 para registrar o caso observado: limpar a sigla pelo painel admin e no-op silencioso, porque personnel-tab.js:45 envia `v.sigla || null`. Ou o service adota a flag de presenca ja usada em users (users.queries.js:29-30), ou a UI para de converter `''` em `null`. Enquanto nao houver correcao, a doc precisa dizer qual dos dois lados esta errado.

### 97. docs/wiki/sintese-contratos-congelados.md

- **Tipo:** divergência · **Fatia:** `estrutural`
- **Código:** `backend/src/modules/config/config.service.js:186`

**Evidência.** sintese-contratos-congelados.md:40 e config-runtime-urls-relativas.md:32 afirmam que a string `assets3dBaseUrl` "não aparece em nenhum arquivo de `src/`". A afirmação é verdadeira só para frontend/src (grep: zero ocorrências), mas o BACKEND publica o campo: `config.service.js:186` emite `assets3dBaseUrl: config.assets3d.baseUrl` e `config.admin.schemas.js:47` o valida como campo administrável. Numa auditoria do lado backend a frase lida como "o campo não existe", quando o correto é "o backend publica e o cliente ignora", que é um fato bem mais interessante (campo de contrato sem consumidor).

**Ação.** Reescrever as duas frases como "o backend publica `assets3dBaseUrl` (config.service.js:186) e NENHUM arquivo de frontend/src o lê", que é a armadilha real e fica ancorada nos dois lados.

### 98. docs/wiki/sintese-rest-vs-sync.md

- **Tipo:** divergência · **Fatia:** `be-sharing`
- **Documento:** `docs/wiki/sintese-rest-vs-sync.md:45`
- **Código:** `backend/src/database/migrations/002_atlas.sql:63`

**Evidência.** A linha 45 afirma "o CHECK da tabela aceita apenas read|comment|write|manage" e ancora essa afirmacao em backend/src/modules/sharing/sharing.routes.js:11-14. Esse trecho nao e o CHECK: e um comentario de codigo em prosa, e e exatamente o comentario que docs/wiki/compartilhamento-atlas.md:9 marca como mentiroso ("remover o dono e a no-op on them" e falso, e 404). O CHECK real esta em backend/src/database/migrations/002_atlas.sql:63 (permission VARCHAR(10) NOT NULL CHECK (permission IN ('read','comment','write','manage'))). A pagina ancora um contrato congelado de schema numa prosa que a propria wiki declara nao confiavel.

**Ação.** Trocar a citacao de sharing.routes.js:11-14 por backend/src/database/migrations/002_atlas.sql:63 (o CHECK) e, se quiser manter a segunda ancora, usar backend/src/modules/sharing/sharing.schemas.js:6 (o enum Joi concedivel). Nunca ancorar contrato de schema em comentario de codigo.

### 99. docs/wiki/sintese-rest-vs-sync.md

- **Tipo:** divergência · **Fatia:** `be-maps-briefings`
- **Documento:** `docs/wiki/sintese-rest-vs-sync.md:7`
- **Código:** `backend/src/modules/maps/maps.routes.js:17`

**Evidência.** A página se contradiz internamente. Linha 7: "mapas e briefings expõem apenas leitura". Linha 28, na mesma página: "`merge` (`backend/src/modules/maps/maps.routes.js:17`) ... escreve entidades filhas apesar da regra". O código confirma a segunda (backend/src/modules/maps/maps.routes.js:17). Quem chega por grep em "maps" bate primeiro na linha 7, que é a afirmação falsa, e a seção que a corrige está 20 linhas abaixo sob um título que não parece ressalva à regra da abertura.

**Ação.** Corrigir a linha 7 para "mapas e briefings expõem leitura, mais uma única escrita estrutural (`merge`), veja a seção de exceções". Frase única, mantém a página do mesmo tamanho e elimina a leitura errada mais provável.

### 100. docs/wiki/zonas-acesso-geografico.md

- **Tipo:** divergência · **Fatia:** `be-middleware`
- **Documento:** `docs/wiki/zonas-acesso-geografico.md:31`
- **Código:** `backend/src/middleware/auth.js:108`

**Evidência.** A doc diz: "Todas as rotas sao `auth` + `requireAdmin` (`zones.routes.js:11-17`), e aqui o papel vem da **claim do JWT** (`backend/src/middleware/require-admin.js:14`), ao contrario da releitura em tabela do filtro de leitura." O codigo faz o contrario: como `auth` roda ANTES de `requireAdmin` em todas as sete rotas (`backend/src/modules/zones/zones.routes.js:11-17`), o `auth` estrito ja sobrescreveu a claim com o papel vivo do banco em `backend/src/middleware/auth.js:108` (`req.user.role = live.role`), logo apos `getLiveAuthState` em `:84`. Quando `require-admin.js:14` le `req.user.role`, o valor NAO e mais o do token. Conferi as 30 rotas com `requireAdmin` em 8 modulos (audit, catalog, config, organizations, ranks, sync, users, zones): todas tem `auth` na frente, entao nao existe caminho em que a claim crua chegue ao gate. Duas outras paginas afirmam o correto e contradizem esta: `docs/wiki/gestao-usuarios.md:44` ("o middleware reconcilia com o banco a cada requisicao e sobrescreve `req.user.role` pelo papel vivo... logo `requireAdmin` nunca honra claim de admin ja rebaixado") e `docs/wiki/sintese-eixos-de-permissao.md:13`. A versao errada engana na direcao perigosa: sugere que um admin global rebaixado continua admin nas rotas de zonas por ate 15 minutos, quando o rebaixamento vale na hora.

**Ação.** Reescrever a segunda oracao de `zonas-acesso-geografico.md:31`: o papel vem da releitura viva em `users`, nao da claim, porque `auth` precede `requireAdmin` e sobrescreve `req.user.role` (`backend/src/middleware/auth.js:84-108`). O contraste que a frase queria fazer com o filtro de leitura das zonas nao existe nesse eixo, entao ou some ou vira outro contraste (o que de fato NAO e reconciliado sao `org_role`/`organization_id`, `backend/src/middleware/auth.js:104-107`).

### 101. gestao-usuarios.md

- **Tipo:** divergência · **Fatia:** `be-auth`
- **Documento:** `docs/wiki/gestao-usuarios.md:25 (e o eco em docs/wiki/autenticacao-jwt.md:51)`
- **Código:** `backend/src/modules/auth/auth.service.js:210-224`

**Evidência.** A pagina afirma que o endpoint publico responde colisao de username ou de e-mail "com a mesma frase generica, para nao virar oraculo de existencia", e o comentario do codigo (auth.service.js:210-212) vai mais longe: "an attacker can't tell which field, or whether a specific e-mail, is already registered". A segunda metade nao se sustenta contra o codigo: CHECK_EMAIL_EXISTS (auth.service.js:220-223) lanca ConflictError 409 quando o e-mail existe, e o caminho livre responde 201. Enviando um username aleatorio novo com o e-mail alvo, o atacante le 409 = e-mail cadastrado, 201 = nao cadastrado. A mensagem generica esconde QUAL campo colidiu, nao SE o e-mail existe. A pagina esta certa no mecanismo e errada na propriedade de seguranca que atribui a ele, e e essa propriedade que um leitor usa para decidir nao endurecer mais nada.

**Ação.** Reescrever gestao-usuarios.md:25 para dizer o que a defesa entrega de fato (esconde qual campo colidiu; nao impede enumeracao de e-mail via username descartavel) e citar auth.service.js:213-224. Se o objetivo for de fato fechar o oraculo, isso e mudanca de codigo, nao de doc, e a doc deve marcar a lacuna ate la.

### 102. hardening-borda-api.md (bloco de citacoes a config.js)

- **Tipo:** divergência · **Fatia:** `be-auth`
- **Documento:** `docs/wiki/hardening-borda-api.md:5, :54, :56, :58`
- **Código:** `backend/src/config.js:189, :216-220, :261, :291`

**Evidência.** Quatro citacoes a config.js estao deslocadas de ~30 linhas, todas na mesma pagina: :54 cita `config.js:258-260` para o lancamento do erro acumulado, que esta em config.js:291; :56 cita `config.js:220-242` para as regras numericas, que sao NUMERIC_ENV_RULES em config.js:189-207 com o laco em :261 (a linha 220 e `const isProd = ...`); :58 cita `config.js:188` para o `isProd` lido em tempo de chamada, que esta em config.js:220; :5 cita `config.js:184-261` para a regiao de validacao, que vai ate :295. O contraste prova o apodrecimento localizado: deploy-backend.md:42 e :46 citam `config.js:290-292` e `config.js:189-207` para os MESMOS dois fatos, e acertam. Uma pagina foi atualizada quando config.js cresceu, a outra nao.

**Ação.** Recitar as quatro ancoras de hardening-borda-api.md a partir do arquivo (189, 216-220, 261, 291), ou reduzir a prosa dessas linhas a um wikilink para [[deploy-backend]], que ja cobre o fail-fast de env com ancoras corretas e evita a segunda copia que diverge.

### 103. sintese-contrato-erros-http

- **Tipo:** divergência · **Fatia:** `be-sync`
- **Documento:** `docs/wiki/sintese-contrato-erros-http.md:57`
- **Código:** `backend/src/modules/sync/sync.service.js:665`

**Evidência.** A pagina (a matriz de status HTTP por rota, a sintese mais transversal do corpus) afirma: "`GET /api/v1/health` e o UNICO emissor de `503 SERVICE_UNAVAILABLE`, e o faz inline, sem passar pelo `errorHandler`. Falha de banco em qualquer outra rota vira 500." Falso nas duas metades desde 93d205b: `POST /atlas/:atlasId/sync` lanca `ServiceUnavailableError` (sync.service.js:665) quando o advisory lock estoura o lock_timeout, e ela PASSA pelo errorHandler, que serializa `{error:{code:'SERVICE_UNAVAILABLE'}}` com status 503 pelo ramo `err instanceof AppError` (backend/src/middleware/error-handler.js:41-54). Efeito colateral na pagina vizinha: erros-api.md:47 enumera os codigos extras do handler (CONFLICT, BAD_REQUEST, PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE, TOO_MANY_REQUESTS) advertindo que "tratar a lista como conjunto fechado gera switch incompleto no cliente", e a propria lista agora omite SERVICE_UNAVAILABLE, cometendo o erro que denuncia um paragrafo antes.

**Ação.** Corrigir a linha 57 para dois emissores com semanticas distintas (health inline versus sync via errorHandler) e acrescentar SERVICE_UNAVAILABLE a enumeracao de erros-api.md:47. O nao-obvio que justifica o paragrafo: o 503 do sync e o unico erro do push que o retry infinito do cliente resolve, ao contrario do 403/409 da secao "Poison batch" logo abaixo (:59-65), que sao permanentes e so saem por intervencao.

### 104. backend/CLAUDE.md

- **Tipo:** link quebrado · **Fatia:** `estrutural`
- **Código:** `docs/wiki/index.md`

**Evidência.** backend/CLAUDE.md (bloco de referência, logo abaixo do constraint fundamental) diz "Guias de integração por subsistema em ../docs/wiki/ (série numerada `00`–`16`)". Não existe série numerada em docs/wiki/: são 67 páginas com slug kebab-case. Os guias 00-16 foram absorvidos (a própria wiki os cita como "guia absorvido" em ~15 marcadores). A promessa manda o leitor procurar um índice numérico que não existe.

**Ação.** Trocar por "páginas por entidade/conceito em ../docs/wiki/index.md" e remover a menção à série numerada.

### 105. backend/CLAUDE.md

- **Tipo:** link quebrado · **Fatia:** `estrutural`
- **Código:** `backend/src/modules/streetview360/`

**Evidência.** backend/CLAUDE.md (§Decisões, bloco `sv360`) termina com "Detalhes em ../docs/guias/16-streetview-360.md". O diretório `docs/guias/` não existe na raiz. Escapa do teste de integridade duas vezes: RE_CAMINHO exige prefixo conhecido (`docs/` casaria, mas a citação está sem backticks) e RE_LINK exige sintaxe markdown `](...)`, que também não há. Caminho nu em prosa é ponto cego dos dois guardas.

**Ação.** Apontar para [[streetview-360]] / [[ingestao-projetos-360]] em docs/wiki/, e considerar estender o teste para caminhos nus terminados em .md.

### 106. backend/CLAUDE.md

- **Tipo:** link quebrado · **Fatia:** `estrutural`
- **Código:** `docs/wiki/index.md`

**Evidência.** backend/CLAUDE.md (§SyncLedger, última linha) escreve o link como [`../docs/arquitetura-sync.md`](../docs/wiki/index.md). O ALVO existe (index.md), então o guarda passa verde; o TEXTO do link nomeia `docs/arquitetura-sync.md`, arquivo que não existe. O leitor (e o agente) registra o nome do arquivo, não a URL, e sai procurando um doc morto.

**Ação.** Alinhar texto e alvo: [`../docs/wiki/syncledger.md`](../docs/wiki/syncledger.md), que é a página que realmente cobre o assunto.

### 107. canal-collab-websocket.md / presenca-colaborativa.md

> **CORRIGIDO em 2026-07-24.** Resolvido pela inversão da regex do `frontend/tests/unit/docs-integridade.test.js`: o prefixo deixou de ser lista fechada e virou asserção (coleta qualquer token com cara de caminho, resolve contra as raízes reais dos pacotes e contra o diretório do próprio documento). As 55 citações com prefixo pré-monorepo foram reescritas com verificação de existência do destino, mais 29 referências de diretório e os 3 ponteiros `MUST stay in lockstep` que viviam em comentário de CÓDIGO, fora do alcance de qualquer varredura de .md. O ponteiro de `trace-stages.js` estava morto duas vezes (prefixo legado + diretório `collab/trace/` que nunca existiu); aponta agora para `backend/src/utils/sync-trace.js`.


- **Tipo:** link quebrado · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/canal-collab-websocket.md:94,96,97 e docs/wiki/presenca-colaborativa.md:5`
- **Código:** `frontend/tests/unit/docs-integridade.test.js:79-80`

**Evidência.** As secoes Fontes citam caminhos do layout PRE-monorepo: `backend/src/modules/collab/{collab.gateway,...}.js`, `backend/src/modules/{atlas,maps,sharing}/*.controller.js` e `frontend/src/js/store/sync/{ws-client,...}.js` (canal:94-97), mais `backend/src/modules/collab/` em presenca:5. Nenhum desses caminhos existe (os pacotes sao `backend/` e `frontend/`), e nenhum e visto pelo guard: a RE_CAMINHO de docs-integridade.test.js:79-80 so casa prefixos `frontend|backend|src|tests|docs|scripts|deploy|public`, entao `backend/...` e `frontend/...` escapam inteiros. E a mesma classe C4 que ja zerou a lista de documentos vigiados na mudanca para `frontend/`. Na mesma linha, presenca:5 cita `src/js/presence/`, diretorio sem extensao, que o guard tambem nao verifica.

**Ação.** Reescrever os caminhos das Fontes para `backend/src/...` e `frontend/src/...`. Considerar acrescentar ao teste um assert negativo que FALHE ao encontrar `ebgeo_backend/` ou `ebgeo_web/` em qualquer doc, ja que sao nomes mortos e hoje passam despercebidos por construcao.

### 108. docs/wiki/ (~20 citações)

- **Tipo:** link quebrado · **Fatia:** `estrutural`
- **Código:** `docs/wiki/atlas-modelo-de-dados.md:42`

**Evidência.** Cerca de 20 citações usam caminho relativo SEM prefixo de pacote e por isso também escapam da RE_CAMINHO: atlas-modelo-de-dados.md:42 `repositories/local.repository.js`, :54 `sync/operation-dispatcher.js`, modos-operacao.md:7-40 (cinco), sessao-boot-e-ciclo-de-vida.md:46 (sete numa linha), sync-admin-operacoes.md:30 `collab/collab.handlers.js`, resources-catalogo.md:19,57 `catalog.service.js`, permissoes-atlas.md:40 `sync/index.js`. Todas resolvem hoje por sufixo, mas três são AMBÍGUAS entre os pacotes: `catalog.service.js` existe em backend/src/modules/catalog/ E em frontend/src/js/catalog/; `sync/index.js` em backend/src/modules/sync/ E frontend/src/js/store/sync/; `config.js` em backend/src/ E frontend/src/js/. Numa auditoria de backend não dá para saber de qual lado a página está falando.

**Ação.** Prefixar todas com `frontend/` ou `backend/` (wiki-schema já manda citar arquivo:linha verificável), priorizando as três ambíguas. Isso é o que as põe sob o guarda existente sem mudar o teste.

### 109. docs/wiki/{api-rest-atlas,atlas-settings,permissoes-atlas,atlas-modelo-de-dados}.md

> **CORRIGIDO em 2026-07-24.** Resolvido pela inversão da regex do `frontend/tests/unit/docs-integridade.test.js`: o prefixo deixou de ser lista fechada e virou asserção (coleta qualquer token com cara de caminho, resolve contra as raízes reais dos pacotes e contra o diretório do próprio documento). As 55 citações com prefixo pré-monorepo foram reescritas com verificação de existência do destino, mais 29 referências de diretório e os 3 ponteiros `MUST stay in lockstep` que viviam em comentário de CÓDIGO, fora do alcance de qualquer varredura de .md. O ponteiro de `trace-stages.js` estava morto duas vezes (prefixo legado + diretório `collab/trace/` que nunca existiu); aponta agora para `backend/src/utils/sync-trace.js`.


- **Tipo:** link quebrado · **Fatia:** `be-atlas`
- **Documento:** `docs/wiki/api-rest-atlas.md:5`
- **Código:** `frontend/tests/unit/docs-integridade.test.js:79`

**Evidência.** As paginas da fatia citam codigo com prefixos de repositorio que nao existem no monorepo: `backend/src/modules/atlas/atlas.routes.js` (api-rest-atlas.md:5,120), `backend/src/modules/atlas/atlas.schemas.js:19-40` e `:queries.js:69-76` (atlas-settings.md:5,13,23,60), `backend/src/middleware/permissions.js:12-18` e `utils/roles.js:12-19` (permissoes-atlas.md:5,11), `backend/src/database/migrations/002_atlas.sql` (atlas-modelo-de-dados.md:5), alem de `frontend/src/js/...` (api-rest-atlas.md:5,13,120). Os caminhos reais sao `backend/...` e `frontend/...`. O guard nao pega nada disso: `RE_CAMINHO` so aceita os prefixos `(frontend|backend|src|tests|docs|scripts|deploy|public)` (`frontend/tests/unit/docs-integridade.test.js:79-80`), entao `ebgeo_backend/`/`ebgeo_web/` caem fora da varredura em silencio. Sao 10 ocorrencias so na minha fatia e 53 em 22 paginas da wiki inteira (contagem por grep). E a mesma familia de cobertura-vazia que os proprios comentarios do teste registram (C4): a regex mede a maioria e reporta verde.

**Ação.** Duas coisas, na ordem: (1) normalizar as 10 citacoes da fatia para `backend/`/`frontend/`; (2) fechar o buraco do guard, seja acrescentando `ebgeo_backend|ebgeo_web` a `RE_CAMINHO` para que passem a FALHAR, seja adicionando uma assercao dedicada 'nenhum doc cita prefixo de repo legado'. Sem (2) a correcao manual apodrece de novo, e a barra do projeto e 'onde existe teste que varre tudo, nao confira a mao'.

### 110. docs/wiki/{config-runtime-urls-relativas.md:7, assets3d-distribuicao.md:17, organizacoes-om.md:36, gestao-usuarios.md:23, sintese-contrato-erros-http.md:33}

- **Tipo:** link quebrado · **Fatia:** `be-catalog-config-audit`
- **Documento:** `docs/wiki/config-runtime-urls-relativas.md:7`
- **Código:** `backend/src/modules/config/config.service.js:174`

**Evidência.** Cinco citacoes arquivo:linha apontam para dentro de backend/src/modules/config/config.service.js e nenhuma cai onde diz cair (o arquivo cresceu, provavelmente com o JSDoc de rasterDemSource em :98-126, e as linhas abaixo deslizaram ~30). config-runtime-urls-relativas.md:7 cita ':150,187' para ASSETS_3D_BASE_URL e SV360_SERVICE_URL; :150 e a string SQL de listOrganizacoesMilitares e :187 e a chave `basemaps,` (o correto e :186 e :226-227). assets3d-distribuicao.md:17 cita ':150' para assets3dBaseUrl, e catalogo-3d.md:20 cita o MESMO fato corretamente em ':186'. organizacoes-om.md:36 cita ':119-124' para a query filtrada do dropdown de OM; :119-124 esta dentro de rasterDemSource (montagem de fonte raster-dem), o correto e :148-153. gestao-usuarios.md:23 e sintese-contrato-erros-http.md:33 citam ambas ':144' para `features.self_registration`; :144 e um `);` de listPostos, o correto e :174. O guarda nao pega isso por design: docs-integridade.test.js:76-77 diz explicitamente que so o caminho e validado, nunca o numero da linha.

**Ação.** Corrigir as cinco: assets3dBaseUrl -> :186; sv360 serviceUrl/tiles -> :226-227; listOrganizacoesMilitares -> :148-153; features.self_registration -> :174 (duas paginas). Como o gate nao verifica linha, preferir faixa (ex.: :141-153) ou citar o nome da funcao junto, que sobrevive a deslizamento.

### 111. docs/wiki/{config-runtime-urls-relativas.md:7, resources-catalogo.md:20,53,55, auditoria.md:53,60, syncledger.md:40}

> **CORRIGIDO em 2026-07-24.** Resolvido pela inversão da regex do `frontend/tests/unit/docs-integridade.test.js`: o prefixo deixou de ser lista fechada e virou asserção (coleta qualquer token com cara de caminho, resolve contra as raízes reais dos pacotes e contra o diretório do próprio documento). As 55 citações com prefixo pré-monorepo foram reescritas com verificação de existência do destino, mais 29 referências de diretório e os 3 ponteiros `MUST stay in lockstep` que viviam em comentário de CÓDIGO, fora do alcance de qualquer varredura de .md. O ponteiro de `trace-stages.js` estava morto duas vezes (prefixo legado + diretório `collab/trace/` que nunca existiu); aponta agora para `backend/src/utils/sync-trace.js`.


- **Tipo:** link quebrado · **Fatia:** `be-catalog-config-audit`
- **Documento:** `docs/wiki/config-runtime-urls-relativas.md:7`
- **Código:** `frontend/tests/unit/docs-integridade.test.js:79-80`

**Evidência.** Sete citacoes desta fatia usam os prefixos `ebgeo_backend/` e `ebgeo_web/`, que nao existem no monorepo (os pacotes sao backend/ e frontend/). Elas escapam inteiras do guarda: a regex de docs-integridade.test.js:79-80 so casa caminhos iniciados por frontend|backend|src|tests|docs|scripts|deploy|public, entao um caminho com prefixo morto nunca e checado. Sao 52 ocorrencias na wiki inteira. E exatamente a classe C4 que o projeto ja pagou (a lista de documentos vigiados que zerou ao mover o pacote para frontend/, registrada no cabecalho do proprio teste, linhas 30-35). O conteudo das afirmacoes continua correto: verifiquei que frontend/src/ nao referencia /api/v1/audit (auditoria.md:53 procede) e que backend/src/utils/maplibre-style-validate.js existe (resources-catalogo.md:20 procede).

**Ação.** Renomear os prefixos mortos para backend/ e frontend/ nas sete citacoes. Vale mais: acrescentar em docs-integridade.test.js uma asercao que FALHA se sobrar qualquer `ebgeo_backend/` ou `ebgeo_web/` na doc vigiada, senao o proximo rename volta a apodrecer em silencio.

### 112. docs/wiki/api-rest-atlas.md (:5, :13, :120)

> **CORRIGIDO em 2026-07-24.** Resolvido pela inversão da regex do `frontend/tests/unit/docs-integridade.test.js`: o prefixo deixou de ser lista fechada e virou asserção (coleta qualquer token com cara de caminho, resolve contra as raízes reais dos pacotes e contra o diretório do próprio documento). As 55 citações com prefixo pré-monorepo foram reescritas com verificação de existência do destino, mais 29 referências de diretório e os 3 ponteiros `MUST stay in lockstep` que viviam em comentário de CÓDIGO, fora do alcance de qualquer varredura de .md. O ponteiro de `trace-stages.js` estava morto duas vezes (prefixo legado + diretório `collab/trace/` que nunca existiu); aponta agora para `backend/src/utils/sync-trace.js`.


- **Tipo:** link quebrado · **Fatia:** `be-maps-briefings`
- **Documento:** `docs/wiki/api-rest-atlas.md:5 ; :13 ; :120`
- **Código:** `frontend/tests/unit/docs-integridade.test.js:79-80`

**Evidência.** Três citações usam prefixos de caminho que não existem mais no monorepo: `backend/src/modules/atlas/atlas.routes.js` (:5), `frontend/src/js/modals/project-picker.modal.js:369-370` (:13) e `backend/src/modules/{atlas,sharing,maps}/` (:120). `ls ebgeo_backend` retorna "No such file or directory"; os pacotes são `backend/` e `frontend/`. Pior que o link morto é o motivo de ele sobreviver: RE_CAMINHO (frontend/tests/unit/docs-integridade.test.js:79-80) só casa os prefixos `frontend|backend|src|tests|docs|scripts|deploy|public`, então citação com prefixo `ebgeo_backend/` ou `ebgeo_web/` não é sequer coletada e escapa inteira do guard. É a recorrência da classe de cobertura vazia que já custou duas vezes ao projeto (regex que não casa com nada reporta verde), e o :13 é justamente uma citação `arquivo:linha`, o formato que wiki-schema.md manda usar.

**Ação.** Trocar os três prefixos para `backend/` e `frontend/`. Em seguida, e mais importante, fechar o vão no guard: fazer RE_CAMINHO rejeitar (ou coletar como quebrado) qualquer citação em crase que comece por `ebgeo_backend/` ou `ebgeo_web/`, e varrer o corpus inteiro por esses dois prefixos de uma vez, já que o mesmo padrão aparece em atlas-settings.md:13,:60 e ingestao-projetos-360.md:42.

### 113. docs/wiki/autenticacao-jwt.md

- **Tipo:** link quebrado · **Fatia:** `be-boot`
- **Documento:** `docs/wiki/autenticacao-jwt.md:39`
- **Código:** `backend/src/config.js:53`

**Evidência.** A pagina cita `backend/src/config.js:45` para a allowlist `['HS256']`; a linha 45 e `poolMax: parseInt(optional('DATABASE_POOL_MAX', '10'), 10)`. A declaracao real e config.js:53. Mesma deriva da hardening-borda-api.md (as duas paginas devem ter sido escritas na mesma leitura do arquivo).

**Ação.** Trocar por `backend/src/config.js:53`.

### 114. docs/wiki/hardening-borda-api.md

- **Tipo:** link quebrado · **Fatia:** `be-boot`
- **Documento:** `docs/wiki/hardening-borda-api.md:5, :32, :54, :56, :58, :69`
- **Código:** `backend/src/config.js:53`

**Evidência.** Todas as citacoes `config.js:NN` desta pagina derivaram em bloco (~30 a 45 linhas) porque o arquivo cresceu (helper `optionalInt`, blocos `security` e `mail`, `NUMERIC_ENV_RULES`), e cada uma agora aponta para outra coisa: :32 cita `config.js:45` para `algorithms: ['HS256']` (real config.js:53; a linha 45 e `poolMax`); :54 cita `config.js:258-260` para o throw acumulado (real config.js:290-292; 258-260 e comentario); :56 cita `config.js:220-242` para o laco de parseInt (real config.js:252-274) e `config.js:244-256` para a gramatica de expiracao JWT (real config.js:276-288); :58 cita `config.js:188` para o `isProd` lido em tempo de chamada (real config.js:220) e `config.js:13` para a constante de import time (real config.js:21; a 13 e o JSDoc de `optionalInt`); :69 cita `config.js:102` para o config congelado de self-registration (real config.js:116); :5 cita `config.js:184-261` para "os mecanismos" (a funcao e 216-293). O contraste prova que e apodrecimento por pagina e nao renomeacao: as citacoes de config.js em deploy-backend.md (:44 216-292, :46 189-207, :47 280-288, :48 239-243, :50 9-11, :102 53) estao todas corretas. Numa pagina de seguranca, mandar o leitor a `poolMax` quando ele procura a allowlist HS256 e o custo direto.

**Ação.** Reancorar as seis citacoes contra o arquivo atual, ou trocar as que sao ponteiro de leitura por citacao de simbolo (`config.jwt.algorithms`, `NUMERIC_ENV_RULES`) que nao apodrece com a linha.

### 115. docs/wiki/sintese-cache-http-imutavel.md

- **Tipo:** link quebrado · **Fatia:** `be-boot`
- **Documento:** `docs/wiki/sintese-cache-http-imutavel.md:20`
- **Código:** `backend/src/config.js:80`

**Evidência.** A pagina ancora os semaforos `ASSETS_3D_MAX_INFLIGHT` / `SV360_MAX_INFLIGHT` ("ambos default 8") em `backend/src/config.js:65` e `:71`. A linha 65 esta em branco e a 71 e comentario do parser de `/images/bulk`; as declaracoes reais sao config.js:80 e config.js:87. O valor (default 8) esta certo, so o ponteiro esta morto, e e justamente o numero que a pagina manda ajustar em container apertado.

**Ação.** Corrigir para `backend/src/config.js:80` e `:87`.

### 116. docs/wiki/streetview-360.md e docs/wiki/ingestao-projetos-360.md

> **CORRIGIDO em 2026-07-24.** Resolvido pela inversão da regex do `frontend/tests/unit/docs-integridade.test.js`: o prefixo deixou de ser lista fechada e virou asserção (coleta qualquer token com cara de caminho, resolve contra as raízes reais dos pacotes e contra o diretório do próprio documento). As 55 citações com prefixo pré-monorepo foram reescritas com verificação de existência do destino, mais 29 referências de diretório e os 3 ponteiros `MUST stay in lockstep` que viviam em comentário de CÓDIGO, fora do alcance de qualquer varredura de .md. O ponteiro de `trace-stages.js` estava morto duas vezes (prefixo legado + diretório `collab/trace/` que nunca existiu); aponta agora para `backend/src/utils/sync-trace.js`.


- **Tipo:** link quebrado · **Fatia:** `be-sv360`
- **Documento:** `docs/wiki/streetview-360.md:16`
- **Código:** `frontend/tests/unit/docs-integridade.test.js:78-79`

**Evidência.** Citacoes com prefixo de repositorio inexistente escapam inteiras do guarda: RE_CAMINHO (docs-integridade.test.js:78-79) so casa caminho que comeca em frontend|backend|src|tests|docs|scripts|deploy|public, entao `backend/...` e `frontend/src/js/...` nunca sao verificados, e nao existe nem diretorio ebgeo_backend/ nem ebgeo_web/src/ na raiz. Na minha fatia: streetview-360.md:16 (`frontend/src/js/store/sync/api-client.js:261`, com a MESMA linha usando `frontend/src/js/store/sync/api-client.js:515-535` corretamente logo depois), :55, :73; ingestao-projetos-360.md:42, :43, :44. E o padrao C4 (cobertura vazia) e ha 30+ ocorrencias na wiki inteira.

**Ação.** Normalizar para frontend/ e backend/ nas seis citacoes da fatia e, no teste, ou aceitar os prefixos legados mapeando-os, ou adicionar assert que falha quando um caminho citado comeca por ebgeo_web/ ou ebgeo_backend/. Sem isso a regra continua medindo a minoria.

### 117. docs/wiki/syncledger.md

- **Tipo:** link quebrado · **Fatia:** `be-utils`
- **Documento:** `docs/wiki/syncledger.md:40`
- **Código:** `backend/src/utils/sync-trace.js:18-30`

**Evidência.** Marcador [!CONTRADICAO] pendente que ja da para resolver contra o codigo, que e a regra do wiki-schema. Ele diz 'Sao dois arquivos distintos (ring vs. enum) ou um deles moveu' e manda 'confirme o caminho real no repo do backend'. Confirmado: `backend/src/modules/collab/` contem apenas gateway/handlers/quality/rooms/service/index, sem subpasta `trace/`; o caminho `backend/src/utils/sync-trace.js` nao existe e e a unica citacao a arquivo inexistente do corpus. E nao sao dois arquivos: `utils/sync-trace.js` e ring E enum, expondo `TraceStage` (:18-22) e `TraceOutcome` (:25-30) alem do buffer. A origem do caminho morto e o proprio codigo do frontend: JSDoc em `frontend/src/js/store/sync/diag/trace-stages.js:6-7`. Marcador pendente e o unico estado que acorda o gate da wiki, entao ele custa em todo lint enquanto fica.

**Ação.** Apagar o marcador e substituir por uma linha afirmativa: o espelho de backend e `backend/src/utils/sync-trace.js`, que carrega o subconjunto server.* do enum (:18-22) alem do ring. Corrigir tambem o JSDoc de frontend/src/js/store/sync/diag/trace-stages.js:6-7, que e a fonte do caminho morto, senao a contradicao renasce na proxima leitura.

### 118. docs/wiki/upload-imagens-seguranca.md (linha 34)

- **Tipo:** link quebrado · **Fatia:** `be-images`
- **Código:** `frontend/tests/unit/docs-integridade.test.js:78-80; backend/src/middleware/error-handler.js:18,28-31`

**Evidência.** A citacao e `middleware/error-handler.js:18,28-31`. O caminho real e `backend/src/middleware/error-handler.js` (as linhas 18 e 28-31 conferem: :18 tem `err.isJoi ? 422 : 500` e :28-31 tem o `if (err.isJoi) return res.status(422)` com `code: 'VALIDATION_ERROR'`), mas o caminho como escrito nao resolve a partir da raiz do repositorio. Pior: ele ESCAPA do guarda. `RE_CAMINHO` em frontend/tests/unit/docs-integridade.test.js:78-80 so casa caminhos que comecam por `frontend|backend|src|tests|docs|scripts|deploy|public`, entao um caminho iniciado por `middleware/` nunca e verificado. Este e literalmente o modo de falha C4 ja registrado no livro-razao ('citacoes encurtadas para basename escapavam do prefixo conhecido') reaparecendo. Ha um irmao na mesma fatia: docs/wiki/sintese-cache-http-imutavel.md:53 cita `street_view_tool/streetview-api.service.js:76`, tambem fora do prefixo e tambem nao verificado.

**Ação.** Expandir as duas citacoes para o caminho completo (`backend/src/middleware/error-handler.js:18,28-31` e `frontend/src/js/street_view_tool/streetview-api.service.js:76`). Separadamente, considerar apertar RE_CAMINHO para tambem ACUSAR caminho encurtado com extensao conhecida que nao case o prefixo, senao a classe inteira segue invisivel.

### 119. jwt-emissor-unico.md

> **CORRIGIDO em 2026-07-24.** Resolvido pela inversão da regex do `frontend/tests/unit/docs-integridade.test.js`: o prefixo deixou de ser lista fechada e virou asserção (coleta qualquer token com cara de caminho, resolve contra as raízes reais dos pacotes e contra o diretório do próprio documento). As 55 citações com prefixo pré-monorepo foram reescritas com verificação de existência do destino, mais 29 referências de diretório e os 3 ponteiros `MUST stay in lockstep` que viviam em comentário de CÓDIGO, fora do alcance de qualquer varredura de .md. O ponteiro de `trace-stages.js` estava morto duas vezes (prefixo legado + diretório `collab/trace/` que nunca existiu); aponta agora para `backend/src/utils/sync-trace.js`.


- **Tipo:** link quebrado · **Fatia:** `be-auth`
- **Documento:** `docs/wiki/jwt-emissor-unico.md:3`
- **Código:** `frontend/tests/unit/docs-integridade.test.js:81 (RE_CAMINHO)`

**Evidência.** A frase de abertura da pagina ancora `issueAccessToken` em `backend/src/modules/auth/auth.service.js:24-42`. Nao existe diretorio `ebgeo_backend/` no monorepo (o pacote e `backend/`); o arquivo real e backend/src/modules/auth/auth.service.js:24-42. O que torna isto mais que um typo e a cegueira do guard: RE_CAMINHO (docs-integridade.test.js:81) so casa prefixos `frontend|backend|src|tests|docs|scripts|deploy|public`, entao a citacao com prefixo `ebgeo_backend/` nunca e COLETADA, muito menos verificada, e o teste passa verde. E exatamente o padrao de cobertura vazia que o livro-razao ja registrou duas vezes (citacao encurtada para basename, regex exigindo crase). Ha ~20 ocorrencias do prefixo no corpus, incluindo linhas de ancora em api-rest-atlas.md:5, atlas-settings.md:13 e envelope-operacao.md:13.

**Ação.** Corrigir a citacao para `backend/src/modules/auth/auth.service.js:24-42` e, no mesmo passo, fechar o vao do guard: acrescentar `ebgeo_backend|ebgeo_web` ao RE_CAMINHO como prefixos que devem FALHAR (ou normaliza-los para o pacote real), e adicionar assert de contagem minima de citacoes coletadas, para o teste denunciar quando parar de casar.

### 120. docs/wiki/wiki-schema.md

- **Tipo:** órfã · **Fatia:** `estrutural`
- **Código:** `docs/wiki/index.md`

**Evidência.** wiki-schema.md não recebe nenhum [[wikilink]] de nenhuma das 66 outras páginas e não está listado em index.md (index.md linka 65 das 67 páginas; as ausentes são index.md e wiki-schema.md). Só é alcançável por link markdown a partir de CLAUDE.md. Quem entra pela wiki nunca encontra as regras de manutenção da wiki. Nenhuma outra órfã existe, e nenhum link do index aponta para página inexistente.

**Ação.** Acrescentar wiki-schema.md ao index.md, numa seção meta, com uma linha dizendo que é onde moram as regras de forma e o protocolo de CONTRADICAO.

### 121. docs/wiki/erros-api.md

- **Tipo:** recontagem · **Fatia:** `estrutural`
- **Código:** `docs/wiki/sintese-contrato-erros-http.md:5`

**Evidência.** Deferência circular entre duas páginas: erros-api.md:5 diz "O mapa completo de status por origem está em [[sintese-contrato-erros-http]]. Esta página cobre só as armadilhas que sobram"; sintese-contrato-erros-http.md:5 diz "Catálogo por rota em [[erros-api]]. O que segue é só o que a leitura desses arquivos não entrega". Cada uma delega o catálogo à outra, logo o catálogo não existe em lugar nenhum e as duas ficam sendo "só as armadilhas", isto é, a mesma página com dois nomes.

**Ação.** Decidir uma: fundir em erros-api (armadilhas + contrato), ou dar à síntese um escopo que não seja "o que sobra". Em qualquer caso, remover a frase de deferência da página que ficar.

### 122. docs/wiki/sintese-nao-e-crdt.md

- **Tipo:** recontagem · **Fatia:** `estrutural`
- **Código:** `docs/wiki/modelo-conflito-lww.md:11`

**Evidência.** Duplicata semântica de três pontas sobre o mesmo conceito. modelo-conflito-lww.md tem uma seção inteira "## Por que não é CRDT" (:11-13) com a decisão e a alternativa rejeitada (módulo `src/crdt` removido por código morto) que é o assunto declarado de sintese-nao-e-crdt.md. E sintese-nao-e-crdt.md:15-22 ("As armadilhas do guard de convergência") cobre o mesmo mecanismo de idempotencia-e-convergence-guard.md. As três repetem os mesmos quatro fatos: os três campos-isca não decidem vencedor, granularidade é a feição inteira, idempotência é por op_id, escrita colaborativa não tem rota REST. wiki-schema manda uma página por conceito; aqui há três páginas para um conceito, e é sobre elas que a divergência de "escrita só via sync" já se propagou.

**Ação.** Fundir: manter modelo-conflito-lww como a página do conceito, absorver sintese-nao-e-crdt nela (o "não é CRDT" é o porquê da decisão, não um conceito separado) e deixar idempotencia-e-convergence-guard só com o guard de convergência, que é mecanismo distinto. Reapontar os wikilinks das duas absorvidas.

---

## Severidade baixa

### 123. docs/wiki/syncledger.md:24 (cobre so a metade do frontend)

- **Tipo:** armadilha não documentada · **Fatia:** `be-catalog-config-audit`
- **Documento:** `docs/wiki/syncledger.md:24`
- **Código:** `backend/src/utils/sync-trace.js:35-41`

**Evidência.** A pagina documenta o corte do ring do cliente (5000 spans por splice, trace-core.js:20,:84) e nomeia o sintoma: "uma op antiga parece nunca ter existido". O ring do backend tem DOIS limites e nenhum aparece: alem do corte de 5000 spans por atlas (backend/src/utils/sync-trace.js:83), o Map de aneis e limitado a 64 atlas e faz eviccao FIFO do mais antigo (:35-41,:77-80). Numa suite longa que cria um atlas por spec, passar de 64 atlas apaga o anel dos primeiros, e collectLedger passa a devolver zero span de servidor para eles: o merge por op.id degrada exatamente como o caso que a pagina ja considerou digno de registro, mas o leitor procura no lado errado. Nota secundaria: clearTrace() sem atlasId ainda limpa TODOS os aneis (:105-107); so o HTTP e que nao alcanca mais esse caminho (debug.routes.js:31-38).

**Ação.** Acrescentar uma linha na secao 'Armadilhas de leitura': "O anel do servidor corta em 5000 spans POR ATLAS e retem no maximo 64 atlas, evictando o mais antigo por FIFO (backend/src/utils/sync-trace.js:35-41,:77-83). Suite que cria mais de 64 atlas perde os spans de servidor dos primeiros; o merge cai para so-cliente sem avisar."

### 124. docs/wiki/upload-imagens-seguranca.md (linhas 40 e 47)

- **Tipo:** armadilha não documentada · **Fatia:** `be-images`
- **Código:** `backend/src/modules/images/images.service.js:215-232 e :82-87`

**Evidência.** A linha 47 explica a ordem INSERT-antes-de-writeFile como protecao contra arquivo orfao ('um INSERT que falhe nao deixa arquivo orfao') e a linha 40 define a leitura do resultado: 'um localId ausente de mapping e uma referencia de feicao apontando para blob inexistente no servidor'. O orfao INVERSO nao esta registrado: se `writeFile` (backend/src/modules/images/images.service.js:217) lanca, a linha ja foi commitada em :192 ou :202, o catch externo (:227-232) reporta o item em `failed[]`, e a linha PERMANECE no banco. Essa imagem aparece em `listImages` (:113-116) e da 404 no download, porque `getImageFile` faz `stat` no caminho antes de servir (:82-87). Ou seja, 'failed' nao significa 'nada foi escrito', e a heuristica documentada (ausencia em `mapping`) nao distingue os dois estados.

**Ação.** Complementar a linha 47 com o orfao inverso: falha de writeFile deixa linha sem arquivo, visivel em listImages e 404 no GET. Deixa claro que `failed[]` nao implica ausencia de linha, e que a reconciliacao correta e por 404 no download, nao por ausencia em `mapping`.

### 125. nenhuma pagina

- **Tipo:** armadilha não documentada · **Fatia:** `be-middleware`
- **Código:** `backend/src/middleware/validate.js:24`

**Evidência.** `validate()` reatribui a fonte validada de volta ao request (`req[source] = value`, `validate.js:24`) e uma das tres fontes e `query` (`validate.js:8`). Em Express 4 (`backend/package.json:34`, `^4.21.0`) isso funciona; em Express 5 `req.query` passa a ser um getter sem setter no prototipo, e como o pacote e ESM (`"type": "module"`, portanto strict mode) a atribuicao lanca `TypeError` em runtime, nao no build. O alcance nao e marginal: toda rota que valida query quebraria de uma vez, incluindo `GET /api/v1/audit` (`audit.routes.js:11`), `GET /api/v1/users` (`users.routes.js:19`), `GET /nomes/busca` (`nomes.routes.js:15`, que e contrato congelado do frontend) e `DELETE /users/:userId` (`users.routes.js:24`). Nao passa no teste do "engenheiro competente em poucos minutos": as 29 linhas de `validate.js` nao dao nenhum sinal de acoplamento a versao do framework, e o sintoma apareceria como falha em massa e aparentemente sem relacao com um bump de dependencia. Nenhuma das paginas que citam `validate.js` menciona (`sintese-contrato-erros-http.md:51` e `calibracao-e-grafo-360.md:19` citam so o `stripUnknown`/`convert` de `validate.js:3-6`).

**Ação.** Uma linha em `docs/wiki/hardening-borda-api.md` ou em `docs/wiki/sintese-contrato-erros-http.md` (onde `validate()` ja e discutido): registrar que `backend/src/middleware/validate.js:24` prende o pacote ao Express 4, porque reatribuir `req.query` lanca em Express 5. Alternativa se preferir codificar em vez de documentar (melhor pelo principio 1): trocar a reatribuicao por mutacao no lugar para a fonte `query`, o que remove a armadilha e dispensa a pagina.

### 126. deploy-backend.md (secao de variaveis de ambiente)

- **Tipo:** ausência · **Fatia:** `be-auth`
- **Documento:** `docs/wiki/deploy-backend.md:48, :54`
- **Código:** `backend/src/config.js:115-134 + backend/.env.example`

**Evidência.** A pagina e a dona declarada do "conjunto completo de variaveis" (hardening-borda-api.md:60 aponta para ela) e chega a registrar env que sao no-op: "`COOKIE_SECRET` e `USE_HTTPS` nao existem no codigo, configura-las e no-op" (:54). O bloco inteiro de e-mail e verificacao esta fora: APP_BASE_URL, SMTP_HOST/PORT/USER/PASS, MAIL_FROM (config.js:127-134) e AUTH_VERIFICATION_TTL_HOURS (config.js:121) nao aparecem em nenhuma pagina da wiki nem em backend/.env.example. E `AUTH_VERIFICATION_MODE` (config.js:120, default 'both') e lida em lugar nenhum fora de config.js (grep em src/ e tests/ so retorna a propria definicao): e no-op, exatamente a categoria que a pagina ja documenta para COOKIE_SECRET. Um operador que setar AUTH_VERIFICATION_MODE='admin' esperando mudar o fluxo nao recebe erro nem efeito.

**Ação.** Acrescentar em deploy-backend.md o bloco de e-mail: APP_BASE_URL obrigatoria em producao (ver achado do link derivado de Origin), SMTP_HOST ausente = link vai para o log, AUTH_VERIFICATION_TTL_HOURS default 48h, e AUTH_VERIFICATION_MODE na mesma lista de no-op de COOKIE_SECRET/USE_HTTPS (`backend/src/config.js:120`). Espelhar em backend/.env.example.

### 127. docs/wiki/compartilhamento-atlas.md

- **Tipo:** ausência · **Fatia:** `be-sharing`
- **Documento:** `docs/wiki/compartilhamento-atlas.md:41`
- **Código:** `backend/src/modules/sharing/sharing.controller.js:14,20`

**Evidência.** A pagina nomeia apenas user_removed como acao de broadcast sem consumidor (linha 41), mas o buraco e maior: o controller emite quatro acoes distintas de sharing_updated (public_enabled, public_disabled, user_added, user_updated, user_removed, em backend/src/modules/sharing/sharing.controller.js:14,20,31-39,49-58,64-68), e o unico consumidor em todo o frontend e frontend/src/js/store/sync/sync-engine.js:465-472, que descarta tudo que nao seja user_added/user_updated do proprio userId (grep por sharing_updated|sharingUpdated em frontend/src/js/ retorna so ws-client.js:360-361 e sync-engine.js:460-472). Logo publicar ou despublicar um atlas nao atualiza nenhum par conectado: um segundo co-Gestor com o modal de compartilhamento aberto continua vendo o link antigo ate reabrir o modal, e o link foi rotacionado (backend/src/modules/atlas/atlas.service.js:460-462).

**Ação.** Generalizar a frase de "Buraco conhecido": das cinco acoes de sharing_updated apenas duas tem consumidor. public_enabled/public_disabled/user_removed sao emitidas e descartadas (sync-engine.js:465-472). Consequencia concreta a registrar: como enablePublicSharing rotaciona o link (atlas.service.js:460-462), um co-Gestor com o modal aberto fica com um link ja morto na tela.

### 128. docs/wiki/zonas-acesso-geografico.md:34

- **Tipo:** ausência · **Fatia:** `be-nomes-zones`
- **Documento:** `docs/wiki/zonas-acesso-geografico.md:34`
- **Código:** `backend/src/modules/zones/zones.schemas.js:6`

**Evidência.** A pagina descreve as duas camadas de validacao de geometria (Joi so a forma, PostGIS decide via ST_IsValid) mas nao registra que nenhuma das duas checa faixa de coordenada, o que torna possivel criar uma zona que nunca concede nada e nunca acusa erro. O Joi aceita numero sem limite (backend/src/modules/zones/zones.schemas.js:6, 'Joi.array().items(Joi.array().items(Joi.array().items(Joi.number())))'), e ST_IsValid so avalia topologia planar, nao dominio do SRID (backend/src/modules/zones/zones.queries.js:15-17). Como a geometria da zona nunca e castada para ::geography no filtro de leitura (o cast e so no ponto de busca, backend/src/modules/nomes/nomes.queries.js:19), nao ha nem o 500 do PostGIS que serviria de alarme: o ST_Contains simplesmente nunca casa. O contraste com o modulo vizinho e o que torna isso nao-obvio: nomes.schemas.js:9-10 limita lat/lon a +-90/+-180 com comentario explicito sobre exatamente esse risco (:4-6), e zones.schemas.js nao faz o mesmo. Quem le so zones.schemas.js supoe que o PostGIS pega.

**Ação.** Uma linha no bullet 'Geometria e validada em duas camadas' de zonas-acesso-geografico.md:34: coordenada fora de faixa passa nas duas camadas e produz zona que nao concede nada, em silencio; contrastar com o limite de nomes.schemas.js:9-10.

### 129. nenhuma pagina (modulo backend/src/modules/ranks/)

- **Tipo:** ausência · **Fatia:** `be-users-orgs`
- **Documento:** `docs/wiki/organizacoes-om.md:36`
- **Código:** `backend/src/modules/config/config.service.js:141-152`

**Evidência.** O indice aponta `m/ranks/*` como a maior lacuna da wiki (zero citacoes). Lido o modulo inteiro, a lacuna NAO justifica uma pagina: sao 5 rotas CRUD simetricas as de organizations, e a unica decisao com porque ja esta no comentario do proprio SQL ("a rank may be referenced by users.rank_id, so we deactivate instead of hard-deleting", ranks.queries.js:31-32). Pelo criterio "o codigo ja e a evidencia", criar `ranks.md` produziria recontagem. O que de fato falta e uma linha, e ela e compartilhada com organizations: a lista controlada tem DUAS fontes independentes com filtros diferentes. `GET /api/v1/ranks` e `GET /api/v1/organizations` exigem `auth` e nao filtram `is_active` (ranks.queries.js:3-7, organizations.queries.js:3-7), enquanto o dropdown anonimo do signup vem de `GET /api/config` com `is_active = true` e SQL inline em outro modulo (config.service.js:141-152). Consequencia: um posto ou OM "excluido" some do cadastro e continua aparecendo no painel admin. A pagina organizacoes-om.md:36 documenta esse desvio SO para organizations, como se fosse peculiaridade de um modulo, quando e o mesmo par de fontes para os dois.

**Ação.** Nao criar pagina para ranks. Generalizar organizacoes-om.md:36 de "GET /organizations devolve inativas" para "as listas controladas (postos e OMs) tem duas fontes: a REST autenticada sem filtro e o /api/config anonimo filtrado por is_active", citando ranks.queries.js:3-7 e config.service.js:141-152, e deixar `ranks` coberto por essa linha mais o link em gestao-usuarios.

### 130. docs/wiki/index.md

- **Tipo:** contrato não documentado · **Fatia:** `estrutural`
- **Código:** `backend/src/database/migrations/005_sv360.sql`

**Evidência.** Verificações que passaram limpas, registradas para não serem refeitas: (a) TETO DE 300 LINHAS, nenhuma página excede; a maior é deploy-backend.md com 150 linhas, mediana ~60, total 4313 em 67 páginas; nada a dividir. (b) WIKILINKS, os [[...]] de todas as 67 páginas resolvem, zero quebrados. (c) INDEX, index.md não aponta para nenhuma página inexistente. (d) CITAÇÕES arquivo:linha, depois de descontar os prefixos legados e os relativos, o único caminho verdadeiramente inexistente em todo o corpus é `modules/collab/trace/trace-stages.js` (syncledger.md:40). (e) Migrações: head real é 005_sv360.sql, coerente com backend/CLAUDE.md.

**Ação.** Nenhuma. Registrado como controle negativo do escopo desta auditoria: as verificações de teto, wikilink e index foram exaustivas e negativas, não omitidas.

### 131. nenhuma página (candidato: docs/wiki/api-rest-atlas.md §"Contratos de resposta que surpreendem")

- **Tipo:** contrato não documentado · **Fatia:** `be-maps-briefings`
- **Documento:** `docs/wiki/api-rest-atlas.md:84`
- **Código:** `backend/src/modules/briefings/briefings.queries.js:15-19`

**Evidência.** Os slides têm dois caminhos de leitura com shapes diferentes. Pelo snapshot de sync, cada slide recebe `order: order.indexOf(slide.id)` derivado do canônico `briefings.slide_order`, mais `temporalCursor` em camelCase e metadado `sync` (backend/src/modules/sync/sync.service.js:553-562). Pelo REST, `GET /atlas/:id/briefings/:briefingId` devolve `SELECT * FROM slides ... ORDER BY created_at` cru (backend/src/modules/briefings/briefings.queries.js:15-19, atribuído em briefings.service.js:19-20): sem `order`, sem `temporalCursor`, sem `sync`, e em ordem de criação, que não é a ordem de apresentação. A página já documenta o análogo exato para mapas ("O array `maps` do `GET /atlas/:atlasId` vem `ORDER BY created_at`, **não** na ordem de `map_order`", api-rest-atlas.md:84) e a assimetria snake_case/camelCase entre superfícies (:81); o caso de slides tem a mesma natureza e não está em lugar nenhum. Peso menor porque nenhum cliente consome a rota hoje.

**Ação.** Um bullet na lista já existente de api-rest-atlas.md:79-84, no mesmo formato do de `map_order`. Não criar página de briefings: uma linha na página de contratos de resposta basta e evita página por módulo.

### 132. backend/src/database/migrations/003_sync.sql (cabecalho do proprio arquivo)

- **Tipo:** desatualizada · **Fatia:** `be-database`
- **Documento:** `backend/src/database/migrations/003_sync.sql:3`
- **Código:** `backend/src/database/migrations/003_sync.sql:95-115`

**Evidência.** O cabecalho da migracao ainda descreve o catalogo como "resources (basemaps/layers/tilesets)", exatamente a concepcao que deploy-backend.md:65 teve que corrigir em nota historica ("descrevia o catalogo vindo de uma tabela unica resources, que nao existe"). O corpo do mesmo arquivo (:95-115) cria CINCO tabelas dedicadas e o comentario de :95-99 rejeita a tabela unica explicitamente. O arquivo se contradiz em 90 linhas de distancia, e a leitura do topo e a que induz ao erro ja cometido uma vez.

**Ação.** Baixa prioridade e edicao de migracao ja aplicada, entao corrigir so se outro motivo abrir o arquivo. Se nao, garantir que resources-catalogo.md continue sendo o desempate (ja e, em :12-13).

### 133. docs/wiki/deploy-backend.md

- **Tipo:** desatualizada · **Fatia:** `be-database`
- **Documento:** `docs/wiki/deploy-backend.md:145`
- **Código:** `backend/src/database/migrations/001_core.sql:32-40,58-77 + backend/src/database/migrate.js:76-79`

**Evidência.** A pagina lista como armadilha de montagem de ambiente: "Sem as migracoes de [[organizacoes-om]] aplicadas a subquery devolve NULL e o usuario nasce sem posto e sem OM, silenciosamente". Esse estado nao existe mais. Depois da consolidacao em baseline, o seed de ranks (001_core.sql:58-77) e o de organizations com a sigla CIGEx (:32-40) vivem na MESMA migracao que cria a tabela users (:84), e migrate.js:76-79 aplica cada arquivo dentro de uma transacao unica com o INSERT de tracking. Ou 001 aplicou por inteiro e as subqueries de seed.js:43-44 resolvem, ou nao ha tabela users e o seed falha ruidosamente antes. Nao ha caminho intermediario que produza o NULL silencioso descrito.

**Ação.** Remover o bullet ou substitui-lo pela armadilha que sobrou de verdade (nenhum dos dois usuarios de seed tem email, ja registrada na linha seguinte). Supersessao temporal, entao atualizar direto e registrar no Historico da pagina, sem marcador.

### 134. docs/wiki/gazetteer-nomes-geograficos.md:76

- **Tipo:** desatualizada · **Fatia:** `be-nomes-zones`
- **Documento:** `docs/wiki/gazetteer-nomes-geograficos.md:76`
- **Código:** `backend/src/database/migrations/004_ng.sql:163-164`

**Evidência.** O marcador '> [!CONTRADICAO 2026-07-18]' esta pendente, mas nao ha nada pendente: o proprio paragrafo ja carrega a resolucao contra o codigo ('a metade tipo_peso do racional e fragil; a metade cluster_id e incondicionalmente verdadeira e sozinha ja torna refresh_busca() obrigatorio. Nao remova a chamada com base na primeira metade'). A afirmacao esta correta (no PostgreSQL COPY FROM dispara triggers de linha BEFORE INSERT; so regras ficam de fora), logo o lado errado e o comentario de codigo em backend/src/database/migrations/004_ng.sql:163-164. So que esse lado nao pode ser corrigido: e comentario dentro de migracao ja aplicada, e migracao aplicada e forward-only (backend/CLAUDE.md, secao Migracoes). Pelo wiki-schema.md:59-63, CONTRADICAO pendente e o unico marcador que acorda o gate, e este vai ficar aceso para sempre esperando um conserto que a regra de migracao proibe.

**Ação.** Apagar o marcador e converter o paragrafo em prosa assentada (ou nota historica, ao lado da que ja existe em :74), preservando integralmente o conteudo e dizendo por que o comentario da migracao nao sera corrigido: e migracao aplicada, forward-only. Assim o gate para de acordar por um item que ja foi decidido.

### 135. docs/wiki/sintese-decisoes-arquiteturais.md:66 (marcador CONTRADICAO pendente)

- **Tipo:** desatualizada · **Fatia:** `be-maps-briefings`
- **Documento:** `docs/wiki/sintese-decisoes-arquiteturais.md:66`
- **Código:** `backend/src/modules/maps/maps.routes.js:17`

**Evidência.** O marcador `> [!CONTRADICAO] Regra ampla demais` já traz a própria resolução no corpo ("Leia a regra como escrita **incremental** só via sync") e o título da seção acima dele já foi emendado para "Escrita de entidade só via sync (com exceções estruturais)". Segundo wiki-schema.md, contradição resolvida contra o código deve ser aplicada e o marcador apagado; só marcador PENDENTE é erro que acorda o gate. Além disso ele cita `backend/src/modules/maps/maps.routes.js:16`, que é a linha de comentário, enquanto a rota está em :17 (é o que sintese-rest-vs-sync.md:28 cita corretamente), e lista três exceções onde sintese-rest-vs-sync.md:28 lista quatro (falta `clone`).

**Ação.** Aplicar a resolução no texto da seção, apagar o marcador, corrigir a citação para :17 e alinhar a lista de exceções com sintese-rest-vs-sync.md:28. Fazer isso no MESMO passo da correção de backend/CLAUDE.md:46, senão a wiki fica certa e a constituição errada, que é o estado atual.

### 136. qualidade-conexao-adaptativa.md

- **Tipo:** desatualizada · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/qualidade-conexao-adaptativa.md:19`
- **Código:** `backend/src/modules/collab/collab.handlers.js:219`

**Evidência.** A pagina diz que o unico freio contra spam e "a comparacao com a banda anterior (`backend/src/modules/collab/collab.handlers.js:218`)"; :218 e `const quality = classifyConnectionQuality(rtt);` e a comparacao esta em :219 (`if (quality === ws.qualityClass) return;`). Erro de uma linha, mas a pagina e curta e o resto das ancoras dela (:214, gateway :447, quality.js:44-48) esta correto, entao vale acertar.

**Ação.** Trocar :218 por :219.

### 137. README.md

- **Tipo:** desatualizada · **Fatia:** `estrutural`
- **Código:** `frontend/tests/`

**Evidência.** README.md, §Verificação, comenta `npm test` como "Vitest (114 arquivos, execução única)". A contagem real é 166 arquivos `*.test.js` sob frontend/tests/. Número cravado em prosa é recontagem que apodrece a cada teste novo, e apodreceu 52 arquivos atrás.

**Ação.** Remover a contagem (ou trocá-la por "execução única"); número de arquivos de teste não é informação que sobreviva a um commit.

### 138. backend/src/modules/streetview360/sv360.service.js (JSDoc)

- **Tipo:** divergência · **Fatia:** `be-sv360`
- **Documento:** `backend/src/modules/streetview360/sv360.service.js:239`
- **Código:** `backend/src/modules/streetview360/sv360.service.js:263`

**Evidência.** O JSDoc de resolveThumbnailPath declara `@returns {Promise<string|null>} absolute path to the {slug}.webp, or null` (sv360.service.js:239-240), mas a funcao retorna um objeto `{ filePath, projectStatus }` (:263) e o chamador ja desestrutura assim (sv360.controller.js:116-118). O segundo campo nao e cosmetico: e ele que decide o escopo de cache (public vs private+Vary), o comportamento que streetview-360.md:22 documenta como critico.

**Ação.** Corrigir o @returns para o shape real. Mesma familia das duas contradicoes ja marcadas em ingestao-projetos-360.md:23,25: comentario que ficou para tras de um fix e agora mente sobre o contrato interno.

### 139. comentario de contrato em backend/src/modules/collab/collab.gateway.js (unico call site de duas vias de toFrontendRole)

- **Tipo:** divergência · **Fatia:** `be-utils`
- **Documento:** `backend/src/modules/collab/collab.gateway.js:362-363`
- **Código:** `backend/src/utils/roles.js:14-18`

**Evidência.** O comentario que documenta o payload congelado `connected` diz: '`permission` (owner/write/read) is the frozen field; `role` exposes the frontend vocabulary (owner/editor/viewer/admin)'. Enumera 3 permissoes de 5 e 4 papeis de 6. A funcao logo abaixo (`roles.js:14-18`) produz tambem `manager` (de `manage`) e `commenter` (de `comment`), e o `permission` enviado vem de `requireAtlasPermission`, cujo dominio inclui `manage` e `comment`. E exatamente o padrao de lista fechada que a constituicao proibe e que ja causou bug real duas vezes silenciando o co-Gestor, agora sentado no comentario que define o contrato para quem implementa o cliente. [[permissoes-atlas]]:11 declara `toFrontendRole` a unica fonte da derivacao; o comentario ao lado do seu unico call site de duas vias subconta o que ela emite.

**Ação.** Corrigir o comentario para as cinco permissoes (read<comment<write<manage<owner) e os seis papeis, ou remover a enumeracao e apontar para utils/roles.js:12-19, que ja e a lista canonica.

### 140. docs/wiki/organizacoes-om.md

- **Tipo:** divergência · **Fatia:** `be-middleware`
- **Documento:** `docs/wiki/organizacoes-om.md:28 e :30`
- **Código:** `backend/src/middleware/auth.js:80-82 e :104-108`

**Evidência.** Deriva de ancora no arquivo mais citado da fatia, com as paginas ja divergindo entre si sobre o mesmo bloco. (a) `organizacoes-om.md:28` afirma que "o `auth` estrito faz early-return para qualquer `sub` que nao seja UUID (`backend/src/middleware/auth.js:78-80`)": as linhas 78-79 sao comentario e a guarda comeca em :80, com o `return next()` em :81; as outras tres paginas que descrevem a mesma isencao citam :80-82 (`autenticacao-jwt.md:17`, `auth-flexivel.md:33`, `jwt-emissor-unico.md:39`). (b) `organizacoes-om.md:30` ancora a nao-sobrescrita deliberada de `org_role`/`organization_id` em `auth.js:100-105`, mas o comentario que declara a decisao esta em :104-107 e a atribuicao que a implementa em :108; `autenticacao-jwt.md:11` e `sintese-eixos-de-permissao.md:13` citam corretamente :104-107 e :108. Nao ha erro de conteudo em nenhuma das duas frases, so a ancora escorregando, e o guarda `frontend/tests/unit/docs-integridade.test.js` nao pega isso (verifica existencia do caminho, nao a linha).

**Ação.** Ajustar as duas citacoes de `organizacoes-om.md` para :80-82 e :104-108, uniformizando com as demais paginas. Sem urgencia, mas vale fazer no mesmo passe das correcoes acima, ja que `middleware/auth.js` e o arquivo mais citado da fatia e ancora divergente entre paginas convida a corrigir a pagina errada quando o codigo mudar.

### 141. docs/wiki/upload-imagens-seguranca.md (linha 59) e o texto 'Maximum size: 10MB' na linha 25

- **Tipo:** divergência · **Fatia:** `be-images`
- **Código:** `backend/src/app.js:59-60; backend/src/config.js:68 e :72`

**Evidência.** A pagina fixa numeros que no codigo sao de ambiente: 'O parser JSON global e 10 MB; o lote ganha um parser dedicado de 50 MB' (linha 59) e cita a mensagem `File too large. Maximum size: 10MB` (linha 25). No codigo o global e literal `'10mb'` (backend/src/app.js:59), mas o do lote e `${config.images.maxBulkUploadMb}mb` (backend/src/app.js:60), lido de `MAX_BULK_UPLOAD_MB` com default 50 (backend/src/config.js:72), e o limite por imagem e `MAX_IMAGE_SIZE_MB` com default 10 (backend/src/config.js:68). Um deploy que ajuste qualquer das duas env vars torna a pagina errada em silencio, e ela nao avisa que sao defaults. (As demais ancoras da pagina conferem: images.service.js:12-14, :22-27, :38-41, :46, :47, :97-111, :142, :175, :202, :217; images.routes.js:35, :38, :51-62, :66; images.controller.js:16-18, :20, :54; images.schemas.js:12, :17; app.js:59-66; e 002_atlas.sql:313-315 e exato.)

**Ação.** Anotar os dois numeros como defaults e nomear as env vars: 'parser do lote = MAX_BULK_UPLOAD_MB (default 50 MB)' e 'limite por imagem = MAX_IMAGE_SIZE_MB (default 10 MB)'. Custo baixo, elimina a unica ancora da pagina que apodrece por configuracao em vez de por commit.

### 142. backend/src/modules/streetview360/sv360.merge.js (comentario)

- **Tipo:** link quebrado · **Fatia:** `be-sv360`
- **Documento:** `backend/src/modules/streetview360/sv360.merge.js:25`
- **Código:** `backend/src/database/migrations/001_core.sql:26-28`

**Evidência.** O comentario de DEFAULT_ORG_ID diz "Deterministic default org id (012_organizations.sql)". Essa migracao nao existe: backend/src/database/migrations/ tem 001_core a 005_sv360 e o seed da org default esta em 001_core.sql:26-28, como organizacoes-om.md:42 ja registra corretamente. Citacao morta dentro de codigo, invisivel ao docs-integridade (que so varre .md), e num arquivo que a wiki manda ler como fonte da constante.

**Ação.** Trocar a referencia para 001_core.sql:26-28.

### 143. docs/wiki/assets3d-distribuicao.md:17

- **Tipo:** link quebrado · **Fatia:** `be-nomes-zones`
- **Documento:** `docs/wiki/assets3d-distribuicao.md:17`
- **Código:** `backend/src/modules/config/config.service.js:186`

**Evidência.** A pagina cita 'a URL final e assets3dBaseUrl + url, servido pelo /api/config (backend/src/modules/config/config.service.js:150)'. A afirmacao esta certa, a linha nao: config.service.js:150 e o corpo de listOrganizacoesMilitares ('SELECT id, nome, sigla FROM organizations WHERE is_active = true ORDER BY nome'), sem relacao nenhuma com assets. assets3dBaseUrl e definido em backend/src/modules/config/config.service.js:186. A prova de que e drift e nao ambiguidade: catalogo-3d.md:20 cita o MESMO fato na linha correta (:186). Duas paginas divergem sobre a mesma ancora.

**Ação.** Trocar :150 por :186 em assets3d-distribuicao.md:17. De quebra, backend/src/app.js:68 na mesma pagina (:7, para o flexibleAuth global) aponta para o comentario; o app.use(flexibleAuth) esta em backend/src/app.js:70.

### 144. docs/wiki/atlas-modelo-de-dados.md

- **Tipo:** link quebrado · **Fatia:** `be-database`
- **Documento:** `docs/wiki/atlas-modelo-de-dados.md:22`
- **Código:** `backend/src/database/migrations/003_sync.sql:59`

**Evidência.** A citacao aponta 003_sync.sql:58 para a afirmacao sobre "SET current_version = NEW.server_version". A linha 58 e "UPDATE atlas"; o SET esta em :59. tabela-operations.md:24 cita o mesmo fato corretamente como :59, entao as duas paginas discordam por uma linha. O teste de integridade (frontend/tests/unit/docs-integridade.test.js) valida caminho e nao numero de linha, logo esse tipo de deriva apodrece sem quebrar nada.

**Ação.** Trocar :58 por :59 em atlas-modelo-de-dados.md:22.

### 145. docs/wiki/ingestao-projetos-360.md

- **Tipo:** link quebrado · **Fatia:** `be-sv360`
- **Documento:** `docs/wiki/ingestao-projetos-360.md:43`
- **Código:** `backend/src/config.js:83-95`

**Evidência.** A pagina cita `backend/src/config.js:69-81` como fonte de SV360_DB_DIR, SV360_TMP_DIR e SV360_MAX_UPLOAD_BYTES. Alem do prefixo morto, as linhas estao erradas: 69-81 e o fim do bloco images e todo o bloco assets3d; o bloco sv360 vive em backend/src/config.js:83-95 (dbDir :85, maxInflight :87, tmpDir :90, maxUploadBytes :94).

**Ação.** Trocar por `backend/src/config.js:83-95`.

### 146. docs/wiki/ingestao-projetos-360.md

- **Tipo:** link quebrado · **Fatia:** `be-boot`
- **Documento:** `docs/wiki/ingestao-projetos-360.md:43`
- **Código:** `backend/src/config.js:83-95`

**Evidência.** A secao Fontes cita `backend/src/config.js:69-81` para `SV360_DB_DIR`, `SV360_TMP_DIR` e `SV360_MAX_UPLOAD_BYTES`. Esse intervalo e o fim do bloco `images` mais o bloco `assets3d`; o bloco `sv360` com as tres variaveis e config.js:83-95. O prefixo `backend/src/` tambem nao e o caminho do repo (`backend/src/`), o que tira a citacao do alcance do guarda de integridade.

**Ação.** Corrigir para `backend/src/config.js:83-95`.

### 147. docs/wiki/organizacoes-om.md

- **Tipo:** link quebrado · **Fatia:** `be-users-orgs`
- **Documento:** `docs/wiki/organizacoes-om.md:26 e :9`
- **Código:** `backend/src/modules/collab/collab.gateway.js:132-134`

**Evidência.** Duas citacoes arquivo:linha nao apontam mais para o que dizem apontar. (a) :26 cita `collab.gateway.js:120-122` como evidencia de que "socket ja aberto fecha com codigo 4003 na reconciliacao periodica" por org desativada; hoje 120-124 e o bloco de comentario sobre desativacao de CONTA, e o fechamento por org migrou para :132-134. A citacao ainda cai dentro da funcao certa, mas aponta prosa em vez de codigo, e prosa sobre outro gatilho. (b) :9 cita `users.schemas.js:9-10` para sustentar que nomes geograficos sao gated por concessao de zona por usuario/grupo; essas linhas sao um comentario JSDoc dentro do schema de perfil, nao a implementacao. Citar comentario como evidencia de comportamento e a forma leve do `doc-sobre-codigo`: se o comentario apodrecer, a wiki apodrece junto sem que nada quebre.

**Ação.** Corrigir :26 para `collab.gateway.js:132-134` (fechamento por org) e, se quiser manter a mencao ao gate de conta, citar :128-131 separadamente. Em :9, trocar a ancora por codigo do modulo `zones`/`ng` (por exemplo a funcao `ng.fn_user_zone_geoms` usada em nomes.queries.js) em vez do comentario em users.schemas.js.

### 148. docs/wiki/sintese-cache-http-imutavel.md

- **Tipo:** link quebrado · **Fatia:** `be-sv360`
- **Documento:** `docs/wiki/sintese-cache-http-imutavel.md:20`
- **Código:** `backend/src/config.js:80`

**Evidência.** A pagina afirma que ASSETS_3D_MAX_INFLIGHT e SV360_MAX_INFLIGHT sao "ambos default 8, backend/src/config.js:65 e :71". Os reais sao :80 (ASSETS_3D_MAX_INFLIGHT) e :87 (SV360_MAX_INFLIGHT); a linha 65 esta em branco e a 71 e um comentario sobre o body limit de /images/bulk. O valor 8 esta certo, so as ancoras estao quebradas.

**Ação.** Corrigir para :80 e :87.

### 149. docs/wiki/sintese-capacidades-por-papel.md

- **Tipo:** link quebrado · **Fatia:** `be-utils`
- **Documento:** `docs/wiki/sintese-capacidades-por-papel.md:9`
- **Código:** `backend/src/modules/collab/collab.gateway.js:364-372`

**Evidência.** A pagina ancora a afirmacao central sobre a traducao da minha fatia ('O payload `connected` carrega **os dois** campos ... `role` e a traducao (utils/roles.js)') em `collab.gateway.js:343-352`. Esse intervalo contem hoje atribuicoes de propriedade do socket (`ws.isAlive`, `ws.cursorPosition`, `ws.currentMapId`) e o comentario do `createSession`. O `ws.send` do payload `connected`, com `permission` e `role: toFrontendRole(permission, user.role)` lado a lado, esta em :364-372.

**Ação.** Atualizar a citacao para collab.gateway.js:364-372.

### 150. docs/wiki/sintese-capacidades-por-papel.md

- **Tipo:** link quebrado · **Fatia:** `be-utils`
- **Documento:** `docs/wiki/sintese-capacidades-por-papel.md:53`
- **Código:** `backend/src/utils/roles.js:13`

**Evidência.** 'Admin global curto-circuita tudo: vira `admin` na traducao (backend/src/utils/roles.js:12)'. A linha 12 e a assinatura `export function toFrontendRole(permission, globalRole) {`; o curto-circuito e `if (globalRole === 'admin') return 'admin';` na linha 13. Off-by-one benigno, mas a pagina esta afirmando sobre uma linha especifica e o teste de integridade so verifica o caminho, nunca a linha.

**Ação.** Trocar para roles.js:13, ou citar o intervalo da funcao roles.js:12-19 como faz permissoes-atlas.md:11 (que esta correto).

### 151. docs/wiki/zonas-acesso-geografico.md

- **Tipo:** link quebrado · **Fatia:** `be-database`
- **Documento:** `docs/wiki/zonas-acesso-geografico.md:21`
- **Código:** `backend/src/database/migrations/004_ng.sql:246-257`

**Evidência.** A citacao e 004_ng.sql:246-259, mas o arquivo termina na linha 257 (o "$$;" que fecha ng.fn_user_zone_geoms). O intervalo aponta duas linhas alem do EOF. gazetteer-nomes-geograficos.md:52 cita a mesma funcao corretamente como :246-256.

**Ação.** Ajustar para :246-257 (ou :246-256, alinhando com a pagina irma).

### 152. sintese-limites-collab.md

- **Tipo:** link quebrado · **Fatia:** `be-collab`
- **Documento:** `docs/wiki/sintese-limites-collab.md:52`
- **Código:** `docs/wiki/fila-operacoes-outbound.md`

**Evidência.** A frase final do §6 termina com "Ver [[fila-operacoes-outbound]] e [[fila-operacoes-outbound]]": o mesmo wikilink duas vezes. Resolve, entao o guard passa; provavelmente o segundo deveria apontar para outra pagina (o contexto de poison batch pede [[ack-idempotencia]] ou [[modelo-conflito-lww]]).

**Ação.** Substituir a segunda ocorrencia pela pagina pretendida ou remove-la.

### 153. syncledger

- **Tipo:** link quebrado · **Fatia:** `be-sync`
- **Documento:** `docs/wiki/syncledger.md:40`
- **Código:** `backend/src/modules/sync/sync.service.js:5`

**Evidência.** O segundo [!CONTRADICAO] da pagina fica em aberto perguntando se o espelho de backend e `backend/src/utils/sync-trace.js` ou ebgeo_backend/src/modules/collab/trace/trace-stages.js (sem crase: caminho inexistente), e manda "confirme o caminho real no repo do backend". Confirmado agora: `backend/src/modules/collab/` tem seis arquivos (gateway, handlers, quality, rooms, service, index) e nenhuma subpasta `trace/`; o espelho real e backend/src/utils/sync-trace.js, importado por sync.service.js:5. O lado errado e o JSDoc do frontend em frontend/src/js/store/sync/diag/trace-stages.js:5-7, que aponta para o caminho morto. Esta e a unica citacao a arquivo inexistente em todo o corpus e o teste docs-integridade nao a pega porque ela vive dentro do bloco de citacao.

**Ação.** Resolver contra o codigo, como manda o wiki-schema: apagar o marcador, afirmar `backend/src/utils/sync-trace.js` como espelho e registrar em `## Historico`. Se a intencao for corrigir a raiz, o alvo e o JSDoc de trace-stages.js:7, nao a pagina.

### 154. docs/wiki (envelope plano do sv360, 7 paginas)

- **Tipo:** recontagem · **Fatia:** `be-sv360`
- **Documento:** `docs/wiki/streetview-360.md:14`
- **Código:** `backend/src/modules/streetview360/sv360-error.js:15-36`

**Evidência.** O mesmo fato (resposta nua + erro plano `{ error: "msg" }`, contra o `{ data }` / `{ error: { code, message } }` do resto da API) e reafirmado com redacao quase identica em sete paginas: streetview-360.md:14, ingestao-projetos-360.md:15, calibracao-e-grafo-360.md:55, sintese-modulos-fora-do-sync.md:24, sintese-contratos-congelados.md:17, sintese-cache-http-imutavel.md:41 e config-runtime-urls-relativas.md:51. O dono canonico e sintese-contratos-congelados; as outras seis pagam manutencao para repetir e sao seis lugares para divergir se o contrato mudar.

**Ação.** Manter a afirmacao completa so em sintese-contratos-congelados e reduzir as demais a wikilink. Baixa prioridade: hoje as seis concordam entre si e com sv360-error.js:15-36.

### 155. docs/wiki/sintese-rest-vs-sync.md

- **Tipo:** recontagem · **Fatia:** `be-sharing`
- **Documento:** `docs/wiki/sintese-rest-vs-sync.md:47`
- **Código:** `backend/src/modules/sharing/sharing.service.js:12-21,40`

**Evidência.** A assimetria camelCase (GET) versus snake_case cru (POST/PUT) do modulo sharing esta escrita duas vezes, com o mesmo raciocinio e ancoras equivalentes: docs/wiki/compartilhamento-atlas.md:33-35 ("Leitura e escrita falam dialetos diferentes", citando sharing.service.js:12-21) e docs/wiki/sintese-rest-vs-sync.md:47 ("A assimetria nao e visivel em nenhum dos dois arquivos isoladamente (sharing.service.js:12-21 versus :40)"). Verifiquei as duas ancoras: sharing.service.js:12-21 monta o objeto camelCase e :40 e o return rows[0] cru do RETURNING *, ambas corretas hoje. O problema e de manutencao: duas copias da mesma armadilha divergem com o tempo, e a wiki-schema pede uma pagina por conceito. api-rest-atlas.md:81 faz uma terceira mencao curta da mesma assimetria.

**Ação.** Manter a explicacao completa em compartilhamento-atlas.md:33-35 (pagina da entidade) e reduzir sintese-rest-vs-sync.md:47 e api-rest-atlas.md:81 a uma linha com wikilink [[compartilhamento-atlas]], sem repetir as ancoras arquivo:linha.
