# Plano de fechamento para lançamento

Data: 12/09/2026. Base: `e70ccf3c245ba99ba8757ebcbf8eca072a9f6cd6`, branch `integracao_backend`. Status: implementação interrompida a pedido do responsável após três checkpoints, para conservar limite. Evidências no [registro de execução](execucao-fechamento-lancamento.md); trabalho restante separado em [dez documentos de retomada](fechamento/README.md).

Este documento organiza as [pendências para lançamento](pendencias-lancamento.md), incluindo a triagem de dependências. Complementa o [plano de sincronismo](plano-correcao-atlas-remoto.md), sem substituir suas garantias, e reaproveita as correções e evidências do [registro de execução](execucao-correcao-atlas-remoto.md). A migração parte também do [plano main → integração](plano-correcao-migracao-main-integracao-backend.md). Não repetir como trabalho pendente as 24 falhas de contrato resolvidas nem a criação da camada padrão, agora feita pelo servidor.

## Regras que não mudam

- Logout voluntário com confirmação descarta as pendências remotas abrangidas pelo aviso, incluindo conflitos e uploads. Nada disso é reenviado no próximo login. A saída não apaga dados do servidor nem atlas locais.
- Queda de rede, F5, suspensão e expiração de autenticação não são consentimento para descarte. Trocar de atlas também não autoriza descarte implícito. Pendência antiga exige validação de compatibilidade e conflito antes de qualquer envio.
- Nunca atribuir uma base atual inventada a uma edição antiga, nem mudar o conteúdo sob um ID de operação que pode já ter chegado ao servidor.
- Sem persistência durável, a interface não anuncia salvamento. Sincronizado exige resultado aplicado e ausência de pendências conhecidas, incluindo recuperação, conflitos e uploads.
- Os dados originais de teste e os dados de produção não serão alterados nos ensaios. A liberação exige convergência de conteúdo e referências, não apenas contagens ou fila vazia.

## Ordem e acompanhamento

Executar em sequência: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Iniciar o inventário de segurança da etapa 7 já na etapa 1 para descobrir incompatibilidades cedo, sem antecipar atualizações indiscriminadas. Cada entrega terá commits revisáveis com frontend, backend e contrato compatíveis. Atualizar o registro de execução com commit, casos aprovados, limitações e pendências reais; nenhum bloco se encerra somente por implementação.

| Entrega | Dependências obrigatórias | Resultado |
| --- | --- | --- |
| 1. Inventário e compatibilidade | Base atual | Protocolo de escrita seguro e tratamento explícito das filas antigas |
| 2. Persistência de todas as edições | 1 | Toda edição aceita pode ser recuperada após interrupção |
| 3. Conflitos e resolução | 1, 2 | Nenhuma entidade colaborativa sobrescreve silenciosamente uma edição concorrente |
| 4. Comandos compostos | 2, 3 | Operação estrutural termina inteira ou permanece explicitamente recuperável |
| 5. Abas, sessão e recuperação | 2–4 | Logout, troca de atlas e reconexão respeitam escopo e descarte |
| 6. Uploads, indicadores e administração | 2, 3, 5 | Recursos retomáveis e estado de sincronização compreensível |
| 7. Segurança e dependências | Inventário em 1; integração após 6 | Alertas aplicáveis corrigidos e riscos restantes classificados |
| 8. Homologação final e migração | 1–7 | Candidato validado com falhas injetadas e dados representativos |
| 9. Liberação interna e retorno | 8 | Backup restaurável, piloto observado e procedimento de retorno validado |

## 1. Inventariar produtores e fechar compatibilidade

1. Mapear todos os produtores de alterações e todos os caminhos de mutação remota, inclusive HTTP, WebSocket, importação, cópia, undo/redo e atualizações em lote. Para cada entidade, registrar diário, versão-base, dependências, autorização, snapshot, replay e proteção de exclusão existentes ou ausentes.
2. Definir matriz explícita de compatibilidade entre build, protocolo, schema local e schema do servidor. Negociar capacidades antes de habilitar edição remota e verificar o contrato no servidor em todos os caminhos de escrita; não confiar apenas no frontend nem aceitar silenciosamente a ausência de versão.
3. Cliente incompatível recebe motivo e orientação de atualização, sem loop de reenvio, limpeza de dados ou bloqueio indevido de atlas locais. Definir o comportamento para uma aba antiga que continua aberta durante a atualização.
4. Classificar filas antigas: resultado já comprovado por recibo, pendência compatível, ou operação sem base/ordem comprovável. Preservar IDs e envelopes já enviados; manter os casos incertos em conciliação explícita. Não converter uma edição incerta em escrita contra o estado atual automaticamente.
5. Fazer migração local retomável, com marca de progresso e verificação do destino antes de remover a origem. A interface de resolução será concluída na etapa 3; até lá, os casos incertos continuam bloqueados e preservados.

**Aceite:** build antigo não contorna o contrato; recarregar durante migração não perde nem duplica operações; recibos continuam reconhecendo reenvios; pendências sem base não alteram o servidor automaticamente. Cobrir mudança de permissão também no caminho de recibos.

## 2. Completar a persistência durável de todas as edições

1. Expandir o diário existente para mapas, camadas, grupos/membros, configurações compartilhadas, briefings/slides, recursos 3D/360 e demais produtores encontrados no inventário. Manter preferências estritamente locais fora da fila remota.
2. Registrar intenção completa antes de persistir a entidade ou confirmar sucesso na UI. Capturar atlas, usuário, geração e IDs finais no início; usar sequência atômica e materialização idempotente.
3. Adaptar produtores com debounce e chamadas de logging sem espera, além de edição em lote, cópia, importação e undo/redo. Distinguir projeção provisória de edição aceita duravelmente.
4. Recuperar operações preparadas após interrupção sem duplicar entidades, histórico de undo ou efeitos visuais. Preservar dependências de mapa, camada, recurso e entidade; recusa de uma criação bloqueia seus dependentes sem parar trabalho independente.
5. Em falha de quota, impedir confirmação de salvamento e explicar o problema; manter a geração válida e o conteúdo ainda disponível para recuperação.

**Aceite:** injetar falha antes/depois do diário, da materialização e da marca de conclusão para cada família de produtores. Após reabertura, toda edição aceita existe como resultado confirmado ou intenção recuperável, no atlas correto, sem duplicação.

## 3. Expandir conflitos e entregar resolução ao usuário

1. Definir a unidade conciliável de cada entidade. Campos independentes podem coexistir; geometria é uma unidade; ordem, hierarquia e associações usam comandos próprios ou conflito conservador. Não combinar arrays genericamente.
2. Expandir revisões/base e tombstones além das feições, mantendo autorização e detecção de conflito independentes do histórico de replay. Comandos não podem ressuscitar silenciosamente entidade excluída.
3. Criar painel persistente de pendências alimentado pelos resultados duráveis: item, motivo, dependências afetadas, conteúdo local e estado atual permitido ao usuário. Tratar recusa, conflito e falta de permissão como estados distintos.
4. Oferecer aceitar servidor ou reaplicar escolha como nova operação e nova base. Comparar geometria visualmente, sem fusão automática. Uma nova edição concorrente volta a ser validada; resolução deve sobreviver a F5 e funcionar entre abas.
5. Para conteúdo cujo acesso foi revogado, não buscar nem expor novos dados do servidor. Seguir as regras de acesso do produto ao apresentar o trabalho local restante.

**Aceite:** testar mesma entidade/campos distintos, mesmo campo, edição versus exclusão, reordenação concorrente e nova disputa durante resolução. Nada desaparece apenas porque o toast fechou; dependentes ficam explicados e trabalho independente prossegue.

## 4. Proteger comandos compostos

1. Inventariar conversão, transferência integral de camada, movimentações estruturais, importações, cópias e inversões de undo/redo. Distinguir os comandos já atômicos dos que hoje emitem múltiplas operações independentes.
2. Para comandos de tamanho limitado, validar o conjunto e gravar mutações, versões, recibo e resultado canônico na mesma transação do servidor. Persistir o conjunto no diário local antes da projeção.
3. Para operações grandes, usar preparação durável e ativação final controlada, com estado explícito e retomada idempotente; não expor como concluído um conjunto incompleto. Definir limites de tamanho/tempo medidos e comportamento de cancelamento.
4. Tratar desfazer/refazer como novos comandos contra o estado confirmado. Não sobrescrever edições de outros usuários para restaurar uma cópia antiga inteira.

**Aceite:** falhar no meio do conjunto, após commit antes do ACK e durante retry. Nenhum estado parcialmente publicado, efeito duplicado ou referência órfã; os contratos normais de conversão/movimento/undo continuam passando.

## 5. Concluir coordenação entre abas, logout e recuperação

1. Implementar barreira por escopo remoto para pausar escritores e envios em todas as abas antes da contagem de pendências. Usar coordenação durável que cubra aba suspensa/encerrada; mensagens entre abas sozinhas não comprovam a pausa. Escritores verificam a barreira no momento da escrita.
2. Estabilizar gravações iniciadas, contar operações, conflitos e uploads abrangidos e apresentar a confirmação. Se não for possível comprovar estabilidade, avisar que há pendências de quantidade desconhecida. Cancelar retoma sem descarte; confirmar invalida a época e limpa somente o escopo remoto abrangido.
3. Abranger callbacks, uploads, journals e tarefas de manutenção na proteção de geração. Troca de atlas isola o destino e conserva pendências sem autorizar envio sobre estado avançado sem validação. Expiração de login suspende operações até autenticação e revalidação.
4. Concluir serialização de snapshot/replay/ACK e ativação durável da geração, incluindo falha de quota. Limpar gerações antigas apenas sem leitores/escritores válidos e nunca excluir a ativa antes de substituta confirmada.
5. Verificar prazos, cancelamento e progresso em rede degradada; manter o mesmo ID após resposta perdida e respeitar Retry-After. Cancelamento no navegador não prova rollback do servidor.

**Aceite:** segunda aba tenta editar durante confirmação; aba suspensa retorna após descarte e novo login; resposta antiga chega depois da troca; logout é cancelado; autenticação expira. Atlas locais permanecem íntegros, dados do servidor não são apagados pela saída e pendências descartadas não ressurgem.

## 6. Completar uploads e tornar os indicadores confiáveis

1. Persistir blobs e metadados por atlas antes de anunciar retomada possível. Dar identidade estável ao upload e resultado deduplicável no backend; verificar tamanho, formato, autorização e escopo.
2. Associar a operação ao recurso obrigatório. A confirmação final exige recurso acessível aos colaboradores; referências não podem ser anunciadas como sincronizadas enquanto o upload necessário está pendente.
3. Retomar após queda, F5 e resposta perdida; classificar falha transitória e recusa definitiva. Logout confirmado descarta pendências locais abrangidas, sem excluir recursos já confirmados no servidor. Revisar limpeza de uploads incompletos e recursos órfãos sem remover referências válidas.
4. Exibir salvo neste computador, aguardando envio, recuperando, conflito/recusa, upload pendente e sincronizado. Usar o conjunto completo de pendências conhecidas e o cursor aplicado, evitando sucesso prematuro.
5. Integrar ao monitoramento existente quantidade/idade de pendências, conflitos, recusas, uploads, falhas de persistência e tempo sem progresso, com correlação de build/protocolo. Não coletar conteúdo de mapas, textos ou imagens.
6. Validar a visão administrativa já existente: presença autenticada e anônima com janela de expiração explícita, deduplicação de abas quando possível, última autenticação e contagem de atlas remotos por usuário segundo a regra de produto. Presença mede sessões/dispositivos observados, não identifica com exatidão pessoas anônimas. Distinguir última autenticação de última atividade e usuário offline de falha de telemetria.

**Aceite:** outro cliente consegue abrir o recurso após retomada; reenvio não duplica upload; indicador não fica verde com conflito/upload conhecido; administração detecta cliente sem progresso e remove presença expirada sem inventar contagens exatas de pessoas.

## 7. Revisar segurança e dependências

O push anterior reportou 26 alertas na branch padrão, sendo 15 altos. Esse número é um aviso do GitHub, não uma auditoria da integração nem prova de explorabilidade nesta versão.

1. Capturar inventário datado do candidato: dependências da raiz, frontend e backend, transitivas, bibliotecas distribuídas em vendors e imagem/runtime de implantação. Consultar os alertas atuais e os avisos oficiais dos mantenedores durante a execução.
2. Classificar cada alerta por versão efetiva, caminho da dependência, uso em produção/build/teste, exposição e correção disponível. Registrar também os casos que não afetam o candidato, com evidência.
3. Atualizar dependências diretas ou transitivas de forma controlada, preservando instalações reproduzíveis. Não executar correção forçada indiscriminada. Para mudança incompatível, adaptar uso e cobrir regressões; para ausência de correção, remover/substituir o componente afetado ou mitigar com justificativa verificável.
4. Revisar autorização entre atlas, acesso a uploads, recibos e sockets após revogação, expiração de sessão e limites de recursos. Usar as regras da constituição do produto, sem inventar novos papéis.

**Aceite:** nenhuma vulnerabilidade crítica/alta aplicável e explorável permanece sem correção ou mitigação demonstrada. As demais têm decisão registrada e responsável; build e instalação reproduzíveis e testes relevantes passam após as atualizações. A decisão de liberação considera o risco concreto, não apenas reduzir uma contagem.

## 8. Homologar o candidato e a migração final

1. Fixar SHAs da main em produção e do candidato; confirmar se a produção mudou desde a informação recebida. Preparar perfis de navegador e bancos descartáveis, com cópias dos dados em `C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\_ebgeo_dados_teste`.
2. Subir a main, criar/editar dados e preferências pela aplicação, fechar ou suspender clientes, trocar o servidor para o candidato e reabrir o mesmo perfil na mesma origem completa: protocolo, domínio e porta. O ensaio local reproduz essa continuidade; a confirmação final usa a origem interna real.
3. Reaproveitar os ensaios de migração existentes e ampliar para o conjunto final: meses sem acesso simulados, aba/build antigo aberto, atualização de cache/service worker quando aplicável, interrupção entre etapas e reabertura repetida. Conferir também referências de imagens, camadas, mapas e exportação/reimportação.
4. Executar matriz com dois e três clientes, incluindo mesma entidade, campos diferentes, exclusão, camada travada, movimentação, conflitos, importação, undo/redo e todas as famílias inventariadas. Simular 429/503, resposta perdida após commit, conexão oscilante, snapshot interrompido, suspensão, relógio alterado, fila acima de 10.000 e armazenamento próximo da quota.
5. Comparar conteúdo, relações e versões entre PostgreSQL, IndexedDB, memória, render e exportação. Forçar as ordens problemáticas com barreiras determinísticas e conservar regressões; repetir corridas em série, sem retries ocultando falhas. Usar controles negativos para demonstrar os guardas críticos.
6. Após a última mudança de lógica, executar lint e teste completos da raiz em comandos separados, build e Playwright com backend real; conferir códigos de saída e ausência de skips indevidos, inspecionar capturas. Executar suítes que usam banco em sequência, sem disputa pelo banco descartável.

**Aceite:** toda célula da matriz tem evidência ou limitação explícita que impede sua liberação; nenhum caso obrigatório fica pendente. Não há perda silenciosa, sobreposição indevida entre atlas ou edição antiga reaplicada sem validação. O conjunto final passa as verificações, não somente um checkpoint anterior.

## 9. Preparar e validar liberação na rede interna

1. Preparar roteiro concreto com versões compatíveis de frontend/backend/schema, ordem de instalação, pré-condições, duração medida em ensaio, verificação de saúde e responsáveis. Manter migrações organizadas por domínio; distinguir instalação nova, banco de desenvolvimento com histórico antigo e atualização de schema válido. Não resetar banco automaticamente.
2. Ensaiar backup e restauração de PostgreSQL e dos arquivos referenciados, incluindo imagens/3D/360. Backup do servidor não protege sozinho dados que só existem no navegador; a migração do cliente deve preservar a origem até validação.
3. Na infraestrutura interna, verificar proxy, WebSocket, cache, TLS, limites/timeouts, disco, volumes graváveis e acesso aos serviços necessários. Usar contas de teste com papéis reais, validar monitoramento de erros e acesso aos diagnósticos.
4. Definir retorno antes de abrir para escrita: preferir versão anterior compatível ou correção progressiva. Se exigir restauração de backup, suspender novas escritas e tratar explicitamente as alterações posteriores ao backup; restauração não pode ser apresentada como retorno sem perda por padrão. Não voltar apenas o frontend para a main se ela não entende o novo estado local.
5. Fazer piloto controlado cobrindo usuários locais antigos, autenticados e anônimos e edição remota colaborativa. Dimensionar duração/amostra pela matriz e pelo volume observado, sem prazo arbitrário. Expandir somente após evidência de estabilidade e conferência de integridade.
6. Suspender expansão se houver divergência de dados, perda/duplicação de operação, acesso entre atlas indevido, migração incompleta, upload inacessível ou sincronização anunciada incorretamente. Medir também erros, filas sem progresso, latência, armazenamento e presença; calibrar limites operacionais no ensaio e registrar quem age.

**Aceite:** responsável na rede interna executa e registra o ensaio, restaura o backup com sucesso, comprova o piloto e aprova o conjunto compatível. Esta sessão não tem acesso ao servidor interno; preparar o roteiro localmente não substitui sua execução lá.

## Condição final de lançamento

Todas as nove entregas encerradas com evidência, matriz obrigatória aprovada, vulnerabilidades tratadas, cópias de dados antigos conferidas, descarte remoto isolado e restauração/retorno ensaiados. Sem essas condições, manter o candidato fora da liberação geral. Alterações posteriores ao candidato homologado exigem reavaliar o impacto e repetir as verificações afetadas.
