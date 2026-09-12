# Plano de correção do atlas remoto

Data: 12/09/2026. Status: execução autorizada e em andamento. Acompanhar a validação em [execução](execucao-correcao-atlas-remoto.md).

Base: [revisão do sincronismo](2026-09-12-revisao-atlas-remoto.md) no commit fa0f021891b785b61c45fd8aedc51f20a99a0950 do branch integracao_backend. Os identificadores R1 a R14 usados abaixo pertencem a essa revisão.

## Resultado esperado

Uma alteração aceita localmente deve ter intenção durável até receber um resultado explícito do servidor ou ser descartada pelo usuário. Após recuperar a conexão, servidor, IndexedDB, memória e mapa devem convergir. Fila vazia, sozinha, não representa essa garantia.

Regras de produto que orientam todas as entregas:

- Logout voluntário confirmado descarta as pendências remotas abrangidas pelo aviso, inclusive conflitos e anexos. Elas não voltam no próximo login.
- Queda de rede, suspensão da aba e F5 não equivalem a consentimento para descarte.
- Uma edição antiga não pode substituir silenciosamente um estado mais recente do servidor.
- Trocar de atlas não permite que callbacks, filas ou imagens do anterior escrevam no novo, nem autoriza apagar atlas locais.
- Ausência de espaço ou falha de persistência deve impedir confirmação de salvamento. O conteúdo só é recuperável se chegou a ser persistido; não prometer recuperação depois de o próprio usuário apagar os dados do navegador.

## Decisões propostas

### Persistência local

Adotar um diário durável de operações por atlas remoto. Os bancos atuais de entidade e fila são separados; simplesmente adicionar await ao enfileiramento não os torna atômicos.

A intenção completa de editar será registrada antes da materialização da entidade. O diário conterá ID imutável, sequência monotônica persistida, identidade/escopo, operação, versão-base, dependências e estado de processamento. A sequência e a inclusão no diário devem ser uma transação única. Em reinício, a materialização local pode ser repetida com os mesmos IDs, sem repetir efeitos de UI, histórico de undo ou envios novos.

O estado exibido será uma projeção da base confirmada mais as intenções locais válidas. O diário será também a fonte de recuperação de escritas interrompidas; não haverá dois mecanismos independentes tentando adivinhar o que faltou enviar.

### Protocolo e servidor

Versionar explicitamente o contrato de sincronismo. Separar cursor do atlas, versão da entidade e sequência local: são grandezas diferentes.

Criar recibos de deduplicação independentes do histórico de replay, com chave por atlas e ID da operação, vínculo ao principal, hash do envelope e resultado. Recebimento, mutação e recibo devem participar da mesma transação. Manter recibos enquanto o atlas existir; a limpeza comum de histórico não os remove. Uma eventual política futura de poda de recibos exigirá épocas de sincronismo e recusa explícita de clientes antigos, nunca reaplicação silenciosa.

Resultados individualizados: aplicada, já aplicada, conflito, recusada permanentemente e falha transitória. Operações sem resultado identificado permanecem pendentes. Reutilizar um ID com conteúdo diferente deve ser erro de protocolo. Reenvio idempotente não deve retransmitir o payload bruto antigo como se fosse uma nova mudança.

### Política de conflitos

Enviar os campos efetivamente alterados e a versão-base. O servidor acompanhará a versão de alteração das unidades conciliáveis; não dependerá de histórico que pode ser apagado nem apenas de valores anteriores alegados pelo cliente.

- Campos independentes, não alterados desde a base conhecida: aceitar juntos.
- Mesmo campo alterado por outra operação desde a base: manter o valor do servidor e registrar conflito.
- Geometria: tratar como uma unidade; não combinar coordenadas automaticamente.
- Exclusão concorrente com edição: preservar a exclusão e apresentar a edição como conflito, sem recriar automaticamente.
- Coleções ordenadas, hierarquia e operações estruturais: comandos específicos ou conflito conservador da unidade afetada. Não aplicar merge genérico de arrays.
- Resolução pelo usuário: aceitar o servidor ou aplicar sua escolha como nova operação contra a versão atual. Se alguém alterar novamente, revalidar e apresentar novo conflito.

Essa é uma mudança deliberada em relação à última chegada que vence hoje. Deve ser registrada na documentação de decisões e implementada nos dois lados do protocolo. Pendência sem versão-base confiável não recebe uma versão atual inventada: entra em conciliação explícita.

## Entrega 1: conter descartes e transformar as reproduções em regressões

Dependência: nenhuma. Achados: R1 e R2; preparação dos demais.

1. Remover a poda por idade das operações não confirmadas.
2. Desativar a compactação atual da fila remota. Não introduzir outra compactação neste primeiro ciclo; medir volume e espaço e tratar quota com erro visível.
3. Converter as [sondas da revisão](2026-09-12-atlas-remoto-sondas.md) em testes permanentes por domínio. Corrigir os quatro testes de caracterização do backend para exigirem o comportamento seguro quando cada correção entrar.
4. Acrescentar cortes determinísticos antes/depois de persistência, envio, commit, ACK, snapshot e troca de escopo. Usar barreiras controladas, não depender da sorte de timers.

**Aceite:** uma operação não confirmada sobrevive à passagem de meses simulados e à manutenção; nenhuma compactação altera seu envelope ou elimina um patch. As regressões dos próximos blocos permanecem demonstráveis, sem serem tratadas como resolvidas por esta mitigação.

Esta entrega reduz risco, mas não libera o produto para produção.

## Entrega 2: contrato de confirmação, versões e deduplicação

Dependência: entrega 1. Achados: R7 e R9; pré-requisito para R2, R3, R6, R8 e conflitos.

1. Definir os envelopes de operação, recibo, evento canônico, conflito e snapshot, com esquema validado e versão de protocolo.
2. Implementar recibos persistentes e validação do hash do envelope, independentes da tabela de histórico.
3. Executar autorização e validação de escopo antes de retornar informação de recibos. Deduplicação não é um atalho para contornar revogação de acesso.
4. Distinguir ausência esperada de efeito de inconsistência: exclusão repetida pode ser idempotente; criação com mapa inexistente não pode ser anunciada como aplicada.
5. Entregar versão/resultados canônicos ao autor. Emitir eventos somente para mudanças efetivamente confirmadas; recusas e conflitos não ganham versão de vencedor.
6. Registrar versão de alteração dos campos/unidades necessários à política de conflitos, incluindo tombstones.
7. Definir comportamento para clientes e filas antigas: cliente incompatível recebe instrução explícita de atualização e não envia no contrato antigo. Operação sem base/recibo comprovável não é reenviada com segurança presumida.

**Aceite:** perder a resposta, limpar o histórico e repetir o mesmo ID não muda o resultado nem duplica o efeito; alterar o conteúdo desse ID é recusado; nenhum sucesso representa uma criação inexistente; autorização segue válida nos caminhos de retry.

**Schema:** manter a organização por domínio da consolidação anterior. Enquanto este backend continuar sem implantação, atualizar a base lógica de sync de forma coordenada com os bancos descartáveis. Qualquer banco de desenvolvimento já existente exige transição explícita e backup; não recriar automaticamente. Se a situação de produção mudar antes da execução, usar migração incremental imutável.

## Entrega 3: diário durável e ordenação local

Dependência: entrega 2. Achados: R1, R2, R10 e R13.

1. Implementar gravação da intenção antes da entidade, com IDs finais e sequência monotônica persistida.
2. Materializar a operação localmente de maneira idempotente. Recuperar após interrupção entre diário e entidade e entre entidade e marca de aplicação.
3. Capturar atlas, principal e geração de montagem no nascimento da intenção. Operações assíncronas não consultam um ponteiro global mutável para escolher onde continuar escrevendo.
4. Preservar dependências: mapa antes de feições, briefing antes de slides, recurso antes de referência. Bloquear dependentes de uma criação recusada e explicar a causa, sem tratar cada filha como sucesso vazio.
5. Adaptar os caminhos de edição individuais, em lote, undo/redo, importação e operações estruturais. Gerar IDs antes de qualquer efeito repetível.
6. Migrar filas existentes sem alterar IDs ou envelopes já enviados. Manter a origem até validar o destino. Para operações legadas de ordem incerta ou sem base confiável, exigir conciliação; não deduzir causalidade só pela data civil.
7. Impedir novas edições remotas quando a intenção não puder ser persistida; oferecer recuperação/exportação do conteúdo que ainda estiver disponível sem anunciar salvamento bem-sucedido.

**Aceite:** interrupções em cada fronteira não geram edição aceita sem intenção recuperável; reabrir não duplica entidades; relógio regressivo e F5 não invertem dependências; operações de atlas diferentes não compartilham destino.

## Entrega 4: coordenar conexão, snapshot, replay e aplicação

Dependências: entregas 2 e 3. Achados: R3, R4, R5, R6, R8 e R12.

1. Criar um coordenador de sessão por atlas. Toda mensagem, resposta HTTP e escrita será vinculada a uma geração; trocar de atlas invalida a geração anterior.
2. Serializar snapshot, replay incremental, eventos ao vivo e resultados de envio. Separar versão recebida de cursor aplicado duravelmente.
3. Capturar snapshot consistente no backend, com seu cursor pertencendo ao mesmo retrato de dados. Montar o resultado em uma geração local de preparação; não limpar a geração ativa antes de ter substituta válida.
4. Ativar snapshot e cursor com um ponto de confirmação durável. Reaplicar a projeção das intenções ainda pendentes, sem enviá-las antes da verificação de conflito.
5. Substituir o conjunto autoritativo completo: remover mapas/briefings ausentes e limpar coleções ou conteúdo que deixaram de ser visíveis ao usuário. Preservar intenções em conflito separadamente do estado confirmado.
6. Fazer replay em todo handshake, inclusive no primeiro. Durante a recuperação, guardar eventos novos e aplicá-los na ordem canônica após a base/replay.
7. Não usar “versão anterior + 1” para detectar buracos: a sequência atual do servidor é global e pode ter intervalos legítimos entre operações do mesmo atlas. Usar o contrato de cursor e a ordem fornecida pelo servidor.
8. Conservar tombstones e proteção de ordem para todas as entidades/unidades colaborativas, inclusive comentários, settings e metadados. Definir descarte de tombstones somente após fronteira segura de snapshot/época.
9. Em falha de IndexedDB, não avançar o cursor. Em resposta antiga, não aplicar nada na nova geração. Fechamento atrasado de socket não pode derrubar o atual.

**Aceite:** o cenário real de snapshot pendente da revisão passa; exclusões ausentes no snapshot desaparecem; nada se perde entre HTTP e WS; falha de aplicação resulta em replay; mensagem antiga não ressuscita entidade; servidor, IndexedDB, memória e render concordam após recuperação e F5.

## Entrega 5: conflitos e recusas visíveis, sem sobrescrita silenciosa

Dependências: entregas 2 a 4. Achado: política de conflitos e conclusão de R7.

1. Implementar as regras de versão-base e patch definidas acima no servidor e nos produtores de operação do frontend.
2. Cobrir todos os tipos colaborativos. Para briefing/slides, evitar substituir o conjunto inteiro quando a intenção é editar apenas um slide. Para grupos, separar associação de membro de metadados do grupo.
3. Guardar conflitos e recusas duravelmente no namespace remoto e mostrá-los num painel de pendências. Aviso temporário não é o único registro.
4. Mostrar item afetado, motivo e valores comparáveis. Geometria deve permitir comparar a versão local com a atual; não oferecer merge automático de formas.
5. Ao aceitar a versão do servidor, retirar a intenção correspondente da projeção. Ao escolher reaplicar, criar nova operação com nova base; preservar o ID da operação anterior como resultado encerrado.
6. Permitir andamento de operações independentes, mantendo bloqueadas apenas as dependências do conflito/recusa.
7. Revalidar papel ao reconectar e explicar perda de permissão, atlas removido ou sessão expirada. Não confundir esses estados com falha de rede nem ampliar permissões locais.

**Aceite:** nome e geometria editados independentemente sobrevivem; disputa do mesmo campo exige resolução; nenhuma edição vence uma exclusão silenciosamente; ACK recusado não repara a versão local como vencedora; conflito continua visível após F5 e desaparece somente por resolução ou descarte confirmado.

## Entrega 6: rede degradada, cancelamento e saída

Dependências: entregas 3 a 5. Achados: R11, R12 e integração da política de logout.

1. Aplicar prazos diferenciados para push pequeno, snapshot e autenticação. Usar limite de inatividade/progresso e mensagem de estagnação; medir valores em rede degradada antes de fixar os padrões.
2. Cancelar requisições e leituras que perderam sua geração. Cancelamento do cliente não significa rollback no servidor: conservar o ID para consultar/repetir o resultado com deduplicação.
3. Fazer retry com espera exponencial, jitter e respeito a Retry-After. Respostas 429/503 e falhas de rede preservam a intenção; não disparam descarte.
4. Garantir exclusão mútua do auto-flush antes do primeiro await. Recomeçar um loop não pode reutilizar a promessa pendurada de outra sessão.
5. Para logout: pausar novas edições/envios, estabilizar os enfileiramentos já iniciados e contar pendências de todos os namespaces remotos abrangidos. Se houver cancelamento da confirmação, retomar o funcionamento.
6. Após confirmação, registrar o descarte durável, invalidar gerações e limpar apenas os espaços remotos abrangidos. Incluir conflitos, uploads e diários, preservando atlas locais e resgates já adotados como locais conforme sua propriedade.
7. Avisar que envios já confirmados ou em processamento no servidor não são desfeitos pelo logout. Sair abandona o que não chegou; não é um comando para apagar dados remotos.

**Aceite:** requisição pendurada tem diagnóstico e recuperação; não há dois flushes concorrentes da mesma sessão; queda e reconexão não perdem pendências; cancelamento de logout preserva trabalho; logout confirmado não reativa operações no próximo login; callback tardio não escreve depois do descarte.

## Entrega 7: imagens e estado de sincronização confiável

Dependências: entregas 2 a 6. Achado: R14 e comunicação do estado final.

1. Persistir blobs a enviar em fila por atlas, com ID estável e resultado deduplicável no backend. Repetir upload após resposta perdida não cria múltiplos recursos.
2. Vincular operação e referência ao upload. Não confirmar uma referência remota enquanto seu recurso obrigatório estiver pendente.
3. Tratar falhas transitórias com retry e falhas de formato/tamanho/permissão com ação visível. Falta de espaço local impede prometer retomada.
4. Separar na interface: salvo neste computador, aguardando envio, recuperando alterações, conflito/recusa, upload pendente e sincronizado.
5. Exibir sincronizado apenas após aplicar os resultados e concluir a recuperação até o cursor confirmado, sem pendências/conflitos/uploads conhecidos. Explicar que representa a última confirmação, não que nenhum outro usuário possa editar no instante seguinte.
6. Integrar à visão administrativa quantidade e idade de pendências, conflitos, recusas, uploads e tempo sem progresso; não enviar conteúdo de feições, textos ou imagens para telemetria.

**Aceite:** queda no meio do upload e perda da resposta são recuperáveis; peers conseguem buscar o recurso; F5 preserva a pendência; logout confirmado a descarta; a interface não mostra sincronizado no cenário divergente da revisão.

## Entrega 8: migração, homologação e liberação

Dependências: todas as entregas anteriores.

1. Executar a matriz da revisão com falhas injetadas e igualdade de estado entre PostgreSQL, IndexedDB, memória e render. Incluir exportação e reabertura para capturar referências ausentes.
2. Cobrir 2 e 3 clientes, edições da mesma entidade/campos distintos, hierarquia, mapas, briefing/slides, comentários, camadas, grupos e 3D/360.
3. Exercitar interrupções antes/depois de commit e ACK, resposta perdida, snapshot incompleto, fila acima de 10.000, relógio alterado, aba suspensa e retorno após meses simulados. Casos de corrida devem forçar a interleaving e passar sem retry mascarando falha.
4. Validar migração direta dos dados da main e filas antigas da integração, inclusive retomada interrompida. Usar cópias dos dados de teste em C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\_ebgeo_dados_teste; manter os originais intactos.
5. Verificar coexistência com aba/build antigo: bloquear protocolo de escrita incompatível e impedir que dados novos sejam reinterpretados por uma versão antiga. Não apagar origem de migração antes da validação prevista no plano anterior.
6. Rodar lint e testes completos da raiz em comandos separados após a última mudança de lógica, build e Playwright com backend real. Inspecionar as capturas; remover specs temporários, conservando regressões permanentes e evidências.
7. Preparar roteiro para a rede interna: backup, compatibilidade de proxy/timeouts/WS, migrações, validação por contas de teste e retorno operacional. Validar esse roteiro no ambiente interno antes da publicação, pois ele não é acessível nesta sessão.
8. Registrar versões compatíveis para rollback. Reverter apenas o frontend para uma versão que não entende os novos dados/recibos não é retorno seguro; definir previamente o conjunto compatível ou restauração controlada.

**Liberação somente quando:** todas as regressões estiverem corrigidas; perdas e conflitos tiverem resultado explícito; estados do cliente e servidor convergirem nos cenários testados; migração e logout respeitarem o isolamento; não houver falha de teste escondida por skip/retry.

## Organização da execução

Implementar na ordem das entregas, em commits revisáveis. Mudanças do protocolo devem levar frontend, backend e testes de contrato no mesmo commit, mantendo branches intermediários sem uso em produção.

| Entrega | Principais áreas existentes | Cobertura |
| --- | --- | --- |
| 1 | operation-queue e testes da revisão | R1, R2 |
| 2 | sync.service, sync.schemas, sync.queries, controladores HTTP/WS | R7, R9; contrato de conflito |
| 3 | store-transaction, operation-dispatcher, operation-factory, fila e namespace | R1, R2, R10, R13 |
| 4 | sync-engine, remote-operation-handler, ws-client, abertura e snapshots | R3, R4, R5, R6, R8, R12 |
| 5 | produtores de operações, serviço sync e UI de pendências | Conflitos, R7 |
| 6 | api-client, sync-flush, ws-client, montagem e logout | R11, R12; descarte confirmado |
| 7 | image-sync, uploads, indicadores e monitoramento | R14; confirmação confiável |
| 8 | migrações, runners, dados de teste e homologação interna | Todas |

Não estimar prazo em dias apenas pelo número de arquivos. As entregas 3 e 4 alteram garantias fundamentais e devem começar com uma implementação vertical completa de feição antes de expandir aos demais tipos; a liberação exige todos os tipos cobertos, não apenas essa primeira implementação.
