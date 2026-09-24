# GOAL: caça noturna de bugs até 2026-09-24 05:30

Pedido do dono (2026-09-23 21:40): procurar bugs incansavelmente e resolvê-los até 05:30, preparando o lançamento do `integracao_backend` no mesmo endereço https do `main` de produção. Preocupações: perda de dados na transição, em atlas remotos e locais, na troca entre atlas; sincronismo multiusuário com perda de conexão e conexão lenta; todas as ferramentas, briefings, processamentos, vários mapas, comentários, estilos, atributos, tabela de atributos; desempenho; navegadores. Suíte completa é lenta: não rodar toda hora.

## Organização

- Base: `integracao_backend` @ `5379fc3e` (igual ao origin).
- Uma worktree por frente em `C:\Users\diniz\ebgeo_hunt\<area>`, branch `hunt/<area>`; `integra` é a worktree de integração (branch `hunt/integra`), onde rodam lint + npm test da raiz.
- Regras comuns: `BRIEF-COMUM.md`. Relatórios: `relatorios/<area>.md`.
- Integração: revisão (code-reviewer) → cherry-pick em `hunt/integra` → verificação → fast-forward do `integracao_backend` na árvore principal. Sem push (não autorizado).
- Heartbeat cron 18bc8ed1 (:13 e :43); fase final cron 63125797 às 04:37.

## Frentes (agentes) e portas (APP/BACKEND/E2E)

| área | agentId | portas |
|---|---|---|
| migracao | aa3b3ed1a2fab23fd | 4331/3921/3931 |
| troca-atlas | a0d2beb4bf7671ba0 | 4332/3922/3932 |
| collab-ferramentas | a0c34b00d6cfa694d | 4333/3923/3933 |
| collab-briefing | a7a223b85e89cba81 | 4334/3924/3934 |
| rede | ae9155f8684bad169 | 4335/3925/3935 |
| desempenho | a046f8de4d287bdea | 4336/3926/3936 |
| navegadores | acf9472726270f13f | 4337/3927/3937 |
| backend-sync | a84a96cbffb45d51a | 4338/3928/3938 |
| producao | ae706ffca80e436ca | PADRÃO 4321/3912/3911 + HTTPS 44431 |
| peso | aad38a54b6835e086 | sem portas (só build + vitest) |
| integra (eu) | - | 4339/3929/3939, TEST_DB ebgeo_test_integra |

## Linha do tempo

- 21:41 início; 21:55 worktrees + npm ci (91 s); 22:05 oito agentes lançados.

## Linha de base (HEAD 5379fc3e, worktree integra)

- lint raiz verde. Frontend: 1 vermelho real, `teto-de-peso-da-pagina-do-mapa` (index.html 4191 kB > teto 4170; +71 kB desde 21/09) → frente `peso`. Esse vermelho corta o `&&` da raiz.
- Backend inteiro (c8) verde, mas levou 1309 s (22 min) sob a carga de 10 agentes. e2e de contrato 261/261 verde (106 s). Rodar a raiz completa no máximo 2 vezes mais.

## Decisões tomadas por mim esta noite (registrar em decisions-2026 na integração)

- B6.1 (lote > 200): proposta como último commit "PROPOSAL" do hunt/desempenho, NÃO integrar.
- LOS/viewshed processed_* derivados por cliente, nunca viajam (aprovado, collab-ferramentas).
- Queda involuntária de sessão: resgatar TODO atlas remoto com pendência (R), com fallback de retenção (aprovado, troca-atlas).
- Teto na cauda do pull (contagem ou bytes → retrato), com prova no cliente (aprovado, backend-sync).
- legacy_tab (aba do main aberta na virada): deixa de ser falha e vira ESPERA automática sem comando destrutivo; tela de duas saídas mantida para falha real (aprovado, migracao). PARA O DONO CONFIRMAR.

## Achados integrados (hunt/integra)

Lote 1 (cherry-pick 22:16, em revisão pelo code-reviewer aa868fc30aecb54b7):
- 440390ab (troca-atlas) visita pública anônima perguntava nada e esvaziava slot resgatado. Perda de dado.
- 4743188d (desempenho) fila lia chaves varrendo o banco inteiro (drain 8000 ops 75 s → 9 s; tique ocioso 40 ms → 0,3 ms).
- cb922c83 (backend-sync) clone/duplicação deixavam properties.layerId da ORIGEM: cópia abria com feições invisíveis.
- bc9c4a58 (backend-sync) 413 congelava a fila para sempre.
- Revisão lote 1 (22:35): 4743188d e 440390ab limpos. Ajustes pedidos: backend-sync (frase pt-BR do 413, isolamento pós-413, layerId no retrato p/ cópias antigas, comentário/regra do realinhamento); troca-atlas (asserção clearQueue no spec).

Lote 2 (cherry-pick 22:40, 12 commits, sem conflito; lint verde; frontend 15805 verde + 1 vermelho de ORÇAMENTO: fonte total do grafo 11743 > 11710 kB, crescimento dos próprios consertos → re-medir e subir no fim, commit próprio com atribuição). Revisão: 2A aa38790f434c01f5e (sessão/atlas/briefing/undo), 2B ab3e5830917f271fb (sync/perf/LOS).
- 13268a20 R: queda involuntária resgata filas de TODO atlas com pendência (perda de dado).
- b0a1b9d3 teste do clearQueue da visita pública.
- 43c1a7e3 503/timeout no /auth/me no boot varria a fila como se deslogado (perda de dado).
- d88a184d atlas enviado ao servidor não aparecia na lista.
- 2cec5083 editor de briefing aberto salvava cópia velha por cima do par (perda de dado).
- 1aeb1e6c desfazer revertia o que o par mudou depois (perda de dado).
- c7491fc5 prazo do push fixo impedia rede lenta de subir lote grande.
- 4786cd8f rajada de ops do par reconstruía toda fonte por op (congelamento).
- 22652177 marcadores REST fora do lock de log: ordem de versão ≠ ordem de commit (pull pode pular op).
- 0a803b36 resposta do sync_request chegava depois de op que ela não carrega.
- fa6706bf 413 parte ao meio e motivo pt-BR.
- 5378da27 LOS/viewshed derivados por cliente.

Lote 3 (22:55): 5b2c1acb (retrato deriva layerId da coluna: cura cópias antigas), c4392d42 (texto dos painéis de ponto saiu do boot, -8 kB), f256ac7a (modal de compartilhar recurso saiu do boot, -39 kB; falta prova no navegador → peso). Payload do mapa 4191 → 4145 kB (teto 4170 volta verde). Conflitos de contagem de módulos resolvidos à mão (796).
- peso retomado (portas 4341/3941/3951): prova do compartilhar + nova frente IMPORT/EXPORT de arquivos.

Revisão 2A (23:20): d88a184d, b0a1b9d3, 1aeb1e6c limpos. Ajustes pedidos: troca-atlas (marcador de origem na sessão adiada; outra conta herdando fila; resgate pula atlas montado por outra aba viva; veto vencido; cerca de descarte; frases; testes), collab-briefing (widget sem foco reintroduz cópia velha; aliases `_`; testes de store), collab-ferramentas (desfazer x processed_*).
Revisão 2B (23:35): 0a803b36 limpo; 5378da27 cumpre as condições. Ajustes: desempenho (4786cd8f: gate single-flight sem watchdog pode DESLIGAR o desenho remoto até F5 — alto), rede (pull com prazo fixo de 180 s não abre retrato grande em link lento), collab-ferramentas (edição de visada/viewshed NUNCA sincronizou: batchUpdateAnalysisFeatures sem recordOperation — alto; lista dupla; limpar recusas antigas), backend-sync (lock do duplicate segurado durante a cópia; frase do 413 afirma causa).
Integrado 3cd6b9bb (teto da cauda do pull: >500 ops ou >2 MiB → retrato).
Lote 4 (23:25, sem revisão ainda): 4baf7b46 (edição de visada sincroniza), 4f62f9bc (cortina do boot na migração), e27dc78d (Salvar no servidor do mapa diz o que foi podado), 7b7f0f27 (cursor durável só vale para o principal que o preparou), e370a6f6 (marcador de origem na sessão adiada), e1413de4 (envelope de briefing do par apagava edição de slide), 4362a336 (tolerância de heartbeat escalona em downlink lento), 77a16cb3 (prazo do pull conta silêncio), c3ba6ff0 (corpo do push serializado uma vez), 4551b0fa (frame de creates remotos numa escrita), bb8b6172 (Comentarista apagando comentário alheio era difundido), 7a499d2f (frase do 413), c4ce15b5 (export pendurava em fonte falha), e01a4fd9 (spec do compartilhar do catálogo), d67636e4 + 5386d0d0 (briefing campo com foco + testes), 1f7c15c6 (spec 413 real da frente rede; engine duplicado descartado).
Regra nova no BRIEF: agentes não sobem números do teto de peso (conflito recorrente); eu re-meço no fim. Resolver: C:\Users\diniz\ebgeo_hunt\resolve-count.cjs.
Lote 5 (23:45): 5d913a4c (vigia do gate de render), f41c0c76 (encoding Latin-1 no import), f6ee3e39 (ZIP com vários SHP), 9f399f7e (MEU: rajada de creates remotos pulava derivação da visada — interação entre frentes), a464e7e7 (polyfill toReversed shpjs, Chrome/Edge 105-109). Revisão 4A a700ebfdbb1241cba (sync/rede/collab), 4B a6761f4806b719ee8 (boot/migração/import/UI).
Rede 1º ciclo fechado; 2º ciclo: taxa de cursor (aprovado), prazo do uploadImage (aprovado), offline longo, Firefox. PARA O DONO: foto segura a fila (head-of-line), flush exige WS ONLINE (proxy que bloqueia upgrade para tudo).
Import: aprovado preservar nome/colunas reservadas (hoje somem em silêncio; main igual).
Lote 6 (00:00): e7ad38fa + 786d9909 (resgate poupa abas vivas; outra conta não herda fila), 06823141 (legacy_tab = espera), a50e6483 (notas do colega abriam painel em todos), 7b520625 (ajuste de mapa do par fazia a próxima edição ser recusada), 36d4e200 (teste), f80401a4 (import atômico com fotos anexas: parser 50 MB + frase do 413 sem "tente de novo").
Lote 7 (00:10): 195bcb14/ddbd2cd8/4728f3bd (backend authz), 13020fa7 (desfazer re-deriva visada), 01f93218 (cursor 5 Hz na origem), ceefb44e (upload de imagem pendurado segurava a fila para sempre), 5e638b79 (nome/colunas reservadas no import), 1b933812 (MEU: harness do cauda-longa com sessão antes do connect), 1836e55f (censo), 92969398 (cauda de reconexão pelo caminho em lote). df07a7d5 (producao, 3º 413) DESCARTADO.
Revisão 4B: CRÍTICO ba60513d (Quill convert roda matcher de colagem: rouba foco, apaga seleção, ciclo de salvamentos entre editores) → collab-briefing. Regressões de encoding (f41c0c76) e ZIP com .json (f6ee3e39) → peso. Export sem credencialDeTile (c14fa9d1) → producao. Marcador LOCAL antes do escopo (f45bc289) → troca-atlas. Toast atrás da cortina → navegadores.
Duplicar mapa em atlas remoto perde o conteúdo (cliente nunca usa a rota REST declarada) → decisão (a) usar a rota, collab-briefing.
Integra frontend: vermelhos restantes = teto de peso (re-medir) + tab-lock-refutacao 3.5 (flake de carga, verde isolado).
Lote 8 (00:20): c3ebab86, 95c7474e (limpa recusas antigas de saída de análise), 4c3ddbc3.
Revisão 4A: CRÍTICO b7c38108 (reparo do recibo apaga confirmedVersion do slide → 2ª edição do autor recusada, bloqueia lote; idem briefing/ordem) → collab-ferramentas (cópia de e1413de4). Laço de retrato sem compressão no WS lento (3cd6b9bb × f14f143e) → backend-sync. Recorte por nível (Leitor promovido não vê comentários antigos) → troca-atlas. Rodada superada do render reescreve dado velho (5d913a4c) → desempenho. Limpos: 5b2c1acb, e52411ed, 9f399f7e, 92316736, b92a1cd7, 6e77e3cf, c20e885d, 4baf7b46.
Lote 9 (00:10): e01e4fd9 (avisos esperam a cortina), 3b18db2a (briefing F5: beforeunload com pendência), c5623566 (marcador depois do escopo), c173d32c (nível no registro da geração + resync), 587b75e6 (confirmedVersion de slide/briefing no reparo e no par — CRÍTICO resolvido), bbcadba8 (rodada superada repinta; unwire limpa timers).
Verificação completa congelada em worktree `verifica` @ 6d16eaef (antes do lote 9 parcial): lint + build + frontend + backend + e2e, portas 4342/3942/3952 (bc2cv7mx9).
B6.1 AMPLIADO PARA O DONO: mover 250 feições para outra camada num atlas remoto = 250 pendências, 0 no Postgres, e o retrato desfaz o gesto local. Pedida tabela gesto→ops→desfecho e PROPOSAL estendida a UPDATE/DELETE independentes (não integrada).
Rollback para o main medido: abrir o main uma vez fazia a integração abrir um "Recuperado" falso; contenção simétrica aprovada (migracao).
8b761329 (export com credencial + prazo 30 s + aviso da camada que faltou). producao 2º ciclo: cobertura de bundle HTTPS sobre o estado integrado (branch hunt/producao2).
Lote 10 (00:20): 4f1ff6c1 + b99b1ccb (harnesses com build REAL do main, opt-in), 74b426af (WS recusado não manda "verifique a conexão"), 9f130bfa (teste offline longo com token vencido + aba reaberta com fila), 65d46eb5 (WS: cauda acima do teto pede resync HTTP, nunca retrato), 5ad51453 (UTF-8 válido vence cabeçalho XML velho; byte quebrado não vira o arquivo), cad67b75 (KMZ ida e volta campo a campo; KML de terceiro sem lixo de estilo), c3521079 (numeração Ponto #N única no ZIP), 74a43b82 (teste import em atlas de servidor chega ao colega), c4fb7232 (ZIP lido camada a camada; import parcial diz o que entrou; conflito resolvido à mão: vendor shpjs + proj4), 56436051 (clique duplo no Compartilhar).
verifica @6d16eaef: lint verde, build ok, frontend: só teto de peso (a e b, esperado: index 4170 e admin 830 estourados pelos consertos) + docs-integridade por TIMEOUT de carga (30 s). Backend/e2e rodando.
Lote 11 (00:30): de2b268b (rollback: abrir o main não é alteração), dc301e32 (polígono importado perdia buracos ao colar/arrastar/editar). peso 3º ciclo: matriz de papéis na interface.
PARA O DONO (import/export): "Simular linhas tracejadas" (padrão ligado) corta a linha no KMZ e a reimportação vira dezenas de feições; estilo de KML de terceiros não é aplicado (proposta: mapear stroke/fill); observations/símbolo militar/texto não fazem ida e volta no KMZ.
migracao 1º ciclo FECHADO (relatório final em relatorios/migracao.md, parágrafos de decisão D-a espera e D-b rollback). Medido sem defeito: perfil rico main→integração campo a campo (Chromium e Firefox), migração interrompida 6x, localStorage sem colisão, rollback ida e volta. 2º ciclo: ciclo de vida do atlas de servidor com colegas dentro.
Lote 12 (00:45): 6babec5a (Salvar do painel da visada desfazia edição do par), 046c764e ("Descartar" em qualquer painel desfazia edição do colega), dcf6f0cb (CRÍTICO Quill resolvido: replaceQuillContentSilently), 8aa44f33 (lista com marcadores voltava numerada). collab-briefing 1º ciclo fechado; 2º ciclo: duplicar mapa (a), comentários, engrenagem temporal, width/height no sanitize.
00:50→02:00 TODOS os agentes pararam por LIMITE DE SESSÃO DA API (reset 02:00). Retomados às 02:15 só 5 (backend-sync permissões, collab-briefing duplicar mapa, producao bundle integrado, peso matriz de papéis, rede ferramenta de imagem), prazo 03:45, para não estourar de novo antes da fase final. Pausados: troca-atlas, desempenho (tabela B6.1), navegadores (colab mista), collab-ferramentas, migracao (ciclo de vida do atlas).
Verificação completa @6d16eaef: lint verde, build ok, e2e 261/261, frontend só teto de peso + timeouts de carga, backend 1 vermelho = cross-cutting-gaps afirmava o defeito do link público (corrigido 86fde147), cobertura 98,36% (piso ok).
Lote 13 (02:30): 24a73eb1 (Duplicar mapa em atlas remoto via rota REST; 2/2 verde na integração), 744effb1 (spec cauda longa a 40 kbps converge). backend-sync FECHADO (relatório final). troca-atlas retomado (F5 em debounces).
Lote 14 (02:45): 5184eaf1 + 64c3568e (matriz de papéis: Novo mapa por posto; Importar recusa no clique), 059c7d6f + 12abab25 (figura aparece na hora em link lento; subida atrás da op retida). rede e peso FECHADOS. Docs: 18373fd7 (decisions: 8 entradas), 9ee0b30d (livro-razão: 5 linhas).
Revisão final A a0a9314634f39bb22 e B a88bbb963b1444087 (prazo 03:45). Ativos: producao, collab-briefing (comentários), troca-atlas (F5 debounces), desempenho (tabela B6.1), migracao (ciclo de vida do atlas).
PARA O DONO (rede): presença a 5 Hz ainda ocupa 74% de 40 kbps com 3 colegas (adaptativo por connection-quality ou teto por destinatário); WS bloqueado por proxy = atlas não abre (tela agora diz a verdade); edições depois de uma foto esperam a subida dela.
desempenho FECHADO (02:48). PROPOSAL B6.1 estendida = b0cc9f86 no hunt/desempenho (NÃO integrado). Tabela para o dono: import/colar/processar >200, mover >200 para outra camada, desfazer exclusão >200, desfazer estilo em massa >200 → 0 no Postgres, pendências, e o retrato DESFAZ o gesto na tela; com a proposta chegam (lotes 200+100). Transferir camada com >200 continua atômico e falha com toast FALSO de espaço em disco (peso investigando a frase). Seleção+excluir e estilo em massa (1 transação por feição) chegam. Tabela de atributos não passa de 200 por transação.
Lote 15 (02:50): ba59171d, 12111bce (captura com credencial), 768213fe (admin recusa http:// em página https).
Lote 16 (03:05): 9370c36a (trabalho do colega sobrevive ao atlas ir para a lixeira / acesso revogado), eca7c15f + a3128b04 (MEUS: Novo mapa/Duplicar/Renomear com nome de OUTRO mapa sobrescrevia o mapa no atlas local — achado da revisão final, fora dos commits da noite), c2ad35cc (MEU: laço infinito de redesenho quando a imagem falha devagar, regressão de bbcadba8).
Revisão final A/B: pendentes com autores até 03:45 — rede (single-flight da fila de blob, figura com save recusado), troca-atlas (página sem mapa adota atlas vivo da aba do mapa; aviso de 24 h mente; veto x troca de conta), migracao (mapa criado sem feição mas com notas editadas no rollback).
PARA O DONO: duplicateMap no servidor lê a origem sem retrato estável (feição órfã/filiação perdida se um par edita a origem durante a cópia) — trade-off com segurar o lock do log durante a cópia; revogação de link público só vale para visitante sem conta (conta viva lê atlas público pelo UUID, desenho); enablePublicSharing redundante derruba visitantes vivos; Duplicar custa 2 retratos ao autor; cópia não avisa edições não enviadas.
34db15d1 (transferência: "Verifique o espaço disponível" era falso; frase diz o que se sabe). peso FECHADO. PARA O DONO: contagem curta no destino da transferência em atlas remoto desfaz só local, as intenções já gravadas sobem e o servidor aplica o mover (divergência até o próximo retrato).
Lote 17 (03:10): 3 de comentários (edição reabria resolvido; rascunho some com thread excluída; cobertura Comentarista), f0f61e85 + 4fe2694f (página sem mapa não adota atlas vivo; prazo real na URL; veto x troca de conta; painel de feição pede confirmação com edição não salva e desmontagem foi para pagehide), 0f9a6321 (servidor de ensaio HTTPS), 67aad842 + 90b70a6c + 74c47aa6 (nome do resgate; contenção exige campos de fábrica; lixeira com B offline), abc2f24b (tetos de peso re-medidos uma vez: 801 módulos, fonte 11897, index 4183→teto 4230, admin 844→870).
VERIFICAÇÃO FINAL em worktree `verifica2` @abc2f24b (b2o33k84z) + 93 casos Playwright dos 53 specs novos/alterados (bxrq0mqut, portas 4343/3943).
PARA O DONO: rebaixado com pendência: selo "Enviando 1…" para sempre (403 a cada envio; toast diz a verdade). Tabela de atributos: valor digitado sem Enter se perde no F5 (patch sem prova em scratchpad).
7d07937c (fila de blob: uma transferência por id; save recusado descarta o envio). Todas as frentes fecharam às 03:12. Último ciclo (prazo 04:30): collab-briefing (engrenagem temporal, sanitize width/height), collab-ferramentas (estilo/atributos/tabela concorrentes), troca-atlas (tabela no F5, selo do rebaixado).
PLANO REVISTO: verifica2 verde → ff do integracao_backend até abc2f24b+ (~04:00) + relatório; commits do último ciclo integrados até 04:40 com lint + frontend + specs pontuais (+ backend se tocado) → segundo ff ~05:15.
VERIFICAÇÃO FINAL (03:40): verifica2 @abc2f24b: lint verde, build ok, e2e 261/261, backend 5685/5686 (1 teste afirmava o nome antigo da rota de duplicação → ba628f7e), cobertura 98,36%, frontend 4 vermelhos de integração → 8dab735b; Playwright dos 53 specs novos/alterados 93/93 sem retry (31,8 min). HEAD final 0b34457d: build ok, lint verde, frontend 16047/16047, e2e 261/261, specs tardios em curso.
Último ciclo integrado (03:15-03:40): 576b6d2a, eb03307a (engrenagem temporal cópia velha), dc4c3b5a (link no slide levava a aba embora), 41bcbec1 (tabela: sair com célula em edição pede confirmação), b73315d0 (selo do rebaixado), 3cc9694e (cortar linha/combinar setas = um lote), 30380266 (atributo lido sob a trava), 106ea091 (renomear atributo leva valor guardado), 0b34457d (estilo de camada de catálogo grava só o que mudou).
Ciclo extra até 04:50: collab-ferramentas (processamento/símbolos/trajetória), navegadores (Firefox dos specs da noite), desempenho (atlas grande, tabela 10k; proposta B6.1 guardada em hunt/desempenho-proposta).
03:47 integracao_backend LOCAL fast-forward para 0b34457d (126 commits, sem push). Relatório: RELATORIO-FINAL.md.
Ciclo extra integrado: bcaca0df (seleção por caixa mandava 1 quadro de presença por feição: 4000 → 782 MB), efe9da35 + 9ada8c04 (trajetória: edição devolvia keypoint removido pelo colega). Verificado em 9ada8c04: build, lint, frontend 16049/16049, 11 casos de navegador. Revisor final a2886f4064efabb50 até 04:45; navegadores (Firefox) até 04:50 (já tem 2 commits de teste).
PLANO FINAL: 03:45 agentes relatam; 03:45-04:15 integrar, livro-razão, decisions-2026, re-medir teto de peso com build; 04:15 verificação completa congelada (~40 min); ~05:00 ff do integracao_backend se verde; 05:15 relatório.
Docs aplicadas: b6d57ae3 (wiki 413/pull, CONSTITUICAO 5.4).
PARA O DONO (migração): a origem legada NUNCA sai do disco (sem botão desde 22/09): todo migrado guarda o acervo em dobro (cota); a wiki ainda cita o botão. Menores: mapBadgeColors e trava de mapa não sobem no envio; aba antiga abrindo o tutorial pede docs/doc.html (404).
PARA O DONO (deploy): sourcemaps .map são publicados (sourcemap:'hidden' só omite o comentário; deploy.sh publica dist/ inteiro; main igual); catálogo semeado traz 4 fontes http://localhost/tiles/... (checklist de implantação); nginx client_max_body_size precisa ser >= 10 MB para /sync e >= 50 MB para /atlas/imports, e o 413 dele é HTML.
RISCO ESTRUTURAL PARA O DONO: fotos anexas às feições são data URL DENTRO da feição (main e integração). Toda edição da feição reenvia as fotos inteiras; acima de 10 MB por op a edição vira problema durável e nunca sincroniza; em link lento, MB por clique. Mitigação possível (decisão): comprimir/reduzir mais as fotos ao anexar, ou migrar para blob+id como a feição de imagem. nginx de produção: client_max_body_size desconhecido (fora do repo) pode recusar o import de 50 MB.
Firefox: F5 < 1,5 s depois de digitar no briefing perdia o texto → confirmação de saída (padrão warnBeforeUnload) aprovada.
RISCO PARA O DONO: resgate no boot deslogado transforma retrato de servidor com pendência em atlas local legível sem login (sem poda de privados), política já existente para o atlas montado, agora estendida.

## Pendências de DOC para eu aplicar na integração

- 413 em PERMANENT_PUSH_REJECTIONS: fila-operacoes-outbound:40, modelo-conflito-lww:42 e :115, lote-logico-de-gesto:47, sintese-contrato-erros-http:84, ack-idempotencia:57 (esperar forma final do backend-sync).
- livro-razao: uma linha por conserto (colher dos relatórios).
- decisions-2026: LOS/viewshed derivado; resgate R na queda involuntária; B6.1 proposta.

## FASE 2 (manhã de 24/09): pedidos do dono depois do relatório

- 05:00 push autorizado e feito: origin/integracao_backend = b07cf79a (140 commits). Depois: c777d8c5 (4 decisões confirmadas), local.
- Pedidos: (1) B6.1 proposta aprovada → agente desempenho porta para hunt/b61; (2) fotos: compressão rápida + estrutural (desenho primeiro, aprovar) → agente rede, hunt/fotos; (3) decisões confirmadas (feito); (4) documento do nginx para o engenheiro: Downloads\nginx-srv-arquivos-ebgeo-envio-2026-09-24.txt (feito, sondas conferidas contra o backend real); (5) navegador mínimo registrado.
- Campanha de COBERTURA completa (regras no fim do BRIEF-COMUM.md), branches hunt/cob-*: desenho (collab-ferramentas a0c34b00d6cfa694d), taticas (producao ae706ffca80e436ca), importexport (peso aad38a54b6835e086), briefing+processamento (collab-briefing a7a223b85e89cba81), camadas/atributos/tabela/mapas (troca-atlas a0d2beb4bf7671ba0).
- NO FINAL: teto de peso re-medido, lint + npm test da raiz, e Playwright INTEIRO (pedido do dono).
- B6.1 AMPLIADO pelo dono (crítico): NENHUM gesto pode deixar de chegar por tamanho, inclusive compostos (transferir camada, grupo >200 membros, converter), com blocos dependentes que só saem após ack do anterior; prova em escala (importar 5000, colar/duplicar 1000, mover 1000, mover/copiar camada de 1000, excluir 1000 + desfazer, estilo 1000 + desfazer, agrupar 500).
- IMAGENS sempre dão certo (dono): frente nova cob-imagens (migracao aa3b3ed1a2fab23fd) com matriz das duas formas (ferramenta de imagem e fotos anexas) em todos os caminhos, mais figuras de briefing; o agente rede faz compressão + desenho estrutural das fotos cobrindo todos os caminhos.
- Dono preocupado com atributos, tabela de atributos, visibilidade e bloqueio: frente nova cob-bloqueio (backend-sync a84a96cbffb45d51a; feição/camada/grupo/mapa travado em TODO caminho de escrita, e visibilidade compartilhada vs da pessoa em seleção, tabela, busca, exportações, legenda, 3D/360, temporal); cob-camadas (troca-atlas) passa a priorizar atributos e tabela a fundo.

- 07:55 lote 27e9f1f4 (16 commits) com portão da raiz verde e push; 07:55 lote 0fc5196d (10 commits: tabela somente leitura, grupo oculto pelo filtro, régua, KMZ de viewshed e coordenação, specs) com lint e frontend verdes e push; 07:58 94371300 (+2 specs: ciclo das 13 ferramentas, janela temporal) e push.
- ~08:30 push f957771f: B6.1 compostos + cópia que espera a figura + spec de figuras. Portão: lint, frontend (só o teto de módulos, re-medido para 805), e2e de contrato 265/265; code-reviewer achou 5 pontos no B6.1 (nenhum de bloqueio eterno; o pior é "Aceitar o servidor" soltar o resto de uma parte recusada), devolvidos ao agente. Push rejeitado uma vez por 2e29bccb de outra sessão (regras de agente por caminho): rebase, docs-integridade e teto das instruções verdes, push.
- ~08:45 push 1db55b2e (+12). cob-importexport devolveu balanço (5 fixes, 12 specs) e foi retomado nas lacunas 1-4. P3 do cob-bloqueio decidido: (a) recusar criação em camada ativa travada.
- ~09:05 push 06f9569e (+5). Fotos 2b+2c+rede integradas juntas, portão da raiz e revisor rodando. Agente de fotos: desenho da 2e (sem código, decisão do dono) e transição main->integração com fotos inline.
- ~09:50 FOTOS 2b/2c/rede retiradas da integração antes do push: code-reviewer achou 2 perdas críticas (op sai antes dos bytes; descartar depois de erro com intenção no diário) + 5; devolvidas ao agente. ~09:55 lote de 10 não-foto em verificação.
- ~10:10 push 03baaeba (+10). Dono: sem frentes novas; main intocado; aprovou 2e (órfãs -> agente peso), atributos por chave (agente navegadores), P3 (a), alça 0 da rota (cob-taticas), presença em link lento + WS bloqueado (agente novo rede-ws, worktree criada com npm ci).
- ~11:00 dono pediu pausa (limite de API): 8 agentes pausados num ponto limpo, 3 ativos (fotos, B6.1, bloqueio); retomada de 3 em 3 na ordem do RETOMADA.
- ~12:55 push 186a089a (duas travas). Fotos seguradas outra vez: 2º revisor achou 2 perdas (conversão recusada; Salvar como local/resgate sem baixar fotos) + 6 menores; agente de fotos retomado. Estado em hunt/integra-fotos.
- ~10:55 push 14a32949 (P5, visibilidade nas saídas). PAUSA TOTAL até 12h10 pedida pelo dono: fotos, B6.1 e bloqueio pausados; heartbeat cancelado; retomada agendada para 12h12.
- 12:12 fim da pausa: retomados fotos, B6.1 (lote local em massa), atributos por chave; heartbeat 18074d49.
- ~12:40 dono aprovou: gesto em massa de feições distintas em ops independentes (custo 1 por conflito), lote atômico só para compostos e criação. Fotos: item 2 (d1e08a26, Salvar como local/resgate baixam fotos) feito.
- ~13:20 push 9d5c62f8: atributos convergem por chave (portão inteiro verde, revisor sem grave).
- ~14:10 push 8dfaa6c1: seguimentos de atributos + conserto do shebang (a política nova da outra sessão não carregava em CRLF). Presença em link lento (rede-ws T1) no portão.
- ~14:20 CAMPANHA ENCERRADA pelo dono (sem limite): agentes parados, heartbeat cancelado, PENDENCIAS-LANCAMENTO.md escrito na raiz (21b2f11b).
