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

**A rotação é escrita à mão, e a alternativa recusada foi uma dependência** (`pino-roll`, da própria organização do pino). Decisão do dono, com o custo declarado: isto é código de infraestrutura no caminho onde a falha silenciosa apaga justamente o que se quer ler. O preço foi pago em desenho: o módulo é puro onde dá, recebe relógio e `fs` por injeção, e nunca engole erro sem falar. As propriedades dele estão no `fileoverview`, e cada uma é a lápide de um jeito ingênuo de escrever isso. Elas eram três e passaram a ser quatro em 2026-09-01, quando o fechamento do arquivo ganhou prazo; a contagem saiu daqui de propósito, porque número em prosa envelhece calado e o `fileoverview` é a fonte.

**O arquivo vale em desenvolvimento também**, e essa é a parte que se lê como descuido. Não é: o incidente que motivou tudo aconteceu em DEV, e a mensagem do servidor morreu junto com a rolagem de um terminal. Em teste ele fica desligado (e ali o nível já é `silent`).

**O arquivo é DESCARREGADO na saída, e isso não era verdade até 2026-09-01.** `process.exit` com fila pendente no fluxo descarta o que ainda não foi para o disco, e o que fica pendente no fim é justamente o registro do desligamento. Hoje `descarregarLog` espera o fluxo terminar, sob prazo, e o log é o ÚLTIMO a fechar na sequência de desligamento, porque tudo o que os outros disserem ao morrer ainda precisa caber no arquivo. Duas coisas medidas e declaradas: o `multistream` do pino **não tem `flush`**, e o `flushSync` dele só alcança destino que tenha um, o que nenhum dos três nossos tem, então quem descarrega de fato é o nosso fechamento; e o **stdout fica de fora**, sem descarga síncrona exposta, de modo que num cano a última linha do terminal ainda pode ser truncada. O arquivo é o destino que esta camada existe para salvar.

**O volume do compose é o ponto todo, não um detalhe.** Sem `ebgeo_logs:/app/data/logs` o `.jsonl` vive na camada de escrita do container e some no `up` seguinte, ou seja, some no deploy, que é precisamente quando se quer comparar o antes e o depois.

## O que NÃO entra numa linha de log

São DOIS mecanismos independentes, e nenhum cobre o alcance do outro. `redactUrl` (`backend/src/utils/redact-url.js`) reescreve a URL da requisição antes do log, e é ele que impede a chave de API vinda da query string de virar registro permanente. `elidirSql` (`backend/src/utils/elidir-sql.js`) troca por marcador todo literal e todo número dentro de um TEXTO DE SQL, e existe por uma razão que só se descobre lendo o driver: pgFormatting fica no default `false`, então o pg-promise interpola os valores no texto ANTES de emitir o evento e antes de mandar ao servidor. O texto que chega ao log, portanto, não tem placeholder nenhum: tem a chave de API, o hash de refresh token ou o hash de senha por extenso. Ligar pgFormatting não é a saída, e não é questão de gosto: o código depende do motor de formatação (parâmetro nomeado, modificador de lista, os construtores de coluna), e com a bandeira ligada o valor apenas muda de campo.

A segunda porta do mesmo vazamento é o objeto de erro. O driver pendura o texto da query, os parâmetros e os campos de detalhe no erro, e o DETALHE de uma violação de CHECK é a linha inteira que falhou, com o que ela tiver dentro (em `users`, o hash de senha). Por isso a elisão roda também no serializer de erro de `backend/src/utils/logger.js`, e não só no hook do banco: são caminhos distintos até o mesmo arquivo, e fechar um deixa o outro aberto. É assim que se sabe que são dois, e não um: revertida uma das duas correções, o conjunto de testes que fica vermelho é DIFERENTE.

O guarda anterior media uma forma que o driver nunca produz, e por isso era verde por construção. O de hoje provoca um erro REAL contra o banco: `backend/tests/integration/db-erro-real-nao-vaza-credencial.test.js`, com guarda de não-vacuidade exigindo que o erro CRU carregue o segredo antes de exigir que o log não o carregue.

## `req.id`: a costura que faltava

Uma requisição que falha produz **duas** linhas: a do `errorHandler` (com o objeto de erro e a pilha) e a do `request-logger` (com `statusCode` e `duration`). Até 2026-08-30 nada as ligava, e a consequência foi **medida contra o backend real**: o primeiro relatório dizia "4 ocorrências" para 2 erros, em 4 assinaturas, porque as duas linhas da mesma requisição não têm o mesmo formato e caíam em grupos diferentes.

`req.id` nasce em `request-logger.js` e é ecoado pelo `errorHandler`. A fusão é `fundirPorRequisicao` (`backend/src/utils/diag-consulta.js`), e a regra dela é **estrutural, não textual**: para um mesmo `reqId` fica o registro que carrega `err`, e o `statusCode` do outro é copiado para dentro dele. Perguntar por `msg === 'request error'` seria uma linha mais curta e a mesma classe de acoplamento frágil que já custou caro nesta casa: renomear a mensagem deixaria o relatório calado e correto na aparência.

Existe um vão declarado: falha ANTERIOR ao logger de requisição (corpo malformado, que morre no parser de JSON montado acima dele) não tem `req.id` nem linha de requisição. Ela aparece sozinha no relatório, que é o comportamento certo para uma requisição que nunca chegou a ser processada.

## O comando

`npm run diag -- erros | lento | status | linhas | saude`, com `--desde 24h` (e `--intervalo`, que só o `saude` lê). Agregação em `backend/src/utils/diag-consulta.js` (pura e testada), leitura e formatação em `backend/scripts/diag.js`.

As decisões que não se adivinham lendo:

- **O agrupamento é por ASSINATURA, não por linha**, com a rota normalizada (`/atlas/:id/sync`). Sem normalizar, cada atlas é uma assinatura e o relatório volta a ser a rolagem que ele existe para substituir. Mil ocorrências do mesmo defeito são uma linha com contagem mil, senão o defeito raro (que costuma ser o grave) fica soterrado pelo barulhento.
- **`parseJanela` devolve `null` no que não entende**, em vez de cair num default. Um comando que aceita `--desde 24hs` calado e mostra a última hora responde a outra pergunta sem avisar, e quem lê a saída acha que viu as 24 horas.
- **O `config.js` é importado tarde e só quando falta `--dir`.** Ele exige `DATABASE_URL` e `JWT_SECRET` na avaliação do módulo, e um diagnóstico de log não pode depender de o banco estar configurado: a hora em que se lê log é justamente a hora em que alguma coisa não está.
- **O `saude` infere o intervalo da PRÓPRIA série, nunca do `config.js`.** `resumirAmostras` toma a MEDIANA das distâncias entre amostras consecutivas, e a média não serve: medido, um buraco de seis horas vira o intervalo inferido e o relatório passa a dizer que nada faltou. `parseIntervalo` aceita `--intervalo` para sobrepor e recusa o número nu, que seria ambíguo com o valor em milissegundos do ambiente. A origem do intervalo sai declarada na saída, porque a contagem de faltantes é uma conta sobre uma premissa, e premissa invisível não se confere. Duas honestidades ficam presas por controle negativo: ausência devolve nulo e nunca zero, porque "0 faltantes" se lê como "nenhuma queda"; e o trecho da janela ANTERIOR à primeira amostra é desconhecido, não buraco, senão um deploy de dez minutos inventa mil quedas.

`ehErro` tem TRÊS termos, e a contagem já custou caro: `level >= 50` pega o que foi logado como erro, a presença do campo de erro pega o registro que carrega o objeto com tipo e pilha, e `statusCode >= 400` pega o 4xx que o `errorHandler` desta casa loga em `warn` de propósito. Sem o terceiro, todo 400, 401, 403 e 404 sumiria do relatório, **inclusive o 400 em laço que motivou a ferramenta**. Esta linha disse DOIS até 2026-08-31, e a subcontagem não ficou no papel: foi ela que fez o comentário do amostrador de saúde raciocinar sobre um `ehErro` menor que o real e escolher um nível que nenhum dos três termos alcança.

## A amostra de saúde

`backend/src/utils/amostra-de-saude.js`, ligada em `backend/src/index.js` (nunca em `app.js`, que é o que a suíte importa). A cada intervalo ela emite **uma linha no mesmo `.jsonl`**, marcada por um campo `amostra` cujo valor é exportado como símbolo para as duas pontas não divergirem por digitação.

Ela não vai para tabela nenhuma, e isso é decisão: uma série temporal de baixa cardinalidade no arquivo é consultável pelas mesmas ferramentas do resto, e uma tabela a mais seria uma segunda verdade para manter.

**O limite honesto, escrito também no `.env.example`: um amostrador dentro do processo não testemunha a própria morte.** OOM, SIGKILL, event loop travado e máquina reiniciada não produzem amostra dizendo isso, produzem **silêncio**. O recorte ficou MENOR em 2026-09-01, e vale saber qual: exceção e rejeição não tratadas passaram a deixar uma linha `fatal` com o marcador `queda` no mesmo arquivo, por `payloadDeQueda`, então essas duas mortes agora se explicam. O que sobra para o silêncio é a lista acima, e para ela o que revela a queda é o **buraco na série**, então a pergunta certa é "quantas amostras faltaram e quando", nunca "alguma amostra disse que caiu". Pelo mesmo motivo o boot **loga o motivo** quando decide não ligar o amostrador: sem isso, "não há amostra no log" seria indistinguível de "o amostrador quebrou".

**A pergunta que ele existe para responder passou a ter comando em 2026-08-31**: `npm run diag -- saude`, sobre `resumirAmostras`. Enquanto ele não existiu, `MARCADOR_AMOSTRA` era um símbolo exportado para um leitor que nunca nasceu, e a decisão de que o sinal de queda é o buraco na série estava escrita nos dois lugares sem meio de ser exercida. Decisão sem instrumento é indistinguível de decisão esquecida.

**O NÍVEL da linha é contrato com o relatório, e não estilo.** A amostra saudável sai em `info`, porque ela sai a cada intervalo para sempre e promovê-la faria de "está tudo bem" a campeã do relatório agrupado. A de banco fora sai em `error`, e os dois motivos juntos, porque `level >= 50` é o único termo do `ehErro` que uma linha de amostra consegue satisfazer: o texto da falha não mora no campo de erro e não há `statusCode`. Até 2026-08-31 ela saía em `warn`, sob um comentário que afirmava que o relatório contava `warn` como erro, e o efeito medido era exato: o diagnóstico enxergava o amostrador quebrado e não enxergava o Postgres caído. Preso por `backend/tests/unit/amostra-de-saude.test.js`, que importa o `ehErro` real em vez de asserir sobre o número do nível, e que por isso continua valendo se o critério mudar.

Duas finuras que se perdem numa reescrita desatenta: a sonda ao banco distingue **prazo** de **erro** (o Postgres fora e o nosso pool entupido pedem providências opostas), e o prazo dela é MAIOR que o do `GET /api/v1/health` de propósito, porque aquele responde a um orquestrador (para quem resposta atrasada já não serve) e esta escreve história (onde distinguir "lento" de "morto" é o registro).

## O erro do navegador

É a metade que faltava no incidente: o que o dono colou veio do console e ninguém registrava. Ele chega por `POST /api/v1/diag/erro-cliente` e vira linha em `client_errors` (migração `backend/src/database/migrations/014_observabilidade.sql`).

**A rota aceita ANÔNIMO, e tem de aceitar**: o app roda deslogado, e é justamente aí que ninguém vê o erro. Ela tem limitador próprio por endereço, teto de tamanho em todo campo, e o `user_id` sai do token, nunca do corpo.

**A escrita é UPSERT por assinatura, incrementando um contador.** Não é otimização: o incidente que originou tudo isto foram dezenove erros idênticos em segundos, e uma inserção por ocorrência transformaria um defeito do cliente num ataque ao banco. Pela mesma razão o cliente deduplica antes de enviar (mesma assinatura uma vez por sessão, teto global e intervalo mínimo).

Quatro coisas que não se adivinham lendo o código:

- **A assinatura é montada no CLIENTE, e a mensagem ENVIADA é a normalizada, não a crua.** Mandar as duas faria o agrupamento do servidor deixar de casar com o do cliente sem ninguém ver. A normalização troca hash de build, UUID e o `?t=` do HMR por marcador; sem isso cada carga da página vira um grupo novo e o agrupamento não agrupa nada. A coluna do quadro de pilha fica de fora, porque muda a cada reformatação do minificador.
- **`assinatura` tem teto de 300 porque é chave única em btree**, que recusa valor acima de ~2.700 bytes. Sem o teto, o modo de falha seria um 500 no caminho que existe para registrar falhas.
- **`atlasId` só viaja se for UUID.** Um atlas LOCAL é chaveado por nome, e mandá-lo derrubaria o envio inteiro por causa do campo mais dispensável dele.
- **`user_id` é `ON DELETE SET NULL`**, divergindo do "FK sem `ON DELETE`" que a casa usa em toda parte: telemetria não pode fazer a exclusão de uma conta falhar.
- **A tabela TEM prazo de validade desde 2026-09-01**, e antes não tinha: nenhum `DELETE` existia no pacote inteiro, e a rota que a alimenta aceita anônimo. A poda usa a MESMA idade do arquivo de log (`LOG_RETENTION_DAYS`), porque telemetria de defeito envelhece junto com o log do servidor que a explica, e roda de forma OPORTUNISTA na própria escrita (`talvezPodar`), no máximo uma vez por hora, sem agendador e sem timer: se ninguém escreve, nada cresce, logo nada precisa ser podado. O critério é `ultima_em` e não `primeira_em`, porque uma assinatura vista pela primeira vez há um ano e ainda ocorrendo hoje é o dado mais valioso da tabela. O ponto cego da escolha, declarado: uma tabela que para de receber escrita guarda para sempre as últimas linhas vencidas, ou seja, a poda limita CRESCIMENTO e não IDADE.

Limitação conhecida: o campo `release` carrega hoje a versão do `package.json`, que é constante entre builds e **não distingue deploys**. Enquanto for assim, ele não serve para dizer "isto foi corrigido na versão seguinte".

## A tela

Aba **Diagnóstico** em `admin.html`, só para o administrador. Ela consome quatro rotas, todas com gate de administração e janela com teto de 7 dias (ler trinta arquivos numa requisição HTTP seria derrubar o servidor pela porta do diagnóstico).

**O campo que decide a honestidade da tela é `diretorioAusente`.** As rotas que leem log respondem **200 com lista vazia** quando não há diretório, e sem tratar isso a aba desenharia a boa notícia verde ("nenhum erro nas últimas 24 horas") a partir de um **instrumento desligado**, que é cobertura vazia passando verde na forma de interface. O estado de leitor cego vem ANTES do ramo de vazio. Na mesma linha estão `truncado` (a janela perdeu os registros mais antigos) e as contagens antes do corte, sem as quais "20 assinaturas" é indistinguível de "20 de 400".

**A regra valia para DUAS das três seções de log até 2026-08-31.** O Pulso não consultava `leitorCego` nem as notas de leitura, embora os dois campos viessem no payload dele: com o log desligado ele desenhava "nenhuma requisição registrada" ao lado de duas seções dizendo que o leitor estava cego, e sob truncamento mostrava o total DEPOIS do corte como se fosse o do período, sendo ele o único número da aba que sofre o corte. A latência tinha a nota só no ramo da tabela, então o vazio dela saía sem dizer o que foi varrido. Quem sustenta a frase agora é `frontend/tests/unit/diagnostico-secoes-de-log.test.js`, e a forma dele é o ponto: ele DERIVA a lista de seções do próprio código (seção nova nasce cobrada), exige que quem não lê log se declare fora com o motivo escrito, e conta os desfechos informativos de cada seção contra as chamadas de nota. A primeira versão dele cobrava só presença de chamada e ficou VERDE sobre a latência muda, que é o guarda afirmando o contrário do que a tela faz.

**Um número da tela parece contradizer o outro, e não contradiz:** o `erros` de `/diag/status` conta REGISTROS (uma requisição falha produz duas linhas de log), enquanto `/diag/erros` conta defeitos distintos, porque funde por `reqId` antes de agrupar. É a mesma conta que o CLI faz, mantida igual de propósito.

O resto do desenho é da tela e está nos `fileoverview` dos dois arquivos dela: o peso visual é escada logarítmica, porque mil e um não podem ter o mesmo tamanho, o p95 é a coluna com peso (é ele que corresponde a "está lento", não a média), e o vazio NOMEIA a janela, senão afirmaria sobre a história inteira do sistema.

## O uso

Aba **Uso** em `admin.html`, só para o administrador, sobre `GET /api/v1/uso/resumo`. Não é instrumentação nova: é consulta sobre `audit_trail`, `operations`, `users` e `atlas`, que já registravam tudo isto.

**O campo que decide a honestidade deste relatório é o `horizonte`, e ele são DUAS fontes que limitam metades diferentes.** `operations` é uma tabela PODÁVEL (a rota de limpeza é de administrador), então um relatório de 90 dias pode estar medindo 20 sem avisar; `audit_trail` não é podada. A distinção importa porque nem tudo depende das duas: `operacoesDesde` alcança a produção inteira, o ranking, "Produziram" e "Com edição"; `trilhaDesde` alcança **só** "Entraram" (que vem do `LOGIN`); e **três números não têm horizonte nenhum** (contas novas, atlas criados e excluídos saem de `users` e `atlas` por data própria). Reuni-los sob um aviso só faria a tela desconfiar de contagens íntegras.

Três armadilhas que o código não conta sozinho:

- **`null` no horizonte NÃO é "está coberto".** Tabela vazia hoje não prova que sempre esteve vazia, e `desde < null` é `false` em JavaScript, então a leitura ingênua produz silêncio exatamente no caso sem evidência. São quatro estados, não dois: cobre, encurtado, vazio, e "o servidor não informou" (versão anterior).
- **O aviso não afirma CAUSA.** Instalação jovem e histórico apagado são indistinguíveis daqui, e dizer "foi podado" inventaria fato. Ele também é desenhado FORA do corpo da tela, para sobreviver ao estado vazio, que é justamente quando um histórico apagado por inteiro cai.
- **`entraram` é um PISO, não um exato:** o `LOGIN` é auditado em best-effort, então uma falha de escrita da trilha some da conta.

**O regime de cada métrica é campo, não frase** (`regime: HOJE|PERIODO` em `uso-phrases.js`): contas ativas e atlas vivos são de HOJE, o resto é do período. Escrever isso à mão em oito ladrilhos é a forma de errar um sem nada ficar vermelho, e rotular um estoque acumulado como se fosse do período infla o número sem parecer defeito.

Sobre o CUSTO: as consultas do resumo perguntam pelo período SEM atlas, e o índice que existia (`idx_operations_atlas_created`) é composto com `atlas_id` na frente, então não guiava nenhuma delas. Quatro caíam em varredura sequencial na tabela que mais cresce do sistema; `backend/src/database/migrations/015_uso_indice_operations.sql` fecha as quatro, e o cabeçalho dele carrega as medições e o custo do lock.

## O que o servidor registra, e o que ele registrava até 2026-09-01

Quatro caminhos passaram a falar no mesmo dia, e a razão de estarem juntos aqui é que os quatro eram o mesmo defeito: o produto sabia de um fato e não o escrevia em lugar nenhum.

- **A recusa POR OPERAÇÃO do sync** (`refusedOpsLogPayload`, `backend/src/modules/sync/sync.service.js`) é o único caminho em que o produto descarta trabalho de propósito, responde 200 e não deixava rastro. A linha é UMA por lote, agregada por motivo e por alvo, com contagem, sem payload. Ela sai em `warn` **sem `err` e sem `statusCode`**, ou seja de propósito FORA do `diag -- erros`: recusar escrita em mapa travado é o produto funcionando, e despejar isso no relatório de erros soterraria o 500 raro sob o comportamento correto frequente. Lê-se com `diag -- linhas --filtro`, e é por isso que a mensagem dela é um símbolo exportado e escrita sem acento.
- **O endereço do cliente** entra em toda linha de requisição (`clientAddress`, `backend/src/middleware/request-logger.js`). Ele é o único lugar onde a pergunta "quem está tentando entrar" tem resposta, porque a ação LOGIN_FAILED não existe: ela é uma IMPOSSIBILIDADE de esquema, declarada na própria baseline de auditoria, já que o ator é NOT NULL e numa tentativa falha não há ator. A contra-intuição que decide como se lê: quem revela uma varredura de muitas contas NÃO é o 429, porque a chave daquele limitador inclui o usuário e mil contas tentadas uma vez cada são mil baldes com um acerto; quem revela é o 401 repetido sob o mesmo endereço.
- **A recusa do limitador** (`limiterDenialPayload`, `backend/src/middleware/rate-limit.js`) fala UMA vez por janela, e não por recusa, senão o limitador viraria o amplificador da rajada dentro do disco. A agregação é DERIVADA do contador que o próprio limitador já mantém, nunca guardada num mapa, que trocaria a rajada no disco por uma no heap.
- **O handler de erro do 360** (`sv360ErrorLogPayload`) era mudo, e um erro daquele módulo saía sem mensagem e sem pilha, colapsando numa assinatura genérica. Ele agora loga na MESMA gramática do handler global (mesmo `reqId`, mesma URL redigida), porque divergir ali produziria assinatura própria e quebraria a fusão, que é pior que o silêncio: passaria a contar errado.

## O que ainda não existe

Não há **alarme**: nada avisa ninguém, tudo é consulta sob demanda. Numa instalação sem plantão isso é decisão, não esquecimento, mas convém dizer em voz alta para a página não sugerir uma vigilância que não existe.

Ver [[deploy-backend]], [[syncledger]] (a camada de tracing test/dev, que é outra coisa e não sobe para produção por gate de ambiente) e [[erros-api]].
