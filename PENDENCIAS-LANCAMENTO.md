# Pendências do lançamento do integracao_backend

Escrito em 2026-09-24 à tarde, quando a campanha de caça de bugs e de cobertura foi encerrada por falta de limite. Lista o que ficou para verificar, corrigir ou decidir antes de o integracao_backend substituir o main em produção. Este é um documento de TRABALHO: quando um item fechar, apague a linha dele (o que sobrevive vai para a wiki ou para o diário de decisões), e quando a lista zerar, apague o arquivo.

**Ele foi escrito para ser retomado em OUTRA máquina, por agentes sem o contexto da sessão original.** Tudo o que ele cita está no GitHub (origin): o código em branches, a documentação da campanha num branch próprio. Nada depende de pasta local da máquina original.

## 0. Onde está cada coisa (tudo no origin)

### A documentação da campanha: branch hunt/relatorios

Branch órfão, sem código (HEAD 0f5e5826). Leia primeiro o README.md dele. Contém, sob campanha-2026-09-24/:

- relatorios/: um relatório por frente, com os commits, as medições, as decisões tomadas e, no fim, uma seção PRÓXIMO PASSO com o estado exato e o próximo comando. É lá que está o detalhe de cada item deste documento.
- BRIEF-COMUM.md: as regras dadas a todo subagente (isolamento por worktree, portas e bancos próprios, o que não rodar, como commitar). Reaproveite numa nova rodada.
- RETOMADA.md e GOAL.md: o índice e o diário do coordenador. Os agentId citados lá não valem em outra sessão.
- ferramentas/: duas specs de Playwright de medição em escala (mil feições, dois navegadores, Postgres), que não estão em branch de código nenhum.

Para ler sem trocar de branch: git show origin/hunt/relatorios:campanha-2026-09-24/relatorios/rede.md (troque o nome do arquivo).

### O código não integrado: oito branches

| branch | HEAD | o que contém | item |
|---|---|---|---|
| hunt/b61-lote | 1b7cac2f | gestos em massa com uma gravação, pronto, verificação final não rodou | 1.2 |
| hunt/rede-ws | 12b2c21b | presença em link lento (0627c0cb, dadaff7c) e o WebSocket bloqueado em wip | 1.3 e 1.4 |
| hunt/orfas | a68ed8b6 | coleta de imagem órfã, inteira em wip | 1.5 |
| hunt/cob-desenho | 30c29454 | specs de desenho em wip | 2 |
| hunt/cob-taticas | 076cf1e9 | repro da alça de partida da rota em wip | 2 |
| hunt/cob-briefing | f9a5551c | conserto do painel de processamento em wip | 2 |
| hunt/cob-camadas | 9c1ee708 | repro do "Editar" nas notas para o Leitor em wip | 2 |
| hunt/cob-imagens | 9ef0ee51 | spec de figura de slide em link lento em wip | 2 |

Commit wip significa NÃO VERIFICADO: é trabalho em curso salvo quando a campanha parou, com a mensagem começando por wip e essas palavras no corpo. Nunca integre um wip sem terminá-lo e verificá-lo.

Outros branches hunt/ que existam na máquina original e não estão no origin não têm nada a integrar: o conteúdo deles já entrou por outro commit, ou foi descartado de propósito.

### Fora do repositório, de propósito

As instruções de nginx para o engenheiro (nginx-srv-arquivos-2026-09-23.txt e nginx-srv-arquivos-ebgeo-envio-2026-09-24.txt) descrevem os servidores de produção e NÃO estão no GitHub, porque este repositório é público. Elas ficaram na pasta Downloads da máquina original e precisam ser levadas à mão. O essencial delas está no passo 6 do item 5 abaixo.

## 0.1 Como retomar numa máquina nova

1. Clone o repositório e traga os branches: git fetch origin.
2. Não trabalhe no diretório principal para retomar uma frente: crie uma worktree por frente, fora do repositório, e instale as dependências dos DOIS pacotes nela (sem junção de node_modules, que já destruiu instalação uma vez):

        git worktree add ../ebgeo_b61-lote -b trabalho/b61-lote origin/hunt/b61-lote
        cd ../ebgeo_b61-lote/frontend && npm ci
        cd ../backend && npm ci

3. Rebase sobre o integracao_backend atual antes de verificar: o origin andou depois que os branches foram cortados, e outra sessão do dono também publica nele.
4. Cada teste que sobe servidor precisa de porta e banco próprios quando há mais de um agente na máquina: EBGEO_UI_E2E_APP_PORT, EBGEO_UI_E2E_BACKEND_PORT, EBGEO_E2E_PORT, EBGEO_E2E_DB_NAME e TEST_DB_NAME. As regras completas estão no BRIEF-COMUM.md e em frontend/tests/e2e-ui/constants.js.
5. Verificação: desde 2026-09-24 cada commit roda npm run test:tocados, que escolhe os testes pelo que mudou. A suíte inteira da raiz (npm run lint e depois npm test, em comandos separados) é obrigatória quando a mudança cruza os pacotes, antes de deploy e antes de levar trabalho ao main. O Playwright fica fora do npm test (npm run test:e2e:ui, de dentro de frontend/).
6. Revisão de código antes de integrar qualquer item do bloco 1: as três rodadas de revisão desta campanha acharam defeitos de perda de dado que as suítes verdes não pegavam.
7. Integrar: cherry-pick ou rebase sobre o integracao_backend, verificação, e push. Faça fetch e rebase logo antes do push e nunca force.
8. Os tetos do teste de peso da página do mapa (frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js) sobem com código novo. Quando subir um, registre no comentário ao lado do número o que foi medido e por quê.

## 1. Trabalho pronto em branches e ainda não integrado

A ordem abaixo é a de prioridade.

### 1.2 Gestos em massa com uma gravação só (excluir, estilo, desfazer, refazer)

- Branch hunt/b61-lote. Relatório: desempenho.md. Mil feições passam de 16 a 41 s na tela para cerca de 1 s. Decisão do dono de 2026-09-24: cada feição de um gesto em massa viaja como operação independente, de modo que um conflito custa só aquela feição.
- Commits: 2ebba72b, 32733551, ace22854 e os seis consertos da revisão de código (7341bcbf, 8c627111, 695e200c, dfc1b9ad, ff2c3048, 1b7cac2f). O mais importante: nas Pendências, "Aceitar o servidor" podia descartar a edição de OUTRA feição, porque a linha nomeava como causa a última recusa lida e não a que de fato a segurava.
- FALTA:
  - A verificação depois do último commit NÃO rodou: lint, frontend inteiro, contrato, specs de Pendências e de lote no navegador, e a medição de escala (spec em hunt/relatorios, ferramentas/).
  - Uma revisão de código dos seis consertos.
  - Integrar, portão e push.
- Custo aceito, medido: com uma operação por feição, o servidor recebe 25 por pedido, e 1000 mudanças de estilo levam de 20 a 27 s para chegar a ele (antes 7 s). Empacotar mais operações independentes por pedido traria o tempo de volta; é mudança só do cliente.

### 1.3 Presença em link lento

- Branch hunt/rede-ws, commits 0627c0cb e dadaff7c. Relatório: rede-ws.md. O servidor passa a mandar a cada colega só o último quadro de presença enquanto o anterior não chegou. No par lento a 40 kbps com três colegas mexendo o mouse, a edição passou de 1,3 a 4,9 s (crescendo) para no máximo 0,72 s. A variável WS_PRESENCE_FLOW=0 volta ao comportamento antigo sem deploy.
- NÃO PUBLICADA: o portão inteiro da raiz reprovou no backend (5715 de 5717).
  - Um dos vermelhos é o próprio teste de propriedade da mudança, presenca-fluxo-por-destinatario, no caso "op de sync nunca é descartada nem coalescida, em 200 intercalações sorteadas" (rodada 87: "presence reached the recipient"). Numa intercalação sorteada, o teste acusou presença chegando quando não devia. Reproduza com a mesma semente antes de confiar no conserto.
  - O outro vermelho foi o arquivo catalogo-basemap-sem-video, a conferir sozinho.
- Ficou de fora: reduzir o cursor do próprio par lento durante um envio, e o custo do ping extra na bancada de 400 usuários.

### 1.4 Atlas de servidor com o WebSocket bloqueado

- Mesmo branch hunt/rede-ws, no commit wip 12b2c21b, NÃO VERIFICADO. O trabalho começou (estado de conexão novo, sincronização por HTTP, aviso de "sem tempo real").
- Hoje, com um proxy que não repassa o Upgrade, o atlas de servidor não abre de jeito nenhum. O desenho da solução está em rede-ws.md.

### 1.5 Coleta de imagem órfã no servidor

- Branch hunt/orfas, inteiro no commit wip a68ed8b6, NÃO VERIFICADO. Relatório: orfas.md.
- Construído:
  - migração que marca quando uma imagem perdeu a última referência;
  - serviço, comando de diagnóstico e rota de administrador;
  - simulação por padrão, carência de 30 dias contínuos e trilha de auditoria.

  Nada roda sozinho.
- FALTA:
  - Alimentar três censos do backend que ficaram vermelhos: saídas de conteúdo, superfícies de recurso e compartilhamento de atlas.
  - Conferir sozinho um vermelho de boot.
  - A entrada no diário de decisões.
  - Suítes inteiras, revisão e integração.

  A migração é a 017_imagens_orfas.sql: se outra migração nova entrar antes, renumere esta.

## 2. Trabalho de cobertura pausado no meio (commits wip, sem verificação)

O detalhe e o próximo comando estão na seção PRÓXIMO PASSO do relatório de cada frente (hunt/relatorios).

- Desenho (hunt/cob-desenho, relatório cobertura-desenho.md): specs de edição por alça, abas e menu de contexto. Três vermelhos não investigados: a alça de rotação do texto não gira; o refazer da elipse e o do texto num atlas local, que devem ser a corrida do helper de refazer, consertada no integracao_backend em 2026-09-24 (o branch a recebe no rebase).
- Táticas (hunt/cob-taticas, cobertura-taticas.md): o pedido do dono não foi escrito. Hoje a alça de partida da rota fica no centro do símbolo militar, e pegar o símbolo move só a partida. Só o repro está no wip. O caso Declinação do spec de símbolos táticos falha cerca de uma vez em três.
- Briefing e processamento (hunt/cob-briefing, cobertura-briefing.md): um conserto do painel de processamento (trava e posto), sem prova.
- Camadas (hunt/cob-camadas, cobertura-camadas.md): há um DEFEITO PROVADO sem conserto, com repro vermelho 3/3 no wip. Leitor e Comentarista veem "Editar" nas notas do mapa, e a trava que chega com as notas abertas deixa "Editar" lá. Depois disso ainda falta cobrir o painel de camadas pela interface, os grupos e a aba Mapas.
- Imagens (hunt/cob-imagens, cobertura-imagens.md): spec de figura de slide em link lento; a segunda metade dele é vermelha por causa do custo descrito no item 3.
- Bloqueio (cobertura-bloqueio.md, tudo já integrado): faltou só um spec da seleção por clique e por caixa com as três travas, e do F5 nos dois lados.

## 3. Defeitos e riscos conhecidos, sem conserto

### 3.0 Achados da rodada completa de testes de 2026-09-24 à tarde (sobre ca2f7e87)

A suíte inteira da raiz passou: lint, frontend 16262/16262, backend 5704/5704 (cobertura 98,36%), contrato 274/274. O Playwright principal (911 casos, só Chromium) rodou em três fatias paralelas. Elas foram interrompidas por falta de memória da máquina quando tinham feito 678 casos. Os que falharam foram depois rodados sozinhos, em série, 3 vezes cada, sem nova tentativa:

- "Enviar ao servidor" de um atlas com saída de análise gravada pelo main avisa "Subiram só 793 feições de 805: parte deste atlas não chegou ao servidor", e é FALSO: as 12 que faltam são a saída das análises (processed_los e processed_visibility), que o envio pula por decisão desde 2026-09-23 e o cliente refaz. A frase compara o que subiu com o total do atlas, e o total conta a saída. Medido pelo spec transicao-main-fotos na integração das fotos (2026-09-25).
- No mesmo spec, a foto aberta pela galeria no atlas de SERVIDOR logo depois de "Enviar ao servidor" falhou 3 de 9 vezes: em duas a linha da feição não apareceu na árvore de camadas em 60 s, e numa o visualizador mostrou a miniatura (64 px) no lugar da foto (320 px). Os bytes no servidor conferem pelo banco e pela rota de leitura; o que a tela tem de produto ficou sem diagnóstico, e o spec deixou de abrir a foto ali.
- foto-anexa-nas-copias.spec.js, passo "copiar camada": criar um mapa e, na linha seguinte, copiar uma camada para ele falha em cerca de 1 de 10 com "Não foi possível confirmar a camada no mapa de destino" (desfecho target_write_incomplete da transferência de camada). Medido nas duas bases em 2026-09-25: 2 em 30 no integracao_backend e 1 em 10 com as fotos, então não vem delas. Hipótese a conferir: o eco do mapa novo refaz o índice de nomes entre a criação e a cópia, e a gravação no destino não acha o documento pelo nome e recusa em silêncio.
- browser-collab-permissions.spec.js (linha 253), revogação de compartilhamento: falhou 3 de 3, mas o defeito é do TESTE. Depois da revogação, a página do colega navega para outra tela, e o teste ainda chama clienteNaPagina nela ("Execution context was destroyed"). Confirmar que a navegação é o comportamento desejado e ajustar o spec.
- briefing-figura-leva-bytes.spec.js: passou 3 de 3 sozinho; a falha na fatia foi da carga.
- Depois, uma camada por vez, sobre c65162df. Três fatias paralelas mais a suíte da raiz tinham estourado os 32 GB da máquina original:
  - resto da suíte principal: 292 passaram, 3 falharam, 1 pulado;
  - tablet: 10/10;
  - segurança do atlas: 4/4;
  - sessão longa: 2/2;
  - atlas grande: 4 de 5;
  - verificações de release: 5/5.
- As falhas dessas camadas, rodadas sozinhas 3 vezes cada:
  - visibilidade-compartilhada-no-colega: 3 de 3; a falha anterior foi carga.
  - browser-migracao-2.2.spec.js (linha 421), janela do main aberta: 0 de 3, TESTE DESATUALIZADO. A tela agora diz "Há uma janela antiga do EBGeo aberta. Feche a outra janela do EBGeo neste computador...", e o teste procura as palavras "versão antiga". Confirmar que a mudança de texto foi intencional e atualizar a asserção.
  - desempenho-do-boot-do-mapa.spec.js (linha 304), transições entre atlas: 0 de 3, TETO DESATUALIZADO. São 638 pedidos de script por transição contra o teto de 631; o código novo do dia acrescentou módulos. Remedir junto com os tetos de peso, no passo 3 do item 5.
  - Atlas grande com 10000 pontos num grupo: 2 de 3. A falha foi "Target crashed", a queda conhecida do renderizador do Chromium no harness, descrita nas regras de teste do Playwright, que piora com mapa pesado. Nada aponta para o produto.
- Não rodaram:
  - o cenário de produção em HTTPS, que exige EBGEO_MIGRATION_DATA_DIR apontando para uma pasta com o arquivo 03-completo-2.4.ebgeo;
  - a camada de migração, que exige o mesmo acervo;
  - a "mega", que abre navegador na tela;
  - a suíte no Firefox (npm run test:e2e:firefox), cancelada pelo dono aos 19 de 912 casos, todos passando até ali.

- Figura de slide de briefing mora dentro do HTML do texto. Num link de 40 kbps, três palavras digitadas num slide com figura viraram 8 envios com o HTML inteiro (2,4 MB, cerca de 8 minutos), e em 5 minutos o colega não tinha o texto. Nada se perde, mas o slide fica inutilizável em link lento. Candidato a figura por referência, como as fotos.
- Testes do frontend que falham só sob carga e passam sozinhos: tab-lock-refutacao 3.5 (três vezes em 24/09), idb-decisao4-medicao (duas vezes), e a verificação de símbolos por tempo do docs-integridade (duas vezes).
- Dois specs do Firefox ficaram sem classificação: browser-collab-analise-desfazer (linha 119) e envio-do-acervo-herdado (linha 341).
- Duas observações da revisão dos atributos, sem efeito hoje:
  - Uma edição que mude mais de 1000 chaves de atributo de uma vez é recusada; nenhuma tela produz isso.
  - A remoção de chave sobre uma lista de atributos que não é objeto a troca por uma lista vazia.

## 4. Decisões do dono

- Corrigir o custo da figura de slide em link lento (item 3) antes do lançamento, ou depois?
- Comportamentos de visibilidade que ficaram como estão:
  - a busca acha feição oculta e, ao escolher, abre o painel dela;
  - feição oculta conta nos limites da linha do tempo;
  - excluir a camada ativa quando todas as outras estão travadas destrava uma delas.
- Limitações que o main também tem:
  - a volta de um KMZ perde a figura e as fotos anexas (o .ebgeo é a volta sem perda);
  - o ícone embutido de um KMZ chega como marcador padrão (o produto já tem ícones personalizados onde mapeá-lo).
- A coleta de imagem órfã deve ganhar agendamento? Hoje só roda por comando.
- Desfazer e refazer seguidos rápido: o segundo pedido chega enquanto o primeiro ainda redesenha o mapa base e é DESCARTADO em silêncio, por desenho, para o botão e o atalho não desfazerem dois passos juntos. A janela medida foi de 3 a 5 ms num mapa pequeno, e ela cresce com o redesenho num mapa pesado. O pedido deve esperar a vez, dizer que foi ignorado, ou ficar como está?
- Foto anexada recusada pelo servidor: o registro dela nunca sai, e toda saída da conta pergunta por ele, mesmo depois de a foto ter sido apagada da feição. Como a pessoa resolve: um "Descartar" nas pendências, ou o registro some quando a foto sai da entidade? (terceira revisão das fotos, item 5)
- Envio de imagem grande com o token vencido: o backend só usa o parser de 50 MB quando reconhece a sessão, então esse envio leva 413 e a foto vira recusa definitiva, quando antes era tentada de novo. Abrir o parser grande pela presença do cabeçalho de sessão, ou tratar o 413 como transitório no cliente quando o token pode ter vencido? (terceira revisão das fotos, item 4)

## 5. Passos finais antes do deploy

1. Fechar os itens 1.2 e 1.3, e também 1.4 e 1.5 se entrarem no lançamento.
2. Rodar as seis frentes do item 6, na ordem de risco, e integrar o que elas acharem.
3. Remedir e APERTAR os tetos de peso da página do mapa. A fonte ficou com folga larga de propósito durante a campanha.
4. npm run lint e npm test na raiz, em comandos separados.
5. O Playwright inteiro, em fatias paralelas com portas e bancos próprios, com retries desligado ou lendo a contagem de flaky antes de declarar verde.
6. nginx (instruções completas nos arquivos fora do repositório citados no item 0):
   - limite de corpo de 60 MB nos blocos do EBGeo, porque o padrão do nginx é 1 MB e o sync e o import o ultrapassam;
   - cabeçalhos de Upgrade do WebSocket no bloco de produção, na troca;
   - X-Forwarded-For.

   TRUST_PROXY_HOPS precisa bater com o número de proxies do caminho: 3 em produção, 4 no ambiente de teste.
7. METEOROLOGIA_URL: o padrão é a API pública da Open-Meteo, chamada pelo navegador de cada usuário. Se a coordenada não pode sair da rede, aponte para uma Open-Meteo interna em https, ou desligue o painel na aba Sistema.

## 6. Frentes aprovadas e ainda não feitas

APROVADAS pelo dono: são trabalho a fazer antes do lançamento, e não ideias. Elas foram propostas em 2026-09-24 e ficaram paradas só porque o limite de sessão da API não comportava mais agentes naquele momento. Tudo o que a campanha mediu foi com 2 ou 3 pessoas, e estas áreas ficaram só com os testes que já existiam. Cada uma é uma frente no molde da campanha: worktree própria, portas e bancos próprios, matriz de cobertura, repro com controle negativo para cada defeito, relatório com PRÓXIMO PASSO. As regras dadas aos agentes estão no BRIEF-COMUM.md do branch hunt/relatorios. Rode no máximo três agentes ao mesmo tempo, e a revisão de código conta como um. A ordem é a de risco:

1. Segurança e acesso. A noite de 23 para 24 achou falhas desta classe sem ninguém procurando, todas já corrigidas:
   - token de link público revogado que voltava a valer;
   - conta desativada que continuava escrevendo;
   - Comentarista apagando comentário alheio;
   - link de slide que abria a aba do EBGeo para outra página.

   Falta revisar três coisas:
   - texto de usuário exibido sem escape em toda superfície (tabela, legenda, PDF, KMZ, busca, briefing);
   - todas as rotas REST, por papel e por recurso, atrás de acesso a atlas ou recurso de outra pessoa;
   - os limitadores de tentativas, e o que um recurso privado do catálogo pode vazar.
2. Administração, compartilhamento e catálogo privado. A página de administração inteira, a lixeira, compartilhar e revogar, grupos de acesso, link público, concessões com prazo, OM e papéis. As regras estão escritas na CONSTITUICAO.md, e nenhuma frente as testou pela tela.
3. Carga com muitos usuários. Faltam 20 a 50 pessoas no mesmo atlas desenhando juntas. Medir:
   - processador e memória do servidor;
   - conexões do banco;
   - repasse das edições para todos;
   - se algum navegador trava.

   Os limites de uma instância única estão estimados na wiki, não medidos com colaboração real.
4. 3D, 360 e primeira pessoa. Faltam os visualizadores, os marcadores com foto, a cena caminhável, a colaboração dentro deles, a calibração 360 e o catálogo de modelos.
5. Tablet e celular. O produto tem layouts próprios e specs de tablet que não entram na rodada normal (npm run test:e2e:tablet). Se houver uso em campo, percorrer os fluxos principais com toque.
6. Menores, que caberiam numa frente só:
   - login, cadastro, recuperação de senha, sessão expirando e inatividade;
   - busca de topônimos e de coordenadas;
   - links diretos (?atlas=, #view=3d);
   - luminosidade e meteorologia, que só foram testadas pela sessão que as fez.

## 7. Linhas propostas para o livro-razão

- A descrição do pedido dizia que o modelo de conflito era LWW por chegada; o código é base e revisão por caminho. Codificado no repro de atributos por chave do backend.
- docs-integridade passou no ciclo de um agente porque uma sonda não rastreada na worktree continha o símbolo errado; o portão da integração, com a árvore limpa, pegou. O verificador mediu outra cópia do sujeito.
- Uma guarda de completude satisfeita por um valor padrão não guarda nada: o KMZ "classificava" todo tipo de feição porque o padrão era linha. Codificado no repro do preenchimento de viewshed no KMZ.
- Um teste de conversor que alimenta linhas prontas e pula o leitor de CSV é um subconjunto tratado como o todo. Codificado no repro de aspas no meio do campo.
- A sonda de lock do push contava locks do Postgres inteiro e via as rodadas de outros checkouts. Codificado no próprio teste, que agora filtra por banco e por atlas.
- O script de testes tocados começava com uma linha #! que o Vite recusa num checkout com CRLF, e o teste dele não carregava nesta máquina. Codificado no conserto do script.
