# Relatório: troca-atlas (caça noturna 2026-09-23/24)

Worktree `C:\Users\diniz\ebgeo_hunt\troca-atlas`, branch `hunt/troca-atlas`.
Portas: app 4332, backend 3922, e2e 3932; bancos `ebgeo_e2e_troca`, `ebgeo_test_troca`.

## Commits (ordem do branch)

| SHA | o quê |
|---|---|
| `24f31026` | bug 1: a visita pública anônima pergunta antes de esvaziar um atlas resgatado |
| `77ccfb56` | bug 2: a saída involuntária resgata as filas dos atlas que a aba deixou (proposta R) |
| `6bf507e1` | teste pedido na revisão do bug 1 (`clearQueue: Boolean(rescued)`) |
| `08045432` | bug 3: sessão não verificada (5xx/timeout no `/auth/me`) não é varrida como deslogada |
| `7b7f0f27` | bug 4: o cursor durável só vale para o principal para quem a geração foi encenada |
| `e370a6f6` | revisão, item 1: boot adiado alinha o marcador de origem (substituído em parte por `c5623566`) |
| `e7ad38fa` | revisão, itens 4 a 9: o resgate poupa aba viva, cerca e veto vencido, e `?outros=` viaja separado |
| `786d9909` | revisão, item 2: outra conta entrando depois da sessão adiada encerra a sessão da anterior |
| `3b18db2a` | bug 5: briefing com edição pendente pede confirmação de saída (Firefox perdia o texto no F5) |
| `c5623566` | revisão 4B: o boot adiado alinha o marcador só DEPOIS de montar o escopo (não adota retrato legado) |
| `c173d32c` | revisão 4A: o cursor durável carrega também o NÍVEL por atlas do recorte |
| `4fe2694f` | bug 6: edição do painel de feição some em silêncio no F5; a desmontagem saiu do `beforeunload` |
| `f0f61e85` | revisão final: a saída poupa o atlas de outra aba, diz o prazo que resta, e não usa veto na troca de conta |

### 6. Uma edição no painel de feição sumia no F5, e "Ficar na página" deixava a interface destruída (perda de dado e quebra funcional). `4fe2694f`

- **Sintoma:** mudar o tamanho de um ponto no painel (o mapa já mostra) e dar F5: volta o valor antigo, nos dois navegadores, com F5 imediato e também 1,5 s depois. O painel grava só no "Salvar" ou ao desselecionar.
- **Conserto:** um ouvinte de `beforeunload` por página (`instalarGuardaDeSaida`, `tool_manager/helpers/buttons.helpers.js`), no padrão do briefing: dispara a gravação e, com mudança pendente, pede confirmação.
- **Defeito de fundo:** `setupCleanupHandlers` (`map_sig.js`) destruía barra lateral, barra de ferramentas e uma dúzia de controles no `beforeunload`, que pode ser cancelado. Quem escolhia "Ficar na página" depois de qualquer confirmação de saída ficava com a interface destruída, inclusive a do estilo de camada (`DebouncedPersist`), que já pedia confirmação antes. A desmontagem foi para `pagehide`, pulada quando a página entra no bfcache.
- **Teste:** `frontend/tests/e2e-ui/painel-de-feicao-sobrevive-ao-f5.repro.spec.js`.
- **Controle negativo:** Chromium, as duas metades, cada uma reprovando sozinha.

### Revisão final. `f0f61e85`

- **(3)** A página sem mapa não adota o atlas que outra aba viva (o mapa) tem montado.
- **(2)** O prazo que resta viaja em `?outrosPrazo=`; sem ele, a frase diz "tempo limitado". O veto vencido não conta como retenção.
- **(4)** Na troca de conta o teto não vale, e uma adoção que falha solta o veto: nada fica retido para a conta seguinte enviar.
- **Teste:** 5 casos de node em `frontend/tests/unit/resgate-de-outros-atlas.test.js`.
- **Controle negativo:** 4 casos reprovam sem os consertos.

### Confirmado e NÃO corrigido: célula aberta da tabela de atributos no F5

- **Medida:** valor digitado sem Enter e F5: perdido nos dois navegadores. Com Enter antes do F5: gravado nos dois.
- **Tentativa:** confirmar a célula e pedir confirmação no `beforeunload` (patch guardado no scratchpad da sessão, `tabela-parcial.patch`). O despacho do `beforeunload` confirma a célula e o valor chega ao disco nos dois navegadores. Mas no F5 real do Chromium, com o diálogo aceito, o valor não chega: a gravação passa por um `import()` em `_handleCellEdit`. O "Ficar" também não fechou a célula no teste.
- **Por que não commitei:** não consegui provar por inteiro até o prazo.
- **Nome de camada:** não medido.

Estado da verificação:
- Vitest do frontend verde com `EBGEO_SEM_PESO_CONSTRUIDO=1`. O worktree não tem `dist/`.
  - `teto-de-peso-da-pagina-do-mapa` está vermelho de propósito, pela regra do coordenador: fonte do grafo do mapa em 11719 kB contra o teto de 11710 kB.
  - `docs-integridade` e `tab-lock-refutacao 3.5` falham às vezes, só sob a carga da suíte cheia, e passam sozinhos.
- Lint do frontend verde.
- Regressão Playwright (Chromium, `--retries=0`), 33/33: `abertura-remota-que-falha`, `browser-confirm-logout`, `browser-logout-clears-map`, `atlas-switch-edge-cases`, `browser-multi-tab-namespace`, `abrir-servidor-preserva-local`, `browser-multi-tab-teardown-queue` e `browser-logout-barrier-two-tabs`.

## Bugs corrigidos

### 1. A visita pública anônima apagava o trabalho de um atlas resgatado (perda de dado). `24f31026` + `6bf507e1`

- **Sintoma:** a sessão cai com uma edição pendente num atlas público P e o trabalho vira atlas local. A pessoa edita o atlas local e depois, deslogada, abre o link público de P. As edições feitas no resgate somem, sem pergunta.
- **Causa:** o ramo anônimo de `openPublicAtlasFromUrl` (`frontend/src/js/index.js`) ativa `remote-<P>` e chama `clearAllDataStore`. A pergunta `confirmDiscardingRescuedWork` só existia em `openRemoteAtlasNow`.
- **Conserto:** a mesma pergunta nas duas portas. "Apagar e abrir" solta o slot e esvazia a fila.
- **Teste:** `frontend/tests/e2e-ui/visita-publica-poupa-resgate.repro.spec.js`.
- **Controle negativo:** feito, determinístico.

### 2. A queda involuntária da sessão destruía a fila dos atlas que a aba tinha deixado (perda de dado). `77ccfb56` + `e7ad38fa` + `786d9909`

- **Sintoma:** a pessoa edita A com a rede ruim e vai para B. A sessão expira, ou morre com o navegador fechado, e a edição de A some sem aviso.
- **Causa:** o resgate cobria só o atlas montado, e a varredura destruía o resto.
- **Conserto (decisão R, aprovada):** `preserveUnsyncedWorkOfOtherAtlases` (`frontend/src/js/session/unsynced-work-exit.js`) roda antes de toda varredura involuntária: mapa, páginas sem mapa, boot deslogado, e troca de conta depois de restauração adiada (`endPreviousAccountIfReplaced`).
  - pula a aba viva (lock de montagem), a marca e a cerca de descarte, e o já resgatado;
  - no teto de atlas locais, retém com o prazo que resta;
  - veto vencido conta como perdido;
  - adota com `makeCurrent: false`;
  - os outros atlas vão pela URL em `?outros=`.
- **Testes:**
  - `frontend/tests/e2e-ui/sessao-perdida-poupa-fila-de-outro-atlas.repro.spec.js`;
  - `frontend/tests/e2e-ui/resgate-poupa-atlas-montado-em-outra-aba.repro.spec.js` (duas abas);
  - `frontend/tests/e2e-ui/sessao-adiada-outra-conta-nao-herda-fila.repro.spec.js`;
  - `frontend/tests/unit/resgate-de-outros-atlas.test.js`;
  - 2 casos em `frontend/tests/unit/local-atlas-api.test.js`.
- **Controles negativos:** todos feitos.
- **Testes existentes mudados:**
  - `multiaba-invariantes.test.js`: afirmava "nenhum aviso" porque a op de Y era destruída;
  - `desfecho-do-trabalho-na-url.test.js`: afirmava a linha exata de import.

### 3. Um 503 ou timeout no `/auth/me` no boot apagava todas as filas de servidor (perda de dado, grave). `08045432` + `e370a6f6` + `c5623566`

- **Sintoma:** um F5 durante um soluço do servidor apaga fila e cache de todos os atlas de servidor. O F5 seguinte restaura a mesma sessão, com a edição perdida.
- **Causa:** `enforceLocalStoreWhenLoggedOut` (`frontend/src/js/store/store.js`) lia "sessão não verificada" como "deslogado".
- **Conserto:** com par de tokens guardado, não varre. O marcador é alinhado com o slot local só DEPOIS de montar o escopo; antes disso, uma instalação pré-namespace com retrato de servidor nos bancos sem sufixo os adotava como atlas local (revisão 4B).
- **Testes:**
  - `frontend/tests/e2e-ui/boot-com-sessao-adiada-preserva-fila.repro.spec.js`: fila, entrega ao servidor, marcador, trava e escrita;
  - caso novo em `frontend/tests/integration/marcador-remote-orfao-no-boot-deslogado.test.js`.
- **Controles negativos:** feitos.

### 4. A conta que entrava depois de uma visita pública, ou promovida de Leitor, não via o atlas inteiro (quebra funcional, dado invisível). `7b7f0f27` + `c173d32c`

- **Sintoma:** comentários espaciais anteriores (e definições privadas de catálogo) nunca apareciam para a conta que entrava depois de uma visita pública no mesmo computador, nem para um Leitor promovido a Comentarista.
- **Causa:** o retrato é recortado por principal e por nível (`getAtlasSnapshot`), e `_durablePullCursor` pedia só a cauda sobre uma geração encenada para outro recorte. O atalho "mesma versão" de `applyRemoteSnapshot` também pulava.
- **Conserto:** o registro de geração carrega `principal` (da `SyncSession`) e `nivel`. O nível é carimbado por `_markRecorteLevel` quando o socket o informa (`connected`, `sharing_updated`); nível diferente zera o cursor e ressincroniza.
- **Testes:**
  - `frontend/tests/e2e-ui/visita-publica-depois-conta-ve-tudo.repro.spec.js`;
  - 2 casos de node em `frontend/tests/integration/abertura-remota-aplica-dois-retratos.repro.test.js`.
- **Controles negativos:** feitos.
- **Testes existentes mudados:** asserções de forma exata do registro de geração ganharam `principal` e `nivel`.

### 5. Texto de briefing digitado logo antes de F5 se perdia no Firefox (perda de dado, diferença entre navegadores). `3b18db2a`

- **Medida:** F5 200 ms depois de digitar. O Firefox perdeu 2/2 (e 4/4 numa rodada anterior); o Chromium gravou 4/4. No controle, com F5 3 s depois, os dois gravam.
- **Causa:** a gravação disparada no `beforeunload`/`pagehide` não chega ao IndexedDB no Firefox.
- **Conserto (padrão `warnBeforeUnload` do `DebouncedPersist`, escolhido pelo coordenador):** com `_hasUnsavedChanges`, o `beforeunload` cancela o evento, e o diálogo do navegador dá o tempo da gravação.
- **Teste:** `frontend/tests/e2e-ui/briefing-texto-sobrevive-ao-f5.repro.spec.js`. Pelo lado do produto nos dois navegadores; no Chromium, também com F5 real, diálogo aceito e texto gravado. O diálogo NÃO foi visto no Firefox sob Playwright, que não emite o evento na navegação.
- **Controle negativo:** Chromium, os 2 casos reprovam.
- **Não feito:** a janela de 1,5 s não foi reduzida, porque o custo em ops de servidor não foi medido.

## Suspeitas não confirmadas / observações

- **H2 (ack perdido) descartada, medida:** o servidor aplica e a resposta se perde, na mesma aba e com troca B→A. Reenvio confirmado, fila zera, servidor com a edição. 2/2.
- **H5 (figura pendente e troca) descartada, medida:** a figura com upload abortado em A, depois a troca para B e a volta para A, chega a A e não a B. A pendência termina confirmada.
- **H4 na troca AO VIVO (medida, não corrigida):** um desenho concluído com a gravação pendente durante `switchAtlas` ao vivo não cai em atlas nenhum e não gera aviso. Só o vigia de migração troca ao vivo, dentro de uma janela de milissegundos.
- **Debounces em memória, medidos com F5 rápido nos dois navegadores:**
  - Painel de feição (tamanho do ponto): o valor não é gravado nem com F5 1,5 s depois, nos dois navegadores. O painel é RASCUNHO com "Salvar/Descartar" explícitos, e o campo numérico de 300 ms alimenta o rascunho, não a store. Não há aviso de saída para rascunho não salvo; é decisão de produto e não mexi.
  - Estilo de camada (`DebouncedPersist`, 300 ms): já pede confirmação (`warnBeforeUnload`). Não medido.
  - Tabela de atributos e nome de camada: confirmam no Enter/blur. Um F5 com a célula aberta descarta a edição não confirmada, por desenho. Não medido.
  - O único debounce que perdia edição já "aplicada" era o do briefing (bug 5).
- **Regressão depois do bug 5:**
  - `browser-briefing-write-ahead`, `briefing-colagem-e-troca-de-slide`, `briefing-controles-do-slide`, `browser-briefing-slides` e `browser-briefing-advanced`: 11/11 no Chromium;
  - `browser-collab-briefing-temporal` e `browser-briefing-write-ahead`: 12/12 no Chromium e no Firefox.
  - A confirmação de saída não trava nenhum spec que recarrega.
- **Firefox, os specs novos:** 8/8 (`visita-publica-poupa-resgate`, `sessao-perdida-poupa-fila-de-outro-atlas`, `boot-com-sessao-adiada-preserva-fila`, `sessao-adiada-outra-conta-nao-herda-fila`, `resgate-poupa-atlas-montado-em-outra-aba` e `visita-publica-depois-conta-ve-tudo`).
- **H9:** o teto de atlas locais fala pelo `STORE_OPERATION_BLOCKED`.
- **Proposta de produto:** depois de um resgate involuntário, a mesma conta, ao abrir o mesmo atlas, só tem "Apagar e abrir" (perde as pendências) ou "Enviar ao servidor" (duplica o atlas). Uma opção "enviar as pendências a este atlas" entregaria a fila, mas a op não carrega autor.
- **Notas do coordenador:** a trava de aba não é reconferida depois do modal do resgate. A privacidade do resgate no boot deslogado, sem poda de privados, fica registrada para o dono.

## Linhas propostas para o livro-razão

- 2026-09-23 | perda-de-dado | A visita pública anônima esvaziava o namespace de um atlas resgatado sem a pergunta da porta da conta. Codificada em `frontend/tests/e2e-ui/visita-publica-poupa-resgate.repro.spec.js`.
- 2026-09-23 | perda-de-dado | O fim involuntário de sessão resgatava só o atlas montado, e a varredura destruía a fila dos atlas deixados. Codificada em `frontend/tests/e2e-ui/sessao-perdida-poupa-fila-de-outro-atlas.repro.spec.js`, `frontend/tests/e2e-ui/resgate-poupa-atlas-montado-em-outra-aba.repro.spec.js` e `frontend/tests/unit/resgate-de-outros-atlas.test.js`.
- 2026-09-23 | perda-de-dado | Falha transitória no `/auth/me` no boot era lida como sessão encerrada e varria todas as filas. Codificada em `frontend/tests/e2e-ui/boot-com-sessao-adiada-preserva-fila.repro.spec.js` e em `frontend/tests/integration/marcador-remote-orfao-no-boot-deslogado.test.js` (caso da sessão adiada).
- 2026-09-23 | privacidade | Na sessão adiada, outra conta que entrava enviava a fila da anterior com o próprio token. Codificada em `frontend/tests/e2e-ui/sessao-adiada-outra-conta-nao-herda-fila.repro.spec.js`.
- 2026-09-23 | verificacao-fantasma | O cursor durável declarava "completo" um retrato recortado para outro principal ou nível. Codificada em `frontend/tests/e2e-ui/visita-publica-depois-conta-ve-tudo.repro.spec.js` e `frontend/tests/integration/abertura-remota-aplica-dois-retratos.repro.test.js`.
- 2026-09-24 | navegador | No Firefox a gravação disparada no `beforeunload` não chega ao disco; o editor de briefing pede confirmação com edição pendente. Codificada em `frontend/tests/e2e-ui/briefing-texto-sobrevive-ao-f5.repro.spec.js`.
- 2026-09-24 | perda-de-dado | A edição do painel de feição (gravada só no Salvar ou ao desselecionar) sumia no F5, e a desmontagem da interface morava num `beforeunload` cancelável; ela passou para `pagehide`. Codificada em `frontend/tests/e2e-ui/painel-de-feicao-sobrevive-ao-f5.repro.spec.js`.
- 2026-09-24 | privacidade | A página sem mapa, ociosa, adotava o atlas que a aba do mapa tinha montado; e na troca de conta a fila sob veto sobrevivia para a conta seguinte. Codificada em `frontend/tests/unit/resgate-de-outros-atlas.test.js` (revisão final).

## Parágrafo de decisão proposto (decisions-2026)

**2026-09-23: o fim involuntário da sessão resgata a fila de TODO atlas de servidor, não só a do montado (proposta R).**

A troca de atlas promete guardar a fila do atlas deixado para a próxima abertura, mas o resgate involuntário cobria só o atlas montado. Agora `preserveUnsyncedWorkOfOtherAtlases` roda antes de toda varredura involuntária: logout involuntário do mapa, guarda de saída das páginas sem mapa, guarda de boot deslogado, e troca de conta depois de uma restauração adiada (`endPreviousAccountIfReplaced`).

- **Entra:** todo atlas remoto registrado com pendência, com contagem positiva ou desconhecida. Vira atlas local com `makeCurrent: false`.
- **Fica de fora:** o já reivindicado, o de descarte confirmado (marca ou cerca) e o que outra aba viva tem montado, que é resgatado pela saída dessa aba.
- **Acima do teto de atlas locais:** fica sob o veto de retenção, com o prazo que resta dito na tela. Veto vencido conta como perdido.
- **Canal da URL:** os desfechos dos outros atlas viajam em `?outros=`.
- **Alternativa recusada (V):** só o veto. Ela perde em silêncio depois de 24 h.
- **Na mesma data:** a guarda de boot deslogado não varre com par de tokens guardado (restauração adiada) e alinha o marcador depois de montar o escopo. O cursor durável passou a carregar principal e nível do recorte.

## Último ciclo (03:13 a 03:37, depois de `git rebase hunt/integra`)

- **Rebase:** repôs meu commit do painel (4fe2694f) como duplicata do já integrado (df24f2b4 difere levemente), deixando funções definidas em dobro em `buttons.helpers.js`. Descartei esse commit replicado, que é meu (`git reset --hard HEAD~1`). O branch ficou igual a `hunt/integra` antes dos commits novos.
- **`01e977a0` (tabela de atributos):** com uma célula aberta e o valor mudado, o `beforeunload` confirma a célula e pede confirmação. `_handleCellEdit` passou a gravar pelo barril já carregado, sem o `import()`.
  - **Medido:** quem escolhe "Ficar" tem o valor gravado (F5 real no Chromium, 3/3); o despacho do evento grava nos dois navegadores.
  - **Aceitar o diálogo ("Sair") NÃO garante a gravação: 2/5 no Chromium, mesmo sem o `import()`.** A instrumentação mostrou que `_handleCellEdit` começa e não termina antes da troca de documento: a gravação write-ahead precisa de voltas do laço de eventos. O ganho é a saída deixar de ser silenciosa; o spec não afirma o caso aceito.
  - **Controle negativo:** sem o conserto, os 2 casos reprovam.
  - **Contraste medido:** o painel de feição (integrado) grava com o diálogo aceito em 4/4. Não descobri a diferença.
- **`725dd83e` (selo de quem foi rebaixado a Leitor):** o push exige `comment`, então o Leitor recebe 403 em todo envio e o selo dizia "Enviando 1…" para sempre. Agora mostra "Sem permissão", com a frase longa dizendo o que fica no computador e a quem pedir permissão.
  - **Prova:** `tests/e2e-ui/selo-rebaixado-a-leitor.repro.spec.js`, verde no Chromium e no Firefox.
  - **Controle negativo:** sem a ligação no selo, fica `enviando`.
- **Vermelho da base, não mexido:** `referencias-de-recurso-censo` acusa `src/js/store/migration/legacy-transition.js:440/444` (`baseLayer`, `catalogLayers`), que veio de `hunt/integra`.
