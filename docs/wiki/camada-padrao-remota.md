# A camada padrão de um atlas de servidor nasce no servidor

Num atlas de servidor toda camada tem UUID emitido pelo servidor, inclusive a primeira; o cliente deixou de sintetizar uma camada chamada `default` nesse caso, e sintetizá-la de novo é o que produz feição pendurada numa camada que não existe do outro lado.

O contrato de servidor está em `backend/src/modules/atlas/atlas.service.js` e `backend/src/modules/maps/maps.service.js`; o lado do cliente em `frontend/src/js/layers/layer.manager.js` (`getDefaultLayer`). Esta página guarda o porquê, a assimetria local/remoto, e o que a regularização de dados NÃO recupera.

## Por que a síntese no cliente era uma armadilha

O cliente sempre soube inventar uma camada `default` para um mapa que não tem nenhuma, e em atlas LOCAL isso continua certo: o id é local por definição e não há segundo participante. Em atlas de servidor a mesma síntese produzia duas camadas com significados diferentes e o mesmo nome: a que este navegador inventou e a que o par inventou, cada uma com id próprio, nenhuma conhecida pelo servidor. Uma queda de conexão no instante da criação de um mapa bastava.

Hoje o servidor grava a camada na MESMA transação do ato que a exige: criar o atlas grava o atlas, o mapa inicial e a camada; criar um mapa por sync grava a camada dele; e excluir a última camada de um mapa cria outra camada real, com UUID novo, na mesma transação, com as exclusões concorrentes serializadas pelo lock de escrita do atlas. A camada excluída e as feições dela continuam excluídas: a substituta não as herda.

**A consequência no cliente é uma espera, e ela é deliberada:** num atlas de servidor um mapa novo AGUARDA a camada confirmada, e uma queda de conexão não produz camada independente no navegador. Em atlas local nada mudou.

## O UUID confirmado viaja por três portas, e as três importam

O id da camada criada pelo servidor vai no log de operações, no ack de quem pediu e no replay para os pares. Faltar em qualquer uma das três reabre o buraco por um caminho diferente: sem o ack, o autor fica sem saber em que camada acabou de escrever; sem o log e o replay, o par offline nunca converge.

Do ack de criação de mapa vem também `replacementLayers`, que é o que dispensa o cliente de inventar a camada substituta ao excluir a última em atlas de servidor (em atlas local a substituta é intenção própria dele).

**O ACK aplica as camadas sem regravar o documento do mapa.** Isso preserva feições editadas enquanto a resposta estava pendente, e é a mesma regra que vale para o update parcial de mapa: gravação cega do documento inteiro com payload parcial apaga o que não veio no payload. Versões de camada impedem que esse ack, ou a resposta de uma exclusão antiga, recriem uma camada já excluída.

## A referência implícita é resolvida sobre uma CÓPIA

Um cliente antigo envia feição com referência implícita à camada padrão. O servidor resolve essa referência para o UUID real e devolve o id no resultado confirmado, mas a resolução trabalha numa cópia dos dados: **o envelope original fica intacto para o cálculo do recibo.** Sem isso, repetir a mesma criação antiga deixaria de casar com o recibo anterior e a op seria aplicada duas vezes.

Uma referência EXPLÍCITA a uma camada excluída é recusada com motivo, nunca movida em silêncio para a substituta. Mover pareceria gentileza e esconderia a única informação útil: que aquele cliente está editando contra um estado que já não existe.

## O que a regularização de dados não faz

A regularização de 2026-09 (um arquivo de migração só de DADOS, sem DDL, que saiu da sequência na consolidação de 2026-09-20 porque uma instalação nova não tem linha para regularizar) cria camada apenas nos mapas VIVOS que não têm nenhuma, preserva a configuração das camadas existentes, vincula as feições sem camada à primeira camada real do próprio mapa, atualiza a revisão dessas feições e exige snapshot para os cursores anteriores. Reaplicá-la não duplica camada.

Três limites, e o primeiro é o que mais engana:

- **Ela não recupera configuração que existiu apenas no navegador** e já foi descartada por uma reconciliação anterior. O que não chegou ao servidor não está lá para ser regularizado.
- **Ela não transforma edição antiga em edição contra uma revisão atual inventada.** O cliente antigo continua precisando de snapshot.
- **Numa instalação nova ela não tem linha para regularizar**, e é por isso que ela ficou fora da comparação de catálogos da consolidação: não traz DDL nenhum. Ver [[deploy-backend]].

## Ver também

[[atlas-modelo-de-dados]] para a hierarquia; [[aplicacao-operacoes-remotas]] para o que o par faz com a camada recebida; [[ack-idempotencia]] para o recibo; [[dominio-local-vs-remoto]] para a assimetria que autoriza a síntese local; [[modelo-conflito-lww]] para a recusa sobre linha excluída.
