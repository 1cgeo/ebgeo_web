# Execução da correção do atlas remoto

Início: 12/09/2026, branch `integracao_backend`, base `fa0f021891b785b61c45fd8aedc51f20a99a0950`.
Autorização: “PODE EXECUTAR”. Referência: [plano aprovado](plano-correcao-atlas-remoto.md).

## Estado intermediário: não liberado

O plano permanece incompleto e este estado não está liberado para produção. O checkpoint anterior tinha 24 falhas de contrato, resolvidas na continuação descrita abaixo. Após a correção das camadas remotas, a suíte completa da raiz passou: 12.219 testes de frontend, 5.039 de backend e os 201 contratos, sem falhas. Nenhuma implantação foi realizada. As pendências atuais estão na [avaliação para lançamento](pendencias-lancamento.md); os resultados intermediários abaixo são históricos.

| Área | Implementação em andamento | Validação / trabalho restante |
| --- | --- | --- |
| Fila | Sem expiração ou compactação destrutiva; sequência IndexedDB atômica; envelopes imutáveis; handles vinculados ao escopo | Regressões e contratos passaram; migração e deduplicação de filas antigas ainda pendentes |
| Recibos | Tabela independente do histórico, principal e hash; resultados de sucesso, recusa e conflito persistidos | Quatro regressões de recibos passaram; bloqueio de clientes incompatíveis e revisão final da autorização |
| Materialização | Intenção antes de feições/comentários; estágio preparado bloqueia envio até materialização | Quatro testes novos passaram; demais produtores, recovery completo e isolamento de geração |
| Recepção | Cursor após aplicação; primeiro handshake pede replay; fechamento antigo não derruba socket novo; tombstone de feição | Correção do teste de cursor; coordenação completa e cursor durável |
| Snapshot | Transação consistente no servidor; substituição de mapas/briefings; projeção de pendências; preparação em geração separada e ativação conjunta de ponteiro/cursor | Sete regressões nativas passaram; falta homologação com clientes reais, concorrência entre abas, limpeza de gerações antigas e cobertura dos demais produtores |
| Recusas | Registro durável junto da operação original; excluído de envio automático | Painel de resolução, dependências e aplicação canônica |
| Rede | Trava do auto-flush antes do primeiro await; backoff; limites de requisição incluindo corpo; cancelamento por sessão | Testes de rede degradada, progresso e saída |
| Conflitos/anexos | Patches e revisões por campo para feições; comandos explícitos de movimento e restauração | Oito regressões PostgreSQL e contratos passaram; demais tipos, UI, compatibilidade e uploads ainda pendentes |

## Evidências intermediárias

- `queue-journal-atomic.test.js`: sequência entre handles, rollback integral de lote inválido, recuperação sem duplicar e imutabilidade.
- `write-ahead-intent.test.js`: intenção antes da entidade, falha entre as escritas, falha de diário impede persistência/UI, edição sem logging não cria fila remota.
- `sync-delivery-receipts.test.js`: conteúdo diferente sob o mesmo ID é recusado; retry após limpeza mantém a versão nova; criação sem mapa é recusada.
- A bateria `sync*.test.js` do backend passou com 462 testes antes da expansão de conflitos por campo. A suíte completa precisa ser repetida depois das mudanças finais.
- `sync-feature-conflicts.test.js`: nome/geometria independentes, disputa do mesmo campo após limpeza, tombstone, dependência de recibo anterior e versão externa sem fronteira comprovada.
- `feature-patch-intent.test.js`: patch mínimo, ausência de base não inventada e dependência durável entre edições offline.
- `repository-captured-scope.test.js`: troca de atlas durante resolução assíncrona mantém o destino original da gravação.
- `snapshot-generation.test.js`: corte após gravação parcial, falha de quota na ativação, snapshot incompleto, troca de atlas durante preparação, reabertura com intenção preparada, estabilização de escritor iniciado e isolamento de versões/guardas entre montagens. Sete testes passaram com IndexedDB simulado pela implementação nativa do `fake-indexeddb`; ainda não substituem Playwright.
- A recepção mantém operações adiadas até aplicação bem-sucedida e aceita múltiplos aguardadores do mesmo reenvio. Limite de buffer causa erro para recuperação, em vez de descartar a operação mais antiga silenciosamente.
- A bateria de handler, namespaces/repositório e engine passou com 201 testes antes da última ampliação dos guardas. A bateria posterior do handler/engine/snapshot também passou; a verificação final completa continua pendente.
- `queue-issue-dependencies.test.js`: recusa bloqueia descendentes, permite trabalho independente e mantém IDs opacos com prefixo numérico.
- O handler também passou a rejeitar snapshot malformado antes de escrever, aplicar o resultado canônico do próprio autor e aguardar uma edição remota adiada sem bloquear o ACK que a libera.
- A primeira suíte completa do frontend após as alterações mostrou 90 falhas e 12.065 acertos. Inclui doubles de transação desatualizados, expectativas de poda/compactação, leitura de metadados como se fossem operações e problemas ainda em investigação. Esse resultado NÃO é aprovação.
- Após corrigir os casos identificados e atualizar os doubles para a gravação de intenção, a suíte completa do frontend passou: **635 arquivos, 12.193 testes, zero falhas**, em 12/09/2026 às 14:59 do ambiente. Isso verifica o estado intermediário, não as partes do plano ainda ausentes.
- O cursor de retomada do WebSocket agora avança em respostas completas de replay, não por mensagens ao vivo isoladas: a versão maior de um broadcast não comprova a entrega de commits menores de outros controladores. A regressão simula essa ordem inversa e exige replay do commit ausente.
- Novos testes do auto-flush cobrem a trava antes da leitura assíncrona da fila, reinício durante envio anterior pendurado e Retry-After sem atalho por evento de edição. Os testes de aviso passaram a usar o relógio da espera exponencial, com jitter determinístico.
- A bateria posterior `sync*.test.js` do backend passou com **468 testes, zero falhas e zero skips**, incluindo os recibos de recusa e os conflitos de feições. O runner encerrou com código zero e removeu apenas o banco descartável `ebgeo_test`.
- O lint completo da raiz passou novamente após as últimas mudanças de lógica. Ainda não foi executado o `npm test` completo da raiz neste estado, nem a homologação de UI/build/migração prevista no plano.

## Correção do instrumento de diagnóstico

A sonda original de exclusão na revisão usava GeoJSON com `id` apenas na raiz; o handler real identifica feições por `properties.id`. O teste permanente foi corrigido e agora confirma que a exclusão realmente ocorreu antes de tentar a recriação antiga. O teste de cursor também passou a conferir o cursor e o fechamento após falha, evitando usar acidentalmente o pedido de replay do handshake como evidência da recuperação. Os controles negativos retirando temporariamente a proteção de tombstone e antecipando o cursor falharam como esperado; o código correto foi restaurado e os testes passaram novamente. A validação final dos fluxos completos continua pendente.

## Para concluir

Concluir todas as entregas do plano; resolver as falhas sem skips; executar lint e teste completos da raiz após a última mudança, build, contratos, Playwright real e inspeção de imagens. Usar somente cópias dos dados de teste. Preparar transição explícita dos bancos de desenvolvimento e roteiro/rollback da rede interna. A validação no servidor interno continua fora do alcance desta sessão.


## Verificacao do checkpoint de 12/09/2026

- Ultima execucao completa de `npm test` na raiz: **codigo 1**. Frontend: **12.193 testes aprovados**; backend: **5.027 aprovados, zero falhas/skips**; contratos: **177 aprovados e 24 falhas, 201 no total**.
- A primeira rodada completa havia encontrado nove falhas de backend. Foram corrigidos o inventario dos novos JSONB e as expectativas do envelope canonico e da ausencia de rebroadcast em retries. A bateria WebSocket posterior passou com 219 testes e a repeticao completa aprovou todos os 5.027 testes do backend.
- As falhas de contrato incluem operacoes v2 construidas sem base confirmada/patch, a expectativa antiga de ignorar o retorno canonico ao proprio autor e incompatibilidades ainda REAIS de conversao, movimentacao entre mapas e desfazer/refazer com o novo bloqueio de recriacao. Nao foram ocultadas com skips nem tratadas como aprovacao.
- `npm run build` terminou com codigo zero. Os testes posteriores de tamanho da pagina e integridade documental passaram: 56 testes.
- O lint completo passou (codigo zero) depois das adaptacoes dos testes WebSocket. A assercao de colecao nao vazia exigida pelo lint tambem foi verificada pela repeticao do teste de broadcast 3D/360, com codigo zero.
- Proximo trabalho: resolver os contratos e completar comandos explicitos de conversao/movimentacao/restauracao; impedir gravacoes atrasadas de uma sessao remota descartada, inclusive apos novo login. Os prototipos de protecao de escrita ainda estao fora do codigo do produto neste checkpoint.


## Continuacao apos o push f8e109ea

O checkpoint `f8e109eacf8e276b66d72027d1359a295347ad33` foi enviado a `origin/integracao_backend` e conferido por `git ls-remote`. As mudancas desta secao sao posteriores a esse commit.

- Descarte explicito persiste uma epoca por namespace remoto antes do registro assincrono. Montagens, repositorios, filas, transacoes de edicao e aplicacoes de sincronismo capturam essa epoca; uma nova entrada nao revalida callbacks antigos. Uma falha no registro assincrono pode ser recuperada pela marca persistida antes dele.
- Escritas, exclusoes e limpezas dos handles protegidos conferem a epoca dentro do callback nativo do IndexedDB, antes da transacao. A limpeza administrativa dos namespaces continua usando os handles de descarte. Atlas locais, inclusive adotados com sufixo remoto, ficam fora da invalidacao.
- O diario clona os envelopes antes de aguardar armazenamento. O retry do dispatcher conserva o mesmo ID, conteudo e escopo; nao recria uma operacao sob o atlas atualmente aberto. Preferencias remotas capturam o atlas antes de qualquer import assincrono.
- A confirmacao de saida pausa novos escritores coordenados e novos auto-flushes desta aba. Aguarda os escritores/envios iniciados; apos tres segundos sem estabilizar, pede confirmacao com contagem desconhecida. Cancelar libera as pausas. O aviso explica que uma solicitacao ja recebida pelo servidor pode concluir depois da saida.
- Testes nativos reproduzem callback atrasado removendo dados de uma nova sessao, diario atrasado, retry apos troca/descarte, falha parcial de registro e isolamento de atlas locais/remotos. Controle negativo retirando somente a checagem antes da transacao: a entidade da nova sessao virou `null` e o teste falhou; a protecao foi restaurada.
- Playwright com app e backend reais: quatro testes aprovados, zero retries/skips, incluindo o guarda de backend, cancelamento/confirmacao com atlas local ou remoto montado e saida em outra aba. A imagem do aviso foi inspecionada. A execucao final depois das ultimas adaptacoes esta registrada abaixo.

Limites desta etapa: a pausa anterior ao dialogo ainda nao constitui uma barreira transacional entre todas as abas; produtores legados e escritores que bypassam os handles protegidos precisam da cobertura restante do plano. As 24 falhas de contrato do checkpoint, comandos explicitos de restauracao/movimentacao/conversao, UI de conflitos, anexos e homologacao completa de migracao continuam pendentes. Esta secao nao libera producao.


### Resultado da verificacao desta continuacao

- Build final concluido com codigo zero; depois dele, suite completa do frontend: **639 arquivos, 12.212 testes aprovados, zero falhas**, codigo zero.
- Playwright repetido apos a separacao do modulo de pausa: **4 aprovados, zero retries/skips**, codigo zero. Imagens dos avisos com atlas local/remoto aberto inspecionadas.
- Duas rodadas intermediarias nao sao aprovacao: o import inicial da pausa trouxe o motor do mapa para paginas leves (corrigido e coberto pelo teste de grafo); executar build/testes/lint simultaneamente produziu leituras de arquivos temporariamente ausentes. A rodada valida do frontend foi executada somente depois de o build terminar; o lint foi repetido em separado.
- Backend e contratos nao foram reexecutados nesta continuacao, que alterou apenas cliente e documentacao. O ultimo resultado da raiz continua sendo o checkpoint com **24 falhas de contrato**. Nenhum resultado acima as resolve nem substitui a homologacao completa pendente.
- Estas alteracoes posteriores ao `f8e109ea` permanecem locais, para a proxima etapa do plano.

## Correção das 24 falhas de contrato

- Movimentação e restauração de feições agora declaram a intenção e comprovam a revisão corrente. Uma criação comum continua sem poder sobrescrever um item vivo ou ressuscitar uma exclusão. Movimentar também verifica o mapa de origem e sua trava; o retorno canônico informa a origem para removê-la dos clientes.
- Desfazer/refazer conserva uma referência mínima à última operação da feição mesmo após o ACK remover a linha da fila. A restauração pode referenciar o recibo durável da exclusão; uma exclusão mais recente invalida esse comando antigo.
- Os contratos de edição passaram a obter a base confirmada do servidor. O caso concorrente exige conflito para o mesmo campo e só aceita reaplicação deliberada contra a base atual. Os casos offline montam o namespace remoto antes de produzir a fila e usam IndexedDB transacional no ambiente de teste.
- Contratos: **201 aprovados, zero falhas, 57 arquivos**, processo encerrado com código zero. A primeira rodada intermediária aprovou 199 e ainda falhou nos dois casos offline; não foi tratada como aprovação.
- Regressões de backend: **8 aprovadas**, incluindo movimento obsoleto, origem travada e restauração após limpeza do histórico. A regressão do cliente também comprova que um replay de movimento antigo não recria a feição no mapa anterior.
- Controle negativo: removida temporariamente somente a exigência de revisão exata dos comandos, os testes de movimento e restauração obsoletos falharam com resultado aplicado onde exigiam conflito. O arquivo original foi restaurado byte a byte; a execução final usa a proteção restaurada.

Esta etapa não implementa atomicidade de grupos inteiros de conversão/transferência, nem conclui o painel de conflitos, os demais tipos colaborativos ou a compatibilidade de clientes legados. Essas entregas permanecem no plano aprovado.

### Achado adicional no navegador: camada sintética

O cenário de trava usava a camada sintética de identificador default. A consulta ao PostgreSQL descartável confirmou recibos recusados para esse identificador, com motivo de formato inválido. A trava podia aparecer brevemente no cliente e desaparecer na reconciliação. Naquela rodada, a conversão foi validada com uma camada real criada explicitamente. A correção posterior cria a camada no servidor junto com o mapa; o teste de trava voltou a usar a camada inicial. O comportamento e a regularização dos dados estão em [camadas remotas](camadas-remotas.md).

### Verificação da correção de contratos

- Movimentação entre mapas com desfazer/refazer e conversões entre tipos passaram em três execuções consecutivas. O teste de isolamento passou a confirmar a criação do mapa estrangeiro, carimbado com seu próprio atlas, e aguardar a projeção persistida antes de medi-la.
- A rodada final de trava em camada remota válida e dois ciclos de desfazer/refazer aprovou **9 testes, zero falhas/retries/skips**, em três repetições. A captura do outro cliente após refazer foi inspecionada, com a feição visível e indicação de envio concluído.
- As rodadas intermediárias de navegador não são aprovação integral: revelaram a camada sintética inválida, uma leitura sem aguardar a projeção e um getter inexistente na sonda. O teste da camada remota agora comprova a persistência da trava nos dois clientes; a limitação da camada sintética está preservada acima.
- Build e lint completos passaram. A primeira execução final da raiz parou no frontend com **12.213 aprovados e uma falha** em uma propriedade aleatória de centroide. A premissa do teste foi corrigida para comparar anéis explicitamente fechados, com o contraexemplo guardado; o cálculo geográfico do produto permaneceu igual.
- Repetição final de `npm test` na raiz: **código zero**, com **12.214 testes de frontend, 5.030 de backend e 201 contratos aprovados**. O backend encerrou sem falhas, cancelamentos ou skips. Os contratos encerraram com 57 arquivos aprovados e zero falhas, após as últimas mudanças de lógica.
- As alterações daquela rodada ficaram locais, posteriores ao checkpoint enviado. A aprovação resolveu as 24 falhas de contrato; as demais entregas do plano continuaram pendentes. A camada sintética foi tratada na etapa abaixo.

### Correção da camada padrão remota

A camada passa a ser gravada no servidor junto com o mapa, incluindo o mapa inicial da criação de atlas e a substituição da última camada excluída. O ACK, o broadcast e o replay levam a mesma identidade. Importação e cópia completam mapas sem camada; a regularização dos dados antigos mantém configurações existentes e o conteúdo das feições. O navegador continua sintetizando default apenas para atlas locais. Detalhes em [camadas remotas](camadas-remotas.md).

- Testes direcionados: **75 aprovados**, incluindo as oito novas regressões do backend, a movimentação que declara o destino no conteúdo da operação e o isolamento de referências na importação.
- Controle negativo: retirar temporariamente a criação da camada no comando estrutural causou **cinco falhas** nas novas regressões. O arquivo foi restaurado byte a byte.
- Navegador: **9 aprovados em três repetições**, zero falhas, retries ou skips. Dois clientes verificaram criação de mapa, UUID no PostgreSQL, edição offline de nome/opacidade, reconexão, exclusão da última camada e reentrada. A captura da nova feição na camada Padrão após reentrada foi inspecionada. A trava de conversão usa a camada inicial criada pelo servidor.
- Rodadas intermediárias: seis falhas de backend motivaram a atualização de premissas e a correção da validação do mapa de destino. Nos contratos, seis cenários usavam UUIDs sem camadas existentes; passaram a obter a identidade real do servidor. O primeiro teste novo de navegador foi corrigido para chamar a fachada pública de exclusão.
- A revisão dos recibos acrescentou a nona regressão do backend: resolver uma camada implícita trabalha sobre uma cópia, sem modificar o envelope recebido que identifica o reenvio. As nove regressões passaram; retirar a cópia causou exatamente uma falha, reproduzindo a recusa indevida do reenvio. O código foi restaurado e a suíte completa reiniciada após a última alteração de lógica.
- Rodada completa final da raiz: **código zero**, com **12.219 testes de frontend, 5.039 de backend e 201 contratos aprovados**, sem falhas nem skips. Build e lint completos também passaram. Esta etapa não publica o backend nem conclui as outras entregas do plano de sincronização.
