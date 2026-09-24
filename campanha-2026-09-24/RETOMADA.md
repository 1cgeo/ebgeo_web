# CAMPANHA ENCERRADA (24/09 ~14:20, pedido do dono: sem limite)

Todos os agentes PARADOS e o heartbeat cancelado. O que falta está em PENDENCIAS-LANCAMENTO.md na raiz do repositório (commit af7c2121, PUBLICADO). A presença (d5a48baa, 8b4449e1) NÃO foi publicada: o portão i30 reprovou no backend, inclusive o próprio teste de propriedade dela (rodada 87). O resto deste arquivo é histórico.

# RETOMADA: como continuar depois que o limite de tokens voltar

Escrito em 2026-09-24 ~06:45; limite atingido às ~07:00 e todos os 9 agentes retomados às 07:14, quando o dono avisou que o limite ia acabar. Tudo o que está aqui existe em disco; nada depende da memória da sessão.

## Estado do código

- `origin/integracao_backend` = `8dfaa6c1` (push ~14:10: seguimentos de atributos com portão inteiro verde, rebaseados sobre 2 commits da outra sessão (8e7efe53 estilo, 6cb3a719 NOVA POLÍTICA DE TESTES: `npm run test:tocados` por commit, raiz inteira só para contrato/deploy/main), + 8dfaa6c1 conserto do shebang de dev/testes-tocados.mjs, que não carregava em checkout CRLF).
- EM VERIFICAÇÃO: presença em link lento (rede-ws T1: 0627c0cb, dadaff7c) sobre 8dfaa6c1, portão inteiro destacado (i30-gate.out, espera bdldhn5mq).
- Pausa das 10h47 às 12h10 encerrada: às 12h12 retomados fotos (ae9155f8684bad169), B6.1 (a046f8de4d287bdea, branch hunt/b61-lote, integração espera a decisão do dono sobre o preço do lote) e atributos (acf9472726270f13f, rebase sobre 14a32949 primeiro). Heartbeat recorrente recriado (18074d49, minutos 17 e 47).
- FOTOS SEGURADAS DE NOVO (~10:40): o 2º revisor achou 8 defeitos, 2 de perda (conversão recusada apaga a única cópia no servidor; "Salvar como local"/resgate levam só a miniatura das fotos que o computador nunca baixou). Estado integrado e resolvido guardado em hunt/integra-fotos (95461c1d, portão verde). Agente de fotos: feitos itens 1 (73fc2be2), 6 (b2349f0d), 8 (de5923c3), 7 (68220221), 5 (a2c21c42), 2 (d1e08a26), 3 APNG (8caaed5b; figura blob APNG sobe achatada em PNG parado sob o mesmo id, aceito pelo coordenador); 4 (52b9d982, só converte quando a foto muda; edição sem relação leva os bytes 1 vez, aceito pelo coordenador); falta convenções; backend inteiro não rodou depois do item 1. Ao voltar: rebase de hunt/integra-fotos sobre integracao_backend (ou refazer os cherry-picks), + consertos, portão, revisor.

- `origin/integracao_backend` = +e6845726 (spec de fotos pela galeria real) sobre `03baaeba` (push ~10:10, +10: B6.1 achados 2-5, arrasto de símbolo com rota, .ebgeo parcial com mapa ilegível, mosaico PDF, nome do slot resgatado, specs de cópia com bytes; lint, e2e 265, frontend verde salvo tab-lock-refutacao 3.5, flake de carga RECORRENTE, 5/5 isolado). Antes: `06f9569e` (push ~09:05, +5: B6.1 eco adiado em conjunto db1ca9c5, toda op da parte seguinte depende da anterior deda010f (achado 1 do revisor), CSV em atlas de servidor, KMZ atributo vazio, resgate com figura pendente).  Antes: f957771f (push ~08:30): B6.1 compostos (e7e1f1e2), cópia no servidor que espera a figura (4e48a351), teto de módulos 805 (1c869f90), spec de figuras (f957771f). ATENÇÃO: OUTRA SESSÃO do dono também empurra para este branch (2e29bccb, reorganização das regras de agente em .claude/rules com `paths:`). Antes de todo push: `git fetch` e, se o origin andou, `git rebase origin/integracao_backend` em hunt/integra, depois `git reset --keep hunt/integra` na árvore principal (limpa) e push. Nunca force.
- Branch de integração: `hunt/integra` na worktree `C:\Users\diniz\ebgeo_hunt\integra`, igual ao origin depois de cada push.
- **Achados do code-reviewer do B6.1** enviados ao agente do B6.1 (5 pontos; o mais grave: "Aceitar o servidor" numa parte recusada solta as outras 199 ops da parte seguinte, porque o dependsOn fica só na primeira op). Achado de texto das frases de cópia resolvido (0af643e4). KMZ: o main também perdia figura e fotos na volta; limitação declarada, registrada no relatório do cob-imagens para o dono.
- Integração: sempre cherry-pick dos commits das frentes em `hunt/integra`, testes pontuais + lint, depois ff do `integracao_backend` na árvore principal e push.

## Agentes (retomar com SendMessage para o agentId; eles guardam o contexto)

Mensagem padrão de retomada: "Coordenador: o limite de tokens voltou. Confira `git status` da sua worktree, releia a seção PRÓXIMO PASSO do seu relatório e continue de onde parou; commite o que estiver verificado."

| frente | agentId | worktree / branch | tarefa em curso |
|---|---|---|---|
| B6.1 (lote > 200) | a046f8de4d287bdea | desempenho / hunt/b61 | parte 1 integrada (9e6ccb57); em curso: COMPOSTOS (transferir camada, grupo > 200, desfazer) com blocos dependentes por dependsOn, e prova em escala (importar 5000, colar/duplicar 1000, mover 1000, mover/copiar camada 1000, excluir+desfazer 1000, estilo+desfazer 1000, agrupar 500) |
| fotos estruturais | ae9155f8684bad169 | rede / hunt/fotos | fase 1 e 2a integradas; 2b pronta em `1ec827ae` e NÃO integrar sem a 2c; em curso: 2c (caminhos de cópia e fronteira, com conversão na fronteira; rewriteFeatureProperties no clone, local-atlas-to-server, import atômico, .ebgeo aditivo, colar entre atlas); depois 2e (coleta de órfão obrigatória, retenção >= 30 dias) |
| cob-desenho | a0c34b00d6cfa694d | collab-ferramentas / hunt/cob-desenho | matriz e specs das ferramentas de desenho |
| cob-taticas | ae706ffca80e436ca | producao / hunt/cob-taticas | táticas, análise, medição, seleção, trajetória |
| cob-importexport | (fechou) | peso / hunt/cob-importexport | fechada, 2 rodadas; o agente foi para órfãs |
| cob-briefing | a7a223b85e89cba81 | collab-briefing / hunt/cob-briefing | briefings e processamentos |
| cob-camadas | a0d2beb4bf7671ba0 | troca-atlas / hunt/cob-camadas | atributos e tabela (prioridade), tabela só leitura para Leitor APROVADA, depois painel de camadas, grupos, aba Mapas |
| cob-bloqueio | a84a96cbffb45d51a | backend-sync / hunt/cob-bloqueio | visibilidade e bloqueio de feição/camada/grupo/mapa em todo caminho de escrita |
| cob-imagens | aa3b3ed1a2fab23fd | migracao / hunt/cob-imagens | imagens (ferramenta de imagem e fotos anexas) em todos os caminhos, mais figuras de briefing |
| atributos por chave | acf9472726270f13f | navegadores / hunt/atributos | atributos convergem por chave (dois pacotes, formato antigo aceito), decisão do dono 24/09 |
| órfãs (2e) | aad38a54b6835e086 | peso / hunt/orfas | coleta de imagem órfã no servidor: carência 30 dias contínuos, simulação por padrão, trilha, CLI diag + rota admin, sem agendamento |
| rede-ws (NOVO) | a8b17d8d8b29512be | rede-ws / hunt/rede-ws (portas 4391/3991/3993, bancos ebgeo_e2e_redews/ebgeo_test_redews) | (1) presença coalescida por destinatário em link lento; (2) atlas de servidor abre e sincroniza por HTTP com o WS bloqueado |

Relatórios e matrizes: `C:\Users\diniz\ebgeo_hunt\relatorios\` (`cobertura-*.md`, `<frente>.md`). Regras: `BRIEF-COMUM.md`. Diário: `GOAL.md`.

## Limite de subagentes (dono, 24/09)

- ~13:55 LOTE EM MASSA SEGURADO: revisor achou em Pendências "Aceitar o servidor" descartando edição de outra feição (bloqueadaPor = última recusa lida, agravado por b097ca2b/c10e555b) + 4 menores. Lote guardado em hunt/integra-lote (7c8e4390, com teto de fonte 12140). Agente B6.1 retomado com os 5 itens. Seguimentos de atributos PUBLICADOS. Ativos: rede-ws, B6.1 e o 3º REVISOR DAS FOTOS (ae65ea4168f776b4d) sobre hunt/fotos dc2be0e7 (lista: 73fc2be2, b2349f0d, de5923c3, 68220221, a2c21c42, d1e08a26, 8caaed5b, dc0cebab, 52b9d982, dc2be0e7; o agente de fotos verificou backend 5692, frontend 16174 salvo o teto, Playwright 93/93 em 3 rodadas). Agente de fotos PAUSADO esperando o revisor; depois: transição main->integração.

- ~13:20 PUBLICADO atributos por chave (2384307f após rebase): portão inteiro verde (lint, frontend 16219, backend 5701 cobertura 98,36%, contrato 273), revisor sem grave. Agente de atributos RETOMADO para 4 seguimentos da revisão (bolsa antiga com base inflada, desfazer por chave no-op, guarda de espelho, recusa só de __proto__). Ativos: fotos, B6.1, atributos. Depois: rede-ws.

**EM PAUSA desde ~11:00 (pedido do dono, de 3 em 3):** ativos só fotos (ae9155f8684bad169), desempenho/B6.1 (a046f8de4d287bdea) e cob-bloqueio (a84a96cbffb45d51a). PAUSADOS num ponto limpo, com o estado no PRÓXIMO PASSO de cada relatório: cob-desenho, cob-taticas, cob-briefing, cob-camadas, cob-imagens, atributos, órfãs, rede-ws. Ordem de retomada quando um dos 3 fechar: atributos (QUASE PRONTO, nada commitado: falta reescrever cobertura-atributos-colaboracao.spec.js:118 para a regra nova, trocar crases que não são símbolo na doc, vizinhos no Firefox, frontend inteiro + lint, commit único; backend 5700/5700 já verde) -> rede-ws -> órfãs -> cob-camadas -> cob-taticas (alça 0 + cópia velha da trajetória) -> cob-briefing -> cob-desenho -> cob-imagens. Retomar com: "Coordenador: retome do PRÓXIMO PASSO do seu relatório; confira git status da sua worktree primeiro."

Depois DESTA rodada: no máximo 3 subagentes simultâneos (code-reviewer conta). Frente que fecha não é substituída enquanto houver 3 ou mais vivos. CLAUDE.md ganhou "Como responder e delegar" (1b9a1e42).

- Órfãs pausado sem commit (HEAD 06f9569e): tudo na worktree peso; cria a migração 017_imagens_orfas.sql. CUIDADO na integração: se atributos ou rede-ws também criarem uma 017, renumerar a que entrar depois.

## Frentes novas

O DONO RECUSOU frentes novas por enquanto (24/09 ~10:00) e disse para NÃO mexer no main (só leitura por git show). Aprovou fazer: 2e (órfãs), atributos por chave, P3 (a) confirmado, e os itens pequenos: alça 0 da rota (cob-taticas, depois do conserto da cópia velha), presença em link lento e WS bloqueado (agente rede-ws).

## No final (pedido do dono)

Quando todas as frentes fecharem: re-medir e APERTAR o teto de peso (a fonte está com folga larga de propósito), `npm run lint` e `npm test` na raiz, e o Playwright INTEIRO (`npm run test:e2e:ui`), em fatias paralelas em worktrees separadas com portas e bancos próprios, relatando flaky e falhas; depois push.

## FOTOS 2b/2c/rede: RETIRADAS da integração (~09:50)

O code-reviewer achou 2 perdas críticas (op sai antes dos bytes: Sair com pendingOps 0 perde a foto para todos; descartar() depois de erro com intenção já no diário) e mais 5. hunt/integra voltou a 06f9569e (sem push das fotos). Agente de fotos recebeu os 7 itens; ao voltar, re-integrar 1ec827ae + 2b5b4386 + d58e37a3 + consertos, com teto de módulos 806 e fonte ~12080, portão inteiro, novo code-reviewer, e 8bbe5ceb/16521c76 rodados sobre hunt/fotos.

## Para o fim (docs, coordenador)

- Livro-razão (atributos): o pedido descrevia o modelo como "LWW por chegada, como no resto"; o código é base e revisão por caminho. Codificado em backend/tests/integration/atributos-por-chave.repro.test.js.

- Corrida de TESTE recorrente (desenho e B6.1): "Refazer: a cópia não saiu" em círculo, seta, limite, elipse e texto; o clique de refazer chega antes do desfazer terminar. Anterior às mudanças (5/36 no HEAD). Consertar a espera no helper antes do Playwright final.

- FLAKES DE CARGA recorrentes no vitest do frontend (passam sozinhos; investigar antes do Playwright final): tab-lock-refutacao 3.5 (3 vezes hoje), idb-decisao4-medicao (2 vezes), docs-integridade símbolos por tempo (2 vezes). Já consertados: censo de login (corrida com fixture temporária) e sonda do lock de push (pg_locks sem filtro de banco).

- No Playwright final, olhar 2 specs do Firefox em aberto sem classificação (agente navegadores): browser-collab-analise-desfazer:119 e envio-do-acervo-herdado:341.

- Livro-razão (cob-bloqueio): docs-integridade passou no ciclo do agente porque uma sonda NÃO RASTREADA da worktree continha o símbolo inexistente `activateLayer`; o portão da integração (árvore limpa) pegou. Verificação fantasma: o verificador mediu outra cópia do sujeito.

- Ponto de UX para o dono (cob-taticas): a alça 0 da rota fica exatamente no centro do símbolo militar, então pegar o símbolo ali move só a partida.
- Fila: 50190d23 (cob-taticas, arrastar símbolo leva a rota), 596a94dc (cob-importexport, mapa ilegível não bloqueia a cópia parcial .ebgeo), 05af618a (cob-importexport, feição dentro do tile do mosaico PDF por pixels), e do B6.1 os achados 2-5 do revisor: c364b122 (duas partes no mesmo push), 1f960de5 (derivada na origem), 12e98e79 (reparos em lote que param), 47338031 (frase parte 1 de 1). B6.1 segue para a tabela de escala nos navegadores. Do cob-imagens: 02fe5350 (slot resgatado nasce com o nome do atlas), 16521c76 e 8bbe5ceb (specs de cópia com bytes). O push das FOTOS também espera o agente de fotos rodar 8bbe5ceb + 16521c76 sobre hunt/fotos (guarda da 2b/2c), 3x sem retry.
- Lacuna de produto para o dono (não regressão, o main também): ícone embutido de KMZ (IconStyle -> files/*.png) chega como marcador padrão; o produto tem customIcons onde mapear.
- cob-importexport FECHOU (2ª rodada entregue, agente livre: a frente peso pode pegar uma frente nova).

- Livro-razão, propostas do cob-importexport: (a) guarda de completude satisfeita por fallback não guarda (codificada em kmz-viewshed-com-preenchimento.repro); (b) teste de conversor que alimenta linhas e pula o parser é subconjunto tratado como todo (csv-aspas-no-meio-do-campo.repro + e2e). Regras: MapLibre põe maplibregl-map no contêiner; regra de posição/tamanho nele precisa de seletor composto (2ª ocorrência, depois de calibracao.css).
- Decidido pelo coordenador (P3 do cob-bloqueio): camada ATIVA travada recusa a ferramenta de criação nomeando o estado, e recusa no commit; censo dos caminhos de criação.

## Decisões pendentes do dono

- DECIDIDO pelo dono (24/09 ~12:40): gesto em massa com update/delete de feições distintas sai como ops INDEPENDENTES (custo de conflito 1), gravação única do documento mantida; lote atômico só para compostos e criação. Agente B6.1 implementando depois do conserto do motivo falso; integrar 2ebba72b JUNTO com isso. Histórico: MEDIDO: 1000 restyles com 1 feição apagada pelo colega = 599 feições vivas SEM estilo no servidor (partes 1-2 aplicadas, parte 3 recusada inteira, 4-5 nunca enviadas); antes custava 1 feição. Ganho: local 16-41 s -> 0,5-1,7 s; servidor 7-12 s. RECOMENDAÇÃO ao dono: update/delete de feições distintas do gesto em massa saem como ops INDEPENDENTES (sem atomicidade de lote, custo 1), mantendo a gravação única do documento; lote atômico só para compostos e criação. Mudança em createBatchOperations (operation-factory.js).
- Motivo FALSO nas Pendências (vale já para as partes B6.1 integradas): a irmã de uma parte recusada mostra o motivo da culpada como seu. Agente B6.1 corrigindo agora em commit separado.
- Observações do bloqueio para o dono: a busca acha feição oculta e abre o painel dela; feição oculta conta nos limites da linha do tempo; excluir a camada ativa quando todas as outras estão travadas destrava uma delas.

- ACHADO (cob-imagens, 24/09): figura de slide mora INLINE no HTML do Quill. A 40 kbps, três palavras digitadas num slide com figura viraram 8 ops com o HTML inteiro (2,4 MB, ~8 min) e em 300 s o colega não tinha o texto. Mesma classe das fotos anexas: candidato a figura por referência (blob) depois que as fotos fecharem.

- (resolvida 24/09: atributos por chave, em obra no hunt/atributos)
