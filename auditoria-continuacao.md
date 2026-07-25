# Auditoria dos três eixos: estado e continuação

Ponto de retomada da varredura de bugs, testes e documentação iniciada em 2026-07-18.
Este arquivo diz **onde paramos, o que está provado, o que falta e o que depende de
decisão sua**. Os achados em si vivem em [`bugs-backend.md`](bugs-backend.md),
[`testes-backend.md`](testes-backend.md) e
[`documentacao-backend.md`](documentacao-backend.md).

Última atualização: 2026-07-19.

## Estado verificado agora

Medido, não estimado. Rode `node scripts/auditoria-inventario.mjs` para a contagem
atual dos três relatórios — é o contador canônico, e existe porque contador
ad-hoc errou três vezes numa só sessão (regex com `\w+` que não casa o acento de
`## Severidade média`, e versão que ignorava o marcador no título).

| | |
|---|---|
| Backend | `1487 testes, 0 falhas` na última medição com a árvore quieta · lint limpo |
| Frontend | `2637 testes, 0 falhas` · lint limpo |
| Migrações | head = `007_audit_zone_actions.sql` |

Progresso em 2026-07-25: **críticos e ALTO zerados** (29 de 29). Bugs em 58/116;
documentação em 25/155; testes ainda em 0/185.

Baseline no início da varredura: 3673 testes (2408 FE + 1265 BE).

## O que já foi corrigido

**35 achados do backend**, cada um com o mesmo protocolo: teste RED confirmado antes
do fix, controle negativo depois (reverter o fix derruba o teste), suíte cheia verde.
Os blocos em `bugs-backend.md` marcados `CORRIGIDO` descrevem o mecanismo real, o que
o achado original errou quando errou, e o que ficou deliberadamente em aberto.

Destaques por impacto, não por ordem:

- **Slides nunca persistiam** (nº 5). Três defeitos em série; o primeiro escondia os
  outros dois. Rendeu ainda a descoberta de que `slide.mapId` (cliente, NOME) e
  `slides.map_id` (servidor, UUID) são homônimos de sentido oposto: a associação
  slide↔mapa **nunca funcionou em nenhum sentido**. O servidor agora traduz nos dois.
- **Corrida na rotação de refresh token** (nº 28, = 7 = 23). Claim atômico. Janela de
  graça de 10s decidida por você, com os dois lados testados.
- **Crash do processo por erro de stream** (nº 26, = 14). Quatro sítios.
- **`trust proxy` ausente** (nº 13): todo limitador por IP era um balde global; o
  efeito agudo era *lockout de conta*, não DoS.
- **Config do mapa podia derrubar o boot para todos** (nº 8), com um único PUT que o
  próprio painel admin gera.
- **Token de visitante lia qualquer atlas público** (nº 51).
- **Senha em texto claro no log** a cada 422 (nº 12).
- **Autoria de comentário forjável** (nº 21).
- **Mailer**: `nodemailer` não estava instalado — verificação de conta por e-mail
  **nunca funcionou em nenhum ambiente**. Instalado e endurecido.

## O que falta, em ordem sugerida

### 1. Médios do backend (50 reais)

Dois itens da contagem bruta (#56 e #66) são só cabeçalhos de duplicata já resolvidos.
Os demais se agrupam assim, e o agrupamento é a ordem sugerida porque defeitos do
mesmo grupo se reforçam:

| Grupo | Achados |
|---|---|
| sv360, semáforo e blob pool | 15, 18, 19, 24, 53, 59, 60, 61, 68 |
| Presença e 3D/360 no sync | 9, 20, 25, 41, 79, 101 |
| Upload e Content-Disposition | 43, 44, 69, 81, 111 |
| Auth e borda | 6, 11, 34, 35, 37, 39, 74, 85, 86 |
| Performance (N+1, `/api/config`) | 29, 64, 67, 113 |
| Catálogo e import | 40, 42, 50 |
| Auditoria e permissão | 55, 62 |
| Documentação (achados que são doc) | 102, 103, 104, 115 |
| Avulsos | 22, 27, 32, 38, 54, 65, 89 |

### 2. Baixos do backend (27)

Você pediu para avaliarmos juntos antes de atacar. Vale a triagem: vários são
"teste que não prende" sobre código correto, e nem todo um compensa o custo.

### 3. Documentação (`documentacao-backend.md`, 155 itens) — NÃO INICIADA

Nenhum item foi tratado. A recomendação registrada continua válida: começar pela
**inversão da regex do `docs-integridade.test.js`**, que sozinha converte 14 itens (53
citações em 22 páginas) de "erro silencioso" para "falha de teste". Os prefixos
pré-monorepo `ebgeo_backend/` e `ebgeo_web/` escapam da alternação fechada da regex.

### 4. Auditoria do frontend — 195 RESULTADOS PRESERVADOS, NÃO REFAZER DO ZERO

Os artefatos existem e estão íntegros. Verificado em 2026-07-19:

```
.claude/projects/C--Users-diniz-OneDrive-Desktop-Desenvolvimento-ebgeo-web/
  eb982799-6e76-467e-86b1-bffe66d2f1a1/
    workflows/scripts/auditoria-frontend-wf_7b48cdc3-542.js   ← o script
    subagents/workflows/wf_7b48cdc3-542/
      journal.jsonl        ← 230 "started", 195 "result"
      agent-*.jsonl        ← 230 transcrições completas
```

Cada linha `result` do journal traz `{type, key, agentId, result}`, onde `key` é o hash
de conteúdo de (prompt, opts) — **a mesma chave que o `resumeFromRunId` usa**. Os
resultados são digests de auditoria em texto, legíveis diretamente.

Duas formas de retomar, nesta ordem de preferência:

1. **`Workflow({scriptPath: "<script acima>", resumeFromRunId: "wf_7b48cdc3-542"})`** —
   o prefixo inalterado volta do cache instantaneamente e só os ~19 agentes que
   faltavam rodam de verdade. Vale **enquanto a sessão `eb982799` viver**.
2. **Se a sessão tiver morrido**, `resumeFromRunId` não vale mais, mas os 195
   resultados continuam no `journal.jsonl`. Leia-os de lá e escreva um script de
   continuação à mão, em vez de refazer 195 agentes.

> **Correção registrada:** uma versão anterior deste arquivo afirmava que os resultados
> "não sobreviveram". Estava errado — eu procurei em
> `AppData/Local/Temp/claude`, e os artefatos de workflow ficam em
> `.claude/projects/<projeto>/<sessão>/`. O usuário apontou o erro. Antes de declarar
> perda de trabalho, procure nas DUAS raízes.

Ao continuar, duas lições desta rodada valem como método:

1. **Auditoria cruzada dos dois pacotes é obrigatória** para qualquer mudança de
   normalização de payload. Foi ela que pegou a regressão do `mapId` que passou por
   1425 testes verdes meus.
2. **Copiar a forma do payload do cliente não basta** — o VALOR também é contrato.
   Meus 11 testes de slide usavam `mapId: <uuid>` porque era o que o servidor
   esperava; o cliente manda nome.

## Pendências registradas em 2026-07-25

O que ficou aberto **de propósito**, com o motivo. Nada aqui é esquecimento; se
algum item mudar de contexto, a conta muda junto.

### Efeito operacional que muda o comportamento de partida

- **`CORS_ORIGIN` malformado passa a impedir o boot** (achado 39). A validação
  agora exige origem canônica: barra final, caminho, `:443` explícito ou lista
  por vírgula fazem o fail-fast disparar. Um deploy que hoje sobe quebrando
  cross-origin passa a **não subir**. É a intenção do achado, mas confira o
  `.env` de produção antes do próximo deploy.

### Correções deliberadamente NÃO feitas

- **Limitador de taxa em `GET /sv360/tiles/fotos.geojson`** (terceiro pé do
  achado 65). Verificado: nenhum arquivo de `frontend/src` chama essa rota, e com
  `LIMIT` e bbox o custo por requisição deixou de ser ilimitado, que era a
  alavanca real. Chutar limite sem medir padrão de chamada é o erro que o próprio
  relatório pegou no achado 9. **Se a rota voltar a ter consumidor, o limitador
  entra.**
- **Revogação de sessão de verdade** (achado 35). A detecção de reuso encerra a
  *rotação*, não a sessão: o access token sobrevive até expirar. Implementar exige
  marcador tipo `users.sessions_valid_from` (migração) **e** decisão de política.
  O que foi corrigido é o comentário que prometia "forçar novo login" sem que nada
  o fizesse, e o teste que fixa a verdade **quebra** quando o marcador for
  implementado, forçando a atualização junto.
- **Remover a rota `fotos.geojson`**, que era a correção preferida do achado 65:
  decisão de produto.

### Deixado fora do escopo por agentes, e que continua valendo

- **`database/index.js` sem `connectionTimeoutMillis`/`statement_timeout`** no
  pool. O prazo do achado 38 cobre só o readiness; o remédio geral é no pool.
- **`images.service.bulkUploadImages`** deriva extensão com
  `filename.split('.').pop()` — mesmo defeito que o achado 69 corrigiu na rota
  unitária (é o achado 80, ainda pendente).
- **`22001` ausente do `PG_ERROR_MAP`** (`middleware/error-handler.js`): qualquer
  overflow de varchar ainda se disfarça de 500.
- **`HEALTH_DB_TIMEOUT_MS` não documentado** em `.env.example` nem no README.
- **`users.service.js:67`** tinha comentário com o mesmo erro factual do achado
  35 — corrigido junto do 55.

### Fora deste repositório

- **`main` tem 6 alertas do Dependabot** (5 altos, 1 moderado): `@fastify/static`
  (path traversal + bypass de autorização), `find-my-way`, `fast-uri`, `postcss`,
  `brace-expansion`. Os três primeiros são runtime do servidor Fastify que serve a
  instalação própria. O `@fastify/static` exige salto de major (9 → 10), então
  pede leitura de changelog e teste do servidor — não é `npm update`.

## Decisões que dependem de você

Não decidi sozinho porque mudam comportamento de produto:

- **Nº 34 — `POST /auth/register` é oráculo de existência de e-mail.** Fechar exige
  trocar o 409 por 201-sempre e mandar um e-mail "esta conta já existe", o que altera
  a UX do cadastro. A rota só existe com `ALLOW_SELF_REGISTRATION`, off em produção.
- **Nº 54 — PUT parcial de override do sv360 zera os não enviados.** Precisa definir a
  semântica: replace total (documentar e manter) ou patch parcial (flag `provided` por
  campo, como já fiz em atlas/organizations/ranks).
- **Nº 33 — buraco conhecido, aceito por você:** ainda dá para se autodeclarar membro
  de uma OM real a que não se pertence. Marcado com um teste `KNOWN GAP` que QUEBRA se
  alguém implementar aprovação, para forçar a revisão em vez de reversão silenciosa.

## Dívidas que eu criei e deixei registradas

- **`org_role` tem campo no painel admin** (`users-tab.js`), mas nenhum teste de UI o
  cobre — não há teste de frontend para o painel admin.
- **O gate de merge no servidor (`manage`) protege uma rota que este cliente não
  chama.** O caminho real é client-side e foi gateado separadamente em
  `map.manager.combineSelectedMapsIntoTarget`. Os dois precisam continuar alinhados.
- **`pull()` do `sync-engine.js` é código morto** (nenhum chamador em `src/`). Deixei a
  guarda de op estrutural nele mesmo assim, para as duas trilhas gêmeas não divergirem.

## Como retomar

```bash
npm run lint --prefix backend && npm test --prefix backend   # 1432, 0 falhas
npm run lint --prefix frontend && npx vitest run             # 2419, 0 falhas
```

O protocolo que vale para cada achado, e que é o que deu resultado:

1. Ler o mecanismo no relatório **e confirmar no código** — vários achados descreviam
   o mecanismo certo e a consequência errada.
2. Escrever o teste e **vê-lo falhar** antes de corrigir.
3. Corrigir.
4. **Controle negativo:** reverter o fix e confirmar que o teste cai.
5. Suíte cheia, sozinha — nada mais rodando contra o mesmo `ebgeo_test`.
6. Anotar no bloco do achado e, quando houver lição, no
   [`livro-razao.md`](livro-razao.md).
