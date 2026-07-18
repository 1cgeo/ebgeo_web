# Formato .ebgeo e fidelidade de round-trip

O `.ebgeo` é o contêiner portável do trabalho local, sujeito a duas invariantes: tudo que entra nele precisa ter caminho de sincronização (P9) e o ciclo .ebgeo → servidor → .ebgeo, mesmo feito por outro usuário, deve ser sem perda (P11).

## Por que o formato existe

Localmente existe **um** só espaço de trabalho no IndexedDB (P12). "Vários projetos" não são vários atlas nomeados, são vários arquivos `.ebgeo`; atlas nomeado é capacidade de servidor (ver [[atlas-modelo-de-dados]], [[dominio-local-vs-remoto]]). Daí decorre a regra de ouro operacional: dado de atlas remoto é efêmero no cliente, então **baixe o `.ebgeo` antes de desconectar**. "Salvar projeto" enquanto conectado exporta o estado remoto atual, e é a forma suportada de tirar uma foto de um atlas do servidor.

O XOR sobre o ZIP (prefixo `EBGXOR`) é **máscara, não criptografia**. Não trate como proteção nem construa nada em cima disso.

## Contratos que não podem quebrar

- **A chave do arquivo é o nome do mapa; a chave do repositório remoto é UUID.** O export só funciona porque `getAllMapNamesStore` resolve UUID → nome. Ao mexer no exportador, nunca assuma que a chave do store é a chave do arquivo.
- **Validar antes de destruir.** No import não-aditivo o `clearAllDataStore()` roda **depois** de parsear e validar versão (`frontend/src/js/import_export/export-import.service.js:598-610`). Subir esse clear faria um arquivo corrompido apagar o projeto do usuário.
- **Ids são desconflitados pelo cliente, não pelo servidor** (`frontend/src/js/import_export/export-import.service.js:648-655`). O servidor não resolve nada; a propagação aos pares só acontece porque `addMap`/`addFeature` enfileiram operações normalmente.
- **`'default'` é um id de camada que colide entre mapas.** O mapper de camada é por mapa, de propósito (`frontend/src/js/import_export/local-atlas-to-server.js:288`). Um mapper global fundiria as camadas default de todos os mapas em uma só.

## As três armadilhas de perda silenciosa

O padrão comum: no export/import, o erro não aparece como erro, aparece como **dado que sumiu**.

1. **Todo getter opcional tem `try/catch` individual.** Uma falha não aborta o export, apenas **omite a chave**. Ao adicionar um dado novo, um bug seu chega ao usuário como perda, não como stack trace.
2. **Checagem de "vazio" com a estrutura errada.** `getMapGroups` devolve objeto simples, não `Map`; um check antigo por `.size` era sempre falso e derrubava **todos** os grupos de **todo** `.ebgeo`.
3. **Exportar só o que está "ativo" perde configuração.** O temporal é exportado quando **qualquer** campo difere do default, não quando `ativo` é true (`frontend/src/js/import_export/export-import.service.js:1113-1119`), senão um mapa em modo relativo mas desligado perde `origem`/`modo`/`unidade`/limites. Ver [[modulo-temporal]].

Perda **aceita** e intencional: coordenadas arredondadas a 6 casas (cerca de 1 m), ids internos remapeados para UUID e o id novo do atlas. Todo o resto tem que bater.

## Emitir evento não é persistir

Camadas, grupos, 3D, 360 e comentários chegam **inline** no mapa do snapshot, mas todo leitor (exportador, layer manager, overlay) lê de **side-stores dedicadas**. Os handlers incrementais gravavam nelas; o caminho de snapshot não gravava, e o resultado era um atlas puxado que re-exportava sem camadas/3D/360. Hoje `applyRemoteSnapshot` persiste cada uma explicitamente (`frontend/src/js/store/sync/remote-operation-handler.js:1176-1210`).

A armadilha simétrica é permanente: **nenhum assinante de `GROUP_*`/`LAYER_*` grava no repositório**. Todo caminho inbound precisa escrever antes de emitir. Ver [[aplicacao-operacoes-remotas]], [[snapshot-e-pull-incremental]].

Esse é também o motivo de P11 ser verificado com **dois usuários** (`frontend/tests/e2e-ui/browser-p11-roundtrip.spec.js`): a falha desse tipo é invisível para quem exportou, e só aparece no segundo usuário, o modo mais caro de descobrir.

## Lacunas conhecidas de P9/P11

- **Comentários offline se perdem no "Salvar no servidor".** Entram e voltam no `.ebgeo` e voltam do snapshot, mas o payload de mapa em `frontend/src/js/import_export/local-atlas-to-server.js:304-326` não tem campo de comentário. Comentário criado **ao vivo** sincroniza normal, pela via de operação; comentário criado offline e enviado em lote some. Ver [[comentario-espacial]].
- **Ícone customizado SVG não sobe.** O exportador do `.ebgeo` aceita `image/svg+xml` (`frontend/src/js/import_export/export-import.service.js:231`), a allowlist do upload não (`frontend/src/js/import_export/save-local-atlas.service.js:19`). O SVG é contado como `skipped` e o `markerSymbol` fica apontando para um id sem blob no servidor. Ver [[imagens-atlas]].
- **O conjunto `usedImages` do ZIP é amplo**, não uma lista de imagens: entra o `properties.id` de **toda** feição (`frontend/src/js/import_export/export-import.service.js:463`). Ids sem blob apenas falham no `getImage` e são ignorados. Não leia esse conjunto como inventário.
- Import aditivo tem teto de **100 mapas no total** (`frontend/src/js/import_export/export-import.service.js:624-625`), o que surpreende quem faz merge repetido.

> [!CONTRADICAO 2026-07-18] O JSDoc de `frontend/src/js/import_export/local-atlas-to-server.js:252-255` descreve um uso em **duas passadas** (chamar sem `imageIdMap`, subir as imagens, chamar de novo com o mapping). O chamador real em `frontend/src/js/import_export/save-local-atlas.service.js:98-105` faz **uma passada só** e resolve pelo lado oposto, subindo os blobs com o id do cliente preservado. O suporte a `meta.imageIdMap` continua no código, mas nenhum caminho de produção o usa.

> **Nota histórica.** O guia *visao-e-principios* (absorvido) afirma que o comentário espacial "entra no `.ebgeo` (P9) e faz round-trip (P11)". Isso só é verdade pela via de operação ao vivo.

## Checklist ao adicionar um dado persistido novo

A cobertura de sync tem que ser **superconjunto** da cobertura do `.ebgeo`. Se um dado é persistido e exportado mas não tem tipo de entidade em [[tipos-entidade-sync]], é bug de cobertura, não feature futura.

1. Entrou no `.ebgeo`? Adicione no exportador **e** nos dois importadores (aditivo e não-aditivo).
2. Tem operação outbound ([[fila-operacoes-outbound]], [[envelope-operacao]]) e apply inbound ([[aplicacao-operacoes-remotas]]) **e** snapshot ([[snapshot-e-pull-incremental]])? Senão, P9 quebrado.
3. O `applyRemoteSnapshot` grava na side-store que o exportador lê? Senão, P11 quebra só no segundo usuário.
4. Precisa de UUID? Adicione ao transform local→servidor, incluindo referências cruzadas.
5. Cubra com o e2e de round-trip, não só com unit test do transform.

Ver também [[atlas-import-offline]], [[api-rest-atlas]], [[compartilhamento-atlas]], [[sintese-decisoes-arquiteturais]] e [[modos-operacao]].

## Fontes

Guias absorvidos: *visao-e-principios* (P9, P11, P12 e a regra de ouro do dado remoto efêmero), *acoes-interface-multiusuario* (a expectativa não cumprida de desconflito de ids no servidor). Código: `import_export/{export-import.service,local-atlas-to-server,save-local-atlas.service}.js`, `store/sync/remote-operation-handler.js`, `frontend/tests/e2e-ui/browser-p11-roundtrip.spec.js`.
