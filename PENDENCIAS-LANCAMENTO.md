# Pendências do lançamento do integracao_backend

Escrito em 2026-09-24 à tarde, quando a campanha de caça de bugs e de cobertura foi encerrada por falta de limite. Lista o que ficou para verificar, corrigir ou decidir antes de o integracao_backend substituir o main em produção. Este é um documento de TRABALHO: quando um item fechar, apague a linha dele (o que sobrevive vai para a wiki ou para o diário de decisões), e quando a lista zerar, apague o arquivo.

O trabalho não integrado mora em worktrees fora do repositório, em C:\Users\diniz\ebgeo_hunt\ (uma pasta por frente, cada uma com o próprio node_modules). Cada frente tem um relatório em C:\Users\diniz\ebgeo_hunt\relatorios\ com uma seção PRÓXIMO PASSO que diz o estado exato e o próximo comando. O índice geral é C:\Users\diniz\ebgeo_hunt\RETOMADA.md.

## 1. Trabalho pronto em branches e ainda não integrado

A ordem abaixo é a de prioridade. Para integrar: cherry-pick no branch hunt/integra (worktree integra), testes, depois fast-forward do integracao_backend e push. Outra sessão do dono também publica neste branch, então faça fetch e rebase antes de todo push, nunca force.

### 1.1 Fotos anexas por referência (a maior mudança pendente)

- Branch hunt/fotos, worktree rede, HEAD dc2be0e7. A foto anexa a feição, a marcador 3D e a marcador 360 deixa de viajar inline (data URL em toda edição) e passa a blob com referência, com a edição esperando os bytes chegarem ao servidor.
- Duas revisões de código acharam 15 defeitos, quatro deles de perda de foto, e todos foram consertados, um commit por item: 73fc2be2, b2349f0d, de5923c3, 68220221, a2c21c42, d1e08a26, 8caaed5b, dc0cebab, 52b9d982, dc2be0e7, sobre os commits de base 1ec827ae, 2b5b4386, d58e37a3, 58d53580, 4dc0158f, d7f916e8, 37d5c267, 18f86b2d, 575a1b95, 0dce99b9.
- Verificado pelo agente depois do último commit: backend inteiro 5692/5692, frontend verde salvo o teto de peso, specs de foto no navegador 93/93 em três rodadas sem retry.
- FALTA: (a) a terceira revisão de código, que foi interrompida sem resultado; (b) integrar (houve conflito só de import em feature.operations.js nas duas integrações anteriores: mantenha os dois lados); (c) remedir os tetos de peso do mapa (a foto acrescenta pelo menos três módulos); (d) o portão inteiro da raiz; (e) o teste da transição main para integração com fotos antigas, cujo spec está sem commit na worktree (três vermelhos, todos do instrumento até agora; falta conferir no banco se a foto do marcador 360 sumiu porque o servidor podou o marcador de projeto fora do catálogo).
- Decisões já tomadas e registradas no relatório rede.md: a figura APNG sobe ao servidor achatada num PNG parado (a cópia local fica com o original); a foto inline antiga só é convertida quando a edição mexe nas fotos, e uma edição sem relação leva os bytes uma vez.
- O estado integrado da primeira tentativa (branch hunt/integra-fotos, 95461c1d) está OBSOLETO. Não use.

### 1.2 Gestos em massa com uma gravação só (excluir, estilo, desfazer, refazer)

- Branch hunt/b61-lote, worktree desempenho, HEAD 1b7cac2f. Mil feições passam de 16 a 41 s na tela para cerca de 1 s. Decisão do dono de 2026-09-24: cada feição de um gesto em massa viaja como operação independente, de modo que um conflito custa só aquela feição.
- Commits: 2ebba72b, 32733551, ace22854 e os seis consertos da revisão de código (7341bcbf, 8c627111, 695e200c, dfc1b9ad, ff2c3048, 1b7cac2f). O mais importante deles: nas Pendências, "Aceitar o servidor" podia descartar a edição de OUTRA feição, porque a linha nomeava como causa a última recusa lida e não a que de fato a segurava.
- FALTA: a verificação depois do último commit NÃO rodou (lint, frontend inteiro, contrato, specs de Pendências e de lote no navegador, a medição de escala); uma revisão de código dos seis consertos; integrar; portão; push. O estado integrado antigo (hunt/integra-lote) está obsoleto.
- Custo aceito, medido: com uma operação por feição, o servidor recebe 25 por pedido, e 1000 mudanças de estilo levam de 20 a 27 s para chegar a ele (antes 7 s). Empacotar mais operações independentes por pedido traria de volta; é mudança só do cliente.

### 1.3 Presença em link lento

- Branch hunt/rede-ws, worktree rede-ws, commits 0627c0cb e dadaff7c. O servidor passa a mandar a cada colega só o último quadro de presença enquanto o anterior não chegou. No par lento a 40 kbps com três colegas mexendo o mouse, a edição passou de 1,3 a 4,9 s (crescendo) para no máximo 0,72 s. A válvula WS_PRESENCE_FLOW=0 volta ao comportamento antigo sem deploy.
- NÃO PUBLICADA: o portão inteiro da raiz reprovou no backend (5715 de 5717). Um dos vermelhos é o próprio teste de propriedade da mudança, presenca-fluxo-por-destinatario, no caso "op de sync nunca é descartada nem coalescida, em 200 intercalações sorteadas" (rodada 87: "presence reached the recipient"). Ou seja, numa intercalação sorteada o teste acusou presença chegando quando não devia; é preciso reproduzir com a mesma semente antes de confiar no conserto. O outro vermelho foi o arquivo catalogo-basemap-sem-video, a conferir sozinho.
- Ficou de fora: reduzir o cursor do próprio par lento durante um envio, e o custo do ping extra na bancada de 400 usuários.

### 1.4 Atlas de servidor com o WebSocket bloqueado

- Mesma worktree rede-ws, SEM commit: o trabalho começou (estado de conexão novo, sincronização por HTTP, aviso de "sem tempo real") e não foi verificado.
- Hoje, com um proxy que não repassa o Upgrade, o atlas de servidor não abre de jeito nenhum. O desenho da solução está no relatório rede-ws.md.

### 1.5 Coleta de imagem órfã no servidor

- Worktree peso, branch hunt/orfas, NADA commitado. Construído: migração que marca quando uma imagem perdeu a última referência, serviço, comando de diagnóstico e rota de administrador, com simulação por padrão, carência de 30 dias contínuos e trilha de auditoria. Nada roda sozinho.
- FALTA: alimentar três censos do backend que ficaram vermelhos (saídas de conteúdo, superfícies de recurso, compartilhamento de atlas), conferir sozinho um vermelho de boot, a entrada no diário de decisões, suítes inteiras, commit, revisão e integração. Se outra migração nova entrar antes, renumere a dela.

## 2. Trabalho de cobertura pausado no meio (sem commit, sem verificação)

Cada item tem o estado e o próximo comando na seção PRÓXIMO PASSO do relatório da frente.

- Desenho (worktree collab-ferramentas): specs de edição por alça, abas e menu de contexto sem commit; três vermelhos não investigados (alça de rotação do texto não gira; refazer da elipse e do texto num atlas local, provavelmente a corrida de teste do item 3).
- Táticas (worktree producao): o pedido do dono de a alça de partida da rota não ficar no centro do símbolo militar (pegar o símbolo move só a partida) não foi escrito; o repro está sem commit. O caso Declinação do spec de símbolos táticos falha cerca de uma vez em três.
- Briefing e processamento (worktree collab-briefing): um conserto do painel de processamento (trava e posto) sem commit e sem prova.
- Camadas (worktree troca-atlas): DEFEITO PROVADO sem conserto: Leitor e Comentarista veem "Editar" nas notas do mapa, e a trava que chega com as notas abertas deixa "Editar" lá (repro vermelho 3/3). Depois disso faltava cobrir o painel de camadas pela interface, os grupos e a aba Mapas.
- Imagens (worktree migracao): spec de figura de slide em link lento sem commit; a segunda metade dele é vermelha por causa do custo descrito no item 3.
- Bloqueio (worktree backend-sync): terminado; faltava um spec da seleção por clique e por caixa com as três travas e o F5 nos dois lados.

## 3. Defeitos e riscos conhecidos, sem conserto

- Figura de slide de briefing mora dentro do HTML do texto. Num link de 40 kbps, três palavras digitadas num slide com figura viraram 8 envios com o HTML inteiro (2,4 MB, cerca de 8 minutos), e em 5 minutos o colega não tinha o texto. Nada se perde, mas o slide fica inutilizável em link lento. Candidato a figura por referência, como as fotos.
- Corrida de TESTE, não de produto: "Refazer: a cópia não saiu" em círculo, seta, limite, elipse e texto, porque o clique de refazer chega antes de o desfazer terminar. Falha também no código anterior. Consertar a espera no helper do spec antes da rodada completa do Playwright.
- Testes do frontend que falham só sob carga e passam sozinhos: tab-lock-refutacao 3.5 (três vezes em 24/09), idb-decisao4-medicao (duas), docs-integridade na verificação de símbolos por tempo (duas).
- Dois specs do Firefox ficaram sem classificação: browser-collab-analise-desfazer (linha 119) e envio-do-acervo-herdado (linha 341).
- Duas observações da revisão dos atributos, sem efeito hoje: uma edição que mude mais de 1000 chaves de atributo de uma vez é recusada (nenhuma tela produz isso), e a remoção de chave sobre uma lista de atributos que não é objeto a troca por uma vazia.

## 4. Decisões do dono

- Corrigir o custo da figura de slide em link lento (item 3) antes do lançamento, ou depois?
- Comportamentos de visibilidade que ficaram como estão: a busca acha feição oculta e, ao escolher, abre o painel dela; feição oculta conta nos limites da linha do tempo; excluir a camada ativa quando todas as outras estão travadas destrava uma delas.
- Limitações que o main também tem: a volta de um KMZ perde a figura e as fotos anexas (o .ebgeo é a volta sem perda); o ícone embutido de um KMZ chega como marcador padrão (o produto já tem ícones personalizados onde mapeá-lo).
- A coleta de imagem órfã deve ganhar agendamento? Hoje só roda por comando.

## 5. Passos finais antes do deploy

1. Fechar os itens 1.1 a 1.3 (e 1.4 e 1.5 se entrarem no lançamento).
2. Remedir e APERTAR os tetos de peso da página do mapa (a fonte ficou com folga larga de propósito durante a campanha).
3. npm run lint e npm test na raiz, em comandos separados (a política de 2026-09-24 manda rodar a raiz inteira antes de deploy e antes de levar trabalho ao main).
4. O Playwright inteiro, em fatias paralelas com portas e bancos próprios, com retries desligado ou lendo a contagem de flaky antes de declarar verde.
5. nginx: as instruções para o engenheiro estão em C:\Users\diniz\Downloads\nginx-srv-arquivos-ebgeo-envio-2026-09-24.txt (limite de corpo de 60 MB nos blocos do EBGeo, cabeçalhos de Upgrade do WebSocket no bloco de produção na troca, X-Forwarded-For). TRUST_PROXY_HOPS precisa bater com o número de proxies do caminho: 3 em produção, 4 no ambiente de teste.
6. METEOROLOGIA_URL: o padrão é a API pública da Open-Meteo, chamada pelo navegador de cada usuário. Se a coordenada não pode sair da rede, aponte para uma Open-Meteo interna em https, ou desligue o painel na aba Sistema.

## 6. Linhas propostas para o livro-razão

- A descrição do pedido dizia que o modelo de conflito era LWW por chegada; o código é base e revisão por caminho. Codificado no repro de atributos por chave do backend.
- docs-integridade passou no ciclo de um agente porque uma sonda não rastreada na worktree continha o símbolo errado; o portão da integração, com a árvore limpa, pegou. O verificador mediu outra cópia do sujeito.
- Uma guarda de completude satisfeita por um valor padrão não guarda nada (o KMZ classificava todo tipo de feição porque o padrão era linha). Codificado no repro do preenchimento de viewshed no KMZ.
- Um teste de conversor que alimenta linhas prontas e pula o leitor de CSV é um subconjunto tratado como o todo. Codificado no repro de aspas no meio do campo.
- A sonda de lock do push contava locks do Postgres inteiro e via as rodadas de outros checkouts. Codificado no próprio teste, que agora filtra por banco e por atlas.
