# Liberação interna, backup e retorno

Status: pendente. Prioridade: bloqueia lançamento. Depende da [homologação final](09-homologacao-e-migracao.md) e de responsável com acesso à rede interna. O servidor interno não está acessível nesta sessão.

## Preparação concreta

1. Fixar versões compatíveis de frontend, backend, schema e runtime; registrar SHAs, artefatos, ordem de instalação, pré-condições, responsável e duração medida em ensaio. Distinguir instalação nova, banco de desenvolvimento antigo e atualização de banco válido.
2. Para bancos existentes, aplicar deliberadamente a transição aditiva da coluna textual do histórico descrita no [registro de execução](../execucao-fechamento-lancamento.md), após backup. A base lógica consolidada não atualiza sozinha um banco que já registrou a migração. Não resetar banco ou reescrever histórico automaticamente.
3. Ensaiar backup e restauração de PostgreSQL e arquivos referenciados, incluindo imagens e recursos 3D/360. Restaurar em ambiente separado e comprovar acesso/conteúdo, não apenas sucesso do comando. Backup do servidor não protege dados que só existem no navegador.
4. Verificar proxy, WebSocket, cache, TLS, limites/timeouts, espaço, permissões de volumes e serviços necessários. Testar contas com papéis reais e acesso aos diagnósticos. Conservar a origem usada pelos clientes.

## Piloto e retorno

Definir retorno antes de abrir escrita. Preferir versão anterior compatível ou correção progressiva. Se depender de restaurar backup, suspender escritas e tratar explicitamente alterações feitas depois dele; restauração não é retorno sem perda por padrão. Não voltar apenas o frontend para a main se ela não entender o estado local novo.

O piloto cobre usuários locais antigos, autenticados e anônimos, além de colaboração remota. Definir amostra e duração pelo volume e pela matriz, registrar quem acompanha erros, filas, latência, armazenamento e presença. Expandir somente após conferir integridade e estabilidade.

## Interrupção e aceite

Suspender expansão diante de perda/duplicação, divergência, acesso indevido entre atlas, migração incompleta, upload inacessível ou indicação falsa de sincronização. Registrar diagnóstico e responsável pela decisão.

Encerrar somente com restauração comprovada, verificação da infraestrutura real, piloto observado e aprovação do conjunto compatível pelo responsável interno. Preencher evidências reais, sem marcar esta tarefa concluída porque o roteiro está pronto. Esta documentação não executa deploy nem aprova a liberação.
