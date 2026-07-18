# Modos de operação do cliente: anônimo, autenticado e público

Os três modos não saem de uma flag: emergem do cruzamento de dois estados independentes (identidade e origem do store), e o modo público quebra o predicado que todo mundo usa para testar conexão.

## Os dois eixos (nenhum deles é "o modo")

1. **Identidade** (`store/sync/session-context.js`): OFFLINE ou ONLINE, mais o marcador `_isVisitor`.
2. **Origem do store** (`store/store-origin.js`): LOCAL ou REMOTE, marcador único persistido, com espelho síncrono para hot path.

O split local↔remoto é esse marcador único, não namespacing de IndexedDB por atlas: múltiplos atlas locais nomeados são não-objetivo declarado (local = um workspace + `.ebgeo`). Ver [[dominio-local-vs-remoto]] e [[atlas-modelo-de-dados]].

A combinação decide o gate: `checkPermission()` libera tudo quando `isOffline() || !isRemoteStoreSync()` (`store/sync/permission-guard.js:66-73`). **O papel só restringe um atlas remoto conectado.** Sem isso, um usuário cujo papel global é `viewer` não conseguiria desenhar no próprio workspace local. Ver [[permissoes-atlas]] e [[sintese-eixos-de-permissao]].

## Armadilha 1: anônimo não é offline

Sem backend alcançável não existe app, nem anônimo. O boot é fail-fast em `GET /api/config`: 3 tentativas com 1 s, e se nenhuma aplicar, `showUnavailableScreen()` e retorno sem bootar (`frontend/src/js/index.js:74-87`). O `frontend/src/js/config.js` empacotado é só uma casca hidratada pelo servidor, então bootar sem config significaria bootar com catálogo vazio, pior que não bootar. O retry de 3 existe para que um soluço de rede não derrube o boot; só indisponibilidade real chega à tela. Ver [[config-dinamico]] e [[config-runtime-urls-relativas]].

## Armadilha 2: `isAuthenticated()` é falso no modo público

`isAuthenticated()` exige `ONLINE && userId && !_isVisitor` (`frontend/src/js/store/sync/session-context.js:196-198`), e o visitante público é ONLINE sem conta (`frontend/src/js/store/sync/session-context.js:264-270`). Qualquer UI que use esse predicado como "estou conectado" erra no modo público. Para conectividade use `connectionState`; para "posso escrever" use o guard.

Esse é o preço deliberado de reusar a sessão para o visitante: em troca, o menu de conta some sozinho e o guard já bloqueia escrita sem código novo. `frontend/src/js/account/sync-status.control.js:102` esconde a luz de conexão pelo mesmo predicado, o que é intencional (visitante não tem o que sincronizar).

## Armadilha 3: logging de operações é estado global entre conexões

`connectPublic` chama `disableOperationLogging()` (`frontend/src/js/store/sync/sync-engine.js:227`) porque o token público não pode dar push: ops enfileiradas ficariam órfãs e seriam despejadas no atlas errado num login posterior. Consequência não local: `connect()` autenticado precisa chamar `enableOperationLogging()` explicitamente (`frontend/src/js/store/sync/sync-engine.js:169`), senão herda o desligamento de um `connectPublic` anterior na mesma aba. Mexer em um lado sem o outro produz um cliente silenciosamente read-only.

O overlay de settings do atlas se aplica ao visitante também (`frontend/src/js/store/sync/sync-engine.js:234-235`): ele respeita disponibilidade de 3D/360/basemaps como qualquer membro, ver [[atlas-settings]].

O token público é efêmero e não persiste: `setEphemeralToken` zera o refresh token (`frontend/src/js/store/sync/api-client.js:117-120`). Não há rotação; o link é re-resolvido no boot. Contrato de 1 h do backend em [[link-publico]]. Ele entra na URL do socket como qualquer outro access token (`frontend/src/js/store/sync/api-client.js:935-940`), ver [[canal-collab-websocket]].

## Contratos de ordem que não podem inverter

- **Abrir atlas remoto**: `disconnect → clearAllDataStore → markStoreRemote → connect → activateAtlasInitialMap → startAutoFlush` (`account/account.control.js:783-801`). `markStoreRemote` **antes** do connect é intenção durável: se a aba morrer durante o pull, a guarda de boot vê `remote` e descarta o parcial em vez de promovê-lo a atlas local permanente. E o store é um só, por isso a UI confirma antes de descartar trabalho local.
- **Restaurar sessão antes do boot do store** (`frontend/src/js/index.js:99-104`): invertido, a guarda de boot não enxerga a sessão e descarta o atlas remoto em cache.
- **Owner elevado no snapshot, antes do handshake** (`frontend/src/js/store/sync/sync-engine.js:177-184`): sem isso os botões de configuração piscam ausentes no F5. O `connected` do WS ainda sobrescreve o papel global de login com o papel por atlas.

## Subir o workspace local para o servidor

`import_export/save-local-atlas.service.js` sobe os blobs **preservando os ids locais** (o backend aceita o id do cliente), justamente para que as referências das features recém-importadas continuem válidas sem rewrite pós-import. Não existem operações de remapeamento; quebrar essa preservação exigiria inventá-las. O serviço não conecta nem troca a origem do store, isso é da UI chamadora. Ver [[atlas-import-offline]] e [[imagens-atlas]].

Imagens fora do allowlist (`image/png`, `image/jpeg`, `image/webp`) viram `skipped`, não falha (`save-local-atlas.service.js:19, 50-53`). Ícones customizados em SVG caem aí, por SVG ser vetor de XSS armazenado: é exclusão de segurança, não bug. Ver [[upload-imagens-seguranca]].

## Divergências guia↔código já resolvidas

O guia absorvido *08-offline-import* erra em três pontos, e quem o reler vai tropeçar nos mesmos:

- §4.4/§4.7 dizem que os `imageId` locais são trocados por ids de servidor e exigem UPDATE nas features depois do upload. Não: ids preservados, sem rewrite (acima).
- §5.1 modela estado por atlas no IndexedDB (`{ mode, serverId, lastSyncVersion, pendingOperations }`). Não existe: há um marcador único de origem, e trocar de atlas remoto passa por `clearAllDataStore()`.
- §5.2 diz que conflito é resolvido "via CRDT". É LWW por ordem de chegada no servidor, com idempotência por `op_id`; o relógio de Lamport é registrado e não decide nada. Ver [[sintese-nao-e-crdt]] e [[modelo-conflito-lww]].

## Tabela de decisão

| Aspecto | Anônimo | Autenticado | Público |
|---|---|---|---|
| `isAuthenticated()` | false | true | **false** |
| Origem do store | LOCAL | REMOTE (quando conectado) | REMOTE |
| Backend exigido no boot | **sim** | sim | sim |
| Logging de operações | sim (fila local) | sim | **desligado** |
| Gate de papel | inativo | ativo no atlas remoto | bloqueia escrita |
| Token | nenhum | JWT + refresh | efêmero, sem refresh |

Relacionadas: [[sessao-boot-e-ciclo-de-vida]], [[autenticacao-jwt]], [[refresh-token-rotacao]], [[fila-operacoes-outbound]], [[envelope-operacao]], [[snapshot-e-pull-incremental]], [[aplicacao-operacoes-remotas]], [[presenca-colaborativa]], [[compartilhamento-atlas]], [[clone-atlas]], [[formato-ebgeo-roundtrip]], [[sintese-capacidades-por-papel]], [[syncledger]].
