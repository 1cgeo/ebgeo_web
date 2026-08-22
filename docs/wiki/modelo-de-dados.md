# Modelo de dados: revisão do ER

Revisão transversal dos quatro schemas do banco (`public`, `ng`, `sv360` e o `_migrations` do runner), procurando duplicidade de conceito, coluna sem escritor, tabela sem leitor e relação sem FK. Complementa [[atlas-modelo-de-dados]], que cobre o domínio do atlas em profundidade e não sai dele.

## Como isto foi medido, e o que a medida não alcança

A MEDIÇÃO É ANTERIOR À CONSOLIDAÇÃO das migrações, e os números abaixo refletem o schema daquele momento: um banco limpo foi criado e migrado pelas 22 migrações de então (hoje são 8 baselines por domínio, e o schema que elas produzem é o mesmo menos o que os achados 1, 2 e 3 derrubaram: o catálogo 3D do `ng` com as duas tabelas de permissão de modelo, as duas tabelas de grupo daquele schema com o subsistema de zonas inteiro, a tabela de edificações e o eixo de acesso do gazetteer). A estrutura veio de `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_proc` e `pg_trigger`, nunca da leitura dos arquivos `.sql`: prosa de migração descreve a intenção, e o que vale é o que ficou de pé. Números da estrutura: **49 tabelas, 441 colunas, 161 índices, 62 chaves estrangeiras, 13 funções e 5 triggers próprios**.

O uso foi medido por três caminhos independentes, porque nenhum deles sozinho decide:

1. **Extração dos escritores**, varrendo todo `INSERT INTO <tabela> (...)` e `UPDATE <tabela> SET ...` de `backend/src`, `backend/scripts` e `dev/`, e casando o conjunto de colunas escritas contra o conjunto de colunas existentes. Isto acha o buraco, e produz falso positivo em três famílias que a próxima etapa remove.
2. **Triagem manual dos falsos positivos**, que são de quatro tipos e valem como método para quem repetir a medida: escritor **dinâmico** (nome de tabela interpolado, como `listCatalog` sobre as quatro tabelas de catálogo), escritor por **cláusula montada em array** (o `buildUpdateQuery` do sync empurra `updated_at = NOW()` e `version = version + 1` como elementos, não como texto SQL), escritor **trigger** (quatro colunas nascem assim) e escritor **DEFAULT** (a coluna é preenchida sem ninguém a nomear). Grep sozinho classifica os quatro como "sem escritor", e erra nos quatro.
3. **Estatística de execução do banco real**, lendo `pg_stat_all_indexes` e `pg_stat_all_tables` do banco preservado por `npm run test:keep-db` depois da suíte inteira de backend (3249 casos, zero falhas, zero skips). Isto responde uma pergunta que a leitura não responde: quais índices o planner de fato escolheu alguma vez.

**O teto da medida 3, declarado para ninguém a ler como mais do que é:** as tabelas do banco de teste são pequenas, e num universo pequeno o planner prefere varredura sequencial mesmo onde o índice serviria. `idx_scan = 0` sozinho **não** prova índice morto. Ele só vale como evidência quando anda junto com o argumento estrutural, ou seja, quando nenhuma consulta do repositório tem a forma que aquele índice serve. As duas coisas foram exigidas juntas em toda recomendação de remoção de índice abaixo, e onde só uma delas existe a recomendação é medir, não remover.

---

## Estado desta revisão: o que JÁ foi executado

Esta página foi escrita como revisão, para o dono ler e decidir. Os três primeiros achados foram
autorizados e executados na mesma fase, e cada um carrega seu desfecho no corpo:

- **Achado 1 (dois catálogos de modelo 3D): FEITO.** O catálogo do schema `ng`, as duas tabelas de
  permissão de modelo, a rota e as consultas saíram; o importador foi repontado para `tilesets`.
- **Achado 2 (dois resolvedores de acesso): FEITO, pela saída que não estava na mesa.** Não sobrou
  o que unificar: o eixo de acesso do `ng` saiu inteiro, e com ele a pergunta de produto sobre o
  `credenciado`.
- **Achado 3 (eixo de grupo sem escritor): FEITO, e nas duas metades.** As tabelas de grupo do `ng`
  e o subsistema de zonas que as consumia saíram; conceder a um coletivo renasceu no schema da
  aplicação, com entidade, membros e alvo de concessão.

**Todo o resto desta página segue sendo recomendação, não histórico.** Nenhum outro achado foi
executado, e um deles (o 14) foi decidido ao contrário do que esta página recomendava, com o motivo
registrado lá: a fase que produziu esta revisão executou apenas o que a especificação autorizou por
escrito, e uma revisão que se auto-executa deixa de ser revisão.

---

## 1. Dois catálogos de modelo 3D, e o app usa um só

**O que era.** `ng.catalogo_3d` (schema `ng`, 21 colunas, chave UUID, busca full-text própria) e `tilesets` (schema `public`, chave textual, `config` JSONB) descreviam a mesma coisa: um acervo de modelos 3D com URL, posição, orientação e miniatura.

**Evidência.** `tilesets` é servida no `/api/config` e é o que o visualizador resolve; ela carrega o eixo de acesso das fases F8 a F14 (`access_level`, `owner_org_id`, `resource_grants`, `atlas_resources`). `ng.catalogo_3d` saía por `GET /nomes/catalogo3d` e tinha **zero consumidores no frontend**: a varredura de `frontend/src` por `catalogo3d` não devolvia nada. O próprio `backend/src/modules/nomes/assets3d-regime.js` a registrava como buraco nomeado do censo de acesso, com o motivo escrito ("é um SEGUNDO catálogo de modelos 3D, com sua própria coluna `url` e seu próprio eixo de acesso"). As duas populações vêm de fontes diferentes: `dev/import-gazetteer.mjs` alimenta a do `ng` a partir do backup do gazetteer, e `dev/import-config-catalog.mjs` alimenta `tilesets` a partir do config legado, o que faz delas dois acervos e não duas cópias.

**Custo de deixar como está.** Todo eixo novo de acesso precisa ser implementado duas vezes ou declarado buraco uma vez, que é exatamente o que a F8 fez. Um modelo marcado privado no catálogo vivo continua público no catálogo dormente, e a tela que os separa não existe.

**Recomendação: SAI AGORA, e já SAIU, em 2026-08-19.** O catálogo do `ng` não foi recriado no schema consolidado, e com ele foram embora as duas tabelas de permissão de modelo, a rota `/nomes/catalogo3d`, o controller, o service, o schema Joi e o par de consultas que duplicava o predicado. O ramo do acervo 3D em `dev/import-gazetteer.mjs` foi **repontado para `tilesets`**, convertendo a forma da linha na passagem, de modo que o acervo continua carregável no catálogo que sobreviveu. Uma variante ficou sem rótulo próprio (a nuvem de pontos vira tileset, que é o carregador certo), e isso está declarado em [[resources-catalogo]] como buraco conhecido em vez de resolvido no chute. Ver também [[resources-catalogo]].

---

## 2. Dois resolvedores de acesso a recurso, e o do `ng` não conhecia o `credenciado`

**O que era.** O sistema tinha dois predicados de "quem vê o quê", com vocabulários de papel **diferentes**, e a diferença não era de estilo: era uma lista fechada em SQL, a mesma classe que a constituição proíbe no cliente. O eixo de `public` resolve por função composta (`fn_has_global_data_access`, somada em `fn_can_see_resource` ao ramo de produção `fn_can_produce_resource` e ao de concessão `fn_granted_resource_ids`); o do `ng` resolvia por CTE escrita à mão dentro de cada consulta, com o teste de papel global cravado como `role = 'admin'` e copiado verbatim em quatro lugares.

**Custo, que é a parte transportável.** O papel `credenciado`, cuja definição inteira na migração `backend/src/database/migrations/001_identidade.sql` é "LÊ todo recurso privado do sistema e NÃO ESCREVE NADA", não enxergava nada de privado no `ng`, e ninguém recebia erro: a resposta era uma lista bem formada, só que menor. Predicado copiado à mão é lista fechada, e cada cópia envelhece sozinha.

**Desfecho (2026-08-19), e não foi nenhuma das duas saídas que estavam na mesa.** Não sobrou resolvedor para unificar nem motivo para escrever ao lado do predicado. O catálogo do `ng` saiu com o achado 1, e o eixo de acesso do gazetteer (a marca de privacidade na linha, o índice parcial que a servia e o predicado inteiro da busca, com o parâmetro de usuário) saiu por decisão de produto: **busca de topônimo não tem restrição de acesso**. A lição sobreviveu no eixo que ficou, onde o predicado nasce como **função SQL**, uma definição só, chamada de dentro das consultas. Ver [[acesso-a-recurso-privado]], [[gazetteer-nomes-geograficos]] e [[sintese-eixos-de-permissao]].

---

## 3. O eixo de permissão por grupo não tinha como ser alimentado, e sustentava uma regra viva

**O que era.** O `ng` tinha duas tabelas de agrupamento de usuário e nenhuma rota que as escrevesse: a varredura de escritores não achou um `INSERT` sequer em `backend/src`, `backend/scripts` ou `dev/`, só em arquivos de teste, e o Painel do Administrador nunca teve aba de grupos. Isso já seria peso morto, mas elas não estavam isoladas: a **membership** era o elo do meio do ramo de grupo da autorização espacial, e esse lado tinha escritor. Ou seja, o administrador podia conceder uma zona a um grupo em que ninguém podia estar, e aquele ramo do predicado nunca devolveu linha em produção. O mesmo elo faltante matava o ramo de grupo do catálogo do `ng`.

**Custo, e é a lição que vale além do caso.** Uma concessão que a interface aceita, o banco grava e a autorização nunca honra é a forma mais cara de erro de permissão, porque o operador tem prova de que fez o certo. Meio eixo não é meio recurso, é recurso que mente, e a consolidação tornou o custo visível: um schema esmagado **recria** cada tabela por escolha, não por inércia forward-only.

**Desfecho (2026-08-19).** Este achado foi o que decidiu a remoção: o subsistema de zonas saiu inteiro, com as duas tabelas de grupo do `ng`, e a ideia de conceder a um COLETIVO renasceu no schema da aplicação, com FK de verdade para `users` e com as DUAS metades presentes (entidade, membros e alvo de concessão). A segunda metade, a que faz o mecanismo existir, só chegou com a superfície escrita em 2026-08-19: ver [[acesso-a-recurso-privado]] e [[grupo-de-acesso]].

---

## 4. `users.org_role`: o terceiro vocabulário de permissão, removido em 2026-08-20

**Resolvido.** A seção descrevia um campo vivo e terminava recomendando a remoção; ela aconteceu (D7), e o que fica aqui é o registro, porque a forma do defeito reaparece sempre que dois eixos compartilham palavras.

**O que era.** Três vocabulários descreviam "o que esta pessoa pode fazer". Hoje são dois:

- `users.role`: `user`, `producer`, `credenciado`, `admin`. Papel global, **não é escada**.
- `atlas_shares.permission`: `read`, `comment`, `write`, `manage`, mais o dono implícito. Papel por atlas, **é escada**. Desde 2026-08-21 o alvo da linha é uma pessoa OU um grupo de acesso (`num_nonnulls(user_id, group_id) = 1`), e quem resolve o nível efetivo é `fn_user_atlas_shares`, pelo MÁXIMO entre os caminhos.
- ~~`users.org_role`: `owner`, `admin`, `editor`, `viewer`. Papel dentro da OM.~~ A coluna SAIU do sistema, e depois da consolidação do schema ela não chega a nascer: `backend/src/database/migrations/001_identidade.sql` diz por extenso, no lugar onde ela morava, por que a ausência é decisão.

**O defeito, e ele não estava no servidor.** Nenhuma decisão de autorização do backend lia o campo desde a fase F6, quando a escrita do 360 passou a ler `producer_org_id`. Quem o lia era o cliente: `sessionUserInfoFromMe` (`frontend/src/js/store/sync/session-context.js`) hidratava a sessão com o papel POR ATLAS tirado dele. Os conjuntos não coincidiam (o eixo de OM não tinha `manager` nem `commenter`, e tinha `admin`, que o eixo por atlas não tem), mas os dois valores mais altos se escreviam com as MESMAS palavras (`owner` e `admin`), então o crachá de OM virava papel de atlas sem conversão nenhuma. Um usuário com `org_role = 'admin'` e nenhuma permissão em atlas nenhum abria o app desenhado como Administrador de atlas, e cada botão desses falhava no servidor. Afordância que mente, não brecha; a janela ia do boot até o `connect`.

**Por que remover em vez de consertar o sítio.** Consertar a hidratação deixaria de pé uma coluna com nome de papel, e a frase que esta seção já trazia continua sendo a razão: enquanto ela existir, alguém vai gatear por ela. Hoje a hidratação começa em Leitor e o único a abrir o eixo é o servidor, no payload de `connect`. Ver [[sintese-capacidades-por-papel]], [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

---

## 5. `active_sessions`: uma tabela inteira sem escritor, e a consolidação tira o argumento que a manteve

**O que é.** Nove colunas, dois índices, uma UNIQUE, duas FKs, e nenhuma linha jamais escrita por código de produção.

**Evidência.** A varredura de escritores não achou `INSERT` nem `UPDATE` em `active_sessions` em lugar nenhum de `backend/src`. A estatística do banco real confirma pelo outro lado: depois da suíte inteira, `n_tup_ins = 1` (um caso de teste), `active_sessions_pkey` e `idx_sessions_heartbeat` com `idx_scan = 0`. A presença viva é o `Map` em memória de `backend/src/modules/collab/collab.rooms.js`. A migração `backend/src/database/migrations/004_sync.sql` documenta a remoção das duas chamadas em 2026-07-25 e diz por que a tabela ficou: "migração é forward-only e aditiva".

**Custo de deixar como está.** O custo declarado na própria 003 é o certo ("coluna viva pela metade engana MAIS que coluna ausente"), e ele continua valendo. O custo novo é outro: **o argumento que a manteve era a regra forward-only, e a consolidação a suspende por autorização do dono.** Num schema esmagado, recriar `active_sessions` é uma escolha deliberada de criar uma tabela morta.

**Recomendação.** **Decidir na F15.** A pergunta não é "podemos apagar", é "vamos ressuscitar". A 003 já diz o caminho de ressurreição na ordem certa ("começa pelo LEITOR, não pelo INSERT"), e enquanto não houver leitor a tabela é peso. Sugestão: **não recriar**, e registrar em [[presenca-colaborativa]] que a presença é em memória por decisão, com o link para esta seção. Se o dono quiser presença durável, ela volta com leitor no mesmo commit.

---

## 6. `comments.lng` e `comments.lat`: escritas uma vez, nunca atualizadas, nunca lidas

**O que é.** As duas colunas de coordenada do pino do comentário espacial são promovidas do JSONB `comments.data`, e o dado vive nos dois lugares.

**Evidência.** O `INSERT` de comentário em `backend/src/modules/sync/sync.service.js` grava `data.lng` e `data.lat` nas colunas **e** grava o payload inteiro em `data`. O `UPDATE` de comentário grava só `data` e `status`: **as colunas nunca são atualizadas**. Do lado da leitura, `GET_ATLAS_COMMENTS` (`backend/src/modules/sync/sync.queries.js`) seleciona `lng, lat`, mas o montador do snapshot espalha `...c.data` e depois sobrescreve **apenas** `id`, `mapId`, `parentId`, `status` e `authorId` a partir das colunas. `lng` e `lat` ficam valendo o que veio do JSONB. Nenhuma outra consulta do repositório lê as duas colunas, e não há índice espacial sobre elas.

**Custo de deixar como está.** Duas colunas que só podem divergir e que ninguém consulta. O risco não é hipotético: no dia em que alguém escrever uma consulta espacial sobre `comments` (o "quais comentários caem neste enquadramento" é uma pergunta natural), ela vai ler a coordenada **do momento da criação**, e um comentário movido responderá do lugar errado.

**Recomendação.** **Decidir na F15, com duas saídas defensáveis e uma proibida.** Ou as colunas saem (o JSONB é a verdade, como já é de fato), ou o `UPDATE` passa a mantê-las e o montador do snapshot passa a preferi-las, como já faz com `status` e `authorId` pelo motivo escrito ali. A saída proibida é a de hoje: manter as duas sem escritor de atualização e sem leitor. Ver [[comentario-espacial]].

---

## 7. `maps.analysis_layers`: o portador aberto cuja irmã foi derrubada

**O que é.** JSONB livre em `maps`, publicado cru por quatro superfícies, e o único irmão do bloco JSONB da baseline de atlas que sobreviveu à queda de `maps.catalog_layers`.

**Evidência.** A auditoria já está escrita, e por extenso, no cabeçalho de `MAP_COLUMNS` (`backend/src/modules/maps/maps.queries.js`) e no de `backend/src/modules/sync/free-field.schemas.js`. O resumo verificável: nada valida o interior (o schema de sync declara `data`/`changes` como objeto desconhecido, e o de atlas declara `analysis_layers` como objeto sem chaves, que `stripUnknown` não poda); o único produtor vivo escreve **estado de alternância**, não definição (`frontend/src/js/import_export/local-atlas-to-server.js`); e o vizinho da linha seguinte daquele mesmo enviador passa por `pruneCatalogLayerDefinition` justamente porque upload de entidade inteira contorna o gate de escrita, enquanto `analysis_layers` não ganhou equivalente.

O que fecha hoje é a poda por conteúdo em `backend/src/modules/catalog/resource-payload.prune.js`, aplicada em toda saída JSON e em todo `ws.send`, e não a lista de colunas.

**Custo de deixar como está.** Um portador cujo fechamento depende de um filtro de saída em vez de não existir dado para filtrar. O `free-field.schemas.js` explica por que ele não é fechável por validação (os testes de contrato congelam valores aninhados dentro dele, do domínio da grade) e diz, com todas as letras, que esvaziá-lo é pergunta de `DROP COLUMN`, não de validação.

**Recomendação.** **Fica, com motivo escrito, e o motivo é o do `free-field.schemas.js`.** Esta fase não deve derrubá-lo: ao contrário de `maps.catalog_layers`, ele tem contrato de cliente congelado apontando para dentro. O que a F15 deve fazer é **não perder a prosa** na consolidação: o comentário de `002_atlas.sql` sobre o bloco JSONB é justamente o tipo de material que a Parte 2 tem de preservar.

---

## 8. `operations.entity_id` é UUID, e o domínio não é todo UUID

**O que é.** A chave da entidade no log é `UUID NOT NULL`, e duas famílias de entidade não têm chave UUID.

**Evidência.** `catalog_layers.id` é TEXT desde a migração `backend/src/database/migrations/003_atlas.sql`, e os ids reais são `hillshade`, `data-<slug>`, `3d-<slug>`. As ops de nível de atlas chegam com o sentinela `'atlas'`. Nos dois casos o `INSERT` do log substitui a chave pela do atlas, guardado por `FEATURE_UUID_RE` (`backend/src/modules/sync/sync.service.js`). A consequência está escrita no cabeçalho de `backend/src/modules/sync/catalog-layer-op.js`: um podador chaveado por `entityId` "casa nada numa linha armazenada, e é cobertura que não cobre nada".

**Custo de deixar como está.** `idx_operations_entity`, sobre `(entity_type, entity_id)`, não responde "o histórico desta camada de catálogo": todas as camadas de um atlas colidem no mesmo valor. E qualquer código futuro que chaveie por `entityId` no log herda o mesmo verde vazio. A estatística do banco real dá o tamanho da perda pelo outro lado: `idx_operations_entity` foi escaneado **5 vezes** na suíte inteira, contra 690 de `idx_operations_atlas_version` e 1362 de `operations_atlas_op_id_uniq`.

**Recomendação.** **Fica agora, decide depois, e o registro é o entregável.** Alargar `entity_id` para TEXT é o mesmo alargamento já feito duas vezes nesta casa (a 006 e a 020) e pelo mesmo motivo (o id do domínio nunca foi UUID), mas ele mexe no log, que é a estrutura mais quente do sistema, e a fase que o fizer precisa de repro próprio. O que **não** deve acontecer é o alargamento entrar de carona na consolidação: a Parte 2 promete estado final idêntico, e trocar o tipo desta coluna é mudança de comportamento disfarçada de arrumação. Ver [[tabela-operations]].

---

## 9. `ranks.code`: coluna lida, servida e sem escritor fora da semente

**O que é.** `ranks.code SMALLINT` sai em toda resposta do módulo (`LIST_RANKS`, `FIND_RANK`, e no `RETURNING` de `INSERT_RANK` e `UPDATE_RANK`, todos em `backend/src/modules/ranks/ranks.queries.js`), e nenhum desses comandos a escreve. Nem o schema Joi a aceita.

**Evidência.** `INSERT_RANK` escreve `(nome, nome_abrev, sort_order)`. `UPDATE_RANK` escreve `nome`, `nome_abrev`, `sort_order`, `is_active`, `updated_at`. O único escritor de `code` no repositório é o `INSERT` de semente da migração `backend/src/database/migrations/001_identidade.sql`, cujo comentário diz que ele veio de `dominio.tipo_posto_grad` e que `code` virou `sort_order`.

**Custo de deixar como está.** Um posto criado pelo Painel do Administrador nasce com `code` nulo enquanto os dezenove semeados têm valor, e o cliente recebe os dois pela mesma chave. Ou seja: um campo que parece identificador de domínio, é nulo em metade das linhas, e para as outras metade é redundante com `sort_order` (a semente atribuiu os mesmos números aos dois).

**Recomendação.** **Sai agora, ou ganha escritor agora.** Se `code` é o código do domínio militar de origem, ele precisa entrar no schema de criação e no `UPDATE`, e aí deixa de duplicar `sort_order`. Se ele era só um andaime de importação, sai da tabela e das quatro projeções. Manter é servir um campo que mente em metade das linhas. Ver [[gestao-usuarios]].

---

## 10. Doze índices sobre a chave primária filtrada por bandeira, e sete deles nunca podem servir

**O que é.** Uma família inteira de índices parciais tem a forma `ON <tabela>(id) WHERE <bandeira>`. Ela se dividia em três grupos na medida, e só um deles tem argumento; o terceiro grupo (três índices "público" do `ng`) saiu em 2026-08-19 junto com as tabelas e a coluna que ele indexava.

**Evidência.**

- **Sete "não deletado"**: `idx_atlas_not_deleted`, `idx_maps_not_deleted`, `idx_layers_not_deleted`, `idx_groups_not_deleted`, `idx_features_not_deleted`, `idx_briefings_not_deleted`, `idx_slides_not_deleted`. Todas as consultas que os motivariam filtram pelo **pai** e adicionam `deleted_at IS NULL` como filtro secundário (`WHERE map_id = $1 AND deleted_at IS NULL`), nunca pelo `id`. Medido diretamente: com 40.000 feições, 20 mapas e 5% de soft-delete, o plano de `GET_MAP_FEATURES` é `Bitmap Index Scan on idx_features_map` com `Filter: (deleted_at IS NULL)`, e **continua sendo o mesmo com `enable_seqscan = off`**. O planner não tem como usar um índice cuja coluna líder a consulta não restringe. O contraexemplo mora no mesmo banco: `idx_catalog_layers_map` e `idx_comments_map` são `(map_id) WHERE deleted_at IS NULL`, que é a forma certa, e os dois aparecem com dezenas de scans na estatística real.
- **Cinco "privado" do catálogo**: `idx_tilesets_private`, `idx_basemaps_private`, `idx_data_layers_private`, `idx_analysis_layers_private`, `idx_sv360_projects_private`. **Estes têm argumento**, escrito ao lado deles no schema, e a estatística real os confirma nos dois que têm acervo de teste (`idx_tilesets_private` com 41 scans, `idx_basemaps_private` com 53, `idx_sv360_projects_private` com 94).

Fora da família, dois índices GIN com custo de manutenção alto e nenhuma consulta na forma que servem: `idx_features_properties` (GIN sobre `features.properties`, e **nenhuma** consulta do repositório usa `@>`, `->` ou `?` sobre `properties`) e `idx_audit_details_gin` (idem para `audit_trail.details`, e `LIST_AUDIT` filtra por `action`, `actor_id`, `target_type` e `target_id`, nunca por `details`). Os dois com `idx_scan = 0`.

**Custo de deixar como está.** Escrita. Um GIN sobre JSONB é o índice mais caro de manter da lista, e `features` é a tabela mais escrita do sistema (1040 inserções na suíte, e em produção é uma por gesto de desenho). Os sete "não deletado" custam uma entrada de índice por linha viva em sete tabelas quentes, para nunca serem lidos. Nada disso aparece como lentidão de consulta, que é por que sobreviveu.

**Recomendação.** Três decisões distintas, e a gravidade também é distinta:

- **Sai agora:** os sete `*_not_deleted` sobre `(id)`. A prova é direta e reprodutível (o plano não muda nem com varredura sequencial desabilitada). Onde o soft-delete precisa de índice, a forma é `(<pai>_id) WHERE deleted_at IS NULL`, que já existe em duas tabelas.
- **Sai agora, com controle negativo:** `idx_features_properties` e `idx_audit_details_gin`. Aqui a evidência estrutural é forte (nenhuma consulta tem a forma) e a de execução concorda, mas o controle negativo é barato: derrube e confirme que nenhum plano muda.
- **Fica:** os cinco do lado privado, pelo motivo já escrito ao lado deles no schema.

---

## 11. Dois eixos de disponibilidade de recurso por atlas, com semânticas opostas

**O que é.** `atlas.settings.available_*` (quatro listas dentro do JSONB) e a tabela `atlas_resources` respondem à mesma pergunta de tela ("que recursos este atlas oferece") com regras invertidas.

**Evidência.** A 017 escreve a distinção por extenso: `settings.available_*` é **restritivo** com "vazio igual a sem restrição" (contrato congelado), e `atlas_resources` é **ampliativo** com "vazio igual a não empresta nada". Os dois estão vivos: o restritivo é montado em `frontend/src/js/modals/atlas-settings.modal.js` e aplicado em `frontend/src/js/store/sync/atlas-settings.service.js`; o ampliativo é o segundo braço de `fn_granted_resource_ids`.

**Custo de deixar como está.** O administrador vê **duas** superfícies para o mesmo recurso, e o efeito de marcar uma não é o inverso de marcar a outra. Um recurso privado emprestado por `atlas_resources` e ausente de `available_3d_models` continua invisível, e nada explica isso na tela.

**Recomendação.** **Fica, com o motivo já escrito ao lado da tabela**, porque a mesma estrutura não carrega as duas semânticas e o lado restritivo é contrato congelado. O que falta é do lado da tela, não do schema: a interface que edita os dois precisa dizer qual é qual. Registrar aqui e em [[atlas-settings]]; ver [[acesso-a-recurso-privado]].

---

## 12. Três contadores de versão no atlas, e duas fontes para um deles

**O que é.** `atlas.version`, `atlas.current_version` e `atlas.min_version` medem coisas diferentes (já documentado em [[atlas-modelo-de-dados]]), e `current_version` tem **duas** fontes de verdade.

**Evidência.** A coluna é mantida pelo trigger `update_atlas_current_version` a cada `INSERT` em `operations`, e é lida por `GET_ATLAS_SYNC_INFO`; o mesmo número é **calculado** por `GET_CURRENT_VERSION` (`COALESCE(MAX(server_version), 0)`) para produzir o `serverVersion` do ack do push. A duplicidade é conhecida e **guardada**: `backend/tests/integration/sync-version-cursor.test.js` existe exatamente para amarrar as duas, e o cabeçalho dele explica o modo de falha.

O custo, que ainda não estava medido, aparece na estatística do banco real: `public.atlas` fecha a suíte com **527 inserções e 1981 atualizações**, contra 1291 inserções em `operations`. Ou seja, cada operação de sync reescreve a linha do atlas, que é larga (carrega o `settings` JSONB inteiro).

**Recomendação.** **Fica, com motivo escrito e com o número acima anotado.** O trigger é o que torna a decisão snapshot-contra-incremental barata, e trocá-lo por `MAX()` moveria custo do push para todo `connect`. O que a F15 deve fazer é registrar a medida, para que a próxima pessoa que investigar inchaço de `atlas` encontre a causa em vez de procurá-la.

---

## 13. Dois mecanismos para bytes de imagem

**O que é.** `images` guarda metadado no Postgres e os bytes no sistema de arquivos (`images.storage_path`, resolvido em `backend/src/modules/images/images.service.js`). `atlas_covers` guarda os bytes no Postgres, em `BYTEA`.

**Evidência.** A migração `backend/src/database/migrations/003_atlas.sql` justifica a **tabela** separada (evitar que a capa viaje nos quatro `SELECT a.*` que quatro telas provocam) e justifica `BYTEA` contra data URI, mas não justifica o meio de armazenamento divergente do vizinho. As duas têm o mesmo CHECK de mime (`png`, `jpeg`, `webp`, sem `svg`), com larguras de coluna diferentes (`VARCHAR(100)` contra `VARCHAR(20)`).

**Custo de deixar como está.** Baixo, e é honesto dizer isso. O custo real é operacional: um backup do Postgres leva as capas e não leva as imagens, e quem restaurar o banco vai encontrar `images` apontando para caminhos que podem não existir. Isso não está escrito em lugar nenhum.

**Recomendação.** **Fica, e ganha a linha que falta**: qual dos dois meios é o padrão para bytes novos, e que o backup do banco não é backup completo das imagens. Ver [[imagens-atlas]].

---

## 14. `audit_trail`: quatro tipos de alvo declarados sem emissor

**O que é.** O CHECK de `target_type` declara treze valores e quatro nunca são emitidos.

**Evidência.** `ALVOS_SEM_EMISSOR` (`backend/tests/unit/auditoria-censo.test.js`) já os censa por nome: `GROUP`, `MODEL`, `STREETVIEW_MARKER` e `SYSTEM`. Dois deles se explicam por este documento: `MODEL` era o alvo do catálogo de modelo do `ng` e `GROUP` era o das tabelas de grupo daquele schema, ou seja, são a sombra dos achados 1 e 3. `STREETVIEW_MARKER` ficou órfão quando a tabela homônima foi apagada, e a baseline de auditoria (`backend/src/database/migrations/002_auditoria.sql`) registra a decisão de deixá-lo.

**Custo de deixar como está.** Baixo e já contido pelo censo.

**Desfecho (2026-08-19), e ele contraria a recomendação que esta seção fazia.** A recomendação era não redeclarar `MODEL` e `GROUP` num CHECK que nasce do zero. A consolidação declarou os quatro assim mesmo, com o motivo ao lado da coluna: vocabulário reservado é diferente de vocabulário esquecido, e linha de trilha já gravada pode carregar o valor. O que ela **não** redeclarou foi `ZONE`, e é aí que mora a armadilha, porque a assimetria não é gratuita: `ZONE` teve emissor enquanto o subsistema existiu, então uma trilha exportada antes de 2026-08-19 **não reentra** num banco criado pela baseline nova. Ver [[auditoria]].

---

## 15. Seis colunas de calibração 360 escritas, servidas e sem consumidor

**O que é.** O modelo relativo de marcador do 360 abandonou a geometria de distância e altura, e as colunas ficaram.

**Evidência.** `sv360.photos.camera_height`, `sv360.photos.distance_scale`, `sv360.photos.marker_scale`, `sv360.targets.override_distance` e `sv360.targets.override_height` são escritas na ingestão (`backend/src/modules/streetview360/sv360.merge.js`) e servidas pelas consultas de leitura (`backend/src/modules/streetview360/sv360.queries.js`). No frontend, a varredura por cada uma devolve **apenas comentários** dizendo que o campo saiu: `frontend/src/js/calibration/calibration-panel.js`, `frontend/src/js/calibration/state.js`, `frontend/src/js/street_view_tool/street_view_viewer.js` e os dois `projector.js`. `override_bearing` é o único da família que ainda tem leitor real, e ele lê só a **nulidade** (`frontend/src/js/calibration/minimap.js` monta um distintivo "tem override"), nunca o valor. A regra `.claude/rules/common-tasks.md` já registra `override_height` como coluna sem leitor.

**Custo de deixar como está.** Elas viajam em toda resposta de foto e de alvo, e o operador de calibração que as encontrar no JSON vai supor que ajustá-las muda o desenho. Foi exatamente esse o caminho que a regra da casa manda não perseguir.

**Recomendação.** **Sai depois, fora da F15.** Elas são dado de origem preservado de uma ingestão que ainda roda, e removê-las mexe no ETL e no manifesto. O que a F15 deve fazer é registrar as seis aqui e em [[streetview-360]], porque a regra hoje nomeia uma só. Antes de remover, confirmar com o dono se o acervo bruto ainda precisa carregá-las.

---

## Inventário A: a lista completa de colunas sem escritor

O método está na seção de medição, e o que segue é o resultado dele **depois** da triagem dos quatro tipos de falso positivo. "Sem escritor" aqui significa: nenhum `INSERT`, `UPDATE`, trigger, DEFAULT não trivial, importador ou semente de `backend/src`, `backend/scripts` ou `dev/` a preenche. Escrita **apenas por teste** conta como sem escritor, e está marcada.

**Sem escritor nenhum em produção na medida (25 colunas, 5 tabelas; as quatro tabelas marcadas abaixo saíram depois):**

| tabela | colunas | situação |
|---|---|---|
| `active_sessions` | as 9 (`id`, `user_id`, `atlas_id`, `client_id`, `connected_at`, `last_heartbeat`, `cursor_position`, `current_map_id`, `selected_features`) | morta. Achado 5. Escrita só por um caso de teste |
| as duas tabelas de grupo do `ng` | as 5 de uma, as 2 da outra | vivas pela metade, escritas só por teste. Eram o elo que faltava ao ramo de grupo das zonas. Achado 3, e **saíram** com ele em 2026-08-19 |
| as duas tabelas de permissão de modelo do `ng` | as 4 de cada uma | mortas, e **saíram** com o achado 1 em 2026-08-19 |
| `ranks.code` | 1 | legítima e sem escritor **ainda**, ou morta. Achado 9. É a única desta lista que já é SERVIDA ao cliente |

**Sem escritor de atualização (escritas na criação e nunca mais), 2 colunas:** `comments.lng` e `comments.lat`. Achado 6. Também sem leitor, o que as põe nos dois inventários.

**Preenchidas só por DEFAULT, e isso é legítimo (não listadas uma a uma):** todo `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` do repositório, todo `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` e `operations.server_version` (`nextval`). São 43 colunas, e nenhuma é achado.

**Preenchidas por TRIGGER, que é o falso positivo que mais engana (4 colunas):** `slides.is_broken` e `slides.broken_reason` (`mark_slides_broken_on_map_delete`), `sv360.photos.geom` (`fn_photos_set_geom`) e `ng.nomes_geograficos.tipo_peso` (`calcular_tipo_peso`). Um grep por qualquer uma delas nas consultas devolve zero e parece achado. **Não são.**

**Preenchidas só pelo importador de acervo, e isso é o desenho (30 colunas na medida):** todas as de `ng.nomes_geograficos` e as da tabela de edificações, escritas por `dev/import-gazetteer.mjs` com lista de colunas montada em tempo de execução. A primeira é dado de referência legítimo; a segunda saiu em 2026-08-19, com a rota que a servia.

**Preenchidas por escritor dinâmico (36 colunas):** as das quatro tabelas de catálogo, escritas por `listCatalog` e vizinhas com o nome da tabela interpolado a partir de `CATALOG_TABLES` (`backend/src/modules/catalog/catalog.service.js`), mais `access_level`, escrita por `setCatalogAccessLevel`. Nenhuma é achado.

**Preenchidas por cláusula montada em array (28 colunas):** `version`, `updated_at` e `deleted_at` das sete entidades de sync (`maps`, `layers`, `groups`, `features`, `briefings`, `slides`, `cesium3d_data`, `streetview360_data`), escritas por `buildUpdateQuery` e pelos comandos de soft-delete de `backend/src/modules/sync/sync.service.js`. Nenhuma é achado.

---

## Inventário B: o mapa das relações que existem só por convenção

Trinta e duas colunas de referência não tinham chave estrangeira na medida (cinco delas saíram em 2026-08-19 com as tabelas do `ng`, e são justamente as da família 5). Elas se dividem em cinco famílias, e o que segura cada uma é diferente. Reunir tudo sob "faltou FK" é o erro de leitura que este inventário existe para impedir.

**Família 1: ausência DELIBERADA, com motivo escrito no schema, e acrescentar a FK é regressão.**

| coluna | o que a segura |
|---|---|
| `features.layer_id` | Nada, e é o ponto. A migração `002_atlas.sql` explica em vinte linhas: op chega por ordem de chegada num log, não em ordem topológica, então a FK viraria `23503` envenenando o lote inteiro e travando a fila daquele cliente para sempre. O cliente degrada mostrando a feição fora de camada |
| `resource_grants.resource_id`, `atlas_resources.resource_id` | Polimorfismo. Quatro tabelas alvo com tipos de chave diferentes, e o Postgres não tem FK polimórfica. A órfã é contida por catálogo ser soft-delete e pelo único hard-delete apagar as concessões na mesma transação (017) |
| `audit_trail.actor_id`, `audit_trail.target_id` | Nada, deliberadamente: a trilha precisa sobreviver ao `DELETE` do usuário e do alvo. `target_id` é TEXT para caber slug e chave textual |
| `sv360.deleted_photos.photo_id` | Nada: é lápide, e a linha da foto pode já ter sumido |
| `operations.entity_id`, `operations.map_id` | Nada: log de aplicação. Ver o achado 8 para o outro problema desta coluna |

**Família 2: referência a valor de catálogo por TEXTO, sem FK possível ou desejada.**

| coluna | aponta para | o que a segura |
|---|---|---|
| `maps.base_layer` | `basemaps.id` | Nada. O DEFAULT `'carta-topografica'` casa com uma linha semeada, e é só isso. Um basemap removido do catálogo deixa mapas apontando para o vazio |
| `cesium3d_data.tileset_id` | `tilesets.id` | Nada. A 015 registra que é assim de propósito: um tileset removido deixa marcador e medição existindo sem catálogo |
| `slides.model_id` | `tilesets.id` | Nada. O slide de briefing referencia modelo por `modelId` |
| `slides.photo_id` | `sv360.photos.id` | Nada. Mesma família |
| `sv360.projects.entry_photo_id` | `sv360.photos.id` | Nada, e a 005 diz por quê: a foto pode não existir no momento da ingestão |

Nesta família o que **de fato** protege o usuário é o `is_broken` de `slides`, e ele só cobre um dos quatro casos (mapa apagado), por trigger.

**Família 3: referência a recurso externo ao banco.**

`images.storage_path` (caminho no sistema de arquivos), `sv360.projects.db_filename` (o SQLite por projeto) e `config_settings.key` (a chave textual `app_config`). Nada as segura, e nada pode: o alvo não está no Postgres. Ver achado 13 para a consequência de backup.

**Família 4: identificador de cliente, opaco por contrato.**

`operations.client_id`, `operations.op_id`, `active_sessions.client_id`. São TEXT de formato livre por decisão, porque o cliente é a autoridade sobre esses ids. A unicidade que importa é garantida por índice (`operations_atlas_op_id_uniq`), não por FK.

**Família 5: ausência que parecia esquecimento, e era.** As cinco colunas desta família moravam nas tabelas de grupo e de permissão de zona do `ng`: nenhuma tinha FK para `users(id)`, e a consequência era uma concessão sem titular identificável no dia em que o usuário fosse apagado de verdade. Sobra dela uma linha, que é de outra natureza:

| coluna | deveria apontar para | situação |
|---|---|---|
| `atlas.map_order`, `briefings.slide_order`, `active_sessions.selected_features` | arrays de UUID | FK impossível sobre array. `map_order` e `slide_order` carregam ordenação e são mantidos pela aplicação; nada impede um id fantasma na lista |

**Desfecho da família 5 (2026-08-19).** A recomendação era simples e foi **cumprida onde o conceito sobreviveu**: quando conceder a um coletivo renasceu no schema da aplicação, as colunas de participação nasceram com FK para `users(id)` e `ON DELETE CASCADE`, e as de autoria (`created_by`, `added_by`) com FK e **sem** `ON DELETE`, que é a mesma regra de `resource_grants.granted_by` e `atlas_shares.added_by`: autoria não se apaga, se reatribui. A regra a transportar para a próxima tabela de permissão: participação cascateia, autoria fica.

---

## O que esta revisão deliberadamente NÃO propõe

Nenhuma remoção além da que a especificação da F15 autoriza. Em particular, e para que o silêncio não seja lido como aprovação:

- **`ng.nomes_geograficos` fica inteira.** Ela não tem escritor em `backend/src` e isso é o desenho: é dado de referência alimentado por ETL e servido em leitura. (A tabela de edificações caiu depois, com a rota que a servia, e não por este critério.)
- **`sv360.targets.override_bearing` não entra na lista de remoção** do achado 15, porque tem leitor, ainda que só da nulidade. Medir o valor e medir a existência do valor são coisas diferentes.
- **A distinção entre `atlas.settings.available_*` e `atlas_resources` não é para ser unificada** (achado 11), e a 017 já explica por quê.
- **`maps.analysis_layers` não é para cair junto com `maps.catalog_layers`** (achado 7), e a diferença é contrato de cliente congelado apontando para dentro dele.

---

## Histórico

- 2026-08-19: página criada como entregável da Parte 1 da fase F15 (revisão do ER), medida contra o banco real migrado pelas 22 migrações e contra a estatística de execução da suíte de backend (3249 casos, verde, zero skips).
- 2026-08-19, depois da remoção: os achados 2 e 3 tinham metade do texto no presente sobre objetos que a própria fase apagou, e a recomendação binária do 3 continuava viva depois de decidida. Os dois viraram desfecho, e as linhas dos dois inventários que apontavam para as tabelas de zona e de grupo do `ng` saíram com elas. O que a página conserva desses achados é a lição (predicado copiado é lista fechada; meio eixo de permissão mente), não o objeto.
