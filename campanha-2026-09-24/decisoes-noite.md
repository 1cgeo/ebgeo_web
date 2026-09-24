
---

### 2026-09-23: a saída das análises de terreno é derivada por cada cliente e nunca viaja

- **Contexto:** a Linha de Visada e o Viewshed gravam uma ENTRADA (`los`, `visibility`) e uma SAÍDA (`processed_los`, `processed_visibility`, as metades verde e vermelha, que são o único desenho visível: a camada da entrada pinta com opacidade zero). A saída nascia com id de entrada mais o sufixo da metade, que não é UUID, e o servidor a recusa (`features.id` é UUID). Medido em dois navegadores num atlas de servidor: o autor ficava com duas recusas para sempre e perdia o desenho no F5, e o par nunca via a análise. O envio de um atlas local re-cunhava esses ids e quebrava o vínculo por prefixo, deixando a saída órfã. E toda edição posterior da entrada (arrastar vértice, altura do observador) nunca sincronizou, porque `batchUpdateAnalysisFeatures` não registrava a intenção.
- **Decisão (coordenador da caça noturna, sem mudar contrato, schema nem API):** a saída é função pura da entrada (`deriveAnalysisOutput`), a mesma na ferramenta do autor, no caminho de entrada do par, no retrato, na rajada de criações remotas e no desfazer/refazer (`replaceDerivedOutput`); a escrita dela é descartada pelo despachante por TIPO, pela lista única `DERIVED_OUTPUT_BUCKET_OF`, nunca por formato de id; linhas legadas de saída vindas do servidor são descartadas no retrato; o envio de atlas local não sobe a saída; as recusas antigas dessas ops são limpas da fila.
- **Alternativas recusadas:** UUID determinístico para a saída (quebra a relação por prefixo dos atlas locais existentes e exigiria cascata no servidor); aceitar id não-UUID no servidor (migração de `features.id`).
- **Precedente:** o raster de símbolo militar regenerado pelo par e a contagem de cores de 2026-09-21, ambos derivados do que sincroniza.
- **Status:** aceita pelo coordenador, para o dono confirmar.

---

### 2026-09-23: o fim involuntário da sessão resgata a fila de TODO atlas de servidor com pendência

- **Contexto:** a troca de atlas promete guardar a fila do atlas deixado para a próxima abertura, mas o resgate da saída involuntária (inatividade, renovação recusada) olhava só o atlas MONTADO, e a varredura seguinte destruía a fila dos outros em silêncio (medido: banco de fila apagado, nenhum aviso). Um 503 no `/auth/me` do boot também varria tudo como se fosse logout, e uma segunda conta que entrasse depois de uma restauração adiada herdava a fila da primeira.
- **Decisão:** `preserveUnsyncedWorkOfOtherAtlases` roda antes de toda varredura involuntária (mapa, páginas sem mapa, boot deslogado, troca de conta por `endPreviousAccountIfReplaced`). Entra todo atlas remoto registrado com contagem positiva ou desconhecida, adotado como local sem mudar o atlas corrente; fica de fora o de descarte confirmado e o que outra aba viva tem montado (a saída daquela aba o resgata); acima do teto de atlas locais, o atlas fica retido (`retainRemoteAtlasForRescue`) com o prazo que resta dito na tela, e veto vencido conta como perdido. A guarda de boot não varre com par de tokens guardado, e o cursor durável carrega principal e nível do recorte.
- **Alternativa recusada:** só o veto de retenção de 24 h, que perde em silêncio depois do prazo.
- **Risco declarado para o dono:** o resgate no boot deslogado transforma o retrato de servidor com pendência em atlas local legível sem login, sem a poda de recursos privados que "Sair do servidor" aplica. A política já valia para o atlas montado; esta decisão a estende.
- **Status:** aceita pelo coordenador, para o dono confirmar.

---

### 2026-09-23: a janela da versão antiga aberta durante a virada é ESPERA, não falha

- **Contexto:** com uma aba do `main` aberta durante a implantação (o caso mais comum da virada), o portão de migração desenhava a tela de duas saídas, cujo único comando além de baixar é "Continuar", que APAGA os dados deste computador; a saída certa (fechar a janela antiga) não tinha botão e o texto se contradizia.
- **Decisão (diretriz de resiliência de 2026-09-22):** o portão desenha "Há uma janela antiga do EBGeo aberta. Feche a outra janela do EBGeo neste computador. Esta página continua sozinha quando ela fechar." sem comando nenhum, sonda de novo a cada segundo e segue sozinho depois de duas ausências seguidas. A tela de duas saídas continua para as falhas reais. Medido com o build real do `main`: Chromium e Firefox esperam sem botão e retomam em 3 a 5 s depois de a janela antiga fechar, com a escrita tardia dela absorvida.
- **Alternativa recusada:** um terceiro botão "Recarregar" na tela de recuperação, que contraria a regra do dono de uma tela com duas saídas.
- **Status:** aceita pelo coordenador, para o dono confirmar.

---

### 2026-09-24: abrir a versão antiga depois de um rollback não é alteração dela

- **Contexto:** medido com o build real do `main`: se a produção voltar para o `main` e a pessoa só ABRIR o app, a versão antiga regrava o `sync` do mapa ativo e o `mapBadgeColors`, e ao voltar a integração criava e ABRIA um "Recuperado" com a cópia velha no lugar do atlas em que a pessoa trabalhava.
- **Decisão:** um mapa da origem que mudou é inerte quando o conteúdo dele (sem `sync`) está contido no do destino, E a fila do `main` não tem exclusão de entidade daquele mapa desde o início da transição, E o destino não tem feição anterior à transição que falte na origem; sem marco de início ou com fila ilegível, nada é absolvido. `mapBadgeColors` entrou em `PREFERENCE_KEYS` e `LATE_RULE_VERSION` subiu. A decisão de 2026-09-23 sobre abrir o Recuperado direto continua valendo quando há alteração real.
- **Status:** aceita pelo coordenador, para o dono confirmar.

---

### 2026-09-23: uma cauda de pull longa demais vira retrato no HTTP e pedido de ressincronização no socket

- **Contexto:** 300 edições de um polígono de 300 vértices geravam uma cauda de 7,5 MB contra um retrato de 14 KB, e o cliente aplicava a cauda op a op. Mandar o retrato pelo socket, porém, entrava em laço num link de 40 kbps: o quadro vai sem compressão e o heartbeat cortava antes de ele chegar.
- **Decisão:** acima de 500 ops ou de 2 MiB guardados, o pull REST responde o retrato (a forma `isSnapshot` que os dois caminhos já conheciam); pelo socket, o servidor avisa para re-puxar pelo HTTP, que tem compressão e prazo por silêncio, e nunca manda um quadro de retrato. Provado no cliente que a edição local pendente sobrevive e sobe.
- **Status:** aceita pelo coordenador.

---

### 2026-09-24: "Duplicar" mapa num atlas de servidor usa a rota de duplicação do servidor

- **Contexto:** o cliente montava a cópia localmente, gravando camadas sem op e feições dentro do documento do `map` CREATE, que o servidor não transforma em feição: a cópia ficava vazia no Postgres e depois do F5. A rota REST de duplicação existia, era uma das quatro exceções estruturais declaradas, e nenhum cliente a chamava.
- **Decisão:** em atlas remoto, `_duplicateOnServer` esvazia a fila, chama a rota com o nome pedido (corpo opcional com o nome, aditivo) e ressincroniza, então o autor recebe a cópia pelo mesmo caminho do par; sem conexão o comando é desenhado e o clique recusa nomeando o estado. Atlas local continua na montagem local.
- **Status:** aceita pelo coordenador.

---

### 2026-09-23: a importação de arquivo preserva o nome e as colunas reservadas, e não inventa atributos de estilo

- **Contexto:** importar KML, SHP, GeoJSON ou CSV descartava em silêncio toda coluna cujo nome colidia com uma propriedade de sistema, inclusive o NOME da feição (o nome do Placemark do KML, a coluna NOME do DBF), e a ida e volta do nosso próprio KMZ acrescentava cinco atributos de estilo por ponto e perdia a descrição ("[object Object]"). O `main` fazia o mesmo.
- **Decisão:** o nome vem do primeiro campo de nome não vazio do arquivo; chave reservada que nenhum leitor consome vira um atributo com o sufixo de importado; as chaves que a conversão de KML deriva do estilo não viram atributo, e o nosso KMZ carrega o próprio estilo e o restaura. Estilo de KML de terceiros continua sem ser aplicado aos campos nativos (proposta para o dono).
- **Status:** aceita pelo coordenador.

---

### 2026-09-23: navegadores Chrome e Edge 105 a 109 (Windows 7 e 8.1)

- **Contexto:** o build legado entrega o pacote moderno sem polyfill a todo navegador com `import.meta.resolve`, e a importação de shapefile usa `Array.prototype.toReversed` (Chrome 110) dentro do `shpjs`: no Chrome 109 a importação morria com "toReversed is not a function".
- **Decisão:** polyfill local, definido só se ausente, no ponto único `frontend/src/js/vendor/shpjs.js`. A varredura dos pacotes carregados sob demanda não achou outro uso alcançável de ES2023 sem guarda.
- **Pendente para o dono:** não há política escrita de navegador mínimo; a proposta é Chrome/Edge 109 e Firefox ESR 115.
- **Status:** aceita pelo coordenador.
