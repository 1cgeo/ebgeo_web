# Testes: backend

> **ESTADO EM 2026-07-19.** Os 185 itens deste arquivo NÃO foram percorridos um a um.
> O que existe de novo veio como subproduto das 35 correções de `bugs-backend.md`:
> ~40 arquivos de teste criados ou alterados, backend de 1265 para 1432 casos.
> O ponto cego estrutural nº 2 (teste de caracterização lido como garantia) foi
> CONFIRMADO por execução quatro vezes — ver a tabela na própria seção.
> Retomada: [`auditoria-continuacao.md`](auditoria-continuacao.md).


Oportunidades de teste em `backend/src`, levantadas na auditoria de 2026-07-19 sobre o commit `e1bb74e`.

## O ponto de partida

A suíte do backend hoje: **446 suítes, 1265 testes, 0 falhas, 0 skipped, 0 todo**, em 141 segundos, com lint limpo. Medido, não suposto. Zero skipped e zero todo é sinal genuíno de higiene: não há teste desabilitado parado no repositório.

E ainda assim a auditoria confirmou **116 defeitos vivos** que essa suíte não pega, 5 deles críticos e 24 altos. Os dois fatos juntos são o diagnóstico: **o problema da suíte não é quantidade, é ângulo.** Ela cobre bem o caminho feliz de cada rota isolada e quase não cobre negação, assimetria entre superfícies, e concorrência real.

Por isso este documento não é uma lista de "faltou testar X". Ele começa pelos pontos cegos estruturais, que são o que faz os 185 itens individuais existirem.

## Cobertura medida

O crítico de completude desta auditoria apontou que as lacunas de teste estavam sendo **inferidas por leitura, nunca medidas**, e que `npm run test:coverage` existia e ninguém tinha rodado. Foi rodado. Números reais, `c8` sobre a suíte completa:

| Métrica | Cobertura | Faltando |
|---|---|---|
| Statements | 94,43% | 767 de 13791 |
| **Branches** | **84,63%** | **366 de 2382** |
| Functions | 92,83% | 25 de 349 |
| Lines | 94,43% | 767 de 13791 |

**94,43% de linhas cobertas convivendo com 116 defeitos confirmados.** Esse par de números é a tese deste documento em uma linha: cobertura mede linha executada, não propriedade provada. Uma linha "coberta" por um teste que só afirma que a chamada não lançou conta igual a uma linha coberta por um teste que prende o invariante.

Repare qual é a métrica mais baixa. **Branch é 10 pontos abaixo de linha**, e branch é exatamente onde mora a negação: o `else` do gate, o `catch` do erro, o ramo do usuário sem permissão. Os 366 branches não cobertos são a forma quantitativa do ponto cego estrutural nº 4 (ausência de teste negativo cross-tenant e cross-actor). A medição e a leitura chegaram ao mesmo diagnóstico por caminhos independentes.

Os buracos concretos, que confirmam por medição o que a auditoria inferiu:

| Arquivo | Linha | Branch | Observação |
|---|---|---|---|
| `src/index.js` | **0%** (63 linhas) | | Boot, SIGTERM e shutdown gracioso: nenhuma linha executada por teste |
| `src/database/seed.js` | **0%** (146 linhas) | | |
| `src/modules/ranks/ranks.service.js` | **33,3%** | | Confirma a suspeita: `ranks/` não tem arquivo de teste |
| `src/middleware/request-logger.js` | 27,6% | | Onde mora o risco de vazar token para log |
| `src/modules/atlas/atlas.service.js` | 89,8% | **59,7%** (-50) | Maior buraco de branch em números absolutos |
| `src/modules/streetview360/sv360.ingest.js` | 84,0% | **53,3%** (-21) | Pior branch do backend |
| `src/modules/sync/sync.controller.js` | **100%** | **73,7%** (-5) | Linha cheia, branch furado: o caso didático |

A última linha merece atenção. `sync.controller.js` tem **100% de linha e 73,7% de branch**. É a ilustração exata de por que um número de cobertura alto não é garantia: todo o arquivo foi executado, e um quarto das suas decisões nunca foi tomada nos dois sentidos.

Por fim, `.c8rc.json` roda com `all: true` (bom, conta arquivo nunca importado) mas **sem nenhum threshold**. Não há `check-coverage`, `lines`, nem `branches`. Ou seja, cobertura hoje é relatório, não guarda: ela pode cair para 60% entre um commit e outro sem nada ficar vermelho. Um piso em branch, ainda que baixo no começo, é o que transforma esse número em invariante.


## Os cinco pontos cegos estruturais

**1. Concorrência é medida através do supertest, que a serializa.** Este é o mais grave, porque produz falso verde estável em vez de flake. O teste `auth-09` (`tests/integration/auth-gaps.test.js:263-266`) afirma que duas requisições concorrentes de refresh não podem ambas ter sucesso, e passa. Ele passa porque o supertest abre um servidor efêmero e um socket TCP frio por requisição, e esse custo de setup serializa as duas chamadas. Com sockets keep-alive pré-aquecidos, que é o que um cliente ou um atacante real tem, o mesmo código falha em 9 de 10 execuções, e foi assim que a corrida do refresh token foi confirmada. O projeto **já sabia disso**: `low-impact-fixes.test.js:79-85` registra por escrito que dirigir por duas requisições HTTP não interleava. A lição foi anotada e não foi aplicada ao refresh, que é exatamente o modo de falha que o livro-razão chama de "correção que recorre significa que a guia não pegou".

   Regra que falta, e que vale codificar: **exclusão mútua se afirma no nível do SQL ou do serviço, nunca por duas requisições HTTP.**

> **CONFIRMADO POR EXECUÇÃO em 2026-07-19.** Este ponto cego era a previsão mais valiosa da auditoria, e corrigir os achados o comprovou quatro vezes. Ao consertar um defeito, o teste que o cimentava reprovava, e em CADA caso o nome ou o comentário do teste descrevia o bug com precisão:
>
> | Teste | O que afirmava | Achado |
> |---|---|---|
> | `maps-briefings-gaps.js` maps-02b | "a public token reads OTHER public atlases (current cross-atlas behavior)", com 200 | 51 |
> | `users-coverage.js:168` | "transferTo === the deleted user keeps the atlas pointed at that (now inactive) id" | 57 |
> | `sync-gaps.js:515` | "create reusing id stays tombstoned" | tombstone/undo |
> | `sync-authz-lock.js` | 403 no lote inteiro por op negada | 28 (poison batch) |
>
> A auditoria já listava `users-coverage.test.js:168-184`, o que valida a lente. O que a execução acrescentou: **maps-02b não estava na lista**, e é o mais grave dos quatro, porque congela comportamento de SEGURANÇA (um token de visitante lendo qualquer atlas público) e o comentário do próprio teste nomeia o mecanismo do furo, "never matches the token's embedded atlasId". Ou seja, a lacuna foi vista, descrita e então convertida em asserção, em vez de reportada.
>
> A convenção proposta abaixo continua valendo e ficou mais barata de justificar: nenhum desses quatro teria sobrevivido a uma regra que exigisse marcar asserção de comportamento-conhecido-ruim e ligá-la a um item aberto. O padrão adotado nesta rodada, quando o risco é aceito de propósito, é o oposto e funciona: afirmar o buraco EXPLICITAMENTE com marcador `KNOWN GAP` (ver `register-organization-scope.test.js`), para que fechá-lo QUEBRE o teste e force a decisão a ser revisitada.

**2. Testes de caracterização são lidos como testes de garantia.** `atlas-09` (merge raso), `users-coverage.test.js:168-184` (self-transfer), `org-identity-gaps.test.js:346` (`%%`) e `sync-service-coverage.test.js:146` (tombstone) todos afirmam o defeito, com comentário explicando que aquilo é o esperado. Como pinos de comportamento são ótimos. O problema é que fazem o defeito parecer coberto: quem lê a suíte vê verde e conclui que a área está protegida, quando o verde está cimentando o bug. Falta convenção que marque essas asserções como contrato conhecido-ruim e as ligue a um item aberto.

**3. Escotilha `if (condição) { ... }` sem asserir a condição.** `if (isSnapshot)`, `catch(() => null)`, `assert.ok(A || B)`, `assert.ok(res.body.data)`, laços sobre listas que podem estar vazias. Todos passam com o código arbitrariamente errado. É a "cobertura vazia" da constituição na sua forma mais comum, e é detectável por lint: **em teste, nenhum `assert` pode estar dentro de um `if` cuja condição não seja ela mesma asserida.**

**4. Ausência quase total de teste negativo cross-tenant e cross-actor.** Não existe o par HTTP do `ws-01` (token público contra outro atlas). Não há teste de import com referência a atlas alheio, nem de `sharing_updated` recebido por socket com permissão `read`, nem de push por `manage`. O `backend/CLAUDE.md` tem a regra escrita ("toda query com filtro de acesso exige teste com usuário sem permissão") e ela não é verificável, porque nada a checa. Regra escrita e não codificada é, pelo princípio 1, competência perdida.

**5. A fronteira entre os pacotes é afirmada em comentário, não exercitada.** `user_away` tem teste do lado servidor (o frame saiu) e teste do lado cliente (com um shape que o servidor nunca emite), e ninguém testa o par. O mesmo vale para o undo, cujos testes constroem operações com `randomUUID()` e nunca chamam `_executeUndoAction`. O E2E full-chain existe e é bom, mas **presença e undo não estão nele**, e são justamente as duas costuras que a auditoria encontrou rompidas.

## Como ler os itens

Cada item responde a pergunta de ouro da constituição: *se este código estivesse errado, o que um teste verde estaria provando?* Onde a resposta era "nada", o item foi reformulado até prender. Vários itens trazem **controle negativo** explícito, que é o passo que separa teste que prende de teste que acompanha.

- **P1** (71): prende invariante declarado, caminho de autorização, ou risco de perda de dado.
- **P2** (83): caminho de erro, fronteira, contrato entre módulos.
- **P3** (31): robustez e casos de borda de menor consequência.

Por tipo: 136 de integração (precisam de PostgreSQL), 30 unitários (lógica pura, sem banco) e 19 de WebSocket.

## A verificação que não verifica

Um achado que não é sobre um teste específico, mas sobre o comando que os roda, e que por isso vale mais que qualquer item da lista.

`CLAUDE.md` e `.claude/rules/testing.md` prescrevem `npm run lint` + `npm test` como *a* verificação de lógica antes de qualquer commit. Na raiz, os dois delegam com `--prefix frontend`:

```
"lint": "npm run lint --prefix frontend",
"test": "npm test --prefix frontend",
```

Existem `lint:all` e `test:all`, mas não são o que a documentação manda rodar. **Uma mudança só de backend, verificada exatamente como a constituição instrui, roda zero teste de backend e zero lint de backend, e volta verde.** É a classe `verificacao-fantasma` ("conferir um subconjunto e tratar como o conjunto") dentro do próprio documento que a proíbe, e é a terceira ocorrência dessa classe no livro-razão.

Verificado por execução: os dois pacotes estão limpos hoje, então o defeito está no guarda, não no código. Some-se a isso uma assimetria de rigor: o frontend roda `eslint . --max-warnings 0`, o backend roda `eslint src tests` puro, então um warning no backend passa calado enquanto o mesmo warning reprova no frontend.

Correção sugerida, em ordem de valor: apontar `test` e `lint` da raiz para `test:all`/`lint:all`; acrescentar `--max-warnings 0` ao lint do backend; e corrigir as duas linhas de documentação que prescrevem o comando incompleto.

---

## Itens

Agrupados por prioridade e, dentro dela, por fatia.


### Distribuição

| Prioridade | Itens |
|---|---|
| P1 | 71 |
| P2 | 83 |
| P3 | 31 |
| **Total** | **185** |

| Tipo | Itens |
|---|---|
| integração | 136 |
| unitário | 30 |
| WebSocket | 19 |

---

## P1, prende invariante, autorização ou risco de perda de dado

### 1. transferOwnership com ator admin global, req.atlasOwnerId vs req.user.id (atlas.controller.js:75-83)

- **Código:** `backend/src/modules/atlas/atlas.controller.js`
- **Tipo:** integração · **Fatia:** `be-atlas`
- **Cobertura hoje:** atlas-transfer-ownership.test.js (owner/member/stranger/anônimo, alvo inativo, self-transfer, atomicidade), nenhum caso com ator admin

**O que o verde provaria.** requireAtlasPermission (permissions.js:82-87) dá 'owner' a qualquer admin global, então o admin passa o gate de POST /:atlasId/transfer sem ser o dono. O controller escolhe DELIBERADAMENTE demover req.atlasOwnerId e não req.user.id, comentário no próprio arquivo. Todos os testes atuais de transferência são disparados pelo próprio dono, onde req.user.id === req.atlasOwnerId, então os dois ramos são indistinguíveis e o teste passa com e sem o fix (C3). Se alguém 'simplificasse' para req.user.id, o admin ganharia o share 'manage' e o dono real perderia o projeto em silêncio.

**Casos:**

- admin global (users.role='admin') faz POST /atlas/<atlas do owner>/transfer {newOwnerId: member.id} -> 200
- asserir atlas.owner_id === member.id
- asserir atlas_shares contém (owner.id, 'manage'), o dono REAL foi demovido, não o admin
- asserir SELECT count(*) FROM atlas_shares WHERE atlas_id=$1 AND user_id = admin.id === 0, o admin NÃO ganha share
- efeito observado depois: o ex-dono consegue PATCH /settings (manage) mas recebe 403 em DELETE /atlas/:id (manage < owner)
- admin transferindo para um NÃO-membro -> 400 e owner_id inalterado (o admin não fura a regra de negócio)

### 2. LIST_USER_ATLAS.user_permission (atlas.queries.js:16), a projeção de permissão que o frontend usa para gatear a UI

- **Código:** `backend/src/modules/atlas/atlas.queries.js`
- **Tipo:** integração · **Fatia:** `be-atlas`
- **Cobertura hoje:** nenhuma (atlas.test.js e permissions.test.js só afirmam status HTTP; o campo user_permission não aparece em nenhum teste)

**O que o verde provaria.** É a ÚNICA computação de permissão da fatia que não passa por PERMISSION_LEVELS/resolvePermission: é um COALESCE escrito à mão. Hoje zero testes tocam o campo (grep 'user_permission' em tests/ = 0 hits). Todo teste de authz existente afirma status HTTP vindo de requireAtlasPermission, nunca o tier projetado, então se o COALESCE regredisse (ou fosse trocado por uma lista fechada), TUDO continuaria verde e o co-Gestor/Comentarista sumiria da UI em silêncio, que é exatamente o bug do handleSelection registrado no livro-razao.md:46. Além disso a ordem do COALESCE já diverge do gate: share vence owner.

**Casos:**

- owner faz GET /api/v1/atlas -> o item do seu atlas traz user_permission === 'owner'
- para cada tier ('read','comment','write','manage') criar um share e o membro fazer GET /api/v1/atlas -> user_permission === exatamente aquele tier (os quatro num loop, para que 'comment'/'manage' não possam sumir sem quebrar)
- DIVERGÊNCIA (falha hoje): owner do atlas recebe TAMBÉM uma linha de share 'read' (alcançável por POST /atlas/:id/sharing/users com userId = owner.id, pois addUserShare em sharing.service.js:33-40 não bloqueia o dono) -> GET /atlas devolve user_permission 'read', enquanto DELETE /atlas/:id no mesmo atlas devolve 204 (requireAtlasPermission resolve 'owner'). Asserir que os dois concordam: user_permission === 'owner'
- após POST /atlas/:id/transfer: o ex-dono lista e vê 'manage'; o novo dono lista e vê 'owner' (e não a permissão do share antigo, que foi apagado)
- GET /atlas/trash: o campo é a constante 'owner' (atlas.queries.js:50), asserir para pinar que a lixeira é owner-only também na projeção

### 3. publicLinkLimiter em GET /atlas/public/:link (atlas.routes.js:23)

- **Código:** `backend/src/modules/atlas/atlas.routes.js`
- **Tipo:** integração · **Fatia:** `be-atlas`
- **Cobertura hoje:** rate-limit.test.js cobre apenas /auth/login (authLimiter); nenhum teste chama /atlas/public/:link em volume

**O que o verde provaria.** É o único controle contra enumeração por força bruta do public_link (16 bytes hex) e está nomeado como baseline de segurança no CLAUDE.md do backend. rate-limit.test.js exercita SÓ o authLimiter. Se alguém removesse publicLinkLimiter da rota, ou trocasse a ordem para depois do handler, toda a suíte continuaria verde, o teste que existe hoje não toca essa rota.

**Casos:**

- com process.env.RATE_LIMIT_FORCE='1' (o skip em rate-limit.js:18 é lido por request), fazer config.rateLimit.publicMax + 1 GETs a /api/v1/atlas/public/<link inexistente> -> o último responde 429 com error.code === 'TOO_MANY_REQUESTS'
- o limiter roda ANTES da resolução do link: após estourar a cota com links inválidos, um GET com o link VÁLIDO de um atlas público também recebe 429 (prova que não dá para contornar a cota usando links errados). O limiter é por IP (sem keyGenerator), então isolar num arquivo próprio e rodar por último no arquivo, como faz rate-limit.test.js
- CONTROLE NEGATIVO do próprio teste: sem RATE_LIMIT_FORCE, as mesmas N+1 chamadas devolvem 404/200 e nunca 429, garante que o 429 veio do limiter e não de outra coisa

### 4. importAtlas (atlas.service.js:551-767), referências cruzadas de atlas em groupFeatures / features[].layer_id / groups[].parent_id / slides[].map_id

- **Código:** `backend/src/modules/atlas/atlas.service.js`
- **Tipo:** integração · **Fatia:** `be-atlas`
- **Cobertura hoje:** atlas-import.test.js (só happy path, todas as referências internas ao payload) e atlas-gaps.test.js atlas-03/atlas-10 (id duplicado e stripUnknown); sync-cross-atlas-access.test.js cobre o caminho do SYNC, não o do import

**O que o verde provaria.** O import insere group_id, feature_id, layer_id, parent_id e map_id VERBATIM do payload do cliente, sem checar que pertencem ao atlas sendo importado. As FKs aceitam qualquer UUID existente, inclusive de OUTRO atlas. sync-cross-atlas-access.test.js:107 proíbe exatamente essa escrita pelo caminho do sync ('cross-atlas group_feature link must not be created'), então hoje o invariante está preso de um lado e solto do outro. Consequência concreta: GET_GROUP_FEATURES (sync.queries.js:87-92) escopa por g.map_id, logo a linha injetada APARECE no snapshot da vítima, é escrita cross-tenant, não só sujeira. Um verde hoje não prova nada sobre o import.

**Casos:**

- vítima tem atlas V com map MV, grupo GV, camada LV, feature FV. Atacante faz POST /atlas/import com maps[0].groupFeatures = [{group_id: GV, feature_id: <feature do próprio payload>}] -> esperado 4xx (ou o link ignorado); asserir SELECT count(*) FROM group_features WHERE group_id = GV === contagem anterior. Hoje: 201 e a linha existe
- confirmar o vazamento pelo lado da vítima: GET /atlas/V/sync/0 como owner de V -> snapshot.maps[MV].groupFeatures NÃO contém a feature do atacante
- POST /atlas/import com maps[0].features[0].layer_id = LV (camada de outro atlas) -> rejeitado; asserir que a feature criada tem layer_id NULL ou que nada foi criado
- POST /atlas/import com maps[0].groups[0].parent_id = GV -> rejeitado (hoje cria um grupo do atacante parenteado a um grupo da vítima)
- POST /atlas/import com briefings[0].slides[0].map_id = MV -> rejeitado (hoje o slide do atacante referencia o mapa da vítima)
- CONTROLE POSITIVO: as mesmas quatro referências apontando para ids DENTRO do próprio payload continuam funcionando (201, summary bate, linhas criadas)

### 5. Rotacao de refresh token nao e atomicamente single-use, REVOKE_REFRESH_TOKEN (auth.queries.js:48) nao tem `AND revoked_at IS NULL ... RETURNING`

- **Código:** `backend/src/modules/auth/auth.queries.js`
- **Tipo:** integração · **Fatia:** `be-auth`
- **Cobertura hoje:** backend/tests/integration/auth-gaps.test.js:253 (assercao fraca `<= 1` + race irreproduzivel por HTTP); auth-hardening.test.js:56 cobre reuso sequencial, nao concorrencia.

**O que o verde provaria.** ACHADO EM TESTE EXISTENTE. auth-gaps.test.js:253-276 assere `successes.length <= 1`, predicado satisfeito por ZERO sucessos: se uma regressao fizesse as duas renovacoes concorrentes falharem, o teste e o assert seguinte (token original -> 401) continuam verdes, e o usuario e deslogado de todos os dispositivos por abrir duas abas. Pior, o teste corre a race por HTTP, exatamente a armadilha que low-impact-fixes.test.js:80-85 documenta e resolve racendo o SQL direto: as duas requisicoes serializam por sorte, entao ele nao exercita a race que alega. E o UPDATE de revogacao nao e condicional (diferente do CLAIM_VERIFICATION_TOKEN, que ganhou o padrao `consumed_at IS NULL` no fix L4), logo duas leituras concorrentes podem AMBAS ver revoked_at NULL e emitir duas familias vivas. O mesmo bug de classe foi corrigido no token de e-mail e nao no de refresh.

**Casos:**

- Deterministico (padrao do L4, pool pg com max:2, duas conexoes independentes): correr `UPDATE refresh_tokens SET revoked_at=NOW() WHERE token_hash=$1` em paralelo -> hoje a soma dos rowCount e 2, provando ausencia de exclusao mutua; assertar que a versao endurecida `... AND revoked_at IS NULL RETURNING id` devolve exatamente 1 linha
- E2E: login, disparar 10 POST /auth/refresh concorrentes com o MESMO token -> assertar EXATAMENTE 1 resposta 200 (nunca `<= 1`)
- apos a rajada: SELECT COUNT(*) FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL -> exatamente 1 (nem 0 = usuario deslogado, nem 2 = duas familias vivas)
- o unico token vencedor ainda renova (POST /auth/refresh -> 200), provando que a exclusao mutua nao matou a sessao boa
- controle negativo de deteccao de reuso: reapresentar um token comprovadamente ja rotacionado -> 401 E familia zerada (o ramo de :142 continua funcionando depois do endurecimento)

### 6. login(), gate O1 de organizacao desativada (auth.service.js:92, `orgIsActive` -> ForbiddenError 'Organização inativa')

- **Código:** `backend/src/modules/auth/auth.service.js`
- **Tipo:** integração · **Fatia:** `be-auth`
- **Cobertura hoje:** nenhuma. auth-edge-cases/auth-gaps/auth-live-reconciliation cobrem users.is_active e role, nunca organizations.is_active.

**O que o verde provaria.** Nenhum teste de integracao do repo jamais desativa uma organizacao (grep por `UPDATE organizations`/`is_active=false` em organizations = zero; o unico INSERT com is_active=false esta em tests/ws/collab-reauthz.test.js:70, caminho WS). Se a linha 92 fosse apagada, TODA a suite continua verde e um membro de OM desativada volta a logar, receber accessToken e refreshToken. Hoje o verde nao prova nada sobre este gate.

**Casos:**

- INSERT organizations (nome, slug, is_active=false); criar user com organization_id apontando pra ela; POST /api/v1/auth/login com senha CORRETA -> 403 e body.error.code === 'FORBIDDEN'
- apos o 403: SELECT COUNT(*) FROM refresh_tokens WHERE user_id=$1 -> 0 (prova que abortou ANTES do INSERT_REFRESH_TOKEN em :105)
- apos o 403: users.last_login_at continua NULL (prova que abortou antes do UPDATE_LAST_LOGIN em :97), sem isto o teste nao distingue 'gate antes do efeito' de 'gate depois'
- controle negativo: UPDATE organizations SET is_active=true na mesma org -> mesmo login agora 200 com accessToken (guarda contra over-blocking)
- user com organization_id = NULL -> 200 (isencao documentada em org-status.js:17)
- user com organization_id = UUID de org INEXISTENTE -> 200 (regra 'row missing = active' de org-status.js:9, hoje sem nenhum teste)

### 7. refresh(), gate de org desativada (auth.service.js:165) E a ordem 'revoga primeiro (:154), checa org depois (:165)'

- **Código:** `backend/src/modules/auth/auth.service.js`
- **Tipo:** integração · **Fatia:** `be-auth`
- **Cobertura hoje:** nenhuma para o gate de org. auth-gaps.test.js:217-247 cobre o ramo expirado-nao-revogado, que e um ramo diferente.

**O que o verde provaria.** Mesma cegueira do item anterior: apagar a linha 165 deixa a suite verde e um membro de OM desativada renova sessao indefinidamente (o access token de 15min vira ilimitado). Alem disso a ordem das operacoes tem consequencia nao-obvia e nao coberta: REVOKE_REFRESH_TOKEN roda ANTES do check de org, entao o 403 queima o token; a retentativa cai no ramo revoked_at e dispara REVOKE_ALL_USER_TOKENS, matando todas as sessoes do usuario por um falso positivo de roubo. Nenhum teste observa esse encadeamento.

**Casos:**

- login com org ativa -> guardar refreshToken; UPDATE organizations SET is_active=false; POST /auth/refresh -> 403 FORBIDDEN
- SELECT revoked_at FROM refresh_tokens WHERE token_hash=sha256(refreshToken) -> NAO nulo (documenta que o 403 ja queimou o token, ao contrario do ramo de expiracao, que auth-gaps:246 prova nao revogar)
- repetir POST /auth/refresh com o MESMO token -> 401 e SELECT COUNT(*) FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL -> 0 (a familia inteira caiu por retentativa legitima). Fixar este comportamento ou tratar como repro do defeito
- reativar a org e POST /auth/login -> 200 (caminho de recuperacao existe)
- controle negativo: usuario de org ATIVA faz refresh -> 200 e a familia continua viva

### 8. Login timing-safe, DUMMY_HASH (auth.service.js:19) e o bcrypt.compare incondicional (:73-74)

- **Código:** `backend/src/modules/auth/auth.service.js`
- **Tipo:** integração · **Fatia:** `be-auth`
- **Cobertura hoje:** backend/tests/integration/auth-hardening.test.js:30, cobre apenas a igualdade das mensagens, nao o tempo.

**O que o verde provaria.** auth-hardening.test.js:30 se chama 'timing-safe login' mas so compara as duas MENSAGENS. Se alguem trocasse as linhas 73-76 por `if (!user) throw new UnauthorizedError('Usuário ou senha inválidos')`, a mensagem continua identica, o teste continua verde e o oraculo de timing volta: usuario inexistente responde em ~2ms, senha errada em ~250ms (bcrypt custo 12), permitindo enumeracao de contas em massa. A propriedade que da nome ao teste nao tem teste.

**Casos:**

- warm-up de 2 requests descartadas (JIT + pool); medir mediana de 5 POST /auth/login com username INEXISTENTE
- assertar mediana >= 50ms, margem de ~5x abaixo do bcrypt custo 12 real (~250ms) e ~10x acima do curto-circuito quebrado (<5ms), logo nao flaky
- medir mediana de 5 POST /auth/login com usuario EXISTENTE e senha errada; assertar razao mediana(inexistente)/mediana(senha-errada) dentro de [0.4, 2.5]
- controle do instrumento: assertar que a mediana de senha-errada tambem e >= 50ms (se o instrumento medisse zero em ambos, o teste de razao passaria vazio)
- garantir RATE_LIMIT_FORCE ausente e usernames unicos por amostra, para o limiter nao contaminar a medicao

### 9. I10, auth.logout revoga SO o refresh token: nao fecha o socket de collab nem limpa presenca (auth.service.js:183-186)

- **Código:** `backend/src/modules/auth/auth.service.js`
- **Tipo:** WebSocket · **Fatia:** `be-auth`
- **Cobertura hoje:** nenhuma. collab-lifecycle-coverage/collab-shutdown-presence cobrem close pelo cliente e sweep de heartbeat, nunca o logout.

**O que o verde provaria.** Contrato congelado com o frontend (lifecycle client-driven) e a palavra 'logout' nao aparece UMA vez em backend/tests/ws/ (grep = zero hits). Se alguem 'consertasse' o logout adicionando teardown de socket, nada fica vermelho no backend e o frontend passa a perder a sala de colaboracao no logout, divergindo os peers, exatamente a classe de bug que o E2E de fronteira deveria pegar.

**Casos:**

- usuario A conecta WS em /api/v1/collab?atlasId&token&clientId e entra na sala; POST /api/v1/auth/logout (Bearer + refreshToken) -> 204
- aguardar ~1s e assertar ws.readyState === OPEN e que nenhum frame de close chegou
- peer B faz push de uma operacao no mesmo atlas -> o socket de A AINDA recebe o broadcast `operations` (prova pertinencia a sala, nao apenas TCP vivo)
- roster de presenca ainda lista A depois do logout
- controle negativo (guarda contra o oposto): o refreshToken apresentado no logout esta de fato revogado, POST /auth/refresh com ele -> 401. Sem isto o teste passaria mesmo se o logout nao fizesse nada

### 10. Gate de montagem do /api/v1/debug (isTraceEnabled() && !config.isProd), app.js:117-119

- **Código:** `backend/src/app.js`
- **Tipo:** integração · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/integration/app-mount-gates.test.js`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** I14 diz que qualquer caminho de tracing alcancavel em producao e violacao, e o `!config.isProd` e a UNICA coisa que impede o mount quando EBGEO_TRACE=1 vaza para prod. Hoje zero testes tocam /api/v1/debug: apagar a clausula (ou o gate inteiro) expoe o ring por atlas em producao com a suite 100% verde. Atencao ao par obrigatorio: so a metade '404 em prod' passaria verde ate se o router nunca fosse montado em lugar nenhum (cobertura vazia); e preciso provar tambem que ELE EXISTE fora de prod.

**Casos:**

- In-process (NODE_ENV=test, tracer ligado): GET /api/v1/debug/trace?atlasId=<uuid> sem token -> 401 (nao 404). Prova que o router ESTA montado. Nao precisa de DB: o middleware `auth` rejeita antes de qualquer query.
- Child process com NODE_ENV=production + EBGEO_TRACE=1 + DATABASE_URL/JWT_SECRET(40ch)/CORS_ORIGIN dummy (config.isProd e congelado no import, entao nao da para flipar in-process): import de createApp + supertest, GET /api/v1/debug/trace?atlasId=<uuid> -> 404 com body.error.code === 'NOT_FOUND' (nao 401).
- Mesmo child prod: DELETE /api/v1/debug/trace?atlasId=<uuid> -> 404.
- Terceiro spawn com NODE_ENV=development + EBGEO_TRACE=1 -> 401 (montado). Se os tres spawns derem 404 igualmente, o teste esta vazio e deve falhar.
- Controle negativo: remover `&& !config.isProd` de app.js:117 e confirmar que o caso 2 falha (401 no lugar de 404).

### 11. cors({ origin: config.cors.origin }), origem nao configurada nao pode ser refletida (app.js:49)

- **Código:** `backend/src/app.js`
- **Tipo:** integração · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/integration/config-infra-gaps.test.js (estender infra-05)`
- **Cobertura hoje:** backend/tests/integration/config-infra-gaps.test.js:163-171 (assercao que nao prende)

**O que o verde provaria.** ACHADO DE COBERTURA VAZIA. O teste atual (config-infra-gaps.test.js:163-171) manda `Origin: config.cors.origin` e afirma `ACAO === config.cors.origin`. Com `cors({ origin: true })` (reflete QUALQUER origem) o header sairia identico e o teste continuaria verde: ele nao distingue CORS travado de CORS aberto. Pior, no pacote `cors` um `origin` string e emitido estaticamente, entao a assercao atual e verdadeira ate sem header Origin na request. O unico defeito que ele pega e `origin: '*'` (pelo notEqual). Reformulado, o verde prova que uma origem estranha NAO e refletida.

**Casos:**

- GET /api/v1/config com `Origin: https://evil.example` -> access-control-allow-origin ausente OU === config.cors.origin, e NUNCA === 'https://evil.example'.
- OPTIONS de preflight em /api/v1/atlas com Origin evil + Access-Control-Request-Method: POST -> ACAO nao e a origem evil nem '*', e access-control-allow-credentials nao autoriza a origem evil.
- GET sem header Origin -> ACAO nunca '*' (com credentials:true, '*' e rejeitado pelo browser: quebraria o boot cross-origin do E2E).
- Controle negativo: trocar app.js:49 para `origin: true` e confirmar que o caso 1 FALHA (hoje ele passa com essa troca, que e a prova do achado).

### 12. validateEnvVariables, JWT_SECRET >= 32 caracteres em producao (config.js:226-230)

- **Código:** `backend/src/config.js`
- **Tipo:** unitário · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/unit/config.test.js`
- **Cobertura hoje:** backend/tests/unit/config.test.js:31-93 (usa sempre 40 chars nos casos de producao)

**O que o verde provaria.** Todos os casos 'prod' do teste existente setam JWT_SECRET = 'x'.repeat(40) justamente para que so a regra de CORS dispare, entao a clausula do comprimento minimo nunca e exercitada: apagar as linhas 228-230 nao quebra nada e um deploy passa a assinar HS256 com chave fraca sem aviso nenhum. E fail-fast de seguranca (I13) sem rede.

**Casos:**

- NODE_ENV=production + CORS_ORIGIN valido + JWT_SECRET='segredo' -> throw casando /JWT_SECRET/ e /32/.
- Fronteira: JWT_SECRET com exatamente 31 chars -> throw; com exatamente 32 chars -> nao lanca.
- NODE_ENV=development + JWT_SECRET='curto' -> NAO lanca (a regra e so de producao; sem esse caso o teste nao distingue 'gate de prod' de 'gate global').
- JWT_SECRET ausente (delete) em qualquer env -> throw /JWT_SECRET e obrigatorio/ (o ramo `if (!secret)` tambem esta descoberto: o teste de acumulacao so remove DATABASE_URL).

### 13. Boot fail-fast: validateEnvVariables() roda ANTES de createServer/listen (index.js:11-20)

- **Código:** `backend/src/index.js`
- **Tipo:** integração · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/integration/boot-fail-fast.test.js`
- **Cobertura hoje:** nenhuma (unit/config.test.js testa validateEnvVariables isolado, nunca a sequencia de boot)

**O que o verde provaria.** src/index.js nunca e executado pela suite (tudo usa createApp()). O fail-fast antes do listen e o invariante declarado do arquivo em backend/CLAUDE.md e ninguem o prende: mover `validateEnvVariables()` para depois do `server.listen` deixa os unit tests de validateEnvVariables verdes e passa a aceitar conexao com config invalida (ex.: JWT_REFRESH_EXPIRY que nasce expirado). ARMADILHA A EVITAR NO TESTE: os ramos DATABASE_URL/JWT_SECRET de validateEnvVariables sao INALCANCAVEIS no boot real, porque `import app from './app.js'` avalia config.js primeiro e `required()` lanca antes; usar uma dessas vars faria um teste que passa sem exercitar o fail-fast.

**Casos:**

- spawn `node src/index.js` com env valido + JWT_REFRESH_EXPIRY='1w' + PORT=<porta livre>: exit code != 0; stderr casa /Configuracao invalida/ E /JWT_REFRESH_EXPIRY/; stdout NUNCA contem 'EBGeo backend started'; conexao TCP a essa porta e recusada.
- spawn sem DATABASE_URL: exit != 0 e a mensagem observada e /Missing required env var: DATABASE_URL/ (pina a ordem import-time vs validate; se um dia virar o sumario acumulado, a ordem mudou).
- Controle positivo obrigatorio: spawn com env inteiramente valido -> stdout contem 'EBGeo backend started' e GET http://127.0.0.1:<porta>/api/v1/health -> 200; matar o child no fim. Sem esse caso, 'nao subiu' passaria verde por qualquer motivo (typo no caminho do script, cwd errado).
- Controle negativo: mover a chamada de validateEnvVariables() para depois do server.listen e confirmar que o caso 1 falha (a porta passa a aceitar conexao).

### 14. Ligacao rota->tabela dos 5 makeCatalogRouter (app.js:102-106) e o round-trip escrita-admin -> GET /api/config para data_layers / analysis_layers / tilesets

- **Código:** `backend/src/app.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/catalog-tables.test.js`
- **Cobertura hoje:** backend/tests/integration/catalog.test.js e images-gaps.test.js (so /api/v1/basemaps); config-infra-gaps.test.js le tilesets/data_layers via INSERT direto no banco, nunca pela rota

**O que o verde provaria.** Nenhuma escrita HTTP jamais tocou 4 dos 5 routers. Se app.js montasse /api/v1/analysis-layers com makeCatalogRouter('data_layers') (uma troca de uma palavra), o painel admin passaria a editar o catalogo errado, camadas de analise sumiriam do /api/config e o app subiria sem elas: zero testes cairiam, porque todo o conjunto atual so exercita 'basemaps'. O nome da rota tambem e contrato com o frontend (api-client.js:423 mapeia streetview_marker -> streetview-markers).

**Casos:**

- Para cada par [rota, tabela] em [['basemaps','basemaps'],['data-layers','data_layers'],['analysis-layers','analysis_layers'],['tilesets','tilesets'],['streetview-markers','streetview_markers']]: POST /api/v1/<rota> com id unico como admin -> 201; SELECT COUNT(*) FROM <tabela> WHERE id=$1 === 1 E COUNT(*) === 0 em cada uma das outras quatro tabelas (o discriminador que pega a montagem trocada).
- Contar o laco: assert que 5 pares foram efetivamente exercitados (guard anti-C4, senao um array vazio passa verde).
- GET /api/v1/<rota>/:id como usuario nao-admin -> 200 (leitura so exige auth) e DELETE como nao-admin -> 403 nas cinco rotas.
- Round-trip para o /api/config: criar data_layer {id, name, config:{url:'/x'}} -> GET /api/config e a entrada aparece em dataLayers.layers com id e name; criar analysis_layer com config:{bounds:[-50,-30,-40,-20]} -> aparece em analysisLayers.layers; criar analysis_layer com config:{} -> NAO aparece (filtro de bounds); criar tileset {config:{url:'/3d/t/tileset.json'}} -> aparece em tilesets.
- DELETE de cada item criado -> 204 e some da secao correspondente do /api/config (fecha o ciclo soft-delete -> payload publico).

### 15. assertValidStyle no caminho de UPDATE (catalog.service.js:55) e o invariante de que todo basemapStyles servido por GET /api/config e um style MapLibre valido

- **Código:** `backend/src/modules/catalog/catalog.service.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/catalog.test.js`
- **Cobertura hoje:** backend/tests/integration/catalog.test.js (so no POST); backend/tests/integration/config-admin.test.js (override de style valido, caso feliz)

**O que o verde provaria.** catalog.test.js valida style SO no POST (400/201). Se `assertValidStyle(data.config)` sumir do updateCatalogItem, um PUT admin persiste `{style:{version:7}}`, listBasemapStyles copia esse style VERBATIM para GET /api/config, e o boot fail-fast do frontend quebra para todo mundo. Toda a suite fica verde: e exatamente o caso 'conferi o POST e tratei como se fosse o conjunto' (C2b). O guarda existe justamente porque o style vai cru para o cliente (docstring de maplibre-style-validate.js).

**Casos:**

- Criar basemap valido; PUT /api/v1/basemaps/:id {config:{style:{version:7,sources:{},layers:[]}}} como admin -> 400, e SELECT config FROM basemaps WHERE id=$1 mostra que o style NAO foi gravado (assere no Postgres, nao no corpo da resposta).
- PUT {config:{style:{version:8,sources:{}}}} (sem layers) -> 400; PUT {config:{style:'nao-e-objeto'}} -> 400; PUT {config:{style:[]}} -> 400 (array e rejeitado pelo validador).
- PUT {config:{style:{version:8,sources:{},layers:[{id:'bg',type:'background'}]}}} -> 200 e GET /api/config expoe esse style em basemapStyles[<id>] identico ao enviado.
- PUT {config:{url:'https://x/{z}/{x}/{y}.png'}} SEM chave style -> 200 (assertValidStyle so dispara quando style !== undefined; sem este caso a regra poderia virar 'todo update exige style').
- Invariante de fechamento: apos os PUTs acima, GET /api/config e para CADA entrada de basemapStyles rodar validateMapLibreStyle(...).ok === true; guard obrigatorio Object.keys(basemapStyles).length >= 5 antes do laco (senao a varredura passa verde sobre lista vazia, C4).

### 16. requireAdmin em DELETE /api/v1/config/admin (e o 401 anonimo nas tres rotas /config/admin)

- **Código:** `backend/src/modules/config/config.routes.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/config-admin.test.js`
- **Cobertura hoje:** backend/tests/integration/config-admin.test.js (403 so em GET e PUT; DELETE testado apenas no caminho admin feliz)

**O que o verde provaria.** config-admin.test.js checa 403 de nao-admin em GET e PUT e trata isso como se cobrisse o conjunto; DELETE, que e a valvula destrutiva (apaga TODOS os overrides de sistema de uma vez), nao tem nenhum teste de gate. Remover `requireAdmin` da linha do delete deixa qualquer usuario autenticado zerar a config de todo o deployment, e a suite inteira fica verde. Padrao C2b, e o mesmo raciocinio que motivou audit-cov-05.

**Casos:**

- Admin faz PUT /config/admin {app:{title:'Sentinela'}}; usuario comum (role 'user', com token valido) faz DELETE /api/v1/config/admin -> 403; em seguida GET /api/config ainda devolve app.title === 'Sentinela' (assere que o efeito NAO ocorreu, nao so o status).
- Anonimo (sem header Authorization): GET /config/admin -> 401, PUT /config/admin {app:{title:'x'}} -> 401, DELETE /config/admin -> 401, com body.error.code === 'UNAUTHORIZED' (auth estrito dispara antes de requireAdmin; um requireAdmin lendo req.user.role sem auth daria 500).
- Admin DELETE -> 200 e GET /api/config volta ao STATIC ('EBGeo'), fechando o par positivo/negativo no mesmo arquivo.

### 17. GET/DELETE /api/v1/debug/trace, gate por atlas (liftAtlasIdToParams + requireAtlasPermission 'read'/'manage') e IDOR cross-atlas

- **Código:** `backend/src/modules/debug/debug.routes.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/debug-trace-authz.test.js`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** Hoje ZERO requests batem nesta rota em todo o backend. Se alguem trocar os gates por `auth` simples (o estado anterior, descrito no proprio docstring), ou escrever a lista fechada `permission === 'write' || permission === 'owner'` (C1), ou reintroduzir o fallback 'limpa TODOS os aneis' quando falta atlasId, NENHUM teste do repo cai. Um verde hoje prova literalmente nada sobre autorizacao aqui: qualquer portador de token le e apaga o ring de qualquer atlas.

**Casos:**

- GET /api/v1/debug/trace?atlasId=<A> sem Authorization -> 401 UNAUTHORIZED (auth vem antes do lift).
- GET /api/v1/debug/trace SEM atlasId, com token valido -> 400 BadRequest ('atlasId is required'); prova que o lift rejeita antes de qualquer leitura.
- Usuario U sem share nenhum no atlas A (nao owner, role 'user'): GET ...?atlasId=A -> 403. Negativo de acesso exigido pelo CLAUDE.md.
- U com share 'read' em A: seedar spans com recordSpan(A,'server.inserted',{opId:'op-1'}) importado de src/utils/sync-trace.js e GET -> 200, body.data.spans.length === 1, spans[0].opId === 'op-1', body.data.enabled === true.
- U com share 'comment' em A: GET -> 200 (comment >= read na hierarquia; uma comparacao por igualdade a 'read' daria 403).
- U com share 'write' em A: DELETE ...?atlasId=A -> 403. ESTE e o caso que distingue hierarquia de lista fechada: write < manage.
- U com share 'manage' em A: DELETE -> 200 {cleared:true}; GET seguinte devolve spans [] para A, E o ring do atlas B (seedado antes) continua com seus spans -> prova que limpa UM anel, nao todos.
- Owner de A (sem share) e admin global: DELETE -> 200 (owner=5 e admin sintetizado como owner satisfazem manage).
- IDOR: U tem 'manage' em A e NADA em B (de outro dono). DELETE ...?atlasId=B -> 403 e, na sequencia, GET do dono de B ainda devolve os spans de B intactos (assere contra o ring, nao contra o status).

### 18. Handshake identity gate (`server.on('upgrade')` em attachWebSocket): usa `orgIsActive(payload.organization_id)` do TOKEN e `payload.role`, e NUNCA chama `getLiveAuthState`

- **Código:** `backend/src/modules/collab/collab.gateway.js`
- **Tipo:** WebSocket · **Fatia:** `be-collab`
- **Cobertura hoje:** backend/tests/ws/collab-reauthz.test.js cobre exatamente estes cenarios, mas SO via reconcileAuthorization com fakeSocket (socket ja aberto). backend/tests/ws/collab-roles.test.js cobre o bypass de admin no handshake apenas com admin ainda vigente. Nenhum teste conecta com identidade revogada.

**O que o verde provaria.** Hoje NENHUM teste toca o gate de identidade no upgrade. `reconcileAuthorization` (linha 126) declara o principio P1 ("conta desativada / admin rebaixado perde acesso IMEDIATAMENTE") e le o banco; o handshake, na mesma pagina, decide so pelo claim do JWT. Consequencia real: um usuario DESATIVADO com access token valido (JWT_ACCESS_EXPIRY=15m) abre socket novo, escreve por ate 30s ate o sweep derrubar, e reconecta em loop durante 15 minutos. Idem para admin rebaixado, que `resolvePermission` promove a `owner` em QUALQUER atlas via `payload.role === 'admin'` (linha 83). Um verde aqui provaria que o gate vive nos DOIS pontos de entrada, nao so no sweep. ATENCAO: espero que estes casos FALHEM contra o codigo atual - e repro de lacuna, nao cobertura de comportamento vigente. Confirme antes de commitar verde.

**Casos:**

- usuario com share 'write' conecta OK (controle positivo, prova que o fixture nao esta quebrado) -> recebe frame `connected` com permission 'write'
- UPDATE users SET is_active=false para esse mesmo usuario, MESMO token, nova conexao -> handshake rejeitado (sem frame `connected`; o helper rawConnect de collab-gaps.test.js devolve connected:false)
- nenhuma linha nova em active_sessions para o usuario desativado (o gate tem de barrar ANTES de onConnection)
- admin global (token com role:'admin') conecta em atlas de terceiro -> permission 'owner'; depois UPDATE users SET role='user', MESMO token, nova conexao -> handshake rejeitado (sem share, sem admin)
- usuario cuja organization_id mudou no banco para uma org DESATIVADA, mas cujo token ainda carrega a org antiga (ativa) -> handshake rejeitado (o gate atual consulta a org do claim, nao a viva)

### 19. `heartbeatSweep(wss)` -> `reconcileAuthorization(ws)` sobre socket REAL (fio entre o sweep, o estado do socket e os handlers)

- **Código:** `backend/src/modules/collab/collab.gateway.js`
- **Tipo:** WebSocket · **Fatia:** `be-collab`
- **Cobertura hoje:** backend/tests/ws/collab-reauthz.test.js (so fakeSocket, nunca o sweep nem um socket real) e backend/tests/ws/collab-heartbeat-gaps.test.js (so o reap por isAlive, sem authz).

**O que o verde provaria.** collab-reauthz.test.js prova a LOGICA de reconcileAuthorization contra um objeto literal; collab-heartbeat-gaps.test.js prova o reap por isAlive sem nenhuma mudanca de autorizacao. Se alguem removesse a chamada `reconcileAuthorization(ws)` de dentro de heartbeatSweep (linha 180), ou se attachWebSocket parasse de agendar o setInterval, TODOS os testes atuais continuariam verdes: e a forma (b) da verificacao-fantasma (conferir o subconjunto e tratar como conjunto). Alem disso o downgrade write->read so tem valor se o HANDLER passar a recusar: hoje nada liga `ws.permission` mutado ao `FORBIDDEN` de handleOperation. Note que heartbeatSweep NAO da await em reconcileAuthorization, entao o teste precisa aguardar por observavel (close/erro), nao por retorno.

**Casos:**

- owner + writer conectados no mesmo atlas; DELETE do atlas_shares do writer; heartbeatSweep(wss) -> o socket REAL do writer fecha com codigo 4003 (capturar via ws.on('close', code)) e o peer owner recebe `user_left` com o userId do writer
- writer conectado; UPDATE atlas_shares SET permission='read'; heartbeatSweep(wss) -> socket permanece OPEN (readyState 1) e o `connected` anterior nao e reemitido
- no MESMO socket rebaixado, enviar {type:'operation'} bem formado -> frame `error` code FORBIDDEN, e 0 linhas em operations WHERE op_id=$1 e 0 em features com o marcador (a permissao vive no ws, o gate tem de valer sem reconectar)
- controle negativo do gate: antes do downgrade o mesmo op e acked (prova que o op so falha por causa da reconciliacao, nao por estar malformado)
- usuario desativado (UPDATE users SET is_active=false) com socket aberto -> heartbeatSweep -> close 4003 e a linha correspondente em active_sessions desaparece

### 20. Serializacao de mensagens por socket (`ws._messageChain`, encadeamento com await em onConnection)

- **Código:** `backend/src/modules/collab/collab.gateway.js`
- **Tipo:** WebSocket · **Fatia:** `be-collab`
- **Cobertura hoje:** backend/tests/integration/sync-push-serialization.test.js cobre apenas o advisory lock por atlas via HTTP/supertest; nao ha WebSocket nele.

**O que o verde provaria.** Regressao AUSENTE para bug ja registrado: livro-razao.md 2026-07-18 `regressao-propria` - "advisory lock tomado depois de abrir a transacao... com o dispatcher WS sem await, um cliente sozinho esgotava o pool -> lock_timeout + serializacao por socket". A metade do fix que vive no lock esta coberta por tests/integration/sync-push-serialization.test.js; a metade que vive NESTE arquivo (o encadeamento por socket) nao tem teste nenhum, em nenhuma suite. Se o `.then(() => handleMessage(...))` voltasse a ser fire-and-forget, todos os testes de collab seguem verdes porque todos enviam UM op e esperam o ack antes do proximo - ninguem faz rajada. Controle negativo esperado: sem o encadeamento, N pushes concorrentes disputam o advisory lock e a ordem dos acks deixa de acompanhar a ordem de envio.

**Casos:**

- um unico socket de owner envia 20 {type:'operation'} em rajada, SEM esperar ack entre eles, cada op com properties.seq = 0..19 -> chegam 20 frames `ack`, e a sequencia de ack.opId e IDENTICA a ordem de envio
- nenhum frame `error` chega durante a rajada (sem OPERATION_FAILED por exaustao de pool / lock_timeout)
- as 20 linhas em operations WHERE atlas_id=$1 tem server_version crescente na mesma ordem de properties.seq (a ordem do cliente e preservada na autoridade, nao so nos acks)
- rajada create-entao-update na MESMA entidade sem esperar ack -> o estado final em features tem o valor do update (sem serializacao o update pode chegar antes do create existir e afetar 0 linhas, sumindo em silencio)
- o socket continua vivo depois da rajada: {type:'ping'} responde `pong`

### 21. Regra de visibilidade de comentario espacial no fan-out WS: `broadcastToRoom(..., {skipReadOnly: isComment})` em handleOperation e a divisao de lote em `broadcastOperations`

- **Código:** `backend/src/modules/collab/collab.handlers.js`
- **Tipo:** WebSocket · **Fatia:** `be-collab`
- **Cobertura hoje:** backend/tests/ws/collab-commenter-authz.test.js (escrita do comentarista, nao entrega); backend/tests/integration/comments.test.js (caminho REST/pull, nao o fan-out WS).

**O que o verde provaria.** collab-commenter-authz.test.js cobre o lado de ESCRITA do comentarista; ninguem cobre o lado da ENTREGA. O gate e `client.permission === 'read'`, uma igualdade sobre nivel de permissao - exatamente a forma da classe C1. Aqui a igualdade e correta (so o piso `read` fica de fora, `comment` para cima ve), mas nada prende essa fronteira: se virasse `permission !== 'write'` ou `['write','owner'].includes(...)`, o Comentarista e o co-Gestor parariam de receber comentarios em silencio, sem erro nem log. Um verde tem de provar as DUAS bordas: quem e excluido e quem NAO pode ser excluido. O lote misto e o caso que mais facilmente regride: o viewer precisa continuar recebendo as ops NAO-comentario do mesmo lote.

**Casos:**

- sala com owner (autor), peer 'comment' e peer 'read'; owner envia {type:'operation'} com entityType 'comment' -> o peer comment recebe frame `operation`; o peer read NAO recebe nenhum `operation` apos 300ms
- mesma sala, op de feature -> os TRES tiers recebem (prova que o skip e especifico de comentario, nao um mudo geral do read)
- lote misto {type:'operations', ops:[featureOp, commentOp]} -> o peer read recebe UM frame `operations` com ops.length === 1 e apenas o featureOp; o peer comment recebe ops.length === 2
- lote 100% de comentario -> o peer read nao recebe frame `operations` algum; o peer comment recebe
- peer 'manage' (co-Gestor) recebe o commentOp (controle da hierarquia: o nivel do meio nao pode sumir)

### 22. Backpressure em `broadcastToRoom` / `broadcastOperations` (BACKPRESSURE_DROP_BYTES 1 MiB e BACKPRESSURE_KILL_BYTES 8 MiB)

- **Código:** `backend/src/modules/collab/collab.rooms.js`
- **Tipo:** unitário · **Fatia:** `be-collab`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** Zero ocorrencias de bufferedAmount/BACKPRESSURE em tests/ - a regra inteira e cobertura zero. O invariante e de INTEGRIDADE DE DADO, nao de performance: frame coalescavel (cursor/temporal/selection) pode ser descartado porque o proximo o supersede, mas op DURAVEL nunca pode ser descartada em silencio (o peer divergiria para sempre); acima do teto ela e terminada para reconectar e replayar via sync_request. Se alguem invertesse os dois ramos, ou aplicasse o drop coalescavel a `operations`, nada hoje acusaria. Testavel PURO: `joinRoom` e exportado, entao basta um cliente falso {readyState:1, bufferedAmount, permission, clientId, send, terminate} - sem banco, sem socket. Use um atlasId unico por caso e faca leaveRoom no final para nao vazar estado de modulo entre testes.

**Casos:**

- cliente com bufferedAmount = 2*1024*1024 recebendo {type:'cursor'} -> send NAO chamado, terminate NAO chamado, retorno {sent:0, recipients:[]}
- MESMO cliente (2 MiB) em broadcastOperations com 1 op de feature -> send CHAMADO uma vez e recipients inclui seu clientId (op duravel nunca e descartada)
- fronteira exata: bufferedAmount === (1<<20) com {type:'cursor'} -> send CHAMADO (a comparacao e `>` estrita, nao `>=`)
- bufferedAmount = 9*1024*1024 em broadcastToRoom -> terminate() chamado, send NAO chamado, sent nao conta o cliente
- bufferedAmount = 9*1024*1024 em broadcastOperations -> terminate() chamado, send NAO chamado, e o retorno traz skippedClosed === 1 (e nao skippedReadOnly)
- sala mista: um cliente sadio (bufferedAmount 0) + um afogado (9 MiB); um `cursor` -> o sadio recebe, sent === 1 (um cliente lento nao pode calar a sala inteira)

### 23. Operacao cujo payload viola um CHECK do schema (layers.opacity, features.feature_type, cesium3d_data.data_type, streetview360_data.data_type, comments.status, slides.mode)

- **Código:** `backend/src/database/migrations/002_atlas.sql`
- **Tipo:** integração · **Fatia:** `be-database`
- **Cobertura hoje:** parcial e insuficiente: sync-validation.test.js cobre so violacoes de envelope (sem operations, >500 ops, id ausente); sync-batch-atomicity.test.js prova o rollback do lote mas usando falha de autorizacao, nunca uma violacao de constraint; features-all-types.test.js cobre os 20 tipos VALIDOS, nenhum invalido

**O que o verde provaria.** `data` e `changes` sao `Joi.object().unknown(true)` (sync.schemas.js:21-23), entao o CHECK do banco e o UNICO validador desses valores, e o push inteiro roda numa transacao unica (sync.service.js:633). Uma unica op com `opacity: 1.5` ou `feature_type` fora da lista de 20 estoura 23514 no meio do lote: as outras 499 ops sao revertidas e o cliente, que so sabe reenfileirar, retenta o mesmo lote para sempre -- fila de sync travada em silencio. Nenhum teste manda um payload que viole CHECK (grep de opacity/23514/tipo invalido em tests/integration/sync*.test.js so acha valores validos). Precedente real no proprio codigo: o mesmo padrao com 22P02 (targetId nao-UUID) ja '400ava o push inteiro' e teve de ser corrigido (sync.service.js:684-689). Um verde hoje prova apenas que o caminho feliz funciona.

**Casos:**

- push [op valida A, op update de layer com `changes:{opacity: 1.5}`] -> status != 500 (contrato de erro: 400/422 nomeando a op ofensora) E a feicao de A NAO existe no banco (atomicidade do lote preservada)
- push de create de feature com `data.feature_type:'trajetoria'` (fora do CHECK valid_feature_type) -> mesmo contrato; a resposta precisa identificar QUAL op falhou, senao o cliente nao tem como descartar a op envenenada
- push de create cesium3d com `data.data_type:'heatmap'` e de update de comment com `changes:{status:'closed'}` -> mesmo contrato (cobre os outros dois CHECKs que o sync escreve sem validar)
- controle negativo no mesmo teste: as mesmas quatro ops com valores validos (opacity 0.5, 'point', 'marker', 'resolved') retornam 200 e persistem -- prova que o vermelho acima veio do CHECK e nao do setup
- borda: `opacity: 0` e `opacity: 1` passam (limites inclusivos do CHECK layers_opacity_range), `-0.0001` e `1.0001` nao

### 24. trg_update_atlas_version / atlas.current_version como cursor de sync

- **Código:** `backend/src/database/migrations/003_sync.sql`
- **Tipo:** integração · **Fatia:** `be-database`
- **Arquivo sugerido:** `backend/tests/integration/sync-version-cursor.test.js`
- **Cobertura hoje:** nenhuma (zero hits de `current_version` em backend/tests; sync-snapshot-hybrid.test.js exercita o caminho snapshot-vs-incremental mas nao afirma sobre a coluna nem sobre a igualdade entre as duas fontes)

**O que o verde provaria.** O cursor incremental do sync tem DUAS fontes de verdade e nada as amarra: o snapshot devolve `atlas.current_version` (coluna mantida pelo trigger, sync.service.js:577 via GET_ATLAS_METADATA) e o ack do push devolve `COALESCE(MAX(server_version),0)` calculado (sync.queries.js:22, sync.service.js:767); a decisão snapshot-vs-incremental le a coluna (GET_ATLAS_SYNC_INFO). As duas so coincidem porque o trigger dispara a cada INSERT em operations. `current_version` tem ZERO ocorrencias em tests/ (grep completo em backend/tests). Se o trigger for removido/quebrado por uma migracao futura, ou passar a nao filtrar por NEW.atlas_id, um verde hoje nao prova nada: o cliente ancora `lastVersion` num numero errado e o pull incremental `WHERE server_version > $lastVersion` pula ops para sempre. E exatamente a classe de perda de dado que o comentario P2 em sync.service.js:640-644 descreve e que o advisory lock do push existe para evitar.

**Casos:**

- push de 3 ops de create no atlas A -> assertar a IGUALDADE tripla: `SELECT current_version FROM atlas WHERE id=A` == `SELECT MAX(server_version) FROM operations WHERE atlas_id=A` == `currentVersion` do GET snapshot == `serverVersion` do ack do push
- push de 1 op no atlas B (mesmo dono) -> `atlas A.current_version` permanece inalterado (prende o `WHERE id = NEW.atlas_id` do trigger; sem ele o cursor de A avanca por trafego de B e A perde ops)
- reenvio idempotente do mesmo op_id -> nenhuma linha nova em operations e `current_version` NAO avanca (ON CONFLICT DO NOTHING nao dispara o trigger)
- `atlas.updated_at` avanca a cada push (o trigger tambem escreve updated_at; e o campo de 'ultima modificacao' do project-picker)
- apos POST /sync/:id/admin/cleanup que apaga TODAS as ops: assertar explicitamente a divergencia resultante (`atlas.current_version` permanece no ultimo valor; `MAX(server_version)` vira 0) e qual das duas o snapshot devolve -- hoje ninguem documenta qual o cliente deve ancorar

### 25. LIST_IMAGES_BY_ATLAS, filtro de tenant `WHERE atlas_id = $1` em GET /atlas/:atlasId/images

- **Código:** `backend/src/modules/images/images.queries.js`
- **Tipo:** integração · **Fatia:** `be-images`
- **Arquivo sugerido:** `backend/tests/integration/images-list-tenant-isolation.test.js`
- **Cobertura hoje:** backend/tests/integration/images.test.js:154-184 (lista, mas so afirma length > 0 e ausencia de storage_path)

**O que o verde provaria.** COBERTURA VAZIA de alta prioridade. As duas assercoes de listagem hoje sao `assert.ok(res.body.data.length > 0)` (+ ausencia de storage_path). Se o `AND atlas_id = $1` fosse removido da query, o array so ficaria MAIOR e os dois testes seguiriam verdes, vazando metadado (filename, uploaded_by, size, created_at, id) de todas as imagens de todos os atlas para qualquer usuario com 'read', inclusive para o public-token de um atlas publico. O CLAUDE.md exige teste negativo para todo filtro de acesso, e este e o unico filtro de tenant da rota de listagem. O verde atual prova apenas que a lista nao esta vazia.

**Casos:**

- atlasA (owner) com 2 imagens e atlasB (outro dono) com 1 imagem -> GET /atlas/A/images como owner de A -> data contem exatamente os 2 ids de A e NAO contem o id de B (assercao por conjunto de ids, nao por length > 0)
- mesmo cenario, reader com share 'read' em A -> GET /atlas/A/images -> nenhum id pertencente a B
- atlas publico com public-token -> GET /atlas/:pub/images -> so ids do atlas publico; imagem de atlas privado do mesmo dono ausente
- guard de lista nao-vazia: assert de que a fixture criou >= 1 imagem em B antes de afirmar a ausencia (senao a assercao de exclusao passaria por vacuidade)

### 26. requireAtlasPermission('write') nas rotas de escrita de imagem (POST /, POST /bulk, DELETE /:imageId), hierarquia read < comment < write < manage < owner

- **Código:** `backend/src/modules/images/images.routes.js`
- **Tipo:** integração · **Fatia:** `be-images`
- **Arquivo sugerido:** `backend/tests/integration/images-permission-hierarchy.test.js`
- **Cobertura hoje:** backend/tests/integration/images.test.js (owner/write/read/stranger/public-token apenas); backend/tests/unit/middleware-permissions.test.js (resolvePermission sem 'manage'/'comment')

**O que o verde provaria.** Hoje NENHUM teste do repo exercita 'manage' nem 'comment' nestas rotas: images.test.js so usa owner/write/read/stranger/public-token, e tests/unit/{middleware-permissions,permission-resolver}.test.js so cobrem owner/write/read/public/null (grep por 'manage' nos dois retorna zero). Se alguem trocasse o gate por uma lista fechada `perm === 'write' || perm === 'owner'` (o bug C1, ja ocorrido duas vezes), a suite inteira ficaria VERDE enquanto o co-Gestor perderia upload/delete de imagem em silencio. E se a hierarquia fosse invertida (comment acima de write), tambem nada falharia. O verde de hoje prova apenas que owner e write passam e que read nao passa.

**Casos:**

- share 'manage' no atlas -> POST /atlas/:id/images com PNG valido -> 201, e a linha existe em images com atlas_id correto
- share 'manage' -> POST /atlas/:id/images/bulk com 1 PNG base64 -> 201 e uploaded.length === 1
- share 'manage' -> DELETE /atlas/:id/images/:imageId de imagem enviada pelo owner -> 204 e a linha some do banco
- share 'comment' -> POST /atlas/:id/images -> 403 e contagem de images do atlas inalterada (comment=2 < write=3)
- share 'comment' -> DELETE /atlas/:id/images/:imageId -> 403 e a imagem sobrevive
- share 'comment' -> GET /atlas/:id/images -> 200 (comment >= read: o gate de leitura nao pode virar igualdade em 'read')

### 27. images.service.js:46, clausula `detected.mime !== file.mimetype` da validacao dupla (magic bytes vs tipo declarado), e a equivalente do bulk em :175

- **Código:** `backend/src/modules/images/images.service.js`
- **Tipo:** integração · **Fatia:** `be-images`
- **Arquivo sugerido:** `backend/tests/integration/images-type-double-validation.test.js`
- **Cobertura hoje:** backend/tests/integration/images-hardening.test.js:48-57 (so o caso `!detected`) e :106-127 (bulk, tambem so `!detected`)

**O que o verde provaria.** A validacao dupla tem tres clausulas e so a primeira (`!detected`) esta exercitada: images-hardening.test.js manda '<html>not a png</html>' como image/png (file-type devolve undefined) e o SVG e barrado antes, no fileFilter do multer (tipo DECLARADO). As clausulas `!ALLOWED_MIME_TYPES.includes(detected.mime)` e, sobretudo, `detected.mime !== file.mimetype` nunca rodam. Se a comparacao de igualdade fosse removida (deixando so `ALLOWED.includes(detected.mime)`), o par declarado/real passaria a divergir sem erro: o Content-Type gravado no banco e devolvido no download passaria a mentir sobre o conteudo do arquivo, e o download confia nesse mime_type para montar o header. Nenhum teste de hoje falharia.

**Casos:**

- POST /images com bytes JPEG reais mas contentType 'image/png' e filename 'x.png' -> 400 com error.code BAD_REQUEST e nenhuma linha nova em images
- POST /images com bytes WebP reais declarados 'image/jpeg' -> 400 (par cruzado dentro da allowlist)
- POST /images com bytes GIF (ou PDF) declarados 'image/png' -> 400 (clausula `!ALLOWED.includes(detected.mime)`: detectado valido porem fora da allowlist)
- POST /images/bulk com JPEG_B64 declarado mimeType 'image/png' -> 201 com uploaded.length === 0, failed[0].error === 'Content does not match declared type' e mapping vazio
- controle positivo no mesmo arquivo: JPEG declarado 'image/jpeg' -> 201 (garante que os 400 acima vem do mismatch e nao de um fixture quebrado)

### 28. bulkUploadImages + INSERT_IMAGE_WITH_ID, PK escolhida pelo CLIENTE (localId) numa tabela de chave global, colidindo com imagem de OUTRO atlas

- **Código:** `backend/src/modules/images/images.service.js`
- **Tipo:** integração · **Fatia:** `be-images`
- **Arquivo sugerido:** `backend/tests/integration/images-bulk-pk-collision.test.js`
- **Cobertura hoje:** backend/tests/integration/images-gaps.test.js:237-268 (img-06: localId duplicado dentro do MESMO batch, ramo `seenLocalIds`); nenhuma cobertura de colisao entre atlas

**O que o verde provaria.** O bulk deixa o cliente escolher o id da linha (`INSERT_IMAGE_WITH_ID`, $1 = image.localId). O unico obstaculo para escrever sobre a imagem de outro tenant e o unique_violation do PK, tratado como falha por item. Isso nunca foi testado: se a query virasse `ON CONFLICT (id) DO UPDATE` (mudanca que pareceria uma melhoria de idempotencia de reimportacao), um usuario com 'write' em QUALQUER atlas passaria a reescrever filename/mime_type/storage_path/uploaded_by da imagem de um atlas alheio apenas adivinhando/copiando o id, e nenhum teste atual acusaria. O de img-06 so cobre colisao DENTRO do mesmo batch, que segue outro ramo (`seenLocalIds`).

**Casos:**

- owner de atlasB envia bulk com localId igual ao id de uma imagem existente em atlasA -> 201 com uploaded.length === 0 e failed[0].error contendo mensagem de unique violation; mapping sem a chave
- a linha de atlasA permanece BYTE-A-BYTE intacta apos a tentativa: atlas_id, filename, mime_type, size_bytes, storage_path e uploaded_by iguais aos de antes (esta e a assercao que prende o DO NOTHING)
- nenhuma linha nova criada em atlasB (COUNT antes === COUNT depois)
- reimportacao do MESMO atlas (mesmo localId, mesmo atlas) -> item vai para failed, e a imagem original continua baixavel por GET /:imageId com o conteudo antigo

### 29. broadcastToRoom({type:'maps_merged'}) em maps.controller.js:19-23 (invariante I16)

- **Código:** `backend/src/modules/maps/maps.controller.js`
- **Tipo:** WebSocket · **Fatia:** `be-maps-briefings`
- **Arquivo sugerido:** `backend/tests/ws/collab-broadcasts.test.js`
- **Cobertura hoje:** nenhuma. backend/tests/ws/collab-broadcasts.test.js cobre atlas_deleted/atlas_updated/atlas_settings_updated/sharing/sync push, mas nao merge; e o lugar natural do novo describe.

**O que o verde provaria.** Hoje ZERO teste (frontend ou backend) toca esse broadcast: grep de 'maps_merged' em backend/ acha exatamente 1 hit, o proprio src. Se a chamada fosse apagada, todos os 20+ testes de merge continuariam verdes, e nenhum peer conectado saberia do merge NUNCA: pullChanges (sync.service.js:812) le da tabela `operations`, e mergeMaps nao grava nenhuma linha de operacao nem move atlas.current_version. Ou seja, esse broadcast e o UNICO caminho de convergencia existente, e e justamente o unico nao verificado. Do lado do frontend ele ja e consumido (ws-client.js:353-354 -> serverResync), entao a ponta que falta e so a emissao.

**Casos:**

- dois clientes WS (owner e um share 'write') no mesmo atlasId, ambos apos waitForType('connected') e clearMessages(); owner faz POST /api/v1/atlas/:id/maps/:dest/merge {sourceMapIds:[src]} -> o cliente do writer recebe {type:'maps_merged', destMapId: dest.id, sourceMapIds:[src.id]} (assertar os TRES campos, nao so o type)
- o proprio autor do merge tambem recebe a mensagem (broadcastToRoom e chamado sem excludeWs em maps.controller.js:19) -> pinar esse eco, porque o frontend responde com um resync completo e a assimetria com as rotas de collab que passam excludeWs e proposital-ou-bug
- merge que FALHA nao emite nada: POST merge com destMapId = randomUUID() -> 404 e o cliente peer NAO recebe nenhuma mensagem 'maps_merged' (janela de espera curta + assert de ausencia)
- self-merge {sourceMapIds:[dest.id]} -> 200 com moved {} e mesmo assim ha broadcast com sourceMapIds: [] (o controller emite depois do early-return de maps.service.js:46-48); pinar porque hoje isso custa um resync completo em todos os peers por um no-op

### 30. requireAtlasPermission('write') em /maps/:mapId/merge e ('read') nos 4 GETs, avaliados nos niveis do MEIO da hierarquia (manage e comment)

- **Código:** `backend/src/modules/maps/maps.routes.js`
- **Tipo:** integração · **Fatia:** `be-maps-briefings`
- **Arquivo sugerido:** `backend/tests/integration/maps-merge-permissions.test.js`
- **Cobertura hoje:** backend/tests/integration/maps-merge.test.js:69-95 (so 'read' -> 403) e maps-coverage.test.js:38-54 (so 'write', so GET). Nenhuma cobertura de 'manage', 'comment' ou admin global.

**O que o verde provaria.** Classe C1, o bug que ja aconteceu duas vezes nos dois pacotes. Toda a fatia so foi exercitada com owner (passa), share 'write' (so GET, em maps-coverage) e share 'read' (403 no merge). Os niveis 'manage' e 'comment' nao aparecem em NENHUM teste de maps/briefings. Se alguem trocasse o gate por `permission === 'write' || permission === 'owner'` (a lista fechada literalmente proibida pela constituicao), maps-merge.test.js, maps-coverage.test.js e maps-briefings*.test.js continuariam 100% verdes enquanto o co-Gestor perderia o merge em silencio. Assertar o EFEITO (linhas movidas), nao so o status, para que um 200-sem-efeito tambem nao passe.

**Casos:**

- share 'manage' -> POST merge {sourceMapIds:[src]} -> 200 E features.map_id do registro efetivamente = dest (manage=4 >= write=3)
- share 'comment' -> GET /maps 200, GET /maps/:id 200, GET /briefings 200, GET /briefings/:id 200 com slides (comment=2 >= read=1); um gate escrito como lista ['read','write','owner'] apagaria o Comentarista sem erro
- share 'comment' -> POST merge -> 403 e zero linhas movidas (comment=2 < write=3): o limite superior do nivel
- share 'read' -> POST merge -> 403 (controle ja existente, repetido aqui para a hierarquia ficar completa em um so arquivo)
- usuario com role global 'admin' e SEM share -> POST merge -> 200 (permissions.js:82-87 sintetiza 'owner'); hoje esse atalho de admin nunca foi exercitado nesta fatia

### 31. mergeMaps ignora maps.locked, enquanto o sync bloqueia a MESMA mutacao com 409 (assimetria entre os dois caminhos de escrita)

- **Código:** `backend/src/modules/maps/maps.service.js`
- **Tipo:** integração · **Fatia:** `be-maps-briefings`
- **Arquivo sugerido:** `backend/tests/integration/maps-merge-lock.test.js`
- **Cobertura hoje:** parcial e do outro lado da fronteira: backend/tests/integration/sync-authz-lock.test.js prende o 409 do lado do sync; maps-briefings.test.js cria um lockedMap mas so faz GET nele. Nenhum teste cruza lock com merge.

**O que o verde provaria.** sync.service.js:1306-1313 recusa (ConflictError 'Map is locked') qualquer escrita de feature/group/layer/cesium3d/streetview360/catalog_layer cujo map pai esteja travado, e sync.service.js:616 reserva o proprio flip de `locked` ao owner. mergeMaps (maps.service.js:39-68) nunca le a coluna `locked`: um usuario de nivel 'write' pode esvaziar um mapa travado ou despejar conteudo dentro dele por REST. Hoje nenhum teste combina merge + locked, entao um verde nao prova nada sobre o cadeado; com o teste, ou o bypass e corrigido, ou fica nomeado e travado. O braco de controle (a mesma mudanca via op de sync -> 409) ancora a assercao na AUTORIDADE do servidor e nao na minha opiniao sobre o que deveria acontecer.

**Casos:**

- destino TRAVADO: UPDATE maps SET locked=true WHERE id=dest; feature em src; POST merge {sourceMapIds:[src]} -> esperado 409 CONFLICT e feature.map_id ainda = src (hoje retorna 200 e a feature entra no mapa travado: o teste falha e esse e o achado)
- origem TRAVADA: locked=true no src, dest destravado -> POST merge -> esperado 409 e nada movido (hoje 200 e o mapa travado e esvaziado)
- braco de CONTROLE na mesma bateria: a mesma movimentacao expressa como op de sync (POST /atlas/:id/sync com feature update carregando mapId=dest, mapa travado) -> 409 'Map is locked'. Se este braco passar e o de merge nao, a assimetria esta provada contra o servidor
- controle positivo: com locked=false nos dois mapas o merge continua 200 e move (garante que o novo guard nao quebrou o caminho feliz)
- usuario 'write' NAO pode destravar por merge: assert de que maps.locked do destino continua true depois da tentativa

### 32. flexibleAuth sliding renewal, org_role/organization_id nunca sao reconciliados contra o DB

- **Código:** `backend/src/middleware/flexible-auth.js`
- **Tipo:** integração · **Fatia:** `be-middleware`
- **Arquivo sugerido:** `backend/tests/integration/auth-live-reconciliation.test.js (estender)`
- **Cobertura hoje:** parcial, tests/integration/auth-live-reconciliation.test.js cobre `role` e is_active; tests/integration/auth-gaps.test.js auth-05 cobre so a degradacao do token legado. Nenhum teste faz UPDATE users SET org_role e observa propagacao (grep 'SET org_role' em tests/ retorna so setups).

**O que o verde provaria.** O fix P1 registrado no proprio arquivo (linhas 70-101) fechou a janela infinita para `role`, mas parou ai: a renovacao faz `issueAccessToken(req.user)` com `req.user.org_role` vindo de `mapPayload(payload)`, ou seja, do TOKEN. Enquanto o cliente de cookie continuar deslizando, uma democao org editor->viewer NUNCA propaga (a janela nao e de 15min, e infinita), exatamente o defeito que o comentario diz ter corrigido, so que na claim vizinha. O caminho de refresh (auth.service.refresh -> FIND_USER_BY_ID) rele o DB e propaga; o caminho do cookie nao. `org_role` e autorizacao real (sv360.routes.js:266-271 e sv360.write.service.js:34 decidem escrita por ele). Hoje, se esse codigo estivesse errado, nenhum teste ficaria vermelho: auth-gaps auth-05 so prova a degradacao do token LEGADO (claim ausente) e nao distingue 'degradar claim ausente' de 'nunca reconciliar claim presente'.

**Casos:**

- usuario com org_role='editor' no token e no DB; `UPDATE users SET org_role='viewer'`; GET /api/v1/auth/me com cookie de 4m (dentro da janela de renovacao) -> decodificar o Set-Cookie renovado e exigir org_role='viewer' (hoje vem 'editor')
- consequencia observavel: com o cookie renovado, POST /api/v1/sv360/admin/projects/upload -> 403 (requireUploadCapability le req.user.org_role); hoje passa do gate
- controle positivo (nao super-corrigir): promocao viewer->editor no DB tambem precisa aparecer no token renovado
- nao-regressao de auth-gaps auth-05: token legado SEM claim org_role continua re-mintado com org_role='viewer' e organization_id=null mesmo com o DB dizendo 'owner'

### 33. flexibleAuth, token de usuario DESATIVADO continua autenticando em rota que nao usa o `auth` estrito

- **Código:** `backend/src/middleware/flexible-auth.js`
- **Tipo:** integração · **Fatia:** `be-middleware`
- **Cobertura hoje:** parcial, tests/integration/nomes-access.test.js tem os 4 negativos de acesso (privado/zona/anonimo) mas nenhum com conta desativada; auth-live-reconciliation cobre so o caminho estrito.

**O que o verde provaria.** A reconciliacao viva so existe em dois lugares: no `auth` estrito e dentro da janela de renovacao (<5min). Fora disso, flexibleAuth popula req.user direto do JWT. GET /nomes/busca e deliberadamente sem `auth` (nomes.routes.js:15) e passa req.user.id para o SQL da BUSCA, que filtra acesso por `fn_user_zone_geoms($5)` e checa `role='admin'` no banco, mas NAO checa `users.is_active` (nomes.queries.js:22-26). Resultado: por ate ~10 minutos apos a desativacao, uma conta morta continua lendo nomes geograficos privados. As duas camadas erram junto, o que e exatamente o caso que I5 diz que a query embutida deveria cobrir.

**Casos:**

- usuario com permissao de zona sobre um nome com access_level != 'public': GET /api/v1/nomes/busca?q=<nome> com Bearer valido -> o nome privado aparece (linha de base)
- `UPDATE users SET is_active = false`; MESMO token, ainda nao expirado -> o nome privado NAO pode mais aparecer (hoje aparece; o teste expoe o furo)
- controle: requisicao anonima (sem credencial) nunca ve o nome privado, garantindo que o assert acima distingue desativado de publico
- paridade: o mesmo token desativado em rota estrita (GET /api/v1/atlas) -> 401, mostrando que a divergencia e entre familias de rota e nao no token

### 34. requireAtlasPermission, fail-OPEN quando requiredLevel nao e chave de PERMISSION_LEVELS

- **Código:** `backend/src/middleware/permissions.js`
- **Tipo:** integração · **Fatia:** `be-middleware`
- **Cobertura hoje:** nenhuma, unit/middleware-permissions.test.js e unit/permission-resolver.test.js testam so resolvePermission (funcao pura, que nem chega a comparar niveis); integration/permissions.test.js e atlas-config-authz.test.js exercitam so niveis validos.

**O que o verde provaria.** `PERMISSION_LEVELS[requiredLevel]` e undefined para um nivel desconhecido, e `resolvedLevel < undefined` avalia false (comparacao com NaN), entao o middleware chama next() em vez de 403. Um erro de digitacao em UMA rota ('managee', 'writes') libera essa rota para QUALQUER portador de qualquer nivel, inclusive anonimo num atlas publico, que resolve 'read'. E o oposto do fail-closed e nao existe rede alguma: as 27 call sites atuais estao corretas por sorte, nao por verificacao. Um verde aqui prova que a porta fecha por hierarquia, nao por coincidencia de string.

**Casos:**

- mini-app express no proprio teste: stub que injeta req.user = estranho, depois requireAtlasPermission('managee') sobre um atlas PUBLICO de outro dono -> nao pode responder 200 (hoje responde; o correto seria 403 ou 500)
- mesmo mini-app com o nivel valido 'manage' e o mesmo usuario -> 403: controle negativo que prova que o harness sabe barrar
- varredura estatica sobre src/modules/**/*.routes.js: todo requireAtlasPermission('X') tem X em PERMISSION_LEVELS; com guard anti-cobertura-vazia, a varredura falha se encontrar menos de 25 call sites (hoje sao 27) ou se a lista de arquivos vier vazia
- simetrico: um share cuja coluna permission trouxesse valor fora do CHECK tambem faria `undefined < 3` === false; assertar que o CHECK de 002_atlas.sql:63 ainda restringe a ('read','comment','write','manage'), que e o unico motivo de esse ramo nao ser alcancavel hoje

### 35. requireAtlasPermission alimentado por query param (liftAtlasIdToParams) em /api/v1/debug/trace

- **Código:** `backend/src/middleware/permissions.js`
- **Tipo:** integração · **Fatia:** `be-middleware`
- **Cobertura hoje:** nenhuma, o inventario confirma zero requests a /api/v1/debug/trace em toda a suite do backend.

**O que o verde provaria.** E a unica call site em que o atlasId chega por QUERY e nao por rota, e o comentario do proprio arquivo diz que o gate existe para impedir IDOR cross-atlas (ler/limpar o ring de qualquer atlas com qualquer token). O endpoint monta sob NODE_ENV=test e nenhum teste do backend o chama (zero hits de 'debug/trace' em tests/). Se o `requireAtlasPermission('read')`/('manage') sumisse, ou se o lift passasse a aceitar atlasId ausente de novo (o fallback 'limpar todos os rings' ja existiu), nada ficaria vermelho aqui, o unico consumidor e o Playwright do frontend, que roda com o dono.

**Casos:**

- GET /api/v1/debug/trace?atlasId=<atlas privado de outro dono> com token de estranho -> 403 FORBIDDEN
- DELETE /api/v1/debug/trace?atlasId=<atlas> com share 'write' -> 403 (exige manage); com share 'manage' -> 200 e o ring do atlas fica vazio no GET seguinte
- DELETE /api/v1/debug/trace SEM atlasId -> 400 BAD_REQUEST, e o ring de um atlas terceiro permanece intacto (prova que nao ha mais wipe global)
- positivo: o dono faz um push de sync e ve os proprios spans (server.inserted) em GET /trace?atlasId=<seu atlas>

### 36. authLimiter.keyGenerator, o `.toLowerCase()` do username e o unico anteparo contra bypass por variacao de caixa

- **Código:** `backend/src/middleware/rate-limit.js`
- **Tipo:** integração · **Fatia:** `be-middleware`
- **Cobertura hoje:** tests/integration/rate-limit.test.js, cobre 429 apos authMax e 'usernames distintos nao se estrangulam'; nada sobre normalizacao de caixa.

**O que o verde provaria.** FIND_USER_BY_USERNAME casa com `LOWER(u.username) = LOWER($1)` (auth.queries.js:12), entao 'Victim', 'VICTIM' e 'victim' autenticam a MESMA conta. A chave do limiter e `${req.ip}:${username.toLowerCase()}`. Se o `.toLowerCase()` sumir, cada variacao de caixa ganha um balde novo de authMax (10) tentativas e o brute-force fica praticamente irrestrito, e a suite inteira continua verde: rate-limit.test.js so testa dois usernames ja distintos entre si, o que passa com e sem o fix (padrao C3).

**Casos:**

- RATE_LIMIT_FORCE=1; authMax+1 POST /api/v1/auth/login com username 'RL_Case_Victim' e senha errada -> ultimo responde 429 TOO_MANY_REQUESTS
- logo em seguida, POST /api/v1/auth/login com 'rl_case_victim' (mesma conta, caixa diferente) -> tem de ser 429, nao 401; e esse assert que morre se o toLowerCase for removido
- controle negativo do harness: 'rl_case_outro' (conta realmente distinta) no mesmo IP -> 401, provando que o 429 acima veio da colisao de chave e nao de um balde global

### 37. publicLinkLimiter em GET /atlas/public/:link

- **Código:** `backend/src/middleware/rate-limit.js`
- **Tipo:** integração · **Fatia:** `be-middleware`
- **Cobertura hoje:** nenhuma, grep 'publicLinkLimiter' em tests/ nao retorna nada; rate-limit.test.js exercita so authLimiter.

**O que o verde provaria.** E um dos dois controles de rate limit exigidos nominalmente pela constituicao (I13) e tem ZERO exercicio: rate-limit.test.js so aciona /auth/login. O limiter guarda a enumeracao de links publicos (adivinhar public_link expoe atlas inteiros em leitura). Se alguem remover `publicLinkLimiter` de atlas.routes.js:23, ou se `config.rateLimit.publicMax` for lido errado, nenhum teste cai.

**Casos:**

- RATE_LIMIT_FORCE=1; config.rateLimit.publicMax+1 GET /api/v1/atlas/public/<link-inexistente> -> o ultimo e 429 com error.code TOO_MANY_REQUESTS (antes disso os demais sao 404, provando que o handler estava sendo alcancado)
- o mesmo com um link VALIDO: o 429 chega antes do 200, ou seja o limiter roda antes do controller
- isolamento entre os dois limiters (stores separados): apos estourar o balde publico, POST /api/v1/auth/login com username inedito ainda responde 401, nao 429

### 38. ST_Contains sobre ng.fn_user_zone_geoms (BUSCA $5 / FEICOES $4) com zona concava ou com buraco

- **Código:** `backend/src/modules/nomes/nomes.queries.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** backend/tests/integration/zones-coverage.test.js (zones-cov-01/02) e nomes-access.test.js - so zonas convexas e disjuntas

**O que o verde provaria.** O negativo espacial mais forte que existe hoje (zones-coverage.test.js zones-cov-01) usa uma zona TOTALMENTE DISJUNTA (~-50,-10 vs -43,-22). Esse caso e satisfeito tambem por um filtro degradado para bbox (`uz.geom && n.geom`, ST_Envelope ou ST_Intersects do envelope), que e exatamente a 'otimizacao' que alguem tentaria ao ver o GIST idx_zones_geom. Um verde hoje prova 'a zona esta longe', nao 'o predicado e geometrico'. Com um poligono-donut o ponto secreto fica DENTRO do bbox e FORA do poligono: so ST_Contains real esconde. Isso e caminho de vazamento de dado privado (I5), e o CLAUDE.md exige teste negativo para todo filtro de acesso embutido.

**Casos:**

- Zona donut (anel externo -43.4/-23.0 a -43.0/-22.8 + anel interno -43.25/-22.95 a -43.15/-22.85) concedida ao usuario; nome privado em (-43.2,-22.9) fica NO BURACO -> GET /nomes/busca do usuario com grant NAO retorna o nome (hoje visivel se o filtro virar bbox)
- Par positivo no mesmo teste: segundo nome privado em (-43.35,-22.95), dentro do corpo do anel -> o mesmo usuario, no mesmo request, VE esse nome (prova que o grant existe e o negativo acima nao e falso-positivo por falta de permissao)
- Mesma zona donut em /nomes/feicoes: edificacao privada centrada no buraco -> 200 com {message}; edificacao privada no corpo do anel -> 200 com nome (cobre tambem o ST_Transform(uz.geom,4326) do FEICOES no caminho de multiplos aneis)
- Admin ve as duas edificacoes independentemente da geometria (branch de admin nao e afetado)

### 39. Reconciliacao de liveness no caminho anonimo de GET /nomes/busca (usuario/organizacao desativados)

- **Código:** `backend/src/modules/nomes/nomes.queries.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** /busca nao usa o `auth` estrito (contrato congelado anonimo), so o flexibleAuth, que por construcao NAO reconcilia com o banco (auth.js:66-83 fechou essa janela apenas no caminho estrito; flexible-auth.js so consulta getLiveAuthState quando faltam <5min para expirar). E o proprio SQL do BUSCA le a tabela `users` no branch de admin (`SELECT 1 FROM users WHERE id=$5 AND role='admin'`) SEM filtrar `is_active`, e fn_user_zone_geoms nao tem checagem de liveness nenhuma. Resultado provavel: um usuario desativado continua enxergando nomes GEOGRAFICOS PRIVADOS por ate 15 min (JWT_ACCESS_EXPIRY), no endpoint mais sensivel do gazetteer, enquanto o MESMO token ja recebe 401 em /nomes/feicoes. Zero cobertura hoje. Se o teste falhar, ele nao e um gap: e um repro de defeito de autorizacao (nomeie-o .repro.test.js).

**Casos:**

- Usuario com grant de zona ve 'Base Secreta' em /nomes/busca; UPDATE users SET is_active=false; MESMO token -> /nomes/busca NAO retorna mais o nome privado (retorna 200 com os publicos)
- Contraste no mesmo teste: o mesmo token desativado em /nomes/feicoes -> 401 (prova que o caminho estrito reconcilia e isola a assimetria)
- Admin global desativado -> /nomes/busca deixa de expor nomes privados (branch `role='admin'` do BUSCA/FEICOES/CATALOGO passa a exigir is_active)
- Usuario ativo cuja ORGANIZACAO foi desativada -> mesmo tratamento em /busca (hoje o org gate so existe no `auth` estrito)
- Controle: usuario ativo com grant continua vendo o nome privado apos os testes acima (nada foi quebrado no caminho feliz)

### 40. UPDATE_ZONE geometry replacement (PUT /api/v1/zones/:id)

- **Código:** `backend/src/modules/zones/zones.queries.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** backend/tests/integration/zones-admin.test.js (PUT /:id replaces name + geom) - assere name e geom.type, nunca as coordenadas

**O que o verde provaria.** ACHADO DE COBERTURA VAZIA. zones-admin.test.js:78-85 tem o comentario "geometry was replaced (new centroid is to the southwest)" mas a unica assercao sobre a geometria e `assert.equal(got.body.data.geom.type, 'Polygon')`. Se UPDATE_ZONE parasse de escrever `geom` (ou escrevesse o poligono antigo), o teste continuaria VERDE: o nome muda, o type continua 'Polygon'. E o response do PUT nem retorna geom (RETURNING id, name, description, created_at), entao nao ha como notar. Consequencia real: redesenhar uma zona de acesso e um no-op silencioso e a autorizacao espacial fica congelada na geometria antiga. Um verde hoje prova apenas que o campo `name` foi atualizado.

**Casos:**

- PUT /zones/:id com poligono deslocado -> GET /zones/:id retorna geom.coordinates[0] IGUAL ao anel enviado (deepEqual das coordenadas, nao apenas geom.type)
- Controle end-to-end de autorizacao: nome privado A dentro do poligono ANTIGO e nome privado B dentro do poligono NOVO; usuario com grant na zona ve A e nao ve B; apos o PUT que move a zona, o mesmo usuario NAO ve mais A e passa a ver B (mesmo token, nada mais mudou)
- PUT que muda so o `name` (mesmo geom) nao altera as coordenadas armazenadas
- Confirmar no banco: SELECT ST_AsGeoJSON(geom) da linha == anel enviado (assert contra o Postgres, nao contra o eco do controller)

### 41. Broadcast WS `sharing_updated`: campo `role`, acoes user_updated/user_removed/public_*, e ordem escrita->broadcast

- **Código:** `backend/src/modules/sharing/sharing.controller.js`
- **Tipo:** WebSocket · **Fatia:** `be-sharing`
- **Cobertura hoje:** backend/tests/ws/collab-broadcasts.test.js:144 (so user_added, permission 'read', sem assercao de `role`)

**O que o verde provaria.** O unico teste existente cobre `user_added` com permission 'read' e nunca assere `role`. O campo `role` e contrato que atravessa os dois pacotes (o peer conectado re-gateia a UI ao vivo); um regress em toFrontendRole ou a remocao do campo passam verdes. Pior: os broadcasts de user_updated, user_removed, public_enabled e public_disabled nao tem NENHUM teste, apagar qualquer um deles deixa os peers divergentes ate o sweep de heartbeat (~30s), violando I16 sem sinal nenhum.

**Casos:**

- Peer conectado; owner POST /sharing/users {permission:'manage'} -> peer recebe {type:'sharing_updated', action:'user_added', permission:'manage', role:'manager'} (assertar role, nao so type/action)
- owner PUT /sharing/users/:id {permission:'comment'} -> peer recebe {action:'user_updated', permission:'comment', role:'commenter'}
- owner DELETE /sharing/users/:id -> peer recebe {action:'user_removed', userId} (nenhum teste cobre o broadcast de remocao hoje)
- owner POST /sharing/public -> {action:'public_enabled'}; DELETE /sharing/public -> {action:'public_disabled'}
- O proprio usuario revogado, ainda conectado, recebe o user_removed que o nomeia (ele esta na sala no momento do broadcast)
- CONTROLE NEGATIVO de ordem (I16): DELETE /sharing/users/<usuario sem share> -> 404 E nenhum sharing_updated chega na janela de espera, prova que o broadcast roda depois da escrita; se alguem inverter a ordem, um 404 emitiria remocao fantasma e os peers derrubariam um membro que ainda tem acesso

### 42. GRANTABLE_PERMISSIONS: conceder 'comment' e 'manage' via POST/PUT /atlas/:id/sharing/users

- **Código:** `backend/src/modules/sharing/sharing.schemas.js`
- **Tipo:** integração · **Fatia:** `be-sharing`
- **Cobertura hoje:** backend/tests/integration/sharing.test.js (so read/write + 422 para 'owner'), backend/tests/integration/sharing-coverage.test.js (so read/write), backend/tests/integration/atlas-config-authz.test.js (manage/comment semeados via createShare, nao pela API)

**O que o verde provaria.** Hoje a API so e exercitada concedendo 'read' e 'write', e o unico valor rejeitado testado e 'owner'. Os niveis do meio sao semeados por INSERT direto (createShare) em atlas-config-authz/comments, nunca pela rota. Se alguem reduzir GRANTABLE_PERMISSIONS para ['read','write'] (ou tirar 'manage' de PERMISSION_LEVELS), TODOS os testes de sharing seguem verdes enquanto Comentarista e co-Gestor viram inconcedliveis em silencio: e exatamente a lista fechada que a constituicao proibe e que ja causou bug real duas vezes. Um verde aqui prova que o grant do nivel do meio existe E confere exatamente o poder daquele nivel.

**Casos:**

- POST /atlas/:id/sharing/users {userId, permission:'manage'} como owner -> 201; SELECT permission FROM atlas_shares = 'manage'; com o token do beneficiado, GET /atlas/:id/sharing -> 200 (efeito: o grant realmente conferiu co-Gestor)
- POST /atlas/:id/sharing/users {userId, permission:'comment'} -> 201; row = 'comment'; com o token do beneficiado, POST /atlas/:id/sync com uma op target:'comment' -> 200 e a linha aparece em comments
- O MESMO beneficiado 'comment' empurrando uma op target:'feature' -> 403 (assertOperationAllowed, sync.service.js:606) e SELECT id FROM features = 0 linhas
- Controle negativo do teto: beneficiado 'comment' em GET /atlas/:id/sharing -> 403 (comment < manage)
- PUT /atlas/:id/sharing/users/:userId {permission:'manage'} sobre um share 'read' existente -> 200, row='manage', e o beneficiado passa a conseguir GET /sharing (200) que antes era 403

### 43. Alcance do principal de visitante (`public-<uuid>`) fora das rotas de atlas: GET /users/search

- **Código:** `backend/src/modules/users/users.routes.js`
- **Tipo:** integração · **Fatia:** `be-sharing`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** O token de visitante e um JWT valido; `auth` (backend/src/middleware/auth.js:80) faz `return next()` para sub nao-UUID, pulando a reconciliacao. Como /users/search usa apenas [auth, validate], quem tem um link publico anonimo consegue `GET /api/v1/users/search?q=%25%25` e enumerar ate 20 usuarios REAIS (username, nome, posto, OM) de QUALQUER organizacao. Nenhum teste usa um publicToken fora de rotas /atlas, entao nada delimita onde esse principal pode ir. Um verde provaria que o visitante read-only nao alcanca o diretorio de pessoal. ATENCAO: escrito contra o comportamento pretendido, este teste FALHA hoje - e o achado, nao o teste, que esta errado.

**Casos:**

- Mintar publicToken via GET /atlas/public/:link; usa-lo em GET /api/v1/users/search?q=%25%25 -> esperado 401/403 (HOJE retorna 200 com ate 20 usuarios: rodar primeiro para confirmar o furo)
- Mesmo token em GET /api/v1/users/me -> assertar o status atual e pina-lo (nao ha linha em users para `public-<uuid>`)
- Controle positivo pos-fix: token de usuario normal em /users/search?q=<tag> -> 200 e encontra o alvo (o gate nao pode quebrar o autocomplete do modal de compartilhamento)
- Controle de contraste: o mesmo publicToken em GET /atlas/:idPrivado -> 403 (a superficie de atlas ja esta fechada; a de usuarios nao)

### 44. toFrontendRole(permission, globalRole), mapeamento dos cinco niveis para os seis papeis do frontend

- **Código:** `backend/src/utils/roles.js`
- **Tipo:** unitário · **Fatia:** `be-sharing`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** Zero cobertura direta, e e a funcao que traduz a hierarquia de permissao para o vocabulario de papel que o frontend usa para re-gatear a UI. Se as ramificacoes do meio ('manage'->'manager', 'comment'->'commenter') caissem no `return 'viewer'` final, nada no backend acusaria: e literalmente o defeito que ja silenciou a presenca de selecao do co-Gestor. Teste puro, sem banco, casando cada nivel com seu papel.

**Casos:**

- toFrontendRole('owner') === 'owner'; ('manage') === 'manager'; ('write') === 'editor'; ('comment') === 'commenter'; ('read') === 'viewer'
- toFrontendRole(null) === 'viewer' e toFrontendRole(undefined) === 'viewer' (sem acesso cai no papel minimo, nunca em undefined)
- globalRole 'admin' curto-circuita para 'admin' em TODAS as permissoes, inclusive null e 'read'
- globalRole 'user' explicito nao altera o mapeamento por atlas (toFrontendRole('manage','user') === 'manager')
- Guard de conjunto: iterar sobre os cinco valores de PERMISSION_LEVELS (importados de middleware/permissions.js) e assertar que cada um mapeia para um papel DISTINTO, pega a colagem de dois niveis no mesmo papel, que e a forma como o nivel do meio some

### 45. PATCH /sv360/admin/projects/:slug/status e DELETE /sv360/admin/projects/:slug, negativos de autorizacao (anon 401, viewer mesma org 403, membro de outra org 404)

- **Código:** `backend/src/modules/streetview360/sv360.admin.service.js`
- **Tipo:** integração · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/integration/sv360-admin-authz.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-ingest.test.js:931-989 (apenas caminhos felizes de PATCH/GET/DELETE com o owner)

**O que o verde provaria.** loadWritableProject e o unico gate das duas rotas mais destrutivas do modulo (DELETE e HARD-delete com CASCADE + rmSync do {orgId}__{slug}.db) e nao tem UM negativo. Os 403 existentes so cobrem upload. Se canWriteProject fosse afrouxado, ou se o escopo por organization_id caisse do GET_PROJECT_FOR_ADMIN, todos os testes atuais seguem verdes enquanto qualquer editor de qualquer OM apaga o projeto de outra. Regra do projeto: todo filtro de acesso exige teste com usuario SEM permissao.

**Casos:**

- anon PATCH .../status {status:'disabled'} -> 401 + flat { error }; SELECT status do projeto continua 'enabled'
- viewer da MESMA org PATCH -> 403; status inalterado
- editor de OUTRA org PATCH no slug da default org -> 404 (escopo por org, nao 403 - nao vaza existencia); status inalterado
- anon DELETE -> 401; SELECT 1 FROM sv360.projects ainda existe E existsSync({orgId}__{slug}.db) === true
- viewer da MESMA org DELETE -> 403; linha e arquivo intactos
- editor de OUTRA org DELETE -> 404; linha e arquivo intactos
- admin global DELETE com ?orgSlug=<slug da org> desambigua e retorna 204 (ramo orgSlug do loadWritableProject, hoje so ?orgId e testado)

### 46. GET /sv360/tiles/:z/:x/:y.pbf e GET /sv360/tiles/fotos.geojson, escopo de cache nao acompanha o escopo de acesso (P6)

- **Código:** `backend/src/modules/streetview360/sv360.controller.js`
- **Tipo:** integração · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/integration/sv360-tiles-cache-scope.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-cache-scope.test.js (so a rota de imagem); sv360-mvt.test.js:189-190 so afirma max-age=60 e nao-immutable, sem distinguir public/private

**O que o verde provaria.** mvtTile seta `Cache-Control: public, max-age=60` INCONDICIONALMENTE (sv360.controller.js:98,105) enquanto o conteudo do tile varia por req.user (a query embute isAdmin/orgId e inclui projetos `disabled` para quem pode ver). E exatamente o bug que ja foi corrigido na rota de imagem (IMMUTABLE_PRIVATE + Vary, sv360.controller.js:52-63, pinado por sv360-cache-scope.test.js) e que nunca foi aplicado ao tile: um proxy compartilhado pode guardar o tile de um membro da org (com as fotos do projeto disabled dentro) e reservi-lo a um anonimo por 60s. tilesGeojson idem, sem Vary. Um verde prova que dado restrito nunca sai marcado como publicamente cacheavel; hoje o teste FALHA.

**Casos:**

- Projeto DISABLED da org X com foto dentro do tile (z,x,y). GET do tile com token do membro da org X -> 200, o MVT contem a foto, e cache-control NAO casa /public/ (deve ser private) e vary inclui Authorization
- Mesmo tile como admin global -> 200 com a foto, cache-control private + Vary
- Mesmo tile anonimo -> 200, MVT sem a foto, cache-control public, max-age=60 (o caminho publico continua cacheavel, controle de que o fix nao matou o cache legitimo)
- GET /tiles/fotos.geojson com token do membro da org X (resposta inclui a foto do projeto disabled) -> header vary inclui Authorization e cache-control nao e public
- GET /tiles/fotos.geojson anonimo -> segue sem a foto (regra de acesso inalterada)

### 47. mergeProject: manifest deleted_photos[] insere tombstone SEM verificar dono (sv360.deleted_photos nao tem FK e o PK e global por photo_id)

- **Código:** `backend/src/modules/streetview360/sv360.merge.js`
- **Tipo:** integração · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/integration/sv360-tombstone-cross-org.repro.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-gaps.test.js (sv360-09 cobre carry-over/resurrection de tombstone DENTRO do proprio projeto; nenhum teste cruza orgs no deleted_photos[])

**O que o verde provaria.** collisionGuard (FIX-6) so protege photos[]; deleted_photos[] entra cru via INSERT_TOMBSTONE. Como TODA query de leitura exclui por `NOT EXISTS (SELECT 1 FROM sv360.deleted_photos WHERE photo_id = p.id)` e a tabela nao tem FK nem escopo de projeto (005_sv360.sql:96-99), um editor autenticado da org A pode fazer sumir qualquer foto de qualquer org so listando o uuid dela em deleted_photos[]. Um verde aqui prova que a ingestao de um tenant nao consegue apagar dado de outro; hoje o teste FALHA e expoe o buraco (I5/isolamento de tenant).

**Casos:**

- Org B tem projeto ENABLED com foto pB viva (GET /sv360/photos/pB anon = 200). Org A (editor) faz upload de bundle valido proprio com deleted_photos: [{ photo_id: pB }] -> apos o 201, GET /sv360/photos/pB anon deve continuar 200
- Apos o mesmo upload: SELECT 1 FROM sv360.deleted_photos WHERE photo_id = pB -> 0 linhas (nenhum tombstone alheio gravado)
- Controle positivo no mesmo teste: deleted_photos com um id que ESTA em photos[] do proprio bundle continua tombstonando (GET 200 antes, 404 depois) - garante que o guard nao quebrou o caminho legitimo
- Variante 409/422 aceitavel: se o fix escolher rejeitar o bundle, assertar status 4xx + flat { error } e que pB segue 200

### 48. Carimbo de serverVersion e entityId nas ops transmitidas por WS apos push HTTP (sync.controller.js:19-38)

- **Código:** `backend/src/modules/sync/sync.controller.js`
- **Tipo:** WebSocket · **Fatia:** `be-sync`
- **Arquivo sugerido:** `backend/tests/ws/collab-broadcast-stamping.test.js`
- **Cobertura hoje:** backend/tests/ws/collab-broadcasts.test.js:180-214 (so afirma type/userId/ops.length); os serverVersion checados em collab-advanced/multiuser-session-e2e sao do ACK, nunca do broadcast

**O que o verde provaria.** O proprio comentario do codigo diz que sem o carimbo 'a op transmitida nao carregava ordem e edicoes concorrentes na mesma feicao divergiam' (LWW por ordem de chegada, I3) e que sem o entityId a MESMA operacao chegava com duas identidades conforme o caminho (broadcast vs pull incremental, fix L3). O unico teste que observa esse broadcast (collab-broadcasts.test.js:207-212) afirma apenas `ops.length === 1` e `userId`: apagar as duas linhas de stamping deixa o teste verde. Hoje um verde ali nao prova nada sobre a ordem que o par usa para convergir.

**Casos:**

- peer WS conectado ao atlas; owner faz POST /sync de 1 feature create -> a msg 'operations' recebida traz ops[0].serverVersion === Number(res.body.data.results[0].currentVersion) (nao undefined)
- batch de 3 ops num unico POST -> os 3 serverVersion transmitidos sao distintos e estritamente crescentes na ordem do array
- op de nivel atlas (entityType:'setting', entityId:'atlas') -> ops[0].entityId transmitido e o UUID do atlas, NAO a sentinela 'atlas'; e igual ao entityId que um GET /sync/<v-1> devolve para a mesma op (as duas rotas concordam)
- reenvio idempotente do MESMO op_id com um peer conectado -> a op transmitida carrega o serverVersion ORIGINAL gravado, nao o serverVersion corrente do atlas

### 49. assertOperationAllowed (sync.service.js:600-620) + applyCommentOp isEditor (sync.service.js:1241) para o nivel 'manage'

- **Código:** `backend/src/modules/sync/sync.service.js`
- **Tipo:** integração · **Fatia:** `be-sync`
- **Arquivo sugerido:** `backend/tests/integration/sync-manage-tier.test.js`
- **Cobertura hoje:** nenhuma, grep por `'manage'` em tests/integration so acha atlas-config-authz.test.js:37 e atlas-transfer-ownership.test.js:75/94; nenhum deles faz POST /sync

**O que o verde provaria.** Nenhum usuario com share 'manage' faz push de sync em toda a suite. A linha 1241 e literalmente uma LISTA FECHADA (`permission === 'write' || permission === 'manage' || permission === 'owner'`), o padrao C1 que o CLAUDE.md diz ter causado bug real duas vezes. Se alguem a reescrever para `permission === 'write' || permission === 'owner'` (a forma exata proibida), TODOS os testes atuais continuam verdes: comments.test.js so exercita write/comment, e authz-lock so owner/write. O co-Gestor perderia a autoridade sobre comentarios em silencio. O estado e alcancavel de verdade: atlas-transfer-ownership.test.js:75 mostra que o dono anterior e rebaixado para 'manage'.

**Casos:**

- share 'manage' + push de feature create -> 200 e a linha existe em features (a hierarquia manage > write passa o gate de rota e o gate por-op)
- share 'manage' + push {entityType:'map', operationType:'delete'} -> 403 e maps.deleted_at continua null (map-delete e owner-only, assertOperationAllowed:611)
- share 'manage' + push {entityType:'map', operationType:'update', data:{locked:true}} -> 403 e maps.locked continua false (lock e owner-only, assertOperationAllowed:616)
- comentario criado por OUTRO usuario; 'manage' faz update com text novo -> 200 e comments.data->>'text' MUDOU (prende o 'manage' dentro do isEditor)
- o mesmo comentario de outro autor; 'manage' faz delete -> comments.deleted_at preenchido (controle: com a lista fechada errada o UPDATE/DELETE casa zero linhas e o teste falha)
- controle simetrico: share 'comment' no mesmo comentario alheio -> 200 acked mas text INALTERADO

### 50. Filtro de visibilidade de comentario no PULL INCREMENTAL para permission 'read' (sync.service.js:812-816)

- **Código:** `backend/src/modules/sync/sync.service.js`
- **Tipo:** integração · **Fatia:** `be-sync`
- **Arquivo sugerido:** `backend/tests/integration/sync-comment-visibility-incremental.test.js`
- **Cobertura hoje:** backend/tests/integration/comments.test.js:96-107 cobre apenas o snapshot (GET /sync/0); zero hits do filtro incremental na suite

**O que o verde provaria.** A regra de visibilidade (Visualizador nunca ve comentario espacial) tem teste so no caminho SNAPSHOT (comments.test.js:96-107, que pulla com versao 0). O caminho incremental tem seu proprio filtro, sem nenhum teste: removendo a linha 815 nada fica vermelho e um leitor que ja tem cursor > 0 passa a receber toda op de comentario, inclusive o texto dentro de `data`, pelo pull e pelo `sync_request` do WS (collab.handlers.js:259 chama o mesmo pullOperations com ws.permission). E vazamento de dado privado, exatamente a classe que o CLAUDE.md manda cobrir com teste negativo.

**Casos:**

- reader com share 'read'; comentarista cria 1 comentario e o writer cria 1 feature; reader faz GET /sync/<versao_anterior> -> isSnapshot === false E operations NAO contem nenhuma op com entityType 'comment'
- o mesmo pull do reader AINDA contem a op de feature (prova que o filtro remove so comentario e nao esvazia a resposta, guard de lista nao-vazia)
- writer (share 'write') pullando do mesmo cursor -> recebe AS DUAS ops, inclusive a de comment (controle positivo: sem ele o teste passaria mesmo se o pull incremental estivesse quebrado para todo mundo)
- reader com share 'read' via WS sync_request com lastVersion > 0 -> a resposta nao traz op de comment

### 51. lock_timeout no advisory lock do push -> 55P03 -> ServiceUnavailableError 503 (sync.service.js:656-670)

- **Código:** `backend/src/modules/sync/sync.service.js`
- **Tipo:** integração · **Fatia:** `be-sync`
- **Arquivo sugerido:** `backend/tests/integration/sync-lock-timeout.repro.test.js`
- **Cobertura hoje:** backend/tests/integration/sync-push-serialization.test.js:72-118 (segura o lock 500ms e so afirma bloqueio+sucesso; nunca cruza o lock_timeout)

**O que o verde provaria.** Regressao registrada no livro-razao.md:48 (2026-07-18, `regressao-propria`): o lock era tomado sem timeout, retendo conexao do pool, e um cliente sozinho esgotava o pool com poolMax=10, travando /auth/login e /health junto. O fix foi `SET LOCAL lock_timeout='5s'` + ServiceUnavailableError. Grep por 503/ServiceUnavailable/lock_timeout em backend/tests nao retorna NADA: o fix nao tem prendedor. sync-push-serialization.test.js:72-99 segura o lock por 500ms, sempre abaixo do timeout, remover o SET LOCAL e o catch do 55P03 deixa a suite inteira verde e o modo de falha volta a ser a parada global, que e justamente o que ninguem detecta por acidente.

**Casos:**

- segurar o lock (pg_advisory_xact_lock com o mesmo namespace 0x53594e43 e hashtext(atlasId)) numa conexao independente por >5s; POST /sync durante a espera -> status 503 dentro de ~5-6s (nao 500, nao pendurado)
- o corpo do 503 traz a mensagem retentavel em pt-BR e o error.code de ServiceUnavailableError (contrato para o cliente decidir retry)
- nada da op rejeitada persiste: zero linhas em operations com aquele op_id e zero em features
- enquanto o lock esta segurado e o push esperando, GET /health (ou /api/config) responde 200 no mesmo intervalo, prova que a conexao presa nao esgota o pool, que era o sintoma original
- controle de escopo: com o lock do atlas A segurado >5s, um POST /sync no atlas B responde 200 normalmente

### 52. Tres testes de pull incremental cuja assercao inteira vive dentro de `if (!res.body.data.isSnapshot)` (cobertura vazia)

- **Código:** `backend/tests/integration/sync-snapshot-hybrid.test.js`
- **Tipo:** integração · **Fatia:** `be-sync`
- **Arquivo sugerido:** `backend/tests/integration/sync-snapshot-hybrid.test.js`
- **Cobertura hoje:** os proprios arquivos, o defeito e da assercao, nao a ausencia de teste

**O que o verde provaria.** Nos blocos das linhas 374-378, 394-397 e 437-455 o corpo do teste so roda se a resposta NAO for snapshot. Se o roteamento hibrido regredir para devolver snapshot sempre (ex.: inverter a comparacao em sync.service.js:798, ou min_version default != 0), os tres testes passam VERDE sem executar uma unica assercao, a definicao de cobertura vazia. Pior: o arquivo nunca chama cleanup, entao min_version daquele atlas e deterministicamente 0 e o galho condicional e desnecessario. Mesma forma em sync-frontend-format.test.js:606-615 (if/else que aceita os dois resultados) e em sync.test.js:397, cuja unica assercao (`currentVersion >= currentVersion - 1`) e verdadeira por aritmetica e nao pode falhar.

**Casos:**

- sync-snapshot-hybrid.test.js:374, trocar o `if` por `assert.equal(res.body.data.isSnapshot, false)` antes das demais asserções e afirmar que a op empurrada aparece por entityId em operations
- sync-snapshot-hybrid.test.js:394, afirmar incondicionalmente isSnapshot === false E operations.length === 0 ao pullar exatamente no currentVersion
- sync-snapshot-hybrid.test.js:437, afirmar incondicionalmente isSnapshot === false e op.entityType === 'feature' (formato frontend), fora do if
- sync-frontend-format.test.js:606, remover o ramo `if (isSnapshot)` e exigir entityType/operationType/entityId: o `op.entityType || op.target` atual passa verde mesmo se o backend regredir para so emitir o vocabulario legado, o que quebraria o frontend
- sync.test.js:397, substituir a assercao aritmetica por isSnapshot === false + operations contendo a op recem-empurrada
- controle negativo a registrar: forcar min_version alto no atlas do teste e confirmar que as versoes corrigidas FALHAM (hoje elas passam nos dois mundos)

### 53. POST /auth/register, organization_id auto-atribuido pelo proprio solicitante (claim de tenant)

- **Código:** `backend/src/modules/auth/auth.schemas.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/register-tenant-claim.test.js`
- **Cobertura hoje:** nenhuma para rank_id/organization_id no register (grep em tests/integration/auth*.test.js so mostra UPDATE direto no banco); unit/self-registration.test.js so testa o flag resolveAllowSelfRegistration, nao o payload

**O que o verde provaria.** users.schemas.js:4-11 documenta a ameaca com todas as letras e a FECHA no PUT /users/me ('um usuario nao pode se mover para outro tenant... concederia leitura dos projetos sv360 privados da org alvo, que filtram por organization_id'). O register deixa a mesma porta aberta: registerSchema aceita organization_id livre e `email` e OPCIONAL, entao um chamador de API (nao a UI, que exige e-mail) cria conta ATIVA na hora dentro de qualquer OM, auth.service.js:87 so barra login quando email IS NOT NULL. sv360.queries.js:14,29 confirma que a visibilidade de projeto privado sai desse claim. Em test NODE_ENV=test o self-registration esta LIGADO, entao o cenario e executavel.

**Casos:**

- POST /auth/register {username,password,nome,organization_id: <orgB criada no teste>} SEM email -> 201; POST /auth/login -> 200; decodificar o accessToken e afirmar o valor de organization_id/org (hoje: orgB)
- teste negativo de filtro de acesso exigido pelo CLAUDE.md, dirigido pelo lado da criacao de conta: com esse token, a listagem de projetos sv360 NAO pode incluir o projeto de orgB com status <> 'enabled'
- pinar a contencao pretendida (uma das duas tem de ser afirmada): ou a conta e criada na org DEFAULT ignorando o organization_id pedido, ou ela nasce pendente (email_verified=false bloqueando login) mesmo sem e-mail
- caso feliz que precisa continuar funcionando: register COM rank_id + organization_id validos e com e-mail -> apos verificar o e-mail, GET /users/me devolve posto_graduacao e organizacao_militar derivados (nomes), nao os UUIDs
- register SEM organization_id -> COALESCE de auth.queries.js:74 poe a org default 00000000-0000-0000-0000-000000000001 (hoje sem nenhum teste)

### 54. config.postos / config.organizacoesMilitares, payload congelado de GET /api/config que alimenta o cadastro anonimo

- **Código:** `backend/src/modules/config/config.service.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/personnel-domains-contract.test.js`
- **Cobertura hoje:** nenhuma (grep por 'postos' e 'organizacoesMilitares' em backend/tests/ retorna ZERO ocorrencias; config.test.js e config-infra-gaps.test.js afirmam outras chaves do shape)

**O que o verde provaria.** E contrato congelado (I7) consumido por frontend/src/js/modals/signup.modal.js:221 via _domainOptions(config.postos), e o unico caminho pelo qual o ciclo de vida de rank/OM chega ao usuario anonimo. Hoje um rename de `name` para `nome` em listPostos, ou a perda do filtro `is_active = true` (config.service.js:143,150), quebra o cadastro em producao com a suite inteira verde.

**Casos:**

- anonimo (sem token) GET /api/config -> 200 com Array.isArray(body.postos) e body.postos.length >= 19; guard explicito de lista nao-vazia antes de qualquer filtro (anti C4)
- key-set exato de cada item de `postos`: deepEqual(Object.keys(item).sort(), ['abrev','id','name','sort_order']), nao apenas 'tem id'
- `postos` vem ordenado por sort_order crescente (afirmar monotonicidade sobre a lista inteira); e o unico motivo de a coluna existir
- key-set exato de `organizacoesMilitares`: ['id','name','sigla']; contem a org seed slug='default' e as 7 OMs de 001_core.sql:32-40, ordenadas por name
- admin DELETE /organizations/:id de uma OM -> anonimo GET /api/config nao lista mais aquele id em organizacoesMilitares, ENQUANTO GET /organizations autenticado ainda lista (LIST_ORGANIZATIONS nao filtra is_active)
- cada `postos[].id` resolve em SELECT id FROM ranks (o value do dropdown e a FK users.rank_id, nao um label)

### 55. ranks module inteiro (routes/controller/service/queries/schemas), /api/v1/ranks

- **Código:** `backend/src/modules/ranks/ranks.routes.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/ranks.test.js`
- **Cobertura hoje:** nenhuma (zero requests a /api/v1/ranks em tests/; os unicos hits de 'ranks' sao SELECT cru em setup: org-identity-gaps.test.js:251-278, users-admin.test.js:215)

**O que o verde provaria.** O comentario de ranks.queries.js:31-32 declara o invariante ('soft delete porque users.rank_id referencia a linha; desativar esconde do dropdown do cadastro') e nada o prende. Se DEACTIVATE_RANK virasse DELETE, a FK zeraria o posto de todo usuario e a suite ficaria verde. Se LIST_RANKS ganhasse WHERE is_active o painel admin perderia as linhas desativadas, tambem em silencio. As rotas POST/PUT/DELETE gated por requireAdmin sao 100% inexercitadas.

**Casos:**

- anonimo GET /api/v1/ranks -> 401 (rota e `auth` estrito) E, no mesmo teste, anonimo GET /api/config ainda devolve `postos` nao-vazio: o dropdown do cadastro NAO pode depender da rota admin
- nao-admin POST /ranks -> 403; PUT /ranks/:id -> 403; DELETE /ranks/:id -> 403, e em cada caso reler a linha no banco e afirmar que nome/is_active nao mudaram
- admin POST /ranks {nome:'Posto Teste X', nome_abrev:'PTX', sort_order:99} -> 201, body com id UUID, is_active:true e code === null (so os 19 seeds de 001_core.sql carregam `code`)
- admin PUT /ranks/:id {} (corpo vazio) -> 422 por updateRankSchema.min(1)
- PUT /ranks/<uuid aleatorio> -> 404; DELETE /ranks/<uuid aleatorio> -> 404; GET /ranks/not-a-uuid -> 422
- ROUND-TRIP DO SOFT-DELETE (o caso que prende o invariante): admin cria rank R -> PUT /users/:id {rank_id: R} -> DELETE /ranks/R -> 204; entao afirmar as QUATRO consequencias: (a) SELECT em ranks ainda tem a linha com is_active=false, (b) GET /users/:id ainda devolve posto_graduacao = nome de R (LEFT JOIN sobrevive), (c) GET /api/config anonimo NAO lista mais R em `postos`, (d) GET /ranks como admin AINDA lista R (LIST_RANKS nao filtra is_active)

### 56. deleteUser, revogacao de refresh tokens dentro da transacao (Q.REVOKE_ALL_USER_TOKENS)

- **Código:** `backend/src/modules/users/users.service.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/users-coverage.test.js`
- **Cobertura hoje:** parcial e enganosa: users-admin.test.js:306-366 e users-coverage.test.js:167-201 cobrem DELETE mas so afirmam is_active e owner_id do atlas; nenhum teste toca refresh_tokens no caminho de DELETE (o assert de revoked_at em users-coverage.test.js:91-98 e da api_key, outro fluxo)

**O que o verde provaria.** users.service.js:239 revoga todos os refresh tokens do usuario desativado e NADA afirma isso. Pior: a assercao obvia (POST /auth/refresh -> 401) passaria mesmo com a linha removida, porque auth.queries.js FIND_USER_BY_ID ja filtra is_active = true, e exatamente a armadilha registrada no livro-razao.md:50 (o teste do P1 batendo em /auth/me). O verde precisa vir da coluna, nao do status.

**Casos:**

- login do alvo -> guardar refreshToken -> admin DELETE /users/:id -> afirmar no BANCO: SELECT revoked_at FROM refresh_tokens WHERE user_id = alvo devolve >=1 linha e TODAS com revoked_at IS NOT NULL (controle negativo: remover a linha 239 e este assert cai; o 401 do /auth/refresh nao cairia)
- complemento comportamental no mesmo teste: POST /auth/refresh com o token antigo -> 401 (mas declarado como sintoma, nao como prova)
- caminho de rollback: DELETE de usuario com atlas SEM transferTo -> 409 -> afirmar que NENHUM refresh token do alvo ficou com revoked_at preenchido (a revogacao esta dentro do tx e tem de voltar junto)

### 57. deleteUser, guarda de reatribuicao de atlas contornavel por transferTo === userId

- **Código:** `backend/src/modules/users/users.service.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/users-coverage.test.js`
- **Cobertura hoje:** users-coverage.test.js:168-184 cobre o caso e afirma que ele e ACEITO ('atlas still owned by the (now inactive) source after self-transfer')

**O que o verde provaria.** ACHADO DE TESTE QUE PRENDE O BUG, NAO O FIX. A ConflictError de users.service.js:225-227 existe para impedir atlas orfao ('senao os atlas ficariam orfaos'), e ?transferTo=<o proprio id a desativar> satisfaz a guarda produzindo exatamente o estado que ela previne: atlas com owner_id apontando para um usuario is_active=false, que nao consegue mais logar para transferir. O teste atual afirma que isso esta certo, entao qualquer correcao futura fica VERMELHA por causa do teste, nao do codigo. Precisa de decisao de produto: ou rejeitar o self-transfer, ou provar que o estado resultante e recuperavel.

**Casos:**

- DELETE /users/:id?transferTo=:id (mesmo id) -> esperado 400/409; source permanece is_active=true e atlas.owner_id inalterado (controle negativo: sem a nova checagem o teste falha)
- irmao anti-over-fire: DELETE /users/:id?transferTo=<outro usuario ATIVO> continua 200 e move owner_id (a guarda nao pode disparar demais)
- nenhuma linha USER_DELETE em audit_trail para o self-transfer rejeitado
- SE o produto decidir manter o self-transfer: afirmar a recuperabilidade em vez da aceitacao, que um admin ainda consegue reatribuir o atlas orfao via POST /atlas/:id/transfer depois da desativacao. Hoje nada prova isso.
- exige reescrever users-coverage.test.js:168-184, que hoje afirma o oposto

### 58. Papel derivado que atravessa a fronteira: `connected.role` do WS e `role` do broadcast sharing_updated para os niveis manage/comment

- **Código:** `backend/src/modules/collab/collab.gateway.js`
- **Tipo:** WebSocket · **Fatia:** `be-utils`
- **Cobertura hoje:** tests/ws/collab-roles.test.js (so owner/write/read/admin); tests/ws/collab-broadcasts.test.js:144-169 asserta permission mas nunca role; tests/ws/collab-manage-selection.test.js usa 'manage' porem so para selecao, sem tocar o papel

**O que o verde provaria.** O frontend gateia toda a UI pelos SEIS papeis de session-context.js, e o unico canal que entrega esse papel e o campo `role` do `connected` (collab.gateway.js:370) e do `sharing_updated` (sharing.controller.js:38,57). Nenhum teste asserta esse campo para manage/comment, e collab-broadcasts.test.js:167 asserta so `permission`, nunca `role`, apagar `toFrontendRole` do broadcast inteiro mantem tudo verde e um peer conectado deixa de re-gatear a UI quando sua permissao muda. Um teste unitario em roles.js nao cobre isso: se o gateway resolvesse a permissao errada antes de chamar o mapeador, o co-Gestor apareceria como 'viewer' com o unit test verde. E o mesmo ponto onde a presenca de selecao do co-Gestor ja foi silenciada uma vez.

**Casos:**

- share 'manage' -> connected.permission === 'manage' E connected.role === 'manager' (hoje so `permission` teria assert)
- share 'comment' -> connected.permission === 'comment' E connected.role === 'commenter'
- PUT /sharing/users/:id promovendo read->manage: o peer conectado recebe sharing_updated com action 'user_updated', permission 'manage' E role 'manager'
- POST /sharing/users com permission 'comment': o broadcast carrega role 'commenter'
- Controle negativo explicito no teste: assert.notEqual(connected.role, 'viewer') para o share 'manage', que e exatamente o valor que o bug de lista fechada produz

### 59. Isencao fail-open de usuario sem organizacao em orgIsActive() e getLiveAuthState() (invariante I9: token legado degrada para organization_id null)

- **Código:** `backend/src/utils/org-status.js`
- **Tipo:** integração · **Fatia:** `be-utils`
- **Cobertura hoje:** tests/integration/auth-live-reconciliation.test.js e tests/ws/collab-reauthz.test.js cobrem so desativacao/rebaixamento (fail-closed), sempre com usuario pertencente a uma org real

**O que o verde provaria.** Grep por 'organization_id: null' em backend/tests/ retorna ZERO ocorrencias, e o fixture createUser (tests/helpers/fixtures.js:30-32) atribui sempre a org 00000000-...-0001. Ou seja, o caminho `if (!organizationId) return true` e o LEFT JOIN de LIVE_AUTH_STATE nunca sao exercitados. Trocar o LEFT JOIN por INNER JOIN, ou o early-return por `return false` em nome de 'endurecer', derruba TODO usuario sem org para 401 em toda rota estrita, e a suite inteira fica verde porque nenhum teste tem um usuario assim. Simetricamente, a decisao deliberada de tratar org inexistente como ATIVA (anomalia, nao desativacao) nao tem nada que a prenda: inverte-la trancaria usuarios legitimos para fora sem nenhum teste vermelho. As reconciliacoes ja cobertas (auth-live-reconciliation.test.js) testam so o lado fail-CLOSED.

**Casos:**

- createUser(db, { organization_id: null }) + login -> requisicao autenticada a uma rota que passa pelo middleware `auth` estrito e NAO seja /auth/me (ex.: GET /api/v1/atlas) responde 200. Evitar /auth/me e deliberado: o livro-razao registra que ele rele o usuario e daria o mesmo resultado sem o fix (teste-que-nao-prende)
- orgIsActive(null) === true e orgIsActive(undefined) === true (isencao do token legado)
- orgIsActive(randomUUID() inexistente em organizations) === true (linha comentada como anomalia, hoje sem teste)
- getLiveAuthState(usuarioSemOrg.id) -> { organizationId: null, orgIsActive: true, userIsActive: true }, o LEFT JOIN + COALESCE nao pode retornar null nem false aqui
- getLiveAuthState(randomUUID() inexistente em users) === null (linha USER ausente e decisiva, oposto da regra da org) e a requisicao com token desse sub resulta 401
- Controle negativo: com a org do usuario desativada (is_active=false), a MESMA rota nao-/auth/me responde 401/403, garantindo que o teste do fail-open nao passou por o gate estar inteiramente morto

### 60. Aplicacao efetiva de redactUrl no ponto de log (error-handler.js:23 e request-logger.js:15)

- **Código:** `backend/src/utils/redact-url.js`
- **Tipo:** unitário · **Fatia:** `be-utils`
- **Cobertura hoje:** tests/unit/redact-url.test.js cobre bem a funcao pura; nenhum teste cobre a aplicacao dela no log real

**O que o verde provaria.** A funcao esta bem testada, mas a FIACAO nao tem nenhum prend. tests/unit/middleware-error-handler.test.js usa mockReq() com url '/test', sem query string: redactUrl('/test') devolve '/test' inalterado, entao apagar a chamada `redactUrl(req.url)` do error handler produz exatamente a mesma linha de log e todos os testes seguem verdes. O logger e 'silent' sob teste e request-logger.js nem sequer e montado (app.js: if (!config.isTest)), de modo que nenhuma integracao pode flagrar. O comentario do proprio arquivo declara o invariante ('Neither must ever land in plaintext in pino output') sobre uma credencial M2M nao-expirante (?api_key=), e hoje esse invariante nao tem guarda alguma.

**Casos:**

- Substituir logger.warn por um coletor (o errorHandler faz logFn.call(logger, ...) lendo a propriedade no momento da chamada, entao a atribuicao logger.warn = fn na instancia importada e suficiente; restaurar em finally), chamar errorHandler(new NotFoundError('X'), { method:'GET', url:'/api/v1/nomes/busca?q=rio&api_key=SEGREDO', user:{id:'u1'} }, res, noop) e assertar: JSON.stringify(objetoLogado) NAO contem 'SEGREDO', e objetoLogado.url casa /api_key=REDACTED/
- Mesmo caminho com um erro 5xx (statusCode 500), que roteia para logger.error e nao para logger.warn, as duas ramificacoes de logFn precisam redigir
- Parametro nao sensivel sobrevive: url '/a?page=2&api_key=X' -> objetoLogado.url contem 'page=2'
- requestLogger invocado diretamente com req.url='/x?token=SEGREDO' (ele nunca monta sob teste): o objeto logado nao contem 'SEGREDO'
- Controle negativo obrigatorio: remover redactUrl de error-handler.js e confirmar que o caso 1 fica VERMELHO (hoje ele fica verde, que e o defeito)

### 61. toFrontendRole(), mapeamento dos CINCO niveis de permissao para o vocabulario de papel do frontend

- **Código:** `backend/src/utils/roles.js`
- **Tipo:** unitário · **Fatia:** `be-utils`
- **Cobertura hoje:** nenhuma direta. tests/ws/collab-roles.test.js exercita so owner/write/read/admin, ou seja, reproduz no proprio teste a lista fechada de 4 papeis que o livro-razao proibe

**O que o verde provaria.** Nenhum arquivo em backend/tests/ contem as strings 'manager' ou 'commenter' (verificado por grep sobre tests/ inteiro). Logo, se as ramificacoes `permission === 'manage' -> 'manager'` e `permission === 'comment' -> 'commenter'` fossem apagadas, ambas cairiam no `return 'viewer'` final e a suite INTEIRA continuaria verde. O co-Gestor e o Comentarista seriam rebaixados a Visualizador no cliente, sem erro e sem log. Este e literalmente o bug da lista fechada que o livro-razao.md registra DUAS vezes (linhas 46 e 62) e cuja licao foi codificada so como regra de prosa + docs-integridade.test.js, nunca como teste que prende o codigo. Um verde hoje prova apenas que 4 dos 6 papeis existem.

**Casos:**

- toFrontendRole('manage') -> 'manager' (hoje inexercitado em todo o backend)
- toFrontendRole('comment') -> 'commenter' (hoje inexercitado em todo o backend)
- toFrontendRole('owner') -> 'owner'; toFrontendRole('write') -> 'editor'; toFrontendRole('read') -> 'viewer'
- INJETIVIDADE (o assert que prende qualquer colapso futuro, inclusive de um nivel novo): new Set(['owner','manage','write','comment','read'].map((p) => toFrontendRole(p))).size === 5, com guard de lista nao-vazia sobre o array de entrada
- Curto-circuito do admin global sobrepoe QUALQUER permissao: toFrontendRole('read', 'admin') === 'admin' e toFrontendRole('manage', 'admin') === 'admin'
- globalRole nao-admin nao interfere: toFrontendRole('manage', 'user') === 'manager'
- Fail-safe para menor privilegio: toFrontendRole(null) === 'viewer', toFrontendRole(undefined) === 'viewer', toFrontendRole('superuser') === 'viewer' (valor fora do CHECK da coluna nao pode virar papel elevado)

### 62. Gate de ambiente do SyncLedger: state.enabled = EBGEO_TRACE==='1' || NODE_ENV==='test' (invariante I14)

- **Código:** `backend/src/utils/sync-trace.js`
- **Tipo:** unitário · **Fatia:** `be-utils`
- **Cobertura hoje:** tests/unit/sync-trace.test.js cobre record/filter/clear/no-op-quando-desligado, mas a unica assercao sobre o gate de ambiente e neutralizada pelo proprio beforeEach

**O que o verde provaria.** COBERTURA VAZIA de alta prioridade. O teste tests/unit/sync-trace.test.js:20 se chama 'is enabled under NODE_ENV=test' mas o beforeEach (linha 15-18) executa setTraceEnabled(true) antes de cada it, a assercao isTraceEnabled()===true nao pode falhar, nem que o inicializador do gate fosse trocado por `false` fixo ou por `true` fixo. O verde nao prova nada sobre o gate. As consequencias das duas direcoes sao reais: gate sempre-falso apaga o SyncLedger e cega em silencio todos os waits deterministicos do Playwright (que passam a cair em timeout sem sinal); gate sempre-verdadeiro faz recordSpan alocar aneis e gravar spans em PRODUCAO no hot path de sync.service.js:713-754 e collab.rooms.js:121, que e violacao explicita de I14 (o cross-check `!config.isProd` de app.js:117 so impede montar a rota, nao impede gravar).

**Casos:**

- Subprocesso com NODE_ENV=production e EBGEO_TRACE='' : execFileSync(process.execPath, ['-e', "import('./src/utils/sync-trace.js').then(m => process.stdout.write(String(m.isTraceEnabled())))"]) imprime 'false'
- Subprocesso com NODE_ENV=production e EBGEO_TRACE=1 -> imprime 'true' (o opt-in explicito de dev continua funcionando)
- Subprocesso com NODE_ENV=test e EBGEO_TRACE ausente -> imprime 'true' (esta e a assercao que o teste atual FINGE fazer)
- Subprocesso com NODE_ENV=production, EBGEO_TRACE='' e recordSpan('A', TraceStage.SERVER_INSERTED, {opId:'x'}) -> getTrace('A').length === 0, provando que o custo em prod e realmente zero e nao so a leitura da flag
- Correcao do teste existente: mover a assercao do gate para FORA do beforeEach que forca setTraceEnabled(true), ou remove-la do arquivo por ser inverificavel ali

### 63. Serializacao por socket das mensagens WS (ws._messageChain) em collab.gateway.js

- **Código:** `backend/src/modules/collab/collab.gateway.js`
- **Tipo:** WebSocket · **Fatia:** `livro-razao`
- **Arquivo sugerido:** `backend/tests/ws/collab-socket-serialization.test.js`
- **Cobertura hoje:** nenhuma - backend/tests/ws/collab-advanced.test.js:386 evita explicitamente a rajada (aguarda ack entre ops)

**O que o verde provaria.** Um verde provaria que UM socket em rajada nao consegue abrir N pushOperations concorrentes e esgotar o pool (poolMax=10), travando o processo inteiro. Se eu reverter as linhas 395-400 para o 'handleMessage(ws, data)' sem await (o fire-and-forget original), NENHUM teste fica vermelho: collab-advanced.test.js 'Concurrent Writers' espera ack1 antes de mandar a segunda op, ou seja, evita de proposito a rajada que causou o bug. Essa e a metade nao codificada da entrada 2026-07-18 regressao-propria.

**Casos:**

- Um unico socket envia N > poolMax (ex.: 25) mensagens 'operation' sem esperar ack; todas recebem ack e nenhuma erra
- Durante a rajada, um GET /api/v1/health por supertest responde 200 dentro de um bound (ex.: 2s) - prova que o pool nao foi esgotado por um cliente so
- A ordem de aplicacao respeita a ordem de envio: create seguido de N updates no mesmo entityId termina com o valor do ULTIMO update no Postgres
- Rajada intercalando tipos (ping/cursor/operation) nao reordena nem perde operation
- Uma mensagem que lanca no meio da cadeia nao quebra a cadeia: as mensagens seguintes do mesmo socket continuam sendo processadas (o .catch do _messageChain)

### 64. pushOperations: SET LOCAL lock_timeout '5s' + 55P03 -> ServiceUnavailableError (503)

- **Código:** `backend/src/modules/sync/sync.service.js`
- **Tipo:** integração · **Fatia:** `livro-razao`
- **Arquivo sugerido:** `backend/tests/integration/sync-push-lock-timeout.test.js`
- **Cobertura hoje:** nenhuma - backend/tests/integration/sync-push-serialization.test.js cobre o lock existir, ser por atlas e o cursor incremental nao pular op, mas nunca ultrapassa o lock_timeout

**O que o verde provaria.** Um verde provaria que a contencao no advisory lock por atlas FALHA RAPIDO em 503 retentavel em vez de reter conexao do pool indefinidamente. Hoje nenhum teste distingue 'esperei e consegui' de 'esperei para sempre': se eu apagar as linhas 656-670 (o SET LOCAL e o catch de 55P03), a suite inteira continua verde, porque sync-push-serialization.test.js segura o lock por apenas 500ms, muito abaixo dos 5s. A licao do livro-razao (2026-07-18 regressao-propria: lock tomado depois de abrir a transacao esgotava o pool) NAO esta presa.

**Casos:**

- Segurar pg_advisory_xact_lock(0x53594e43, hashtext(atlasId)) numa conexao independente por >5s; um POST /atlas/:id/sync concorrente deve responder 503 (nao pendurar, nao 500) dentro de ~5-6s
- O corpo do 503 deve trazer o envelope de erro padrao com a mensagem em pt-BR ('Servidor ocupado processando outra sincronizacao deste atlas')
- Controle negativo explicito no comentario do teste: sem o SET LOCAL lock_timeout a requisicao nunca settla
- Apos o 503 a transacao esta desfeita: nenhuma operacao do batch foi persistida (SELECT no operations log = 0 linhas para aquele op_id)
- Retentar o mesmo batch (mesmo op_id) depois de liberar o lock retorna 200 e persiste exatamente uma vez (idempotencia preservada pelo caminho de falha)

### 65. applyCommentOp: isEditor = permission === 'write' || 'manage' || 'owner' (lista fechada viva)

- **Código:** `backend/src/modules/sync/sync.service.js`
- **Tipo:** integração · **Fatia:** `livro-razao`
- **Arquivo sugerido:** `backend/tests/integration/comments-manage-tier.test.js`
- **Cobertura hoje:** parcial - backend/tests/integration/comments.test.js:141 cobre 'an Editor CAN edit and delete ANY comment', mas o arquivo nunca cria um share 'manage'

**O que o verde provaria.** Um verde provaria que o co-Gestor ('manage') e tratado como editor no gate de autoria de comentario. Esta e EXATAMENTE a lista fechada que a constituicao proibe em dois lugares por ja ter causado bug real duas vezes, e ela esta viva na linha 1241. Se eu apagar o '|| permission === \"manage\"', nenhum teste fica vermelho: comments.test.js so exercita Editor (write) e Comentarista. A licao da linha 2026-07-18 doc-sobre-codigo foi presa no handleSelection e NAO no sync.service.

**Casos:**

- Um usuario com share 'manage' EDITA o comentario de outro usuario via push de sync -> aplicado (nao silenciosamente descartado)
- Um usuario com share 'manage' RESOLVE (status) o comentario de outro usuario -> aplicado
- Um usuario com share 'manage' DELETA o comentario de outro usuario -> soft-delete aplicado, com cascata nas replies
- Controle negativo pareado: 'comment' (Comentarista) no comentario alheio continua bloqueado; 'read' continua 403
- Guarda contra a proxima regressao da classe: assercao tabelada sobre todos os cinco niveis (read/comment/write/manage/owner) x acao-em-comentario-alheio, para que um nivel novo obrigue a atualizar a tabela

### 66. Push de sync (REST e WS) por usuario com permissao 'manage'

- **Código:** `backend/src/modules/sync/sync.service.js`
- **Tipo:** integração · **Fatia:** `livro-razao`
- **Arquivo sugerido:** `backend/tests/integration/sync-manage-tier-authz.test.js`
- **Cobertura hoje:** nenhuma - backend/tests/integration/atlas-config-authz.test.js cobre 'manage' em settings/sharing (nao em escrita de entidade); nenhum sync-*.test.js usa createShare(..., 'manage', ...)

**O que o verde provaria.** Um verde provaria que o co-Gestor consegue de fato ESCREVER entidades colaborativas, e nao so configurar o atlas. Hoje nenhum teste de sync (nenhum dos ~30 sync-*.test.js) cria um share 'manage': o grep por 'manage' em backend/tests casa apenas 9 arquivos, todos de sharing/config/selection. Se assertOperationAllowed ou o requireAtlasPermission da rota /sync ganhar uma lista fechada write|owner, o co-Gestor perde a escrita em silencio e a suite fica verde - a repeticao literal do bug do handleSelection, agora no caminho de escrita.

**Casos:**

- 'manage' cria feature via POST /atlas/:id/sync -> 200 + linha no Postgres
- 'manage' atualiza e move feature entre mapas via sync -> aplicado
- 'manage' cria/renomeia layer, group e map via sync -> aplicado
- Fronteira preservada: 'manage' NAO pode deletar (op delete e owner-only, sync.service.js:611) nem trancar mapa (locked, :616) -> 403
- 'manage' via socket WS ('operation') recebe ack, espelhando o caminho REST

### 67. Matriz de permissao do push de sync, nenhum teste prova que um usuario 'manage' consegue escrever feicao

- **Código:** `backend/tests/integration/permissions.test.js`
- **Tipo:** integração · **Fatia:** `saude-suite`
- **Cobertura hoje:** backend/tests/integration/atlas-config-authz.test.js (manage em settings/sharing) e ws/collab-manage-selection.test.js (manage em presenca) cobrem manage fora do push; o push de feicao por manage nao aparece em nenhum dos 126 arquivos

**O que o verde provaria.** AREA QUENTE SEM TESTE, no ponto exato do bug que ja ocorreu duas vezes. `describe('Permission Matrix')` enumera owner, writer, reader e stranger e para ai: os 19 casos nao criam nenhum share 'manage' nem 'comment'. Enquanto isso `src/modules/sync/sync.service.js:1241` faz `const isEditor = permission === 'write' || permission === 'manage' || permission === 'owner'`, uma lista fechada literal, o anti-padrao C1 que a constituicao proibe, hoje correta por acidente de manutencao e sem nada que a segure. Se alguem editar essa linha e derrubar `'manage'`, o co-Gestor perde silenciosamente o direito de escrever feicao e a suite inteira (126 arquivos) segue verde: a rota esta gateada em `requireAtlasPermission('comment')` (sync.routes.js:19), entao a decisao real por nivel acontece dentro do service, sem cobertura. Este e o mesmo silencio que ja tirou a presenca de selecao do co-Gestor.

**Casos:**

- Adicionar ao Permission Matrix o tier faltante com controle positivo: share 'manage' -> POST /atlas/:id/sync com op de feicao DEVE retornar 200 e a linha DEVE existir em `features` (assercao contra o Postgres, nao contra a resposta)
- Controle negativo simetrico no mesmo tier: 'manage' NAO pode deletar o atlas (owner-only), hoje so `atlas-config-authz.test.js:71` cobre isso
- Cobrir 'comment' nas duas direcoes no push: op de feicao -> 403 e nada persiste; op de comment -> 200 e persiste (existe em ws/collab-commenter-authz.test.js so pelo caminho WS, nao pelo REST /sync)
- Cobrir a assimetria de delete: sync.service.js:611 exige `permission !== 'owner'` para `op.type === 'delete'`, ou seja um WRITER nao deleta. Nenhum teste afirma isso; adicionar writer-deleta -> 403 e owner-deleta -> 200
- Controle negativo: remover `|| permission === 'manage'` de sync.service.js:1241 e confirmar que o novo caso falha

### 68. describe('Hybrid Snapshot/Incremental Pull') > 'incremental pull returns operations since version' e 'operations carry the frontend envelope fields', corpo inteiro dentro de `if (!res.body.data.isSnapshot)`

- **Código:** `backend/tests/integration/sync-snapshot-hybrid.test.js`
- **Tipo:** integração · **Fatia:** `saude-suite`
- **Cobertura hoje:** backend/tests/integration/sync-frontend-format.test.js:607 tenta o mesmo pull, mas tem o mesmo defeito em forma mais branda (ver item proprio)

**O que o verde provaria.** EXPECT DENTRO DE IF QUE PODE NUNCA RODAR. Em :374 e :436 todo o bloco de assercoes esta guardado por `if (!res.body.data.isSnapshot) { ... }` sem nenhum `else`. Quando o servidor responde com snapshot o teste executa zero assercoes e reporta verde. O proprio comentario em :372-374 admite a duvida ('The response may be snapshot if min_version is higher'). O caminho incremental do pull e metade do contrato congelado I7 (envelope de operacao) e e justamente o que fica sem prova: se o servidor passasse a devolver snapshot SEMPRE, quebrando o pull incremental por completo, estes dois testes seguiriam verdes e ninguem saberia. Pior, e um verde que varia com estado de cleanup do banco, ou seja, cobertura que liga e desliga sozinha.

**Casos:**

- Forcar deterministicamente o ramo incremental no arrange (fixar `min_version = 0` para o atlas no setup) e transformar o `if` em assercao: `assert.equal(res.body.data.isSnapshot, false, 'com min_version=0 o pull DEVE ser incremental')`
- Cobrir o outro ramo como caso proprio e explicito: elevar `min_version` acima da versao pedida e afirmar `isSnapshot === true` + presenca do snapshot
- Contar o que foi checado: apos o loop/find, `assert.equal(ops.filter(o => o.entityId === featureId).length, 1)` em vez de so `assert.ok(op)`
- Controle negativo: fazer o handler devolver snapshot incondicionalmente e confirmar que os dois casos falham

### 69. describe('resolvePermission()') e describe('Permission Resolver'), duas suites unitarias inteiras sobre a MESMA funcao, e nenhuma das duas exercita 'manage' ou 'comment'

- **Código:** `backend/tests/unit/middleware-permissions.test.js`
- **Tipo:** unitário · **Fatia:** `saude-suite`
- **Cobertura hoje:** backend/tests/unit/permission-resolver.test.js (duplicata quase literal); backend/tests/integration/atlas-config-authz.test.js cobre manage/comment em rotas de settings e sharing, mas nunca a funcao nem a matriz

**O que o verde provaria.** DUPLICATA COM BURACO IDENTICO NAS DUAS COPIAS. `unit/middleware-permissions.test.js` e `unit/permission-resolver.test.js` importam a mesma `resolvePermission` de `src/middleware/permissions.js` e repetem caso a caso os mesmos cenarios (owner por ownerId, share write, share read, publico anonimo, privado sem share, precedencia owner>share). Custo duplo, retorno zero, e as duas divergem no dia em que uma for atualizada. O buraco e o mesmo nas duas: `PERMISSION_LEVELS` declara CINCO niveis (`read:1, comment:2, write:3, manage:4, owner:5`, permissions.js:12-18) e nenhuma das ~20 assercoes passa 'manage' ou 'comment' em `share.permission`. Alem disso nenhuma das duas toca a parte que realmente da bug: a COMPARACAO HIERARQUICA em permissions.js:115-119 (`resolvedLevel < requiredLevelNum`). `resolvePermission` e um passthrough trivial do share; o gate e que decide acesso, e ele nao tem teste unitario nenhum. Um verde aqui prova que um repasse de string funciona, nao que a hierarquia de 5 niveis funciona.

**Casos:**

- Apagar `unit/permission-resolver.test.js` (o mais pobre dos dois) e manter uma suite so
- Adicionar os niveis do meio ao passthrough: `share:{permission:'manage'}` -> 'manage' e `share:{permission:'comment'}` -> 'comment'
- Exportar `PERMISSION_LEVELS` (ou uma `hasPermission(resolved, required)`) e testar a MATRIZ 5x5 completa por indice: para cada par (resolvido, exigido) afirmar permitido sse indice(resolvido) >= indice(exigido). Isso e o que prende C1, e sao 25 assercoes que pegam qualquer nivel que suma da lista
- Casos-armadilha explicitos que hoje ninguem cobre: manage exigindo write DEVE passar; comment exigindo read DEVE passar; write exigindo manage DEVE falhar; nivel desconhecido ('editor', undefined) DEVE falhar em vez de virar `undefined < N` === false
- Controle negativo: rebaixar `manage` para 2 em PERMISSION_LEVELS e confirmar falha; com as suites atuais nada falha

### 70. describe('WebSocket Collaboration') > 'owner can connect to atlas' / 'writer can connect' / 'reader can connect to atlas', assercao de permissao no handshake

- **Código:** `backend/tests/ws/collab.test.js`
- **Tipo:** WebSocket · **Fatia:** `saude-suite`
- **Cobertura hoje:** backend/tests/ws/collab-manage-selection.test.js e ws/collab-commenter-authz.test.js cobrem o EFEITO (broadcast de selecao) dos tiers manage/comment, mas nenhum arquivo afirma o valor do campo `permission` no handshake

**O que o verde provaria.** TAUTOLOGIA PURA. As tres linhas sao `assert.ok(connected.permission === 'owner' || connected.permission)` (:76), `=== 'write' || connected.permission` (:86) e `=== 'read' || connected.permission` (:96). O segundo operando torna a expressao verdadeira para QUALQUER permissao truthy, entao o primeiro operando nunca decide nada. Se o handshake do collab devolvesse 'read' para o owner, 'owner' para o reader, ou trocasse os tres entre si, as tres passam verdes. Isto e exatamente a classe C1 (lista fechada de permissao) mascarada por C4 (cobertura vazia): a unica coisa que estes 3 testes provam e que o campo `permission` existe e nao e string vazia. O handshake do WS e onde o frontend le o nivel para gatear a UI (presenca de selecao editor-gated), ou seja, o campo que estes testes fingem verificar e o mesmo que ja causou bug real duas vezes.

**Casos:**

- Trocar as tres por igualdade estrita: `assert.equal(connected.permission, 'owner')`, `'write'`, `'read'` respectivamente
- Adicionar os dois niveis do meio que nao existem em nenhum handshake: um share 'manage' deve chegar como `permission === 'manage'` e um share 'comment' como `permission === 'comment'` (hoje `ws/collab-manage-selection.test.js` cria o share 'manage' mas nunca afirma o valor devolvido no `connected`)
- Controle negativo obrigatorio: mudar o servidor para devolver `permission: 'read'` fixo e confirmar que os 5 casos falham; com o assert atual nenhum falha

### 71. 'stranger cannot connect to private atlas', 'invalid token is rejected', 'connection with nonexistent atlasId fails', 'connection with invalid (non-UUID) atlasId is rejected', catch que so afirma que algo lancou

- **Código:** `backend/tests/ws/collab.test.js`
- **Tipo:** WebSocket · **Fatia:** `saude-suite`
- **Cobertura hoje:** nenhuma; ws/collab-reauthz.test.js cobre revogacao no sweep, nao a recusa no handshake

**O que o verde provaria.** TESTE-QUE-NAO-PRENDE (C3). Os quatro casos fazem `try { await createWsClient(...); assert.fail() } catch (err) { assert.ok(err) }` (collab.test.js:104-118) ou `assert.ok(err.message)`. Qualquer erro satisfaz: um typo na URL do helper, uma porta errada, o servidor de teste ainda nao escutando, um TypeError dentro do proprio `createWsClient` ou um timeout de rede passam identicos a um 403 de autorizacao. O teste nao distingue 'o servidor recusou o estranho' de 'a conexao nao chegou a existir', que sao exatamente os dois estados que o teste precisa separar. `collab-advanced.test.js:497-522` e o caso mais explicito: o catch aceita `Timeout` OU `error` OU `403` OU `Connection` na mensagem, o que cobre praticamente todo modo de falha concebivel, inclusive infraestrutura quebrada. Se o gate de autorizacao do socket fosse removido inteiro e a conexao passasse a cair por outro motivo qualquer, verde.

**Casos:**

- Afirmar o codigo de fechamento do WS, nao a existencia do erro: capturar o `close` frame e `assert.equal(code, 4403)` (ou o codigo que `src/modules/collab` realmente emite) e a razao
- Onde a recusa e no upgrade HTTP, afirmar o status: `assert.match(err.message, /Unexpected server response: 403/)`, nunca `/Timeout|error|Connection/`
- Separar 'nao conectou' de 'conectou e foi expulso': afirmar tambem que nenhuma mensagem `connected` chegou E que nenhuma sessao foi gravada (`SELECT count(*) FROM ... sessions WHERE atlas_id = $1`)
- Trocar o teste de atlas inexistente por assercao de 404/403 determinista em vez de tolerar `Timeout`, que hoje e o resultado que o teste de fato observa
- Controle negativo: liberar o gate (aceitar todo token) e confirmar que os 4 falham

---

## P2, caminho de erro, fronteira, contrato entre módulos

### 72. Broadcast WS de map_duplicated e atlas_owner_changed (atlas.controller.js:71 e :81)

- **Código:** `backend/src/modules/atlas/atlas.controller.js`
- **Tipo:** WebSocket · **Fatia:** `be-atlas`
- **Cobertura hoje:** tests/ws/collab-broadcasts.test.js cobre atlas_deleted, atlas_updated e atlas_settings_updated; map_duplicated e atlas_owner_changed têm zero hits em tests/

**O que o verde provaria.** Invariante I16 (mutação colaborativa emite antes do res). collab-broadcasts.test.js prende 3 dos 5 broadcasts do módulo e deixa exatamente os dois mais consequentes de fora. atlas_owner_changed é o sinal que faz os peers re-resolverem o papel e re-gatearem a UI depois de uma troca de dono; se a linha sumisse, o co-Gestor e o ex-dono ficariam com a UI de dono até o sweep de heartbeat (~30s) e nada quebraria em teste. map_duplicated é o único aviso de que existe um mapa novo, já que a criação de mapa normal viaja por sync.

**Casos:**

- dois clientes WS conectados ao atlas; owner faz POST /atlas/:id/maps/:mapId/duplicate -> o peer recebe {type:'map_duplicated', mapId} e o mapId bate com o id retornado no corpo 201
- owner faz POST /atlas/:id/transfer -> o peer recebe {type:'atlas_owner_changed', atlasId, newOwnerId} com newOwnerId === member.id
- ordem: o peer recebe o broadcast e, quando ele chega, o banco JÁ tem owner_id = member.id (asserir contra o Postgres, a autoridade, e não contra a concordância entre clientes)
- controle negativo de escopo: um cliente conectado a OUTRO atlas não recebe nenhuma das duas mensagens

### 73. atlasSettingsSchema, validador custom min_zoom/max_zoom e default_basemap (atlas.schemas.js:36-48)

- **Código:** `backend/src/modules/atlas/atlas.schemas.js`
- **Tipo:** unitário · **Fatia:** `be-atlas`
- **Cobertura hoje:** nenhuma para o custom; atlas.test.js/atlas-advanced.test.js/collab-broadcasts.test.js só enviam pares válidos

**O que o verde provaria.** É lógica pura (Joi, sem banco) e nenhum teste a exercita: todos os PATCH de settings existentes mandam combinações válidas. Se o custom fosse removido ou a comparação invertida, os testes atuais continuariam verdes, cobertura vazia clássica. Vale também pinar o buraco estrutural: o validador só vê UM payload, então min e max enviados em PATCHes separados nunca são comparados e o estado em repouso pode violar o invariante.

**Casos:**

- unit: validate({min_zoom: 15, max_zoom: 8}) -> error; {min_zoom: 10, max_zoom: 10} -> ok (limite, não é '<' estrito); {min_zoom: 15} sozinho -> ok; {max_zoom: 8} sozinho -> ok
- unit: {min_zoom: -1} e {max_zoom: 23} -> error (bordas 0..22); {min_zoom: null} -> ok (allow(null))
- unit: {basemaps:['osm'], default_basemap:'satellite'} -> error; {basemaps:['osm'], default_basemap:'osm'} -> ok; {basemaps: [], default_basemap:'osm'} -> ok hoje (o guard exige basemaps.length>0), pinar como caracterização
- unit: bounds_2d com 3 pares -> error; com um par de 3 números -> error; com 2 pares de 2 números -> ok; null -> ok
- unit: chave desconhecida {foo:1} com stripUnknown:true (as mesmas VALIDATION_OPTIONS de validate.js:3-6) -> sem error e value.foo === undefined
- integration (armadilha, caracterização): PATCH {min_zoom:15} 200, depois PATCH {max_zoom:8} 200 -> GET /settings mostra min_zoom 15 > max_zoom 8; o invariante NÃO vale em repouso

### 74. cloneAtlas / duplicateMap perdem grid_style e temporal_config (atlas.service.js:306 e :416)

- **Código:** `backend/src/modules/atlas/atlas.service.js`
- **Tipo:** integração · **Fatia:** `be-atlas`
- **Cobertura hoje:** atlas-advanced.test.js 'clone preserves settings, maps, and features' (não olha as colunas) e sync-map-grid-temporal.test.js (caminho do sync apenas)

**O que o verde provaria.** Os dois INSERTs de maps enumeram colunas e OMITEM grid_style e temporal_config, então clone e duplicação devolvem o DEFAULT '{}' e apagam a Grade UTM e toda a configuração temporal do mapa. O import aceita as duas colunas (atlas.schemas.js:153-154, com comentário 'P9: sync ⊇ .ebgeo coverage'), e o sync as cobre (sync-map-grid-temporal.test.js), só o caminho clone/duplicate está solto. Nada hoje lê essas colunas depois de um clone, então a perda é invisível: um verde atual não prova nada sobre elas.

**Casos:**

- mapa com grid_style = {espacamento: 1000, cor: '#f00'} e temporal_config = {ativo: true, modo: 'relativo', unidade: 'h'} -> POST /atlas/:id/clone -> ler direto do banco o mapa clonado e asserir que as duas colunas são iguais às da origem (hoje ambas '{}')
- mesmo mapa -> POST /atlas/:id/maps/:mapId/duplicate -> idem no mapa duplicado
- CONTROLE POSITIVO no mesmo arquivo: POST /atlas/import com grid_style/temporal_config preenchidos preserva as duas (garante que o assert casa com algo e que a falha do clone não é do fixture)
- borda: mapa com as duas colunas em '{}' -> clone continua '{}' (sem NULL, a coluna é NOT NULL)

### 75. Nome default de clone/duplicação estoura VARCHAR(255) -> SQLSTATE 22001 não mapeado -> 500

- **Código:** `backend/src/modules/atlas/atlas.service.js`
- **Tipo:** integração · **Fatia:** `be-atlas`
- **Cobertura hoje:** atlas.test.js e atlas-advanced.test.js clonam só nomes curtos; atlas-gaps.test.js cobre o limite de 255 na CRIAÇÃO, nunca no clone

**O que o verde provaria.** atlas.name e maps.name são VARCHAR(255) (002_atlas.sql:12 e :81); cloneAtlas monta `${source.name} (cópia)` (:281) e duplicateMap `${map.name} (cópia)` (:421), somando 8 caracteres. atlas-gaps.test.js:362 JÁ PROVA que um nome de 255 chars é aceito na criação, então o estado é alcançável por uso legítimo. PG_ERROR_MAP em error-handler.js:60-67 não tem '22001', logo o erro cai no ramo genérico e vira 500 INTERNAL_ERROR num atlas perfeitamente válido. Se o código estivesse certo (truncar ou 400 limpo), o teste ainda prende; hoje ele expõe o 500.

**Casos:**

- criar atlas com name de 255 chars -> POST /atlas/:id/clone sem body -> asserir status !== 500 e error.code !== 'INTERNAL_ERROR' (esperado: 201 com nome truncado a 255, ou 400/422 explícito)
- criar mapa com name de 255 chars -> POST /atlas/:id/maps/:mapId/duplicate -> mesma asserção
- controle: nome de 247 chars (247+8=255, exatamente no limite) -> clone 201 e o nome resultante tem 255 chars
- clone encadeado: clonar 3x um atlas de nome curto -> cada clone tem 201 e o nome cresce; asserir que a cadeia não estoura em 500 quando cruza o limite

### 76. importAtlas zera settings (atlas.service.js:564) enquanto createAtlas herda o documento default do banco

- **Código:** `backend/src/modules/atlas/atlas.service.js`
- **Tipo:** integração · **Fatia:** `be-atlas`
- **Cobertura hoje:** atlas-import.test.js passa settings {theme:'dark'} em 2 casos e nunca lê GET /settings depois; atlas-gaps.test.js atlas-09 cobre o merge raso, não o shape inicial

**O que o verde provaria.** INSERT_ATLAS (queries:3-7) não passa settings, então a coluna cai no default completo de 002_atlas.sql:20-36 (features/basemaps/min_zoom/available_*). O import passa '{}' quando o payload não traz settings, e settings parcial substitui o documento inteiro (não há merge). Resultado: um atlas que chegou por 'salvar meu atlas local no servidor' devolve um shape de settings DIFERENTE de um criado no servidor, e settings é justamente o overlay que o frontend usa para gatear 3D/360/camadas por atlas. Nenhum teste compara os dois caminhos, então a divergência é invisível.

**Casos:**

- POST /atlas -> GET /atlas/:id/settings -> guardar o conjunto de chaves de topo (guard de lista não-vazia: asserir que veio pelo menos 'features' e 'basemaps')
- POST /atlas/import SEM atlas.settings -> GET /atlas/:id/settings -> asserir o MESMO conjunto de chaves (hoje volta {}) e settings.features.map_3d === true
- POST /atlas/import COM atlas.settings = {min_zoom: 5} -> asserir que min_zoom é 5 E que as demais chaves default continuam presentes (hoje só min_zoom sobrevive)
- consequência observável: PATCH /settings {features:{map_3d:false}} num atlas importado -> GET devolve features com apenas map_3d (o merge || de UPDATE_ATLAS_SETTINGS não repõe o default ausente)

### 77. Token público não é escopado ao atlas que o emitiu (atlas.service.js:143-154 vs permissions.js:92)

- **Código:** `backend/src/modules/atlas/atlas.service.js`
- **Tipo:** integração · **Fatia:** `be-atlas`
- **Cobertura hoje:** images.test.js:361-376 prende a negação de escrita do token público SÓ para imagens; cross-cutting-gaps.test.js:68-87 cobre revogação por is_public no mesmo atlas; nenhum teste usa o token de um atlas contra outro

**O que o verde provaria.** O token carrega a claim atlasId, mas requireAtlasPermission NUNCA a lê: para um principal 'public-<uuid>' ele pula a busca de share (UUID_RE) e decide só por is_public. auth.js:79-81 isenta esses principais da reconciliação, então o token entra em todas as rotas de atlas. O único guarda de um atlas privado contra um token público é a flag is_public, e nada prende isso hoje. atlas-advanced.test.js verifica as claims DENTRO do token (que a claim existe), o que não é a mesma coisa que verificar que o servidor a honra ou não.

**Casos:**

- atlas público A + atlas PRIVADO B (mesmo dono) -> token de A em GET /atlas/B -> 403 (negativo de acesso obrigatório pelo CLAUDE.md)
- token de A em GET /atlas/B/sync/0 e em POST /atlas/B/sync -> 403
- atlas público C (outro dono) -> token de A em GET /atlas/C -> hoje 200: CARACTERIZAR que a claim atlasId é decorativa, para que ninguém passe a confiar nela sem teste
- token de A em PUT /atlas/A (exige write) e em POST /atlas/A/sync -> 403 (o principal público é read-only mesmo no atlas de origem)
- token de A em POST /atlas/A/clone (a rota exige só 'read', então o gate PASSA) -> asserir que não vira 500: o INSERT com owner_id='public-<uuid>' quebra o cast de uuid; esperar 4xx limpo e SELECT count(*) FROM atlas WHERE owner_id::text LIKE 'public-%' === 0

### 78. authLimiter e envenenavel por chave em /auth/resend-verification e /auth/refresh (rate-limit.js:32 le req.body.username ANTES do validate stripUnknown)

- **Código:** `backend/src/modules/auth/auth.routes.js`
- **Tipo:** integração · **Fatia:** `be-auth`
- **Cobertura hoje:** backend/tests/integration/rate-limit.test.js, so /auth/login, e o caso 'does not throttle distinct usernames' assere justamente o comportamento que aqui vira bypass.

**O que o verde provaria.** A chave e `${req.ip}:${req.body?.username||''}` e o authLimiter e o PRIMEIRO middleware da rota (auth.routes.js:19 e :21), antes do `validate` que e quem descarta chaves desconhecidas (validate.js:5 stripUnknown). Nenhum dos dois schemas tem `username`, entao basta enviar um `username` aleatorio por request para ganhar um balde novo a cada tentativa. rate-limit.test.js so exercita /auth/login, onde o username E o alvo do ataque e por isso a chave funciona. Consequencia concreta: envio ilimitado de e-mail de verificacao e criacao ilimitada de linhas em email_verification_tokens a partir de um unico IP. ESPERE ESTE TESTE FALHAR HOJE, ele e o repro.

**Casos:**

- com RATE_LIMIT_FORCE=1: POST /auth/resend-verification (authMax+1)x com e-mail fixo e SEM campo username -> a ultima e 429 TOO_MANY_REQUESTS (linha de base: o limiter engaja nesta rota)
- repetir a rajada enviando `username: randomUUID()` a cada request -> assertar que a (authMax+1)-esima ainda e 429 (hoje sao todas 200: este e o defeito)
- apos a rajada envenenada, SELECT COUNT(*) FROM email_verification_tokens WHERE user_id=$1 -> <= authMax
- mesmo par de casos em POST /auth/refresh com refreshToken invalido + username-lixo variavel
- controle negativo: com RATE_LIMIT_FORCE removido, nenhuma rota devolve 429 (nao quebrar o skip de teste)

### 79. register() nao pode ser oraculo de existencia, mensagem 409 identica para colisao de username e de e-mail (auth.service.js:210-224)

- **Código:** `backend/src/modules/auth/auth.service.js`
- **Tipo:** integração · **Fatia:** `be-auth`
- **Cobertura hoje:** auth.test.js:175-197 (so status + error truthy) e auth-email-verification.test.js:109-119 (so status).

**O que o verde provaria.** A intencao anti-enumeracao esta documentada no codigo, mas auth.test.js:194 so assere `res.body.error` truthy e auth-email-verification.test.js:118 so assere o status 409. Se alguem 'melhorasse' a UX trocando a mensagem do ramo de e-mail por 'Este e-mail já está cadastrado', os dois testes seguem verdes e /register vira oraculo de e-mail: qualquer um descobre se um endereco tem conta no sistema.

**Casos:**

- registrar A (username u1, email e1); registrar B (username u1, email novo) -> 409, capturar body.error.message
- registrar C (username novo, email e1) -> 409, capturar body.error.message
- assertar strictEqual entre as duas mensagens E igualdade com 'Usuário ou e-mail já cadastrado.'
- assertar que nenhuma das respostas traz error.details com `field` (o 422 do Joi traz; o 409 nao pode trazer)
- variante de caixa: registrar com e1.toUpperCase() -> 409 com a MESMA mensagem (prende o LOWER() de CHECK_EMAIL_EXISTS em auth.queries.js:60; sem ele a colisao so seria pega pelo indice unico idx_users_email_lower e o errorHandler devolveria 'Resource already exists', mensagem distinguivel)
- idem para username em caixa diferente (prende o LOWER() de CHECK_USERNAME_EXISTS)

### 80. resendVerification(), guarda `user && user.email && !user.email_verified` (auth.service.js:310)

- **Código:** `backend/src/modules/auth/auth.service.js`
- **Tipo:** integração · **Fatia:** `be-auth`
- **Cobertura hoje:** backend/tests/integration/auth-email-verification.test.js:121-143, cobre desconhecido e nao-verificado; o assert final e `n >= 2`, que nada diz sobre vazamento.

**O que o verde provaria.** O teste atual cobre e-mail desconhecido e conta nao verificada; o ramo JA VERIFICADO nao e tocado. Removida a condicao `!user.email_verified`, tudo segue verde e uma conta ja confirmada vira gerador ilimitado de token de verificacao e de e-mail (mail bomb no endereco da vitima, combinado com o item do rate limiter). Alem disso o teste existente se chama 'never leaks account existence' e NUNCA compara as duas respostas, o nome promete o que os asserts nao verificam.

**Casos:**

- registrar com e-mail, confirmar (email_verified=true), contar linhas em email_verification_tokens; POST /auth/resend-verification com esse e-mail -> 200 e a contagem permanece IDENTICA
- assertar deepEqual entre o body da resposta para e-mail ja verificado, para e-mail inexistente e para e-mail nao verificado (as tres tem que ser indistinguiveis, e o que 'never leaks' significa)
- conta NAO verificada, resend com o e-mail em caixa diferente -> uma nova linha de token e criada (prende o LOWER() de FIND_USER_BY_EMAIL, auth.queries.js:66)
- controle negativo: conta nao verificada, resend na caixa original -> nova linha criada (o caminho feliz continua vivo)

### 81. register(), verificacao best-effort: falha ao emitir/enviar token nao pode 500 nem orfanar a conta (auth.service.js:246-252)

- **Código:** `backend/src/modules/auth/auth.service.js`
- **Tipo:** integração · **Fatia:** `be-auth`
- **Cobertura hoje:** nenhuma. auth-email-verification.test.js le o token direto da tabela e nunca exercita falha na emissao/envio; utils/mailer.js tem zero referencias em tests/.

**O que o verde provaria.** O try/catch existe para nao orfanar uma conta ja commitada (o comentario diz isso), mas nada o exercita: em teste o mailer nunca lanca porque SMTP nao esta configurado e ele apenas loga (mailer.js:67). Removido o try/catch, a suite inteira segue verde e, em producao com SMTP instavel, o usuario recebe 500, a linha em users fica gravada e ele nao consegue nem re-registrar (409) nem logar (EMAIL_NOT_VERIFIED), conta permanentemente inacessivel.

**Casos:**

- instalar no teste um trigger BEFORE INSERT em email_verification_tokens que faz RAISE EXCEPTION (falha deterministica e real, sem mock do mundo); POST /auth/register com e-mail -> 201 com data.id
- a linha em users EXISTE com email_verified=false, e COUNT(*) em email_verification_tokens para esse user = 0
- DROP do trigger no after(); POST /auth/resend-verification para o mesmo e-mail -> 200 e agora existe 1 token (o caminho de recuperacao prometido pelo comentario funciona de fato)
- confirmar por esse token -> login 200 (a conta nao ficou presa)
- controle negativo: com o trigger fora, register com e-mail cria exatamente 1 token (o caminho feliz nao regrediu)

### 82. Readiness /api/v1/health, ramo 503 quando o banco esta fora (app.js:78-87)

- **Código:** `backend/src/app.js`
- **Tipo:** integração · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/integration/health-readiness.test.js (arquivo proprio: encerra o pool)`
- **Cobertura hoje:** backend/tests/integration/health.test.js:22-25 (so o 200)

**O que o verde provaria.** O catch e a unica coisa que faz o readiness reprovar quando o Postgres cai, e ele nunca roda. Hoje trocar 503 por 500, mudar o envelope (que e escrito a mao, NAO passa pelo errorHandler) ou remover o try/catch inteiro deixa a suite verde, e o consumidor e o probe do balanceador: uma instancia sem banco continuaria em rotacao.

**Casos:**

- Arquivo isolado (cada arquivo roda em processo proprio sob `node --test`, entao destruir o pool aqui nao contamina os outros): GET /api/v1/health -> 200 {status:'ok'} como baseline.
- Em seguida `pgp.end()` (src/database/index.js:104 exporta pgp) e GET /api/v1/health -> status 503, body.error.code === 'SERVICE_UNAVAILABLE', body.error.message === 'Database unavailable'.
- No mesmo 503, afirmar que o body NAO tem `stack` nem o formato do errorHandler (prova que o ramo escrito a mao respondeu, e nao um 500 generico).
- Com o pool destruido, GET /api/v1/health sem token continua 503 e nao 401 (a rota permanece publica, que e o requisito do probe).

### 83. Alias /api/config serve o MESMO corpo que /api/v1/config (app.js:90-91)

- **Código:** `backend/src/app.js`
- **Tipo:** integração · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/integration/config.test.js`
- **Cobertura hoje:** backend/tests/integration/config.test.js:36-38 (so status 200) e config-infra-gaps.test.js:183-186 (so Cache-Control)

**O que o verde provaria.** O contrato congelado (I7) e verificado inteiramente contra /api/v1/config, mas o endpoint que o frontend usa no boot fail-fast e o ALIAS /api/config, do qual so se afirma `.expect(200)`. Se o alias fosse montado num router diferente, ficasse para tras numa refatoracao ou passasse a devolver outro shape, o teste de contrato seguiria verde e o app nao subiria (I8), cross-package, longe da causa.

**Casos:**

- deepEqual(body de GET /api/config, body de GET /api/v1/config) na mesma corrida (mesmo estado de DB).
- O alias emite os mesmos headers de seguranca (CSP com default-src 'none') e Cache-Control: no-cache.
- POST /api/config -> 404 (o alias nao amplia superficie de escrita).
- Controle negativo: apontar app.js:91 para um router vazio e confirmar que o deepEqual falha.

### 84. helmet hsts no ramo de producao (app.js:46)

- **Código:** `backend/src/app.js`
- **Tipo:** integração · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/integration/app-mount-gates.test.js (mesmo harness de child prod do item do /debug)`
- **Cobertura hoje:** backend/tests/integration/config-infra-gaps.test.js:158-161 (so a metade negativa)

**O que o verde provaria.** Outra metade vazia: o teste atual afirma so a AUSENCIA do header em ambiente de teste. Apagar a opcao `hsts` inteira de app.js deixa esse assert verde e producao sem HSTS. O verde reformulado prova que o ramo isProd emite o header com os valores configurados.

**Casos:**

- No child process com NODE_ENV=production: GET /api/v1/config -> strict-transport-security casa /max-age=15552000/ e /includeSubDomains/.
- Manter o assert de ausencia no processo de teste (o par e o que da sentido aos dois lados).
- Controle negativo: remover a chave `hsts` de app.js:46 e confirmar que o caso prod falha (helmet passaria a emitir o default de 180 dias, entao afirmar o VALOR, nao so a presenca).

### 85. helmet crossOriginResourcePolicy: 'cross-origin' (app.js:47)

- **Código:** `backend/src/app.js`
- **Tipo:** integração · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/integration/config-infra-gaps.test.js (infra-05)`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** Essa opcao existe para o frontend servido de outra origem conseguir carregar imagem do atlas, asset 3D e tile do 360; o default do helmet e same-origin. Nenhum teste le esse header, entao remove-lo passa verde no backend e quebra o E2E/deploy do outro pacote (I15), com sintoma visual e causa invisivel.

**Casos:**

- GET /api/v1/config -> header 'cross-origin-resource-policy' === 'cross-origin'.
- O mesmo header numa resposta BINARIA, que e o caso que de fato importa: um GET autenticado de imagem do atlas e um GET de /api/v1/assets3d/<asset> (se so o JSON for checado, uma futura sobrescrita de header por rota de asset passaria despercebida).
- Controle negativo: remover a opcao de app.js:47 e confirmar que ambos falham.

### 86. flexibleAuth global nao pode quebrar rota publica com credencial invalida (app.js:70 + flexible-auth.js:60-63)

- **Código:** `backend/src/app.js`
- **Tipo:** integração · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/integration/config.test.js`
- **Cobertura hoje:** parcial: identity.test.js:79 (x-api-key malformado -> anonimo); nada para JWT invalido em rota publica

**O que o verde provaria.** Todas as assercoes de token invalido/expirado hoje batem em rota ESTRITA e esperam 401 (auth.test.js:94-99, auth-edge-cases.test.js:123-142). Nenhuma prova o oposto, que e o caminho anonimo do I8: com um token velho no localStorage, GET /api/config precisa continuar 200. Se o catch interno do jwt.verify (ou o catch externo) deixasse de engolir, TODO usuario de volta veria 'EBGeo indisponivel' no boot, falha cross-package, sem erro no backend.

**Casos:**

- GET /api/config com `Authorization: Bearer nao.e.um.jwt` -> 200 e body.data presente.
- GET /api/config com JWT bem-formado assinado com OUTRO segredo -> 200.
- GET /api/config com JWT expirado (exp no passado) -> 200.
- GET /api/config com `x-api-key: nao-uuid` -> 200 (o ramo UUID_RE de flexible-auth.js:44).
- Par negativo obrigatorio: os mesmos quatro contra GET /api/v1/auth/me -> 401. Sem ele, um '200 sempre' passaria verde ate se a rota tivesse virado publica por engano.

### 87. Defaults de config.appConfig servidos ao browser nao podem apontar para localhost/porta fixa (config.js:139-178)

- **Código:** `backend/src/config.js`
- **Tipo:** unitário · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/unit/config-defaults.test.js`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** C6 ja aconteceu DUAS vezes (SEARCH_API_URL :3001, SV360_SERVICE_URL localhost:3000) e os proprios comentarios em config.js:157-171 documentam o estrago: default que so funciona por acidente do proxy do Vite e que viaja para o browser via /api/config. Nada impede o terceiro. O verde prova que nenhum default entregue ao cliente aponta para a maquina de dev.

**Casos:**

- Apagar do process.env todas as chaves de appConfig, importar com cache-buster (`await import('../../src/config.js?c6')`, config.js le env no corpo do modulo) e, para cada valor string de config.appConfig, afirmar que nao casa /localhost|127\.0\.0\.1|0\.0\.0\.0/ nem uma porta literal em host proprio.
- GUARD OBRIGATORIO (C4): assert de que a varredura examinou >= 14 chaves e reportar a contagem; sem isso um rename de `appConfig` zera o coletor e o teste fica verde sem checar nada.
- Controle negativo do proprio coletor: setar SV360_SERVICE_URL='http://localhost:3000/api/v1/sv360' e confirmar que a varredura ACUSA e nomeia a chave.
- Escopo explicito e comentado: config.cors.origin ('http://localhost:3000') e default de dev DELIBERADO e nao entra na varredura, a varredura e so do que o servidor entrega ao browser.

### 88. NUMERIC_ENV_RULES cobre toda env numerica lida em config.js (config.js:189-207 vs 37-134)

- **Código:** `backend/src/config.js`
- **Tipo:** unitário · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/unit/config-env-rules.test.js`
- **Cobertura hoje:** nenhuma (unit/config.test.js:154-221 exercita 6 das 17 regras, sempre pelo piso)

**O que o verde provaria.** A lista e mantida a mao e e o antidoto do parseInt silencioso descrito em config.js:252-260. Uma env numerica nova entra em config.js sem regra e o trap NaN volta inteiro, sem nada falhar. O estado atual ja mostra a deriva: SQLITE_BLOB_WORKERS esta na lista sem ser lida em config.js, e TERRAIN_/HILLSHADE_MINZOOM/MAXZOOM sao lidas sem regra nenhuma.

**Casos:**

- Ler o texto de src/config.js, extrair toda chave de `parseInt(optional('X'` e de `optionalInt('X'`; afirmar que cada uma esta em NUMERIC_ENV_RULES ou numa ALLOWLIST explicita e comentada no teste (hoje so PORT, que tem validacao propria em config.js:233-236). A mensagem de falha precisa NOMEAR a chave orfa.
- Guard de lista nao-vazia: assert de que foram extraidas >= 18 chaves (a regex nao pode deixar de casar em silencio).
- Caminho inverso: toda chave de NUMERIC_ENV_RULES que nao aparece em config.js precisa de justificativa na allowlist (SQLITE_BLOB_WORKERS e lida em utils/sqlite-blob-pool.js).
- Pre-requisito: exportar NUMERIC_ENV_RULES de config.js (ou extrai-la do mesmo texto-fonte, como faz docs-integridade).

### 89. optionalInt: truncagem/valores absurdos em TERRAIN_/HILLSHADE_*ZOOM (config.js:14-19, 145-148)

- **Código:** `backend/src/config.js`
- **Tipo:** unitário · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/unit/config-defaults.test.js`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** optionalInt usa parseInt e so rejeita NaN: '12abc' vira 12 e '-1' passa, exatamente a truncagem silenciosa que NUMERIC_ENV_RULES existe para impedir, so que FORA da validacao. O valor viaja para o contrato congelado: config.service.js:116-123 injeta minzoom/maxzoom no terrainSource/hillshadeSource do MapLibre. Um verde aqui prova que a borda numerica do config servido ao cliente e conhecida em vez de acidental.

**Casos:**

- Com cache-buster no import de config.js: TERRAIN_MINZOOM='' -> undefined; 'abc' -> undefined; '12abc' -> HOJE 12 (pinar o comportamento observado e marcar como armadilha, ou corrigir e afirmar undefined); '-1' -> HOJE -1.
- Fronteira do falsy: TERRAIN_MINZOOM='0' -> 0 e NAO undefined (Number.isFinite(0) e true; a leitura ingenua com `||` daria undefined).
- TERRAIN_MAXZOOM menor que TERRAIN_MINZOOM nao e rejeitado hoje, afirmar o estado atual para que a mudanca seja deliberada.
- Complemento em integration: com TERRAIN_MINZOOM invalido, GET /api/config nao emite `minzoom: NaN` no terrainSource (o guard Number.isFinite de config.service.js:123 e o que segura).

### 90. Ordem do shutdown gracioso: closeAllSockets ANTES de server.close, timer de forca, guard de reentrancia (index.js:37-60)

- **Código:** `backend/src/index.js`
- **Tipo:** unitário · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/unit/shutdown.test.js`
- **Cobertura hoje:** backend/tests/ws/collab-shutdown-presence.test.js:118-151 (closeAllSockets isolado; nao a sequencia de index.js)

**O que o verde provaria.** O bug P4 esta documentado no proprio comentario (server.close() nunca chamava o callback com socket collab aberto, pulando blobPool.closeAll, pgp.end e process.exit). A regressao existente cobre so a PECA isolada (closeAllSockets em collab-shutdown-presence.test.js:118), nao a ORDEM em index.js: inverter as duas linhas reintroduz o bug exato com a suite inteira verde. Pre-requisito: exportar `shutdown` (ou move-lo para src/shutdown.js). Teste por sinal real nao serve, em Windows child.kill('SIGTERM') nao entrega sinal e o handler nao roda, entao um teste por spawn ficaria verde sem executar nada.

**Casos:**

- Com fakes: um `server` cujo close(cb) so chama cb DEPOIS de closeAllSockets ter resolvido. shutdown('SIGTERM') resolve e chama process.exit(0). Se as duas chamadas forem invertidas o teste estoura por timeout, que e literalmente o sintoma do bug original.
- blobPool.closeAll rejeitando nao impede pgp.end() nem o exit(0) (o .catch(()=>{}) de index.js:52).
- closeAllSockets lancando -> logger.error chamado e process.exit(1) (o ramo catch).
- Duas chamadas seguidas (SIGINT duplo) executam a sequencia UMA vez: closeAllSockets chamado 1x, server.close chamado 1x.
- Com um server.close que nunca chama o callback e timers falsos: process.exit(1) dispara em SHUTDOWN_TIMEOUT_MS (10s) e o timer foi unref'ado (nao segura o processo).

### 91. Gate de montagem do modulo debug em app.js:117, isTraceEnabled() && !config.isProd (I14: tracing inalcancavel em producao)

- **Código:** `backend/src/app.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/debug-trace-mount.test.js`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** O invariante 'SyncLedger nunca em producao' nao tem nenhum teste: sob NODE_ENV=test a rota esta sempre montada e ninguem verifica o ramo desligado. Se a clausula !config.isProd cair, um EBGEO_TRACE=1 vazado para o ambiente de producao expoe o ring de tracing na internet, e nada acusa. O verde de hoje prova apenas que a rota existe em teste.

**Casos:**

- setTraceEnabled(false) (exportado por src/utils/sync-trace.js) -> const app2 = createApp() -> GET /api/v1/debug/trace?atlasId=<uuid> com token de admin -> 404 (rota inexistente), e nao 401/403; restaurar com setTraceEnabled(true) no finally.
- Discriminador do ramo de producao: process.env.NODE_ENV='production' + EBGEO_TRACE='1', reimportar o grafo com cache-busting (await import('../../src/app.js?prod=1')) e createApp() -> GET /api/v1/debug/trace?atlasId=<uuid> -> 404. Com a clausula !config.isProd removida a resposta viraria 401, o que distingue os dois mundos. Restaurar NODE_ENV no finally.
- Controle positivo no mesmo arquivo: com o tracer ligado e NODE_ENV=test, a mesma requisicao responde 401 (rota montada, auth negando), prova que o 404 acima vem da NAO montagem e nao de um erro de path.

### 92. configOverridesSchema rejeita as chaves TOP-LEVEL de catalogo (basemaps / tilesets / basemapStyles / postos)

- **Código:** `backend/src/modules/config/config.admin.schemas.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/config-admin.test.js`
- **Cobertura hoje:** backend/tests/integration/config-admin.test.js (so a chave inventada `bogusSection`)

**O que o verde provaria.** O docstring do schema diz que basemaps/tilesets/layers 'tem seu proprio CRUD e nao devem ser injetados por aqui', e essa exclusao e o que impede um bypass do assertValidStyle: se alguem adicionar `basemaps: Joi.object().unknown(true)` (parece coerente, ja que analysisLayers esta la), um PUT de override pode plantar um basemapStyles invalido que nunca passa pelo validador MapLibre e vai verbatim para o boot. O unico teste hoje usa a chave `bogusSection`, um nome que ninguem jamais adicionaria; ele nao prende as chaves REAIS que a intencao exclui.

**Casos:**

- PUT /config/admin {basemaps:{osm:{name:'x'}}} como admin -> 422.
- PUT /config/admin {basemapStyles:{osm:{version:7}}} -> 422 (a rota de bypass do validador de style).
- PUT /config/admin {tilesets:[]} -> 422 e PUT {postos:[]} -> 422.
- Positivo de contraste no mesmo teste: PUT {analysisLayers:{enabled:false}} -> 200 (a assimetria e deliberada; sem este caso o teste viraria 'tudo e 422').

### 93. rasterDemSource(), escolha entre forma TileJSON e forma template {z}, e o guard Number.isFinite de minzoom/maxzoom

- **Código:** `backend/src/modules/config/config.service.js`
- **Tipo:** unitário · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/unit/config-raster-dem.test.js`
- **Cobertura hoje:** backend/tests/integration/config.test.js (so afirma terrainSource.type === 'raster-dem'); frontend/tests/e2e/config-contract.e2e.test.js (so o invariante terrain.enabled === Boolean(url) do map3d)

**O que o verde provaria.** O comentario em config.service.js:99-115 documenta um bug REAL de producao (terreno servido por template ia parar em `url:` e o MapLibre nao resolvia) e o fix nao tem teste de regressao, contrariando a regra 'bug corrigido vira repro test'. O unico assert existente e `cfg.map2d.terrainSource.type === 'raster-dem'`, que continua verde com QUALQUER das duas formas: e cobertura que nao distingue o caso corrigido do caso quebrado. Requer exportar rasterDemSource (hoje e privada) ou move-la para config.static.js; e matematica/formatacao pura, testavel em node sem banco.

**Casos:**

- rasterDemSource('https://h/terrain/tiles.json', undefined, undefined) -> deepEqual {type:'raster-dem', url:'https://h/terrain/tiles.json', tileSize:256}; assert 'tiles' in result === false.
- rasterDemSource('/cms/martin/fathom_terrain/{z}/{x}/{y}', undefined, undefined) -> tiles === ['/cms/martin/fathom_terrain/{z}/{x}/{y}'] e 'url' in result === false (o caso de producao que motivou o fix).
- rasterDemSource('/x/{z}/{x}/{y}', 0, 14) -> minzoom === 0 presente e maxzoom === 14 (borda: um `if (minzoom)` por truthiness perderia o zero, e 0 e valor legitimo).
- rasterDemSource('/x/{z}/{x}/{y}', NaN, Infinity) -> 'minzoom' in result === false e 'maxzoom' in result === false (o `x ?? 0` NAO protege NaN; e o Number.isFinite que protege).
- rasterDemSource('', 1, 2) === undefined e rasterDemSource(undefined) === undefined -> e o sinal de 'nao configurado' que faz map2d.terrainSource sumir do payload.
- Complemento de integracao no mesmo lote: com TERRAIN_URL de template, GET /api/config traz map2d.terrainSource.tiles definido e terrainSource.url ausente.

### 94. listPostos() / listOrganizacoesMilitares(), shape e filtro is_active das listas controladas servidas em GET /api/config

- **Código:** `backend/src/modules/config/config.service.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/config-personnel-contract.test.js`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** Nenhum teste do backend cita 'postos' ou 'organizacoesMilitares' (grep zerado em tests/), e o TOP_KEYS de config.test.js nao os inclui, entao remover as duas chaves do payload passa verde. Sao contrato cruzando pacotes (frontend/src/js/modals/signup.modal.js:221-222 e admin/users-tab.js:276-278 constroem os dropdowns a partir delas) e sao o UNICO caminho de codigo que le a tabela `ranks`, um modulo com cobertura nula. Um mapeamento errado (r.nome_abrev deixando de virar `abrev`, ou o filtro is_active caindo) quebra o cadastro em silencio, sem 500 que o teste de status pegue.

**Casos:**

- GET /api/config (anonimo) -> 'postos' e 'organizacoesMilitares' presentes; postos.length > 0 e organizacoesMilitares.length > 0 (guard nao-vazio antes de qualquer laco).
- O posto seedado 'Civil' vem como {id: <uuid>, name:'Civil', abrev:'Civ', sort_order:1}: chaves em ingles name/abrev (nao nome/nome_abrev) e id sendo o UUID da linha, nao o `code` (users guarda rank_id como FK).
- Ordenacao: os sort_order retornados sao nao-decrescentes ao longo do array (ORDER BY sort_order, nome).
- Negativo is_active: UPDATE ranks SET is_active=false WHERE nome='Civil'; GET /api/config nao lista 'Civil'; restaurar no finally. Idem para organizations (org 'Organização Padrão', id fixo 00000000-...-0001) -> OM desativada nao pode ser oferecida no cadastro.
- organizacoesMilitares expoe {id, name, sigla} e NAO expoe `slug` nem `is_active` (payload publico, sem auth: nada alem do necessario para o dropdown).
- features.self_registration presente e === config.security.allowSelfRegistration (account.control.js:692 le exatamente esse campo para mostrar 'Criar conta').

### 95. deepMerge de overrides admin vs o shape congelado do /api/config (arrays substituem; secoes abertas do Joi nao podem produzir payload que quebre o boot)

- **Código:** `backend/src/modules/config/config.service.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/config-override-contract.test.js`
- **Cobertura hoje:** backend/tests/integration/config-admin.test.js (merge de objeto, precedencia e um 422 de tipo em map2d.maxZoom)

**O que o verde provaria.** configOverridesSchema declara analysisLayers/dataLayers/map2d/map3d/streetView360 como objetos `.unknown(true)`, e deepMerge substitui arrays e escalares sem checar tipo. Um PUT admin {analysisLayers:{layers:'boom'}} passa a validacao e faz GET /api/config servir layers como string; como o boot do frontend e fail-fast e itera essas listas, o app inteiro para de subir por uma escrita valida na API. Nao ha nenhum teste que ligue o que o admin escreve ao que o contrato exige. Um verde hoje so prova que o merge de objeto funciona no caso feliz do titulo.

**Casos:**

- PUT /config/admin {analysisLayers:{layers:'boom'}} como admin -> esperado 422; se a implementacao aceitar, o teste falha e nomeia o defeito (o assert e o invariante, nao o status atual).
- Invariante de fechamento, apos qualquer sequencia de overrides aceitos: GET /api/config tem Array.isArray(analysisLayers.layers) && Array.isArray(dataLayers.layers) && Array.isArray(tilesets) && typeof basemaps === 'object' && !Array.isArray(basemaps).
- Substituicao (nao concatenacao) de array: com pelo menos um data_layer ativo no banco, PUT {dataLayers:{layers:[]}} -> GET /api/config traz dataLayers.layers.length === 0, provando replace; se alguem trocar deepMerge por concat, a lista viria duplicada.
- Merge profundo preserva irmaos: PUT {map2d:{minZoom:3}} nao apaga map2d.hillshade nem map2d.bounds vindos do STATIC.
- Limpeza: DELETE /config/admin ao final e reassert do shape base (evita vazar override para os arquivos seguintes, que compartilham o mesmo banco).

### 96. debug/trace: atlasId nao validado chega ao Postgres (cast uuid) e filtros opId/traceId de getTrace

- **Código:** `backend/src/modules/debug/debug.routes.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/debug-trace-authz.test.js`
- **Cobertura hoje:** nenhuma (backend/tests/unit/sync-trace.test.js cobre o ring em memoria, nunca a rota)

**O que o verde provaria.** liftAtlasIdToParams so checa presenca; nao ha Joi na borda (viola V2) e o valor vai direto para `WHERE id = $1` numa coluna uuid em requireAtlasPermission, virando erro de cast. Alem de 500 em vez de 4xx, o errorHandler fora de prod pode devolver o texto do erro do Postgres. E os filtros opId/traceId (getTrace com filter) nunca foram exercitados: se o filtro deixasse de aplicar, o collectLedger do Playwright passaria a juntar spans de outras operacoes e a correlacao ficaria errada em silencio.

**Casos:**

- GET /api/v1/debug/trace?atlasId=not-a-uuid com token valido -> status < 500 (esperado 400/404) e o corpo NAO contem 'invalid input syntax' nem 'uuid' vindos do Postgres.
- Com read no atlas A, seedar tres spans via recordSpan(A,'server.inserted',{opId:'op-1',traceId:'tr-1'}), (A,'server.applied',{opId:'op-2',traceId:'tr-2'}), (A,'server.broadcast',{opId:'op-1',traceId:'tr-1'}): GET ?atlasId=A&opId=op-1 -> spans.length === 2 e todos com opId 'op-1'; GET ?atlasId=A&traceId=tr-2 -> spans.length === 1 e stage === 'server.applied'.
- GET ?atlasId=<uuid de atlas existente sem nenhum span, com read> -> 200 com spans === [] (anel vazio nao e 404 nem 500).

### 97. `user_away` sem sinal terminador quando o mesmo usuario tem outro socket vivo (assimetria entre broadcastUserAway e a guarda P8 de removeConnection)

- **Código:** `backend/src/modules/collab/collab.gateway.js`
- **Tipo:** WebSocket · **Fatia:** `be-collab`
- **Cobertura hoje:** backend/tests/ws/collab-e2e.test.js e multiuser-session-e2e.test.js cobrem away/back/left apenas com UM socket por usuario; collab-shutdown-presence.test.js cobre P8 apenas com fechamento LIMPO (1000), nunca combinando duas abas com queda anormal.

**O que o verde provaria.** onClose difunde `user_away` INCONDICIONALMENTE (linha 520), mas removeConnection suprime `user_left` quando resta qualquer socket do mesmo userId na sala (guarda P8, linhas 486-489). Com duas abas: a aba A cai anormalmente -> peers recebem user_away(userId,clientIdA); passada a graca, removeConnection(A) encontra a aba B viva e NAO emite user_left; e user_back so sai em reconexao com o MESMO clientId. Resultado: o marcador `away` daquele userId fica pendurado nos peers para sempre, embora o usuario esteja online. E vazamento de estado de presenca que emerge de tres pontos (broadcast incondicional + guarda P8 + timer), invisivel lendo qualquer um deles sozinho. ATENCAO: o caso central provavelmente FALHA hoje - e repro de defeito suspeito, confirme antes de tratar como cobertura.

**Casos:**

- observador owner; usuario B abre DUAS conexoes com clientIds distintos; terminate() na primeira -> observador recebe user_away com clientId da primeira
- passada a janela de graca (setAwayGraceMs(500), esperar ~1s): o observador precisa ter recebido user_back OU user_left para AQUELE clientId - hoje nao recebe nenhum dos dois (invariante: todo user_away termina em back ou left)
- controle positivo, socket unico: terminate() e sem reconexao -> user_away seguido de user_left (ja coberto, mantido no mesmo arquivo como ancora do contraste)
- snapshot de um cliente que entra tarde, depois da graca: usersOnline nao pode listar B com status 'away' enquanto B tem socket aberto
- apos a graca, B ainda recebe broadcast normal (envie um cursor do owner e afirme que o socket vivo de B o recebe): a limpeza do socket away nao pode derrubar o vivo

### 98. Limite de frame `maxPayload: COLLAB_MAX_PAYLOAD_BYTES` (10 MB) no WebSocketServer

- **Código:** `backend/src/modules/collab/collab.gateway.js`
- **Tipo:** WebSocket · **Fatia:** `be-collab`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** Fronteira de recurso sem nenhum teste. O comentario L2 diz que o default do `ws` (100 MiB) permitia bufferizar em memoria um frame nao validado 10x maior que o limite HTTP; se o `maxPayload` sumir num refactor, nada acusa - o sintoma so aparece como memoria em producao. Um verde aqui prova que o corte acontece no TRANSPORTE, antes de JSON.parse e antes de qualquer handler, e que o limite legitimo continua passando (senao o teste vira um veto a lotes grandes validos).

**Casos:**

- enviar um frame de ~11 MB (string unica) -> o socket fecha com codigo 1009 (message too big), capturado por ws.on('close', code)
- nenhum frame `error` de VALIDATION_ERROR/OPERATION_FAILED chega antes do close (prova que o corte foi no transporte, nao no handler)
- nada persistido: 0 linhas novas em operations para o atlas apos o frame gigante
- controle positivo: um frame grande porem legitimo (lote valido de ~1 MB) e processado normalmente e recebe ack_batch (o limite nao pode estrangular uso real)
- o peer conectado no mesmo atlas segue vivo e responde ping/pong (a morte de um socket por payload nao contamina a sala)

### 99. Carimbo de `serverVersion` na op difundida: `opOut` em handleOperation e o mapa `versionByOp` em handleOperations

- **Código:** `backend/src/modules/collab/collab.handlers.js`
- **Tipo:** WebSocket · **Fatia:** `be-collab`
- **Cobertura hoje:** backend/tests/ws/collab-e2e.test.js e multiuser-session-e2e.test.js afirmam ack.serverVersion, nunca o carimbo na op difundida.

**O que o verde provaria.** E o invariante I3 (LWW por ordem de CHEGADA no servidor) exposto ao peer: sem esse carimbo o cliente remoto nao tem como ordenar o que recebeu ao vivo contra o que puxa por pull. Nenhum teste WS le `op.serverVersion` do frame difundido (grep so acha serverVersion no ack e em testes de sync HTTP). Pior, o lote tem um fallback silencioso: `versionByOp.get(op.id) ?? result.serverVersion`. `versionByOp` e montado com `r.operationId` (sync.service.js:773); se esse campo do contrato de ack mudar de nome, TODAS as ops do lote passam a carregar a mesma versao de lote e o fallback esconde o defeito - verde, e ordenacao errada no peer. O caso de duas ops com versoes DISTINTAS e crescentes e o que mata esse fallback.

**Casos:**

- A envia 1 op; o peer B recebe `operation` cujo op.serverVersion e um numero > 0 e IGUAL ao ack.result.currentVersion recebido por A
- A envia lote de 2 ops; B recebe `operations` com ops[0].serverVersion e ops[1].serverVersion DISTINTOS e estritamente crescentes (mata o fallback de versao unica de lote)
- esses dois valores batem com os currentVersion por op em ack_batch.results, casados por operationId
- reenvio idempotente da mesma op.id: o ack traz result.idempotent === true e a op difundida (se houver) carrega a versao ORIGINAL registrada, nao uma nova
- op de atlas (entityId sentinela) difundida ao peer carrega serverVersion numerico, nao null/undefined

### 100. Ciclo de vida da linha em `active_sessions`: createSession/deleteSession disparados sem await em onConnection e removeConnection

- **Código:** `backend/src/modules/collab/collab.service.js`
- **Tipo:** WebSocket · **Fatia:** `be-collab`
- **Cobertura hoje:** backend/tests/ws/collab-gaps.test.js ws-10 (so criacao e a ausencia para visitante publico).

**O que o verde provaria.** ws-10 (collab-gaps.test.js) so verifica a CRIACAO da linha e a ausencia dela para visitante publico. A REMOCAO nunca e afirmada: se deleteSession quebrasse (nome de coluna, chave composta errada), a suite inteira segue verde e o banco acumula sessao morta indefinidamente - nao ha reaper (grep de active_sessions em src/ so acha collab.service.js e a migracao). Ha ainda uma corrida real: createSession e deleteSession sao chamados sem await, entao um connect seguido de close rapido pode executar o DELETE antes do INSERT e deixar orfa uma linha que ninguem mais limpa. Um verde aqui provaria que o unico registro duravel do socket fecha o ciclo nos tres caminhos (limpo, away expirado, connect-close rapido).

**Casos:**

- conectar com clientId estavel, esperar `connected`, aguardar a linha aparecer (poll), fechar com ws.close(1000) -> em ate 1s, 0 linhas em active_sessions WHERE user_id/atlas_id/client_id
- setAwayGraceMs(500); terminate() (1006) -> a linha PERMANECE durante a janela de graca (a sessao esta suspensa, nao encerrada) e some depois de expirada a graca
- terminate() e reconexao com o MESMO clientId dentro da graca -> continua existindo EXATAMENTE 1 linha para (user, atlas, clientId) apos a reconexao (o ON CONFLICT DO UPDATE nao pode duplicar nem o cancelamento do timer pode apagar a sessao viva)
- corrida: fechar o socket no proprio handler de 'open' (sem esperar `connected`) -> apos 1s, 0 linhas para aquele clientId (hoje o DELETE pode correr antes do INSERT e deixar orfa)
- duas abas do mesmo usuario (clientIds distintos) -> 2 linhas; fechar uma -> resta exatamente 1

### 101. database/index.js initOptions.query loga `e.params` de toda query

- **Código:** `backend/src/database/index.js`
- **Tipo:** integração · **Fatia:** `be-database`
- **Cobertura hoje:** nenhuma (unit/redact-url.test.js cobre apenas a redacao da connection string, nao os params de query)

**O que o verde provaria.** O hook de log emite `params` de TODA query em nivel debug (index.js:8) e o pino nao tem `redact` nenhum (utils/logger.js:5-16). Entre esses params trafegam credenciais vivas: a api_key em `FIND_USER_BY_API_KEY` (flexible-auth.js:47) e o hash de refresh token em `FIND_REFRESH_TOKEN_ANY`. Basta um operador subir LOG_LEVEL=debug para diagnosticar um incidente e as chaves de API irem para o arquivo de log. Nenhum teste olha para o que esse hook emite (`redact-url.test.js` cobre so a connection string). Este item ja falha hoje: e achado, nao so lacuna de cobertura.

**Casos:**

- instalar um stream de captura no pino com level 'debug'; chamar `query('SELECT id FROM users WHERE api_key = $1', [apiKeyConhecida])` -> a linha emitida NAO pode conter o valor da chave
- idem para o INSERT de usuario (password_hash) e para a busca de refresh token (token_hash)
- assertar que a query em si continua logada (o valor de diagnostico e preservado; o que sai e o valor do parametro) -- senao o 'fix' vira apagar o log inteiro
- controle negativo: com a redaction desativada o teste falha (prova que o assert toca o caminho corrigido, e nao o silencio do logger em NODE_ENV=test, que hoje e `level:'silent'` e mascararia tudo)

### 102. _migrations versus os arquivos em disco (migracao aplicada renomeada ou removida)

- **Código:** `backend/src/database/migrate.js`
- **Tipo:** integração · **Fatia:** `be-database`
- **Cobertura hoje:** parcial: config-infra-gaps.test.js:264-278 (contagem de linhas estavel) e low-impact-fixes.test.js:239-265 (espera no advisory lock + assert vacuo `n > 0`)

**O que o verde provaria.** O runner casa arquivo com linha de `_migrations` por NOME (migrate.js:67). Renomear uma migracao ja aplicada faz o runner tratar como nova e re-executar o DDL (`CREATE TABLE sv360.projects` -> erro, deploy quebrado); remover um arquivo deixa a linha orfa sem ninguem notar. Os dois testes existentes so contam linhas, e o de low-impact-fixes.test.js:263-265 asserta `n > 0`, que nao distingue no-op de re-aplicacao -- verde que nao prova nada. Um assert de igualdade de CONJUNTOS (banco vs disco) prende os dois sentidos.

**Casos:**

- apos runMigrations: `SELECT name FROM _migrations` == conjunto exato dos `*.sql` de migrations/, comparado NOS DOIS SENTIDOS (nenhum arquivo por aplicar, nenhuma linha orfa), com guard `assert(nomes.length >= 5)`
- controle negativo no proprio teste: inserir um nome fantasma em `_migrations` dentro de transacao revertida -> a comparacao falha
- substituir a assercao `n > 0` de low-impact-fixes.test.js:264 pela igualdade antes/depois que config-infra-gaps.test.js:275 ja faz corretamente (hoje sao dois testes do mesmo fato, um deles vacuo)
- re-executar runMigrations duas vezes seguidas nao altera dado seeded pelas migracoes: `SELECT count(*) FROM ranks` continua 19 e `SELECT count(*) FROM basemaps` continua 5 (o INSERT de ranks em 001_core.sql:58 NAO tem ON CONFLICT e a tabela nao tem UNIQUE em code/nome -- se o tracking falhar, duplica em silencio e o dropdown de posto passa a mostrar 38 itens)

### 103. Higiene das migracoes: numeracao, forward-only aditivo, contencao do PostGIS fora do schema public

- **Código:** `backend/src/database/migrations/001_core.sql`
- **Tipo:** unitário · **Fatia:** `be-database`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** Tres invariantes do projeto (I12 numeracao/gen_random_uuid/aditividade e I4 'nunca adicione PostGIS ao schema do atlas') existem hoje so em prosa. Sao verificaveis por leitura dos .sql sem banco nenhum, custo quase zero. Se estivessem errados -- dois arquivos com prefixo 005, um `uuid_generate_v4()` numa PK, um `DROP COLUMN` numa migracao, um `GEOMETRY(...)` numa tabela do atlas -- nada no repo acusa: a migracao roda e o estrago aparece no deploy seguinte ou como decisao arquitetural revertida em silencio. Precisa de guard de lista nao-vazia e contagem do que foi checado, porque essa e exatamente a familia de varredura que ja passou verde vazia neste repo (C4).

**Casos:**

- guard: `files.length >= 5` e assert do numero de arquivos efetivamente inspecionados em cada regra
- todo arquivo casa `/^\d{3}_[a-z0-9_-]+\.sql$/`; os numeros sao unicos; `files.sort()` (a ordem que migrate.js:62 usa) e igual a ordem numerica -- pega tanto `005_outro.sql` duplicado quanto um futuro `10_x.sql` que sortearia antes de `002`
- nenhum arquivo contem `uuid_generate_v4` (I12) e toda PK UUID com DEFAULT usa `gen_random_uuid()`
- nenhum arquivo contem DDL destrutiva: `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `ALTER COLUMN ... TYPE` (forward-only aditivo), ignorando linhas de comentario `--`
- 001/002/003 nao contem `postgis`, `GEOMETRY(`, `GEOGRAPHY(`, `ST_` nem `CREATE SCHEMA` -> o dominio do atlas continua JSONB puro e o core segue migravel sem superusuario (afirmacao do cabecalho de 001_core.sql:5)
- 004/005 declaram `CREATE SCHEMA IF NOT EXISTS ng|sv360` e TODO `CREATE TABLE` deles e schema-qualificado (`ng.`/`sv360.`) -> nenhuma tabela PostGIS cai em public por descuido

### 104. Trigger trg_mark_slides_broken (soft-delete de mapa marca slides como quebrados)

- **Código:** `backend/src/database/migrations/002_atlas.sql`
- **Tipo:** integração · **Fatia:** `be-database`
- **Cobertura hoje:** nenhuma sobre o trigger; sync-briefing-ops.test.js:335 apenas escreve is_broken/broken_reason via op de sync

**O que o verde provaria.** Comportamento inteiro implementado em plpgsql, com ZERO teste: os unicos hits de `is_broken` em tests/ (sync-briefing-ops.test.js:335) sao uma op de sync setando o campo a mao, o que passaria identico se o trigger nao existisse. Se o trigger for perdido numa migracao futura ou sua guarda invertida, um briefing apresenta slide apontando para mapa inexistente e nada acusa. Ha tambem duas consequencias nao decididas que o teste deve fixar: o trigger incrementa `version` e escreve em slides FORA do pipeline de sync (nenhuma linha em `operations`, nenhum broadcast WS -- I16), e a operacao inversa nao existe (restaurar o mapa deixa o slide quebrado para sempre).

**Casos:**

- briefing com slide S (mode '2d', map_id=M) ; soft-delete de M via op de sync `delete map` -> S fica `is_broken=true`, `broken_reason='map_deleted'`, `version` incrementado em exatamente 1
- slide de outro mapa no mesmo briefing permanece `is_broken=false` (o WHERE map_id do trigger)
- slide ja soft-deletado (`deleted_at IS NOT NULL`) NAO e marcado (a guarda `AND deleted_at IS NULL`)
- UPDATE em maps que nao toca deleted_at (rename via op) nao marca slide nenhum (o trigger e `AFTER UPDATE OF deleted_at`); e um segundo delete do mesmo mapa nao re-incrementa version (guarda `OLD.deleted_at IS NULL`)
- apos o delete: `SELECT count(*) FROM operations WHERE entity_id = S` == 0 e `atlas.current_version` inalterado -> pinar que o peer conectado NAO recebe a mudanca (so a descobre em snapshot novo)
- restaurar o mapa (`deleted_at = NULL`) -> S permanece `is_broken=true` com `broken_reason='map_deleted'` (assimetria deliberada ou nao, fica pinada; muda-la passa a ser decisao explicita)

### 105. Escopo por atlas da unicidade de op_id (operations_atlas_op_id_uniq)

- **Código:** `backend/src/database/migrations/003_sync.sql`
- **Tipo:** integração · **Fatia:** `be-database`
- **Cobertura hoje:** parcial: sync-validation.test.js:109 e sync-service-coverage.test.js:71 cobrem idempotencia dentro de um unico atlas; sync-cross-atlas-access.test.js cobre IDOR, nao colisao de op_id

**O que o verde provaria.** O indice e UNIQUE (atlas_id, op_id) e o INSERT usa ON CONFLICT DO NOTHING. Todos os testes de idempotencia empurram para UM unico atlas (sync-validation.test.js:109, sync-service-coverage.test.js:71), entao continuariam VERDES se alguem estreitasse o indice para UNIQUE(op_id) -- e a consequencia seria perda de dado SILENCIOSA: a op do usuario B, colidindo com um op_id ja usado no atlas A, seria descartada pelo DO NOTHING e ainda receberia ack `idempotent:true`. E teste-que-nao-prende classico: o assert nunca toca a dimensao atlas_id.

**Casos:**

- criar atlas A e atlas B do mesmo dono; empurrar a MESMA `op.id` para os dois (criando feicoes distintas) -> `SELECT count(*) FROM operations WHERE op_id=$1` == 2, e as duas feicoes existem, cada uma no seu mapa
- o ack do push em B traz `idempotent:false` (nao pode ser tratado como reenvio)
- reenviar a op em A -> continua 1 linha em A e 1 em B (idempotencia continua valendo dentro do atlas)
- controle negativo do escopo: assertar que as duas linhas tem `atlas_id` diferentes e `op_id` igual

### 106. Paridade de shape das 5 tabelas de catalogo criadas por LIKE basemaps INCLUDING ALL

- **Código:** `backend/src/database/migrations/003_sync.sql`
- **Tipo:** integração · **Fatia:** `be-database`
- **Cobertura hoje:** parcial e enviesada: catalog.test.js exercita CRUD apenas do router basemaps; config.test.js e config-infra-gaps.test.js so LEEM as cinco via GET /api/config

**O que o verde provaria.** `data_layers`/`analysis_layers`/`tilesets`/`streetview_markers` sao clones estruturais de `basemaps` feitos uma unica vez por `LIKE ... INCLUDING ALL` (003_sync.sql:112-115), e `catalog.service.js` roda a MESMA string `COLS` e os mesmos INSERT/UPDATE contra as cinco (catalog.service.js:9,27,46). O inventario confirma que so o router de `basemaps` recebe request HTTP nos testes. Logo, uma migracao aditiva que adicione coluna a `basemaps` e esqueca as outras quatro (cenario provavel, porque o autor testa pelo unico router coberto) so falha em producao, e falha no endpoint de contrato congelado GET /api/config. Um teste de introspecao pega isso no `npm test`; nao existe NENHUM teste de introspecao no backend hoje (zero hits de information_schema/pg_indexes em tests/).

**Casos:**

- para as 5 tabelas de CATALOG_TABLES: ler information_schema.columns e assertar conjuntos identicos de (column_name, data_type, is_nullable, column_default) tomando basemaps como referencia -- com guard de varredura nao-vazia (`assert(tables.length === 5)` e `assert(colsDeBasemaps.length >= 8)`), senao a checagem passa verde comparando nada
- cada uma das 5 tem PRIMARY KEY na coluna `id` (via pg_constraint/table_constraints)
- cada nome em `COLS.split(',')` de catalog.service.js existe nas 5 tabelas (amarra a string hardcoded ao schema real)
- controle negativo dentro do teste: `ALTER TABLE basemaps ADD COLUMN _probe int` dentro de uma transacao revertida faz a comparacao falhar -- prova que o assert discrimina
- negativo de whitelist: `assertTable('users')` lanca (o nome de tabela e interpolado em SQL, catalog.tables.js:13)

### 107. images.controller.js:20, header `Cache-Control: private, max-age=31536000, immutable` no download

- **Código:** `backend/src/modules/images/images.controller.js`
- **Tipo:** integração · **Fatia:** `be-images`
- **Arquivo sugerido:** `backend/tests/integration/images-cache-headers.test.js`
- **Cobertura hoje:** backend/tests/integration/images-hardening.test.js:71-104 (ETag, 304, Range, attachment; cache-control so por /immutable/)

**O que o verde provaria.** A unica assercao existente e `assert.match(cache-control, /immutable/)`. O token que carrega a decisao de seguranca e `private`, nao `immutable`: a imagem e conteudo controlado por permissao servido com max-age de um ano; trocar `private` por `public` (ou remover a diretiva) autorizaria proxy compartilhado/CDN a guardar e reentregar a imagem de um atlas privado para quem nao tem share, e o regex atual continuaria casando. Alem disso o 304 condicional nunca teve seus headers verificados: o setHeader ocorre antes do sendFile, e uma refatoracao que movesse os headers para o callback do sendFile deixaria a resposta 304 sem Cache-Control/Content-Disposition sem quebrar nada hoje.

**Casos:**

- GET /images/:id (200) -> cache-control contem 'private' E 'immutable' E 'max-age=31536000', e NAO contem 'public'
- GET com If-None-Match do ETag -> 304 e o 304 tambem carrega 'private' no Cache-Control
- GET com If-None-Match do ETag por usuario SEM permissao -> 403 (o gate roda antes do cache condicional; um 304 aqui indicaria bypass por cache)
- content-disposition do 200 casa /^attachment/ e nao contem 'inline' (ja coberto em images-gaps para jpeg/webp; repetir so se o arquivo novo for o unico a cobrir o png)

### 108. images.service.js:47, `await unlink(file.path)` apos rejeicao por magic bytes (multer ja gravou o arquivo em disco antes da validacao)

- **Código:** `backend/src/modules/images/images.service.js`
- **Tipo:** integração · **Fatia:** `be-images`
- **Arquivo sugerido:** `backend/tests/integration/images-rejected-upload-cleanup.test.js`
- **Cobertura hoje:** backend/tests/integration/images-hardening.test.js:48-57 (afirma so o 400, nada sobre o arquivo em disco)

**O que o verde provaria.** No upload unitario o multer PERSISTE o arquivo em `config.images.dir/<atlasId>/<uuid>.<ext>` antes de qualquer checagem de conteudo; so depois o service detecta o mismatch e apaga. Se essa linha sumisse (ou o `.catch(() => {})` engolisse um erro real de path), todo upload rejeitado deixaria lixo permanente em disco sem linha correspondente no banco: disk-fill autenticado, invisivel para a API e para qualquer teste atual. Os testes de hardening so afirmam o status 400, o verde deles nao prova nada sobre o disco.

**Casos:**

- contar arquivos em <IMAGES_DIR>/<atlasId> antes; POST /images com '<html>' declarado image/png -> 400; contagem depois IGUAL a de antes
- mesmo padrao para o mismatch JPEG-declarado-PNG -> 400 e zero arquivos residuais
- invariante de consistencia: apos os dois 400, para cada arquivo restante no diretorio existe exatamente uma linha em images com storage_path apontando para ele (sem orfaos)
- controle positivo: um upload valido no mesmo diretorio aumenta a contagem em 1 (senao a assercao de 'contagem igual' passaria mesmo com o diretorio inexistente)

### 109. MAP_CHILD_TABLES (maps.service.js:9-16): o conjunto EXATO de tabelas que o merge move, e o que fica para tras

- **Código:** `backend/src/modules/maps/maps.service.js`
- **Tipo:** integração · **Fatia:** `be-maps-briefings`
- **Arquivo sugerido:** `backend/tests/integration/maps-merge-orphans.test.js`
- **Cobertura hoje:** backend/tests/integration/maps-briefings-gaps.test.js:57-90 (merge-01) cobre as 6 tabelas da whitelist, mas nao o conjunto exato nem comments/group_features/layer_id/slides.

**O que o verde provaria.** comments tem map_id NOT NULL REFERENCES maps(id) (002_atlas.sql:223) mais version e deleted_at, ou seja, e uma sub-entidade de mapa com a mesma forma das seis da whitelist, e esta FORA dela. Depois de um merge a feicao vai para o destino e o comentario espacial ancorado nela fica no mapa de origem: o pin some da vista de quem abre o destino. Ninguem decidiu isso por escrito nem por teste. Alem disso merge-01 assere a contagem de cada uma das 6 chaves mas nao que o conjunto seja exatamente aquele: acrescentar uma setima tabela (ou remover uma) passa verde hoje. Um assert sobre o conjunto de chaves de `moved` obriga a decisao a ser explicita no dia em que alguem mexer na lista.

**Casos:**

- feature em src + comentario raiz (comments com map_id=src, lng/lat) + uma resposta (parent_id); POST merge -> assertar o estado REAL de comments.map_id apos o merge (hoje = src) e nomear no titulo do teste se e comportamento desejado ou divida conhecida
- assert.deepEqual(Object.keys(res.body.data.moved).sort(), ['catalog_layers','cesium3d_data','features','groups','layers','streetview360_data']) -> prende o conjunto, nao so as contagens
- group_features (juncao sem map_id, 002_atlas.sql:205): grupo + feature no src, ambos movidos -> a linha de juncao continua valida e a feature continua no grupo depois do merge (hoje ninguem verifica que a associacao sobrevive)
- features.layer_id: feature apontando para uma layer do src -> depois do merge layer e feature estao ambas no dest e feature.layer_id ainda resolve para uma layer do MESMO mapa (nao vira referencia orfa cross-map)
- slides.map_id apontando para o src (002_atlas.sql:357, ON DELETE SET NULL): merge nao mexe em slides -> o slide continua apontando para o src, que ficou vazio; pinar o efeito no briefing

### 110. merge nao gera linha em `operations`: peer desatualizado desfaz o merge no push seguinte

- **Código:** `backend/src/modules/maps/maps.service.js`
- **Tipo:** integração · **Fatia:** `be-maps-briefings`
- **Arquivo sugerido:** `backend/tests/integration/maps-merge-sync-visibility.test.js`
- **Cobertura hoje:** nenhuma. maps-briefings-gaps.test.js merge-04 verifica version/updated_at na linha; nenhum teste liga merge a pull/operations. sync-feature-map-move.test.js cobre o move via sync, sem interacao com merge.

**O que o verde provaria.** pullChanges (sync.service.js:812) le de GET_OPERATIONS_SINCE_VERSION, e mergeMaps escreve direto nas tabelas de entidade sem gravar operacao e sem avancar atlas.current_version. Consequencia concreta e deterministica: um peer que estava desconectado durante o merge faz pull incremental, recebe ZERO operacoes, continua achando que a feature esta no src e, no primeiro push de update dessa feature (que carrega mapId), o LWW-por-chegada devolve a feature para o mapa de origem, desfazendo o merge sem nenhum erro em lugar nenhum. merge-04 (maps-briefings-gaps.test.js:154) prova que version e updated_at subiram, mas versao subida em linha de entidade nao alcanca ninguem: e exatamente um verde que nao prova o que parece provar.

**Casos:**

- owner cria feature F em src via POST /atlas/:id/sync (para existir op) e guarda currentVersion=V; POST merge src->dest; GET /atlas/:id/sync/V -> assertar operations.length === 0 e isSnapshot === false, isto e, o pull incremental nao carrega o merge (pino da limitacao)
- na sequencia, push do peer desatualizado: POST /atlas/:id/sync com feature update de F carregando mapId=src -> assertar o map_id final de F no Postgres. Se voltar a ser src, o merge foi desfeito e o teste nomeia a regressao; a autoridade consultada e o banco, nunca a concordancia entre clientes
- controle: GET /atlas/:id/sync/0 (ou since < min_version) devolve snapshot e ai sim F aparece no dest -> prova que so o caminho de snapshot converge, o incremental nao
- assertar que atlas.current_version nao mudou entre antes e depois do merge (a causa-raiz da ausencia de sinal incremental)

### 111. sourceMapIds com id repetido: mergeMaps nao deduplica antes de comparar os tamanhos

- **Código:** `backend/src/modules/maps/maps.service.js`
- **Tipo:** integração · **Fatia:** `be-maps-briefings`
- **Arquivo sugerido:** `backend/tests/integration/maps-merge.test.js`
- **Cobertura hoje:** nenhuma. maps-merge.test.js cobre id de outro atlas e 'not-a-uuid' (422 do Joi); repeticao de id valido nunca foi exercitada.

**O que o verde provaria.** maps.service.js:45-55 monta `sources` sem dedupe e depois compara valid.length !== sources.length, mas o SELECT ... WHERE id = ANY($1::uuid[]) devolve UMA linha por id distinto. Com {sourceMapIds:[src, src]} sao 2 sources contra 1 valido -> NotFoundError('Source map') 404, e o cliente recebe 'mapa de origem nao encontrado' para um mapa que existe e ao qual ele tem acesso. mergeMapsSchema (maps.schemas.js:4-6) nao tem .unique(). Um verde aqui prova que o servidor distingue 'id repetido' de 'id inexistente', que e a diferenca entre um bug de cliente diagnosticavel e um 404 mentiroso.

**Casos:**

- POST merge {sourceMapIds:[src.id, src.id]} -> hoje 404; assertar o status observado E que nenhuma feature de src se moveu (o 404 e antes de qualquer UPDATE, dentro da tx)
- contraste imediato no mesmo teste: {sourceMapIds:[src.id]} -> 200 com moved.features > 0, provando que o unico delta e a repeticao
- {sourceMapIds:[dest.id, src.id, src.id]}: o dest e filtrado em maps.service.js:45 e sobram 2 sources duplicados -> mesmo 404
- {sourceMapIds:[src1.id, src2.id, src1.id]} com src1 e src2 validos -> 3 sources contra 2 validos -> 404, isto e, uma repeticao envenena um lote inteiro que era legitimo

### 112. Ordem de registro em app.js, o catch-all 404 depois de TODOS os mounts e o errorHandler por ultimo

- **Código:** `backend/src/app.js`
- **Tipo:** integração · **Fatia:** `be-middleware`
- **Cobertura hoje:** parcial, tests/integration/health.test.js afirma o 404 de rota desconhecida; nenhum teste verifica que os prefixos montados sao alcancaveis.

**O que o verde provaria.** O 404 catch-all (app.js:122) e o errorHandler (app.js:127) fecham a cadeia. Montar um router novo depois deles (erro trivial num arquivo de 130 linhas com 16 mounts) faz o modulo inteiro responder 404 silenciosamente, sem erro de boot. Hoje dois prefixos ja montados nao recebem NENHUM request na suite (ranks, debug), entao ninguem notaria a diferenca entre 'montado' e 'inalcancavel'. O verde aqui prova que cada prefixo declarado esta antes do catch-all.

**Casos:**

- para cada prefixo montado (config, assets3d, auth, users, atlas, basemaps, data-layers, analysis-layers, tilesets, streetview-markers, nomes, organizations, ranks, audit, zones, sv360), um GET sem credencial NAO pode voltar 404 com message 'Route not found', 401/403/422/200 sao todos aceitaveis, o que importa e nao ser o catch-all
- guard anti-cobertura-vazia (C4): a lista precisa ter >= 16 prefixos e o teste reporta quantos checou; lista vazia ou menor falha o teste
- controle positivo: GET /api/v1/naoexiste -> 404 com code NOT_FOUND e message 'Route not found', provando que o assert acima sabe distinguir os dois 404
- o envelope de erro sai formatado pelo errorHandler mesmo no caminho do catch-all (error.code presente), o que so acontece se ele for o ultimo

### 113. flexibleAuth, precedencia de credencial: cookie invalido e x-api-key invalido SUPRIMEM um Bearer valido

- **Código:** `backend/src/middleware/flexible-auth.js`
- **Tipo:** integração · **Fatia:** `be-middleware`
- **Cobertura hoje:** parcial, auth.test.js:107-128 cobre cookie valido e cookie lixo isoladamente; identity.test.js:79 e auth-gaps auth-03 cobrem api-key invalida isolada. Nenhum teste combina duas credenciais no mesmo request, nem observa o efeito em rota sem `auth` estrito.

**O que o verde provaria.** Sao dois short-circuits sem fallback: o ramo do api key faz `return next()` incondicional (linha 53) mesmo quando a chave e lixo, e o ramo do token le `req.cookies?.token || extractBearerToken(req)` e, se o cookie falhar no verify, faz `return next()` sem tentar o header (linhas 56-64). Em rota estrita isso nao aparece, porque o `auth` rele o Bearer quando req.user esta vazio, e por isso a suite atual (que testa tudo em /auth/me) nao consegue ver a diferenca: e o padrao C3, o assert passaria com e sem a precedencia. Em rota so-flexibleAuth (/nomes/busca, /api/config, leituras sv360) o usuario e silenciosamente rebaixado a anonimo e perde acesso ao proprio dado privado.

**Casos:**

- Cookie 'token=lixo.jwt.valor' + Authorization Bearer valido de usuario com zona privada -> GET /api/v1/nomes/busca responde como ANONIMO (nome privado ausente)
- x-api-key: 'not-a-uuid' + Bearer valido -> mesmo resultado anonimo em /nomes/busca
- controle: so o Bearer (sem cookie, sem api-key) -> o nome privado aparece; e so o cookie valido -> tambem aparece
- contraste entre familias de rota: as MESMAS tres combinacoes em /api/v1/auth/me respondem 200, porque o `auth` estrito recupera o Bearer, o teste documenta que a divergencia e por rota, nao por credencial

### 114. nomesAccessLog, invariante de que se loga QUAIS filtros, nunca os valores

- **Código:** `backend/src/middleware/nomes-access-log.js`
- **Tipo:** unitário · **Fatia:** `be-middleware`
- **Cobertura hoje:** nenhuma, roda de fato em /nomes/{busca,feicoes,catalogo3d} durante os testes de nomes, mas nada assere sobre o conteudo do log.

**O que o verde provaria.** O comentario do arquivo declara uma decisao de seguranca explicita: num gazetteer militar, termo de busca e coordenada clicada sao sensiveis e nao podem cair no log operacional. Isso vive so como `queryKeys: Object.keys(req.query)`. Trocar por `query: req.query` (uma refatoracao que parece inofensiva) passa a despejar termo e coordenada em todo request de /busca, /feicoes e /catalogo3d, e nenhum teste da suite reage, nenhum sequer referencia nomesAccessLog.

**Casos:**

- req.query={q:'Quartel General Sul', lat:'-15.79', lon:'-47.88'} -> o objeto logado traz queryKeys=['q','lat','lon'] e o JSON.stringify dele NAO pode conter 'Quartel General Sul' nem '-15.79'
- req.query undefined -> queryKeys=[] (o `?? {}`) e nenhum throw; req.user ausente -> userId === null (nao undefined, o campo usa `?? null`)
- campos de auditoria presentes: category==='nomes_access', ip e path repassados sem alteracao
- next() chamado exatamente uma vez, sem argumento

### 115. requestLogger, redacao de credencial na URL e escolha de nivel

- **Código:** `backend/src/middleware/request-logger.js`
- **Tipo:** unitário · **Fatia:** `be-middleware`
- **Cobertura hoje:** nenhuma, src/utils/redact-url.js tem unit proprio, mas a ligacao dele com o requestLogger nao e afirmada em lugar nenhum e o middleware nao monta em teste.

**O que o verde provaria.** app.js:73 faz `if (!config.isTest) app.use(requestLogger)`: o middleware NUNCA entra na cadeia sob teste, entao a suite e estruturalmente cega para ele. E o unico lugar onde toda URL de producao e logada, incluindo `?api_key=<uuid>`, se o `redactUrl` for removido dali, a chave de API de todo usuario passa a vazar para os agregadores de log e a suite continua 100% verde. Um teste unitario com spy no objeto logger (mesma instancia ESM que o middleware importa) e o unico caminho alcancavel.

**Casos:**

- req.url='/api/v1/nomes/busca?q=rio&api_key=3f2a1b4c-0000-4000-8000-000000000000'; res como EventEmitter; emitir 'finish' com statusCode 200 -> o objeto logado tem url com api_key=REDACTED e o JSON.stringify do objeto NAO contem o uuid
- statusCode 200 -> logger.info com a mensagem 'request'; statusCode 404 e 500 -> logger.warn com 'request error' (o middleware nunca usa logger.error: o corte e >= 400)
- o listener e registrado em 'finish' e next() e chamado uma vez, sincronamente, ANTES do log (se alguem inverter para logar no next, o duration vira sempre ~0): assertar que nenhum log saiu ate o 'finish' ser emitido
- res que nunca emite 'finish' (conexao abortada) -> nenhum log e nenhum throw; req sem user -> userId undefined sem TypeError

### 116. nomesAccessLog: registra apenas as CHAVES da query, nunca os valores

- **Código:** `backend/src/middleware/nomes-access-log.js`
- **Tipo:** unitário · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** O comentario do arquivo declara o invariante (termo de busca e coordenadas de clique sao sensiveis num gazetteer militar e nao podem ir para logs que sao enviados a agregadores). O inventario confirma zero assercao sobre esse log: ele roda em /busca, /feicoes e /catalogo3d e ninguem o referencia em tests/. Trocar `queryKeys: Object.keys(req.query)` por `query: req.query` passaria verde e vazaria termo e coordenada para o pipeline de log. Um teste que captura o objeto passado ao logger prova exatamente o que o comentario promete (a assercao e sobre o argumento que o CODIGO monta, nao sobre o dublê).

**Casos:**

- req = { user:{id:'u1'}, ip:'1.2.3.4', path:'/busca', query:{ q:'Base Secreta', lat:-22.9, lon:-43.2 } } -> o objeto logado tem queryKeys deepEqual ['q','lat','lon'] e category 'nomes_access'
- JSON.stringify do payload logado NAO contem 'Base Secreta' nem '-22.9' nem '-43.2' (guarda de vazamento por qualquer campo novo que alguem acrescente)
- Requisicao anonima (sem req.user) -> userId === null e next() chamado exatamente uma vez
- req.query ausente (undefined) -> queryKeys === [] e o middleware nao lanca (o `?? {}` esta guardado)

### 117. parseRange: clamp de end >= size e rejeicao de Range malformado

- **Código:** `backend/src/modules/nomes/assets3d.controller.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** backend/tests/integration/assets3d.test.js, assets3d-sqlite.test.js e nomes-catalogo3d-gaps.test.js (assets3d-08): sufixo, aberto e 416 por start>=size

**O que o verde provaria.** Os testes cobrem bytes=0-9, bytes=-5, bytes=2- e bytes=999999- (416). Faltam justamente os dois ramos que mudam o corpo da resposta: o clamp `if (end === null || end >= size) end = size - 1` e a rejeicao pelo regex. Sem o clamp, `bytes=0-999999` responderia Content-Length maior que o corpo e o Cesium fica pendurado no tile; e nada prova que um Range sintaticamente invalido nao vira 206 com fatia errada. Os dois caminhos (SQLite e filesystem) tem copias independentes da mesma logica, entao a assercao precisa rodar nos dois.

**Casos:**

- Ativo de 30 bytes, Range 'bytes=0-999999' -> 206, Content-Range 'bytes 0-29/30', Content-Length 30, corpo == payload inteiro (FS e SQLite)
- Range 'bytes=0-0' -> 206, Content-Range 'bytes 0-0/30', Content-Length 1, corpo == primeiro byte
- Range 'bytes=20-10' (start>end) -> 416 com Content-Range '*/30'
- Range 'bytes=abc', 'bytes=-' e 'items=0-5' (unidade desconhecida) -> 416 com Content-Range '*/30' nos dois caminhos (pina o comportamento atual, que difere do RFC 7233 'ignore e responda 200')
- If-None-Match casando + header Range presente -> 304 sem corpo (o 304 vence o Range e ocorre ANTES da leitura do BLOB)

### 118. Contrato congelado de GET /nomes/busca: teto de 5 resultados (LIMIT 5)

- **Código:** `backend/src/modules/nomes/nomes.controller.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** backend/tests/integration/nomes.test.js e zones-coverage.test.js (zones-cov-03) - shape e caso vazio, nunca o teto

**O que o verde provaria.** I7 congela o shape de /nomes/busca e o proprio controller documenta 'bare array of up to 5 results'. O array-nu esta testado (nomes.test.js:90, zones-cov-03), o TETO nao: nenhum teste semeia mais de 5 nomes casaveis, entao trocar LIMIT 5 por LIMIT 50 passa verde e inunda o dropdown do frontend sem que o guarda de fronteira entre pacotes perceba. Um verde hoje prova 'e um array', nao 'e um array de no maximo 5'.

**Casos:**

- Semear 8 nomes com um token distintivo comum ('Bravo<TAG> 1'..'Bravo<TAG> 8'), refresh_busca, buscar q='Bravo<TAG>' -> res.body.length === 5 exatamente
- Os 5 retornados sao os de maior score (score monotonicamente nao-crescente ao longo do array: ORDER BY score DESC preservado na serializacao)
- O corpo continua um array nu (nao { data: [...] }) mesmo no caso cheio

### 119. Score de 7 criterios: decaimento por distancia (peso 0.20) e plumbing do parametro zoom ($4 -> decay_dist/zoom_factor)

- **Código:** `backend/src/modules/nomes/nomes.queries.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** backend/tests/integration/nomes.test.js (assere apenas que existe a chave 'score' e a posicao 0 num resultado de item unico)

**O que o verde provaria.** O ranking ponderado e a feature-titulo desta fatia e esta essencialmente sem amarra. nomes.test.js:83 se chama 'ranks the exact/closest match first' mas assere `res.body[0].nome === 'Rio de Janeiro'` para q='Rio de Janeiro': nenhum outro nome semeado passa o limiar similarity>0.25, entao a lista tem UM item e a posicao 0 e trivial. Se a expressao inteira de score fosse trocada por `d.sim`, ou se o controller parasse de repassar `zoom`, TODOS os testes atuais continuariam verdes. Um verde hoje prova 'o endpoint responde e desduplica', nao 'os pesos existem'.

**Casos:**

- Dois nomes com a MESMA string unica e mesmo tipo, um no ponto da consulta e outro ~3 graus de longitude a leste (~300 km); apos SELECT ng.refresh_busca() (clusters distintos, eps 0.045 deg, ambos sobrevivem ao DISTINCT ON) -> body[0] e o proximo, e score(proximo) > score(distante)
- Mesma consulta com zoom=18 vs sem zoom -> o GAP score(proximo)-score(distante) e MAIOR com zoom=18 (decay_dist cai de 50000m para ~195m); prova que $4 chega ao SQL. Sem o repasse de zoom os dois gaps seriam identicos
- zoom=18 neutraliza tipo_peso: dois nomes a mesma distancia, um 'Cidade' (peso 1.0) e um 'Cemiterio' (0.15), tem contribuicao de tipo igual (zoom_factor=1 -> 0.5 para ambos), diferente do que ocorre sem zoom
- Todo score retornado esta em [0,1] (soma dos pesos = 1.00) e e finito (Number.isFinite), inclusive para dist=0 e para termo de comprimento 1 vs nome longo (criterio de comprimento com GREATEST(...,1))

### 120. Insensibilidade a acento e caixa via ng.f_unaccent nos dois lados do similarity()

- **Código:** `backend/src/modules/nomes/nomes.queries.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** nenhuma (nomes.test.js so usa termos sem acento identicos ao seed)

**O que o verde provaria.** Todo termo pesquisado nos testes existentes e ASCII e identico ao nome semeado ('Rio de Janeiro', 'Morro Teste', 'Base Secreta', 'Praca Publica'). 'Sao Paulo' e 'Niteroi' sao semeados com acento mas NUNCA pesquisados. Se f_unaccent sumisse de um dos lados (ou o indice GIN fosse trocado por um sobre nome cru), a busca acentuada de um gazetteer brasileiro quebraria e nenhum teste acusaria. Um verde hoje nao prova nada sobre normalizacao.

**Casos:**

- Semear 'Sitio Acu<TAG>' com acentos ('Sítio Açu') e buscar q='Sitio Acu<TAG>' sem acento e em minusculas -> o nome aparece
- Buscar com os acentos corretos -> tambem aparece (round-trip nos dois sentidos)
- Criterio de match exato (peso 0.20) dispara para o termo sem acento: score do nome acentuado buscado sem acento > score de um vizinho apenas parcialmente similar semeado no mesmo ponto
- Limiar de similaridade: q com trigram baixo contra o nome semeado (ex.: 'Xyzabc' vs 'Sitio Acu<TAG>') -> array vazio, 200 (o corte >0.25 realmente corta)

### 121. DISTINCT ON (nome, tipo, cluster_id) ... ORDER BY ..., dist ASC - o representante do cluster e o MAIS PROXIMO

- **Código:** `backend/src/modules/nomes/nomes.queries.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** backend/tests/integration/nomes.test.js (conta 1 resultado, nunca compara coordenadas)

**O que o verde provaria.** nomes.test.js prova que dois 'Morro Teste' do mesmo cluster viram UMA linha (contagem), mas nao prova QUAL das duas. Se o `dist ASC` do ORDER BY do CTE dedup fosse perdido (ou virasse ordem arbitraria), o teste continuaria verde e o usuario receberia a coordenada do ponto ERRADO, mandando o mapa para o lugar errado a 1,5 km. Um verde hoje prova 'desduplicou', nao 'desduplicou escolhendo o certo'.

**Casos:**

- Dois pontos de mesmo nome/tipo a ~1,5 km (mesmo cluster apos refresh_busca); consultar com lat/lon colados no ponto A -> a linha retornada tem longitude/latitude do ponto A (tolerancia 1e-6)
- Repetir a MESMA consulta com lat/lon colados no ponto B -> agora a linha retornada tem as coordenadas de B (o representante muda com o ponto de consulta; prova que dist manda, nao a ordem fisica das linhas)
- Em ambos os casos continua sendo exatamente 1 linha para aquele nome

### 122. Predicado de acesso duplicado CATALOGO_SELECT vs CATALOGO_COUNT atravessando a fronteira de pagina

- **Código:** `backend/src/modules/nomes/nomes.queries.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** backend/tests/integration/catalogo3d-access.test.js (total===data.length numa pagina) e nomes-catalogo3d-gaps.test.js nomes-03 (paginacao so com linhas publicas)

**O que o verde provaria.** O proprio arquivo avisa em comentario que o predicado esta DUPLICADO VERBATIM e que editar so um faz a contagem divergir. A guarda atual e `assert.equal(res.body.total, res.body.data.length)` em catalogo3d-access.test.js:65, que so vale enquanto TODO o catalogo visivel couber numa pagina de 10 num banco de teste COMPARTILHADO entre arquivos: ela nao isola as proprias linhas e, por construcao, nao pode detectar divergencia quando total > nr_records (justamente o caso em que o total mentiria sobre a paginacao). Um teste com tag unica e totais explicitos amarra o predicado independentemente do que outros arquivos semeiam.

**Casos:**

- Semear com tag unica 3 modelos publicos + 2 privados; usuario SEM permissao, q=TAG, nr_records=2 -> total===3 nas paginas 1, 2 e 3 (nunca 5), e a uniao das paginas tem 3 ids distintos sem sobreposicao
- Admin, mesmo q/nr_records -> total===5 e a uniao das paginas tem os 5 ids
- Usuario que ganha model_permissions em 1 dos privados -> total sobe de 3 para 4 e o id aparece exatamente numa pagina
- Membro de grupo com model_group_permissions no outro privado -> total 4 pelo branch de grupo (SELECT e COUNT concordam nos DOIS branches)

### 123. Gate de autenticacao por rota: /nomes/feicoes e /nomes/catalogo3d sao auth-estrito, /nomes/busca e anonimo

- **Código:** `backend/src/modules/nomes/nomes.routes.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** nenhuma para 401; o 200 anonimo de /busca esta em nomes.test.js e nomes-access.test.js

**O que o verde provaria.** Nenhum teste do repo faz request sem token a /nomes/feicoes ou /nomes/catalogo3d (grep confirma: as unicas ocorrencias fora dos arquivos da fatia sao um comentario em config.test.js e uma string em redact-url.test.js). A assimetria e deliberada e fragil: um refactor de 'harmonizacao' que remova `auth` dessas duas rotas nao quebraria nada, porque o filtro de acesso embutido no SQL ($4/$5 null -> so publico) mantem os testes de conteudo verdes. Fica exposto anonimamente o catalogo 3D e o identify de edificacoes.

**Casos:**

- GET /api/v1/nomes/feicoes sem Authorization -> 401 com error.code UNAUTHORIZED (nao 200, nao 422 do Joi: a ordem [auth, log, validate] importa)
- GET /api/v1/nomes/catalogo3d sem Authorization -> 401 UNAUTHORIZED
- GET /api/v1/nomes/busca sem Authorization -> 200 (contrato congelado anonimo, no MESMO teste, para que a assimetria fique legivel e nao seja 'consertada')
- GET /nomes/feicoes com Bearer invalido/expirado -> 401 (nao cai silenciosamente para o caminho anonimo do flexibleAuth)

### 124. Bordas de catalogoSchema e o branch `q || null` do servico

- **Código:** `backend/src/modules/nomes/nomes.schemas.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** backend/tests/integration/nomes-catalogo3d-gaps.test.js nomes-03 (page=99 fora do fim, com q); bordas invalidas e q='' nao cobertos

**O que o verde provaria.** O offset e calculado em JS (`(page-1)*nr_records`) e vai cru para o SQL: sem o `min(1)` do Joi, page=0 gera OFFSET negativo e o Postgres devolve erro -> 500 num endpoint autenticado. E `const qv = q || null` (nomes.service.js:18) e o que faz q='' significar 'sem filtro'; trocado por `q ?? null`, a string vazia iria para plainto_tsquery e o catalogo voltaria VAZIO para o cliente que manda `?q=` (caso comum de campo de busca limpo). Nenhum dos dois tem teste. Um verde hoje nao prova nada sobre as bordas de paginacao.

**Casos:**

- page=0 -> 422 VALIDATION_ERROR com details apontando 'page' (nunca 500 de OFFSET negativo)
- page=-1 e page='abc' -> 422
- nr_records=0 -> 422; nr_records=101 -> 422; nr_records=100 -> 200 (limite inclusivo)
- q='' -> 200 e MESMO total que a requisicao sem o parametro q (branch `q || null`), com data nao vazia
- Sem q, duas paginas consecutivas nao se sobrepoem (ORDER BY rank DESC, data_criacao DESC e estavel quando rank=0 para todas as linhas)

### 125. setZonePermissions: DELETE incondicional das duas tabelas + default([]) do Joi (revogacao)

- **Código:** `backend/src/modules/zones/zones.service.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** backend/tests/integration/zones-gaps.test.js (zones-01 rollback, zones-05 encolher/limpar a MESMA chave, zones-11 audit diff)

**O que o verde provaria.** O service apaga SEMPRE users e groups e so re-insere `if (users.length)` / `if (groups.length)`, e o schema preenche default([]) para a chave ausente. Logo `PUT {groups:[g]}` (sem a chave users) APAGA todos os grants de usuario da zona. zones-05 cobre encolher a lista de users e `users:[]`, e zones-01 cobre preservacao apos ROLLBACK, mas ninguem pina o cruzamento entre as duas chaves. Isso e semantica de revogacao: se alguem 'consertar' tornando o DELETE condicional (`if (users.length) delete`), a revogacao por lista vazia para de funcionar em silencio e um usuario removido continua vendo dado privado - sem nenhum teste falhando.

**Casos:**

- PUT {users:[u], groups:[g]} -> GET permissions retorna ambos; em seguida PUT {groups:[g]} (sem a chave users) -> GET retorna users:[] (contrato atual: replace total nas DUAS chaves)
- Efeito end-to-end da revogacao: o usuario u, que via o nome privado da zona, deixa de ve-lo em /nomes/busca apos esse PUT parcial (mesmo token)
- Simetrico: PUT {users:[u]} sem a chave groups -> groups:[] e o membro do grupo perde a visibilidade do nome privado
- O audit PERMISSION_GRANT registra details.before com o conjunto que foi apagado implicitamente (before.users=[u], after.users=[]), para que a revogacao silenciosa seja ao menos rastreavel

### 126. Payload anonimo de GET /atlas/public/:link (SELECT a.* sem allowlist)

- **Código:** `backend/src/modules/atlas/atlas.queries.js`
- **Tipo:** integração · **Fatia:** `be-sharing`
- **Cobertura hoje:** backend/tests/integration/atlas-advanced.test.js:212-265 (afirma presenca de id/name/publicToken e as claims do token; nunca o conjunto de campos)

**O que o verde provaria.** FIND_ATLAS_BY_PUBLIC_LINK e `SELECT a.*` mais duas colunas do dono: a superficie exposta a um chamador NAO AUTENTICADO passa a ser definida pela tabela, nao pelo codigo. Hoje e inofensiva, mas qualquer ALTER TABLE atlas ADD COLUMN futuro (nota interna, chave, id externo) vaza para o anonimo sem que nada acuse. Os testes atuais so afirmam que id/name/publicToken existem, ou seja, so verificam presenca, nunca ausencia. Um verde com conjunto de chaves fechado prova que a fronteira de vazamento e explicita.

**Casos:**

- GET /atlas/public/:link sem Authorization -> 200; assert.deepEqual(Object.keys(res.body.data).sort(), <allowlist explicita>), falha ao surgir coluna nova, forcando decisao consciente
- Assertar presenca de `settings` (o modo visitante do frontend depende dele) e de owner_nome/owner_username
- Assertar que nenhuma chave casa /token|secret|key|password|hash/i exceto exatamente `publicToken`
- Guard de lista nao-vazia: assertar Object.keys(...).length > 5 antes do deepEqual, para o teste nao passar verde sobre um payload vazio
- GET /atlas/public/:link de um atlas soft-deleted com public_link ainda preenchido -> 404 (a query filtra deleted_at; hoje so o caso is_public=false esta coberto)

### 127. Token de visitante na superficie de manage e contra atlas PRIVADO de terceiro

- **Código:** `backend/src/modules/atlas/atlas.service.js`
- **Tipo:** integração · **Fatia:** `be-sharing`
- **Cobertura hoje:** backend/tests/integration/cross-cutting-gaps.test.js:68 (revogacao no pull), backend/tests/integration/sync-gaps.test.js:365 (push 403), backend/tests/integration/maps-briefings-gaps.test.js:285 (cruzamento publico->publico)

**O que o verde provaria.** Sobre HTTP nada liga o token ao seu atlas: o gateway WS checa `payload.atlasId !== atlasId` (collab.gateway.js:55), o caminho REST nao, a seguranca vem so de reler is_public/shares em requireAtlasPermission. O push e o pull ja estao cobertos (sync-gaps sync-09, cross-cutting-gaps), e o cruzamento publico->publico esta caracterizado (maps-briefings-gaps maps-02b), mas o caso que vaza de verdade (publico->PRIVADO) e a superficie de manage nunca foram tocados. Um verde prova que as claims `permission:'read'` e `atlasId` do token nunca sao tratadas como autoridade no REST.

**Casos:**

- publicToken do atlas A (publico) em GET /atlas/<B privado> -> 403, e o corpo nao traz `data`
- publicToken do atlas A em GET /atlas/<B privado>/sync/0 -> 403
- publicToken do proprio atlas em GET /atlas/:id/sharing -> 403 (read < manage)
- publicToken do proprio atlas em POST /atlas/:id/sharing/public e DELETE /atlas/:id/sharing/public -> 403 (visitante nao republica nem despublica)
- publicToken empurrando uma op target:'comment' em POST /atlas/:id/sync -> 403 e zero linhas em comments (o gate da rota e 'comment' e read < comment: visitante nao comenta)

### 128. O owner nao e removivel nem rebaixavel pela API de sharing (garantia que sustenta o tier 'manage')

- **Código:** `backend/src/modules/sharing/sharing.routes.js`
- **Tipo:** integração · **Fatia:** `be-sharing`
- **Cobertura hoje:** backend/tests/integration/sharing-gaps.test.js share-10 (owner compartilhando consigo mesmo), backend/tests/integration/atlas-config-authz.test.js (manage nao deleta o atlas)

**O que o verde provaria.** O comentario em sharing.routes.js:11-14 justifica dar sharing ao co-Gestor afirmando que 'o owner nao tem linha em atlas_shares, entao removeUserShare e no-op nele'. Isso e prosa: nenhum teste prende. Se um dia o owner passar a ter linha de share (conveniencia de UI, ON CONFLICT que insere o dono, ou o proprio transfer deixando residuo), um co-Gestor ganha o poder de trancar o dono para fora do proprio atlas, e toda a suite atual segue verde. Um verde aqui prova que a autoridade vem de atlas.owner_id, nao da tabela de shares.

**Casos:**

- manager (share 'manage') DELETE /sharing/users/<owner.id> -> 404; em seguida owner GET /sharing -> 200 e PUT /atlas -> 200 (acesso intacto)
- manager PUT /sharing/users/<owner.id> {permission:'read'} -> 404 (nao ha linha para atualizar)
- manager POST /sharing/users {userId: owner.id, permission:'read'} -> 201 (comportamento atual: cria linha redundante) MAS owner continua com poder de owner: DELETE /atlas/:id pelo owner -> 204 (seria 403 se o share 'read' governasse)
- manager DELETE /sharing/users/<outro manager.id> -> 204 e o co-Gestor removido perde GET /sharing (403), pina a decisao de que co-Gestores sao mutuamente removiveis
- manager POST /sharing/users {permission:'manage'} para um terceiro -> 201 (o teto do que um manager pode conceder e 'manage', nunca 'owner': ja coberto pelo 422, aqui o lado positivo)

### 129. Bloco `owner` de GET /atlas/:id/sharing e sua consistencia apos transferencia de posse

- **Código:** `backend/src/modules/sharing/sharing.service.js`
- **Tipo:** integração · **Fatia:** `be-sharing`
- **Cobertura hoje:** backend/tests/integration/sharing-gaps.test.js share-06 (isPublic/publicLink/chaves de cada share; nunca o bloco owner), backend/tests/integration/atlas-transfer-ownership.test.js (olha atlas_shares no banco, nunca a resposta de /sharing)

**O que o verde provaria.** O share-06 fecha as chaves de cada item de `shares` mas nunca toca `data.owner`, que o modal de compartilhamento do frontend renderiza como a linha do dono. Se o servico voltasse a expor owner_id/owner_username crus (snake_case) ou perdesse o bloco, nada falharia. E a transferencia de posse muta exatamente esses dois campos ao mesmo tempo (novo owner_id + ex-dono virando share 'manage'): nenhum teste olha o resultado pela lente do sharing.

**Casos:**

- GET /sharing -> assert.deepEqual(Object.keys(data.owner).sort(), ['nome','userId','username']) e os valores batendo com o dono; assertar que 'owner_id'/'owner_username' NAO existem no envelope
- Apos POST /atlas/:id/transfer para um membro: GET /sharing reporta data.owner.userId === novo dono E o ex-dono aparece em shares com permission 'manage'
- Atlas com 25 shares: data.shares.length === 25 (a query nao tem LIMIT; pina que a lista nao e truncada em silencio quando o atlas cresce)
- Um share cujo usuario foi desativado continua listado (ja coberto em share-07) mas com nome/username preenchidos, nao null, o JOIN e sobre users sem filtro

### 130. GET /photos/:uuid/image quando o blob nao existe no {slug}.db, 404 e liberacao do semaforo

- **Código:** `backend/src/modules/streetview360/sv360.controller.js`
- **Tipo:** integração · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/integration/sv360-missing-blob.test.js`
- **Cobertura hoje:** nenhuma (sv360-image-drift.test.js cobre blob PRESENTE com tamanho divergente, nunca blob/arquivo ausente)

**O que o verde provaria.** E o estado de drift residual que o proprio codigo admite (janela de crash entre PASSO 1 e o commit, sv360.ingest.js:348-355) e o efeito de qualquer remocao manual do arquivo: Postgres conhece a foto, o blobstore devolve null. O ramo `if (!buf) { release(); next(NotFoundError) }` (sv360.controller.js:170-173) nunca e exercitado. Se o release() sumir dali, o semaforo (maxInflight=8) esgota e o processo para de servir QUALQUER imagem, silenciosamente, sem erro nos testes atuais. Um verde prova que uma foto sem blob nao derruba a rota inteira.

**Casos:**

- Projeto enabled com foto cujo db_filename aponta para um arquivo INEXISTENTE em SV360_DB_DIR -> GET /photos/:uuid/image = 404 + flat { error }
- Projeto cujo {slug}.db existe mas SEM a linha do photo_id -> 404 (o outro caminho para buf null)
- Repetir o request 404 config.sv360.maxInflight + 2 vezes em sequencia; a ultima ainda responde 404 dentro do timeout (semaforo vazado travaria a partir da 9a)
- Logo apos as N falhas, GET da imagem de uma foto VALIDA -> 200 com os bytes corretos (prova que ha permits sobrando)
- O 404 por blob ausente nao deve emitir Content-Length de body vazio com 200 (assertar status estritamente 404)

### 131. validateImagesDb, ramos de rejeicao do PASSO 0 (linha faltando, tabela ausente, arquivo nao-SQLite)

- **Código:** `backend/src/modules/streetview360/sv360.ingest.js`
- **Tipo:** unitário · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/unit/sv360-validate-images-db.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-ingest.test.js:425 (apenas 'blob size mismatch -> 4xx'); nenhum teste importa sv360.ingest.js direto

**O que o verde provaria.** Este e o unico guard que impede o drift ingest->serve: se ele deixar passar um bundle cujo images.db nao tem a linha de uma foto, o Postgres anuncia a foto e o serve devolve 404 (ou pior, um blob de tamanho diferente do ETag). So o ramo de size-mismatch tem teste. O ramo 'nao e SQLite' e o mais suspeito: `new Database(..., {readonly:true})` pode nao ler o header no construtor, e o SqliteError caindo no prepare() escapa como 500 em vez do 400 pretendido. Um verde aqui prova que todo bundle aceito e servivel; hoje um dos ramos pode nem ser 4xx. Nao precisa de Postgres (so better-sqlite3 + arquivos tmp).

**Casos:**

- images.db com a tabela images mas SEM linha para um id de manifest.photos -> BadRequestError com 'missing a row for photo <id>'
- arquivo SQLite valido sem a tabela `images` -> BadRequestError 'has no `images` table'
- arquivo de bytes aleatorios (nao-SQLite) -> assertar que o erro e instanceof AppError com statusCode 400, NAO um SqliteError cru (que viraria 500 no sv360ErrorHandler)
- caminho inexistente -> BadRequestError 'images.db is missing'
- preview_webp NULL na linha (length NULL) contra preview_size_bytes 0 no manifest -> assertar o comportamento real (Number(null)===0 hoje passa; pinar ou corrigir)
- feliz: sizes batendo em todas as fotos -> nao lanca

### 132. DEFAULT_ORG_ID hardcoded vs a org semeada pela migracao (upload de admin global sem orgSlug)

- **Código:** `backend/src/modules/streetview360/sv360.merge.js`
- **Tipo:** integração · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/integration/sv360-default-org.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-gaps.test.js:513 (sv360-11 cobre orgSlug DESCONHECIDO -> 409 e cross-org -> 403; nunca o ramo default/legacy)

**O que o verde provaria.** sv360.merge.js:27 duplica o literal '00000000-...-0001' que so existe em 001_core.sql:27. Se a semente mudar, resolveOrgIdBySlug devolve um uuid inexistente e o UPSERT_PROJECT quebra por FK com 500 opaco - e nenhum teste hoje passa por esse ramo (os uploads de admin global testados sempre trazem orgSlug conhecido ou desconhecido). Um verde prova que a constante e a migracao ainda concordam, sem re-afirmar a constante contra ela mesma (a assercao e contra o SELECT da tabela).

**Casos:**

- admin global faz upload de manifest SEM project.orgSlug -> 201; SELECT organization_id FROM sv360.projects WHERE slug=$1 igual a (SELECT id FROM public.organizations WHERE slug='default')
- o db_filename persistido comeca com esse mesmo organization_id + '__' (prova que a derivacao e o merge usaram a mesma org)
- orgSlug: 'org-legacy' e orgSlug: '' (marcadores legados) resolvem para a MESMA org default
- o arquivo {orgId}__{slug}.db existe em SV360_DB_DIR com o prefixo dessa org

### 133. requireUploadCapability (FIX-4: rejeitar 403 ANTES do multer gravar ate SV360_MAX_UPLOAD_BYTES em disco)

- **Código:** `backend/src/modules/streetview360/sv360.routes.js`
- **Tipo:** integração · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/integration/sv360-upload-precheck.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-ingest.test.js:900 ('same-org viewer upload -> 403', que nao distingue o pre-filtro do service)

**O que o verde provaria.** O teste existente 'same-org viewer upload -> 403' passa COM e SEM o pre-filtro: removendo requireUploadCapability, o multer grava tudo e o service lanca ForbiddenError do mesmo jeito, resultando no mesmo 403. E teste-que-nao-prende (C3) sobre uma correcao de DoS. Discriminador comportamental: com o pre-filtro o request morre antes do multer, entao um campo multipart inesperado nao chega a virar MulterError. Um verde passa a provar a ORDEM da cadeia, nao so o status final.

**Casos:**

- viewer da mesma org POST /admin/projects/upload com manifest + imagesDb + um 3o campo 'bogus' -> 403 flat { error }. (Sem o pre-filtro o multer aborta antes com LIMIT_UNEXPECTED_FILE -> 500, como ja documentado em sv360-gaps sv360-01: e o discriminador)
- usuario autenticado SEM organization_id (token legado, org_role degradado a viewer) POST upload -> 403 pelo mesmo caminho
- editor da propria org com bundle valido -> 201 (o pre-filtro nao pode barrar quem o service autoriza)
- admin global com org_role 'viewer' e bundle valido -> 201 (role global vence o org_role no pre-filtro, igual a canWriteProject)
- Guard anti-divergencia: para cada org_role aceito por canWriteProject ('owner','admin','editor') o upload NAO retorna 403 - se as duas listas fechadas divergirem (padrao C1), o papel novo some em silencio no pre-filtro

### 134. updateCalibration em foto TOMBSTONADA: a transacao (L8) precisa desfazer o UPDATE antes do 404

- **Código:** `backend/src/modules/streetview360/sv360.write.service.js`
- **Tipo:** integração · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/integration/sv360-calibration-tombstone.repro.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-write.test.js:456 (cobre soft-delete + re-delete idempotente e 404 de leitura/imagem, nunca calibracao pos-tombstone)

**O que o verde provaria.** O comentario em sv360.write.service.js:117-131 descreve um bug real ja corrigido (GET_PHOTO_FOR_WRITE mantem tombstonados, GET_PHOTO_BY_ID nao, entao a calibracao persistia e SO DEPOIS o 404 era lancado - escrita que o chamador foi informado que nao aconteceu). Nao existe teste de regressao: revertendo o wrapper tx() a suite inteira segue verde. O 404 sozinho nao prova nada; o que prende e o valor da coluna.

**Casos:**

- Soft-delete da foto X (204). PUT /photos/X/calibration { heading: 123 } com owner -> 404; SELECT heading FROM sv360.photos WHERE id=X permanece o valor pre-delete (nao 123)
- Mesmo cenario pela rota granular PUT /photos/X/height { height: 9.9 } -> 404 e camera_height inalterado (as granulares reentram no mesmo service)
- Controle positivo: a mesma PUT numa foto VIVA -> 200 e o valor persistido
- Controle negativo registrado: com o tx() removido do updateCalibration o primeiro caso passa a falhar (heading vira 123)

### 135. cleanupOperations: coercao de keepFromVersion no controller (sync.controller.js:65) e ramo keepDays do servico (sync.service.js:841-862)

- **Código:** `backend/src/modules/sync/sync.controller.js`
- **Tipo:** integração · **Fatia:** `be-sync`
- **Arquivo sugerido:** `backend/tests/integration/sync-cleanup-boundaries.test.js`
- **Cobertura hoje:** backend/tests/integration/sync-gaps.test.js:293-361 (ramo keepFromVersion, e o caso keepFromVersion=0 passa pelo motivo errado) + sync.test.js:468-497 (keepDays happy path que nao deleta nada)

**O que o verde provaria.** O Joi aceita `keepFromVersion: 0` (min(0)), mas o controller usa `keepFromVersion ? parseInt(...) : undefined`, o zero cai como falsy, vira undefined e o servico executa uma limpeza por keepDays=7 (default do Joi). O admin que pede 'preserve tudo a partir da versao 0' dispara na verdade um expurgo de 7 dias e PERDE operacoes antigas. O teste que parece cobrir isso (sync-gaps.test.js:334-361) passa por outro motivo: seu comentario afirma o early-return `deleteBeforeVersion <= 0`, inalcancavel por HTTP, e o atlas do teste so tem ops recentes, entao o ramo keepDays coincidentemente nao apaga nada. Alem disso o ramo keepDays nunca foi provado APAGANDO: sync.test.js:468 limpa com keepDays:7 sobre ops recem-criadas, deletando zero.

**Casos:**

- semear operations com created_at = NOW() - INTERVAL '30 days' + uma op recente; POST /admin/cleanup {keepDays: 7} -> deletedCount === 1, a op antiga sumiu, a recente permaneceu e min_version subiu para o server_version da recente
- mesmo cenario, POST /admin/cleanup {keepFromVersion: 0} -> deletedCount === 0 e a op de 30 dias AINDA existe (hoje falha: o zero vira undefined e o expurgo de 7 dias roda)
- atlas sem nenhuma operacao; POST /admin/cleanup {keepDays: 7} -> 200 com {deletedCount: 0, newMinVersion: 0} e atlas.min_version inalterado (early-return de min_keep_version null, service:852)
- apos o expurgo por keepDays, GET /sync/<versao_expurgada> -> isSnapshot === true (fecha o ciclo cleanup -> min_version -> snapshot pelo ramo keepDays, hoje testado so pelo ramo keepFromVersion)
- corrigir o comentario enganoso de sync-gaps.test.js:351, que atribui o resultado a um early-return que a rota nunca alcanca

### 136. Joi: timestamp e clientId obrigatorios no envelope de operacao (sync.schemas.js:24-38), fix L1

- **Código:** `backend/src/modules/sync/sync.schemas.js`
- **Tipo:** integração · **Fatia:** `be-sync`
- **Arquivo sugerido:** `backend/tests/integration/sync-validation.test.js`
- **Cobertura hoje:** backend/tests/integration/sync-validation.test.js:36-67 (cobre operations ausente/vazio, MAX+1 e op sem id; nao cobre timestamp/clientId)

**O que o verde provaria.** O comentario do schema registra o motivo do aperto: sem `.required()` a op ia ate o INSERT e a coluna NOT NULL derrubava o push como 500 em vez de 422 limpo. sync-validation.test.js cobre corpo sem operations, array vazio, MAX+1 e op sem `id`, mas nenhum caso sem timestamp ou sem clientId, afrouxar qualquer um dos dois de volta para opcional nao quebra nada e o sintoma volta a ser 500 (erro do servidor) num payload que e culpa do cliente.

**Casos:**

- push de op sem `timestamp` -> 422 com error.code VALIDATION_ERROR (nao 500)
- push de op sem `clientId` -> 422 VALIDATION_ERROR
- batch [op valida, op sem clientId] -> 422 e ZERO linhas em operations para o op_id da op valida (a validacao e de borda, roda antes da transacao)
- push com `lamportTimestamp` ausente -> 200 e operations.lamport_timestamp NULL (prende que ESTE segue opcional, delimitando o aperto anterior)
- push com `traceId` presente -> 200 e o traceId sobrevive a validacao (stripUnknown nao o remove)

### 137. updateOrganization / updateRank, sigla e nome_abrev nao podem ser limpos (COALESCE vs flag de 'provided')

- **Código:** `backend/src/modules/organizations/organizations.queries.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/organizations-coverage.test.js`
- **Cobertura hoje:** organizations-coverage.test.js:104-131 cobre 422 de is_active e de nome longo; organizations.test.js:81-86 cobre PUT {sigla:'EDIT'} -> 200. Nenhum teste tenta LIMPAR um campo.

**O que o verde provaria.** Os schemas anunciam a capacidade (`sigla: Joi.string().allow(null, '')`, `nome_abrev: ... .allow(null, '')`) que o SQL nao implementa: UPDATE_ORGANIZATION usa COALESCE($3, sigla), entao PUT {sigla:null} responde 200 e nao muda nada, o botao 'limpar' do painel admin e um no-op silencioso. Users resolveu isso com a flag de 'provided' (users.queries.js:23-24,121-122) e org/ranks nao seguiram. Nada notou.

**Casos:**

- org com sigla='COV' -> PUT /organizations/:id {sigla: null} -> 200 e SELECT sigla no banco AINDA devolve 'COV' (o null foi engolido pelo COALESCE)
- PUT /organizations/:id {sigla: ''} -> 200 e sigla vira string vazia, nao NULL, duas representacoes distintas de 'sem sigla' convivendo
- o mesmo par para PUT /ranks/:id {nome_abrev: null} e {nome_abrev: ''}
- controle de contraste no mesmo arquivo: PUT /users/:id {rank_id: null} LIMPA de verdade (padrao ja provado em org-identity-gaps.test.js:250-274), e o padrao documentado que os outros dois modulos nao seguem
- efeito no contrato: apos PUT {sigla:''}, GET /api/config anonimo devolve organizacoesMilitares[].sigla === '' (nao null), que e o que o dropdown renderiza

### 138. Reativacao de organizacao (PUT /organizations/:id {is_active:true}) e o retorno dos membros

- **Código:** `backend/src/modules/organizations/organizations.service.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/organizations-coverage.test.js`
- **Cobertura hoje:** organizations.test.js:107-146 cobre so a direcao de desativacao (token em voo 403, login 403, refresh 403)

**O que o verde provaria.** Nao ha rota de reativacao; ela existe apenas como efeito colateral do UPDATE generico. Se a desativacao de OM virasse um deleted_at/tombstone (o padrao de soft-delete do resto do sistema), a reativacao pararia de funcionar e o tenant ficaria irrecuperavel sem nenhum teste vermelho. Tambem falta o lado WS: collab.gateway.js:132 fecha o socket com 4003 na org inativa, e nada testa que o membro consegue reconectar depois.

**Casos:**

- criar org -> membro loga (200) -> DELETE /organizations/:id -> login do membro 403 (ja coberto) -> PUT /organizations/:id {is_active:true} -> 200 -> login do membro volta a 200 e GET /auth/me com token novo -> 200
- o refreshToken emitido ANTES da desativacao volta a ser aceito apos a reativacao (nada o revogou), pinar, porque e a mesma classe de ressurreicao de sessao do item de PUT/DELETE de usuario
- GET /api/config anonimo volta a listar a OM em organizacoesMilitares depois da reativacao
- org reativada aparece em GET /organizations com is_active:true

### 139. Projecao de campos de SEARCH_USERS e FIND_USER_BY_ID (o que a API expoe de outro usuario)

- **Código:** `backend/src/modules/users/users.queries.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/users-coverage.test.js`
- **Cobertura hoje:** parcial: users-admin.test.js:87-88 afirma !password/!password_hash apenas no POST /users; a busca (users-admin.test.js:485-505, org-identity-gaps.test.js:331-361) so afirma presenca de username/nome e o LIMIT 20

**O que o verde provaria.** Nenhum teste fixa o conjunto de chaves devolvido por /users/search. Trocar o SELECT explicito por `SELECT u.*` (refactor plausivel, o LEFT JOIN ja esta la) passaria password_hash, api_key, email e is_active para qualquer usuario autenticado, e toda a suite ficaria verde. A busca e alcancavel por qualquer conta, nao so admin.

**Casos:**

- GET /users/search?q=<tag unica> como usuario comum -> guard assert.ok(rows.length >= 1) e entao, para CADA linha, deepEqual(Object.keys(row).sort(), ['id','nome','organizacao_militar','organization_id','posto_graduacao','rank_id','username'])
- assercao explicita de ausencia: nenhuma linha tem password_hash, api_key, email, is_active ou role
- GET /users/me -> key-set exato ['created_at','id','last_login_at','nome','organizacao_militar','organization_id','posto_graduacao','rank_id','username'] (FIND_USER_BY_ID nao expoe role nem is_active)
- contraste positivo: GET /users/:id como ADMIN (FIND_USER_BY_ID_ADMIN) devolve role, is_active, email e email_verified, a divergencia de projecao entre a visao admin e a visao usuario e deliberada e precisa estar pinada dos dois lados

### 140. searchUsers, busca por posto (r.nome) e por OM (o.nome)

- **Código:** `backend/src/modules/users/users.queries.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/users-coverage.test.js`
- **Cobertura hoje:** users-admin.test.js:485-512 busca so por username e por nome; org-identity-gaps.test.js:331-361 cobre inativo excluido e o teto de 20

**O que o verde provaria.** As clausulas LOWER(r.nome) LIKE e LOWER(o.nome) LIKE (users.queries.js:58-59) sao as mais recentes da query e nenhum teste as toca: removendo as duas, ou removendo os dois LEFT JOIN, todos os testes de busca existentes continuam verdes. E o recurso 'busca por posto' do lote de UX.

**Casos:**

- criar usuario com rank_id = Coronel (seed) e organization_id = a OM seed 'Centro de Imagens e Informacoes Geograficas do Exercito' -> GET /users/search?q=Coronel devolve esse usuario
- GET /users/search?q=Centro de Imagens (URL-encoded) devolve o mesmo usuario
- negativo: um usuario sem rank_id e sem organization_id NAO aparece em ?q=Coronel
- case-insensitive: ?q=coronel e ?q=CORONEL devolvem o mesmo id (a query usa LOWER dos dois lados)
- borda de wildcard nao coberta: q contendo '_' (curinga de um caractere no LIKE) nao deve casar com qualquer coisa, ex. um usuario 'Cap' nao pode vir em ?q=C_p se a intencao e busca literal; pinar o comportamento atual

### 141. Duas portas de desativacao divergentes: PUT /users/:id {is_active:false} vs DELETE /users/:id

- **Código:** `backend/src/modules/users/users.service.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/user-deactivation-paths.test.js`
- **Cobertura hoje:** users-admin.test.js:541-547 so cobre o auto-guard (admin desativando a SI MESMO -> 409); nenhum teste desativa OUTRO usuario via PUT

**O que o verde provaria.** updateUser (users.service.js:159-170) desativa via COALESCE($9, is_active) sem nenhuma das duas protecoes que deleteUser tem: nao conta atlas (pula o 409 de reatribuicao) e nao revoga refresh token. A consequencia concreta e ressurreicao de sessao: PUT desativa -> reactivate -> o refresh token ANTIGO volta a valer, porque nada o revogou; pelo DELETE, nao volta. Hoje um verde nao diz nada sobre por qual porta o admin passou.

**Casos:**

- usuario dono de atlas -> PUT /users/:id {is_active:false} -> 200 (sem 409) e atlas.owner_id continua apontando para o usuario agora inativo, pinar a divergencia contra o DELETE, que 409
- RESSURREICAO: login -> guardar refreshToken -> PUT {is_active:false} -> POST /auth/refresh -> 401 -> POST /users/:id/reactivate -> o MESMO refreshToken antigo -> 200 com tokens novos
- contraste no mesmo arquivo: login -> guardar refreshToken -> DELETE /users/:id (sem atlas) -> POST /users/:id/reactivate -> o mesmo refreshToken -> 401 (foi revogado dentro do tx)
- PUT {is_active:false} de outro usuario nao gera linha de audit_trail, enquanto DELETE gera USER_DELETE (org-identity-gaps.test.js:77 ja prova o segundo)

### 142. mailer.js, contrato dependency-optional de sendVerificationEmail() e montagem do link em buildVerificationLink()

- **Código:** `backend/src/utils/mailer.js`
- **Tipo:** unitário · **Fatia:** `be-utils`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** Zero cobertura confirmada (grep por mailer/sendVerificationEmail/buildVerificationLink em backend/tests/ nao retorna nada); auth-email-verification.test.js le o token direto da tabela e nunca olha o link. E `nodemailer` NAO esta instalado (nem em dependencies nem em devDependencies), entao a ramificacao getTransport() -> null e a ATIVA sempre que SMTP_HOST estiver configurado: um deploy que configura SMTP acreditando que enviara e-mail cai em { sent:false } com um logger.warn, o registro responde sucesso, e o usuario nunca recebe nada. Alem disso auth.service.js:246-252 envolve tudo em try/catch por design, entao ate uma excecao do mailer some. Nada hoje distingue 'enviado' de 'silenciosamente nao enviado', e um link montado errado (barra dupla, base ausente) manda o usuario para um 404 sem nenhum teste vermelho.

**Casos:**

- buildVerificationLink('tok-123', 'https://ebgeo.local') === 'https://ebgeo.local/?verify=tok-123'
- Origin com barra final nao gera barra dupla: buildVerificationLink('t', 'https://ebgeo.local/') === 'https://ebgeo.local/?verify=t'
- Sem APP_BASE_URL e sem origin: buildVerificationLink('t') === '/?verify=t' (link relativo, o default de dev/test)
- Token com caracteres reservados ('a/b+c') sai percent-encoded ('%2F', '%2B') e nao quebra a query
- isSmtpConfigured() === false no ambiente de teste, e sendVerificationEmail({to:'a@b.c', link:'/x'}) resolve { sent:false } SEM lancar (contrato no-op do qual o registro depende)
- Subprocesso com SMTP_HOST=smtp.invalido: isSmtpConfigured() === true e sendVerificationEmail(...) ainda resolve { sent:false } sem lancar, documentando que configurar SMTP_HOST sozinho NAO entrega e-mail enquanto nodemailer nao for instalado

### 143. validateMapLibreStyle(), guarda estrutural gemea do validador do frontend

- **Código:** `backend/src/utils/maplibre-style-validate.js`
- **Tipo:** unitário · **Fatia:** `be-utils`
- **Cobertura hoje:** indireta e rasa via tests/integration/catalog.test.js:224-240 (dois pontos, so pelo router basemaps)

**O que o verde provaria.** O gemeo do frontend tem teste unitario proprio (frontend/tests/unit/maplibre-style-validate.test.js, 8 casos); o do backend tem zero, e so e tocado por dois pontos extremos em catalog.test.js:224-240 ({version:7} -> 400 e o minimo valido -> 201). As tres guardas realmente traicoeiras nunca sao exercitadas: Array.isArray em `sources` (typeof [] === 'object', entao sem essa clausula um sources array passa), Array.isArray em `layers`, e a igualdade ESTRITA com o numero 8 (afrouxar para == deixaria a string '8' passar). Um estilo malformado que escapa e persistido e depois servido literalmente no GET /api/config publico, quebrando o mapa base de todos os usuarios, conforme o proprio comentario do arquivo. Divergencia entre os dois validadores tambem e invisivel hoje: o editor admin aceitaria o que o servidor rejeita, ou pior.

**Casos:**

- Aceita o minimo: validateMapLibreStyle({version:8, sources:{}, layers:[]}) -> { ok:true, errors:[] }
- Aceita estilo raster realista (sources com uma entrada + layers com um objeto) -> ok true
- version:'8' (string) -> ok false com erro citando version. Este e o caso que distingue !== de !=
- sources: [] (array) -> ok false; sources: null -> ok false; ausencia de sources -> ok false
- layers: {} -> ok false; ausencia de layers -> ok false
- Topo nao-objeto: null, undefined, [], 'x', 42 -> todos ok false com a mensagem unica 'Style must be a JSON object.' (nota: config.style === null CHEGA ao validador, porque assertValidStyle so pula quando style === undefined, catalog.service.js:16)
- Acumulacao: validateMapLibreStyle({version:7}) -> errors.length >= 2 e ok false
- ESPELHO entre pacotes: rodar a mesma tabela de entradas contra o validador do frontend e assertar ok identico campo a campo (as mensagens divergem por idioma, de proposito; o veredito nao pode divergir)

### 144. SqliteBlobPool.evict(), idempotencia por worker quando um worker CONFIRMA e depois morre

- **Código:** `backend/src/utils/sqlite-blob-pool.js`
- **Tipo:** unitário · **Fatia:** `be-utils`
- **Cobertura hoje:** tests/unit/sqlite-blob-pool.test.js cobre substituicao de worker morto, isolamento de rejeicao (P5) e morte DURANTE evict sem ack; nao cobre ack-e-depois-morte, nem closeAll, nem evict pre-spawn

**O que o verde provaria.** O comentario em sqlite-blob-pool.js:128-131 descreve exatamente a regressao que motivou trocar o contador por um Set: um worker que acka e depois morre era contado DUAS vezes (uma pelo ack, outra por _replaceWorker) e o evict resolvia com OUTRO worker ainda segurando o handle SQLite, bem antes de um rename atomico, que no Windows vira EBUSY/EPERM, ou pior, a substituicao de um {slug}.db aberto durante a ingestao swap-then-commit. O teste existente cobre o worker que morre SEM ackar, cenario que o contador antigo tambem resolvia. Ou seja: hoje o fix do Set passa com e sem o fix, que e a definicao de teste-que-nao-prende.

**Casos:**

- Montar o pool com workers falsos deterministicos (EventEmitter com postMessage/terminate/unref no-op) atribuidos a pool.workers e a pool._spawn, para que o ack real da thread nao corra com o teste
- Iniciar p = pool.evict('/x.db') com 2 workers; entregar SO o ack de w0 (pool._settleEvict(1, w0)); apos um tick, o promise NAO pode ter resolvido (w1 continua segurando o handle)
- Em seguida matar o MESMO w0 (pool._replaceWorker(w0, new Error('died'))); apos um tick o promise ainda NAO pode ter resolvido, este e o assert que falha na versao com contador e passa na versao com Set
- Entregar o ack de w1 -> await p resolve e pool.evicts.size === 0
- evict() antes de qualquer spawn (pool.workers vazio) resolve imediatamente, sem postMessage
- closeAll() com um evict em voo: o promise do evict RESOLVE (nao fica pendurado) e todo pending e rejeitado com /pool closing/
- Controle negativo: reintroduzir um contador numerico no lugar do Set e confirmar que o terceiro caso fica VERMELHO

### 145. sqlite-blob-worker.js, enforcement de readonly/query_only sobre o SQL arbitrario recebido do chamador, e propagacao de erro em vez de promise pendurada

- **Código:** `backend/src/utils/sqlite-blob-worker.js`
- **Tipo:** unitário · **Fatia:** `be-utils`
- **Cobertura hoje:** nenhuma direta; so exercitado de lado por assets3d-sqlite.test.js e pelos testes sv360, sempre com SELECT bem formado

**O que o verde provaria.** O worker executa `sql` cru vindo de quem chama pool.read(); a UNICA coisa que impede uma escrita e o par { readonly:true, fileMustExist:true } + pragma query_only. Nenhum teste toca o worker diretamente (so uso indireto via assets3d/sv360, sempre com SELECT), entao remover `readonly: true` numa refatoracao passaria despercebido e transformaria um caminho de leitura em superficie de escrita sobre o {slug}.db. O segundo caso importa porque nao existe timeout de request no pool (comentado em sqlite-blob-pool.js:33-36): se o worker deixasse de responder num caminho de erro, a promise ficaria pendente PARA SEMPRE em vez de rejeitar, e o sintoma seria um handler HTTP que nunca responde.

**Casos:**

- Criar um .db temporario com better-sqlite3 (tabela blobs(id TEXT PRIMARY KEY, data BLOB) e uma linha conhecida); pool.read(path, 'SELECT data FROM blobs WHERE id = ?', ['a']) resolve um Buffer byte-a-byte igual ao inserido (round-trip do transfer zero-copy)
- pool.read(path, 'DELETE FROM blobs', []) REJEITA (readonly/query_only) e uma leitura subsequente ainda devolve a linha, a prova de que nada foi mutado, nao so de que houve erro
- pool.read(path, "UPDATE blobs SET data = x'00' WHERE id = ?", ['a']) rejeita e o conteudo permanece identico
- pool.read('/caminho/inexistente.db', 'SELECT 1', []) REJEITA dentro de um timeout do proprio teste (assert.rejects com Promise.race contra um timer), provando que fileMustExist devolve erro em vez de pendurar
- SELECT que nao casa nenhuma linha -> resolve null (nao rejeita, nao pendura)

### 146. Defaults de config publicados em GET /api/config nao podem ser URL absoluta de localhost

- **Código:** `backend/src/config.js`
- **Tipo:** integração · **Fatia:** `livro-razao`
- **Arquivo sugerido:** `backend/tests/integration/config-url-defaults.test.js`
- **Cobertura hoje:** parcial - backend/tests/integration/config.test.js:100 prende search.apiUrl===undefined e streetView360.serviceUrl==='/api/v1/sv360', caso a caso, sem invariante que cubra campos futuros

**O que o verde provaria.** Um verde provaria que a classe inteira 'default-irreal' esta fechada, e nao apenas os dois casos que ja morderam (SEARCH_API_URL em :3001 inexistente e SV360_SERVICE_URL em :3000, a porta do Vite). Hoje config.test.js prende dois campos nomeados um a um: um terceiro campo de URL adicionado amanha com default absoluto de dev entra sem teste vermelho, exatamente como os dois primeiros entraram. O frontend faz boot fail-fast neste endpoint, entao o custo do default irreal e o app nao subir em producao.

**Casos:**

- Varrer recursivamente o payload de GET /api/v1/config e assertar que nenhuma string casa /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/ quando as env vars de URL estao desconfiguradas
- Guarda de cobertura nao-vazia: assertar que a varredura visitou N > 0 strings de URL (senao um payload vazio passaria verde sem verificar nada)
- Com as env vars SETADAS para um host de producao, os valores injetados aparecem intactos (o teste vigia o default, nao proibe configuracao)
- Campos relativos conhecidos (assets3dBaseUrl, streetView360.serviceUrl, tiles do sv360) comecam com '/'

### 147. Invariante PERMISSION_LEVELS x CHECK da coluna atlas_shares.permission

- **Código:** `backend/src/middleware/permissions.js`
- **Tipo:** integração · **Fatia:** `livro-razao`
- **Arquivo sugerido:** `backend/tests/integration/permission-levels-invariant.test.js`
- **Cobertura hoje:** nenhuma - backend/tests/unit/middleware-permissions.test.js so testa resolvePermission e nunca toca PERMISSION_LEVELS nem o CHECK

**O que o verde provaria.** Um verde provaria que o mapa de hierarquia no codigo e o CHECK no banco nao divergiram. Este e o guard sistemico que faltou nas DUAS reincidencias da classe 'lista fechada de permissao': hoje adicionar um nivel na migracao sem adiciona-lo a PERMISSION_LEVELS faz resolvedLevel virar undefined e a comparacao numerica virar false, negando acesso em silencio - sem nenhum teste vermelho. E o analogo backend da guarda 'lista vigiada nao pode esvaziar' que ja salvou o docs-integridade (livro-razao 2026-07-18 regressao-propria).

**Casos:**

- Ler o CHECK de atlas_shares.permission do pg_catalog e assertar que todo valor aceito existe como chave em PERMISSION_LEVELS
- Assertar que 'owner' existe em PERMISSION_LEVELS mesmo nao estando no CHECK (e sintetizado de atlas.owner_id) e e o maior valor
- Assertar a lista nao-vazia e o tamanho esperado (5), para que remover um nivel quebre o teste em vez de reduzir a cobertura em silencio
- Assertar a ordem estrita read < comment < write < manage < owner por comparacao numerica, nao por igualdade

### 148. resolvePermission() para os niveis 'manage' e 'comment'

- **Código:** `backend/src/middleware/permissions.js`
- **Tipo:** unitário · **Fatia:** `livro-razao`
- **Arquivo sugerido:** `backend/tests/unit/middleware-permissions.test.js`
- **Cobertura hoje:** parcial - backend/tests/unit/middleware-permissions.test.js cobre owner/write/read/publico/null; nao ha um unico caso com 'manage' ou 'comment'

**O que o verde provaria.** Um verde provaria que a resolucao de permissao devolve os cinco niveis, nao tres. A suite unitaria atual exercita apenas owner/write/read/public/null: e literalmente a mesma lista de tres que o 99-pendencias documentava errado e que a constituicao chama de bug real duas vezes. O verde de hoje nao prova nada sobre manage/comment.

**Casos:**

- share { permission: 'manage' } -> 'manage'
- share { permission: 'comment' } -> 'comment'
- owner tem precedencia sobre um share 'manage' (o dono nunca e rebaixado a co-Gestor)
- atlas publico + share 'comment' -> 'comment' (o share vence o publico, nao o contrario)
- valor desconhecido no share (ex.: 'admin') -> devolve o valor cru; documentar que quem gateia por hierarquia trata desconhecido como negacao

### 149. describe('L6, the migration runner serializes on an advisory lock') > 'a second run is a no-op (all migrations already applied)'

- **Código:** `backend/tests/integration/low-impact-fixes.test.js`
- **Tipo:** integração · **Fatia:** `saude-suite`
- **Cobertura hoje:** backend/tests/integration/config-infra-gaps.test.js:267 ('re-running migrations ... does not throw') cobre o mesmo cenario de forma ainda mais fraca, so ausencia de excecao

**O que o verde provaria.** A MENSAGEM DIZ 'exactly once', O ASSERT DIZ '> 0'. `assert.ok(rows[0].n > 0, 'migrations remain recorded exactly once')` (:265) conta linhas em `_migrations` e so exige que exista alguma. O defeito que este teste existe para pegar e precisamente a DUPLICACAO (dois runners executando a mesma DDL e gravando a mesma migracao duas vezes, descrito no comentario :246-248). Com `> 0`, se a segunda rodada re-aplicasse tudo e dobrasse as linhas, verde. A pergunta de ouro responde 'nada': o verde prova apenas que a tabela `_migrations` nao esta vazia, o que ja era verdade antes do fix.

**Casos:**

- Capturar a contagem ANTES da segunda rodada e afirmar igualdade: `assert.equal(afterN, beforeN, 'a segunda rodada nao pode gravar nenhuma linha nova')`
- Afirmar tambem a unicidade por nome, que e a invariante real: `SELECT name, count(*) FROM _migrations GROUP BY name HAVING count(*) > 1` deve vir vazio
- Guard de lista nao-vazia: `assert.ok(beforeN >= 5, 'baseline: as migracoes 001..005 estao registradas')`, senao o teste tambem passa contra um banco sem migracao nenhuma
- Controle negativo: remover o `ON CONFLICT`/checagem de ja-aplicada do runner e confirmar falha

### 150. describe('Maps API') e describe('Briefings API'), contagens `>= 3` / `>= 2` sobre banco compartilhado e commitado

- **Código:** `backend/tests/integration/maps-briefings.test.js`
- **Tipo:** integração · **Fatia:** `saude-suite`
- **Cobertura hoje:** parcial em backend/tests/integration/maps-coverage.test.js e maps-briefings-gaps.test.js, que tambem nao afirmam conjunto exato

**O que o verde provaria.** ASSERCAO FROUXA CAUSADA POR FALTA DE ISOLAMENTO, e o par frouxidao+estado-compartilhado e fonte de flake em ambas as direcoes. Seis assercoes (:86, :101, :194, :208, :229, :283) usam `>=` com o numero exato de fixtures criadas no proprio setup (o comentario `// map1, map2, lockedMap` prova que o autor conhece o numero exato). O `>=` foi escolhido porque `helpers/setup.js` nao isola nada: os dados sao COMMITADOS e o banco `ebgeo_test` e unico para os 126 arquivos, sem rollback por teste. Consequencia: um GET que passasse a vazar mapas de OUTRO atlas (falha de escopo, o tipo de bug que I5 existe para impedir) aumentaria a contagem e o `>=` continuaria verde. O teste esta cego exatamente para a direcao perigosa.

**Casos:**

- Afirmar o CONJUNTO, nao o tamanho: `assert.deepEqual(res.body.data.map(m => m.id).sort(), [map1.id, map2.id, lockedMap.id].sort())`, pega excesso e falta ao mesmo tempo
- Onde o conjunto exato for inviavel, afirmar o complemento: nenhum id retornado pertence a outro atlas (`assert.equal(data.filter(m => m.atlas_id !== atlas.id).length, 0)`)
- Mesmo tratamento em maps-briefings.test.js:229 e :283 para `slides` (hoje `>= 2` com 2 slides criados)
- Aplicar o mesmo a integration/users-admin.test.js:35 (`>= 2 // At least admin and regularUser`), que tem o mesmo padrao

### 151. Cluster de `assert.ok(res.body.data)`, sharing.test.js:127,148,198,288; sync.test.js:454,494; atlas-advanced.test.js:221; users-admin.test.js:379; atlas-config-authz.test.js:67

- **Código:** `backend/tests/integration/sharing.test.js`
- **Tipo:** integração · **Fatia:** `saude-suite`
- **Cobertura hoje:** backend/tests/integration/sharing-coverage.test.js ('grant-to-effect coverage') faz o certo, afirma o efeito da concessao; as 9 assercoes fracas sao redundancia sem retorno ao lado dela

**O que o verde provaria.** ASSERCAO DE PRESENCA ONDE O VALOR E O PONTO. Nove casos terminam em `assert.ok(res.body.data)` depois de um `.expect(200)`. Como o errorHandler do projeto responde `{ error: ... }` e a rota feliz responde `{ data }`, o `.expect(200)` ja garante praticamente tudo que o `assert.ok(data)` acrescenta, o assert e ruido, nao verificacao. Nos casos de sharing (:127 conceder share, :148 listar, :198 alterar nivel, :288 revogar) o que importa e QUAL nivel foi gravado, e e justamente isso que fica sem prova: conceder 'write' e o servidor gravar 'read' passa verde. Em maps-briefings.test.js:121-123 a variante e `assert.ok(res.body.data.center_lat !== undefined)`, que aceita `null`, `0`, `'abc'` e `NaN` para uma coordenada. Nenhum desses verdes responde a pergunta de ouro.

**Casos:**

- Em sharing: afirmar o registro persistido, nao a resposta, `SELECT permission FROM atlas_shares WHERE atlas_id=$1 AND user_id=$2` e `assert.equal(rows[0].permission, 'write')`
- Na revogacao, afirmar o soft-delete correto (I6) em vez de `ok(data)`: a linha sumiu da listagem E o efeito e observavel (o ex-compartilhado recebe 403 no proximo GET)
- Em maps-briefings.test.js:121-123, trocar `!== undefined` por `assert.equal(typeof data.center_lat, 'number')` + `assert.ok(Number.isFinite(...))` + valor esperado da fixture (lembrando que `?? 0` nao protege NaN)
- Em ws/collab.test.js:377 ('can request sync via WebSocket'), trocar `assert.ok('isSnapshot' in syncResponse)` e `assert.ok(currentVersion !== undefined)` por `assert.equal(typeof syncResponse.isSnapshot, 'boolean')` e `assert.equal(syncResponse.currentVersion, versaoConhecidaDaFixture)`
- Regra geral para a suite: `assert.ok(x)` sobre corpo de resposta so e aceitavel se seguido de uma assercao sobre o CONTEUDO de x

### 152. 'returns a valid GeoJSON FeatureCollection (anon)' (sv360-tiles) e 'analysisLayers only exposes layers with valid bounds' (config), laco sem guard de lista nao-vazia

- **Código:** `backend/tests/integration/sv360-tiles.test.js`
- **Tipo:** integração · **Fatia:** `saude-suite`
- **Cobertura hoje:** sv360-tiles.test.js:181 e :188 (testes seguintes) checam inclusao/exclusao de ids especificos e cobrem indiretamente o vazio; config.test.js:73 cobre o caso positivo do hillshade com bounds

**O que o verde provaria.** COBERTURA VAZIA CLASSICA. Em sv360-tiles.test.js:172 o `for (const f of res.body.features)` valida tipo, geometria e coordenadas de cada feature sem nenhum `assert.ok(features.length > 0)` antes. Com a seed quebrada ou o filtro de acesso SQL rejeitando tudo, `features` vem `[]`, o laco nao executa e o teste verde afirma ter validado um FeatureCollection que nao tem nada dentro. Identico em integration/config.test.js:70, onde `for (const l of cfg.analysisLayers.layers)` verifica que toda camada servida tem `bounds` validos: se `layers` vier vazio (regressao que derruba TODAS as camadas de analise, quebrando o contrato congelado I7 do /api/config) tanto o laco quanto o `!layers.some(l => l.id === 'hillshade')` da linha :66 passam vacuamente. O antidoto contra C4 e explicito na doutrina e esta ausente nos dois: guard de lista nao-vazia + contagem do que foi efetivamente checado.

**Casos:**

- Antes de cada laco, guard: `assert.ok(res.body.features.length > 0, 'guard: a seed precisa produzir features, senao o laco nao verifica nada')`
- Melhor ainda, contagem exata do que a seed criou: `assert.equal(features.length, 2)` (fotos visiveis) e afirmar que o loop de fato iterou (`let checked = 0; ... checked++; assert.equal(checked, features.length)`)
- Em config.test.js, trocar o `!some(hillshade)` por contagem positiva: afirmar quantas analysisLayers sao servidas na seed e que o conjunto de ids e exatamente o esperado, para que zero-camadas falhe
- Aplicar o mesmo guard aos demais lacos sem protecao: sv360-mvt.test.js:71 (decodeTile sobre `Object.keys(tile.layers)`) e features-all-types.test.js:490

### 153. describe('Frontend envelope compatibility') > ultimo caso de pull incremental, assercoes `A || B` sobre nomes de campo do contrato congelado

- **Código:** `backend/tests/integration/sync-frontend-format.test.js`
- **Tipo:** integração · **Fatia:** `saude-suite`
- **Cobertura hoje:** backend/tests/integration/sync-frontend-envelope.test.js e sync-push-serialization.test.js cobrem o envelope de ENTRADA (push); a saida do pull so tem este caso

**O que o verde provaria.** O TESTE ACEITA OS DOIS SHAPES, ENTAO NAO PRENDE NENHUM. Nas linhas :611-614 as assercoes sao `assert.ok(op.entityType || op.target)`, `assert.ok(op.operationType || op.type)`, `assert.ok(op.entityId || op.targetId)`. O envelope de operacao de sync e contrato CONGELADO (I7) consumido por `store/sync/operation-types.js` no frontend: o objetivo do teste e travar o nome dos campos, e ele explicitamente permite dois nomes alternativos para cada um. Se o backend trocasse `entityType` por `target` (ou vice-versa) o frontend quebraria e este teste, que existe para isso, ficaria verde. Somado a isso, todo o bloco esta dentro de `if/else` sobre `isSnapshot` (:607), entao no ramo snapshot nem essas assercoes fracas rodam. O verde nao prova o contrato, prova que o objeto tem tres propriedades com um de dois nomes cada.

**Casos:**

- Fixar o shape exato que o frontend le, sem alternativa: `assert.equal(typeof op.entityType, 'string')` + `assert.ok(!('target' in op), 'o envelope de saida usa entityType, nao target')` (ou o inverso, conforme o codigo do frontend em store/sync/operation-types.js, decidir lendo o frontend, nao a prosa)
- Preferir uma assercao estrutural unica: `assert.deepEqual(Object.keys(op).sort(), [...chaves congeladas...])`, que pega tanto renomeacao quanto campo novo vazando
- Remover o `if (isSnapshot)` como fez o item de sync-snapshot-hybrid: forcar o ramo incremental no arrange
- Verificacao dos dois lados no mesmo commit (I15): o e2e Playwright ja sobe o backend real e e o guarda dessa fronteira, entao referenciar o mesmo conjunto de chaves nos dois pacotes
- Controle negativo: renomear `entityType` para `target` no serializer e confirmar falha

### 154. describe('collab.quality, classifyConnectionQuality') > 'bands latency correctly'

- **Código:** `backend/tests/unit/collab-quality.test.js`
- **Tipo:** unitário · **Fatia:** `saude-suite`
- **Cobertura hoje:** backend/tests/ws/collab-quality.test.js cobre so o efeito ('emits adaptive-settings for a poor connection'), nao as bandas

**O que o verde provaria.** SO PONTOS INTERIORES, NENHUMA FRONTEIRA. O teste checa 50/200/500/1200 e as fronteiras reais sao 100, 300 e 800 (`collab.quality.js:13-16`, comparacoes `<`). Trocar `<` por `<=` em qualquer uma das tres, ou deslocar um limiar em 1, nao e detectado. E logica pura de banda numerica, exatamente o caso em que a checklist de borda do projeto e obrigatoria, e nenhum edge case aparece: `NaN` (que hoje cai silenciosamente em 'critical' porque toda comparacao com NaN e false), negativo, 0, `null`, `undefined`, `Infinity`. Vale lembrar que `x ?? 0` nao protege NaN: aqui nao ha guarda nenhuma, um RTT corrompido classifica a conexao como critica e degrada o transporte de todos os peers sem erro.

**Casos:**

- Fronteiras exatas nos dois lados: 99->excellent, 100->good, 299->good, 300->poor, 799->poor, 800->critical
- Bordas do dominio: 0->excellent, valor negativo (decidir e afirmar o contrato), Infinity->critical
- NaN: afirmar o comportamento pretendido explicitamente, e se o pretendido nao for 'critical' entao o codigo precisa de `Number.isFinite`, o teste e que revela a decisao
- Considerar uma invariante fast-check: a funcao e monotonica nao-crescente em qualidade conforme rtt cresce
- Idem para adaptiveSettingsFor: o caso atual so compara 'good' vs 'critical'; incluir 'excellent' e 'poor' e afirmar os valores exatos, ja que sao parametros de transporte

---

## P3, robustez e borda de menor consequência

### 155. restoreAtlas (atlas.service.js:91-99), bordas e integridade do round-trip da lixeira

- **Código:** `backend/src/modules/atlas/atlas.service.js`
- **Tipo:** integração · **Fatia:** `be-atlas`
- **Cobertura hoje:** atlas.test.js:97-137 (trash + restore: dono restaura, leitor recebe 404), sem bordas nem verificação de conteúdo

**O que o verde provaria.** RESTORE_ATLAS exige (id, owner, deleted_at IS NOT NULL) e é a única rota do módulo SEM requireAtlasPermission, o escopo do UPDATE é o controle de acesso inteiro. O teste atual prova que o não-dono recebe 404 e que o atlas volta a responder 200, mas não prova que o CONTEÚDO voltou: como SOFT_DELETE_ATLAS só marca a linha do atlas, um clean-up futuro que cascateasse para maps/features passaria verde no teste de hoje.

**Casos:**

- restaurar um atlas que NUNCA foi deletado -> 404 (o predicado deleted_at IS NOT NULL)
- restaurar duas vezes -> primeira 200, segunda 404
- integridade: atlas com 2 mapas e 3 feições -> DELETE -> POST /restore -> GET /atlas/:id/sync/0 devolve os 2 mapas e as 3 feições (contagens exatas, não 'ok')
- membro com share 'manage' num atlas deletado -> POST /restore -> 404 (restore é owner-only mesmo para o tier mais alto abaixo de owner) e GET /atlas/:id -> 404
- atlas deletado some da listagem do MEMBRO compartilhado, não só do dono (GET /atlas como o membro)

### 156. logout() revoga por hash sem checar dono nem linhas afetadas (auth.service.js:183-186 / REVOKE_REFRESH_TOKEN)

- **Código:** `backend/src/modules/auth/auth.service.js`
- **Tipo:** integração · **Fatia:** `be-auth`
- **Cobertura hoje:** auth.test.js:63-79 e auth-edge-cases.test.js:178-203, ambos so encadeiam 204 seguido de 401 no refresh.

**O que o verde provaria.** O controller devolve 204 sem olhar rowCount, entao 'desloguei' e indistinguivel de 'nao revoguei nada', e a query nao amarra o token ao req.user.id. Se o REVOKE_REFRESH_TOKEN parasse de casar (mudanca de hashing, coluna renomeada), os dois testes de logout existentes continuariam verdes pelo 204 e o 401 subsequente viria por outro motivo, o 204 hoje nao prova revogacao.

**Casos:**

- usuario A autenticado, POST /auth/logout com refreshToken:'never-issued-token' -> 204 e nenhuma linha de refresh_tokens muda de revoked_at (documenta o no-op silencioso)
- logout normal de A: 204 E assertar direto no banco que a linha do token de A tem revoked_at NOT NULL (assercao contra a autoridade, nao contra o status HTTP)
- A autenticado apresenta o refreshToken de B: fixar o comportamento atual (o token de B e revogado, sem checagem de dono) e assertar que o proprio token de A segue com revoked_at NULL
- POST /auth/logout sem Authorization -> 401 (middleware `auth` estrito da rota, auth.routes.js:22)

### 157. validateEnvVariables, fronteiras de PORT e tetos de NUMERIC_ENV_RULES (config.js:233-236, 261-274)

- **Código:** `backend/src/config.js`
- **Tipo:** unitário · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/unit/config.test.js`
- **Cobertura hoje:** backend/tests/unit/config.test.js:154-221 (so pisos e nao-numericos)

**O que o verde provaria.** Os testes existentes so exercitam o piso (0) e o 'nao numerico'. Nenhum teto e nenhuma fronteira de PORT roda, entao apagar `max` de qualquer regra, ou o `port > 65535`, nao falha nada, e os tetos existem justamente para pegar typo de ordem de grandeza.

**Casos:**

- PORT='0' -> throw; '65535' -> nao lanca; '65536' -> throw; '-1' -> throw (fronteiras exatas).
- WS_HEARTBEAT_INTERVAL_MS='3600000' -> nao lanca e '3600001' -> throw (teto).
- WS_AWAY_GRACE_MS='0' -> nao lanca (min 0, unica regra que aceita zero; distingue-se de DATABASE_POOL_MAX='0' que lanca).
- DATABASE_POOL_MIN='0' -> nao lanca vs DATABASE_POOL_MAX='0' -> throw (as duas regras divergem de proposito).
- SV360_MAX_UPLOAD_BYTES sem `max`: um valor absurdo alto passa (pinar que a regra e so de piso), e '0' -> throw.
- ' 30000 ' com espacos -> aceito (o .trim() e intencional, e hoje ninguem prova isso).

### 158. Boot com porta ocupada: erro do server.listen nao tratado (index.js:18-20)

- **Código:** `backend/src/index.js`
- **Tipo:** integração · **Fatia:** `be-boot`
- **Arquivo sugerido:** `backend/tests/integration/boot-fail-fast.test.js`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** index.js nao registra handler para o evento 'error' do http.Server, entao um EADDRINUSE vira unhandled 'error' e derruba o processo com stack cru. O verde prova que o processo MORRE com codigo != 0 (o supervisor reinicia) em vez de ficar meio no ar servindo nada, e documenta a mensagem que o operador vai ver.

**Casos:**

- Ocupar uma porta com um net.Server no proprio teste, spawn `node src/index.js` com PORT=<a mesma porta> e env valido: exit code != 0 em ate 5s.
- stderr contem EADDRINUSE e o numero da porta.
- O child nao continua vivo apos o erro (nenhum listener adicional, nada respondendo em /api/v1/health).
- Liberar a porta e repetir: sobe normalmente (controle positivo, prova que o fracasso veio da porta e nao do harness).

### 159. listAuditSchema: actorId invalido barrado na borda antes do cast ::uuid

- **Código:** `backend/src/modules/audit/audit.schemas.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/audit-coverage.test.js`
- **Cobertura hoje:** backend/tests/integration/org-identity-gaps.test.js audit-03 (actorId valido, targetType, paginacao, ordem, limit=201); audit-coverage.test.js (atomicidade, filtro action, 401 anonimo)

**O que o verde provaria.** LIST_AUDIT/COUNT_AUDIT fazem `$2::uuid`; o unico guard e o Joi .uuid() na rota. Relaxar para Joi.string() (ou mover o filtro para o controller) transforma ?actorId=abc em erro de cast do Postgres = 500 com texto do banco no corpo fora de producao. Nada hoje exercita esse valor. Fora isso o modulo audit esta genuinamente bem coberto, entao este e o unico buraco que sobra.

**Casos:**

- GET /api/v1/audit?actorId=abc como admin -> 422 (nao 500) e o corpo nao cita 'uuid' do Postgres.
- GET /api/v1/audit?page=0 -> 422 e ?limit=0 -> 422 (as bordas inferiores; a superior limit=201 ja esta coberta).
- GET /api/v1/audit?action=NAO_EXISTE -> 200 com total === 0 e data === [] (filtro sem match e lista vazia, nao erro).

### 160. Assimetria de idempotencia do soft-delete no catalogo: deleteCatalogItem nao filtra active = true

- **Código:** `backend/src/modules/catalog/catalog.service.js`
- **Tipo:** integração · **Fatia:** `be-catalog-config-audit`
- **Arquivo sugerido:** `backend/tests/integration/catalog-tables.test.js`
- **Cobertura hoje:** backend/tests/integration/low-impact-fixes.test.js (L12: GET e PUT em item apagado -> 404); images-gaps.test.js res-01 (recriar -> 409)

**O que o verde provaria.** getCatalogItem e updateCatalogItem filtram `AND active = true` (fix L12), mas deleteCatalogItem nao: um DELETE de item ja apagado responde 204 de novo, enquanto GET e PUT do mesmo item respondem 404. Nao e necessariamente errado (delete idempotente), mas e comportamento nao escrito em lugar nenhum e a proxima pessoa que 'uniformizar' os tres filtros muda a resposta da API sem nada acusar. Pinar o comportamento atual e o que transforma a divergencia em decisao consciente.

**Casos:**

- Criar item; DELETE -> 204; DELETE de novo no mesmo id -> 204 (idempotente) enquanto GET /:id -> 404 e PUT /:id -> 404 no mesmo teste, deixando a assimetria explicita.
- DELETE de um id que nunca existiu -> 404 (o RETURNING vazio), distinguindo 'nunca existiu' de 'ja apagado'.
- Depois do segundo DELETE, SELECT updated_at FROM basemaps WHERE id=$1 mudou (o UPDATE roda de fato), util para quem for reavaliar se o 204 repetido deveria virar 404.

### 161. `handleOperations` com `data.ops` nao-array: `if (!Array.isArray(data.ops) || !validateOps(...)) return;` retorna SEM enviar frame de erro

- **Código:** `backend/src/modules/collab/collab.handlers.js`
- **Tipo:** WebSocket · **Fatia:** `be-collab`
- **Cobertura hoje:** backend/tests/ws/collab-validation.test.js cobre lote malformado (falta id) e op unica malformada; nunca o ramo nao-array.

**O que o verde provaria.** Assimetria de contrato que trava cliente: `operation` malformado devolve VALIDATION_ERROR, `operations` com ops nao-array devolve SILENCIO. Um cliente que dequeue por ack fica esperando para sempre um frame que nunca vem, e o operador nao ve erro nenhum. Baixa prioridade porque nao ha perda nem vazamento de dado, mas o teste vale por fixar QUAL dos dois comportamentos e o contrato: se a decisao for manter o silencio, o teste documenta; se for emitir erro, o teste e o repro. Sem ele, a diferenca entre os dois ramos e invisivel.

**Casos:**

- {type:'operations', ops:'nao-e-array'} -> hoje: nenhum frame por 500ms; o socket segue vivo e responde ping/pong
- {type:'operations'} sem a chave ops -> mesmo resultado, socket vivo
- {type:'operations', ops:[]} -> frame `error` code VALIDATION_ERROR (pushSchema exige min(1)), confirmando que o array VAZIO fala e o nao-array cala
- {type:'operation'} com op ausente (undefined) -> frame `error` VALIDATION_ERROR (contraste direto com o ramo silencioso)
- nenhuma linha em operations para o atlas apos os quatro envios

### 162. Shape de `usersOnline` no frame `connected`: `getRoomUsers` monta UMA entrada por CLIENTE, nao por usuario, e o proprio conectante ja esta na sala

- **Código:** `backend/src/modules/collab/collab.rooms.js`
- **Tipo:** WebSocket · **Fatia:** `be-collab`
- **Cobertura hoje:** backend/tests/ws/collab-gaps.test.js ws-04 (afirma campos do PEER e o status 'away', nunca a auto-inclusao nem a duplicata por usuario).

**O que o verde provaria.** onConnection chama joinRoom ANTES de getRoomUsers, entao o cliente sempre se ve na propria lista, e um usuario com duas abas aparece duas vezes com o mesmo `id` (podendo uma delas estar 'away' e a outra 'online'). Isso e contrato de presenca consumido pelo roster do frontend e nao esta afirmado em lugar nenhum: ws-04 so procura o PEER na lista. Se a ordem de joinRoom/getRoomUsers invertesse, ou se alguem 'consertasse' a duplicata deduplicando por userId, o roster mudaria de forma sem nenhum teste falhar. Um verde documenta o que o cliente pode assumir, incluindo a armadilha da chave repetida.

**Casos:**

- cliente unico conecta em atlas vazio -> connected.usersOnline tem length 1 e o unico item tem id === connected.userId (o conectante se ve)
- mesmo usuario com duas conexoes (clientIds distintos) -> o segundo `connected` traz DUAS entradas com o mesmo id, ambas status 'online'
- campos congelados presentes em toda entrada: id, nome, posto_graduacao, mapId, cursorPosition, selectedFeatures, selectionContext, temporalState, status
- visitante publico na lista aparece com nome 'Visitante' e posto_graduacao null (o handshake normaliza isso em onConnection)
- apos terminate() de uma das duas conexoes e dentro da graca, um terceiro cliente ve as duas entradas do mesmo id com status diferentes ('away' e 'online')

### 163. Contrato de retorno do facade: query() vs one/oneOrNone/none/any

- **Código:** `backend/src/database/index.js`
- **Tipo:** integração · **Fatia:** `be-database`
- **Cobertura hoje:** indireta apenas (index.js e importado por praticamente toda a suite, mas nenhum teste afirma sobre o shape de retorno do facade)

**O que o verde provaria.** `query()` devolve `{rows, rowCount}` com `rowCount = result.length` calculado a partir de `db.any` (index.js:31-33). Consequencia nao obvia: para UPDATE/DELETE SEM RETURNING o rowCount e SEMPRE 0, mesmo tendo afetado N linhas -- e ha 120 chamadas de `await query(` no src, varias delas decidindo 404 por `rows.length`. Hoje funciona porque cada uma dessas queries tem RETURNING, mas nada prende isso: basta uma nova query de escrita sem RETURNING para o servico devolver 404 num update bem-sucedido, sem erro nenhum. O CLAUDE.md chama de 'erro classico' (V4) e a diferenca nao tem um unico teste.

**Casos:**

- `query('UPDATE atlas SET name = name WHERE id = $1', [id])` (sem RETURNING) -> `{rows: [], rowCount: 0}` apesar de 1 linha afetada; a MESMA query com `RETURNING id` -> rowCount 1 (pina o footgun em vez de deixa-lo implicito)
- `query('SELECT 1 WHERE false')` -> `{rows: [], rowCount: 0}` (rowCount espelha rows.length, nao linhas afetadas)
- `one()` rejeita com 0 linhas e com 2 linhas; `oneOrNone()` devolve null em 0; `none()` rejeita se a query retorna linha -> os quatro retornam DIRETO, sem `.rows`
- `tx()` propaga rollback: um callback que lanca depois de um INSERT deixa a tabela sem a linha

### 164. src/database/seed.js

- **Código:** `backend/src/database/seed.js`
- **Tipo:** integração · **Fatia:** `be-database`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** Zero cobertura confirmada (o runner so chama migrate.js). E a ferramenta que monta o ambiente de dev documentado no CLAUDE.md (`npm run db:seed`, usuarios admin/cap.silva). O modo de falha mais provavel e silencioso: o seed resolve rank e OM por SUBSELECT literal (`WHERE nome_abrev = 'Cap'`, `WHERE sigla = 'CIGEx'`, seed.js:43-44) -- se a migracao 001 mudar a abreviacao ou a sigla, o subselect devolve NULL, o usuario e criado sem posto nem OM e ninguem percebe ate alguem depurar o dropdown de cadastro achando que o bug esta no frontend.

**Casos:**

- rodar `seed()` num DB migrado -> existem `admin` (role 'admin') e `cap.silva`, o atlas 'Atlas de Exemplo' com 1 mapa, 3 feicoes (point/polygon/line), 1 camada e share 'write' para cap.silva
- `cap.silva` sai com `rank_id` E `organization_id` NAO nulos, e o join resolve para 'Capitao'/'CIGEx' (pega a quebra silenciosa do subselect por literal)
- rodar `seed()` uma segunda vez -> nenhuma excecao, `count(*) FROM atlas WHERE name='Atlas de Exemplo'` continua 1, e `bcrypt.compare('admin123', password_hash)` continua true (o ON CONFLICT DO UPDATE nao corrompe a credencial)
- isolar o teste: rodar num atlas/usuarios proprios ou limpar no `after`, para nao vazar o usuario 'admin' para as outras 125 suites

### 165. uploadSingleImage (images.routes.js:51-62), ramo generico `Upload error: ${err.message}` e erros do storage engine que NAO sao MulterError

- **Código:** `backend/src/modules/images/images.routes.js`
- **Tipo:** integração · **Fatia:** `be-images`
- **Arquivo sugerido:** `backend/tests/integration/images-upload-error-mapping.test.js`
- **Cobertura hoje:** backend/tests/integration/images-hardening.test.js:59-69 (so LIMIT_FILE_SIZE)

**O que o verde provaria.** O wrapper so foi exercitado no ramo LIMIT_FILE_SIZE. O segundo ramo (qualquer outro MulterError) e o passo `if (err) return next(err)` nunca rodam. Dois gatilhos reais: (a) campo de arquivo com nome errado dispara LIMIT_UNEXPECTED_FILE, se o ramo generico fosse removido, viraria 500; (b) `filename` do multer deriva de `file.originalname.split('.').pop()` sem sanitizacao e e passado direto a `path.join`, entao um originalname como 'foto.pn/g' produz um caminho com diretorio inexistente e o erro de fs (ENOENT, sem statusCode) cai no errorHandler como 500. Espero que o caso (b) FALHE contra o codigo atual, e exatamente o achado: erro de entrada do cliente sendo reportado como falha do servidor. (Travessia de diretorio nao e possivel por esse vetor: o segmento apos o ultimo ponto nunca contem '..'.)

**Casos:**

- POST /images anexando o arquivo no campo 'file' em vez de 'image' -> 400 com error.code BAD_REQUEST (nao 500)
- POST /images com filename 'foto.pn/g' (separador no segmento de extensao) -> resposta 4xx e nenhuma linha em images; se vier 500, registrar como bug do wrapper e nao como comportamento aceito
- POST /images com extensao de ~300 caracteres -> 4xx (ENAMETOOLONG nao pode virar 500)
- apos cada caso acima, o diretorio <IMAGES_DIR>/<atlasId> nao ganhou arquivo parcial

### 166. Fronteira exata de MAX_IMAGE_SIZE_MB nos DOIS guardas (multer `limits.fileSize` e `file.size > maxBytes` no service)

- **Código:** `backend/src/modules/images/images.service.js`
- **Tipo:** integração · **Fatia:** `be-images`
- **Arquivo sugerido:** `backend/tests/integration/images-size-boundary.test.js`
- **Cobertura hoje:** backend/tests/integration/images-hardening.test.js:59-69 (maxSizeMb+1MB) e images-gaps.test.js:274-294 (bulk com 11MB)

**O que o verde provaria.** O unico teste de tamanho usa maxSizeMb + 1 MB, que esta longe da borda: um erro de sinal (`>=` em vez de `>`) ou um off-by-one no calculo `maxSizeMb * 1024 * 1024` rejeitaria arquivos legitimos exatamente no limite e o verde atual nao mudaria. O teste na borda tambem documenta que o guarda do service e hoje inalcancavel por HTTP (o multer corta antes), o que importa se alguem remover o limite do multer achando que o service cobre.

**Casos:**

- PNG valido com exatamente maxSizeMb * 1024 * 1024 bytes (padding apos o IEND, magic bytes intactos) -> 201 e size_bytes === maxBytes no banco
- o mesmo PNG com maxBytes + 1 byte -> 400 com error.code BAD_REQUEST e nenhuma linha criada
- bulk: item base64 cujo buffer decodificado tem exatamente maxBytes -> uploaded (o guarda do bulk usa `buffer.length > maxBytes`, mesma borda)
- bulk: maxBytes + 1 -> failed[0].error casando /File too large/

### 167. id malformado (nao-UUID) nas 4 rotas GET de maps/briefings -> 400 do mapa PG 22P02, nunca 500

- **Código:** `backend/src/modules/maps/maps.routes.js`
- **Tipo:** integração · **Fatia:** `be-maps-briefings`
- **Arquivo sugerido:** `backend/tests/integration/maps-briefings-gaps.test.js`
- **Cobertura hoje:** parcial e so no merge: maps-briefings-gaps.test.js:409-418 (maps-05) aceita 400 OU 404 para :mapId nao-UUID no POST merge. Os 4 GETs nunca receberam id malformado.

**O que o verde provaria.** Nenhuma das 4 rotas GET valida :mapId/:briefingId com Joi; o id cru chega ao Postgres em FIND_MAP_BY_ID / FIND_BRIEFING_BY_ID e depende inteiramente do PG_ERROR_MAP do error-handler (error-handler.js:65, '22P02' -> 400) para nao virar 500 com texto do driver. Esse mapeamento e uma dependencia invisivel a partir do modulo: se a entrada 22P02 sair do mapa, as 4 rotas passam a vazar 500 e nenhum teste desta fatia percebe. O verde prova que a fronteira de entrada rejeita lixo com 4xx limpo e sem mensagem do driver.

**Casos:**

- GET /atlas/:id/maps/not-a-uuid -> 400 e error.code === 'BAD_REQUEST'
- GET /atlas/:id/briefings/not-a-uuid -> 400 e error.code === 'BAD_REQUEST'
- em ambos, assertar que o corpo NAO contem nome de coluna/constraint nem 'invalid input syntax' (error-handler.js:57-59 promete mensagem generica)
- GET /atlas/not-a-uuid/maps -> 4xx (o gate requireAtlasPermission consulta atlas por id antes de tudo, permissions.js:68) e nunca 500
- stranger sem share em GET /atlas/:id/maps/not-a-uuid -> 403, ou seja, a autorizacao decide ANTES do id malformado e o 400 nao vira canal de sondagem de existencia

### 168. errorHandler sem guarda de res.headersSent

- **Código:** `backend/src/middleware/error-handler.js`
- **Tipo:** unitário · **Fatia:** `be-middleware`
- **Cobertura hoje:** parcial, tests/unit/middleware-error-handler.test.js e extenso (Joi, AppError, mapa SQLSTATE, mascaramento, body-parser 4xx) mas todo mockRes assume headers ainda abertos.

**O que o verde provaria.** O handler chama res.status().json() incondicionalmente. Se o erro chegar depois que a resposta ja comecou (assets3d.controller.js:97-100 e sv360.controller.js:135-138 fazem createReadStream(...).pipe(res)), o proprio handler lanca ERR_HTTP_HEADERS_SENT, o express delega para o finalhandler e o socket morre com log duplicado e resposta corrompida. Que o padrao e conhecido esta provado no repo: sv360-error.js:16 faz exatamente `if (res.headersSent) return next(err)`. O handler global, que e o ultimo de todos, nao faz.

**Casos:**

- res mock com headersSent=true + AppError qualquer -> errorHandler nao pode lancar e deve delegar chamando o next(err) que recebeu (hoje lanca)
- res mock com headersSent=true -> res.status/res.json nao sao chamados nenhuma vez
- controle: headersSent=false mantem o comportamento atual (status e envelope conforme o erro), garantindo que a guarda nao muda o caminho normal

### 169. Semaforo de in-flight do caminho SQLite (config.assets3d.maxInflight = 8)

- **Código:** `backend/src/modules/nomes/assets3d.controller.js`
- **Tipo:** integração · **Fatia:** `be-nomes-zones`
- **Cobertura hoje:** backend/tests/integration/assets3d-sqlite.test.js (requisicoes sequenciais); utils/semaphore testado isoladamente em config-infra-gaps.test.js

**O que o verde provaria.** Classe C5 do livro-razao (recurso adquirido e nao devolvido esgotando o pool). O release depende de tres caminhos distintos: res.on('finish'), res.on('close') e o release explicito no branch de BLOB ausente e no catch. Nenhum teste emite mais requisicoes concorrentes que maxInflight, entao um release perdido em qualquer um desses ramos nao seria notado: as requisicoes a partir da nona simplesmente ficariam penduradas para sempre. Um verde hoje prova 'serve um ativo', nao 'devolve a permissao'.

**Casos:**

- 24 GETs concorrentes (Promise.all) do mesmo ativo SQLite (maxInflight=8) -> todos 200 e todos com o corpo integro; falha por timeout se algum release sumir
- Intercalar 24 requisicoes de sucesso com requisicoes 304 (If-None-Match) e 416 (Range invalido), que retornam ANTES do acquire -> todas concluem e as de sucesso seguintes ainda passam (prova que os early-returns nao consomem permissao)
- Sequencia de 12 requisicoes a um rel_path presente na FS mas AUSENTE do SQLite (fallback por stream, sem semaforo) intercaladas com 12 do SQLite -> todas concluem
- Apos toda a rajada, uma requisicao simples ao ativo SQLite ainda responde 200 (nenhuma permissao vazou no estado final)

### 170. :userId malformado em PUT/DELETE /sharing/users/:userId (rotas validam so o body)

- **Código:** `backend/src/modules/sharing/sharing.routes.js`
- **Tipo:** integração · **Fatia:** `be-sharing`
- **Cobertura hoje:** nenhuma

**O que o verde provaria.** Diferente de users.routes.js, que valida params com userIdParamsSchema, as rotas de sharing so passam validate({ body }): o :userId vai direto para o SQL e um valor malformado vira 22P02, mapeado para 400 em error-handler.js:65. O comportamento atual e aceitavel, mas nao esta preso em lugar nenhum, se o mapa PG_ERROR_MAP perder o 22P02, essas rotas viram 500 (com texto do driver em dev) sem nenhum teste acusar. Prioridade baixa porque o SQL e parametrizado: e robustez de borda, nao vazamento.

**Casos:**

- PUT /atlas/:id/sharing/users/not-a-uuid {permission:'read'} como owner -> 400 com error.code 'BAD_REQUEST' (nunca 500, nunca stack)
- DELETE /atlas/:id/sharing/users/not-a-uuid -> 400
- Contraste que prova que so o caminho de params esta descoberto: POST /sharing/users {userId:'not-a-uuid'} -> 422 VALIDATION_ERROR (Joi na borda)
- PUT /sharing/users/<uuid valido com share em OUTRO atlas> -> 404 (o UPDATE filtra por atlas_id; confusao entre atlas nao pode retornar 200)

### 171. SEARCH_USERS: ramos OR por posto/organizacao, shape da linha e escopo entre organizacoes

- **Código:** `backend/src/modules/users/users.queries.js`
- **Tipo:** integração · **Fatia:** `be-sharing`
- **Cobertura hoje:** backend/tests/integration/users-admin.test.js:477 (username/nome + min 2 chars), backend/tests/integration/org-identity-gaps.test.js:330 (inativo escondido + teto LIMIT 20)

**O que o verde provaria.** Tres dos quatro ramos OR da query (r.nome, o.nome) e os dois LEFT JOIN nunca sao exercitados: apagar os joins de ranks/organizations deixa a suite verde e esvazia as colunas Posto/OM do autocomplete de compartilhamento. Alem disso o escopo entre organizacoes e acidental hoje (nao ha filtro por organization_id, ao contrario da postura explicita de isolamento de tenant em users.schemas.js): sem um teste que o declare, ninguem sabe se e decisao ou esquecimento.

**Casos:**

- Usuario com rank_id de posto 'Cap'; GET /users/search?q=Cap retorna esse usuario (ramo LOWER(r.nome))
- Usuario em OM de nome unico; buscar por um fragmento do nome da OM retorna o usuario (ramo LOWER(o.nome))
- Shape: cada linha tem exatamente {id, username, nome, rank_id, posto_graduacao, organization_id, organizacao_militar} e NENHUMA chave casando /password|hash|api_key|email/i
- Usuario com rank_id NULL aparece na busca por username com posto_graduacao === null (LEFT JOIN, nao INNER: um INNER JOIN silenciaria todo usuario sem posto)
- Caracterizacao explicita: usuario da org A encontra usuario da org B (busca e deliberadamente global, porque compartilhamento entre OMs e o caso de uso), comentario no teste registrando a decisao, para o dia em que alguem propuser escopar por tenant

### 172. validateManifest, ramo de sequence_number duplicado e defaults aplicados

- **Código:** `backend/src/modules/streetview360/sv360.ingest.js`
- **Tipo:** unitário · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/unit/sv360-validate-manifest.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-ingest.test.js:347-424 (lat fora de faixa, NaN, target orfao, db_filename com separador) e sv360-coverage.test.js:423 (lon fora de faixa) - tudo por HTTP, nenhum ramo de duplicado/defaults

**O que o verde provaria.** O .custom() do manifestSchema tem duas invariantes cross-array e so a de target orfao tem teste. Sem o guard de sequence_number duplicado o UNIQUE(project_id, sequence_number) estoura como 23505 e o sv360ErrorHandler devolve 409 em vez de 422 - contrato de erro diferente do prometido, sem nada segurando. Os defaults (targets/deleted_photos/schemaVersion) tambem nunca sao afirmados, e mergeProject depende deles (`manifest.targets ?? []`).

**Casos:**

- duas fotos com o mesmo sequence_number -> ValidationError (422) citando 'Duplicate sequence_number'
- manifest sem 'targets' e sem 'deleted_photos' -> retorno com targets: [] e deleted_photos: [] (defaults aplicados, nao undefined)
- manifest sem schemaVersion -> schemaVersion === 1
- validateManifest(null) / ([]) / ('texto') -> ValidationError 'Manifest must be a JSON object'
- photos: [] -> ValidationError (min(1))
- photo com lat: NaN e outro com lon: Infinity -> ValidationError (Joi.number rejeita nao-finito; lembrar que ?? 0 nao protegeria)

### 173. sanitizeSlug / deriveDbFilename (primitiva de isolamento de tenant no nome do arquivo)

- **Código:** `backend/src/modules/streetview360/sv360.merge.js`
- **Tipo:** unitário · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/unit/sv360-merge-naming.test.js`
- **Cobertura hoje:** nenhuma (apenas indireta via sv360-ingest/sv360-tiles, que comparam nomes montados a mao)

**O que o verde provaria.** sao as funcoes puras que garantem que duas OMs com o mesmo slug nunca escrevem no mesmo {slug}.db (FIX-1) e que nenhum separador de caminho entra no nome. sv360.merge.js nao tem teste proprio (so exercicio indireto pela ingestao feliz). Um verde prova que qualquer entrada, inclusive a do backfill ETL que nao passa pelo Joi, sai como basename estavel e sem travessia.

**Casos:**

- sanitizeSlug('../../etc/passwd') -> saida sem '/', sem '\\' e sem segmento '..'
- sanitizeSlug('') / (null) / (undefined) / ('---') / ('///') -> 'project' (fallback nao-vazio)
- sanitizeSlug('Projeto Sao Paulo 2024') -> minusculo, so [a-z0-9_-], sem hifen nas pontas (pinar o valor exato)
- deriveDbFilename(orgA, 'x') !== deriveDbFilename(orgB, 'x') para orgs distintas; e igual e estavel para a mesma dupla em chamadas repetidas
- para toda a lista de slugs acima: path.basename(deriveDbFilename(org, s)) === deriveDbFilename(org, s) (o nome derivado ja e um basename)
- deriveDbFilename termina em '.db' e a substituicao /\\.db$/i por '.webp' usada no thumbnail produz exatamente um par 1:1

### 174. photo_count servido vs numero de fotos efetivamente legiveis quando o manifest tombstona uma foto do proprio photos[]

- **Código:** `backend/src/modules/streetview360/sv360.merge.js`
- **Tipo:** integração · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/integration/sv360-photo-count-drift.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-ingest.test.js:240 e sv360-ingest-serve-e2e.test.js:236 (afirmam photoCount == photos.length, sem nenhum caso de sobreposicao com deleted_photos)

**O que o verde provaria.** mergeProject:147 define photoCount = photos.length e o comentario afirma que tombstones 'nao sao contados como fotos vivas' - mas quando o mesmo id aparece em photos[] E em deleted_photos[] ele e contado e mesmo assim invisivel em toda leitura. E drift ingest->serve declarado na propria prosa: o campo photo_count que /sv360/projects entrega ao cliente nao bate com o que /photos e /tiles servem. Um verde prova que a contagem publicada corresponde ao que a API entrega (ou pina conscientemente a divergencia).

**Casos:**

- Upload com photos [p1,p2] e deleted_photos [{photo_id:p2}] -> GET /sv360/projects/:slug retorna photo_count; contar as features de /sv360/tiles/fotos.geojson com projectSlug do projeto -> hoje 2 vs 1
- GET /photos/p2 -> 404 (confirma que p2 e invisivel apesar de contado)
- Reupload sem p2 em deleted_photos -> photo_count 2 e 2 features (contagem e leitura voltam a concordar)

### 175. Reupload que REMOVE uma foto do manifest (purge + cascade de targets)

- **Código:** `backend/src/modules/streetview360/sv360.merge.js`
- **Tipo:** integração · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/integration/sv360-reupload-removal.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-ingest.test.js:278 ('reupload adds a photo, changes a field, no duplication')

**O que o verde provaria.** 'Ultimo upload manda' esta testado apenas na direcao aditiva (adiciona foto, muda campo). A direcao subtrativa e a que arrisca deixar Postgres a frente do disco: a foto some das tabelas mas o {slug}.db novo tambem nao a tem, e os targets que apontavam para ela precisam ir junto (PURGE_PROJECT_TARGETS + CASCADE). Um verde prova que remover uma foto pelo bundle nao deixa link orfao nem 500 na leitura do vizinho.

**Casos:**

- Upload v1 com p1,p2 e target p1->p2 (201). Reupload v2 so com p1 -> 201
- GET /photos/p2 -> 404; SELECT 1 FROM sv360.photos WHERE id=p2 -> 0 linhas
- GET /photos/p1 -> 200 com targets: [] (nenhum link apontando para a foto removida)
- SELECT count FROM sv360.targets WHERE source_id=p1 OR target_id=p2 -> 0
- photo_count do projeto == 1 e /tiles/fotos.geojson traz so p1

### 176. GET /photos/by-name/:nome, desempate quando a org DO CHAMADOR tem a foto num projeto disabled e outra org tem o mesmo nome num enabled (L10)

- **Código:** `backend/src/modules/streetview360/sv360.queries.js`
- **Tipo:** integração · **Fatia:** `be-sv360`
- **Arquivo sugerido:** `backend/tests/integration/sv360-by-name-tiebreak.test.js`
- **Cobertura hoje:** backend/tests/integration/sv360-gaps.test.js:242-266 (desempate com o ENABLED vencendo e nome so-em-disabled; nao cobre org-propria-disabled vs outra-org-enabled)

**O que o verde provaria.** O ORDER BY de GET_PHOTO_BY_NAME (sv360.queries.js:76) foi mudado justamente para que a org do chamador venca ANTES do status, porque ordenar so por status devolvia a linha de outra org e o gate de legibilidade transformava isso num 404 falso sobre dado proprio. A primeira chave do ORDER BY nunca e exercitada: os testes existentes so tem o caso em que enabled e a resposta certa, que passaria tambem com a ordenacao antiga. Um verde prova que a preferencia por org existe.

**Casos:**

- Nome N em projeto DISABLED da org A e em projeto ENABLED da org B. Membro da org A -> 200 com projectSlug do projeto da org A (a linha disabled propria)
- Mesmo N, chamador anonimo -> 200 com o projeto ENABLED da org B
- Mesmo N, membro da org B -> 200 com o projeto da org B
- Mesmo N, admin global -> 200 (assertar qual linha, pinando o comportamento) e nunca 404

### 177. Conta criada pelo admin (email NULL) tem de logar imediatamente apesar de email_verified=false

- **Código:** `backend/src/modules/users/users.service.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/users-admin.test.js`
- **Cobertura hoje:** users-admin.test.js:68-104 cria via POST /users mas nunca faz login com a conta criada; :517-539 cobre o caminho oposto (register com e-mail -> pendente -> admin aprova)

**O que o verde provaria.** auth.service.js:87 so aplica o gate de e-mail quando user.email IS NOT NULL, e INSERT_USER_ADMIN nem escreve email. Apertar o gate para exigir email_verified sempre quebraria toda conta provisionada por admin e nenhum teste cairia, o unico teste de login que existe usa fixtures inseridas direto no banco, nao a rota.

**Casos:**

- admin POST /users {username,password:'Prov@12345',nome} -> 201 -> POST /auth/login com essas credenciais -> 200 com accessToken (a conta nasce com email NULL e email_verified=false)
- o token dessa conta alcanca uma rota estrita: GET /atlas -> 200
- contraste ja existente mantido: conta criada por register COM e-mail -> login 401 com code EMAIL_NOT_VERIFIED ate a aprovacao

### 178. Mapeamento de erro de FK (PG 23503) em rank_id/organization_id e atribuicao a OM inativa

- **Código:** `backend/src/modules/users/users.service.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/users-coverage.test.js`
- **Cobertura hoje:** nenhuma; PG_ERROR_MAP (error-handler.js:60-67) nao e exercitado por nenhum teste deste modulo

**O que o verde provaria.** POST/PUT de usuario com um UUID bem formado mas inexistente em ranks/organizations dispara 23503; sem o mapeamento o painel admin receberia 500. Nada verifica que o mapeamento pega aqui. E a atribuicao a uma OM DESATIVADA e aceita sem aviso e tranca o usuario fora (login 403 'Organizacao inativa'), armadilha de painel admin sem teste.

**Casos:**

- admin POST /users {username,password,nome, rank_id: <uuid aleatorio>} -> 409 CONFLICT e SELECT em users mostra que o usuario NAO foi criado
- admin PUT /users/:id {organization_id: <uuid aleatorio>} -> 409 e a linha do usuario permanece intacta (organization_id anterior)
- admin PUT /users/:id {organization_id: <org com is_active=false>} -> 200 (aceito hoje) e, em seguida, POST /auth/login desse usuario -> 403 'Organizacao inativa': pinar o footgun de ponta a ponta
- admin PUT /users/:id {rank_id: <rank com is_active=false>} -> 200 e GET /users/:id ainda deriva posto_graduacao (o LEFT JOIN nao filtra is_active)

### 179. Payloads obsoletos em users-admin.test.js sugerindo cobertura de posto/OM que nao existe

- **Código:** `backend/tests/integration/users-admin.test.js`
- **Tipo:** integração · **Fatia:** `be-users-orgs`
- **Arquivo sugerido:** `backend/tests/integration/users-admin.test.js`
- **Cobertura hoje:** o proprio arquivo; a unica assercao real de derivacao posto/OM esta em users-admin.test.js:214-227 (PUT admin)

**O que o verde provaria.** COBERTURA VAZIA POR VOCABULARIO MORTO. Os envios em :77-78 (posto_graduacao:'Ten', organizacao_militar:'Test OM') e :426 (posto_graduacao:'Cap') usam chaves que NAO existem em createUserAdminSchema/updateProfileSchema e sao descartadas por stripUnknown:true; nenhuma assercao as toca. O teste LE como se cobrisse atribuicao de posto/OM na criacao e no auto-update, e nao cobre nada disso, o verde nao prova nada sobre esses campos. Alem disso, :432-441 ('user cannot change their own role') nao tem .expect() nenhum, entao nao distingue 'ignorado' de 'rejeitado' ou 500.

**Casos:**

- trocar :73-80 por rank_id/organization_id reais (SELECT dos seeds) e afirmar no corpo 201 que posto_graduacao e organizacao_militar vieram derivados (nomes), e reler users no banco confirmando os UUIDs gravados
- adicionar PUT /users/me {rank_id: <seed>} -> 200 afirmando posto_graduacao derivado na RESPOSTA (hoje so o caminho admin afirma derivacao; UPDATE_USER_PROFILE tem a mesma CTE e ninguem a verifica)
- em :432-441, acrescentar .expect(200) para provar que `role` e silenciosamente descartado (stripUnknown), nao rejeitado, sem isso a assercao de banco passaria ate com a rota quebrada
- afirmar tambem que a resposta do PUT /users/me nao contem `role` (a projecao de UPDATE_USER_PROFILE nao inclui)

### 180. ServiceUnavailableError (503), a classe e sua travessia pelo errorHandler

- **Código:** `backend/src/utils/errors.js`
- **Tipo:** unitário · **Fatia:** `be-utils`
- **Cobertura hoje:** nenhuma; tests/unit/errors.test.js cobre as outras sete subclasses e tests/unit/middleware-error-handler.test.js cobre so mapeamentos 4xx e SQLSTATE

**O que o verde provaria.** tests/unit/errors.test.js importa as sete outras subclasses e omite ServiceUnavailableError, e nenhum teste do repo a menciona. Ela e o resultado da correcao registrada como regressao-propria (advisory lock sem timeout esgotando o pool): o 503 e o sinal RETENTAVEL que diz ao cliente de sync 'tente de novo', distinto de um 500. Se alguem trocasse o statusCode, ou reordenasse o errorHandler de modo que a ramificacao `err instanceof AppError` ficasse depois do tratamento generico, o 503 viraria INTERNAL_ERROR 500, o cliente pararia de retentar e a operacao seria perdida, hoje sem nenhum teste vermelho.

**Casos:**

- new ServiceUnavailableError() -> statusCode 503, code 'SERVICE_UNAVAILABLE', isOperational true, instanceof AppError e instanceof Error, message default 'Service temporarily unavailable'
- new ServiceUnavailableError('atlas ocupado') preserva a mensagem custom
- errorHandler(new ServiceUnavailableError('atlas ocupado'), req, res, noop) -> res.statusCode 503 e body.error.code === 'SERVICE_UNAVAILABLE' com a mensagem preservada, ou seja, NAO mascarada como 'Something went wrong' pela ramificacao de erro desconhecido (error-handler.js:109-123)
- A ramificacao de codigos de cliente (error-handler.js:86, faixa 400-499) nao captura o 503: garantir que o code retornado nao e 'BAD_REQUEST'

### 181. Limites de memoria do ring do SyncLedger: MAX_ATLAS_RINGS (64, FIFO) e DEFAULT_CAPACITY (5000 spans)

- **Código:** `backend/src/utils/sync-trace.js`
- **Tipo:** unitário · **Fatia:** `be-utils`
- **Cobertura hoje:** tests/unit/sync-trace.test.js nao toca nenhum dos dois limites

**O que o verde provaria.** Os dois limites existem justamente porque o Map de topo crescia sem limite (uma entrada por atlasId para sempre). Nenhum teste os exercita, entao apagar o bloco de eviction ou o splice de capacidade nao produz nenhum vermelho e o vazamento volta silencioso, o sintoma so aparece como RSS crescendo num ambiente de dev/e2e de longa duracao, longe da causa. Vale tambem fixar que a politica e FIFO por INSERCAO e nao LRU, que e contraintuitivo: o atlas mais movimentado pode ser despejado enquanto 64 atlas ociosos e recentes sobrevivem.

**Casos:**

- Gravar 1 span em 65 atlasIds distintos: getTrace(atlas_1).length === 0 (o mais antigo foi despejado) e getTrace(atlas_65).length === 1; contar quantos dos 65 ainda respondem e assertar exatamente 64 (contagem explicita, nao spot-check)
- FIFO e nao LRU: gravar 100 spans em A, depois 1 span em 64 atlas novos -> getTrace('A').length === 0, documentando que atividade nao renova a posicao
- Capacidade do anel: 5001 recordSpan no mesmo atlas -> getTrace(atlas).length === 5000 e o primeiro span sobrevivente tem o `seq` do SEGUNDO gravado (o mais antigo foi descartado, nao o mais novo)
- getTrace de um atlasId nunca gravado -> [] (array vazio, nunca undefined, para nao quebrar o merger do ledger no Playwright)

### 182. Liberacao do advisory lock por atlas no caminho de ERRO do push

- **Código:** `backend/src/modules/sync/sync.service.js`
- **Tipo:** integração · **Fatia:** `livro-razao`
- **Arquivo sugerido:** `backend/tests/integration/sync-push-lock-timeout.test.js`
- **Cobertura hoje:** nenhuma - backend/tests/integration/sync-push-serialization.test.js so exercita o caminho feliz do lock

**O que o verde provaria.** Um verde provaria que um push que aborta no meio do batch (op invalida, 403 de assertOperationAllowed, 22P02) nao deixa o atlas travado para todos os outros clientes. O comentario no codigo afirma que o lock e transaction-scoped e 'no leak on error', mas isso e prosa: nenhum teste exercita o caminho de excecao seguido de um push bem-sucedido. E a mesma forma da licao original (o lock foi introduzido por mim e foi ele que causou a regressao seguinte).

**Casos:**

- Push com uma op que dispara ForbiddenError (delete por nao-owner) -> 403; um push valido imediatamente depois no MESMO atlas retorna 200 sem bloquear
- Push com mapId inexistente / payload que aborta a transacao -> erro mapeado; push seguinte no mesmo atlas passa
- Depois de um push que falhou, pg_try_advisory_xact_lock no mesmo (namespace, atlasId) numa conexao externa consegue o lock (prova direta de que foi liberado)

### 183. teardownTestEnv(), catch vazio no release do client, e ausencia total de isolamento por teste

- **Código:** `backend/tests/helpers/setup.js`
- **Tipo:** integração · **Fatia:** `saude-suite`
- **Cobertura hoje:** nenhuma; nao ha teste sobre o proprio harness

**O que o verde provaria.** SETUP QUE SILENCIA ERRO. `teardownTestEnv` engole toda excecao do `client.release()` com um catch cujo unico conteudo e o comentario `// Ignore release errors` (:77-79). O pool tem `max: 10` e os 126 arquivos compartilham `_pool`: um vazamento de conexao (o modo de falha C5 ja registrado no livro-razao, advisory lock retendo conexao do pool) se manifesta como esgotamento e timeout longe da causa, e este catch apaga o unico sinal local. Somando: o comentario do topo diz que 'no per-suite transaction isolation is needed' porque cada arquivo usa nomes UUID, mas os dados sao COMMITADOS e nunca revertidos, o que ja forcou assercoes frouxas (`>= 3`, `>= 2`) em varios arquivos e deixa a suite dependente de que ninguem consulte sem filtro de escopo.

**Casos:**

- Nao engolir: logar o erro de release com o nome da suite, ou re-lancar. Se ha um motivo real para ignorar, o catch deve afirmar QUAL erro e aceitavel (`if (!/already released/.test(err.message)) throw err`)
- Adicionar um guard global de vazamento: apos cada arquivo, afirmar `_pool.idleCount + _pool.waitingCount` coerente, ou no final da suite afirmar `pool.totalCount === 0` apos destroyTestEnv
- Documentar e sondar a premissa de isolamento: um teste que cria dado e um segundo que afirma que ele NAO aparece na listagem de outro atlas (transforma a premissa em invariante verificada em vez de convencao)
- Uma vez isolado ou escopado, apertar as contagens `>=` de maps-briefings.test.js e users-admin.test.js para igualdade

### 184. describe('Config & infra gaps') > 're-running migrations on the already-migrated DB is a no-op and does not throw'

- **Código:** `backend/tests/integration/config-infra-gaps.test.js`
- **Tipo:** integração · **Fatia:** `saude-suite`
- **Cobertura hoje:** backend/tests/integration/low-impact-fixes.test.js:262 (duplicata, igualmente fraca)

**O que o verde provaria.** TESTE QUE SO VERIFICA QUE A CHAMADA NAO LANCOU. O nome promete 'no-op' e a verificacao e a ausencia de excecao mais `assert.ok(beforeN > 0)` (:270). 'No-op' significa que o estado nao mudou, e o estado nao e comparado antes/depois. Um segundo `runMigrations` que re-executasse toda a DDL, truncasse uma tabela ou duplicasse linhas em `_migrations` nao lanca (as migracoes sao `CREATE TABLE IF NOT EXISTS`/`ADD COLUMN`) e passa verde. Migracao e forward-only e aditiva por I12, e este e o unico teste que guarda a idempotencia do runner: ele nao guarda nada.

**Casos:**

- Comparar estado antes/depois: contagem de `_migrations`, lista de nomes registrados, e um `assert.deepEqual` do conjunto
- Afirmar que nenhum dado foi perdido: inserir uma linha sentinela em uma tabela de negocio antes da segunda rodada e confirmar que ela sobrevive (isso pega o caso em que uma migracao editada re-cria a tabela)
- Consolidar com low-impact-fixes.test.js:262 ('a second run is a no-op'), que testa exatamente a mesma coisa com a mesma fraqueza, manter uma so, com assercao de estado
- Controle negativo: remover a checagem de ja-aplicada do runner e confirmar falha

### 185. 'rejects a malformed request' e similares que aceitam faixa de status, maps-briefings-gaps.test.js:417, assets3d.test.js:70, atlas-transfer-ownership.test.js:104, sv360-tiles.test.js:266

- **Código:** `backend/tests/integration/maps-briefings-gaps.test.js`
- **Tipo:** integração · **Fatia:** `saude-suite`
- **Cobertura hoje:** backend/tests/unit/middleware-error-handler.test.js cobre o mapeamento AppError->status em isolamento, o que torna a frouxidao nas rotas ainda menos justificavel

**O que o verde provaria.** STATUS GENERICO ESCONDE QUAL CAMADA REJEITOU. `assert.ok([400, 404].includes(res.status))` (:417), `403 || 404` (assets3d.test.js:70 e atlas-transfer-ownership.test.js:104), `404 || 422` (sv360-tiles.test.js:266). A diferenca entre 400 e 404 e entre 403 e 404 nao e cosmetica neste projeto: V3 mapeia cada subclasse de AppError a um status, e 403-vs-404 e decisao de vazamento de informacao (responder 404 para um atlas existente sem permissao esconde a existencia; responder 403 confirma). Aceitar os dois significa que o teste nao sabe qual comportamento o produto quer, e uma mudanca acidental de um para o outro (que muda o que o servidor revela a um estranho) nunca sera notada. No caso de assets3d.test.js:70 o alvo e path traversal, onde a distincao importa ainda mais.

**Casos:**

- Decidir o status pretendido lendo o codigo (qual AppError o service lanca) e fixar com `assert.equal(res.status, 404)`
- Onde a ambiguidade for legitima (dois caminhos de erro genuinamente distintos), separar em dois casos com arranges diferentes, cada um com status unico
- Afirmar tambem o corpo: `assert.match(res.body.error.message, /.../)` ou o code, hoje nenhum dos quatro olha o corpo, so o status
- Atencao ao envelope divergente do sv360 (I11): erro plano `{ error }`, nao `{ error: { code, message } }`, o assert precisa refletir isso
