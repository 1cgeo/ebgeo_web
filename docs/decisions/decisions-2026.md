# Decisões de 2026

Entradas integrais. O índice está em [DECISIONS.md](DECISIONS.md).

---

### 2026-07-18: Monorepo — backend integrado por subtree em `backend/`

- **Contexto:** frontend (`1cgeo/ebgeo_web`, público) e backend (`1cgeo/ebgeo_backend`, privado) viviam em repositórios separados, mas o acoplamento era real e já cobrava preço: mudanças cruzavam a fronteira em dois PRs sem atomicidade, e o harness de E2E do frontend fixava o **caminho absoluto** do repositório do backend na máquina de um desenvolvedor, o que tornava 108 specs de Playwright inexecutáveis para qualquer outra pessoa e para qualquer CI.
- **Decisão:** trazer o backend para `backend/` do repositório do frontend via `git subtree add`, preservando os 44 commits. O frontend permanece na raiz. O repositório resultante é público.
- **Alternativas rejeitadas:**
  - *Manter separados e só corrigir o caminho absoluto* — resolveria o E2E, mas não a não-atomicidade das mudanças que cruzam a fronteira, que é o custo recorrente.
  - *Layout `apps/web` + `apps/backend`* — mais limpo, mas mover o frontend faria os 27 branches abertos conflitarem inteiros. Assimetria aceita em troca de zero atrito no trabalho em voo.
  - *Monorepo privado* — descartado após confirmação de que a abertura do backend não é restrição.
- **Consequências:** uma mudança que cruza os dois pacotes cabe num commit e é verificada pelo E2E antes do merge. `git log --follow` não atravessa o enxerto (o histórico mantém os caminhos originais; use `git log --all -- src/...` ou o SHA). O repositório do backend deve ser arquivado, não deletado. Antes da abertura, o histórico foi varrido por segredo: nada de chave, `.env` real ou credencial; o único achado (hostname de produção num fixture) foi trocado por domínio de exemplo.
- **Status:** aceita.

---

### 2026-07-18: Documentação concentrada em `docs/` com camada de memória

- **Contexto:** a documentação tinha duas casas (`docs/` do frontend e `backend/docs/`), resquício dos dois repositórios. E o conhecimento durável do projeto — o porquê das decisões, as armadilhas, os contratos congelados — não tinha lugar: vivia espalhado em prosa que apodrecia. A prova apareceu na própria sessão: um documento que se anunciava como "referência única para integradores" documentava a permissão por atlas com três níveis quando o `CHECK` do banco tem cinco, e foi esse modelo mental que produziu um bug real de autorização.
- **Decisão:** concentrar tudo em `docs/` (guias e deploy, todos depois absorvidos pela wiki) e adotar a organização de memória do vault `chefe_dgeo`, adaptada a software: constituição com seis princípios ([`doutrina.md`](../doutrina.md)), [`MEMORY.md`](../../MEMORY.md) com fatos duráveis, wiki semântica em [`wiki/`](../wiki/index.md) com wikilinks, este log de decisões, [`livro-razao.md`](../../livro-razao.md) como espelho de correções, e skills com `learnings.md`.
- **Alternativas rejeitadas:**
  - *Links markdown relativos em vez de wikilinks* — a pesquisa mostra que o Claude Code não resolve wikilink nativamente (para o agente é texto que vira grep). Rejeitada por decisão do dono do projeto, que já opera o modelo com wikilinks e o considera comprovado. Mitigação adotada: teste que valida que todo wikilink resolve para uma página existente, devolvendo ao formato a verificabilidade que ele não tem sozinho.
  - *Só reference/explanation do Diátaxis* — descartada junto com a anterior; segue-se o modelo do vault.
- **Consequências:** a documentação passa a ser verificada por teste (`tests/unit/docs-integridade.test.js`: caminhos citados existem, links resolvem, wikilinks resolvem, `MEMORY.md` cabe no que o Claude Code carrega). Documentação vira algo que o CI checa, em vez de depender de disciplina. Custo: manter a wiki podada é trabalho recorrente, e a retrospectiva é quem paga.
- **Status:** aceita.
