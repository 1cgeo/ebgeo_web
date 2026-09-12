# Execução do fechamento para lançamento

Início: 12/09/2026. Base enviada: `e70ccf3c245ba99ba8757ebcbf8eca072a9f6cd6`. Autorização: “pode executar”. Referência: [plano de fechamento](plano-fechamento-lancamento.md).

**Estado intermediário, não liberado para produção.** O trabalho de compatibilidade abaixo não conclui as demais garantias de persistência, conflito, upload e homologação.

## Compatibilidade e filas antigas

- Todas as novas operações da fábrica, individuais e em lote, recebem protocolo 2. Isso inclui os tipos que antes saíam sem versão; não significa que todos já tenham conflitos por campo implementados.
- O servidor publica o contrato de escrita por atlas. Escritas incrementais incompatíveis são interrompidas em HTTP, WS simples, WS em lote e no serviço, antes de mutar o conjunto. A resposta HTTP é 426: clientes antigos tratavam 400/422 como erros terminais e poderiam descartar pendências. Envelopes estruturalmente inválidos continuam sujeitos à validação.
- A conexão autenticada remota verifica compatibilidade antes de habilitar o logging. Falha de protocolo interrompe o auto-flush e orienta atualização, mantendo a fila. Atlas locais não passam pela quarentena remota.
- Operações sem versão compatível ficam registradas como pendências, sem alteração do envelope ou da chave original. Não entram no envio nem na projeção de snapshots; dependentes ficam bloqueados e operações independentes podem prosseguir.
- A consulta de recibos é somente leitura, compara atlas, autoria e hash do conteúdo e não retorna dados da entidade. Só uma confirmação inequívoca remove a intenção antiga da fila. Ausência, conflito, falha de consulta ou resposta ambígua preservam o original. Um leitor ainda autorizado pode consultar a própria confirmação sem recuperar permissão de escrita; comentários continuam fora da visibilidade do leitor.
- Troca de sessão durante consulta impede limpeza tardia. A revisão explícita na interface ainda pertence à entrega de conflitos; pendências desconhecidas não ganham base inventada nem são reenviadas automaticamente.

## Inventário para as próximas entregas

### Compatibilidade deste bloco

| Cliente / dado | Servidor deste bloco | Resultado |
| --- | --- | --- |
| Main em atlas local, schema anterior a 3.0 | Sem escrita remota | Migração local existente até 3.0; este bloco não reescreve envelopes locais |
| Integração antiga, envelope sem protocolo | HTTP, WS ou chamada ao serviço | Recusa do lote sem aplicação; HTTP 426 conserva a fila do cliente anterior |
| Integração atual, envelope v2 | Capacidade `writeVersions: [2]` e `receiptLookup: true` | Negociação antes do snapshot e da habilitação do logging remoto |
| Integração atual contra backend anterior | Capacidades ausentes/incompatíveis | Abertura remota falha antes de habilitar logging; atualização compatível necessária |
| Fila remota antiga no cliente atual | Recibo com mesmo atlas, autor e hash | Retirada somente com confirmação inequívoca; demais casos continuam preservados e bloqueados |
| Envelope com versão futura | Qualquer entrada incremental atual | Não rebaixar a versão nem converter a base; revisão obrigatória |

O schema local continua 3.0 e não há nova migração PostgreSQL neste bloco. A base possui 12 arquivos de migração. O teste comportamental de protocolo cobre HTTP, WS e serviço; a travessia completa da main e as exceções REST continuam com os aceites próprios das entregas 4 e 8.

As fronteiras incrementais são o controlador HTTP de sync e os dois handlers de operações WS, que convergem no serviço. As exceções estruturais documentadas no backend são importação de atlas, clone, duplicação de mapa e merge; sua atomicidade, compatibilidade e idempotência devem ser verificadas na entrega de comandos compostos, sem presumir cobertura pelo bloqueio incremental.

| Família | Produtores principais no frontend | Trabalho restante |
| --- | --- | --- |
| Feições | `frontend/src/js/store/feature.operations.js`, `frontend/src/js/store/layer-transfer.operations.js` | Concluir grupos estruturais e matriz de falhas; diário e conflitos de feições já existem |
| Comentários | `frontend/src/js/store/comment.operations.js` | Expandir revisão/conflito e validar autoria em recuperação |
| Mapas e subtipos | `frontend/src/js/store/map.operations.js`, `frontend/src/js/locking/map-lock.controller.js`, `frontend/src/js/store/temporal.operations.js` | Intenção antes da persistência, hierarquia/ordem e conflitos de metadados |
| Camadas | `frontend/src/js/layers/layer.manager.js` | Debounce e diário antes da gravação; conflitos além da identidade canônica |
| Grupos e membros | `frontend/src/js/tool_manager/group_manager.js` | Intenções de membros separadas, diário e comandos de combinar/desagrupar |
| Briefings e slides | `frontend/src/js/store/briefing.operations.js` | Diário implementado neste checkpoint; revisão por slide e conflito de ordem ainda pendentes |
| Catálogo | `frontend/src/js/store/catalog.operations.js` | Diário, versão e referências autorizadas em todas as recepções |
| 3D e 360 | `frontend/src/js/store/cesium3d.operations.js`, `frontend/src/js/store/streetview360.operations.js` | Diário, revisões, imagens associadas e callbacks com escopo capturado |
| Preferências compartilhadas | `frontend/src/js/store/atlas-appearance.service.js`, `frontend/src/js/store/settings.operations.js`, `frontend/src/js/store/customIcons.operations.js` | Separar o que é local do que é compartilhado; diário e conflitos das chaves remotas |

O enum de frontend também contém `atlas`, sem produtor de operação encontrado nesta varredura. O backend aceita `atlas_meta` e `map_meta` além dos tipos traduzidos; esses aliases devem entrar na cobertura de revisões. A fábrica e o dispatcher são fronteiras comuns, mas o logging posterior à persistência ainda existe em diversos produtores. Este inventário orienta a adaptação; não é prova de cobertura de toda escrita.

## Diário de briefings e slides: segundo checkpoint validado

Criação, atualização, exclusão e edição de slides preparam a intenção completa sob a mesma trava do briefing, antes de gravar a entidade. A comparação com o documento anterior produz também as operações individuais dos slides, cuja persistência no servidor é separada. Criar com slides iniciais e importar uma cópia agora registra todos eles; cópias recebem novas identidades de pai e filhos, sem modificar o objeto de entrada. Importação remota nova também recebe identidades novas, pois os IDs das tabelas do servidor não são privados de cada atlas.

A publicação das operações materializadas remove as marcas de preparação numa única transação IndexedDB: uma interrupção não libera apenas o pai. Snapshot recupera intenções preparadas de slides com os mesmos IDs, inclusive o caso histórico em que o pai já recebeu ACK. Falha de quota conserva a intenção e rejeita a confirmação da edição. Mudança de atlas durante leitura interrompe a escrita. O rastro de persistência só é emitido depois da materialização confirmada.

Controles negativos retirando a publicação atômica e substituindo o produtor pela versão anterior fizeram os respectivos testes falharem; fontes restauradas em `finally`. A suíte hermética passou com 12.240 testes/641 arquivos, incluindo nove cenários novos de diário, concorrência, recuperação, escopo e identidade. Os três casos de navegador (offline/F5, cópias com slides iniciais e falha de quota seguida de F5) passaram duas vezes cada, sem retries/skips. Os três casos existentes de briefing/slides/temporal entre dois clientes também passaram duas vezes cada. Uma execução adicional verificou a captura com o editor aberto, o nome e os dois slides recuperados. Build e lint aprovados. A verificação completa da raiz terminou com código 0: 12.240 testes do frontend, 5.050 do backend e 201 contratos, sem falhas ou skips. Os testes de integridade documental também passaram (16 casos).

Isso não torna atômica uma importação inteira no servidor nem resolve concorrência entre usuários: conflitos por slide, ordens concorrentes, demais produtores e comandos compostos continuam pendentes. Na execução completa houve uma falha transitória do ensaio de BroadcastChannel main/nova; passou isoladamente e na execução completa seguinte, sem mudança de produto. A matriz de abas ainda exige tratamento na etapa 5.

## Evidências do primeiro checkpoint (`b26f4e66`)

- Frontend completo: 640 arquivos e 12.231 testes aprovados, incluindo o bloqueio de envio direto sem negociação compatível.
- Bateria de recibos, protocolo, movimento entre mapas e isolamento: 31 testes aprovados. Inclui leitor que perdeu escrita, revogação total de acesso, conteúdo alterado sob o mesmo ID e ausência de efeito na consulta.
- Controle negativo: desativar temporariamente o bloqueio de protocolo produziu duas falhas em quatro testes; o arquivo foi restaurado com seus bytes originais.
- Playwright com backend real após instalação limpa e ajuste final: nove execuções aprovadas em três repetições, sem retries/skips, incluindo F5 com fila antiga e os cenários de camada padrão. A captura foi inspecionada: ponto confirmado visível, aviso de revisão e indicador com uma pendência. O teste confere também o conteúdo do cliente após F5. O texto do indicador ainda será revisto na entrega 6.
- Rodadas intermediárias do backend: a ativação de v2 em fixtures encontrou premissas antigas de sobrescrita/restauração implícita e operações sem base. As fixtures válidas agora explicitam protocolo e observação/base; os testes de disputa exigem conflito. O helper de teste recebe a observação escolhida pelo caso, sem renovar a base durante retries. A última bateria de sync antes dos ajustes finais teve 475 acertos e duas falhas; a de WS teve 257 acertos e cinco falhas. Não são resultados finais de aprovação.
- `npm test` da raiz encerrou com código zero: 12.227 testes do frontend, 5.050 do backend e 201 contratos (57 arquivos). O último ajuste, restrito à negociação antes do envio direto, foi validado também pelo frontend completo com 12.231 testes. O backend não mudou entre essas verificações. Build e lint completos da raiz aprovados após esse ajuste.
- Envio direto: os 80 testes direcionados passaram antes da validação adicional do formato da capacidade, incluída na suíte completa acima. Retirar temporariamente a negociação do envio fez os três testes dedicados falharem; duas recusas esperadas viraram envio de uma operação. O arquivo foi restaurado integralmente.
- Uma rodada intermediária encerrou o processo do teste de relato de erros do navegador após seis casos, sem diagnóstico adicional do runner. Os 15 casos passaram isolados, com cobertura e novamente na suíte completa. A interrupção não foi reproduzida e não foi ocultada com skip/retry.

## Dependências

O [inventário datado](dependencias-lancamento-inventario.json) conserva os resultados anteriores (raiz sem alertas, frontend com 13 e backend com seis), a lista de versões corrigidas e a auditoria posterior. Frontend e backend agora apresentam zero alertas npm e tiveram instalação limpa por `npm ci`. Isso difere do aviso da branch padrão, pois o escopo é outro.

Foram corrigidas as versões fixadas de fast-uri e js-yaml, Vitest e suas transitivas afetadas, Joi, Nodemailer, sharp/libvips, body-parser e qs. O Express 4 fixa uma faixa anterior de qs; um override restrito a essa dependência instala 6.16.0, mantendo a versão principal do Express. Não foi aplicado `audit fix --force`. A instalação limpa exigiu instalar também o Chromium correspondente ao Playwright do lockfile; a primeira tentativa de UI sem esse binário falhou antes de abrir o navegador. As verificações concluídas estão registradas acima.

O inventário também registra hashes dos principais vendors e a base Docker declarada. Eles não estão cobertos por `npm audit`: Turf/GDAL ainda exigem confirmação de proveniência/versão, e o banner do milsymbol diverge da versão interna. A imagem efetiva da rede interna permanece inacessível. Zero alertas npm não encerra a entrega de segurança nem autoriza a publicação.

Os avisos consultados indicam correções publicadas para [sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [Nodemailer](https://github.com/advisories/GHSA-8m3c-c648-2xjj), [Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) e [fflate](https://github.com/advisories/GHSA-px8p-9vwx-vf98). A aplicabilidade em runtime/build/vendors e a correção completa continuam na entrega de segurança; contagem de audit não é prova de explorabilidade.
