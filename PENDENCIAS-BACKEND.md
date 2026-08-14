# Pendências que dependem do servidor

Levantadas na auditoria do frontend de 2026-08-14. Cada uma foi confirmada lendo
os dois lados do código, e nenhuma tem contorno aceitável no cliente: por isso
estão aqui em vez de corrigidas.

O eixo de contrato foi verificado por inteiro: as 118 rotas dos 17 módulos do
backend cruzadas contra as 73 chamadas do frontend. **Não há divergência de
caminho, de método nem de schema.** Toda chamada resolve para uma rota que
existe, com o método certo, inclusive nos casos em que a ordem literal-antes-de-
parâmetro importa (`/atlas/trash`, `/atlas/public/:link`, `/sv360/photos/nearest`).
A invalidação de cache do servidor também está completa. O que sobra é o que
segue.

---

## 1. O limitador de refresh é chaveado por IP, e o deploy é rede atrás de NAT

**Onde:** `backend/src/middleware/` (o `refreshLimiter` aplicado em `/auth/refresh`).

**O problema.** O limitador conta por endereço de origem. Numa rede militar com
saída NAT, todos os usuários compartilham o mesmo IP, então o orçamento de
requisições é consumido coletivamente. Um pico de uso legítimo gera 429 para
quem não fez nada de errado.

**Por que isso passou a doer.** No cliente, esse 429 percorria uma cadeia que
terminava apagando o trabalho local do usuário. A cadeia foi cortada nesta
auditoria em três pontos (o `refresh` só destrói a sessão em 401; o logout
involuntário preserva o dado quando há fila pendente; o flush passou a avisar).
Ou seja: **o dano imediato está contido no cliente**, mas a causa continua de pé,
e ela se manifesta como usuário deslogado sem motivo aparente.

**O que decidir.** Chavear o limitador por identidade (`sub` do refresh token)
em vez de por IP, ou manter por IP com um orçamento dimensionado para o número
real de usuários por saída NAT. A primeira é mais correta e exige ler o token
antes de limitar; a segunda é uma linha de configuração e não resolve o caso de
uma organização grande.

---

## 2. Blob de imagem órfão nunca é recolhido

**Onde:** `backend/src/modules/images/images.routes.js` e o serviço correspondente.

**O problema.** Quando a feição ou o ícone que referencia uma imagem é excluído,
o blob permanece. Não há coleta, e o armazenamento cresce sem teto.

**Por que não dá para consertar no cliente.** Apagar a imagem no momento da
exclusão da feição conflita com o modelo de conflito do projeto: a resolução é
LWW por ordem de chegada no servidor, e o desfazer é local. Uma exclusão que
chega de um peer apagaria um blob que outro peer ainda referencia, e o desfazer
não teria como trazer o arquivo de volta.

**O que decidir.** Uma coleta periódica no servidor, varrendo `images` contra as
referências vivas, com uma carência que cubra a janela de desfazer. É decisão de
produto porque define quanto tempo um blob órfão sobrevive, e porque uma varredura
mal dimensionada apaga o que ainda importa.

---

## 3. Quatro campos de `atlasSettingsSchema` que ninguém escreve e ninguém lê

**Onde:** `backend/src/modules/atlas/atlas.schemas.js:19-56` — `default_basemap`,
`bounds_2d`, `min_zoom` e `max_zoom`.

**O problema.** O schema aceita os quatro campos, nenhuma tela do frontend os
escreve e nenhum código os lê. Um schema que promete o que ninguém honra é a
forma de documentação que engana com mais eficiência, porque tem aparência de
contrato.

**O que decidir.** Ou o recurso passa a existir (o servidor valida o resultado do
merge, lendo o `settings` atual, aplicando o patch e validando o objeto completo,
e a interface ganha os quatro campos), ou os quatro saem do schema. Qualquer uma
das duas é melhor que a atual.

---

## 4. `POST /auth/register` não devolve mais dado de conta, e um teste ainda espera

**Onde:** decisão do backend tomada em 2026-07-25; o consumidor quebrado está em
`frontend/tests/e2e-ui/browser-p11-roundtrip.spec.js:79`.

Isto **não é** pedido de mudança no servidor: a decisão do backend está certa, e
o teste é que ficou para trás. Fica registrado aqui só para que a próxima pessoa
que ler o spec não conclua que o servidor regrediu. A correção é no teste, e está
no relatório de testes.
