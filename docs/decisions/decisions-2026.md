# Decisões de 2026

Entradas integrais. O índice está em [DECISIONS.md](DECISIONS.md).

---

### 2026-07-18: Monorepo, backend integrado por subtree em `backend/`

- **Contexto:** frontend (`1cgeo/ebgeo_web`, público) e backend (`1cgeo/ebgeo_backend`, privado) viviam em repositórios separados, mas o acoplamento era real e já cobrava preço: mudanças cruzavam a fronteira em dois PRs sem atomicidade, e o harness de E2E do frontend fixava o **caminho absoluto** do repositório do backend na máquina de um desenvolvedor, o que tornava 108 specs de Playwright inexecutáveis para qualquer outra pessoa e para qualquer CI.
- **Decisão:** trazer o backend para `backend/` do repositório do frontend via `git subtree add`, preservando os 44 commits. O frontend permanece na raiz. O repositório resultante é público.
- **Alternativas rejeitadas:**
  - *Manter separados e só corrigir o caminho absoluto*: resolveria o E2E, mas não a não-atomicidade das mudanças que cruzam a fronteira, que é o custo recorrente.
  - *Layout `apps/web` + `apps/backend`*: mais limpo, mas mover o frontend faria os 27 branches abertos conflitarem inteiros. Assimetria aceita em troca de zero atrito no trabalho em voo.
  - *Monorepo privado*: descartado após confirmação de que a abertura do backend não é restrição.
- **Consequências:** uma mudança que cruza os dois pacotes cabe num commit e é verificada pelo E2E antes do merge. `git log --follow` não atravessa o enxerto (o histórico mantém os caminhos originais; use `git log --all -- src/...` ou o SHA). O repositório do backend deve ser arquivado, não deletado. Antes da abertura, o histórico foi varrido por segredo: nada de chave, `.env` real ou credencial; o único achado (hostname de produção num fixture) foi trocado por domínio de exemplo.
- **Status:** aceita, **exceto o layout**: "o frontend permanece na raiz" durou horas e foi superado por *2026-07-18: o pacote web vai para `frontend/`*, abaixo.

---

### 2026-07-18: o pacote web vai para `frontend/`

- **Contexto:** a decisão de horas antes manteve o frontend na raiz para não conflitar os 27 branches abertos. Na prática a raiz ficou misturando 12 itens do pacote web com 9 do monorepo, e nada indicava a quem cada arquivo pertencia (`1ab95eb4`).
- **Decisão:** mover o pacote web para `frontend/`, simétrico a `backend/`. Cada pacote autocontido (`package.json`, `node_modules` e `.gitignore` próprios) e a raiz só orquestrando, com `--prefix`.
- **Alternativas rejeitadas:**
  - *npm workspaces*: mudaria como as dependências do backend são instaladas, e a suíte dele exige PostgreSQL + PostGIS com superusuário, que não dava para verificar naquele momento. Mudança não verificável não entra junto com uma que já é grande.
  - *Manter a assimetria*: era a decisão anterior, e o custo que ela evitava (conflito nos branches em voo) já tinha sido pago pela integração do backend.
- **Consequências:** `git log -- frontend/src/...` não enxerga o histórico anterior ao movimento (use `--follow`, ou o caminho antigo). O movimento quebrou três coisas de uma vez, e as três apareceram porque havia guarda: a lista de documentos vigiados do `frontend/tests/unit/docs-integridade.test.js` zerou (pego pelo teste escrito para "a lista esvaziar em silêncio"), o hook de lint procurava o ESLint na raiz e passou a subir do arquivo até o pacote que o configura, e o `deploy/deploy.sh` apontava para um `dist/` que mudou de lugar. Cada quebra confirmou o guarda correspondente.
- **Status:** aceita.

---

### 2026-07-18: Documentação concentrada em `docs/` com camada de memória

- **Contexto:** a documentação tinha duas casas (`docs/` do frontend e `backend/docs/`), resquício dos dois repositórios. E o conhecimento durável do projeto (o porquê das decisões, as armadilhas, os contratos congelados) não tinha lugar: vivia espalhado em prosa que apodrecia. A prova apareceu na própria sessão: um documento que se anunciava como "referência única para integradores" documentava a permissão por atlas com três níveis quando o `CHECK` do banco tem cinco, e foi esse modelo mental que produziu um bug real de autorização.
- **Decisão:** concentrar tudo em `docs/` (guias e deploy, todos depois absorvidos pela wiki) e adotar a organização de memória do vault `chefe_dgeo`, adaptada a software: constituição com seis princípios ([`doutrina.md`](../doutrina.md)), [`docs/MEMORY.md`](../MEMORY.md) com fatos duráveis, wiki semântica em [`wiki/`](../wiki/index.md) com wikilinks, este log de decisões, [`docs/livro-razao.md`](../livro-razao.md) como espelho de correções, e skills com `learnings.md`.
- **Alternativas rejeitadas:**
  - *Links markdown relativos em vez de wikilinks*: a pesquisa mostra que o Claude Code não resolve wikilink nativamente (para o agente é texto que vira grep). Rejeitada por decisão do dono do projeto, que já opera o modelo com wikilinks e o considera comprovado. Mitigação adotada: teste que valida que todo wikilink resolve para uma página existente, devolvendo ao formato a verificabilidade que ele não tem sozinho.
  - *Só reference/explanation do Diátaxis*: descartada junto com a anterior; segue-se o modelo do vault.
- **Consequências:** a documentação passa a ser verificada por teste (`frontend/tests/unit/docs-integridade.test.js`: caminhos citados existem, links resolvem, wikilinks resolvem, `MEMORY.md` cabe no que o Claude Code carrega). Documentação vira algo que o CI checa, em vez de depender de disciplina. Custo: manter a wiki podada é trabalho recorrente, e a retrospectiva é quem paga.
- **Status:** aceita.

---

### 2026-07-25: Cartão de atlas sem miniatura do mapa (descopado)

- **Contexto:** o redesenho do Atlas Drive previa (fase C2) uma miniatura por atlas no cartão, gerada por snapshot do mapa ou enviada pelo usuário. As fases A a D foram concluídas sem ela, e o registro dessa escolha vivia só numa nota de sessão, que é onde uma decisão negativa some.
- **Decisão:** o cartão identifica o atlas por uma **faixa colorida com as iniciais**, com cor estável derivada do nome. Sem snapshot do mapa e sem upload de miniatura de atlas.
- **Alternativas rejeitadas:**
  - *Snapshot do mapa ao fechar o atlas*: obriga a renderizar fora da tela num momento em que o usuário está saindo, e produz miniatura que envelhece sem aviso: o cartão passaria a mostrar um mapa que já não é aquele.
  - *Upload manual de miniatura*: mais infraestrutura (armazenamento, limite, invalidação) para um identificador que a faixa colorida já dá de graça e sem envelhecer.
- **Consequências:** o Drive não tem dependência de imagem por atlas. A miniatura que EXISTE no projeto é outra coisa e continua valendo: é a do **catálogo** (basemaps, modelos 3D e camadas), embutida como data URL no `config` do recurso com teto de 256 KB. Confundir as duas leva a procurar infraestrutura que não existe. Se um dia a miniatura de atlas voltar, ela precisa resolver o envelhecimento, que é o motivo real da recusa.
- **Status:** aceita. O resumo operativo (uma linha, na lista de decisões menores) vive em [`../wiki/sintese-decisoes-arquiteturais.md`](../wiki/sintese-decisoes-arquiteturais.md); aqui fica a alternativa rejeitada, que é o que não cabe lá.
