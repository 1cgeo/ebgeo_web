# Auditoria de logs e monitoramento de usuários deslogados

## Escopo e achados

Revisão do caminho de presença, lotes de uso, diagnóstico do navegador, logs HTTP, remoção de credenciais, leituras administrativas e agregação/retenção. Execução local com PostgreSQL descartável, sem acesso à intranet.

| Achado | Correção |
| --- | --- |
| Visitante de link público tinha identificador sintético enviado para colunas de usuário UUID, causando falhas na coleta. | Uso, presença e erros passam a registrar esse visitante como anônimo. |
| Uma falha síncrona ou assíncrona na leitura das pendências impedia o pulso inteiro. | O pulso segue com pendências desconhecidas e incrementa a falha de coleta. Não inventa zero. |
| Um pedido de pulso durante outro em andamento era perdido, inclusive na troca de identidade. | O pedido é repetido ao terminar; desinstalar aborta a requisição pendente. |
| Registros expirados ou JSON corrompido consumiam o limite da fila e podiam eliminar um lote recente válido. | A fila fotografa suas chaves, elimina inválidos antes do corte e mantém no máximo trinta lotes válidos também na inserção. |
| Reutilizar um identificador de sessão com outra identidade misturava dados anônimos e autenticados ou trocava a conta atribuída. | A identidade da sessão é imutável. O lote incompatível recebe conflito e toda sua transação, incluindo contadores, é desfeita. Login e logout já abrem segmentos distintos no cliente. |
| A limpeza de URL não cobria tokens de verificação, links públicos e credenciais embutidas no endereço. | Esses formatos passam a ser removidos. Os testes também verificam parâmetros duplicados e segredos adjacentes; a remoção percorre uma lista estável de chaves. |
| O limite de profundidade do limpador devolvia o objeto profundo sem limpar; variantes de caixa e cookies também escapavam. | O trecho profundo é truncado; nomes de campos são normalizados e cookies removidos. |
| Erros de JSON malformado podiam carregar o corpo, a mensagem e a pilha com trecho do conteúdo enviado. | O corpo é removido e a mensagem de falha de parse é genérica. |
| Requisições interrompidas antes de terminar não deixavam linha HTTP; falhas de parse não tinham correlação. | O logger é instalado antes da autenticação e do parser; encerramento prematuro é registrado uma vez como 499. |
| URL e pilha bruta da telemetria do navegador podiam guardar chaves de API ou tokens de renovação. | O cliente remove credenciais mantendo arquivo, linha e coluna para diagnóstico; o servidor também limpa a URL recebida. |
| Respostas administrativas de uso e diagnóstico não proibiam armazenamento em cache. | As rotas declaram resposta privada e sem armazenamento, variando por cookie e Authorization. |
| Após inatividade maior que a retenção, a poda podia apagar sessões nunca agregadas ou alterações posteriores ao último agregado. | Todos os dias fechados com sessões sobreviventes são considerados. Agregar e podar usam a mesma transação e fotografia do banco; podas parciais não reduzem o agregado já publicado. |

## Verificação e limites da interpretação

Os testes exercitam as rotas reais, o visitante de link público, mudança de identidade, repetição do mesmo lote, expiração da presença, recusas a usuários sem permissão administrativa, falhas de coleta, interrupção HTTP, JSON inválido, segredos repetidos e profundos e agregação após longa inatividade. Os testes anteriores de limites de taxa, persistência, consultas, arquivos diários e diagnóstico permanecem na suíte completa.

Controles negativos executados contra as funções do commit anterior reproduziram exposição de credenciais embutidas em URLs, tokens de verificação/link público, cookies e segredos em objetos profundos. As mesmas entradas foram limpas pela implementação corrigida. O caso de parâmetros duplicados já passava no código anterior e é cobertura defensiva, não um vazamento confirmado.

No Chromium, `diag-defeitos.spec.js` e o guarda de backend real passaram sem retries: relato anônimo aparece no painel, resolução chega ao servidor, uma nova release produz regressão e a gaveta e o resumo refletem as ocorrências. Durante a suíte geral foi corrigida também uma instabilidade do teste de cursor de sync: a consulta a `pg_stat_activity` precisava renovar sua fotografia dentro da transação. O controle negativo reproduziu os dois casos de falha; após a correção, vinte rodadas consecutivas desse arquivo passaram.

O resumo de diagnóstico local foi consultado antes das alterações: o arquivo estava acessível, mas não havia configuração de banco de execução nem amostras de saúde/sonda naquela consulta. Esses estados foram declarados como indisponíveis ou sem amostras, e não como ausência de falhas. Os ensaios posteriores usam bancos de teste configurados e descartáveis.

“Deslogados” mede navegadores que enviaram pulso na janela de noventa segundos, não pessoas únicas. Abas do mesmo perfil compartilham o identificador; perfis diferentes, armazenamento bloqueado ou apagado mudam essa aproximação. Abas escondidas deixam de pulsar. Rede indisponível, navegador encerrado, bloqueio de coleta ou limite de taxa podem reduzir a contagem.

A coleta anônima não comprova identidade humana e pode receber eventos artificiais dentro dos limites impostos. Não participa de autorização de atlas. A fila de uso conserva no máximo trinta lotes por até um dia; descartes são contados. A telemetria de erros mantém sua própria fila e continua sendo melhor esforço.

Os logs permanecem restritos à administração e podem conter IP, identificador de sessão, rotas e mensagens de diagnóstico. A remoção de credenciais não é um classificador universal de texto sensível escrito livremente numa mensagem. A retenção de arquivos e ocorrências continua oportunista; sem atividade, a limpeza só acontece quando o serviço retoma. Os agregados diários de uso têm retenção histórica, conforme a política existente.

Não foi feita medição de carga de produção, de todos os navegadores ou de um proxy real. Falha física de disco, remoção externa dos arquivos e encerramento forçado do processo continuam podendo eliminar o final do log; os mecanismos de aviso e prazo de descarga não prometem durabilidade absoluta.

## Resultado final da validação

- Frontend: 721 arquivos, 13.349 testes aprovados.
- Backend: 5.298 testes aprovados, zero falhas e zero pulados; 98,31% de cobertura de linhas.
- Contrato com servidor real: 67 arquivos, 249 testes aprovados.
- Chromium: cinco importações dos acervos fornecidos, três cenários de interrupção/quota/publicação, um ciclo completo de diagnóstico e o guarda de backend real aprovados, sem retries.
- `npm run lint` e `npm run build` da raiz aprovados. O build mantém os avisos de tamanho de chunks.
- Guarda de documentação e de execução real do E2E: 14 testes aprovados; controle de estabilidade do cursor: vinte rodadas consecutivas aprovadas.

As três camadas de `npm test` foram executadas separadamente para isolar os bancos e diretórios de teste. Comandos: `npm test --prefix frontend`, `npm test --prefix backend -- --keep-db`, `npm run test:e2e --prefix frontend`. Os bancos do backend foram nomeados por `TEST_DB_NAME`; o contrato usou `EBGEO_E2E_DB_NAME` e o Chromium, `EBGEO_UI_E2E_DB_NAME`.

O PostgreSQL desta bancada voltou a aguardar `ProcSignalBarrier` na exclusão dos bancos descartáveis do contrato e Chromium, depois das asserções. Apenas os `DROP DATABASE` desses bancos de teste foram cancelados para permitir o encerramento; nenhum teste foi dispensado. Logs, capturas e bancos de teste não foram incluídos no commit.
