# Observabilidade: como se olha para o EBGeo rodando

Escrita em 2026-08-30, depois de um incidente que não deixou evidência nenhuma: o push de sync respondia 400 em laço, o dono colou dezenove linhas do console do navegador, e quando fomos procurar a mensagem do servidor ela não existia mais em lugar nenhum. O defeito foi encontrado por leitura de código, não por telemetria, e isso é sorte, não método.

O contexto que decide o desenho é a equipe: **um desenvolvedor**, rede **fechada** (nada de SaaS), e **boa parte da operação feita por um agente**. Esse último ponto é o menos óbvio e o mais determinante: um agente lê muito bem um `.jsonl`, uma tabela e a saída de um comando, e lê muito mal um painel. Por isso a resposta aqui não é subir um stack de observabilidade, e sim **deixar rastro em formato consultável e entregar quem consulta**.

## As duas camadas, e por que não é uma só

| | onde | responde |
|---|---|---|
| firehose | `<LOG_DIR>/ebgeo-AAAA-MM-DD.jsonl` | toda requisição, com `duration`. Investigação profunda. |
| resumo | tabelas no Postgres | erro do backend, erro do navegador, amostra de saúde. É o que a tela mostra. |

A separação não é gosto. Um arquivo JSONL rotativo é sequencial: ótimo para `grep` e para "o que aconteceu às 16h54", péssimo para "os vinte erros mais frequentes da semana passada", que é agrupamento e paginação. O banco é o inverso. E há uma razão de robustez que decide o empate: **quando o Postgres cai, o arquivo é a única testemunha do porquê**, e é exatamente aí que se precisa dela.

## O arquivo

`backend/src/utils/log-diario.js`, ligado em `backend/src/utils/logger.js`. Um arquivo por dia, poda por idade, `LOG_DIR` / `LOG_RETENTION_DAYS` / `LOG_TO_FILE`.

**A rotação é escrita à mão, e a alternativa recusada foi uma dependência** (`pino-roll`, da própria organização do pino). Decisão do dono, com o custo declarado: isto é código de infraestrutura no caminho onde a falha silenciosa apaga justamente o que se quer ler. O preço foi pago em desenho: o módulo é puro onde dá, recebe relógio e `fs` por injeção, e nunca engole erro sem falar. As três propriedades estão no `fileoverview` dele e cada uma é a lápide de um jeito ingênuo de escrever isso.

**O arquivo vale em desenvolvimento também**, e essa é a parte que se lê como descuido. Não é: o incidente que motivou tudo aconteceu em DEV, e a mensagem do servidor morreu junto com a rolagem de um terminal. Em teste ele fica desligado (e ali o nível já é `silent`).

**O volume do compose é o ponto todo, não um detalhe.** Sem `ebgeo_logs:/app/data/logs` o `.jsonl` vive na camada de escrita do container e some no `up` seguinte, ou seja, some no deploy, que é precisamente quando se quer comparar o antes e o depois.

## `req.id`: a costura que faltava

Uma requisição que falha produz **duas** linhas: a do `errorHandler` (com o objeto de erro e a pilha) e a do `request-logger` (com `statusCode` e `duration`). Até 2026-08-30 nada as ligava, e a consequência foi **medida contra o backend real**: o primeiro relatório dizia "4 ocorrências" para 2 erros, em 4 assinaturas, porque as duas linhas da mesma requisição não têm o mesmo formato e caíam em grupos diferentes.

`req.id` nasce em `request-logger.js` e é ecoado pelo `errorHandler`. A fusão é `fundirPorRequisicao` (`backend/src/utils/diag-consulta.js`), e a regra dela é **estrutural, não textual**: para um mesmo `reqId` fica o registro que carrega `err`, e o `statusCode` do outro é copiado para dentro dele. Perguntar por `msg === 'request error'` seria uma linha mais curta e a mesma classe de acoplamento frágil que já custou caro nesta casa: renomear a mensagem deixaria o relatório calado e correto na aparência.

Existe um vão declarado: falha ANTERIOR ao logger de requisição (corpo malformado, que morre no parser de JSON montado acima dele) não tem `req.id` nem linha de requisição. Ela aparece sozinha no relatório, que é o comportamento certo para uma requisição que nunca chegou a ser processada.

## O comando

`npm run diag -- erros | lento | status | linhas`, com `--desde 24h`. Agregação em `backend/src/utils/diag-consulta.js` (pura e testada), leitura e formatação em `backend/scripts/diag.js`.

Três decisões que não se adivinham lendo:

- **O agrupamento é por ASSINATURA, não por linha**, com a rota normalizada (`/atlas/:id/sync`). Sem normalizar, cada atlas é uma assinatura e o relatório volta a ser a rolagem que ele existe para substituir. Mil ocorrências do mesmo defeito são uma linha com contagem mil, senão o defeito raro (que costuma ser o grave) fica soterrado pelo barulhento.
- **`parseJanela` devolve `null` no que não entende**, em vez de cair num default. Um comando que aceita `--desde 24hs` calado e mostra a última hora responde a outra pergunta sem avisar, e quem lê a saída acha que viu as 24 horas.
- **O `config.js` é importado tarde e só quando falta `--dir`.** Ele exige `DATABASE_URL` e `JWT_SECRET` na avaliação do módulo, e um diagnóstico de log não pode depender de o banco estar configurado: a hora em que se lê log é justamente a hora em que alguma coisa não está.

`ehErro` tem dois termos, e o segundo é o que se esquece: `level >= 50` pega o que foi logado como erro, mas o `errorHandler` desta casa loga 4xx em `warn` de propósito. Sem o segundo termo, todo 400, 401, 403 e 404 sumiria do relatório, **inclusive o 400 em laço que motivou a ferramenta**.

## O que ainda não existe

O plano tem quatro camadas e esta página cobre a primeira. Faltam: a amostra de saúde e latência guardada no banco, a captura de erro do NAVEGADOR (que hoje não é registrado em lugar nenhum, e era metade da evidência do incidente), a aba Diagnóstico do painel de administração e o relatório de uso sobre `audit_trail`. Enquanto elas não existirem, **a única forma de consultar é o comando**, e vale dizer isso em voz alta em vez de deixar a página sugerir uma tela que não está lá.

Ver [[deploy-backend]], [[syncledger]] (a camada de tracing test/dev, que é outra coisa e não sobe para produção por gate de ambiente) e [[erros-api]].
