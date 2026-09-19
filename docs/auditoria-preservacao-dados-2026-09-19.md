# Preservação de dados: transição de main para integracao_backend

Data: 19/09/2026. Base examinada: `main` em `8b611113` e `integracao_backend` em `1ba66c77`. As correções descritas abaixo integram a alteração de preservação de dados em `integracao_backend`; esta auditoria não publica nem modifica a instalação da intranet.

**Complemento posterior:** os acervos fornecidos, interrupções, pacote HTTPS, publicação e restauração foram ensaiados em [auditoria de lançamento](auditoria-lancamento-2026-09-19.md). Esse documento atualiza as contagens e os limites abaixo, especialmente os itens 4, 6 e 7; a intranet real foi excluída pelo usuário.

## Resultado

Foram encontrados e corrigidos caminhos concretos de perda de referência a atlas locais, apagamento prematuro do cache remoto, retirada indevida de operações da fila, recuperação incompleta de gravações interrompidas e sobrescrita por gravações adiadas. Também foram acrescentadas recusas conservadoras para formatos não suportados e verificações de integridade nas cópias.

Os testes exercitam armazenamento, falhas injetadas, concorrência entre abas, navegador Chromium e sincronização com backend/PostgreSQL de teste. Eles reduzem o risco nos caminhos examinados; não demonstram ausência de todo defeito nem substituem uma homologação com dados reais da instalação.

## Defeitos e proteções implementadas

| Situação que disparava o risco | Efeito possível | Correção e evidência |
| --- | --- | --- |
| Uma aba mantinha uma lista antiga de atlas; outra renomeava, migrava ou excluía um atlas. Ao criar/trocar/excluir, a primeira regravava toda a lista antiga. | Ressuscitar uma entrada excluída, desfazer uma renomeação ou restaurar um `dbSuffix` antigo, fazendo dados existentes parecerem desaparecidos. | Gravação apenas da entrada alterada e do ponteiro necessário. Releitura do registro e serialização por Web Locks. Testes de aba desatualizada, exclusão e criação concorrente junto ao limite. |
| Falta de espaço durante a criação de um atlas local. | Publicar na lista um atlas cujo registro inicial não foi salvo. | Gravar o registro de dados antes de anunciar a nova entrada; teste de falha de quota. O original não é alterado. |
| Uma chave de registro existente perdia seu `dbSuffix`, mas o espelho em localStorage ainda o conservava. | Resolver o atlas para bancos vazios derivados de seu ID, abandonando os bancos migrados ou resgatados. | Recuperação do endereço a partir do espelho, validando-o. Chaves ausentes não são mescladas indiscriminadamente, para não ressuscitar exclusões. |
| Abertura de atlas remoto apagava seu cache antes de conectar; o servidor/rede falhava. | Perder a projeção local e imagens ainda recuperáveis. A falha também podia reclassificar dados remotos como locais. | A abertura normal limpa somente estado de apresentação em memória, preserva IndexedDB/fila e mantém a origem remota. O resolvedor de mapas é reconstruído a partir do cache montado, inclusive para pulls incrementais. Teste sem conexão com sentinelas nos bancos e na fila. |
| Usuário confirmava descartar um atlas resgatado para reabrir o remoto. | Operações descartadas poderiam continuar na fila e ser reenviadas. | Esse descarte explícito também limpa a fila correspondente. Não é o caminho da abertura normal. |
| Resposta de push continha apenas ID, status desconhecido, recibos contraditórios ou confirmação de parte de um lote. | Retirar trabalho ainda não confirmado; tentar reenviar um lote incompleto; avançar metadados com um recibo incerto. | Exigir confirmação positiva reconhecida; preservar recibos incertos na fila; manter o lote inteiro se faltar confirmação de qualquer membro. Metadados só avançam para operações efetivamente confirmadas. Testes de ACKs e lotes. |
| A aplicação fechava depois de registrar uma intenção na fila, antes de materializá-la; o servidor continuava na mesma versão. | O atalho de snapshot já aplicado podia ignorar a intenção preparada indefinidamente. | Fila com operações preparadas exige snapshot completo e impede o atalho de mesma versão, permitindo replay da intenção. Teste de recuperação no mesmo cursor. |
| Atlas com versão futura, inválida, antiga demais ou dados sem marcadores passava pelo boot. | Normalizações escreverem sobre formato desconhecido; versão antiga demais ser anunciada como migração bem-sucedida. | Validar antes de limpeza/backfills. Recusar edição/migração incompatível e preservar dados para recuperação. Um slot só é tratado como novo sem marcadores se seus bancos de dados estiverem vazios. |
| Salvamento adiado antigo demorava ou entrava em retry enquanto uma alteração nova era gravada. Fechar painel podia cancelar a última edição. | Valor antigo sobrescrever o novo ou perder o último salvamento já solicitado. | Um escritor ordenado por chave; flush aguarda gravações em andamento e drena a última alteração. Três testes de ordenação, retry e fechamento. |
| Troca de mapa/atlas antes de executar salvamento adiado de camada ou estilo. | Gravar no novo mapa/atlas usando identificador compartilhado. | Captura do mapa e do escopo de origem; recusa de gravação de estilo após mudança de atlas, com aviso de alteração não salva. Testes de troca de mapa e atlas. |
| Cópia para um alias do mesmo banco, alteração concorrente na origem ou escrita de destino inconsistente. | Sobrescrever a origem ou anunciar como correta uma cópia divergente. | Recusar mesmo sufixo físico mesmo entre kinds distintos; capturar geração; reler valores gravados e comparar inventário/hash da origem. Falhas rejeitam a cópia e os chamadores tratam o destino incompleto. Testes de corrupção simulada, edição concorrente e cópia real no navegador. |

## Proteções existentes examinadas e preservadas

- A transição dos bancos sem namespace prepara uma cópia em novo endereço, verifica o conteúdo e conserva os bancos antigos. Não depende de converter os únicos dados existentes no próprio lugar.
- O fluxo de recuperação de migração permite exportar dados brutos; uma falha de quota bloqueia o editor e pode ser retomada depois de corrigida a causa.
- Uma aba antiga de `main` bloqueia a preparação inicial; alterações posteriores nos bancos antigos têm um caminho de recuperação. A aba antiga não escreve diretamente no destino migrado.
- Atlas locais e remotos possuem bancos separados. O bloqueio entre abas do mesmo atlas atua também nas gravações; atlas distintos podem operar simultaneamente.
- A aplicação de snapshot remoto usa gerações, com ponteiro/cursor de commit. As imagens e a fila possuem tratamento próprio; não se deve deduzir perda de conteúdo pela ausência de um banco antigo sem o sufixo da geração ativa.
- Saída/logout com descarte explicitamente confirmado pode eliminar pendências remotas. Os cenários de segurança verificam esse contrato e a preservação dos atlas locais. Isso é diferente de garantir conservação de pendências após o usuário confirmar descartá-las.
- O backend possui validação de operações, idempotência, lotes e controle de concorrência; os testes de sincronização foram executados em banco exclusivo de teste, removido ao final.

## Validação

Baseline anterior às mudanças: **712 arquivos / 13.189 testes de frontend aprovados**.

- **Frontend ao concluir a auditoria inicial: 714 arquivos / 13.211 testes aprovados, sem testes ignorados**, em aproximadamente 113 s. Foram acrescentados 22 casos em relação à baseline. As contagens posteriores estão no complemento de lançamento.

- **Lint JavaScript aprovado**, incluindo as sondas das regras internas.
- **Build de produção aprovado**, em aproximadamente 1 min 33 s. O bundler emitiu avisos de divisão de chunks/imports e de um seletor CSS de `docsify`; não impediram a geração do pacote.

- **Backend: 474 testes em 180 suítes aprovados**, usando `TEST_DB_NAME=ebgeo_safety_audit_20260919`. Banco de teste criado e removido pelo executor; nenhum banco de produção utilizado.
- **Migração no Chromium: 8 cenários aprovados**: quota, binário incompressível de 8 MiB, aba main aberta, alterações tardias da main, API indisponível/recuperação bruta, conteúdo migrado, Blob de imagem e duas abas migrando juntas. A fixture representa o formato de main; o teste de trava usa seu código no commit indicado.
- **Múltiplas abas no Chromium: 10 cenários aprovados ao combinar a execução inicial e a repetição dos casos corrigidos**. Duas asserções antigas exigiam bancos sem geração, criados pelo apagamento que foi removido. Foram corrigidas para inspecionar os bancos da geração efetivamente publicada, mantendo as verificações de isolamento e bloqueio. A1, A2 e A2b passaram na repetição.
- **Segurança de atlas: 3 cenários aprovados**: locais A/B, abertura/reabertura remota e logout; descarte confirmado de pendências em atlas remoto deixado para trás; descarte sem depender de espaço para atlas de resgate.
- **Cópia local: 1 cenário de navegador aprovado**, verificando conteúdo da cópia e preservação da origem.
- Total: **22 casos distintos de navegador**, contando também o controle do instrumento da suíte de múltiplas abas. Não foi executada toda a suíte Playwright do produto.

Comandos reproduzíveis, a partir da raiz:

```powershell
npm test --prefix frontend -- --maxWorkers=2
npm run lint:js --prefix frontend
npm run build --prefix frontend
$env:TEST_DB_NAME='ebgeo_safety_audit_20260919'
npm test --prefix backend -- 'tests/integration/sync-*.test.js'
npm run test:e2e:atlas --prefix frontend
npm run test:e2e:ui --prefix frontend -- browser-migracao-2.2.spec.js browser-multi-tab-namespace.spec.js --retries=0
npm run test:e2e:ui --prefix frontend -- browser-multi-tab-namespace.spec.js --grep 'A1|A2' --retries=0
npm run test:e2e:ui --prefix frontend -- copiar-atlas-local.spec.js --retries=0
```

Os logs desta execução estão na raiz, nos arquivos `frontend-audit-*.log` e `backend-audit-sync.log`, ignorados pelo Git. Os testes novos e as correções nos testes existentes estão em `frontend/tests/`.

Uma repetição da suíte identificou interferência entre testes de bloqueio: destruir a aba vizinha primeiro disparava uma reabertura adiada durante o encerramento do teste. O teardown foi corrigido para cancelar essa ação e encerrar primeiro o lock da página; os 36 casos do grupo passaram na execução isolada. A validação de tamanho do pacote deve rodar depois do build, pois o build substitui o diretório `dist` que esse teste lê.

## Limites e cuidados para a atualização da intranet

1. **Manter a origem exata do navegador: protocolo, hostname e porta.** Mesmo IP não basta se o usuário passar a abrir por outro nome, ou se mudar a porta. O perfil do navegador também precisa ser o mesmo. O código foi validado com navegador local em contexto seguro; o proxy, certificado e políticas da intranet real não foram testados.
2. **Conservar uma cópia externa dos dados antes da atualização e testar sua abertura.** O backup `.ebgeo` atende à cópia funcional; para uma recuperação integral, também há exportação bruta no fluxo de recuperação. Uma cópia dentro do mesmo armazenamento do navegador não protege contra limpeza dos dados do site, remoção do perfil, falha de disco ou políticas de descarte do navegador.
3. **Fechar as abas antigas no corte da versão.** A proteção da migração detecta concorrência, mas edições feitas depois na versão antiga continuam sendo trabalho que precisa ser recuperado. Voltar a servir main não converte de volta as edições feitas no formato novo.
4. **Os acervos de teste fornecidos foram ensaiados no complemento**, incluindo a configuração `EBGEO_MIGRATION_DATA_DIR`, imagens, briefings e arquivos 3D/360. Perfis reais dos usuários não foram fornecidos. As medições locais não dimensionam todo o acervo da instalação.
5. **Espaço adicional continua necessário** para manter origem e destino da migração/snapshot. A recusa por falta de espaço preserva o original; não cria espaço disponível.
6. **A verificação de cópia é otimista.** Ela detecta divergências entre as leituras e rejeita a cópia, mas não constitui uma transação única entre todos os bancos. O complemento corrigiu a publicação de destinos incompletos: preparações ficam invisíveis e são recolhidas sob trava no próximo boot; cópias concluídas são preservadas pelo registro ou espelho. A origem continua conservada. Para backup consistente, interromper a edição enquanto copia.
7. **Encerramento forçado antes do commit continua fora da garantia de persistência.** O complemento acrescentou aviso de saída durante gravações de estilo; a revisão posterior mantém esse aviso e a edição também após falha definitiva de armazenamento, e o painel só fecha após salvar. Estilo que cruza uma troca de atlas é recusado com aviso e precisa ser reaplicado no original, sem escrever no atlas errado. Nenhuma gravação assíncrona garante conclusão depois que o processo é encerrado à força.
8. **A exclusão intencional e o descarte confirmado continuam destrutivos.** A auditoria não mudou essas decisões de produto. Antes de descartar pendências, o usuário deve concluir a sincronização ou guardar a cópia que deseja conservar.
9. **Web Locks é a proteção entre abas para o registro.** Sem essa API, há serialização dentro da aba e gravações restritas à entrada alterada, mas a mesma garantia de serialização entre abas não existe. Homologar nos navegadores efetivamente utilizados.

## Revisão das pendências dos dois relatórios

O seletor inválido do tema docsify (`body:not:has`) foi corrigido no processamento de CSS de desenvolvimento e produção, sem editar `node_modules`. Os imports dinâmicos sem efeito de divisão foram convertidos em imports estáticos dos mesmos módulos. A revisão também corrigiu a perda da edição e do aviso ao esgotar os retries de estilo: a última edição fica disponível para nova tentativa e o painel permanece aberto.

Validação final dessa revisão: **13.218 testes de frontend**, lint JavaScript/CSS, build e **dez cenários Chromium** aprovados. Detalhes e evidências atualizadas estão no complemento de lançamento.

Os avisos restantes sobre tamanho das bibliotecas 3D e tempo gasto nos plugins são diagnósticos de desempenho, não erros de compilação ou de dados. Não foram silenciados nem houve aumento do limite de tamanho. Os itens de origem/perfil, backup externo, espaço disponível, Web Locks e encerramento forçado são condições operacionais e limites declarados, não defeitos marcados como corrigidos. A intranet permanece excluída por orientação do usuário.

## Arquivos principais

- Registro e cópia: `frontend/src/js/store/local-atlas.api.js`, `atlas-namespace.js`.
- Abertura remota: `frontend/src/js/account/open-atlas.service.js`, `frontend/src/js/store/store.js`.
- Migração e boot: `frontend/src/js/store/migration/migration.service.js`, `frontend/src/js/store/repository.js`.
- Sincronização: `frontend/src/js/store/sync/sync-engine.js`, `remote-operation-handler.js`.
- Gravações adiadas: `frontend/src/js/utilities/debounced-persist.js`, `frontend/src/js/layers/layer.manager.js`, `frontend/src/js/features_tab/layer-style-panel.component.js`.
