# Caça noturna de bugs: regras comuns a todo subagente

Data: 2026-09-23 (noite) a 2026-09-24 05:30. Coordenador: a sessão principal (ela integra, revisa e commita no `integracao_backend`).

## A missão

Hoje a produção serve o branch `main` (commit `8b611113`, pacote único, sem backend). Vamos lançar o `integracao_backend` (monorepo `frontend/` + `backend/`) no MESMO endereço, em https, do mesmo jeito que o main. Sua tarefa é **procurar bugs reais na sua frente de caça e corrigi-los**, com prova. As preocupações do dono, em ordem:

1. perda de dados na transição do main para a integração;
2. perda de dados no uso de atlas remotos e locais, e na troca entre atlas (local→remoto, remoto→remoto, remoto→local, local→local);
3. sincronismo entre vários usuários, inclusive com perda de conexão e conexão lenta;
4. todas as ferramentas, briefings, processamentos, vários mapas, comentários, estilos, atributos e tabela de atributos entre vários usuários;
5. desempenho;
6. diferenças entre navegadores.

A suíte existente é grande (cerca de 240 specs de Playwright) e já cobre muita coisa. **O valor está no que ela NÃO cobre**: leia o código da sua área, forme hipóteses de defeito, e prove ou descarte cada uma com um teste que reprova.

## Seu espaço de trabalho (isolamento é obrigatório)

- Você trabalha SÓ na sua worktree, `C:\Users\diniz\ebgeo_hunt\<area>`, no branch `hunt/<area>`. Tudo o que você edita, roda e commita é ali.
- A árvore principal `C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\ebgeo_web` é SÓ LEITURA para você (o dono tem um `npm run dev` rodando dela, portas 3000 e 8080: não toque).
- As outras worktrees em `C:\Users\diniz\ebgeo_hunt\` são de OUTROS agentes: nunca leia estado delas como se fosse seu, nunca escreva nelas.
- `ebgeo_web\.claude\worktrees\migration-main-*` são checkouts do `main` usados pelos testes de migração: só leitura, nunca remova, nunca rode `npm ci` lá.
- **Proibido:** `git stash` (a pilha é compartilhada entre worktrees e já destruiu trabalho alheio); criar junção ou symlink de `node_modules`; `git worktree remove`/`prune`; `git push`; `git checkout` de outro branch; `git reset --hard` em commit que não é seu; escrever em `deploy/`, em `.env*`, em `package-lock.json` ou em `frontend/public/vendors/`; instalar dependência nova.
- **Nunca mate processo que você não criou.** Se uma porta sua estiver ocupada, PARE e relate; não investigue matando. Mate só o PID que você mesmo iniciou.

## Variáveis de isolamento (defina em TODO comando que rode teste)

Cada agente tem portas e bancos próprios (a tabela está no seu prompt). Os nomes:

- `EBGEO_UI_E2E_APP_PORT` (Vite do Playwright), `EBGEO_UI_E2E_BACKEND_PORT` (backend do Playwright). O banco do Playwright deriva do checkout sozinho.
- `EBGEO_E2E_PORT` e `EBGEO_E2E_DB_NAME` (camada de contrato, `npm run test:e2e --prefix frontend`).
- `TEST_DB_NAME` (testes do backend).

No PowerShell: `$env:EBGEO_UI_E2E_APP_PORT='4331'; ...` antes do comando. No Bash: prefixo na mesma linha. Se um spec precisar de modelo 3D real, aponte `MODELS_3D_DIR` para `C:\Users\diniz\OneDrive\Desktop\Desenvolvimento\ebgeo_web\backend\data\models3d` (leitura).

## Como rodar (e o que NÃO rodar)

- NÃO rode a suíte inteira do Playwright nem o `npm test` da raiz (lentos; o coordenador roda na integração). Rode os specs da sua área e os que você escrever.
- Playwright, sempre de DENTRO de `frontend/`: `npx playwright test <arquivo> --retries=0 --workers=1` (o `retries: 1` padrão esconde flake; um caso que flakeia é um caso não verificado). Firefox: acrescente `--project=firefox`.
- Frontend vitest inteiro custa segundos: `npm test --prefix frontend` (rode antes de commitar).
- Backend: `npm test --prefix backend -- <arquivo>` (com `TEST_DB_NAME`), ou `npm run test:fast --prefix backend -- <arquivo>` no laço apertado.
- Lint: `npm run lint --prefix frontend` e/ou `npm run lint --prefix backend`, em comando SEPARADO do commit, antes dele.
- Leia `frontend/tests/e2e-ui/README.md` antes de escrever spec de navegador (helpers de sessão `clienteNaPagina`/`sessaoDoApp`, helpers de trace do SyncLedger, `aria-disabled` e `dispatchEvent`, espera por estado e não por tempo, toast pela opacidade computada).
- Máquina compartilhada com outros 8 agentes: `--workers=1` sempre, feche o que abrir, não deixe servidor órfão.

## Método (a constituição do repo já está carregada; isto é o recorte que mais importa hoje)

1. Hipótese de defeito, escrita.
2. Repro que REPROVA antes do conserto (spec de Playwright, teste de integração do frontend ou do backend). Sem vermelho não há bug provado.
3. Conserto mínimo e localizado, na convenção da casa (comentário de caminho na linha 1, string de UI em pt-BR com acento, comentário e JSDoc em inglês, sem em-dash, imports por alias, transação write-ahead, gate pela hierarquia, frase de aviso curta que diz o que a pessoa pode fazer).
4. Verde, e **controle negativo**: reverta o conserto e confirme que o teste volta a reprovar; reponha.
5. Coisa probabilística (corrida, tempo, rede): meça em série e relate a taxa antes/depois (ex.: 3/10 reprovam antes, 0/20 depois). Prefira tornar a interleaving perdedora determinística no teste.
6. Não refatore, não "melhore" o que não está quebrado, não mude comportamento de produto por gosto. Se o conserto exigir decisão de produto, mudar contrato congelado (envelope de sync, `/api/config`, API) ou criar migração de banco, NÃO implemente sem antes relatar ao coordenador (SendMessage para `main`) e esperar a resposta; siga caçando outras coisas enquanto isso.

## Commit (na sua worktree, no seu branch)

- Um commit por bug, com o repro e o conserto juntos. Mensagem em inglês, estilo do repo (`fix(sync): ...`), sem acento, corpo explicando causa raiz e prova. Termine com as duas linhas:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_012Mpt2yebVsKuyvsCG3chH2`
- Antes: lint do pacote tocado e os testes pertinentes, DEPOIS da última escrita.
- **Não edite** `docs/livro-razao.md`, `docs/decisions/*`, `docs/wiki/*`, `CLAUDE.md` nem `.claude/rules/*` (oito branches editando os mesmos arquivos viram conflito). Em vez disso, escreva no relatório a linha proposta para o livro-razão e o parágrafo de doc proposto; o coordenador aplica na integração.
- Se um teste existente precisar mudar porque ele afirmava o defeito, mude e diga por quê.

## Relatório

Mantenha `C:\Users\diniz\ebgeo_hunt\relatorios\<area>.md` atualizado enquanto trabalha (é o que sobrevive se você for interrompido). Ao terminar o ciclo, sua mensagem final deve trazer:

- **Bugs corrigidos**: para cada um, severidade (perda de dado / quebra funcional / cosmético), sintoma para o usuário, causa raiz com `arquivo` e símbolo, SHA do commit, teste que prende, resultado do controle negativo, taxa se probabilístico.
- **Bugs confirmados e NÃO corrigidos** (e por quê: decisão de produto, contrato, risco).
- **Suspeitas não confirmadas** (o que tentou e por que não fechou).
- **Linhas propostas para o livro-razão** e docs.
- O que você cobriu e o que ficou de fora.

Prazo do primeiro ciclo: relate até **01:15** (ou antes, se tiver um lote sólido). O coordenador pode retomá-lo com mais trabalho.

## Atualizações do coordenador (23:20)

- **Não mexa nos números de `frontend/tests/unit/teto-de-peso-da-pagina-do-mapa.test.js`** (contagem de módulos, kB de fonte, ORCAMENTO, tetos do build) por causa do crescimento do SEU conserto: cada branch sobe o mesmo número e isso vira conflito em toda integração. Se o seu conserto fizer um caso daquele arquivo reprovar SÓ por orçamento, deixe vermelho, diga no corpo do commit quanto mediu, e siga; o coordenador re-mede tudo junto no fim. (Exceção: caso NOVO que prende um defeito de peso, como os da frente peso.)
- Antes de consertar algo de sync/fila, dê uma olhada no que já foi integrado em `hunt/integra` (`git -C C:/Users/diniz/ebgeo_hunt/integra log --oneline 5379fc3e..`): o 413 foi consertado em duplicidade por duas frentes.

## Campanha de cobertura (2026-09-24, manhã)

O dono pediu que TUDO seja exercitado: todas as ferramentas, processamentos, importações, exportações, briefings, atributos, tabela de atributos e opções do painel de camadas, e no fim a suíte inteira do Playwright.

- Base: crie na sua worktree um branch novo a partir do `integracao_backend` atual (`git branch hunt/cob-<area> integracao_backend` e `git switch hunt/cob-<area>`; nunca stash). O `integracao_backend` já tem toda a noite.
- Primeiro a MATRIZ, em `C:\Users\diniz\ebgeo_hunt\relatorios\cobertura-<area>.md`: enumere a sua área A PARTIR DO CÓDIGO (registro de ferramentas, lista de algoritmos, extensões aceitas, menus e botões), e para cada item e etapa diga qual spec existente a cobre (nome do arquivo e caso) ou "LACUNA". Não confie no nome do spec: abra e confira o que ele afirma.
- Depois, preencha as lacunas com specs de navegador (Playwright, `--retries=0`, dois usuários quando a etapa envolver colaboração), no formato da casa (helpers de sessão, espera por estado, comentário de caminho, pt-BR). Agrupe os specs de cobertura por tema; um commit `test(...)` por grupo.
- Todo vermelho vira investigação: defeito do produto = repro + conserto + controle negativo + commit `fix(...)` próprio; limite do instrumento = ajuste no spec dizendo por quê.
- Mantenha a matriz atualizada (cada LACUNA vira "coberto por <spec>" ou "defeito <sha>").
- Continua valendo: não suba números do teto de peso; lint e vitest do frontend antes de cada commit; nada de push.
