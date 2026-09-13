# Homologação final e migração main para integração

Status: pendente. Prioridade: bloqueia lançamento. Depende das correções 01 a 08 do [índice](README.md).

## Base e ensaios existentes

O usuário informou produção na main e manutenção de protocolo/domínio. Main conferida nesta execução: `8b611113aa73c3faedc967ccf77132604255ea8d`. Confirmar novamente ao fixar o candidato. Já há ensaios no [registro de migração](../execucao-correcao-migracao-2026-09-12.md), no [plano de migração](../plano-correcao-migracao-main-integracao-backend.md), em `frontend/tests/e2e-ui/browser-migracao-2.2.spec.js` e `frontend/tests/e2e-ui/migration-external-data.scenario.js`. Ampliá-los para o conjunto final, sem ignorar a evidência anterior.

## Execução

1. Criar cópias verificadas dos dados em C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\_ebgeo_dados_teste. Usar bancos e perfis descartáveis. Não alterar os originais nem misturar o banco de testes com desenvolvimento/produção.
2. Subir a main, criar/editar dados e preferências pela UI, fechar ou suspender clientes. Substituir o servidor pelo candidato e reabrir o mesmo perfil na mesma origem completa, incluindo porta.
3. Simular meses sem acesso, aba antiga aberta, cache/service worker quando existente, interrupção entre etapas e várias reaberturas. Conferir conteúdo, referências, imagens e exportação/reimportação; preservar a origem até validar o destino.
4. Executar dois e três clientes com disputa de entidade/campo, exclusão, bloqueio, movimento, importação e undo/redo em todas as famílias. Incluir 429/503, resposta perdida após commit, reconexão durante snapshot, suspensão, relógio alterado, fila acima de 10.000 e pouco espaço.
5. Comparar PostgreSQL, IndexedDB, memória, renderização e exportação por conteúdo e relações. Fila vazia e contagens iguais não provam convergência. Usar barreiras determinísticas e controles negativos restaurados; repetir corridas em série, sem retries ocultos.

## Evidência e aceite

Registrar cada célula com SHAs, entrada, falha injetada, estado esperado/observado, log e captura. Após a última mudança de lógica, rodar lint e teste completos da raiz separadamente, build e Playwright real. Build não pode concorrer com testes que inspecionam dist; suítes com banco são sequenciais. Toda célula obrigatória precisa de aprovação; limitação não resolvida impede liberação. O ensaio local não substitui a conferência na origem interna real.
