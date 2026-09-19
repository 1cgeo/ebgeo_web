# Auditoria de casos extremos na troca de atlas

Escopo: local → local, remoto → local e local → remoto no branch `integracao_backend`, incluindo retorno ao remoto com alterações pendentes. Ensaios locais com IndexedDB, Chromium e backend/PostgreSQL descartáveis. A intranet não foi acessada.

## Defeitos corrigidos

| Caso | Falha anterior | Correção |
| --- | --- | --- |
| Duas trocas solicitadas durante a preparação visual | As rotinas podiam intercalar montagem, renderização e callbacks; a primeira terminava sobre o destino da segunda. | Fila única para `switchAtlas`, `openRemoteAtlas` e `switchToNewLocalAtlas`, abrangendo também a preparação visual. A verificação de atlas já aberto ocorre quando a solicitação chega à frente da fila. |
| Troca durante uma gravação já iniciada | A persistência podia continuar depois da mudança de namespace, gravando no destino errado ou falhando na confirmação. | Pausa dos novos escritores do escopo de origem e espera pelos escritores já registrados antes de montar o destino. Descarga da gravação adiada da camada ativa antes de limpar caches. |
| Atlas local deixa de existir entre consulta e montagem | O retorno de recusa de `mountLocalAtlas` era ignorado. O fluxo podia anunciar sucesso e marcar como local o escopo remoto que continuava montado. | Conferência do resultado antes de preparar o conteúdo ou alterar sua procedência. Retorno explícito de recusa, preservando os bancos existentes. |
| Falha após montar o destino, antes de concluir sua preparação | Tentar o mesmo atlas novamente virava um retorno sem ação, deixando a preparação incompleta. | Registro da preparação interrompida; a próxima seleção refaz a abertura. Uma falha não trava as solicitações seguintes na fila. |
| Selecionar novamente o remoto que está desconectado | O ID ainda presente no engine era tratado como prova de que o atlas já estava aberto corretamente. | O atalho exige também conexão online; desconectado, executa novamente a abertura. |
| Recursos/configurações remotos respondem depois da desconexão | A abertura podia aplicar configurações antigas e terminar como bem-sucedida depois do encerramento de sua sessão. | Validação da sessão após as esperas de recursos e configurações, antes de aplicar o overlay e antes de concluir `connect`. Cancelamento não é confundido com falha opcional de configuração. |
| Primeira edição remota coincide com a consulta do auto-flush | A própria consulta usava um Web Lock exclusivo e podia recusar a edição como se outra aba estivesse fazendo logout. Também confundia um escritor legítimo com logout. | Consulta compartilhada, compatível com escritores e outras consultas; a barreira exclusiva de logout continua recusando ambos enquanto estiver ativa ou pendente. |

O replay de uma troca local depois de “Usar aqui” também passa pela fila e emite a notificação normal de troca.

## Evidências

- Antes das correções, quatro dos cinco novos casos de concorrência/falha em `troca-viva-de-atlas.test.js` falharam; os dois casos de resposta tardia em `sync-engine.test.js` também falharam.
- A primeira rodada Chromium reproduziu a recusa incorreta de edição por suposto logout, sem outra aba. Um teste adicional com Web Locks reais também reprovou a consulta durante uma escrita legítima. Ambos passaram após a correção da sondagem.
- `atlas-switch-edge-cases.spec.js` usa o serviço de troca real, IndexedDB e servidor reais. Retarda a renderização e o primeiro pull, bloqueia POSTs de sincronismo e injeta erro de quota na gravação do ponteiro local. Compara separadamente feições e blobs sentinela no banco de imagens dos dois atlas locais, inclusive com IDs iguais, e consulta o servidor para confirmar o destino da edição remota pendente. Esses blobs medem isolamento e preservação dos bytes; não são uma prova de decodificação ou renderização de fotos.
- As verificações de sessão usam respostas controladas para recursos/configurações. As verificações de gravação em andamento usam a transação real e fake-indexeddb; a persistência é suspensa antes de solicitar a troca.

Resultados de navegador: **17 testes distintos aprovados**, sem retries automáticos. São quatro casos novos de falhas/concorrência, dez verificações de duas abas (incluindo controles do instrumento), e três cenários de aparência, painel de feição e atualização de camadas/briefings/presença. A rodada ampliada aprovou 12 e reprovou o teste de aparência apenas no logout: o teste exigia confirmação de descarte mesmo com a fila já sincronizada. Corrigida essa premissa para esperar a confirmação ou a saída efetiva, a rodada final aprovou aparência e os quatro casos novos juntos. Nessa rodada, o caso de fila pendente também provocou falha no pull de reabertura, verificou a preservação da fila e retomou o envio depois de liberar a rede.

Na bancada, a limpeza final de bancos PostgreSQL descartáveis voltou a aguardar indefinidamente `ProcSignalBarrier`. Foram canceladas somente as consultas de DROP com o nome exato dos bancos desta campanha, depois de terminadas as asserções. Os testes não foram dispensados e o serviço PostgreSQL não foi reiniciado.

Suíte geral final: **720 arquivos e 13.325 testes aprovados**, em uma execução completa após os ajustes dos testes isolados e dos inventários de funções. Lint JavaScript/CSS e build de produção aprovados. O build mantém os avisos conhecidos sobre tamanho de chunks.

## Limites

- A fila coordena as três entradas de troca citadas dentro desta aba. Arbitragem entre abas continua sendo responsabilidade dos mecanismos existentes de namespace e Web Locks.
- Esperar uma gravação em andamento não torna o conjunto de bancos uma transação única. Falhas físicas de armazenamento, encerramento abrupto do navegador e limpeza externa de dados não recebem garantia geral de recuperação nesta auditoria.
- Não foi adicionada uma transação abrangendo toda importação longa ou todo logout junto com a troca. Operações compostas fora das entradas citadas exigem seus próprios controles; estes resultados não provam todas as combinações possíveis com elas.
- Permanecem os limites da [auditoria de migração](auditoria-migracao-versoes-2026-09-19.md), em especial a substituição local por arquivo ainda não atômica e o upload parcial de imagens ao servidor. Trocar de atlas preservando os bancos não resolve esses riscos de importação.
- Os resultados são da bancada local com Chromium; não certificam a intranet, outros navegadores ou ausência de qualquer perda de dados.

## Reprodução

```powershell
npm test --prefix frontend -- --maxWorkers=2
npm run lint --prefix frontend
npm run build --prefix frontend
npm run test:e2e:ui --prefix frontend -- atlas-switch-edge-cases.spec.js --retries=0
npm run test:e2e:ui --prefix frontend -- browser-multi-tab-namespace.spec.js troca-viva-de-atlas-tela.spec.js painel-de-feicao-na-troca-viva.spec.js aparencia-atravessa-trocas-de-atlas.spec.js --retries=0
```

Executar suíte geral, build e campanhas Chromium sequencialmente. Usar `EBGEO_UI_E2E_DB_NAME` com nome exclusivo de banco descartável quando necessário.
