# Pendências abertas

Levantadas em 2026-08-21, ao fim da sessão que transformou a [`CONSTITUICAO.md`](CONSTITUICAO.md) em
código (commits `4eace468` a `52aa8f68`). A lógica foi verificada com `npm run lint` e `npm test` na raiz,
as três pernas executando e zero skip. O que está aqui é o que **não** foi feito, e cada item diz por quê.

Ordem: risco primeiro, cosmético por último. Item parado por decisão do dono vive em arquivo próprio
([`PENDENCIA-TILE-PRIVADO.md`](PENDENCIA-TILE-PRIVADO.md)) e só é citado aqui.

---

## 1. A autoridade não morre com o REBAIXAMENTO, só com a desativação

A cláusula 8.5 da constituição diz que a autoridade morre com quem a exercia, e ela vale hoje para conta
desativada e organização desativada. Não vale para **rebaixamento**: `fn_principal_vivo` pergunta pela
CONTA (`is_active`), nunca pela AUTORIDADE. Um produtor que perde o escopo de produção, ou um administrador
que vira usuário comum, continua com a conta ativa e portanto continua **sustentando tudo o que concedeu**,
por até um ano (o teto de expiração).

Está medido e preso como caso de caracterização em `backend/tests/integration/produtor-concede-de-raiz.test.js`,
sob o título "A LACUNA, MEDIDA". Não é surpresa esperando acontecer; é uma decisão adiada.

Para fechar seria preciso que a concessão de raiz perguntasse pelo papel que a originou, e não só pela vida
da conta, o que exige decidir uma coisa que ninguém decidiu: um administrador rebaixado a usuário comum
deve derrubar o que concedeu como administrador, ou aquilo vira concessão órfã legítima?

## 2. Cinco famílias de tela nunca foram fotografadas

A fase de Playwright cobriu sete sessões e **nomeou o que ficou fora**, que é o que a torna útil:

- tudo que depende de **360 ingerido** (o fixture não existe na suíte de tela);
- o fluxo de **"Salvar como local"** inteiro, que é a interface da poda de saída;
- o **risco 5.3 nos dois espelhos**: a frame de compartilhamento que poderia rebaixar no cliente quem tem
  permissão direta maior. O código foi escrito para usar a permissão efetiva, e há teste de servidor, mas a
  tela nunca foi vista nesse caso. É o defeito que some no F5, portanto o mais caro de reproduzir depois;
- a **gaveta de Auditoria com o de-para**;
- a **prévia de recurso emprestado**.

A lógica dessas cinco está coberta por teste; o que falta é a única camada que exercita a UI.

## 3. Um diálogo destrutivo avisa de uma perda que não existe

`frontend/src/js/modals/sharing.modal.js:1016` monta: *"Tirar {grupo} deste atlas? {N} perdem o acesso que
vinha por ele."* Quando o grupo está vazio, o texto vira **"sem membros perdem o acesso"**, e quando N é 1,
vira **"1 pessoa perdem o acesso"**.

O segundo é concordância; o primeiro é pior, porque um diálogo **destrutivo** afirma uma consequência falsa
justamente no momento em que a pessoa decide. O padrão correto já existe ao lado, em
`frontend/src/js/catalog/grant-tree.js`, cujo `@fileoverview` conta que essa mesma classe de erro já foi
paga uma vez ("N pessoas perdem o acesso" quando um dos N era um grupo). A correção é reusar aquelas
funções, não escrever uma terceira variante.

## 4. O aviso de apagar grupo não menciona atlas

Ele conta só as concessões de recurso. Depois de D2 o grupo também carrega acesso a **atlas**, então apagar
um grupo pode derrubar acesso que o aviso não menciona. A direção do erro é a ruim: **avisar de menos**
sobre um ato destrutivo.

## 5. O modal ainda lista como "tem acesso" quem o predicado já nega

A resposta já traz `granted_by_vivo` (foi acrescentado nesta sessão, justamente porque o cliente resgatava
por um `view_share` que o servidor recusa). Falta o marcador visual: a linha aparece igual às outras, então
a tela afirma um acesso que a próxima leitura vai negar.

## 6. Dois buracos de poda, medidos e declarados

- **O teto de profundidade 32 na poda é fail-OPEN.** Uma cadeia mais funda que 32 não é podada além
  daquele ponto, e nada avisa. O teto existe como fail-safe contra ciclo (que é impossível por construção),
  mas a direção da falha é a errada para uma operação de revogação.
- **O caminho de SYNC não tem guarda de referência privada** para 3D, 360, slide e basemap. A poda de saída
  cobre `.ebgeo`, salvar-como-local, clone e import; uma referência privada que entre por operação de sync
  não passa por ela.

## 7. O harness de e2e degrada para `skip` quando não consegue subir o backend

Achado na revisão da onda 0b e não corrigido. Não mordeu nas rodadas desta sessão porque a porta estava
livre, mas é um **verde por skip** esperando acontecer, que é a forma de falsa verificação que este projeto
mais paga. Some com o problema quem trocar a degradação por falha explícita.

## 8. Conta pendente cativa o nome de usuário e o e-mail para sempre

`CHECK_EMAIL_EXISTS` não filtra por vivacidade. Depois que o e-mail passou a ser obrigatório (onda 0a), isso
virou universal: quem se cadastra e nunca confirma bloqueia aquele nome de usuário e aquele e-mail
indefinidamente. Pede decisão de produto (expirar cadastro não confirmado? liberar o par ao expirar?).

## 9. Restos menores

- **O rótulo do dono do grupo é cortado por reticências em três telas** (`Dono: Ana Li…`). Ele **é** a
  mitigação (ii) de D2, aquela que faz o gestor ver de quem é a composição que está aceitando, então chegar
  pela metade é chegar sem cumprir o propósito.
- **`hasEmail` na trilha de `USER_CREATE` virou constante `true`** (zero leitores). Ou ganha sentido ou sai.
- **`001_identidade.sql` ainda afirma que conta sem e-mail nasce ativa.** Migração é forward-only, então
  corrige-se no cabeçalho da próxima, não naquele arquivo.
- **Uma passada de `lint-wiki` está pendente.** Dezessete páginas mudaram nesta sessão, e auditoria
  semântica (órfãs, duplicatas, contradições) merece rodada própria em vez de apêndice de fim de sessão.
- **Uma das ondas teve revisão por duas lentes, não três.** Um revisor adversarial morreu por queda de
  conexão no meio do run, e a saída não identifica qual onda ficou com a cobertura menor.

## 10. Parado por decisão do dono

- **Os bytes do tile privado** não passam por gate, e o acervo privado ao mesmo tempo não desenha para quem
  tem direito. Apuração, quatro opções comparadas e recomendação em
  [`PENDENCIA-TILE-PRIVADO.md`](PENDENCIA-TILE-PRIVADO.md).
- **O auto-cadastro não foi virado em produção** (cláusula 1.5, decisão D5): falta o relay SMTP. O
  endurecimento está feito e a validação de boot recusa subir com a porta aberta sem relay, que é o que
  impede a virada de acontecer por acidente.
- **A lotação continua auto-declarada** (cláusula 10.5). Enquanto ninguém verificar a organização da
  pessoa, qualquer autorização apoiada nela é autorização que o próprio interessado se concede.
