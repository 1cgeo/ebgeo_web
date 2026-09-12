# Revisão de logs, monitoramento e uso, 12/09/2026

Registro dos achados anteriores às correções. Para o comportamento atual e suas evidências, consulte a [implementação de monitoramento](2026-09-12-implementacao-monitoramento.md).

Branch analisado: `integracao_backend`, commit `8a561befd5f1a572e4babb0ba61af30de0c3faff`.

Revisão do código de coleta, transporte, persistência, consultas e apresentação administrativa, com reproduções isoladas e testes locais. A instalação de produção na rede interna não foi consultada. Não foram alterados os módulos da aplicação. A interface foi examinada pelo código; esta revisão não inclui uma nova validação visual no navegador.

## Conclusão

O administrador tem uma base útil para investigar falhas, lentidão e atividade no servidor. A visão de uso é parcial e alguns indicadores podem induzir conclusões incorretas. Preferências são inferidas apenas dos poucos eventos instrumentados. A operação local e os problemas de sincronização ainda não têm uma visão administrativa suficiente para acompanhar a migração com segurança.

## O que já existe

| Pergunta do administrador | Cobertura atual | Limite relevante |
| --- | --- | --- |
| Quais problemas aconteceram? | Diagnóstico com resumo, defeitos agrupados, ocorrências, regressões, estado e detalhes para investigação | Só problemas capturados e entregues; falha na preparação dos dados locais escapa da instalação inicial |
| Onde está lento? | Latência por rota, percentis, comparação de períodos, consultas lentas e medidas do navegador | INP/CLS têm desvios de definição; amostras do navegador podem ficar desatualizadas |
| Como está o servidor? | Amostras de processo, banco e disco, logs e consulta por CLI ou administração | Consulta sob demanda; processo parado não consegue medir a própria queda |
| Há uso sem login? | Rotas de ingestão aceitam anônimos; painel inclui sessões anônimas e eventos | Não identifica pessoas anônimas únicas nem fornece presença online; sessão pode conservar uma identificação anterior |
| Quantas pessoas usam? | Contas, entradas, pessoas que editaram no servidor, sessões e usuários identificados distintos | Contas ativas não significa pessoas online; usuários anônimos não entram como pessoas distintas |
| O que produzem? | Operações no servidor, entidades, atlas e ranking de atlas | Não conta o conteúdo produzido exclusivamente no computador |
| Quais ferramentas usam mais? | Ranking de acionamentos, aberturas de visualizadores, medições, importações e exportações instrumentadas | Abertura não comprova conclusão ou tempo de uso; ranking mistura categorias |
| Quais são as preferências? | Alguns tipos de ferramenta, natureza do atlas e modalidade de PDF | Sem visão de preferências individuais, bases de mapa, camadas ou recursos específicos mais consultados |
| As pessoas voltam? | Funil de contas novas e coortes baseadas em login | Não mede retorno de visitantes anônimos ou uso exclusivamente local |

Referências principais: `frontend/src/js/admin/diag-tab.js`, `frontend/src/js/admin/uso-tab.js`, `backend/src/modules/diag/resumo.service.js`, `backend/src/modules/uso/uso.service.js`.

Há boas proteções existentes: consultas administrativas exigem administrador; identidade vem da credencial verificada, não de um `userId` enviado no corpo; eventos e propriedades passam por validação; logs possuem tratamento de segredos e URLs; relatos de erro têm fila limitada; o resumo declara fontes indisponíveis e listas parciais. Sessões individuais são podadas conforme a retenção configurada, enquanto agregados sobrevivem. A interface também distingue medidas calculadas sobre sessões das aproximações históricas sobre dias. Essas proteções não significam cobertura completa de falhas ou uma auditoria exaustiva de confidencialidade.

## Achados e prioridades

### 1. Alta, falha na atualização local pode ficar invisível

`index.js:106` e `projects/projects-page.js:1033` executam `runLegacyUpgradeGate()` antes de instalar telemetria de erro e uso. Em `ui/migration-recovery.js:127`, a falha é capturada, escrita no console e mostrada na recuperação; o retorno interrompe o boot. Portanto, esse usuário pode ficar impedido de entrar sem aparecer pelos canais normais de erro e uso daquela carga.

**Correção indicada:** cobertura mínima desde o início da preparação, independente da abertura dos stores; relatar início, conclusão, interrupção e motivo em formato controlado. Não inicializar mecanismos que possam alterar os dados legados antes de protegê-los. Validar falha de armazenamento, outra aba antiga aberta e recuperação concluída. Prioridade anterior à migração de produção.

### 2. Alta, sessões deixam de atualizar sem novos eventos de uso

`session/uso-lote.js:435` recusa a descarga quando não há contagens. A segunda guarda em `:454` também recusa lote sem eventos. Isso impede atualizar `ultimoSinal`, erros e vitais mesmo que o temporizador ou a saída da página chame a descarga. A API já aceita eventos vazios, comprovado pelo teste de rota.

**Reprodução:** página registra uma visita e descarrega aos 30 segundos. Aos 630 segundos, ocorre um erro e o LCP observado passa de 150 para 4.000 ms. Nova descarga não envia nada: duração informada permanece 30 segundos, erros permanecem zero e LCP permanece 150 ms.

O erro pode chegar pelo canal separado de relatos. A falha demonstrada é a desatualização dos indicadores de sessão, inclusive os usados para saúde de releases (`uso.service.js:503`).

**Correção indicada:** permitir atualizações de sessão sem inventar novos acionamentos; definir se duração significa permanência da aba ou tempo ativo/visível. Atualizar no momento apropriado de mudança de visibilidade e encerramento. Cobrir sessão sem novos gestos, erro tardio e vital tardio.

### 3. Alta para acompanhar a migração, falta visão de pendências e descartes

O catálogo de uso (`session/eventos-de-uso.js:49`) não contém resultados da migração, tamanho/idade da fila de sincronização, sucesso/falha de drenagem, nem saída confirmada com descarte de pendências. Logs de erros e requisições podem ajudar em casos isolados, mas não respondem quantos clientes estão com trabalho pendente ou quantos descartes foram explicitamente aceitos.

**Melhoria indicada:** um resumo operacional com sessões afetadas, quantidade e idade das pendências, sincronizações concluídas/falhas e descartes confirmados. Coletar contagens e códigos de motivo; o conteúdo dos atlas não é necessário. A escolha já feita pelo usuário, confirmar saída com pendências e aceitar seu descarte, permanece válida.

### 4. Média, sessão atravessa navegação e pode misturar identidade e release

`session/sessao-id.js:104` reutiliza o identificador em `sessionStorage`; a reprodução confirma o mesmo ID após reinstalação do módulo em uma navegação. No `UPSERT_SESSAO` (`uso.queries.js:500`), um lote anônimo conserva o `user_id` anterior (`:512`), outro usuário autenticado pode substituí-lo e a primeira release permanece (`:513`). Não há reset desse identificador nos caminhos de logout encontrados na busca por sua chave.

Consequência: uma mesma aba usada antes/depois de login ou logout não fornece segmentos independentes de uso anônimo e autenticado. A classificação não equivale a “estava deslogado neste período”. Após atualização na mesma aba, sinais também podem continuar associados à release anterior.

**Correção indicada:** separar a identidade de correlação da aba de um segmento de uso delimitado por carga/release e mudança de identidade. Definir claramente o denominador da métrica; não gerar novo ID a cada lote.

### 5. Média, INP e CLS publicados não seguem integralmente o padrão

`session/vitais.js:157` usa a maior duração de entrada de evento como INP, sem a agregação completa por interação e o tratamento dos extremos. Em `:170`, CLS soma deslocamentos durante toda a página, sem janelas de sessão.

**Reproduções:** duas janelas distantes com deslocamento 0,1 cada produzem CLS 0,2, quando a maior janela seria 0,1. Cinquenta interações, uma de 1.000 ms e 49 de 100 ms, produzem INP 1.000 ms; o descarte previsto para esse conjunto resulta em 100 ms. São entradas sintéticas entregues ao coletor real, não uma medição de desempenho do EBGeo.

Além disso, `uso.queries.js:515` conserva o primeiro LCP não nulo recebido. Um candidato posterior de LCP não substitui esse número, mesmo quando outro lote chega.

**Correção indicada:** adotar a definição completa, inclusive o fechamento da medição de LCP, ou renomear explicitamente os indicadores aproximados e seus limiares. Referências primárias: [definição de INP](https://web.dev/articles/inp) e [janelas de CLS](https://web.dev/blog/evolving-cls).

### 6. Média, preferências e medições têm cobertura insuficiente

Distância, área e ângulo registram exatamente `MEDICAO_ABERTA`, sem propriedade (`measurement_tool/measurement-distance.control.js:95`, `measurement-area.control.js:98`, `measurement-angle.control.js:94`). O catálogo proíbe qualificadores para esse evento. Hoje não é possível responder qual dessas três medições é mais utilizada.

Os eventos também não distinguem bases de mapa, camadas ou recursos específicos vistos em 3D/360. O ranking informa gestos, não satisfação ou preferência declarada. A tabela `uso_eventos_dia` agrega por dia, página, evento e propriedade, sem usuário: isso é uma decisão explícita de não criar perfil individual.

**Melhoria indicada:** começar por qualificadores fechados de medição e preferências agregadas relevantes ao produto; separar acionamento, sucesso e falha onde isso muda a interpretação. Há uma lacuna concreta adicional: importar `.ebgeo` pela página de atlas passa por `projects-page.js:744` e `projects/import-ebgeo.service.js:57`, sem o registro encontrado na importação do mapa (`import_export/export-import.service.js:758`). O contador atual não representa todas as importações.

### 7. Média, “Mais usados” exige um denominador mais claro

`uso.queries.js:740` retorna os vinte maiores pares evento/propriedade de todas as categorias. `admin/uso-phrases.js:2126` calcula a fatia pela soma recebida. A lista pode misturar visitas de página, atlas abertos, ferramentas e exportações; ações fora dos vinte primeiros não entram nesse denominador.

**Reprodução:** 900 visitas de página e 100 acionamentos de ponto mostram ponto com 10,0%. Isso não significa que 10% dos usuários preferem ponto, nem 10% dos acionamentos de ferramentas.

**Melhoria indicada:** separar categorias e declarar a base da porcentagem. Para participação entre todas as ferramentas, calcular o total dessa categoria antes do limite de resultados. O aviso já existente de “acionamentos, não tempo” deve ser mantido.

### 8. Limites operacionais conhecidos, perdas de coleta e ausência de vigilância externa

Os contadores de uso ficam em memória e usam `sendBeacon`/`fetch` (`session/uso-lote.js:344`). Aceitação do beacon pelo navegador não confirma persistência no servidor. Sem uma fila durável de uso, queda de rede seguida de fechamento pode perder contagens. A fila de relatos de erro é outro mecanismo; sua existência não torna os contadores de uso duráveis. Não há no painel uma estimativa consolidada da perda da coleta.

A tela de indisponibilidade contabilizada não mede percentual de disponibilidade do serviço. Uma queda completa precisa de observação externa. A configuração de logs tem retenção padrão de 30 dias (`backend/src/config.js:178`), e o resumo HTTP de diagnóstico tem janela máxima de sete dias. Retenção e janela de consulta são coisas diferentes.

**Decisões preservadas:** a documentação registra recusa de digest por e-mail, replay, perfil individual e plataformas adicionais; sonda externa foi adiada. Esta revisão não propõe reintroduzir o que foi recusado. Uma sonda simples dentro da rede, quando houver local definido para executá-la, continua sendo uma melhoria independente do painel (`docs/wiki/observabilidade.md:398`).

## Sequência recomendada

1. Cobrir a preparação/migração local e a saúde da sincronização; validar que o administrador enxerga um cliente bloqueado e um descarte confirmado.
2. Corrigir atualizações de sessão e delimitação de identidade/release, com definição explícita de duração.
3. Ajustar INP/CLS/LCP e denominadores do ranking antes de usar esses números para decisões de desempenho ou produto.
4. Completar medições e importações; acrescentar preferências agregadas escolhidas pela utilidade para o produto.
5. Expor limites de coleta no painel e, quando definida a instalação, acrescentar observação externa da disponibilidade.

## Validação realizada nesta revisão

- `node docs/reviews/monitoramento-probes-2026-09-12.mjs`: reproduções de sessão silenciosa, CLS, INP, persistência de ID e porcentagem do ranking passaram. As asserções documentam o comportamento problemático atual; não significam que ele esteja correto.
- `npm test -- tests/integration/uso-eventos-persistencia.test.js`: 13 testes passaram.
- `npm test -- tests/integration/uso-eventos-rota.test.js`: 15 testes passaram, incluindo anonimato, identidade verificada e lote vazio aceito.
- `npm test -- tests/integration/uso-resumo-blocos.test.js`: 10 testes passaram, incluindo agregação e controle administrativo.
- `npm test -- tests/integration/diag-rota-de-resumo.test.js`: 14 testes passaram, incluindo acesso administrativo, janela, comparação e banco indisponível.
- `npm run lint` no backend: passou.
- CLI local `diag -- resumo --json`: retornou dados de arquivo e declarou fonte de banco indisponível. Isso valida a apresentação de resultado parcial nesse ambiente, sem dizer nada sobre a saúde da produção.

Total desta rodada: 52 testes de integração aprovados, além das reproduções dirigidas. Não foi executada novamente a suíte completa. Os testes existentes confirmam vários contratos atuais, inclusive conservar o primeiro LCP, e por isso podem passar apesar dos desvios de interpretação encontrados.
