# Formato .ebgeo e fidelidade de round-trip

O `.ebgeo` é o contêiner portável do trabalho local, sujeito a duas invariantes: tudo que entra nele precisa ter caminho de sincronização (P9) e o ciclo .ebgeo → servidor → .ebgeo, mesmo feito por outro usuário, deve ser sem perda (P11).

## Por que o formato existe

Localmente "vários projetos" continuam sendo vários arquivos `.ebgeo`. Isto era o não-objetivo P12 e virou um fato de produto sem ser mais uma decisão: a persistência suporta N atlas locais nomeados desde 2026-08-15 ([[namespace-por-atlas]]), e o único gesto que cria um é justamente o import descrito abaixo. **Nenhuma tela TROCA de atlas local**, então o usuário continua sem caminho de volta ao slot anterior (ver [[atlas-modelo-de-dados]], [[dominio-local-vs-remoto]]).

**Importar com um atlas de servidor aberto SAI daquele atlas.** O import não-aditivo escreveria no escopo ATIVO, e com namespace por atlas isso é `ebgeo_*__remote-<id>`: o projeto importado nasceria dentro do namespace que o próximo logout destrói, e sumiria sem erro (antes do namespace ele caía no banco legado e sobrevivia). Então o import cria um atlas LOCAL novo e troca para ele (`switchToNewLocalAtlas`, `frontend/src/js/account/open-atlas.service.js`), avisando o usuário em pt-BR de que o projeto do servidor foi fechado e continua intacto. Duas consequências que só se veem cruzando arquivos: **criar vem primeiro** porque é o único passo recusável (teto de 10 atlas locais) e o único não destrutivo, então bater no teto custa zero ao usuário, com o socket ainda de pé; e o import **aditivo** continua recusado dentro de um atlas de servidor, porque "somar" ali significaria criar mapas, camadas e feições no projeto do servidor, o que exige permissão de escrita e uma rodada de sync por entidade. Ver [[namespace-por-atlas]].

A regra de ouro operacional continua: dado de atlas remoto é efêmero no cliente, então **baixe o `.ebgeo` antes de desconectar**. "Salvar projeto" enquanto conectado exporta o estado remoto atual, e é a forma suportada de tirar uma foto de um atlas do servidor.

O XOR sobre o ZIP (prefixo `EBGXOR`) é **máscara, não criptografia**. Não trate como proteção nem construa nada em cima disso.

## Contratos que não podem quebrar

- **A chave do arquivo é o nome do mapa; a chave do repositório remoto é UUID.** O export só funciona porque `getAllMapNamesStore` resolve UUID → nome. Ao mexer no exportador, nunca assuma que a chave do store é a chave do arquivo.
- **Validar antes de destruir.** No import não-aditivo o `clearAllDataStore()` roda **depois** de parsear o ZIP e validar a versão contra `MIN_SCHEMA_VERSION`/`ATLAS_SCHEMA_VERSION` (`frontend/src/js/import_export/export-import.service.js`). Subir esse clear faria um arquivo corrompido apagar o projeto do usuário.
- **Ids são desconflitados pelo cliente, não pelo servidor.** O import aditivo resolve colisão de nome de mapa, monta o `layerIdMapping` e chama `regenerateMapIds` **antes** de gravar (`frontend/src/js/import_export/export-import.service.js`). O servidor não resolve nada; a propagação aos pares só acontece porque `addMap`/`addFeature` enfileiram operações normalmente.
- **`'default'` é um id de camada que colide entre mapas.** Ele é mapeado para si mesmo dentro de cada mapa, e o mapper de camada do transform local→servidor é por mapa, de propósito (`frontend/src/js/import_export/local-atlas-to-server.js`). Um mapper global fundiria as camadas default de todos os mapas em uma só.
- **`idMapping` (feição antiga → nova) não é descartável.** Os grupos do mapa ainda referenciam os ids ANTIGOS das feições e importariam vazios sem ele.

## As três armadilhas de perda silenciosa

O padrão comum: no export/import, o erro não aparece como erro, aparece como **dado que sumiu**.

1. **Todo getter opcional tem `try/catch` individual.** Uma falha não aborta o export, apenas **omite a chave**. Ao adicionar um dado novo, um bug seu chega ao usuário como perda, não como stack trace.
2. **Checagem de "vazio" com a estrutura errada.** `getMapGroups` devolve objeto simples, não `Map`; um check antigo por `.size` era sempre falso e derrubava **todos** os grupos de **todo** `.ebgeo`.
3. **Exportar só o que está "ativo" perde configuração.** O temporal é exportado quando **qualquer** campo difere de `DEFAULT_TEMPORAL_CONFIG`, não quando `ativo` é true (`frontend/src/js/import_export/export-import.service.js`), senão um mapa em modo relativo mas desligado perde `origem`/`modo`/`unidade`/limites. Ver [[modulo-temporal]].

Perda **aceita** e intencional: coordenadas arredondadas a 6 casas (cerca de 1 m), ids internos remapeados para UUID e o id novo do atlas. Todo o resto tem que bater.

## Emitir evento não é persistir

Camadas, grupos, 3D, 360 e comentários chegam **inline** no mapa do snapshot, mas todo leitor (exportador, layer manager, overlay) lê de **side-stores dedicadas**. Os handlers incrementais gravavam nelas; o caminho de snapshot não gravava, e o resultado era um atlas puxado que re-exportava sem camadas/3D/360. Hoje `applyRemoteSnapshot` persiste cada uma explicitamente (`frontend/src/js/store/sync/remote-operation-handler.js`).

A armadilha simétrica é permanente: **nenhum assinante de `GROUP_*`/`LAYER_*` grava no repositório**. Todo caminho inbound precisa escrever antes de emitir. Ver [[aplicacao-operacoes-remotas]], [[snapshot-e-pull-incremental]].

Esse é também o motivo de P11 ser verificado com **dois usuários** (`frontend/tests/e2e-ui/browser-p11-roundtrip.spec.js`): a falha desse tipo é invisível para quem exportou, e só aparece no segundo usuário, o modo mais caro de descobrir.

## Lacunas conhecidas de P9/P11

- **Comentários offline se perdem no "Salvar no servidor".** Entram e voltam no `.ebgeo` e voltam do snapshot, mas o payload de mapa que o transform monta (`frontend/src/js/import_export/local-atlas-to-server.js`) não tem campo de comentário. Comentário criado **ao vivo** sincroniza normal, pela via de operação; comentário criado offline e enviado em lote some. Ver [[comentario-espacial]].
- **Ícone customizado SVG não sobe.** O exportador do `.ebgeo` aceita `image/svg+xml`, a allowlist do upload não (`ALLOWED_IMAGE_MIME`, `frontend/src/js/import_export/atlas-image-upload.js`). O SVG é contado como `skipped` e o `markerSymbol` fica apontando para um id sem blob no servidor. Ver [[imagens-atlas]].
- **O conjunto `usedImages` do ZIP é amplo**, não uma lista de imagens: entra o `properties.id` de **toda** feição (`frontend/src/js/import_export/export-import.service.js`). Ids sem blob apenas falham no `getImage` e são ignorados. Não leia esse conjunto como inventário.
- Import aditivo tem teto de **100 mapas no total**, o que surpreende quem faz merge repetido.

**O `meta.imageIdMap` não tem chamador.** Ele sobrou de um desenho antigo, em duas passadas, que o JSDoc de `local-atlas-to-server.js` ainda descrevia. O caminho de produção é uma passada só: `frontend/src/js/import_export/save-local-atlas.service.js` sobe os blobs preservando o id do cliente. Procurar por ele para entender o fluxo leva a um mapeamento que ninguém preenche.

## Checklist ao adicionar um dado persistido novo

A cobertura de sync tem que ser **superconjunto** da cobertura do `.ebgeo`. Se um dado é persistido e exportado mas não tem tipo de entidade em [[tipos-entidade-sync]], é bug de cobertura, não feature futura.

1. Entrou no `.ebgeo`? Adicione no exportador **e** nos dois importadores (aditivo e não-aditivo).
2. Tem operação outbound ([[fila-operacoes-outbound]], [[envelope-operacao]]) e apply inbound ([[aplicacao-operacoes-remotas]]) **e** snapshot ([[snapshot-e-pull-incremental]])? Senão, P9 quebrado.
3. O `applyRemoteSnapshot` grava na side-store que o exportador lê? Senão, P11 quebra só no segundo usuário.
4. Precisa de UUID? Adicione ao transform local→servidor, incluindo referências cruzadas.
5. Cubra com o e2e de round-trip, não só com unit test do transform.

Ver também [[atlas-import-offline]], [[api-rest-atlas]], [[compartilhamento-atlas]], [[sintese-decisoes-arquiteturais]] e [[modos-operacao]].
