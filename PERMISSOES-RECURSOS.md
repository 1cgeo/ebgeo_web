# Permissões de recurso: o que foi feito, o que falta e o que você precisa decidir

Documento de entrega do branch `permissoes-recursos`, escrito em 2026-08-17 para ser lido por quem
não acompanhou a sessão. Ele cobre três coisas: o **estado** do trabalho, as **decisões** que ficaram
provisórias porque são do dono, e os **problemas** encontrados no caminho — inclusive os que não
estavam no pedido.

O plano completo, com o SQL e o desenho por extenso, está no artefato:
<https://claude.ai/code/artifact/064b0de3-c20b-4030-8257-ebfe2551de81>

---

## 1. O que o sistema faz

O pedido, em uma frase: os quatro tipos de recurso do catálogo (**modelos 3D, panoramas 360, camadas
de dados e camadas de análise**) passam a ser públicos ou privados, e o privado se compartilha.

| regra | como ficou |
|---|---|
| público / privado | coluna por recurso, nas cinco tabelas de catálogo |
| quem vê tudo | `admin` e o papel novo `curator` |
| compartilhar | dois níveis: **ver** e **ver-e-compartilhar** |
| revogar | derruba **toda a subárvore** de concessões abaixo da que caiu |
| atlas empresta | um atlas com recurso privado dentro dá acesso a quem o abrir, independentemente da permissão individual |

A régua de acesso é uma função só, no SQL, e a ordem é: **público → papel global → concessão direta
→ empréstimo por atlas**. Ela vive em `fn_can_access_resource` e é chamada de dentro das queries,
nunca reimplementada em JS — o mesmo padrão que `nomes.queries.js` já usava.

---

## 2. Fases entregues

Nove commits, cada fase verificável sozinha.

| fase | commit | conteúdo |
|---|---|---|
| F0 | `ff958fde` | censo dos 32 sítios do papel global, escrito **antes** de abrir código |
| F1 | `a5868a1f` | migração 017: colunas, duas tabelas, três funções de resolução. Nenhuma rota |
| F2 | `c7f32ee6` | a marca ganha efeito nos três catálogos; dois vazamentos de rota fechados |
| F3 | `89695aaf` | concessão em árvore, poda da subárvore, três middlewares, payload aditivo |
| F4 | `39667627` | papel `curator` (migração 018), que vê todo privado e não administra nada |
| F5 | `e9bc3128` | empréstimo por atlas, com gate duplo no anexo |
| F6 | `9dfefe9e` | 360 privado; o papel sai do JS e passa a ser resolvido no SQL |
| — | `5ab4ae97` | erratas do 360 registradas em `docs/decisions/decisions-2026.md` |
| F7 | `bf9e46a3` | a interface: selo, modal de compartilhar, seletor no admin, empréstimos no atlas |

**Verificação final**, dois comandos separados, depois da última escrita:
`npm run lint` limpo, e `npm test` com **frontend 4265 · backend 2888 · e2e 171 · skips ZERO**.

### Por que `/api/config` não foi filtrado

Aquele endpoint é memoizado como **um** documento, e é isso que sustenta a rota cujo fracasso impede
o boot do app. Filtrar por chamador destruiria a propriedade. Os recursos privados vêm por um segundo
endpoint autenticado (`GET /resource-access/visible`) e são **somados** ao mesmo singleton no cliente.

---

## 3. As seis decisões, todas PROVISÓRIAS

Estão registradas por extenso em `docs/decisions/decisions-2026.md`, cada uma com a alternativa
recusada. Foram tomadas pelo caminho **mais reversível**, não pelo mais rápido. **Três custam
migração destrutiva para desfazer: D3, D5 e, em menor grau, D2.**

| # | decisão tomada | alternativa recusada |
|---|---|---|
| D1 | somar os emprestados **e depois** intersectar com a restrição do atlas | intersectar antes, que deixaria um recurso emprestado escapar da restrição do próprio Gestor |
| D2 | revogação **soft** (`revoked_at`) + poda recursiva | `CASCADE` como mecanismo: sob soft-delete ele **nunca dispararia**, e destrói a resposta de auditoria |
| D3 | várias concessões vivas por pessoa (grafo), **sem índice único** | um concedente por pessoa: recusar concessão perde informação que nunca fica registrada. O índice ainda pode ser criado depois |
| D4 | o empréstimo vive enquanto o **dono do atlas** enxerga o recurso | validar só no momento de anexar, o que deixa empréstimos vivos depois de o acesso se perder |
| D5 | papel `curator` direto no `CHECK` de `users.role` | tabela marcadora separada: estritamente mais reversível, mas cria duas respostas para "o que é este usuário" |
| D6 | a OM dona continua vendo seu 360 privado | privado esconder do próprio dono; `status='disabled'` continua sendo o eixo de esconder |

---

## 4. O que **você** precisa decidir

1. **As seis decisões acima**, com atenção a D3 e D5.
2. **O empréstimo por atlas deve alcançar os panoramas 360?** Não foi decidido por conta própria, e a
   razão é de segurança: aquelas rotas usam autenticação flexível, sem gate de atlas, e servem tile e
   GeoJSON **cacheados como públicos** para o visitante anônimo. Honrar o `atlasId` ali, do jeito que o
   plano sugeria, entregaria panoramas emprestados a quem soubesse o UUID do atlas, através de um cache
   compartilhado. Existe um teste que fica **vermelho** se alguém ligar o eixo sem a autorização junto.
3. **Auditoria:** o alvo do log viaja em `details` porque `audit_trail.target_type` tem `CHECK` próprio
   e `target_id` é UUID, enquanto os ids de catálogo são slugs de texto. Dar colunas de primeira classe
   aos tipos de recurso custa migração destrutiva por uma linha de log.
4. **Dois sistemas de permissão para "modelo 3D" agora coexistem** (`ng.catalogo_3d` com
   `ng.model_permissions`, e este). Convergir é decisão de produto.

---

## 5. Limite conhecido, por desenho

**Privado esconde o metadado, não os bytes.** A rota `/api/v1/assets3d` é pública por decisão pinada
em teste, então o `tileset.json` de um modelo privado continua baixável por quem souber a URL. Isso
está fora do escopo e conflita com o regime de cache `immutable` daquela rota.

---

## 6. Problemas encontrados no caminho

### 6.1 Um defeito real, que não estava no pedido

**Os recursos privados sumiam a cada F5.** O `login()` era o único a somar o payload aditivo; a
restauração de sessão do `localStorage` não somava. Quem tinha papel global ou concessão via o
catálogo esvaziar depois de recarregar a página, sem erro em lugar nenhum. Corrigido em `index.js`,
com guarda estrutural para não voltar.

### 6.2 Cinco erratas do plano — o código venceu

O plano foi escrito lendo o repositório, mas leitura não é execução:

1. o hard-delete do 360 é `deleteProject` em **`sv360.admin.service.js`**, não onde o plano dizia, e a
   ordem das instruções importa (a purga precisa ler `sv360.photos` antes do CASCADE);
2. o plano só fechava a rota de lista; **`GET /api/v1/tilesets/:id`** vazava a linha privada
   igualzinho;
3. `COLS` em `catalog.service.js` é fixado em exatamente 8 nomes por um teste de paridade — a coluna
   nova exigia uma segunda constante, não um `COLS` maior;
4. a página é **`atlas.html`** (renomeada em `0bbc3aee`), não `projetos.html`;
5. **a que de fato quebrou uma rota:** o plano olhou só o `CHECK` de `action` da auditoria.
   `audit_trail.target_type` tem `CHECK` próprio e `target_id` é UUID — gravar um slug levanta
   `22P02`, que aparece como um HTTP 400 sem relação aparente com o assunto.

### 6.3 Buracos achados nos próprios guardas

Quatro controles negativos vieram **verdes** e não deveriam. Cada um virou caso novo:

- a cláusula que o plano mandava testar na poda recursiva **não muda nada** com todos os elos vivos; o
  que ela faz é impedir que uma poda posterior re-date o que outra já derrubou;
- afrouxar a checagem de permissão **dentro** do serviço ficava verde, porque o middleware barrava
  antes: só um caso chamando o serviço direto expõe;
- remover `curator` da função de papel ficava verde, porque o valor era inalcançável até o `CHECK` da
  fase 4 existir;
- **o pior:** reverter o predicado de privacidade do **MVT** passava verde, porque a suíte media
  privacidade na listagem e **nunca no tile**. Fechado com casos que decodificam o MVT e conferem as
  duas camadas.

### 6.4 Testes que estavam errados, não o produto

Oito testes do 360 reprovaram **e estavam certos em reprovar**: eles forjavam token de admin com um
`sub` sem linha em `users`. A propriedade que sumiu era exatamente "o token sozinho basta" — que é o
que o novo modelo, resolvendo o papel no SQL, deixou de aceitar.

### 6.5 Uma armadilha de infraestrutura que vale para o próximo

A camada `e2e-ui` tinha porta, banco e arquivo de estado **fixos**. Com dois checkouts do mesmo
repositório, `reuseExistingServer` reaproveita um Vite servindo o `src/` **do outro**, e a suíte mede
código que não é o seu, verde do começo ao fim. Agora porta, banco e arquivo de estado são
sobrescritíveis por variável de ambiente, com os mesmos padrões de antes, e o README daquela pasta
explica a colisão.

---

## 7. O que ficou de fora

- **Trocar o nível de uma concessão viva**: hoje revoga-se e concede-se de novo, de propósito, para a
  árvore registrar o ato.
- **A revogação não empurra por socket**: ela vale no próximo pedido do payload aditivo. Janela
  conhecida desde a fase F3.
- **A wiki não foi tocada.** As decisões estão em `docs/decisions/`, mas as páginas de
  `docs/wiki/` ainda não descrevem o sistema novo.

---

## 8. Como continuar

O branch tem nove commits, cada um verde sozinho. Para retomar:

1. leia o artefato do plano e a entrada de decisões;
2. decida os quatro pontos da seção 4 — três deles congelam em migração destrutiva;
3. as fases seguintes naturais são: a wiki, o empurrão da revogação por socket, e a convergência dos
   dois sistemas de permissão de modelo 3D.
