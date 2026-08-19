# Síntese: decisões arquiteturais e não-objetivos

Quadro consolidado das escolhas que moldam o que o sistema pode e não pode fazer, e da razão de cada uma. Serve para não reabrir decisão fechada por engano; o detalhe de cada uma mora na página do assunto.

## O eixo central: o backend é aditivo

O produto nasceu local-first (IndexedDB + arquivos `.ebgeo`) e o backend foi acrescentado sem virar pré-requisito do caminho de edição. Login é capacidade extra, nunca porta de entrada.

Os mecanismos que sustentam isso não são disciplina de código, são gates concretos:

- `DEFAULT_ORIGIN` é `local` e vale para todo usuário pré-existente (`frontend/src/js/store/store-origin.js`), então a maquinaria remota só engata após um connect explícito. Ver [[dominio-local-vs-remoto]].
- O gate de papel só vale em atlas remoto conectado: `sessionContext.isOffline() || !isRemoteStoreSync()` libera tudo (`frontend/src/js/store/sync/permission-guard.js`). Sem isso, um usuário logado com papel global `viewer` não conseguiria desenhar no próprio store local. Ver [[permissoes-atlas]].
- O log/flush de operações é gated por conexão, então deslogado nada é transmitido. Ver [[fila-operacoes-outbound]].

### A exceção única e deliberada: bootstrap de config

O servidor **é** pré-requisito para o app *subir*. `GET /api/config` é fonte única de config e catálogo, e o boot é fail-fast: sem resposta, a tela "EBGeo indisponível" (`frontend/src/js/index.js`). Não existe config estático de reserva; o `config.js` embarcado é só o *shape* que o servidor hidrata.

**Armadilha de vocabulário:** onde a documentação diz "offline", leia **"sem login"**, não "sem servidor". O caminho "sem backend algum" não é mais suportado, e o caminho **anônimo com backend no ar** é o que os testes cobrem. Ver [[config-dinamico]] e [[config-runtime-urls-relativas]].

## LWW por ordem de chegada, não CRDT

A colaboração é **server-authoritative last-write-wins pela ordem de chegada ao servidor**, não por timestamp e não por merge de estrutura de dados. O relógio de Lamport viaja no envelope e **não decide conflito** algum.

**Por que não CRDT:** o custo de um CRDT verdadeiro (estrutura de dados, tamanho de metadados, complexidade de merge por propriedade) não se paga para o padrão de uso real, no qual duas pessoas raramente editam a mesma feição no mesmo segundo. O modelo escolhido é o do Google Docs em espírito (sem locks, ninguém trava ninguém), mas com autoridade central. O preço aceito é que a granularidade é a **feição inteira**: dois usuários editando propriedades diferentes da mesma feição não fazem merge. Detalhe em [[modelo-conflito-lww]], [[envelope-operacao]] e [[idempotencia-e-convergence-guard]].

O `locked` de mapa não contradiz isso: é **aviso de UI, frontend-only**, não um lock de concorrência.

## P12 caiu: o namespace por atlas existe (2026-08-15)

**Esta seção declarava "múltiplos atlas locais nomeados NÃO serão feitos", com namespacing por atlas no IndexedDB como refactor rejeitado. Deixou de valer.** O argumento da rejeição (a separação local↔remoto já está garantida pelo marcador de origem, então o namespace não traz ganho de princípio) foi vencido por um caso que o marcador não cobre: duas abas em atlas de SERVIDOR diferentes eram, com um scratch único, o mesmo conjunto de dez bancos. Isso não é contenção que um lock arbitre, é um endereço com dois donos.

O que existe hoje: um namespace por atlas no nome do banco (a fila de saída inclusa), um registro de atlas locais com teto de 10, e um expurgo do remoto derivado de registro, que POUPA o namespace montado por outro cliente vivo até um prazo. O que **não** existe: tela que TROQUE ou exclua um atlas local. Criar um tem um gesto só, o import de `.ebgeo` dentro de um atlas de servidor. Ver [[namespace-por-atlas]] e [[coordenacao-entre-abas]].

Dois corolários que causam bug se ignorados:

- O store guarda **um atlas por vez**. Trocar de atlas é destrutivo e ordenado: desconecta o anterior, limpa todo o store, conecta o novo. Não há merge implícito. Ver [[atlas-modelo-de-dados]].
- Mapas de atlas remoto são chaveados por **UUID**; o mapa local padrão `Principal` é chaveado por nome. Op cujo `mapId` de contexto não é UUID é descartada antes de entrar na fila, o que é ao mesmo tempo anti-vazamento e anti-poison-batch. Detalhe em [[tipos-entidade-sync]] e [[fila-operacoes-outbound]].

## Dado remoto é efêmero por decisão

Dado de atlas remoto vive no IndexedDB apenas enquanto conectado, e é apagado no logout/desconexão; um *boot guard* descarta dado remoto órfão encontrado com ninguém autenticado.

**O porquê:** dado remoto sobrevivendo ao logout seria editável offline sem sincronizar com ninguém. O usuário acharia que está colaborando quando estaria editando uma cópia morta. A regra de ouro operacional é: **baixe o `.ebgeo` antes de desconectar** se quiser guardar. Ver [[sessao-boot-e-ciclo-de-vida]] e [[formato-ebgeo-roundtrip]].

Isso amarra dois princípios de cobertura que valem como checklist ao adicionar qualquer tipo de dado persistido:

- **P9**: tudo que entra no `.ebgeo` precisa ter caminho de sincronização (sync ⊇ `.ebgeo`). Faltou caminho, é bug de cobertura.
- **P11**: round-trip `.ebgeo` → servidor → `.ebgeo` **por outro usuário** deve ser sem perda. Toda adição ao *transform* local→servidor exige a contrapartida em `applyRemoteSnapshot` mais um teste de fidelidade. Diferenças aceitáveis e intencionais: IDs remapeados para UUID, novo id de atlas, arredondamento de coordenadas no export. Ver [[snapshot-e-pull-incremental]] e [[aplicacao-operacoes-remotas]].

## Undo/redo é local por sessão, nunca sincroniza

Ctrl+Z desfaz só o que o **próprio** usuário fez. Op recebida de outro colaborador jamais entra na pilha de undo local: `remote-operation-handler` aplica sem registrar undo, e as pilhas são estado de UI por sessão. É o comportamento do Google Docs, e é uma decisão, não uma limitação a corrigir.

## Escrita de entidade só via sync (com exceções estruturais)

Não há rota REST de escrita para feature/layer/group/briefing/slide. Mutações viajam como operações; REST cuida de metadados de atlas, compartilhamento e imagens.

A formulação herdada, "escrita só via sync" para toda entidade do atlas, é ampla demais e precisa ser lida como **escrita incremental** só via sync. São **quatro** as escritas estruturais por REST (`mergeMaps`, `duplicateMap`, `cloneAtlas` e o bulk `importAtlas`), deliberadamente atômicas e por isso impróprias para uma sequência de ops. Delas, só o `merge` grava uma op marcadora e portanto aparece no pull incremental; as outras três dependem do frame de WebSocket, e quem estava desconectado pede a cauda, recebe lista vazia e conclui que está em dia. Ver [[sintese-rest-vs-sync]], que detalha o preço, mais [[sintese-rest-vs-websocket]], [[api-rest-atlas]], [[tabela-operations]] e [[clone-atlas]].

## WebSocket sem backplane, a limitação de escala aceita

O estado de salas e presença é um `Map` **em memória por processo** (`backend/src/modules/collab/collab.rooms.js`). Não há Redis, pub/sub ou backplane em lugar nenhum do backend, e o WS está acoplado ao mesmo processo HTTP, então nem dá para escalá-lo à parte.

Rodar 2 ou mais réplicas **quebra o broadcast cross-instância**: cursor, seleção, `operations` e `atlas_updated` não chegam a quem está em outra réplica. O durável continua no Postgres, então a perda numa horizontalização mal feita é **silenciosa**, não é erro. O mesmo defeito afeta o rate limiter (in-memory por instância, logo o limite multiplica pelo número de réplicas).

**Caminho de menor risco em produção: uma instância do backend (escala vertical).** Horizontalizar exige sticky sessions mais backplane **antes**, não depois. Ver [[canal-collab-websocket]], [[sintese-limites-collab]] e [[presenca-colaborativa]]; a compensação dentro da instância única (backpressure assimétrico entre presença e op durável) está em [[qualidade-conexao-adaptativa]].

## StreetView 360 absorvido

O 360 deixou de ser microsserviço separado e virou o módulo `sv360` do backend único. **Não existe mais upstream `:8081`.**

O preço da absorção foi manter um **contrato congelado**: as rotas do `sv360` respondem nuas e com envelope de erro plano, diferente do global. Quebrar isso quebra clientes existentes. Ver [[streetview-360]], [[sintese-contratos-congelados]], [[sintese-contrato-erros-http]] e [[erros-api]].

Decisão correlata de armazenamento: **BLOB pesado não vai para o Postgres**. Binários WebP do 360 ficam em SQLite por projeto (~41 GB no dataset real) e assets 3D em SQLite mais fallback de FS; o Postgres guarda metadado e ponteiro. O nome do `.db` é derivado server-side de `(orgId, slug)` e o `db_filename` do manifest do cliente é **ignorado**, como guard anti-overwrite cross-OM. Ver [[assets3d-distribuicao]], [[catalogo-3d]], [[calibracao-e-grafo-360]] e [[ingestao-projetos-360]].

## Persistência: JSONB e PostGIS coexistindo isolados por schema

Um banco, três schemas: `public` (atlas e features com geometria em **JSONB**, sem PostGIS), `ng` (gazetteer PostGIS, catálogo 3D, zonas) e `sv360`. PostGIS foi **aditivo**: não converteu o schema do atlas.

Armadilha de deploy: a migração que cria a extensão PostGIS é untrusted, exige superusuário e roda **incondicionalmente**. Logo **PostGIS é pré-requisito de qualquer deploy completo, mesmo um deploy só do atlas**. Ver [[deploy-backend]], [[gazetteer-nomes-geograficos]] e [[zonas-acesso-geografico]].

Migrações são **forward-only, sem rollback, rastreadas por NOME de arquivo**. Nunca renumere, renomeie ou reordene uma migração já aplicada; para corrigir defeito, adicione a próxima. A mesma convenção levou o schema de comentário a entrar **editando um baseline in-place**, não numa migração nova.

**Errata de 2026-08-19, e ela restringe a regra em vez de contradizê-la:** "nunca renomeie" vale a partir do momento em que a migração sai deste repositório. Enquanto nenhum banco de produção a aplicou, esmagar o histórico é legítimo e já aconteceu duas vezes; da segunda, 22 arquivos incrementais viraram 8 baselines por domínio, escritas no estado final do schema. O que a regra protege é o banco que JÁ rodou os nomes antigos, e esse banco não é upgradável: ele precisa ser recriado, e o próprio schema o recusa com mensagem própria em vez de um erro de DDL. Ver [[deploy-backend]].

No cliente vale o mesmo princípio, com um encadeamento próprio de versões no boot. **Invariante de migração: atualizar o app nunca pode apagar ou tornar inacessível um atlas que já estava em operação.**

## Identidade: um único emissor de JWT

Há **um** emissor de token, este backend, e ele carrega dois eixos ortogonais: papel global e identidade org-scoped. Como agora o **mesmo processo** valida o token, sumiu o problema de "alinhar dois serviços"; o custo remanescente são os aliases mantidos por compatibilidade com o que o 360 lia, e a degradação de token legado sem claim de org. Ver [[autenticacao-jwt]], [[jwt-emissor-unico]], [[refresh-token-rotacao]], [[auth-flexivel]] e [[organizacoes-om]].

A permissão por atlas é um **terceiro** eixo, resolvido em waterfall (owner, depois share, depois público, senão 403), na hierarquia `owner > manage > write > comment > read`. Ver [[sintese-eixos-de-permissao]] e [[sintese-capacidades-por-papel]].

## Decisões menores com consequência grande

- **Link público = somente leitura, e "acesso geral" = só o link.** Não há papel por organização concedido implicitamente; convidar é sempre share explícito por usuário. Decisão de produto para um GIS sensível. O token do link expira em ~1h e o visitante público **não recebe comentários**. Ver [[link-publico]] e [[compartilhamento-atlas]].
- **Visualizador não recebe comentários do servidor**: é **filtro de transmissão** (snapshot e broadcast não enviam), não esconde-UI. Ver [[comentario-espacial]].
- **"A permissão padrão abaixa, nunca eleva"**: convite concede Leitura por padrão; elevar é ação deliberada.
- **Config por atlas é interseção, nunca expansão**: um `atlas.settings` só desliga o que o deploy suporta, jamais liga o que não existe, e é revertido ao desconectar. Ver [[atlas-settings]], [[resources-catalogo]] e [[modos-operacao]].
- **Sem snapshot automático do mapa** nos cards do Atlas Drive: a faixa colorida com iniciais (cor determinística do nome) é a identidade padrão, e desde 2026-08-16 o usuário pode pôr uma **capa** no lugar dela (`PUT /atlas/:id/cover`, gate `write`). A recusa de 2026-07-25 media as duas coisas pelo envelhecimento, que só vale para o snapshot: imagem escolhida por alguém envelhece quando essa pessoa quiser. Ver [[api-rest-atlas]].
- **Mídia do catálogo embutida em base64** no config, porque não há static público no backend e `deploy/` é protegido.
- **Ex-dono vira Gestor** na transferência de propriedade, transação atômica, nunca existe estado "sem dono". Ver [[clone-atlas]] e [[gestao-usuarios]].
- **Sem CI no GitHub** no backend: nada roda lint/test/build em PR. Não há rede de segurança no servidor, rode local antes de publicar a imagem.
- **Observabilidade de sync é test/dev only**: o SyncLedger é env-gated e em produção é branch morto, com cross-check `!config.isProd` para o caso de `EBGEO_TRACE=1` vazar. Ver [[syncledger]].
- **Imutabilidade de cache** é padrão carregado: imagens, assets 3D e thumbnails 360 são `immutable` com ETag O(1)/304/Range; tiles MVT do 360 são `max-age=60` porque mudam a cada ingestão. Ver [[sintese-cache-http-imutavel]], [[imagens-atlas]] e [[upload-imagens-seguranca]].

## O que fica fora do sync

Gazetteer, catálogo 3D, assets e panoramas 360 são **REST read-only** sobre PostGIS, com autorização embutida na própria query SQL. A consequência dupla: **não existe caminho de UI que contorne a autorização**, e também não existe push de invalidação, então mudança de zona não derruba resultado já entregue. Ver [[sintese-modulos-fora-do-sync]], [[ranking-busca-toponimos]], [[hardening-borda-api]] e [[zonas-acesso-geografico]]; superfícies vizinhas em [[sync-admin-operacoes]], [[atlas-import-offline]], [[api-keys]], [[auditoria]], [[client-id-estavel]] e [[modulo-temporal]].

## Não-objetivos declarados (lista curta)

1. ~~Múltiplos atlas locais nomeados no IndexedDB (P12)~~ **caiu em 2026-08-15** (ver a seção acima): a persistência os suporta, o produto ainda não os expõe.
2. CRDT verdadeiro com merge por propriedade.
3. Locks de edição, ninguém bloqueia ninguém.
4. Undo/redo global ou sincronizado.
5. Backend como pré-requisito de qualquer ação de edição, salvo o bootstrap de config.
6. Escala horizontal do WebSocket sem backplane.
7. PMTiles e GeoJSON-como-fonte no 360 (descontinuados; não provisionar tippecanoe).
8. Suporte a lista de origens em CORS (uma única origem, `credentials:true`, então `'*'` não funciona).
9. Rate limit global entre réplicas (store in-memory, por instância).
