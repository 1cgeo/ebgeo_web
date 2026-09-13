# Abas, logout, troca de atlas e recuperação

Status: pendente. Prioridade: bloqueia lançamento. Depende das entregas de [persistência](02-persistencia.md), [conflitos](03-conflitos.md) e [comandos compostos](04-comandos-compostos.md).

## Regra do produto

Confirmar a saída voluntária descarta as pendências remotas abrangidas pelo aviso, incluindo conflitos e uploads. Não apaga atlas locais nem dados confirmados no servidor. Cancelar preserva o trabalho. Queda de rede, F5, expiração de login ou troca de atlas não autorizam descarte. Pendências descartadas não voltam no próximo login.

## Lacunas e arquivos

A época de descarte e a proteção de callbacks já existem. Falta comprovar uma pausa durável entre todas as abas antes da contagem e confirmação, incluindo aba suspensa. Houve uma falha transitória no ensaio BroadcastChannel main/nova durante esta execução; passar no rerun não encerrou essa matriz.

Revisar `frontend/src/js/session/confirm-logout.js`, `frontend/src/js/store/write-coordinator.js`, `frontend/src/js/store/remote-write-fence.js`, `frontend/src/js/store/atlas-namespace.js`, `frontend/src/js/store/sync/sync-engine.js`, `frontend/src/js/store/sync/remote-operation-handler.js` e `frontend/src/js/utilities/tab-lock.js`.

## Correção

1. Implantar barreira por escopo remoto, verificada no momento de cada escrita. Mensagem BroadcastChannel isolada não comprova que uma aba pausou. Drenar gravações iniciadas antes de contar operações, conflitos, recuperação e uploads.
2. Se a estabilidade não puder ser comprovada, informar pendências de quantidade desconhecida. Cancelamento libera a barreira; confirmação invalida a época e limpa somente o escopo abrangido.
3. Cobrir respostas HTTP/WS tardias, timers, uploads, manutenção e callbacks. Capturar escopo/geração antes do await e revalidar na persistência.
4. Serializar snapshot, replay e ACK; ativar a nova geração duravelmente. Nunca remover a ativa antes de confirmar a substituta, nem limpar gerações com leitores/escritores válidos.
5. Rever timeout, cancelamento e Retry-After. Resposta perdida preserva o mesmo ID; abortar a requisição não prova rollback remoto.

## Aceite

Duas abas editam durante o diálogo; uma aba suspensa retorna após descarte e novo login; resposta antiga chega após troca; logout é cancelado; login expira; quota impede ativação de snapshot. Executar as ordens com barreiras determinísticas e repetir corridas em série. Validar conteúdo dos atlas locais, do remoto anterior e do destino. Usar os testes existentes de remote-write-fence, snapshot-generation e browser-confirm-logout como base, sem substituir a coordenação real por mocks de mensagens.
