# Pendências para lançamento

Avaliação de 12/09/2026, branch `integracao_backend`, após as correções de contratos, descarte remoto e camada padrão no servidor. Complementa o [plano aprovado](plano-correcao-atlas-remoto.md) e seu [registro de execução](execucao-correcao-atlas-remoto.md). **Ainda não liberar para todos os usuários.**

Ordem de execução, dependências, segurança e critérios de aceite detalhados no [plano de fechamento para lançamento](plano-fechamento-lancamento.md).

## Correções restantes

| Prioridade | Pendência e evidência atual | Critério de conclusão |
| --- | --- | --- |
| 1 | Completar registro durável da intenção antes de alterar todas as entidades. `map.operations.js` persiste alterações antes de chamar `logMapOperation`; produtores de camadas também precisam entrar no mesmo fluxo protegido. | Interrupção ou quota entre as etapas não deixa edição aparentemente salva sem operação recuperável; abranger todos os produtores. |
| 1 | Fechar compatibilidade de clientes e filas antigos. `sync.schemas.js` aceita ausência de `protocolVersion`; a proteção por base de feição em `sync.service.js` só entra para v2. | Cliente incompatível não consegue sobrescrever silenciosamente; filas antigas têm transição explícita, preservando identidade dos reenvios e origem dos dados. |
| 1 | Expandir conflitos além de feições e oferecer resolução persistente na interface. `prepareFeatureMutation` é aplicado apenas a feições v2; `operation-queue.getIssues()` ainda não tem consumidor na interface. | Camadas, mapas, grupos, slides e demais entidades têm proteção adequada; usuário vê item, motivo e alternativas, inclusive após F5. Reaplicar usa nova base e nova operação. |
| 1 | Tornar comandos estruturais compostos recuperáveis ou atômicos. A aprovação dos contratos de conversão, movimento e desfazer/refazer cobre os fluxos exercitados, sem concluir a entrega de atomicidade do conjunto. | Falha no meio de conversão, transferência integral ou lote não deixa metade do comando aplicada nem duplica seu efeito na retomada. |
| 1 | Concluir fila durável de imagens e confirmação de sincronização. `image-sync.js` ainda avisa que falha de upload deixa a imagem somente local e pede reinserção; não possui fila de retry de blobs. | Upload retoma após F5/resposta perdida, peers leem o recurso; indicador inclui uploads, recuperação e conflitos. Administração acompanha quantidade, idade e ausência de progresso sem conteúdo dos usuários. |

## Homologação necessária antes da liberação

- Repetir a migração final do commit de produção da `main` para o conjunto final da integração, no mesmo protocolo e domínio, usando cópias de `_ebgeo_dados_teste`. Incluir meses sem acesso simulados, aba/build antigo aberto e interrupção durante migração; conferir conteúdo, exportação e reabertura, preservando a origem até validação.
- Exercitar múltiplas abas no logout e na troca de atlas. A época de descarte protege callbacks antigos, mas a pausa anterior ao diálogo coordena a aba atual; falta concluir a barreira entre abas e verificar escritores que possam contorná-la. Cancelar a saída preserva o trabalho; confirmar descarta somente pendências remotas abrangidas, sem apagar atlas locais ou dados do servidor.
- Completar a matriz com dois e três clientes: resposta perdida após commit, 429/503, reconexão durante snapshot, aba suspensa, F5, fila acima de 10.000, pouco espaço e mudança de permissão. Comparar PostgreSQL, IndexedDB, memória e renderização; fila vazia não basta. Verificar limpeza de gerações antigas sem remover a ativa.
- Na rede interna, validar frontend/backend/migrações como conjunto compatível, proxy e WebSocket, contas e permissões, backup com restauração ensaiada, piloto e monitoramento. Definir rollback compatível com os novos dados; voltar apenas o frontend não é garantia de retorno seguro. Bancos com histórico antigo de migrações exigem transição deliberada, sem reset automático.

## Evidência disponível

Após a última mudança de lógica: `npm test` da raiz aprovado (12.219 frontend, 5.039 backend, 201 contratos); lint e build aprovados. A rodada de navegador com backend real aprovou nove execuções em três repetições, sem retries/skips, cobrindo camadas remotas e trava de conversão, com captura inspecionada. Os detalhes e controles negativos estão no registro de execução. Esses resultados não substituem as correções e a homologação acima; o servidor interno não foi acessado nem atualizado nesta sessão.
