# Monitoramento e presença, implementação de 12/09/2026

Implementação no branch integracao_backend, a partir da revisão desta data. Não foi implantada no servidor interno.

## Administração

- Usuários e Uso exibem presença atual: contas distintas logadas e navegadores deslogados, com página visível e sinal recebido nos últimos 90 segundos. Atualização do painel a cada 15 segundos; pulso do navegador a cada 30 segundos. Fechamento abrupto, suspensão e perda de rede expiram pela ausência de pulso.
- Abas do mesmo navegador compartilham um identificador aleatório local. Ele não identifica pessoas entre computadores. Sem armazenamento disponível, a deduplicação fica limitada à página. Contas logadas são deduplicadas pelo usuário verificado no servidor.
- Usuários mostra último login e quantidade de atlas remotos dos quais a conta é dona. Atlas na lixeira ficam fora do número principal e aparecem na descrição da célula. Compartilhamentos recebidos não são propriedade.
- Uso separa Preparação e sincronização de Mais usados. O primeiro bloco mostra resultados da preparação dos dados locais, sincronizações e saídas confirmadas com pendências. Os números representam ocorrências, não alterações individuais descartadas nem uma taxa automática de sucesso.
- Presença inclui quantidade e idade das pendências encontradas nos caches remotos, navegadores sem aferição e falhas de coleta observadas nas páginas ativas. A leitura é feita depois da proteção da migração; falha ou prazo excedido produz desconhecido. Não consulta nem transmite o conteúdo das operações.

## Correções de coleta

A captura de erro e uso começa antes da preparação local. O erro de preparação é relatado pela porta única de erro, com mensagem controlada; início e resultado também entram nas contagens. A proteção dos dados continua antecedendo a abertura normal do app.

Lotes sem acionamentos atualizam duração, erros e medidas de desempenho. Duração é o intervalo observado desde a abertura do segmento, não tempo comprovado de trabalho: períodos escondidos podem estar dentro desse intervalo. Não deve ser usada como produtividade individual.

A carga de documento e a mudança de identidade delimitam os segmentos de uso. O contador de erros é relativo ao segmento. Uma atividade anônima pode chegar depois do login e continuar anônima; um lote identificado nunca é atribuído a outra conta no reenvio.

O transporte de produção guarda lotes em chaves independentes no armazenamento local e remove após confirmação. Um ID de lote permite repetir entrega sem somar eventos duas vezes. A fila é limitada a 30 lotes e 24 horas; saída/troca de conta descarta lotes identificados incompatíveis. Isso é telemetria agregada, separada das filas de alterações dos atlas. Não altera a decisão de descartar alterações pendentes quando a pessoa confirma a saída.

CLS usa a maior janela de deslocamentos; INP agrupa entradas por interação e trata extremos. Quando o navegador não oferece a contagem nativa de interações, usa a contagem observada, que é uma estimativa. LCP aceita candidatos posteriores até interação/ocultação e o banco impede que lote atrasado sobrescreva vitais mais recentes. O histórico anterior não é recalculável a partir dos valores já agregados.

Distância, área e ângulo são separados. A importação pela página de atlas também conta. Bases, camadas e modelos 3D são observados por IDs presentes no catálogo atual; não há coleta de nomes de pessoas, geometrias, texto dos atlas ou replay. Base utilizada inclui carregamento do mapa, não apenas escolha deliberada. O ranking agrupa categorias e calcula a fatia pelo total de cada categoria, incluindo alvos fora dos vinte primeiros.

## Operação e limites

Após a consolidação solicitada antes da primeira implantação, as tabelas de monitoramento nascem em [011_uso_e_presenca.sql](../../backend/src/database/migrations/011_uso_e_presenca.sql), com o catálogo completo. O procedimento de instalação aplica as [bases por domínio](../../backend/src/database/migrations/README.md) em banco novo. Históricos anteriores de desenvolvimento são recusados, sem apagar ou recriar seus dados.

Presença e uso têm limitadores independentes. Os limites padrão são 600 requisições por minuto por endereço, ajustáveis pelas variáveis de ambiente específicas de uso e presença para instalações com NAT compartilhado. A perda de coleta não é prova de ausência de usuários.

A [sonda de disponibilidade](../../backend/scripts/sonda-disponibilidade.js) deve rodar em outro processo, preferencialmente outra máquina da rede interna:

```powershell
node backend/scripts/sonda-disponibilidade.js --url http://DOMINIO-INTERNO --arquivo C:\Monitoramento\ebgeo.jsonl
```

Ela verifica a resposta de saúde e o banco indiretamente, a cada 30 segundos, com prazo de cinco segundos. Grava arquivos diários com retenção de 30 dias no diretório indicado. A opção --once faz uma medição e termina, com código 0 para resposta saudável e 2 para indisponibilidade. Não precisa de credencial e não envia e-mail. O arquivo da sonda é a testemunha externa, separado do banco e dos logs do processo observado; não alimenta automaticamente o painel. A instalação e o agendamento dentro da rede dependem de executar esse comando na infraestrutura interna, à qual esta sessão não tem acesso.

## Evidências

Os testes de integração de [presença e inventário](../../backend/tests/integration/monitoramento-presenca.test.js) cobrem identidade, logout, expiração, acesso administrativo, propriedade de atlas, último login, deduplicação, denominadores e lote fora de ordem. As [regressões do cliente](../../frontend/tests/unit/monitoramento-regressoes.test.js) cobrem atualização sem gestos, vitais, fila e leitura de pendências travada.

Capturas produzidas e inspecionadas com Playwright sobre app e backend reais: [Usuários](monitoramento-usuarios.png), [Uso](monitoramento-uso.png), [preparação e sincronização](monitoramento-operacao.png) e [recuperação local](monitoramento-falha-migracao.png). Os dois cenários passaram: presença com duas abas anônimas e login/logout de outra conta; estado local de transição inválido que abre recuperação e envia o relato de erro antes da abertura do aplicativo. A bancada usou banco e perfis descartáveis, sem acessar os dados de produção. O teste temporário de captura foi removido depois da inspeção.

Um controle negativo recolocou temporariamente a guarda que recusava lotes vazios: a regressão de erro e LCP tardios falhou como esperado. Restaurada a correção, os quatro testes de regressão passaram. O relatório de revisão anterior conserva os achados observados antes desta implementação; o script de reproduções foi atualizado para verificar os resultados corrigidos.

Validação da implementação, anterior à consolidação das bases:

- Build de produção e lint da raiz: aprovados. O build mantém avisos de tamanho de chunks.
- Frontend: 624 arquivos, 12.141 testes aprovados. Uma execução concorrente com o lint excedeu o prazo de cinco segundos em dois censos; a execução sem essa concorrência passou, sem ampliar os prazos.
- Backend completo: 5.015 de 5.016 testes aprovados, sem cancelamentos ou testes ignorados. A única falha foi a contraprova preexistente de colisão em configurações: iniciar transações juntas não garantia leituras anteriores às escritas. Foi acrescentada uma barreira entre leitura e escrita somente nessa contraprova, usando o helper existente. Os quatro testes desse arquivo passaram na execução dirigida após a correção. A rodada completa terminou com código 1 e não foi repetida depois desse ajuste de teste.
- Cobertura do backend nessa rodada: 98,28% de linhas, 90,30% de ramos e 96,55% de funções, acima dos pisos exigidos.
- Integração cliente/servidor: 57 arquivos, 201 testes aprovados sobre backend real e banco descartável separado.
- Navegador: dois cenários Playwright aprovados e capturas inspecionadas.
- Reproduções dirigidas de sessão silenciosa, CLS, INP e denominador: aprovadas. Verificação de diferenças sem erros de whitespace.

As classificações de arquitetura foram atualizadas para as duas novas rotas, os dois aceites sem corpo, a validação interna de IDs de catálogo, o ranking administrativo e a substituição específica do CHECK de eventos. Os controles negativos desses censos permanecem ativos. A correção da contraprova de concorrência não altera o serviço de configurações.
