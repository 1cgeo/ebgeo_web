# Caça noturna de bugs: relatório (23/09 21:40 a 24/09 05:30)

Objetivo: preparar o lançamento do `integracao_backend` no mesmo endereço https do `main` de produção, procurando e corrigindo bugs de perda de dado, troca de atlas, sincronismo multiusuário (inclusive rede lenta e queda), ferramentas/briefings/processamentos/mapas/comentários/estilos/atributos/tabela, desempenho e navegadores.

## Números

- **139 commits** integrados sobre `5379fc3e`: 100 `fix`, 10 `perf`, 25 `test`, 3 `docs`, 1 `refactor` (a maior parte do volume são testes e comentários de porquê).
- 11 frentes de caça em worktrees isoladas (`C:\Users\diniz\ebgeo_hunt\<frente>`), cada conserto com repro que reprovava antes, controle negativo e commit próprio; 9 rodadas de revisão arquitetural independente, que acharam defeitos reais em quase todo lote (todos devolvidos e consertados, ou listados abaixo).
- Nada foi publicado: **sem push**. O resultado está no branch local `integracao_backend` (ver "Estado do branch" no fim).

## O que foi corrigido, por preocupação

### 1. Transição do main para a integração (medido com o build REAL do main na mesma origem)
- **Aba do main aberta durante a virada** (o caso mais comum): a aba nova parava na tela de recuperação cujo único comando além de baixar era "Continuar", que APAGA os dados. Virou espera sem comando, que retoma sozinha quando a janela antiga fecha (Chromium e Firefox, 3 a 5 s). *Decisão para confirmar.*
- **Rollback para o main**: só abrir o main criava um "Recuperado" falso que abria no lugar do atlas de trabalho. Contenção simétrica; exclusões e edições reais no main continuam contando. *Decisão para confirmar.*
- Acervo herdado com **fotos anexas** nunca subia ao servidor (413 sempre, frase mandando repetir).
- "Salvar no servidor" do mapa dizia sucesso sobre o que o servidor podou; atlas enviado não aparecia na lista.
- Cortina do boot: o mapa ficava exposto e clicável no meio da migração; avisos do portão ficavam escondidos atrás da cortina.
- Medido SEM defeito: perfil rico do main chegando campo a campo (Chromium e Firefox), migração interrompida 6 vezes sem perda nem duplicação, localStorage sem colisão, ida e volta main ↔ integração.

### 2. Atlas locais e remotos, e a troca entre eles
- **Sessão que cai sem gesto** (inatividade, renovação recusada) destruía em silêncio a fila de todo atlas não montado: agora resgata TODO atlas com pendência como atlas local. *Decisão para confirmar.*
- **503/timeout no /auth/me do boot** varria a fila como se fosse logout; o estado adiado mostrava atlas local como "Servidor" e travado; outra conta que entrasse depois herdava a fila da primeira (subia com o token da segunda).
- Resgate não adota mais atlas que outra aba viva está usando (inclusive página sem mapa adotando o atlas da aba do mapa).
- Visita pública anônima esvaziava o slot resgatado sem perguntar.
- Cursor durável valia para outro principal/nível (Leitor promovido não via comentários antigos).
- **Colega perdia trabalho não enviado** quando o dono mandava o atlas para a lixeira ou revogava o acesso (4003 tratado como queda de rede, "reconectando" para sempre).
- **"Duplicar" mapa em atlas de servidor** gerava cópia VAZIA depois do F5: agora usa a rota de duplicação do servidor.
- **Novo mapa / Duplicar / Renomear com o nome de outro mapa sobrescrevia aquele mapa** num atlas local (inclusive no celular). Pré-existente, achado pela revisão final.
- Clone de atlas e duplicação de mapa deixavam `layerId` da origem (feições invisíveis na cópia); o retrato agora cura as cópias antigas.

### 3. Sincronismo entre vários usuários
- **Linha de Visada e Viewshed nunca sincronizaram** em atlas de servidor (a saída era recusada, o par não via, o autor perdia no F5; e editar a visada nunca subia). A saída passou a ser derivada em cada cliente. *Decisão para confirmar.*
- **Desfazer (Ctrl+Z)** revertia o que o colega mudou depois.
- **Editor de briefing** aberto salvava cópia velha por cima do colega; o envelope do par apagava edição de slide; a atualização do colega passava pela colagem do Quill (roubava foco, apagava seleção, ciclo de salvamentos entre editores); a 2ª edição do próprio autor era recusada por versão confirmada perdida; listas com marcadores voltavam numeradas; F5 no Firefox perdia texto recém-digitado.
- **"Descartar" em qualquer um dos 18 painéis** e o "Salvar" do painel da visada desfaziam a edição do colega.
- **Comentários**: editar texto reabria a conversa que o colega resolveu (e a resolução com texto velho era recusada); o rascunho de resposta sumia quando o colega excluía a conversa; Comentarista conseguia apagar comentário alheio (difundido e sumindo dos pares).
- Notas de mapa do colega abriam o painel na tela de todos; ajuste de mapa recebido do par fazia a próxima edição ser recusada.
- Servidor: marcadores REST fora do lock do log (op pulada no pull), resposta do sync_request depois de op mais nova, conta desativada escrevendo até a varredura, token de link público vazado revivendo na republicação, rajada de creates remota pulando a derivação.

### 4. Conexão lenta e perda de conexão (medido a 40 kbps)
- Push com prazo fixo de 30 s: lote grande nunca subia; pull com prazo fixo de 180 s: atlas grande nunca abria. Agora o prazo conta silêncio / tamanho.
- Heartbeat do WebSocket entrava em laço de reconexão com quadro grande; cauda longa pelo socket virava laço (agora pede ressincronização por HTTP, que tem compressão).
- **413** congelava a fila para sempre culpando a rede: agora parte o lote e guarda o que não cabe com frase certa.
- Upload de imagem pendurado segurava a fila inteira para sempre; a figura só aparecia 38,7 s depois do clique (agora 0,5 s); uma transferência por figura; save recusado não sobe bytes.
- Cursor de presença limitado a 5 Hz (68% → 50% do link com 2 colegas).
- Medido sem defeito: token vencido em offline longo, aba reaberta com fila cheia, 502 intermitente em 30% dos pedidos.

### 4b. Último ciclo (03:40 a 04:30)
- Trajetória: editar keypoints no painel ou no mapa devolvia um ponto que o colega removeu; dois gestos rápidos no mapa duplicavam keypoint (regressão da própria noite, achada pela revisão final e consertada).
- Engrenagem temporal desfazia a config que o colega salvou com ela aberta; Enter duplo salvava duas vezes.
- Cortar linha/limite e combinar/separar setas viraram um lote atômico no servidor (antes: original e metades sobrepostos quando o colega editava).
- Escrita de atributo lida sob a trava; renomear atributo customizado leva o valor guardado; estilo de camada de catálogo grava só o que mudou e não devolve a cor antiga depois.
- Link em slide de briefing abre em aba nova e sempre com noopener (a primeira versão do conserto abria tabnabbing reverso; a revisão final pegou).
- Selo de quem foi rebaixado a Leitor com pendência dizia "Enviando" para sempre; célula da tabela em edição ao sair da página agora pede confirmação; célula numérica aberta e não mudada não é mais regravada como texto.
- Seleção por caixa de milhares de feições mandava um quadro de presença por feição (4000 feições: 782 MB na sala).

### 5. Importar / exportar
- CSV/DBF/KML/GPX em Windows-1252/ISO-8859-1 perdiam todo acento; ZIP com vários shapefiles importava só o primeiro; nome da feição e colunas NOME/ID/TYPE sumiam; ida e volta do nosso KMZ trazia "[object Object]" e atributos-lixo; polígono importado perdia os buracos ao colar/arrastar/editar; shapefile no Chrome/Edge 105-109 falhava.
- Exportação PDF/Garmin travava para sempre numa fonte com falha, e o mapa de exportação/captura não levava a credencial (camada privada sumia calada).

### 6. Desempenho
- Fila de saída varria o banco inteiro (drenar 8000 ops: 75 s → 9 s); rajada de 500 criações remotas num mapa de 5000: 109 s → 2,4 s; redesenho remoto por op (161-220 → 45-52 reconstruções), com vigia e sem laço.
- Dois imports estáticos traziam para o boot do mapa código carregado sob demanda (−47 kB).

### 7. Navegadores e bundle de produção https
- Firefox: 48/48 críticos fora da matriz; colaboração mista (dono no Chromium, editor no Firefox) verde em cursores, presença, edição concorrente e offline, imagem, símbolo, painel, tabela, comentário e briefing; os specs criados na noite rodados no Firefox: 66 de 71 verdes no 1º lote (2 limites do instrumento consertados, 3 pulados por desenho) e 33 de 35 no 2º lote; no total 106 casos, 99 verdes, 3 pulados por desenho, 2 limites do instrumento consertados e **2 vermelhos NÃO classificados a conferir**: `browser-collab-analise-desfazer.repro.spec.js` ("o arraste de B não mudou a visada": gesto de arraste do Playwright no canvas do Firefox ou defeito real) e `envio-do-acervo-herdado.spec.js` caso dos 14 mapas e 805 feições (o item "Enviar ao servidor" não apareceu em 10 s; provável espera de sessão do instrumento no Firefox). Nenhum defeito de produto confirmado no Firefox. F5 do briefing, do painel de feição e da tabela agora pedem confirmação com edição pendente.
- Bundle de produção em https (as 5 páginas, ferramentas, wss, PDF, 3D, 360, 413 HTML atrás de limite tipo NGINX): nenhuma regressão só do bundle no estado integrado. Admin passou a recusar URL `http://` que a página https bloquearia.

## Decisões pendentes do dono (a noite deixou prontas, não integradas ou para confirmar)

1. **B6.1, lote acima de 200 operações** — o maior risco de lançamento que sobrou. Em atlas de servidor, importar/colar/processar mais de 200 feições, mover mais de 200 para outra camada e desfazer exclusão/estilo em massa de mais de 200 **não chegam ao servidor**: ficam pendentes e o retrato seguinte DESFAZ o gesto na tela. Proposta pronta e provada (parte em blocos de ≤200 só gestos do mesmo verbo sobre feições independentes; compostos continuam atômicos): commit `b0cc9f86` no `hunt/desempenho`, **não integrado**. Tabela completa em `relatorios/desempenho.md`.
2. **Fotos anexas às feições ficam como data URL dentro da feição** (main e integração): toda edição reenvia as fotos; acima de 10 MB por feição a edição nunca sincroniza. Opções: comprimir mais ao anexar, ou migrar para blob + id.
3. Confirmar as decisões desta noite marcadas "para o dono confirmar" em `docs/decisions/decisions-2026.md` (saída de análise derivada, resgate de todo atlas, espera da janela antiga, contenção do rollback).
4. **Implantação**: `client_max_body_size` do nginx ≥ 10 MB para `/sync` e ≥ 50 MB para `/atlas/imports`; sourcemaps `.map` são publicados (o `hidden` não esconde); catálogo semeado traz 4 fontes `http://localhost/tiles/...`.
5. Política de navegador mínimo (proposta: Chrome/Edge 109, Firefox ESR 115).
6. Presença ainda ocupa ~74% de 40 kbps com 3 colegas (adaptativo ou teto por destinatário); proxy que bloqueie WebSocket impede abrir atlas de servidor (a tela agora diz a verdade); edições depois de uma foto esperam a subida dela.
7. Menores: origem legada nunca sai do disco (acervo em dobro); selo "Enviando 1…" para sempre para quem foi rebaixado com pendência; valor da tabela de atributos digitado sem Enter perdido no F5; estilo de KML de terceiros não aplicado; "Simular linhas tracejadas" explode o KMZ; duplicação no servidor sem retrato estável da origem; revogação de link público só vale para visitante sem conta; resgate no boot deslogado deixa retrato de servidor legível sem login.

8. Medidos e não corrigidos nesta noite (baixa gravidade ou desenho): seleção por caixa superlinear acima de ~2000 feições (4000 em 4,3 s; 500 em 0,2 s); tabela de atributos sem virtualização (5000 linhas, ~100 mil nós, 0,6 a 1,2 s); a aba Atributos não redesenha com edição remota (mostra valor velho até reabrir, sem perda desde esta noite); "Sair" com célula da tabela em edição grava em 3 de 5 no Chromium (o "Ficar" grava sempre); `frontend/src/js/features_tab/index.js` e `backend/src/modules/models3d/models3d.scene.js` têm caractere NUL e o git os trata como binário (sem diff), pré-existente; colunas `lng`/`lat` de comentário ficam velhas no servidor (o retrato lê do `data`); suspeitas não fechadas: viewshed do par lido vazio uma vez em 6 depois de F5 nos dois, e a primeira mudança de altura do observador às vezes não recalcula.

## Verificação

**Portão final da raiz no estado entregue (`e380d401`, 04:51), comandos separados:** `npm run lint` verde; `npm test` verde nas três pernas: frontend 16058/16058, backend 5686/5686 com cobertura de 98,36% (acima do piso), e2e de contrato 261/261.

Rodada congelada completa (worktree própria, estado de 03:08, sem retry): lint verde; build ok; e2e de contrato 261/261; backend 5685/5686 com cobertura 98,36% (acima do piso); frontend com 4 vermelhos de INTEGRAÇÃO entre frentes, todos consertados; os 53 specs de navegador criados ou alterados na noite, 93/93 no Chromium. HEAD de 03:47 (0b34457d): build ok, lint verde, frontend 16047/16047, e2e 261/261, 20 casos de navegador dos specs que entraram depois do congelamento verdes. HEAD final (516fcd3e, 04:34): build ok, lint verde, frontend 16058/16058, e2e 261/261, e os 12 casos de navegador dos specs do último ciclo verdes; e o único vermelho de backend (teste que afirmava o nome antigo da rota de duplicação) ajustado e verde isolado.

Não rodado: a suíte inteira do Playwright (cerca de 480 casos) e a matriz inteira do Firefox; a camada de tablet.

## Estado do branch

`integracao_backend` LOCAL avançado por fast-forward para `0b34457d` às 03:47 de novo para `516fcd3e` às 04:34 e, por fim, para `e380d401` às 04:51, 139 commits à frente de `origin/integracao_backend`. **Nada foi enviado ao GitHub** (push não autorizado): revise e dê push quando quiser. A proposta B6.1 está fora dele, no branch `hunt/desempenho-proposta` (commit `b0cc9f86`). Os branches `hunt/*` e as worktrees em `C:SERSDINIZEBGEO_HUNT` podem ser apagados depois (cuidado: remova com `git worktree remove` só depois de conferir que não há junção de node_modules; nesta noite todos foram instalados com npm ci, sem junção).

Arquivos: `C:\Users\diniz\ebgeo_hunt\GOAL.md` (diário da noite), `relatorios\<frente>.md` (relatório de cada frente, com livro-razão e docs propostos), `hunt/integra` (branch de integração).
