# Indicadores de sincronização e visão administrativa

Status: executado em 2026-09-13 (bloco B9), à espera de validação com telemetria real. Prioridade: bloqueia lançamento. Depende de [conflitos](03-conflitos.md), [coordenação de sessão](05-abas-e-recuperacao.md) e [uploads](06-uploads.md).

## O que já existe

Presença autenticada/anônima, métricas de uso, última autenticação e contagem de atlas remotos já foram implementadas no trabalho anterior, registrado em [monitoramento](../2026-09-12-implementacao-monitoramento.md). Não reconstruir esse sistema. Falta validar os critérios finais e integrar os novos estados de sincronização, recuperação e upload.

Pontos de entrada: `frontend/src/js/account/sync-status.control.js`, `frontend/src/js/session/pendencias-monitoramento.js`, `frontend/src/js/store/sync/operation-queue.js`, `backend/src/modules/uso/uso.presenca.js` e [wiki de observabilidade](../../wiki/observabilidade.md).

## Correção

1. Diferenciar salvo neste computador, aguardando envio, recuperando, conflito, recusa, upload pendente e sincronizado. O estado final depende do cursor aplicado e de todas as pendências conhecidas, não apenas da quantidade de envelopes na fila.
2. Conservar acesso ao detalhe da pendência após o toast. Apresentar motivo e ação possível sem indicar sucesso prematuro ou esconder erro de quota.
3. Acrescentar quantidade/idade de pendências, conflitos, recusas, uploads e tempo sem progresso aos diagnósticos existentes. Correlacionar build/protocolo e falha de persistência. Não coletar textos, imagens, geometria ou conteúdo dos mapas.
4. Validar as contagens de autenticados e anônimos com janela de expiração explícita e deduplicação de abas quando possível. Sessões/dispositivos anônimos observados não são uma contagem exata de pessoas.
5. Na tela de usuários, conferir última autenticação separada de última atividade. Conferir a regra vigente da contagem de atlas remotos, distinguindo posse e acesso compartilhado conforme o produto já implementado; não trocar a definição silenciosamente.
6. Falha de telemetria ou banco deve aparecer como indisponibilidade da fonte, nunca como zero usuários ou zero problemas.

## O que fechou em 2026-09-13 (bloco B9)

Três commits sobre `plano/b9`.

1. **A luz de sync ganhou os estados que faltavam, e o verde passou a exigir tudo aplicado (F14).** `SYNC_WORK_STATE` ganhou `recuperando`, `conflito`, `recusa` e `upload-pendente`, e `describeSyncWork` passou de três entradas para sete: além de origem, conexão e a contagem enviável, ela recebe `problemas` do censo da fila, a contagem da quarentena global, as pendências abertas de upload de figura e o sinal de recuperação em curso. O verde exige conexão, zero enviáveis, zero preparadas, zero problemas, zero quarentena, zero uploads e nenhuma recuperação, e qualquer leitura que falhe cai em desconhecido em vez de zero. O sinal de recuperação vem de `storeWritesPaused`, leitor puro novo em `frontend/src/js/store/write-coordinator.js`, lido no momento da pintura porque uma recuperação começa e termina entre duas batidas do mostrador.

2. **Um leitor só para as duas telas, alcançando as quatro páginas (F23, metade do leitor).** `frontend/src/js/session/pendencias-monitoramento.js` deixou de ser apenas o instalador do pulso e passou a ser o leitor, com duas portas sobre a mesma contagem: o total do navegador (para a presença) e as pendências do atlas montado (para a luz). A luz deixou de varrer por conta própria. A instalação nas quatro páginas já vinha do bloco B7b, que pôs o portão de migração nas quatro entradas e é dentro do ramo de sucesso dele que o leitor entra em serviço; o que faltava era a rede que impede isso de voltar a ser duas páginas, e ela é `frontend/tests/unit/pendencias-leitor-unico.test.js`.

3. **Presença em camelCase, método público e sonda agendável e lida (F23, metade da sonda).** `resumoPresenca` devolve o documento inteiro em camelCase, com as somas `bigint` convertidas para número e o desconhecido de idade preservado como `null`; o painel lê só essa forma, por `apiClient.getPresencaAgora()` em vez do método privado do cliente HTTP. A sonda de disponibilidade ganhou script npm (`diag:sonda`), seção no roteiro de instalação e leitor: `backend/src/modules/diag/sonda.service.js` alimenta um sub-bloco `sonda` dentro do bloco de indisponibilidade, nas duas portas do resumo, dizendo "sem sonda" quando não há arquivo, nunca zero queda, e publicando a premissa (onde ela roda, e o número de medições ao lado do de indisponíveis).

O que NÃO foi feito, e por quê:

- **A tela de pendências não existe ainda.** Ela é o item 6 do bloco B3, e as frases dos estados novos nomeiam a quantidade e o que fazer sem apontar para uma tela que não está no produto: apontar para ela seria prometer uma superfície inexistente.
- **A conciliação por conflito de conteúdo continua fora.** `conflito` e `recusa` separam-se pelo LUGAR (registro global preservado contra problema vivo na fila), não pelo motivo; a distinção fina por motivo é do bloco B5.
- **A validação com telemetria real na rede interna continua pendente**, e é o que falta para o aceite abaixo: duas abas, visitante anônimo, logout, expiração e perda da telemetria produzindo contagens coerentes, com captura do Playwright inspecionada.

## Aceite

Fila vazia com conflito ou upload mantém estado pendente; snapshot ainda não aplicado não fica verde. Duas abas do mesmo usuário, visitante anônimo, logout, expiração e perda da telemetria produzem contagens coerentes. Administrador identifica cliente sem progresso sem acessar conteúdo. Rodar testes reais de presença/monitoramento, Playwright da administração e da sincronização, inspecionando as capturas.
