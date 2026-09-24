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

### O código não integrado: nove branches

| branch | HEAD | o que contém | item |
|---|---|---|---|
| hunt/fotos | 43f8729d | fotos anexas por referência, pronto e verificado, mais um spec de transição em wip | 1.1 |
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

As instruções de nginx para o engenheiro (nginx-srv-arquivos-2026-09-23.txt e nginx-srv-arquivos-ebgeo-envio-2026-09-24.txt) descrevem os servidores de produção e NÃO estão no GitHub, porque este repositório é público. Elas ficaram na pasta Downloads da máquina original e precisam ser levadas à mão. O essencial delas está no item 5.5 abaixo.

## 0.1 Como retomar numa máquina nova

1. Clone o repositório e traga os branches: git fetch origin.
2. Não trabalhe no diretório principal para retomar uma frente: crie uma worktree por frente, fora do repositório, e instale as dependências dos DOIS pacotes nela (sem junção de node_modules, que já destruiu instalação uma vez):

        git worktree add ../ebgeo_fotos -b trabalho/fotos origin/hunt/fotos
        cd ../ebgeo_fotos/frontend && npm ci
        cd ../backend && npm ci

3. Rebase sobre o integracao_backend atual antes de verificar: o origin andou depois que os branches foram cortados, e outra sessão do dono também publica nele.
4. Cada teste que sobe servidor precisa de porta e banco próprios quando há mais de um agente na máquina: EBGEO_UI_E2E_APP_PORT, EBGEO_UI_E2E_BACKEND_PORT, EBGEO_E2E_PORT, EBGEO_E2E_DB_NAME e TEST_DB_NAME. As regras completas estão no BRIEF-COMUM.md e em frontend/tests/e2e-ui/constants.js.
5. Verificação: desde 2026-09-24 cada commit roda npm run test:tocados, que escolhe os testes pelo que mudou. A suíte inteira da raiz (npm run lint e depois npm test, em comandos separados) é obrigatória quando a mudança cruza os pacotes, antes de deploy e antes de levar trabalho ao main. O Playwright fica fora do npm test (npm run test:e2e:ui, de dentro de frontend/).
6. Revisão de código antes de integrar qualquer item do bloco 1: as três rodadas de revisão desta campanha acharam defeitos de perda de dado que as suítes verdes não pegavam.
7. Integrar: cherry-pick ou rebase sobre o integracao_backend, verificação, e push. Faça fetch e rebase logo antes do push e nunca force.
8. Os tetos do teste de peso da página do mapa (frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js) sobem com código novo. Quando subir um, registre no comentário ao lado do número o que foi medido e por quê.

## 1. Trabalho pronto em branches e ainda não integrado

A ordem abaixo é a de prioridade.

### 1.1 Fotos anexas por referência (a maior mudança pendente)

- Branch hunt/fotos. Relatórios: rede.md e fotos-estrutural.md. A foto anexa a feição, a marcador 3D e a marcador 360 deixa de viajar inline (data URL em toda edição) e passa a blob com referência, com a edição esperando os bytes chegarem ao servidor.
- Duas revisões de código acharam 15 defeitos, quatro deles de perda de foto, e todos foram consertados, um commit por item: 73fc2be2, b2349f0d, de5923c3, 68220221, a2c21c42, d1e08a26, 8caaed5b, dc0cebab, 52b9d982, dc2be0e7, sobre os commits de base 1ec827ae, 2b5b4386, d58e37a3, 58d53580, 4dc0158f, d7f916e8, 37d5c267, 18f86b2d, 575a1b95, 0dce99b9.
- Verificado pelo agente em dc2be0e7, depois do último conserto: backend inteiro 5692/5692, frontend verde salvo o teto de peso, specs de foto no navegador 93/93 em três rodadas sem retry.
- FALTA:
  - (a) A terceira revisão de código, que foi interrompida sem resultado.
  - (b) Integrar. Houve conflito só de import em frontend/src/js/store/feature.operations.js nas duas integrações anteriores: mantenha os dois lados.
  - (c) Remedir os tetos de peso do mapa, porque a foto acrescenta pelo menos três módulos.
  - (d) O portão inteiro da raiz.
  - (e) Terminar o teste da transição do main para a integração com fotos antigas. O spec está no commit wip 43f8729d, com três vermelhos, todos do instrumento até agora. Falta conferir no banco se a foto do marcador 360 sumiu porque o servidor podou o marcador de projeto fora do catálogo.
- Decisões já tomadas (registradas em rede.md):
  - A figura APNG sobe ao servidor achatada num PNG parado; a cópia local fica com o original.
  - A foto inline antiga só é convertida quando a edição mexe nas fotos; uma edição sem relação leva os bytes uma vez.

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

- Desenho (hunt/cob-desenho, relatório cobertura-desenho.md): specs de edição por alça, abas e menu de contexto. Três vermelhos não investigados: a alça de rotação do texto não gira; o refazer da elipse e o do texto num atlas local, provavelmente a corrida de teste do item 3.
- Táticas (hunt/cob-taticas, cobertura-taticas.md): o pedido do dono não foi escrito. Hoje a alça de partida da rota fica no centro do símbolo militar, e pegar o símbolo move só a partida. Só o repro está no wip. O caso Declinação do spec de símbolos táticos falha cerca de uma vez em três.
- Briefing e processamento (hunt/cob-briefing, cobertura-briefing.md): um conserto do painel de processamento (trava e posto), sem prova.
- Camadas (hunt/cob-camadas, cobertura-camadas.md): há um DEFEITO PROVADO sem conserto, com repro vermelho 3/3 no wip. Leitor e Comentarista veem "Editar" nas notas do mapa, e a trava que chega com as notas abertas deixa "Editar" lá. Depois disso ainda falta cobrir o painel de camadas pela interface, os grupos e a aba Mapas.
- Imagens (hunt/cob-imagens, cobertura-imagens.md): spec de figura de slide em link lento; a segunda metade dele é vermelha por causa do custo descrito no item 3.
- Bloqueio (cobertura-bloqueio.md, tudo já integrado): faltou só um spec da seleção por clique e por caixa com as três travas, e do F5 nos dois lados.

## 3. Defeitos e riscos conhecidos, sem conserto

- Figura de slide de briefing mora dentro do HTML do texto. Num link de 40 kbps, três palavras digitadas num slide com figura viraram 8 envios com o HTML inteiro (2,4 MB, cerca de 8 minutos), e em 5 minutos o colega não tinha o texto. Nada se perde, mas o slide fica inutilizável em link lento. Candidato a figura por referência, como as fotos.
- Corrida de TESTE, não de produto: "Refazer: a cópia não saiu" em círculo, seta, limite, elipse e texto, porque o clique de refazer chega antes de o desfazer terminar. Falha também no código anterior. Conserte a espera no helper do spec antes da rodada completa do Playwright.
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

## 5. Passos finais antes do deploy

1. Fechar os itens 1.1 a 1.3, e também 1.4 e 1.5 se entrarem no lançamento.
2. Remedir e APERTAR os tetos de peso da página do mapa. A fonte ficou com folga larga de propósito durante a campanha.
3. npm run lint e npm test na raiz, em comandos separados.
4. O Playwright inteiro, em fatias paralelas com portas e bancos próprios, com retries desligado ou lendo a contagem de flaky antes de declarar verde.
5. nginx (instruções completas nos arquivos fora do repositório citados no item 0):
   - limite de corpo de 60 MB nos blocos do EBGeo, porque o padrão do nginx é 1 MB e o sync e o import o ultrapassam;
   - cabeçalhos de Upgrade do WebSocket no bloco de produção, na troca;
   - X-Forwarded-For.

   TRUST_PROXY_HOPS precisa bater com o número de proxies do caminho: 3 em produção, 4 no ambiente de teste.
6. METEOROLOGIA_URL: o padrão é a API pública da Open-Meteo, chamada pelo navegador de cada usuário. Se a coordenada não pode sair da rede, aponte para uma Open-Meteo interna em https, ou desligue o painel na aba Sistema.

## 6. Linhas propostas para o livro-razão

- A descrição do pedido dizia que o modelo de conflito era LWW por chegada; o código é base e revisão por caminho. Codificado no repro de atributos por chave do backend.
- docs-integridade passou no ciclo de um agente porque uma sonda não rastreada na worktree continha o símbolo errado; o portão da integração, com a árvore limpa, pegou. O verificador mediu outra cópia do sujeito.
- Uma guarda de completude satisfeita por um valor padrão não guarda nada: o KMZ "classificava" todo tipo de feição porque o padrão era linha. Codificado no repro do preenchimento de viewshed no KMZ.
- Um teste de conversor que alimenta linhas prontas e pula o leitor de CSV é um subconjunto tratado como o todo. Codificado no repro de aspas no meio do campo.
- A sonda de lock do push contava locks do Postgres inteiro e via as rodadas de outros checkouts. Codificado no próprio teste, que agora filtra por banco e por atlas.
- O script de testes tocados começava com uma linha #! que o Vite recusa num checkout com CRLF, e o teste dele não carregava nesta máquina. Codificado no conserto do script.
