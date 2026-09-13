# Abas, logout, troca de atlas e recuperação

Status: pendente. Prioridade: bloqueia lançamento. Depende das entregas de [persistência](02-persistencia.md), [conflitos](03-conflitos.md) e [comandos compostos](04-comandos-compostos.md).

## Regra do produto

Confirmar a saída voluntária descarta as pendências remotas abrangidas pelo aviso, incluindo conflitos e uploads. Não apaga atlas locais nem dados confirmados no servidor. Cancelar preserva o trabalho. Queda de rede, F5, expiração de login ou troca de atlas não autorizam descarte. Pendências descartadas não voltam no próximo login.

**A QUARENTENA NÃO É PENDÊNCIA, E SOBREVIVE AO DESCARTE** (decisão D2 de 2026-09-13, implantada no commit que acrescentou `frontend/src/js/store/sync/quarantine-registry.js`). Operação recusada pelo servidor, ou escrita por um protocolo que este build não reenvia, não está esperando envio: está esperando DECISÃO. Como a fila é por atlas, ela morava no banco que o descarte destrói, então o usuário concordava em perder pendências e perdia, calado, também o que já tinha sido posto de lado. Agora `requestRemoteAtlasDiscard` copia a quarentena para o `ebgeo_global` (uma chave por atlas, `GlobalKey.QUARANTINE_PREFIX`) ANTES de marcar qualquer atlas, confere a cópia por releitura e recusa o descarte inteiro se não conseguir confirmá-la; o aviso de saída conta e NOMEIA as duas metades, por `pendingWorkSummary` e `quarantineKeptNotice` (`frontend/src/js/session/unsynced-work-phrases.js`). O registro global não é alcançado por wipe nenhum: ele sai do disco por decisão explícita, e `listQuarantinedOperations` é a leitura que a tela de pendências consome.

O limite, declarado porque a ausência se confunde com esquecimento: a cópia roda no descarte CONFIRMADO. A varredura de boot deslogado (`purgeAllRemoteAtlases`) também destrói namespace, e uma fila órfã destruída por ela ainda não é copiada por ninguém.

## Lacunas e arquivos

A época de descarte e a proteção de callbacks já existem. Falta comprovar uma pausa durável entre todas as abas antes da contagem e confirmação, incluindo aba suspensa. Houve uma falha transitória no ensaio BroadcastChannel main/nova durante esta execução; passar no rerun não encerrou essa matriz.

Revisar `frontend/src/js/session/confirm-logout.js`, `frontend/src/js/store/write-coordinator.js`, `frontend/src/js/store/remote-write-fence.js`, `frontend/src/js/store/atlas-namespace.js`, `frontend/src/js/store/sync/sync-engine.js`, `frontend/src/js/store/sync/remote-operation-handler.js` e `frontend/src/js/utilities/tab-lock.js`.

## Correção

1. Implantar barreira por escopo remoto, verificada no momento de cada escrita. Mensagem BroadcastChannel isolada não comprova que uma aba pausou. Drenar gravações iniciadas antes de contar operações, conflitos, recuperação e uploads.
2. Se a estabilidade não puder ser comprovada, informar pendências de quantidade desconhecida. Cancelamento libera a barreira; confirmação invalida a época e limpa somente o escopo abrangido.
3. Cobrir respostas HTTP/WS tardias, timers, uploads, manutenção e callbacks. Capturar escopo/geração antes do await e revalidar na persistência.
4. Serializar snapshot, replay e ACK; ativar a nova geração duravelmente. Nunca remover a ativa antes de confirmar a substituta, nem limpar gerações com leitores/escritores válidos. **A metade de gerações e ponteiros está FEITA: ver a seção seguinte.**
5. Rever timeout, cancelamento e Retry-After. Resposta perdida preserva o mesmo ID; abortar a requisição não prova rollback remoto.

## Gerações e ponteiros duráveis (itens 3 e 4 do bloco B7, feitos em 2026-09-13)

Fecha F11 e F12 sob a decisão D3 (ativa mais UMA anterior, poda idempotente na ativação, preparação falhada apagada na hora). Três commits, cada guarda com controle negativo executado e a fonte restaurada depois.

- **`c4ad2e5e`, a poda.** `pruneAtlasGenerations` (`frontend/src/js/store/atlas-namespace.js`) apaga toda geração de `known` que não seja a ativa nem a reserva, e `pruneSupersededGenerations` (`frontend/src/js/store/sync/remote-operation-handler.js`) reescreve `known` DEPOIS da poda, de modo que a lista nunca nomeia banco que saiu do disco. A poda não pode usar a trava de montagem, porque a aba que poda é a que está montada e seria recusada por si mesma: entrou uma trava por GERAÇÃO (`atlasGenerationLockName`), tomada em `activateScope` e trocada por `adoptActiveGeneration` na ativação do retrato, com o release aguardado. Geração que outra aba ainda lê é poupada e permanece em `known`. Preparação que falha entre registrar em `known` e gravar o ponteiro é apagada na hora (`discardPreparedGeneration`), e delete que não confirma MANTÉM a geração em `known`, senão sobra dado de servidor que nenhum expurgo acha. Quatro casos novos em `frontend/tests/integration/snapshot-generation.test.js`, quota na ativação entre eles, que é o teste que este aceite pedia e não existia.
- **`7f45d000`, o cursor.** `connect` com `initialPull` lê `readGeneration(scope).cursor` e pede a CAUDA. O retrato completo continua acontecendo sem geração ativa, quando o servidor responde `isSnapshot` e quando a cauda traz marcador estrutural. O ponteiro sozinho não é evidência: a geração ativa é perguntada se ainda guarda o acervo daquele atlas, senão um namespace esvaziado por logout produziria um atlas sem nada anterior ao cursor, calado. Cinco casos novos em `frontend/tests/integration/sync-engine.test.js`.
- **O terceiro commit deste lote ("época e geração espelhadas no IndexedDB global; sem localStorage o fence fecha"), o espelho**, que é também o que acrescentou esta seção, e por isso é o único citado por assunto e não por SHA. Ponteiro de geração e época de descarte ganharam cópia no `ebgeo_global` (`GlobalKey.GENERATION_PREFIX` e `GlobalKey.WRITE_EPOCH_PREFIX`), escrita depois da autoritativa e reconciliada por `reconcileDurablePointers` antes de o `connect` ler o cursor: `localStorage` perdido com o IndexedDB de pé volta a ser acervo alcançável em vez de nove bancos que nada resolve. Sem `localStorage`, e DENTRO de um documento de navegador, o fence passou a responder FECHADO; fora de um documento (node) continua aberto, porque ali não há aba nem consentimento, e é isso que mantém a suíte medindo o produto. As duas chaves são apagadas quando o namespace é destruído, no ponto único `dropAtlasDatabases`, e só quando nenhum delete ficou `blocked`, porque a varredura seguinte deriva a lista de bancos do próprio ponteiro.

Limites declarados, porque ausência se confunde com esquecimento:

- **A reconciliação tem UM ponto de entrada, o `connect` remoto.** Um slot LOCAL que carregue geração (o resgate adota um namespace `remote-<id>` com as gerações dele) nunca conecta, então nada reconcilia o ponteiro dele; fazer isso exige um `await` no boot da store, que é outro arquivo.
- **A remoção da chave de época não fecha TODO escritor.** Fecha quem capturou um registro existente, porque toda época escrita é no mínimo 1 e a ausência lê 0. Quem nasceu antes de qualquer registro lê 0 nos dois estados, e quem o impede de recriar os bancos é o freio de desmontagem, que tem controle negativo próprio. Duas tentativas de fechar isso dentro do fence foram revertidas, e a lição de uma delas está no cabeçalho de `frontend/src/js/store/remote-write-fence.js`: ela fazia o controle negativo DO FREIO parar de reproduzir.
- **A poda é best-effort e roda DEPOIS do commit do ponteiro**, então falha nela custa disco e nunca a recuperação; a próxima ativação poda de novo.
- **Nada aqui mexeu na barreira entre abas nem no diálogo de logout** (itens 1, 2 e 5 desta lista, mais os itens 1, 2 e 5 do bloco B7), e nenhuma corrida de duas abas foi medida neste lote: o que os casos novos cobrem é uma aba, com a irmã simulada por trava real.

## Aceite

Duas abas editam durante o diálogo; uma aba suspensa retorna após descarte e novo login; resposta antiga chega após troca; logout é cancelado; login expira; quota impede ativação de snapshot. Executar as ordens com barreiras determinísticas e repetir corridas em série. Validar conteúdo dos atlas locais, do remoto anterior e do destino. Usar os testes existentes de remote-write-fence, snapshot-generation e browser-confirm-logout como base, sem substituir a coordenação real por mocks de mensagens.
