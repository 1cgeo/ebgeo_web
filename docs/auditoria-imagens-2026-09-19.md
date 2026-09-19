# Auditoria de salvamento, restauração e migração de imagens

Escopo: branch `integracao_backend`, imagens importadas, símbolos militares, medidas de coordenação, declinação magnética e ícones personalizados. Ensaios locais em Chromium, IndexedDB e backend de teste. A intranet real não foi acessada, conforme solicitado.

## Defeitos e proteções

| Situação | Consequência | Correção |
| --- | --- | --- |
| Download de imagem termina depois da troca de atlas ou substituição do snapshot. | O blob antigo podia ser guardado sob o mesmo ID no atlas novo. | Conferência da identidade da montagem e da geração dos dados antes de devolver ou armazenar o resultado. |
| Ícone personalizado termina de carregar ou subir depois da troca de atlas. | Cache decodificado, catálogo de ícones ou metadados podiam pertencer ao atlas anterior. | Cache associado ao contexto, verificação da montagem nas leituras/uploads e descarte de decodificações superadas. |
| Decodificação termina depois do timeout ou depois de outra imagem com o mesmo ID. | O callback antigo podia substituir a imagem mais recente. | Finalização única, cancelamento lógico e prioridade para a solicitação mais recente. |
| Símbolo editado remotamente enquanto outro mapa estava aberto. | Um bitmap em disco com versão de layout atual podia continuar mostrando conteúdo antigo. | Regeneração a partir das propriedades na restauração; assinatura em memória permite reutilizar apenas conteúdo já conferido naquela montagem. |
| Geração de símbolo/medida/declinação atravessa troca de atlas, mapa ou snapshot. | Gravação, desenho ou carimbo de dimensões no contexto errado. | Verificações antes e depois das etapas assíncronas, inclusive na gravação do carimbo dentro da fila do documento. |
| Outra edição chega durante a geração de um símbolo. | A última edição pendente era apagada ao terminar a anterior. | A edição recebida durante a execução permanece agendada. |
| Foto não encontrada temporariamente. | O ícone de erro era considerado imagem válida e impedia novas tentativas de restauração. | Falhas não entram no cache de imagens conferidas; restaurações seguintes tentam novamente e substituem o ícone de erro. |
| “Adicionar ao atlas” com IDs já existentes. | O importador sobrescrevia blobs originais antes de criar os IDs das feições importadas. | IDs isolados para as imagens do ZIP, incluindo referências dos ícones personalizados. A cópia consulta o blob isolado. |
| Foto ausente no ZIP aditivo, mas com ID existente no atlas. | A importação podia usar uma foto diferente, pertencente ao atlas aberto. | Recusa da cópia; bitmaps gerados ausentes podem ser reconstruídos pelas propriedades, sem usar o blob alheio. |
| Falha de leitura/gravação de blobs na importação ou duplicação. | A exceção era apenas registrada no console e a operação podia aparentar sucesso. | Propagação do erro e interrupção da operação. |
| Exportação sem acesso a uma foto ou ícone obrigatório. | Arquivo `.ebgeo` aparentemente válido, mas incompleto. | Interrupção da exportação com mensagem de erro. Troca de atlas durante a exportação também impede o download. |
| Declinação sem valores numéricos válidos. | Diagrama gerado a partir de valores indefinidos. | Recusa da regeneração; preservação do bitmap original, quando existente, ou indicação de erro. |
| Declinação antiga com ângulos em `declinacao`/`convergencia`. | Definição recuperável tratada como inválida; ausência de opacidade também podia ocultar a imagem. | Conversão dos aliases numéricos e preenchimento apenas dos padrões visuais ausentes. Mesma regra na importação local, leitura do navegador, snapshot e preparação da importação no servidor. |

A importação não é uma transação única de todos os bancos: uma falha pode deixar um atlas novo parcialmente preenchido ou recursos novos sem referência. Os erros agora são informados, e as imagens existentes não são sobrescritas pela importação aditiva. O arquivo original permanece disponível para repetir a operação.

## Migração e imagem efetivamente desenhada

O ensaio `frontend/tests/e2e-ui/migration-external-data.scenario.js` foi ampliado. Além de comparar registros e bytes, visita todos os mapas, decodifica os blobs, compara suas dimensões com os bitmaps instalados no MapLibre e verifica pixels não transparentes. Para amostras de cada família em cada mapa, centraliza a feição e confirma sua presença em `queryRenderedFeatures`. Visibilidade, filtro e opacidade são ajustados apenas na vista descartável de teste para não confundir uma feição intencionalmente oculta com falha de migração.

| Acervo | Registros de imagem no arquivo | Bitmaps de feições conferidos por percurso | Amostras renderizadas por percurso |
| --- | ---: | ---: | ---: |
| `01-completo.ebgeo` | 5 | 4 | 2 |
| `03-completo-2.4.ebgeo` | 149 | 146 | 12 |
| `04-completo-2.3.ebgeo` | 131 | 128 | 10 |
| `05-completo-2.2.ebgeo` | 131 | 128 | 10 |

Cada acervo passa por dois percursos: importação pela interface e migração dos bancos antigos do navegador. Os três ícones personalizados de cada arquivo entram na comparação dos blobs, mas não na contagem de bitmaps das quatro famílias da tabela. Fotos e ícones mantêm os bytes; bitmaps gerados podem mudar, com conferência das propriedades autorais (SIDC, código da medida e ângulos).

Há também cenários construídos para v1.7: uma foto, um símbolo militar, uma medida e uma declinação recebem IDs não UUID. Um cenário importa o `.ebgeo`; outro simula o armazenamento antigo do navegador. Após F5, os quatro bitmaps e as quatro renderizações são verificados. No percurso do navegador, os IDs são migrados para UUID e continuam associados às imagens. Esses dois cenários são sintéticos, derivados das feições válidas do acervo 2.4, e não arquivos históricos v1 coletados de usuários.

Os arquivos em `_ebgeo_dados_teste` são somente lidos. Os ensaios comparam seus SHA-256 antes e depois.

## Limitação encontrada no próprio `01-completo.ebgeo`

A aprovação anterior desse arquivo demonstrava preservação dos registros e dos cinco blobs existentes, não que toda feição de imagem pudesse ser desenhada. A nova inspeção encontrou nove referências sem bitmap original: uma foto, seis símbolos com SIDC incompleto, uma medida sem `pointCode` e uma declinação com campos `declinacao`/`convergencia` em lugar de `declination`/`convergence`. A leitura do código de `origin/main` confirmou os nomes usados pelo aplicativo.

A análise posterior distinguiu incompatibilidade de campos de ausência de conteúdo: **a declinação é recuperável e agora é recuperada automaticamente**. Os valores registrados, −21,5° e 0,7°, são copiados para `declination` e `convergence`. Os campos antigos e o ano permanecem; não há recálculo magnético, criação de uma data a partir do ano ou alteração das coordenadas. Os padrões visuais ausentes são preenchidos conforme a ferramenta atual; valores explícitos existentes têm precedência, inclusive tamanho/opacidade zero e ângulos canônicos conflitantes. Aliases textuais ou não finitos não são convertidos silenciosamente.

A conversão funciona por conteúdo, inclusive se o documento já estiver marcado como versão 3.0. Na importação, a definição compatível é salva no destino. Na leitura de um banco antigo, é produzida uma cópia compatível em memória, sem reescrever o registro original apenas por lê-lo; um salvamento posterior incorpora os campos. Os arquivos de teste e o banco legado preservado para recuperação continuam intactos. O diagrama é regenerado e o teste exige bitmap de 400×500, ângulos e coordenadas preservados e renderização após reabertura **antes de forçar opacidade, tamanho ou filtros**.

Restam **oito referências não reconstruíveis automaticamente**: a foto sem bytes, os seis símbolos sem definição suficiente para o gerador atual e a medida sem código inequívoco. Esses registros continuam preservados e o teste exige uma imagem de erro disponível, sem contabilizá-los como desenhos recuperados. Recuperar a foto exige o arquivo original ou uma cópia de segurança; os símbolos e a medida exigem completar suas definições. Os três PNG de fotos existentes continuam sendo conferidos. Por percurso, o primeiro acervo passa a ter quatro bitmaps válidos de feições: três fotos e a declinação recuperada.

## Verificação e limites

Medições dos 13 cenários distintos de migração, incluindo a declinação recuperada e as oito referências ainda incompletas do primeiro acervo: [auditoria-imagens-2026-09-19.json](auditoria-imagens-2026-09-19.json). Os testes não usam retries automáticos.

Os testes de regressão incluem concorrência de download/decodificação, substituição de snapshot, troca de atlas/mapa, cache antigo, colisão na importação e falhas de armazenamento/exportação.

- Suíte frontend após a recuperação dos aliases: **718 arquivos, 13.260 testes aprovados**.
- Migração/arquivos após a recuperação dos aliases: **13 cenários Chromium aprovados na mesma rodada**, sem retries automáticos; medições no JSON.
- Colaboração e colagem: **8 cenários Chromium aprovados**, incluindo um controle negativo que demonstra por que `map.hasImage` sozinho não prova a chegada dos bytes. Cobrem upload interrompido, F5, colagem, restauração por snapshot e edição remota enquanto outro mapa está selecionado.
- Lint JavaScript/CSS, build de produção e os 10 testes de integridade da documentação aprovados.

Comandos de reprodução, a partir da raiz do repositório:

```powershell
npm test --prefix frontend -- --maxWorkers=2
npm run lint --prefix frontend
npm run build --prefix frontend
$env:EBGEO_MIGRATION_DATA_DIR='C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\_ebgeo_dados_teste'
npm run test:e2e:ui --prefix frontend -- --config=playwright.migration-data.config.js
npm run test:e2e:ui --prefix frontend -- browser-collab-symbol-snapshot-regen.spec.js browser-collab-imagem-retomada.spec.js browser-collab-colar-imagem.spec.js colar-registra-imagem-por-feicao.spec.js --retries=0
```

Não executar build simultaneamente com a suíte Vitest: os testes do grafo de produção consultam os artefatos de `dist`.

Na rodada suplementar, uma execução da suíte geral em paralelo com Chromium teve duas falhas: timeout de cinco segundos no censo de recursos e resposta tardia no teste de bloqueio entre a aba antiga e a nova, que configura uma espera de 50 ms (o padrão da aplicação é 300 ms). Os dois arquivos passaram isoladamente, e a suíte completa, repetida sem a campanha Chromium concorrente, aprovou os 13.260 testes. O protocolo de bloqueio não foi alterado nesta correção; essa ocorrência não deve ser tomada como validação de todos os atrasos possíveis entre abas.

O cenário Chromium do acervo mínimo também expôs condições inadequadas no ensaio: a existência da instância MapLibre antecede a montagem do banco do atlas, e a cortina visual pode desaparecer antes de terminar a inicialização. O helper agora espera também o hook instalado após a inicialização do armazenamento e do bloqueio entre abas, mantendo as mesmas asserções de namespace e preservação. A cópia bruta de recuperação é executada com o mapa fechado, como na tela de recuperação, para não disputar com gravações de câmera ainda pendentes. Uma tentativa anterior com o mapa aberto foi corretamente recusada pela verificação de mudança durante o snapshot. O ensaio continua comparando a origem antiga e o conteúdo recuperado, sem dispensar divergências nem usar retries automáticos.

Permanece a limitação documentada em [simulação de conectividade](simulacao-conectividade-2026-09-19.md): uma falha isolada no endpoint de upload, mantendo o WebSocket online, conserva o blob e a pendência, mas pode exigir reconexão ou F5 para nova tentativa. Esta auditoria não altera o agendamento dessa fila.

Não há certificação da intranet, de todos os formatos históricos possíveis ou de todos os navegadores. A cobertura distingue preservação dos dados, reconstrução do bitmap e renderização das amostras.
