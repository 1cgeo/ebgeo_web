# Pendências de sincronização: a luz e o painel

A luz de sync responde por SETE sinais, não pela contagem de envelopes na fila, e o verde exige que não haja nada guardado à espera de decisão; o painel que abre a partir dela lê TRÊS fontes de disco, porque cada uma guarda o que as outras duas não veem.

As frases e os estados são folhas de zero imports (`frontend/src/js/account/sync-phrases.js`, `frontend/src/js/account/pendencias/pendencias-phrases.js`), a decisão de linha é função pura (`pendencias-rows.js`) e o painel só monta DOM (`pendencias-panel.js`). Esta página guarda por que o verde ficou mais caro, por que as fontes são três, e o que o painel deliberadamente NÃO faz.

## O verde antigo era uma afirmação que ninguém tinha medido

`describeSyncWork` lia três coisas: origem do store, estado da conexão e contagem da fila. Com fila zero e conexão de pé, ele dizia verde, e dizia verde também quando havia conflito guardado, op recusada, blob de figura que nunca subiu e um replay sendo aplicado naquele instante. O pior dos quatro é o replay: durante a aplicação de um retrato a fila lida **não é** a fila, então a leitura era verde justamente no momento em que menos valia.

Hoje `SYNC_WORK_STATE` tem os quatro estados que faltavam (`recuperando`, `conflito`, `recusa`, `upload-pendente`) e o verde exige conexão, zero enviáveis, zero preparadas, zero problemas, zero quarentena, zero uploads pendentes e nenhuma recuperação em curso. **Qualquer leitura que falhe cai em desconhecido, nunca em zero.**

Duas finuras: o sinal de recuperação vem de `storeWritesPaused`, um leitor puro, lido no momento da PINTURA, porque uma recuperação começa e termina entre duas batidas do mostrador; e um LEITOR só alimenta a luz e o crachá de presença (`configurarPendenciasDePresenca`, `frontend/src/js/session/pendencias-monitoramento.js`, instalado nas quatro páginas), porque um terceiro varredor divergiria dos outros dois sem que nada ficasse vermelho.

## Três fontes, e nenhuma é redundante

- **`getProblems`** do escopo montado: conflito, recusa, e a dependência bloqueada. Esta última é DERIVADA a cada leitura e nunca gravada, porque a causa dela some sozinha quando a operação da frente é resolvida.
- **`listQuarantinedOperations`** do registro global: o que sobreviveu ao logout, lido inclusive em atlas local, porque é o único registro que nenhum expurgo alcança. Ver [[namespace-por-atlas]].
- **`listarPendenciasDeBlob`**: os bytes de figura, que não têm operação incremental e por isso nunca aparecem na fila. Ver [[imagens-atlas]].

**A CLASSE e a ORIGEM viajam separadas**, e a razão é que uma recusa preservada é ao mesmo tempo uma recusa e algo de uma sessão anterior; juntá-las numa coluna obriga a escolher qual das duas o leitor perde. E **a falha de leitura é um ESTADO, nunca lista vazia**, porque lista vazia é a afirmação a partir da qual alguém decide sair da conta e aceitar perder pendências.

## As três ações, e o que elas não fazem

- **Aceitar o servidor** remove a tentativa e o que estava parado atrás dela, com a confirmação nomeando QUANTAS, e pede o estado atual por `resync`.
- **Reaplicar** cria operação NOVA com o conteúdo local guardado e a base que o servidor informou no recibo (`entityVersion`), recarimbada sobre o `previousData`: isso preserva o patch e declara a base mais nova que este cliente pode provar conhecer.
- **Exportar** leva o envelope inteiro e o motivo para a área de transferência, porque a casa não tem porta de download compartilhada.

Três decisões que quem mexer no painel precisa conhecer:

- **Reaplicar NÃO reescreve a projeção local.** Depois de um conflito o motor já fez `resync`, então a tela mostra o documento do servidor. Trazer o conteúdo local de volta para a tela exigiria o caminho de escrita de CADA entidade, que é uma segunda cópia do roteador de `frontend/src/js/store/sync/remote-operation-handler.js`. Com conexão, ela empurra a fila e pede `resync` depois; sem conexão, o aviso diz que a tela continua mostrando o do servidor até a fila sair.
- **A tentativa antiga FICA na fila depois de reaplicar**, com o problema dela. Removê-la perderia o conteúdo caso a nova também seja recusada, e ela não atrapalha, porque a fila pula operação que carrega registro de problema.
- **A dependência bloqueada não tem "aceitar o servidor"**, e não é esquecimento: ninguém a recusou, então descartá-la jogaria fora trabalho que o servidor aceitaria. O que a resolve é resolver a que está na frente.

A quarentena de protocolo tem só exportar e descartar. **Não existe "reenviar"**: a op escrita por um protocolo anterior não é reenviada nem reescrita para passar num schema novo, e o painel não desenha o botão em vez de desenhá-lo e recusar o clique, porque aqui a ausência é forma e não estado. O descarte é por LINHA (`discardQuarantinedOperation`); o que existia antes era por atlas, do tamanho do logout, e um botão por linha sobre ele destruiria o que a pessoa não olhou.

**A afordância segue a regra da casa:** bloqueio por POSTO não desenha o comando; bloqueio por ESTADO (sem conexão, mapa travado) desenha com `aria-disabled`, nunca com a propriedade `disabled`, e recusa o clique nomeando o estado. Nada some por fechar o painel nem por F5: as três fontes são de disco.

## O que ainda não chega ao painel

- **A comparação visual de geometria.** A linha de conflito de feição nomeia a unidade em disputa e mostra o motivo; quem quiser ver a diferença entre a geometria local e a do servidor não tem onde.

**O conteúdo canônico do recibo CHEGOU em 2026-09-13**, e com ele o "estado atual permitido" que o painel não podia inventar: toda recusa por conflito de entidade carrega `serverData`, lido da linha VIVA por `backend/src/modules/sync/entity-canonical.js`, um serializador por entidade na mesma forma que o snapshot já entrega. A propriedade que importa não é o campo existir, é de ONDE ele vem: um canônico montado a partir do payload do remetente seria o documento dele com o aval do servidor colado em cima, e o par que o painel desenha concordaria por construção, provando nada. `null` continua sendo resposta legítima (alvo sem serializador, id numa forma que a consulta não sabe endereçar) e o painel degrada para o que já mostrava.

## Ver também

[[fila-operacoes-outbound]] para o que gera cada classe de problema; [[diario-write-ahead]] para a intenção preparada que ainda não é enviável; [[modelo-conflito-lww]] para o que o servidor recusa e por quê; [[observabilidade]] para o lado do administrador.
