# Indicadores de sincronização e visão administrativa

Status: pendente. Prioridade: bloqueia lançamento. Depende de [conflitos](03-conflitos.md), [coordenação de sessão](05-abas-e-recuperacao.md) e [uploads](06-uploads.md).

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

## Aceite

Fila vazia com conflito ou upload mantém estado pendente; snapshot ainda não aplicado não fica verde. Duas abas do mesmo usuário, visitante anônimo, logout, expiração e perda da telemetria produzem contagens coerentes. Administrador identifica cliente sem progresso sem acessar conteúdo. Rodar testes reais de presença/monitoramento, Playwright da administração e da sincronização, inspecionando as capturas.
