# Auditoria de preparação para o lançamento (23/09/2026)

**Estado: em andamento.** Janela solicitada: 22/09 às 20:53:44 até 23/09 às 05:53:44, horário de Brasília (9 horas). Este documento será atualizado com os resultados finais.

Às 04:55, o usuário pediu o encerramento das alterações e a manutenção apenas dos testes em execução. A consolidação abaixo respeita esse limite.

Branch: `integracao_backend`. Base após a conclusão da sessão paralela: `e753a0aedd04f1147211c725d79cbe054a2d7c24`. O trabalho de símbolos de engenharia dessa sessão foi preservado. A produção em HTTPS na intranet não é acessível deste ambiente; não houve alteração ou implantação nela.

## Correções com reprodução do defeito

### Integridade de arquivos, cópias e exportação

- **Imagens no servidor:** um reenvio idempotente agora verifica os bytes existentes e repara arquivo ausente, truncado ou divergente. A escrita é preparada antes da confirmação no banco, com nomes exclusivos e remoção limitada aos arquivos pertencentes à própria tentativa. Testes exercitam falha de disco, rollback e concorrência.
- **Clonar atlas e duplicar mapa:** os arquivos são preparados antes da transação; falhas de cópia impedem a criação de uma cópia incompleta. A origem é conferida novamente antes de confirmar. As ordens dos mapas e slides são traduzidas para os novos identificadores.
- **Comentários em cópias:** permissões da origem são verificadas; comentários e respostas copiados recebem identificadores próprios. Referências a recursos privados sem acesso são removidas, inclusive comentários 3D/360 vinculados a esses recursos. A exportação de primeira pessoa segue a mesma restrição de acesso.
- **Exportação e recuperação local:** nomes como `__proto__`, `constructor` e `toString` são tratados como dados. Falhas de leitura deixam de produzir silenciosamente um arquivo aparentemente completo. Exportação parcial exige a decisão explícita já prevista na interface. A recuperação recusa colisões ambíguas e preserva a possibilidade de baixar os dados originais.
- **Envio ao servidor:** seções de comentários que o formato de envio não consegue transportar são informadas antes da confirmação. O original local é preservado.

### Concorrência e edição

- **Confirmação de sincronização:** a decisão de retirar uma operação pendente passou para dentro da mesma trava que protege o documento do mapa. Um ACK atrasado deixa de apagar uma alteração posterior do usuário. A reprodução anterior falhava em quatro cenários; a correção foi verificada em integração e entre navegadores.
- **Conexões IndexedDB:** leituras, gravações e o diário passam a compartilhar conexões nativas por banco. Conexões inválidas são descartadas e mudanças de versão fecham a conexão anterior. O ciclo anterior de abrir/fechar conexões provocava `UnknownError` no Firefox durante uso prolongado.
- **Desfazer e painéis:** um painel que está fechando deixa de salvar novamente dados antigos durante a animação e de reaplicá-los depois de um desfazer. A desativação do seletor de engenharia também evita esse salvamento redundante.
- **Atualizações assíncronas da lista de feições:** respostas antigas não substituem a lista de outro mapa, outro atlas ou um componente já desmontado.
- **Rascunhos:** atualizações de colegas preservam texto ainda não enviado em comentários 2D/3D/360. O nome de mapa em edição também sobrevive à atualização recebida de outro usuário; a preservação respeita a identidade do mapa e do atlas.
- **Desenhos concluídos com gravação atrasada:** as ferramentas capturam geometria, camada e identidade do mapa antes de aguardar operações assíncronas. A proteção abrange desenhos básicos, símbolos militares e de engenharia, azimute, imagens e análises de visibilidade. Trocar de ferramenta não esvazia a geometria; trocar de mapa não envia o desenho para o mapa errado. Uma seleção automática atrasada respeita a interação seguinte e não fecha sua paleta. A conclusão de uma medição também preserva a ferramenta ativada durante a gravação.
- **Escrita recusada:** as ferramentas conferem o resultado da criação antes de acrescentar a feição à fonte visual. O bloqueio de um mapa durante a finalização produzia feições desenhadas que nunca foram gravadas, reproduzido com linha, polígono e círculo. Foram verificadas também as criações normais de 12 ferramentas e sua persistência após recarga.
- **Conclusão duplicada:** concluir a mesma linha, polígono, seta, limite, linha de coordenação ou construção por azimute duas vezes durante uma gravação pendente deixa de gerar feições sobrepostas. A proteção distingue uma nova ativação da ferramenta, permitindo terminar outro desenho enquanto o anterior é salvo. Nos desenhos militares, a cópia da geometria antes da espera também impede substituir o traçado anterior pelo novo.
- **Medições repetidas:** clicar novamente em “Salvar como feição” enquanto a gravação está pendente deixa de criar uma segunda cópia da medição de área ou distância. A reprodução conferiu duas feições persistidas; a correção passou em 24 execuções nos dois navegadores, incluindo a preservação da próxima ferramenta.
- **Camada excluída durante a criação:** se a camada original desaparece enquanto o desenho é preparado, a conclusão usa outra camada disponível do mesmo mapa e informa o usuário. Apenas mudar a camada ativa preserva o destino original. A reprodução anterior gravava pontos, linhas e círculos com uma camada inexistente, tornando-os invisíveis. Os resultados derivados da análise de visibilidade passam a herdar a camada definitiva do objeto principal.
- **Símbolos de engenharia importados:** uma configuração opcional explicitamente nula passa a usar os valores iniciais do catálogo, em vez de lançar uma exceção ao preparar o símbolo. O teste percorre todos os símbolos do catálogo.
- **Saída do visualizador:** a limpeza de recursos 3D é registrada pelo visualizador efetivamente carregado, evitando importações tardias durante o descarregamento da página no Firefox.
- **Prévia de visibilidade 3D:** a leitura de profundidade exclui temporariamente as primitivas da própria prévia. No Firefox, elas alteravam a distância medida no segundo clique, mesmo com câmera e ponteiro parados.

### Desempenho

- **Grupos no servidor:** o snapshot indexa os membros por grupo uma única vez. A reprodução com 200 grupos e 1.000 associações fazia 200.000 acessos; o novo teste exige custo linear e confere os membros de todos os grupos.
- **Grupos no navegador:** a organização das feições usa um índice por tipo e identificador. O cenário de 2.000 membros fazia 2.001.000 consultas antes da correção. A ordem e a semântica dos grupos são preservadas.
- **Administração:** abas carregadas sob demanda reduziram o conjunto inicial medido de 867.597 para 826.494 bytes, abaixo do limite de 830 KiB já exigido pelo projeto.

## Evidências concluídas até esta atualização

Os números abaixo descrevem execuções concretas; não equivalem a uma garantia de ausência de defeitos.

| Verificação | Resultado observado |
| --- | --- |
| Gate completo v22 | 15.483 testes frontend, 5.609 backend e 261 contratos aprovados, antes da correção posterior de camada excluída durante a criação. Build v17 e lint aprovados; o lint v23 também cobre os ajustes posteriores de preparação dos testes de protocolo. A rodada v25 verifica a árvore com a correção de camada. |
| Gate final v25 | Build v19 e lint aprovados. Frontend: 15.481 aprovações e duas falhas no teste de perfil de terreno; a simulação de `layerManager` desse teste fornece somente `getActiveLayerIdSync`, sem o `getLayers` agora utilizado pela criação. Backend e contratos não foram executados nessa rodada, pois o comando encadeado parou na falha frontend. A árvore final ainda não tem um gate completo aprovado. |
| Desenho básico com concorrência | 72 execuções aprovadas em Chromium/Firefox: mapa de destino, troca de ferramenta/paleta e criação normal com recarga. |
| Desenho militar e engenharia | 66 execuções aprovadas nos dois navegadores: destino, conclusão duplicada, geometria de novo gesto e persistência normal de 17 ferramentas. |
| Imagens e análises atrasadas | 12 execuções aprovadas nos dois navegadores. A transição durante o processamento é feita pela operação real do aplicativo, pois o modal de progresso bloqueia o clique físico na barra lateral. Os testes verificam a análise principal e suas feições derivadas depois da recarga. |
| Imagens e análises normais | 24 execuções aprovadas nos dois navegadores, com importação/exportação das análises e processamento real de arquivos de imagem. |
| Imagens e análises após recuperação de camada | Rodada final com 60 aprovações em 16,9 minutos: duas repetições nos dois navegadores, sem retry automático. Inclui imagens, visada e visibilidade com exclusão de camada durante a criação, persistência após recarga, ciclo de exportação/importação e transmissão de imagens ao colega. |
| Azimute e medição | 32 execuções aprovadas nos dois navegadores, com mudança de mapa, conclusão repetida, próxima ferramenta preservada e recarga. |
| Medição com salvamento repetido | 24 execuções aprovadas nos dois navegadores, com os identificadores e a geometria conferidos após recarga. |
| Camada excluída e persistência de desenhos | 131 aprovações e uma falha em 132 execuções, Chromium/Firefox, duas repetições, sem retry automático. A falha do texto no Firefox ocorreu na leitura após recarga, quando o teste consultou `getLayers` antes da inicialização do gerenciador. Foi acrescentada espera pelo botão de navegação antes da leitura, mas essa versão do teste não foi repetida depois da orientação de encerramento. |
| Navegação rápida entre atlas | Quatro execuções aprovadas, duas por navegador: cada execução troca repetidamente entre dois atlas remotos e um local, sem espera artificial depois da conexão. Os três pontos criados pela interface continuam em seus respectivos atlas após recarga. |
| Transporte e isolamento de acesso | 30 repetições específicas e 38 casos completos aprovados em Chromium/Firefox, cobrindo marcadores 3D, anotações 360, mapas, visibilidade e dados temporais. |
| Backend sob carga durante 3 horas | 64 clientes, 32 salas, 412.081 ACKs, sem erros ou desconexões inesperadas. Comparação final de todos os identificadores, geometrias, propriedades e versões com o banco. |
| Uso por 90 minutos no Chromium | Dois clientes, três interrupções de rede, renovação de sessão e recargas; 362 feições conferidas nos dois IndexedDB e no PostgreSQL. |
| Uso por 90 minutos no Firefox, rodada final | Reprovada na criação do primeiro ponto pela interface após a última recarga: esperava 363 feições e permaneceu em 362. Antes disso, os 362 identificadores foram conferidos nos dois clientes após recarga. Os diagnósticos finais mostram ambos online, filas vazias e nenhum erro de página registrado. A comparação SQL final não foi alcançada nesta rodada. |
| Conexões nativas IndexedDB | Sequências de 300 gravações/leituras e 300 operações de diário, nos dois navegadores; regressões específicas aprovadas. |
| Atlas grande | Cenários com 1.000 e 10.000 feições nos dois navegadores, comparação de todos os identificadores, edição confirmada no banco e recarga. |
| Grupos grandes | Cenários de 10.000 e 30.000 feições agrupadas nos dois navegadores, edição e recarga conferidas. |
| Migração e arquivos fornecidos | Leitura dos arquivos de teste sem modificar os originais; cenários de migração, recuperação, imagens e formatos exercitados. |
| Interface de toque | 30 casos aprovados na rodada específica. |
| Exportação parcial e completa | 20 execuções aprovadas, nos dois navegadores, após ajustar a espera pelo término real da recarga. |
| Implantação atômica em ambiente local Linux/WSL | 34.463 leituras durante 200 trocas, sem erro; dois rollbacks exercitados. |
| Dependências de produção | `npm audit --omit=dev`: nenhuma vulnerabilidade reportada em frontend e backend na consulta realizada. |

O teste HTTPS usa o bundle compilado, certificado local, proxy HTTP/WebSocket e backend real. Ele inclui migração de dados do `main`, trabalho offline, recarga e restauração de backup com comparação de tabelas e hashes de arquivos. O bundle v16 passou em 18 execuções. O bundle v17 passou nos seis casos dos dois navegadores, conferindo 58 tabelas, 10.430 registros e 1.127 arquivos binários na última restauração. A rodada final v19, com todas as correções de produto, terminou com 18 aprovações em seis minutos, nos dois navegadores e sem repetição automática de falhas.

As matrizes completas Chromium e Firefox rodam em checkouts isolados e congelados para não misturar código enquanto os testes executam. Correções posteriores ao congelamento recebem testes específicos na árvore atual. A matriz Chromium, congelada às 05:21 UTC, terminou com 505 aprovações, duas falhas e um caso aprovado na repetição. Uma falha veio de um seletor de canvas ambíguo no próprio teste de engenharia, já corrigido; a outra, de uma transição que permaneceu offline no boot. O caso intermitente aguardava o carregamento do mapa. Os três cenários passaram nas 12 repetições instrumentadas em Chromium/Firefox, incluindo 40 aberturas remotas no cenário de transições; isso ainda não identifica a causa da falha original de boot. Uma nova matriz Chromium de 586 cenários começou às 07:14 UTC com as correções disponíveis naquele momento, antes da correção de camada excluída.

A matriz Firefox começou com o snapshot das 04:46 UTC e terminou com 479 aprovações, 21 falhas e três casos aprovados na repetição, em 3,6 horas. Entre as falhas estão nove casos de menu/teclado com permissões de clipboard incompatíveis, quatro preparações de login por API interrompidas pelo boot, a emulação offline sem encerramento de WebSocket, a tentativa de usar CDP no Firefox, o seletor de canvas ambíguo em engenharia, a montagem prematura de presença, a requisição DEM do instrumento visual e a divergência da prévia 3D. Esses caminhos receberam ajustes posteriores ao congelamento. Permanecem sem confirmação de causa a leitura de zero chaves de mapa após F5 no ciclo completo de importação (esperava 11) e a comparação entre tempos de troca de atlas acima do limite de dez vezes. A rodada específica corrigida de rede passou nos oito casos Firefox, verificando os dados persistidos e a convergência com o servidor. Alterar arquivos do instrumento depois da coleta não atualiza testes já carregados pelo processo; portanto, os resultados da matriz congelada não são apresentados como validação das correções posteriores.

Outras falhas dessa matriz vieram de preparar o login por API enquanto a página do mapa ainda iniciava. O login grava tokens; o boot reconhecia esses tokens e redirecionava para a tela de atlas, interrompendo as requisições e apagando os objetos temporários do teste. A reprodução na versão atual registrou `auth/login` com resposta 200 seguido da navegação para `atlas.html`. Os testes exclusivos de protocolo passaram a iniciar nessa tela; os testes de autoria continuam usando a interface do mapa. Depois disso, os 30 casos repetidos e os 38 casos completos passaram. Esse ajuste de quatro arquivos do instrumento foi posterior ao congelamento da segunda matriz Chromium.

## Limites de interpretação

- A latência, o TLS, o proxy, os cabeçalhos, os tiles e a capacidade da infraestrutura real da intranet ainda precisam ser conferidos no ambiente de homologação/produção. Os testes locais HTTPS não demonstram a configuração dessa infraestrutura.
- Tempos de CPU/GPU, memória e carga foram medidos nesta máquina, com outros testes simultâneos. Servem para detectar regressões e crescimento contínuo; não dimensionam a capacidade do servidor de produção.
- A organização dos grupos deixou de ter custo quadrático, mas a lista grande ainda materializa muitos elementos: o cenário com 30.000 feições agrupadas criou 121.741 nós DOM ao abrir a lista, em cerca de 1,47 a 2,44 segundos nos navegadores medidos. A lista não foi virtualizada nesta auditoria; esse continua sendo um limite de desempenho para acervos grandes.
- Algumas falhas de testes eram do instrumento: permissões de clipboard exclusivas do Chromium, WebSocket não encerrado pela emulação offline do Firefox, leitura antes do fim do boot e comparação de arrays cuja consulta SQL não define ordem. Os ajustes mantêm as verificações de conteúdo, persistência e convergência; falhas iniciais e rastros foram conservados.
- A primeira sessão longa Firefox encontrou o problema de conexões IndexedDB. Uma repetição corrigida completou 90 minutos, 362 feições e seis renovações de sessão por cliente, com identidade dos dados nos dois IndexedDB e no banco. Entretanto, sua verificação final não aguardava a interface do segundo cliente terminar o boot. A rodada final corrigiu essa espera e comprovou as duas interfaces online, mas falhou ao tentar criar o ponto seguinte. Não se atribui essa falha ao produto ou ao instrumento sem reprodução adicional; novas rodadas não foram iniciadas após a orientação de encerramento do usuário.

## Artefatos locais

Logs, traces Playwright, capturas, provas SQL, manifestos dos snapshots e controles negativos estão em:

`C:\Users\diniz\AppData\Local\Temp\ebgeo-audit-20260922`

O arquivo `progress.md` dessa pasta registra as execuções, inclusive falhas intermediárias e suas causas. Esse diretório temporário não substitui os testes de regressão adicionados ao repositório.
