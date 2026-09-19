# Auditoria de casos extremos de sincronismo (19/09/2026)

Base: `0b18a2d8`, branch `integracao_backend`. Complementa as auditorias de
[preservação de dados](auditoria-preservacao-dados-2026-09-19.md) e
[lançamento](auditoria-lancamento-2026-09-19.md).

## Resultado

Sete defeitos reproduzidos e corrigidos. A investigação incluiu o envio HTTP,
confirmações por operação, troca de sessão/atlas, reconciliação de pendências,
recepção WebSocket, recuperação por snapshot e poda do histórico no PostgreSQL.
Cada defeito teve uma reprodução que falhou com o comportamento anterior e
passou após a correção, além dos controles adicionais de regressão.

Não houve acesso à intranet, implantação nem modificação dos acervos originais.
Os testes usaram bancos descartáveis e perfis isolados de navegador.

## Defeitos e proteções

| ID | Gravidade | Reprodução e consequência | Correção |
| --- | --- | --- | --- |
| S1 | Alta | Um recibo lê o mapa de A; o usuário abre B antes da gravação; havendo o mesmo ID, o documento de A sobrescrevia o de B. Reproduzido com IndexedDB emulado e repositório real. | A confirmação captura a sessão e o repositório, participa da serialização da aplicação remota e verifica o destino após as leituras. |
| S2 | Alta | A sessão muda durante a primeira confirmação de um lote. As confirmações seguintes ainda atualizavam versões e reparavam dados no novo atlas. | O processamento verifica a sessão em cada operação e após cada aplicação assíncrona; a fila não é removida por um processamento interrompido. |
| S3 | Alta | A leitura da fila de A termina depois da abertura de B. A reconciliação usava os IDs de A para liberar proteções de edições pendentes de B. | Fila e reconciliação ficam vinculadas à mesma sessão; uma troca cancela o resultado tardio. |
| S4 | Alta | A poda termina entre a leitura de `min_version` e a leitura das operações. O servidor devolvia uma cauda vazia ou incompleta com cursor avançado; com poda parcial, uma edição podia ficar permanentemente fora do replay incremental. | O servidor verifica novamente a fronteira após ler a cauda e envia snapshot completo se ela foi podada. A transação de poda torna essa segunda verificação suficiente: uma poda posterior não remove linhas já lidas. |
| S5 | Média | Duas notificações estruturais chegam enquanto a primeira busca está em andamento. Ambas compartilhavam uma resposta que podia anteceder a segunda alteração. | As chamadas compartilham o processamento, mas uma nova solicitação marca a necessidade de outra busca antes da conclusão. |
| S6 | Alta | Um snapshot HTTP atrasado chega depois de uma edição mais nova recebida pelo WebSocket ou confirmada por recibo. Sua publicação podia apagar a edição nova. | Cada montagem mantém a maior versão observada como limite mínimo para snapshots, separado do cursor completo de replay. A validação ocorre antes da preparação e antes da publicação. A recuperação tenta novamente, com limite de três respostas antigas para evitar laço infinito. |
| S7 | Média | A recuperação de uma alteração estrutural falha. O erro era apenas registrado e o socket continuava aberto, sem garantir recuperação da alteração ausente. | Eventos estruturais entram na fila de aplicação do socket. Uma falha fecha a conexão e permite reconexão/replay com o cursor anterior. |

S6 também protege a janela em que um recibo chega enquanto o snapshot aguarda
gravações no IndexedDB. A geração anterior permanece publicada quando essa
preparação é recusada. A fronteira observada é isolada por montagem e **não** é
usada para pular operações na reconexão: conhecer uma versão isolada não prova
que todas as anteriores chegaram.

O pull incremental passa a fazer uma consulta adicional à fronteira no banco.
Recuperações concorrentes podem exigir snapshots adicionais. Não houve alteração
de esquema nem novo formato de armazenamento; o impacto sob carga de produção
não foi medido nesta rodada.

## Evidências e validação

- Regressões no orquestrador: interrupção entre confirmações, troca durante leitura
  de fila, recibo já removido da fila, duas recuperações sobrepostas, nova busca
  após snapshot antigo e limite de tentativas sem avanço de cursor.
- Regressões no repositório: dois atlas com o mesmo ID de mapa, snapshot anterior
  a uma operação remota e recibo recebido durante preparação da nova geração.
- Regressão no transporte: falha estrutural entra em reconexão mantendo o cursor.
- PostgreSQL real: trava de tabela suspende a leitura do log depois da leitura
  do cursor; outra transação executa a remoção de operações/recibos e publica
  `min_version`, reproduzindo a transição atômica da poda. A resposta deve conter
  a edição no snapshot recuperado. Há casos separados para remoção total e
  parcial do histórico.
- Chromium, dois clientes e backend reais: retenção de uma resposta HTTP antiga
  até uma edição posterior chegar pelo WebSocket; verificação da nova busca e
  da permanência da feição no IndexedDB.
- Chromium e PostgreSQL: o servidor confirma a gravação, mas o navegador perde
  a resposta HTTP. A operação deve continuar pendente, ser reenviada com o mesmo
  ID, sair da fila após confirmação e existir uma única vez no log do servidor.
- Regressões de reconexão em ambos os sentidos, replay, F5 e edição pendente
  durante atualização remota.

Resultados finais:

| Verificação | Resultado |
| --- | --- |
| Frontend completo, Vitest | 715 arquivos, 13.228 testes aprovados |
| Backend, integração `sync-*.test.js` | 476 testes, 180 suítes, todos aprovados |
| Navegador, Chromium | 7 testes aprovados, sem repetição automática |
| Lint frontend, JavaScript e CSS | Aprovado |
| Lint backend | Aprovado |
| Build de produção | Aprovado; permanecem os avisos de tamanho dos chunks e tempo de plugins |

A primeira execução completa acusou o orçamento de 710 módulos (agora são 711).
Outra execução acusou a pontuação do título deste relatório na regra de
integridade documental. Ambos foram corrigidos antes da validação final.
Logs, resultados de navegador e arquivos de build continuam ignorados pelo Git.

Comandos principais, a partir da raiz:

```powershell
npm test --prefix frontend -- --maxWorkers=2
npm run lint --prefix frontend
npm run lint --prefix backend
npm run build --prefix frontend
$env:TEST_DB_NAME='ebgeo_sync_edges_20260919'
npm test --prefix backend -- 'tests/integration/sync-*.test.js'
npm run test:e2e:ui --prefix frontend -- browser-sync-stale-snapshot.spec.js browser-reconnect-replay.spec.js browser-f5-reconnect-map.repro.spec.js browser-collab-reconnect.spec.js edicao-pendente-sobrevive-a-op-remota.repro.spec.js --retries=0
```

O build deve terminar antes da suíte completa do frontend: os testes de orçamento
inspecionam os arquivos em `dist`. O orçamento de quantidade de módulos foi
ajustado de 710 para 711, correspondente ao novo módulo `snapshot-frontier.js`,
menor que 1 kB. Os limites de tamanho em kB foram mantidos.

## Limites

Esta rodada aumenta a cobertura das corridas descritas; não demonstra ausência
de todos os defeitos de sincronismo. Não houve simulação de todas as combinações
de quota esgotada, encerramento do processo, latência e quantidade de clientes.
O navegador validado nesta rodada é Chromium. Intranet, proxy HTTPS corporativo,
outros navegadores e testes prolongados de carga permanecem fora desta medição.
As evidências das auditorias anteriores continuam complementares e não foram
reclassificadas como testes executados nesta rodada.
