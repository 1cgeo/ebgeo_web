# Atlas remoto: sincronismo, concorrência e recuperação

Revisão de 12/09/2026 sobre o commit fa0f021891b785b61c45fd8aedc51f20a99a0950 do branch integracao_backend. Código de produção não alterado. Servidor interno não acessado. Os testes de banco e navegador usaram os bancos descartáveis dos runners do projeto.

**Conclusão: os fluxos comuns funcionam, mas ainda não recomendo a migração para produção com promessa de preservação das alterações sob falhas.** Há perdas de operações sem logout, divergências entre o cliente e o servidor e situações em que uma fila vazia transmite uma segurança que o estado local não sustenta.

A política já escolhida pelo proprietário continua adequada: saída voluntária confirmada descarta pendências. Nenhuma recomendação abaixo propõe reativar essas pendências depois de um logout. Reconexão involuntária, recarregamento e substituição de snapshot exigem tratamento próprio.

## Como o fluxo funciona hoje

1. O atlas remoto recebe um namespace próprio no IndexedDB. Atlas locais usam outros espaços. O mecanismo central não é um localStorage compartilhado contendo todos os mapas.
2. Abrir o remoto limpa os dados daquele namespace e baixa um snapshot. Nesse caminho, a fila de operações é preservada por clearQueue derivado de markLocal=false. Preservar a fila, porém, não recompõe por si só o documento apagado.
3. Uma edição grava a entidade local; depois, um efeito assíncrono separado enfileira a operação. O envio usa HTTP em lotes de 25, com auto-flush aproximadamente a cada 1,5 segundo enquanto o WebSocket está online.
4. O servidor serializa pushes por atlas, aplica operações dentro de transação e usa savepoints para isolar recusas. O ID da operação fornece deduplicação enquanto sua linha existir no histórico.
5. O WebSocket distribui alterações aos demais clientes. Parte dos tipos possui proteção de ordem por versão do servidor. O autor filtra o próprio eco e usa o ACK para conciliar sua versão.
6. Após queda de um socket estabelecido, há reconexão com espera exponencial de 1 a 30 segundos e solicitação de replay. O heartbeat do cliente usa 25 segundos; a detecção de uma conexão sem resposta pode levar aproximadamente dois ciclos, além de suspensão de timers pelo navegador.
7. Se o cursor estiver atrás do histórico retido, o servidor retorna um snapshot completo. Esse é um caminho relevante para usuários ausentes por bastante tempo.

Referências: [abertura](../../frontend/src/js/account/open-atlas.service.js), [store](../../frontend/src/js/store/store.js), [fila](../../frontend/src/js/store/sync/operation-queue.js), [engine](../../frontend/src/js/store/sync/sync-engine.js), [WebSocket](../../frontend/src/js/store/sync/ws-client.js), [serviço de sincronismo](../../backend/src/modules/sync/sync.service.js).

## Achados prioritários

### R1. Alta: pendências expiram sem confirmação do usuário ou do servidor

A fila executa purgeOldOperations com idade padrão de sete dias. startAutoPurge instala a chamada a cada seis horas e é ativado por initServices. O predicado usa o timestamp da operação e não verifica ACK. Não se trata da limpeza do histórico já sincronizado no servidor.

**Cenário:** uma operação ficou retida por rede, autorização ou indisponibilidade. Ao atingir a idade e executar a manutenção, ela desaparece da fila. Reabrir o atlas pode depois substituir a única representação local dessa edição. O simples F5 não é o gatilho direto da poda: é a execução do timer na sessão ativa.

**Reprodução:** operação de oito dias, sem ACK, enfileirada; após a poda, a contagem foi zero em vez de um.

**Correção:** não expirar automaticamente trabalho não confirmado. Sua remoção deve decorrer de confirmação individual do servidor, descarte explícito ou tratamento visível de uma recusa. Isso não exige guardar indefinidamente uma fila abandonada por logout confirmado.

Fonte: [operation-queue.js](../../frontend/src/js/store/sync/operation-queue.js), [services.js](../../frontend/src/js/store/services.js).

### R2. Alta: a compactação pode perder trabalho ou violar a deduplicação

Acima de 10.000 entradas, a compactação agrupa operações por entidade. Foram confirmados dois problemas:

- CREATE seguido de UPDATE mantém o ID do CREATE e troca seu conteúdo. Se o servidor recebeu o CREATE, mas a resposta se perdeu, o reenvio compactado será reconhecido como já executado. O UPDATE desapareceu da fila e nunca será aplicado.
- Vários UPDATEs mantêm apenas o último. Isso perde patches independentes, como uma alteração de exagero do terreno seguida de outra preferência do atlas.

**Reprodução:** o compactador mudou o conteúdo associado ao mesmo ID; o backend real confirmou esse ID como idempotente e manteve o conteúdo original. Uma segunda sonda perdeu o primeiro de dois patches de configuração.

Há ainda uma janela de falha identificada por leitura: a compactação remove entradas antes de gravar suas substitutas, sem transação única. Fechar o processo ou falhar o armazenamento entre essas etapas pode deixar um resultado parcial. Esse corte de processo específico não foi injetado nesta revisão.

**Correção:** envelopes já enviados devem ser imutáveis; não compactar operações com entrega incerta. Definir compactação por tipo e semântica do patch, preservando dependências, e gravar o resultado atomicamente. Suspender a compactação atual é uma mitigação mais simples até haver essas garantias.

Fonte: [operation-queue.js](../../frontend/src/js/store/sync/operation-queue.js), [deduplicação SQL](../../backend/src/modules/sync/sync.queries.js).

### R3. Alta: o snapshot pode apagar o estado pendente do próprio autor

applyRemoteSnapshot substitui mapas e coleções pelo conteúdo recebido. Não reaplica a fila pendente sobre esse conteúdo. O reparo do ACK depende de uma marca de sobrescrita por operação remota; o snapshot não produz essa marca.

**Reprodução em navegador real:** bloqueei somente o POST de sincronismo de B; B desenhou uma linha e a gravou no IndexedDB; apliquei um snapshot do servidor, que ainda não conhecia a linha; liberei o POST. A linha chegou ao PostgreSQL e a fila de B ficou vazia, mas a linha continuou ausente do IndexedDB de B. A asserção de convergência permaneceu falsa durante seis segundos após a confirmação.

A [captura](2026-09-12-atlas-remoto-snapshot-pendente.png) mostra “Tudo enviado” e uma seleção antiga ainda desenhada. A imagem isolada não prova ausência da feição: essa ausência foi medida diretamente no IndexedDB. A seleção obsoleta pode mascarar o problema.

O cenário pode ocorrer em reabertura, recuperação por snapshot ou ressincronização disparada por mudança estrutural de outro usuário. Nesta revisão, o navegador exercitou diretamente a ressincronização; não foi feita uma matriz completa de F5 com pendências.

**Correção:** coordenar snapshot, replay incremental, escritas locais e ACKs numa mesma sequência. Instalar a base recebida e reconstruir a projeção local com as operações pendentes da sessão válida. Confirmar o valor canônico no autor depois do envio, sem depender de eco filtrado. Reconstruir a visualização não significa decidir automaticamente que uma edição antiga deve sobrescrever o servidor.

Fonte: [applyRemoteSnapshot e resolveLocalEdit](../../frontend/src/js/store/sync/remote-operation-handler.js), [resync](../../frontend/src/js/store/sync/sync-engine.js).

### R4. Alta: snapshot completo não remove tudo que deixou de existir

O aplicador percorre os mapas e briefings recebidos e os salva. Não compara a lista atual com a lista autoritativa para remover entidades ausentes. Uma reabertura que limpa antes pode esconder essa falha; um snapshot recebido durante a sessão não tem a mesma limpeza.

**Reprodução:** com um mapa e um briefing existentes localmente, aplicar um snapshot com ambas as listas vazias deixou os dois registros presentes.

**Cenário:** usuário perde o evento de exclusão e só retorna quando precisa de snapshot. Ele pode continuar vendo um mapa ou briefing removido do servidor.

**Correção:** substituir o conjunto autoritativo completo, incluindo exclusões e coleções auxiliares, conciliando separadamente as pendências legítimas. Também limpar dados que deixaram de ser visíveis por mudança de permissão, sem tratar ausência de campo como autorização para preservar conteúdo antigo.

Fonte: [applyRemoteSnapshot](../../frontend/src/js/store/sync/remote-operation-handler.js).

### R5. Alta: a primeira conexão tem um intervalo sem recuperação

A abertura baixa o snapshot antes de estabelecer o WebSocket. Uma alteração confirmada nesse intervalo não está no snapshot nem alcança o socket ainda inexistente. O primeiro connected não solicita replay; somente a reconexão o faz. O servidor também não envia histórico automaticamente nesse handshake.

**Reprodução de transporte:** conexão inicial com cursor 10, seguida do connected, não gerou sync_request. Leitura dos dois lados confirma que não há outra recuperação automática nessa transição. O intervalo HTTP/WS inteiro não foi reproduzido em browser nesta revisão.

**Correção:** sincronizar a partir da versão do snapshot em toda entrada na sala, inclusive na primeira, e coordenar esse replay com o tráfego ao vivo. A ordem deve impedir tanto buracos quanto regressões.

Fonte: [connect](../../frontend/src/js/store/sync/sync-engine.js), [_onConnected](../../frontend/src/js/store/sync/ws-client.js), [handshake do servidor](../../backend/src/modules/collab/collab.gateway.js).

### R6. Alta: o cursor avança antes da persistência local

O cliente atualiza o maior serverVersion assim que recebe uma operação, antes de executar o handler assíncrono. Se a escrita falhar, o erro é registrado no console, mas o cursor já ultrapassou a alteração. sync_response também avança o cursor do transporte antes de sua aplicação terminar.

**Reprodução:** cursor 10, recebimento da versão 11, falha injetada no aplicador. O próximo pedido de replay levou 11, pulando justamente a operação que não foi gravada.

**Correção:** separar recebido de aplicado duravelmente. O cursor de recuperação deve representar uma sequência efetivamente concluída. Falha de persistência deve impedir avanço e levar a nova tentativa ou recuperação explícita. Não basta atrasar apenas uma atribuição: operações ao vivo, snapshots e replay precisam compartilhar a coordenação.

Fonte: [_applyInboundOps e sync_response](../../frontend/src/js/store/sync/ws-client.js), [syncResponse](../../frontend/src/js/store/sync/sync-engine.js).

### R7. Alta: recusas e operações sem efeito podem deixar o autor divergente

recordPushAcks avisa sobre recusa, mas também chama recordLocalAppliedVersion para uma operação recusada que tenha tipo protegido. A resposta do backend fornece currentVersion mesmo nesse caso. O cliente pode então tratar a edição recusada como vencedora e rejeitar operações válidas mais antigas que essa versão.

**Reprodução:** resposta com success=false, rejected=true e versão 100 chamou o reparo de vencedor para a edição recusada.

Além disso, o backend considera sucesso operações que executaram sem exceção, mesmo quando não materializaram entidade. **Reprodução real:** CREATE de feição apontando para mapa inexistente retornou success=true e não criou linha. O rastreamento de desenvolvimento pode acusar rowsAffected=0, mas isso não transforma a resposta numa recusa visível ao autor.

**Correção:** separar aplicado, idempotente, recusado e sem efeito esperado. Nunca registrar uma recusa como vitória. Conciliar o documento local com o estado autoritativo; oferecer detalhes persistentes das alterações recusadas. Definir casos em que zero linhas é um resultado legítimo, como exclusão repetida, e recusar os demais.

Fonte: [recordPushAcks](../../frontend/src/js/store/sync/sync-engine.js), [pushOperations e applyOperation](../../backend/src/modules/sync/sync.service.js).

### R8. Alta: exclusão esquece a versão e permite ressurreição por mensagem velha

Após DELETE, o cliente apaga a versão conhecida da entidade. Um CREATE antigo pode então passar pela proteção de ordem e recriar o objeto localmente.

**Reprodução:** CREATE versão 10, DELETE versão 11, reentrega do CREATE versão 10. A feição voltou. O controle positivo confirmou a criação inicial antes de testar a exclusão.

O caminho de reentrega existe: o backend retransmite também operações consideradas idempotentes, e o replay pode se intercalar com mensagens ao vivo. Não é necessário que o TCP de um mesmo socket inverta seus próprios frames.

**Correção:** manter a versão da exclusão como tombstone de sincronismo. Recriação legítima só pode vencer se tiver versão posterior. Definir também proteção de ordem para tipos hoje fora do conjunto protegido, como comentários, configuração e metadados de mapas.

Fonte: [registro de versões](../../frontend/src/js/store/sync/remote-operation-handler.js), [broadcast HTTP](../../backend/src/modules/sync/sync.controller.js).

### R9. Alta: limpar histórico elimina a garantia de entrega exatamente uma vez

A deduplicação consulta a própria tabela de operações. cleanupOldOperations apaga essas linhas. Um cliente que perdeu a resposta e reenviar um ID removido passa a ser tratado como autor de uma nova operação.

**Reprodução no PostgreSQL:** apliquei UPDATE antigo, apliquei UPDATE mais novo, limpei o histórico anterior ao novo e reenviei o antigo. O servidor respondeu idempotent=false e substituiu o valor novo pelo antigo.

O gatilho confirmado é a limpeza administrativa do histórico. Não foi encontrada uma rotina automática de limpeza do sync no backend atual; não confundir com a poda automática da fila local de R1.

**Correção:** separar recibos de deduplicação do histórico usado para replay, ou definir uma época de sincronismo que rejeite operações de épocas encerradas. Para usuários ausentes por meses, simplesmente aumentar a retenção desloca o problema. O servidor precisa reconhecer que já aplicou uma operação ou impedir sua reaplicação ambígua.

Fonte: [cleanupOldOperations](../../backend/src/modules/sync/sync.service.js), [GET_OPERATION_BY_OP_ID](../../backend/src/modules/sync/sync.queries.js).

### R10. Alta: gravar a entidade não garante que sua operação ficou durável

runTransaction aguarda a entidade, mas dispara deferAsync sem aguardar sua conclusão. O enfileiramento ocorre em outra escrita. Uma interrupção entre ambas deixa uma edição local sem operação para enviar. Em falha de enqueue, há um retry em memória; se esse retry também falhar, resta o erro de console. Não foi encontrado um reconciliador geral que reconstrua essas operações na próxima abertura.

**Evidência:** leitura do encadeamento de persistência, commit e retry. Não foi simulada interrupção do processo exatamente entre essas duas escritas nesta rodada.

**Correção:** um diário durável da intenção de editar, ou entidade e operação numa mesma transação IndexedDB. O usuário só deve receber confirmação de salvamento remoto pendente quando essa intenção estiver persistida. A proteção contra logout deve considerar também escritas e enfileiramentos em andamento.

Fonte: [store-transaction.js](../../frontend/src/js/store/store-transaction.js), [operation-dispatcher.js](../../frontend/src/js/store/sync/operation-dispatcher.js).

### R11. Alta: requisição de sync sem conclusão pode bloquear o envio indefinidamente

Push, pull e renovação de token não têm um prazo geral de aplicação. O auto-flush mantém inFlight até a promessa terminar; os alertas contam rejeições, não tempo parado. Uma requisição que fique pendurada não produz a terceira falha que dispararia o aviso.

O heartbeat WebSocket não cancela uma requisição HTTP pendurada. Reiniciar o timer também não é uma solução para callbacks antigos: o envio precisa de cancelamento e isolamento por sessão/atlas.

**Evidência:** leitura dos ramos de timeout do cliente HTTP e do guard do auto-flush. Não foi medido um limite máximo efetivo dos proxies da rede interna, aos quais não há acesso.

**Correção:** prazo de progresso e política de nova tentativa para push, pull e autenticação, respeitando transferência grande. Repetir com o mesmo ID e manter a fila intacta quando o resultado for incerto. Mostrar idade da pendência e envio estagnado. Aplicar espera e jitter para evitar reconexões em massa sincronizadas.

Fonte: [_request](../../frontend/src/js/store/sync/api-client.js), [flushOnce](../../frontend/src/js/store/sync/sync-flush.js).

### R12. Média: callbacks da conexão anterior interferem na nova

Handlers de socket não verificam se pertencem à conexão ainda corrente. disconnect inicia o fechamento e limpa o ponteiro; o onclose antigo pode chegar depois de um novo connect.

**Reprodução:** abertura de A, disconnect com close atrasado, conexão de B, entrega do close de A. O ponteiro de B foi apagado e a máquina voltou a reconectar.

**Correção:** geração de conexão e escopo capturado em cada callback e operação em andamento. Fechar/desligar uma sessão deve invalidar seus handlers, awaits e filas de aplicação antes de montar o próximo atlas. Rever o mesmo princípio no auto-flush e na aplicação de respostas HTTP. A sonda confirmou interferência no socket; não confirmou escrita cruzada em atlas local.

Fonte: [_open, disconnect e _onClose](../../frontend/src/js/store/sync/ws-client.js).

### R13. Média: ajuste regressivo do relógio inverte a fila

A chave ordenada começa pelo timestamp civil; Lamport só desempata timestamps iguais. Ajustar o relógio para trás pode colocar um UPDATE antes do CREATE que o originou.

**Reprodução:** CREATE com timestamp 2000/Lamport 1, UPDATE com timestamp 1000/Lamport 2. O envio foi ordenado como UPDATE, CREATE.

**Correção:** sequência monotônica persistida por fila, independente do relógio civil e preservada no recarregamento. Usar data/hora para exibição e diagnóstico, não para dependência causal.

Fonte: [_buildKey e _getOrderedKeys](../../frontend/src/js/store/sync/operation-queue.js).

### R14. Média: imagens não acompanham a recuperação das operações

Upload de imagem é best-effort, sem fila durável de blobs. Na falha, a operação pode continuar referenciando um identificador local. O aviso instrui a pessoa a repetir a inserção quando a rede voltar. Esvaziar a fila de operações não demonstra que as imagens chegaram.

**Evidência:** leitura de uploadImageBlob e seus retornos de falha. Não foi executado um novo cenário de upload interrompido nesta rodada.

**Correção:** fila de upload vinculada ao atlas e às operações que dependem do blob, com retomada e contagem conjunta de pendências. Alternativamente, impedir a conclusão da inserção remota e manter um rascunho claramente identificado até terminar o upload. Descartar os dois tipos de pendência na saída voluntária confirmada.

Fonte: [image-sync.js](../../frontend/src/js/store/sync/image-sync.js).

## Conflitos entre usuários: comportamento confirmado e decisão de produto

O servidor usa última chegada, não o horário em que o usuário fez a edição. A versão local não funciona como pré-condição que bloqueie uma edição baseada em estado velho. Não há merge automático de geometria nem resolução interativa generalizada de conflitos.

**Exemplo reproduzido no backend:** B muda o nome de uma feição. A havia carregado o nome anterior e, offline, muda a geometria. Quando A envia o documento com geometria e propriedades antigas, o servidor aceita a geometria e também restaura o nome antigo. Os dois usuários terem alterado campos diferentes não os protege quando o payload carrega o documento completo.

Isso é coerente com a regra atual, mas conflita com a expectativa de preservar trabalho independente. Os testes de concorrência verificam que todos chegam ao mesmo vencedor; eles não demonstram preservação das duas intenções.

O aviso de sobrescrita tem janela de 15 segundos e depende de resolver o nome do autor pela presença. Ele não é um histórico de conflitos nem protege um usuário que ficou offline por horas.

**Recomendação:** operações carregarem uma versão-base e, quando possível, patches dos campos realmente alterados. Alterações independentes podem ser combinadas; disputa da mesma geometria/campo, edição sobre exclusão e mudanças estruturais devem receber tratamento explícito. Operação antiga conflitante pode ser recusada de forma visível ou submetida a escolha antes do envio. A escolha precisa ser aplicada no servidor, não apenas num aviso no cliente.

Essa regra vale para a fila ativa durante interrupção involuntária. No logout confirmado, descartar continua sendo a política, sem ressuscitar trabalho abandonado posteriormente.

Fontes: [normalização e aplicação no servidor](../../backend/src/modules/sync/sync.service.js), [aviso de sobrescrita](../../frontend/src/js/store/sync/overwrite-notice.js).

## Proteções que já existem

- Namespace por atlas e registro dos espaços remotos, com proteção entre abas. A revisão não encontrou evidência de que uma simples entrada em atlas remoto apague indiscriminadamente os atlas locais.
- ACK por operação e retenção de operações não identificadas numa resposta parcial.
- Transação de escrita do servidor, serialização por atlas e limite de espera de lock de cinco segundos.
- Recusas individuais isoladas por savepoint e filtros de autorização/escopo. O backend continua sendo a autoridade de permissão.
- Reconexão exponencial e replay após queda de uma conexão estabelecida; fallback para snapshot quando o histórico ficou curto.
- Proteção de convergência para feições, camadas, grupos, briefing e tipos 3D/360, embora incompleta nos casos documentados.
- Confirmação de saída com pendências e registro de descarte aceito, conforme a política solicitada anteriormente.

Essas proteções reduzem riscos específicos. Nenhuma delas, isoladamente, fecha o ciclo de persistência, envio e recuperação.

## Sequência recomendada de correção

1. **Preservação da intenção:** R1, R2, R9, R10 e R13. Estabelecer operação durável, imutável, ordenada e deduplicável. Não podar trabalho pendente.
2. **Recebimento e recuperação:** R3 a R8. Uma coordenação para snapshot, replay e mensagens ao vivo; cursor aplicado; tombstones; ACK com significado preciso.
3. **Ciclo de conexão:** R11 e R12. Cancelamento, geração de conexão, prazos de progresso e descarte seguro de callbacks anteriores.
4. **Conflitos e anexos:** pré-condição por versão-base, patches, resolução visível e R14. Separar sucesso de envio, convergência e uploads concluídos na interface.
5. **Gate de liberação:** transformar as sondas em testes permanentes de comportamento seguro e executar matriz real de navegador com falhas controladas, além da suíte normal.

## Matriz necessária antes da produção

| Cenário | O que deve ser demonstrado |
| --- | --- |
| Queda antes de enviar | Intenção durável; nenhuma confirmação indevida |
| Commit no servidor com resposta perdida | Reenvio do mesmo ID; efeito único |
| Interrupção entre entidade e fila | Recuperação da intenção após reinício |
| Mais de 10.000 pendências | Compactação sem perda, inclusive patches e dependências |
| Usuário ausente por meses | Snapshot conciliado; deduplicação ou recusa de época antiga |
| Queda durante snapshot | Base parcial não anunciada como pronta |
| Alteração entre snapshot e handshake | Replay obrigatório cobre o intervalo |
| Falha de IndexedDB ao receber | Cursor não pula a operação |
| Snapshot com pendências | Servidor, memória, IndexedDB e render convergem |
| Dois/três usuários, mesma e diferentes propriedades | Resultado conforme política de conflito, sem perda involuntária de campo independente |
| Excluir versus editar/recriar; resposta atrasada | Tombstone e ordem canônica respeitados |
| Briefing/slides, grupos, comentários, 3D/360 e mapa | Conferir estado no servidor e após F5; teste de feição não representa todos os tipos |
| Upload interrompido | Dependência de blob pendente e retomável |
| Trocar atlas com HTTP/WS em andamento | Nenhum callback de sessão anterior alcança a nova |
| Revogar acesso, mudar papel, expirar token durante queda | Backend recusa; UI explica; trabalho tem destino explícito |
| Logout confirmado com pendências | Descarte não reaparece no próximo login e não afeta atlas locais |
| Backend reiniciado e respostas 429/503 | Retry com backoff, fila íntegra e diagnóstico visível |
| Relógio alterado, aba suspensa ou navegador fechado | Ordenação e recuperação independentes de timers ativos |

Itens da matriz são critérios de liberação; não constituem afirmação de que todos foram executados nesta revisão.

## Evidência e limites

As [sondas e instruções de reprodução](2026-09-12-atlas-remoto-sondas.md) preservam o código dos experimentos. Os specs temporários de execução são removidos ao encerrar a revisão. As falhas registradas são resultados esperados do código defeituoso, não testes corrigidos.

- Frontend existente: 181 testes em seis arquivos aprovados, cobrindo engine, fila, aplicador, convergência, transporte e auto-flush.
- Backend existente: 459 testes de integração do conjunto sync aprovados, sem skips.
- WebSocket do backend: 262 testes aprovados, sem skips, incluindo autorização, reconciliação e distribuição de operações.
- Contrato frontend/backend: oito testes em três arquivos aprovados, cobrindo replay, concorrência e fidelidade do snapshot.
- Navegador existente: sete cenários aprovados sem retry, incluindo queda/reconexão, edição offline, conflitos de cor/geometria/exclusão, F5 e três clientes.
- Sondas frontend adicionais: 11 executadas e 11 falhas nas propriedades de segurança. Os 159 casos filtrados pertencem aos suportes copiados e não entram nessa contagem.
- Sondas backend adicionais: quatro cenários reais confirmaram os comportamentos documentados.
- Sonda adicional de navegador: divergência de snapshot reproduzida com PostgreSQL e IndexedDB, fila zerada e captura inspecionada.

Total da cobertura existente executada: 917 testes aprovados. Essa contagem não inclui as sondas que expõem os defeitos nem significa aprovação da matriz completa de liberação.

Não houve teste da rede interna, proxy de produção, armazenamento efetivamente cheio, travamento do processo no instante de persistência nem matriz completa de anexos e tipos colaborativos. Não foi executada novamente a suíte inteira da raiz, pois esta entrega é uma revisão sem mudança da lógica do produto.
