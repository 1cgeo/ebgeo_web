# Monitoramento administrativo e consolidação do backend

Commit conferido: `fa0f0218`. Detalhes e capturas no [registro de implementação](../2026-09-12-implementacao-monitoramento.md).

## Problemas e correções

O administrador não tinha a visão solicitada de presença anônima/autenticada, último login e propriedade de atlas. A coleta também perdia resultados sem gestos, podia atribuir lotes à identidade errada e possuía problemas nas medidas de desempenho e denominadores de uso.

Usuários e Uso passaram a exibir contas distintas autenticadas e navegadores anônimos observados nos últimos 90 segundos. O navegador emite pulso a cada 30 segundos; o painel atualiza a cada 15. Abas compartilham um identificador quando o armazenamento está disponível. Usuários mostra último login e atlas remotos dos quais a conta é dona; lixeira e compartilhamentos recebidos não entram no número principal.

A coleta começa antes da preparação local e inclui falhas de migração, resultados de sync e descarte confirmado. Lotes sem acionamentos atualizam erros/vitais, preservam a identidade original e usam confirmação/deduplicação de entrega. Foram corrigidos CLS, INP, atualização de LCP, categorias de medidas e denominadores de rankings. A telemetria não contém textos, imagens ou geometria dos atlas.

As migrações anteriores à primeira implantação foram consolidadas por domínio. O migrador recusa históricos incompatíveis antes de aplicar pendências; não apaga, renomeia ou reinicializa esses bancos. Mudanças posteriores do dia acrescentaram estruturas de sync, camadas remotas e identidade de catálogo à base vigente.

Entradas: `frontend/src/js/admin/presenca-panel.js`, `frontend/src/js/session/uso-transporte.js`, `backend/src/modules/uso/uso.presenca.js`, `backend/src/modules/users/users.queries.js` e `backend/src/database/migrate.js`.

## Evidência e limites

O registro histórico inclui 12.141 testes frontend, 201 contratos, dois cenários Playwright e capturas inspecionadas. A rodada de backend daquela implementação teve uma falha na contraprova de concorrência; o teste foi corrigido e passou dirigido. Não apresentar aquela rodada como suíte integralmente aprovada. Rodadas completas posteriores estão no [índice do dia](README.md).

Presença anônima mede navegadores observados, não pessoas exatas. Falha de coleta não prova ausência de usuários. A sonda externa foi criada, mas seu agendamento na rede interna não foi executado. Permanecem as [validações e integrações dos indicadores](../fechamento/07-indicadores-e-administracao.md).
