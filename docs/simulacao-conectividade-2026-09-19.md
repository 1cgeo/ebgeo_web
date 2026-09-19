# Simulação de perda de conexão, intermitência e lentidão (19/09/2026)

Base da aplicação: `d6ac0399`, branch `integracao_backend`. Execução local com
dois clientes Chromium em perfis separados e backend/PostgreSQL reais, em banco
descartável. Sem acesso à intranet e sem alteração dos acervos originais.

## Método

As operações são feitas nos navegadores. O teste compara IDs, cores e geometria
das feições persistidas no IndexedDB de cada cliente com as linhas do PostgreSQL,
verifica que a fila esvaziou sem pendências recusadas e procura operações
duplicadas. A queda total também inclui uma exclusão e uma recarga da página.

O corte usa `setOffline` e encerra explicitamente o WebSocket, mantendo o
mecanismo normal de reconexão do aplicativo. Essa segunda ação é necessária
porque a emulação HTTP offline do Chromium pode deixar um socket de loopback
existente aberto. São falhas injetadas e controladas, não perda aleatória de
pacotes físicos.

Na intermitência, cada ciclo mantém a rede cortada durante os desenhos e por
mais dois segundos, seguido de uma janela de 1,2 segundo com rede. O backoff
pode atravessar várias dessas janelas; o teste exige convergência ao final.

No perfil lento, a restrição é aplicada ao HTTP do backend: latência configurada
de 1 segundo, download de 32 KiB/s, upload de 16 KiB/s e atraso adicional de
4 segundos na entrega dos recibos. O WebSocket continua disponível. Esse caso
exercita respostas lentas enquanto novas edições continuam sendo feitas.
Os tetos de banda são parâmetros da emulação, não medições de taxa efetiva;
o atraso de quatro segundos dos recibos é imposto pelo interceptor do teste.

A primeira tentativa limitou todo o tráfego, incluindo os tiles do mapa-base.
Ela parou no requisito do motorista de teste que espera o mapa estar carregado
antes de desenhar, após 20 segundos. Não chegou a concluir a comparação dos
dados. A medição foi então delimitada ao backend para não confundir essa espera
com defeito de sincronismo; não é um ensaio de usabilidade com mapa-base lento.

Um segundo ajuste foi necessário no instrumento: sob atraso, uma feição do par
pode chegar durante o desenho local. O motorista genérico retornava o primeiro
ID novo visível, podendo atribuir o ID remoto ao desenho local. Esta suíte agora
identifica cada criação pelo registro de enfileiramento do próprio autor e
continua comparando integralmente os documentos dos dois clientes com o banco.

O teste de timeout permite que o servidor grave e retém a primeira resposta.
Ele verifica que o timeout real de 30 segundos provoca reenvio automático, que
a operação continua com o mesmo ID e que uma edição posterior também chega.

## Resultados

**Nove cenários aprovados em 5,1 minutos, sem repetição automática:** quatro
cenários novos e cinco regressões anteriores executadas novamente. Não foi
observada perda, corrupção ou duplicação dos dados examinados. As filas de
operações dos quatro perfis novos terminaram vazias e sem recusas pendentes.

| Perfil | Injeção | Resultado observado |
| --- | --- | --- |
| Queda total | 30 segundos offline; criações, alteração e exclusão nos clientes | 6 feições finais iguais no banco e nos clientes; convergência em 2,073 s após retorno; F5 preservou o conteúdo |
| Intermitência | 5 ciclos de corte e retorno curto | 11 feições finais; convergência em 5,005 s após encerrar os ciclos |
| Lentidão HTTP | Recibos atrasados em 4 s, com limites de latência/banda configurados | 10 feições finais; convergência em 5,869 s após terminar os desenhos, ainda sob degradação |
| Timeout real | Primeira resposta retida após a gravação no servidor | Reenvio automático em 33,004 s; mesmos IDs; 3 feições finais; nenhuma duplicação |

Também passaram a recuperação de briefing após F5, upload de imagem retomado
por reconexão, upload retomado após F5, perda da resposta HTTP depois do commit
e snapshot antigo chegando depois de uma edição mais recente pelo WebSocket.

Os números brutos dos quatro perfis estão em
[simulacao-conectividade-2026-09-19.json](simulacao-conectividade-2026-09-19.json).
O lint JavaScript e os testes de integridade documental foram aprovados.
Nesta rodada foram acrescentados testes e evidências; o código da aplicação
testado é o da base indicada no início.

## Ponto de atenção observado

A interrupção do upload de imagem preserva o blob e a operação localmente, e
impede publicar uma feição cujo arquivo ainda não chegou ao servidor. A retomada
funcionou tanto por reconexão quanto por F5, mantendo o ID e os bytes.

Entretanto, recuperar somente a rota de upload, mantendo o WebSocket conectado,
não inicia uma nova tentativa imediatamente. O teste confirma que a imagem
continua pendente depois de três segundos nessa condição; a leitura de
`image-sync.js` confirma os gatilhos de retomada na conexão e na transição para
ONLINE. Assim, uma falha isolada do serviço de imagens pode exigir reconexão ou
F5 para voltar a publicar a imagem. Isso é uma limitação de retomada automática,
não perda do arquivo local. Não foi alterada nesta rodada de simulação.

## Reprodução

```powershell
npm run test:e2e:ui --prefix frontend -- browser-sync-network-chaos.spec.js --retries=0
npm run test:e2e:ui --prefix frontend -- browser-sync-network-chaos.spec.js browser-sync-stale-snapshot.spec.js browser-collab-imagem-retomada.spec.js browser-briefing-write-ahead.spec.js --grep 'seconds offline|five short|slow network|receipt|delayed HTTP|a op espera|a pendência sobrevive|offline briefing' --retries=0
```

Os tempos de convergência são observações desta execução em loopback, não uma
garantia de prazo para a intranet. A medição começa depois de terminar a fase de
injeção/edição; no caso do timeout, o tempo até a segunda tentativa é registrado
separadamente. Não foram simulados todos os tamanhos de atlas, perfis de rede,
navegadores ou quantidades de usuários simultâneos.
