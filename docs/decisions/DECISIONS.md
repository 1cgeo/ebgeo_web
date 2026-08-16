# Log de Decisões

Registro append-only de decisões de arquitetura e processo (ADRs leves). Este arquivo é o **índice**:
uma linha por decisão. As entradas integrais vivem em `decisions-<ano>.md`.

Toda decisão nova acrescenta a entrada completa no arquivo do ano **e** uma linha aqui. **Não
reescreva entrada antiga**: adicione uma nova marcando que supera a anterior. É o mecanismo
antipodridão, e o histórico do porquê sobrevive à mudança de rumo.

## Onde escrever o quê

Quatro registros vizinhos, e ninguém consegue adivinhar a fronteira sem esta seção.

| Destino | O que entra | Como envelhece |
|---------|-------------|----------------|
| **`docs/decisions/`** (aqui) | decisão sobre o **repositório e o processo**: como o código, a documentação e a verificação se organizam. Carrega a alternativa rejeitada e o status. | **Não envelhece**: é datado. Uma decisão superada ganha entrada nova, a antiga fica. |
| [`docs/wiki/`](../wiki/index.md) | decisão sobre o **sistema**: por que o produto funciona assim, qual é a armadilha, qual é o contrato congelado. Quadro consolidado em [`sintese-decisoes-arquiteturais.md`](../wiki/sintese-decisoes-arquiteturais.md). | **Envelhece com o código**: mudou o código, muda a página. É verificada por teste. |
| [`docs/livro-razao.md`](../livro-razao.md) | não é decisão nenhuma: é **desvio de condução** (o que se afirmou sem verificar, o teste que não prendia). | Append-only, podado por síntese. |
| [`docs/MEMORY.md`](../MEMORY.md) | o **fato durável** que sobra depois, não o porquê dele. | Corrigido contra o código quando conflita. |

A pergunta que decide entre os dois primeiros: **se o código mudar, esta frase muda?** Se sim, é
página de wiki. Se não, porque ela registra o que se sabia e o que se escolheu naquele dia, é entrada
aqui. Decisão de sistema que já vive na wiki **não** vira ADR: vira duas cópias que divergem.

## Quando escrever uma decisão

O gatilho é estreito de propósito: registro que dispara para tudo vira ruído e morre. Escreva quando
a decisão

1. **cria ou muda um padrão obrigatório** (ex.: "transação do store é persistence-first"),
2. **rejeita uma alternativa óbvia por motivo não-óbvio** (ex.: "múltiplos atlas locais nomeados é
   non-goal", que é exemplo de FORMA e não de conteúdo vigente: aquela decisão foi superada em
   2026-08-15, e o exemplo fica aqui de propósito, porque uma decisão superada é o caso que este
   registro existe para saber contar), ou
3. **é cara de reverter** (schema, contrato congelado, formato de dado persistido).

Nada mais. Escolha de biblioteca trivial, refatoração local e correção de bug não viram decisão:
viram commit, teste e, se ensinaram algo, linha no [`docs/livro-razao.md`](../livro-razao.md).

## Formato

```
### AAAA-MM-DD: título curto
- **Contexto:** por que a decisão foi necessária.
- **Decisão:** o que foi decidido.
- **Alternativas rejeitadas:** o que se considerou e por que não.
- **Consequências:** o que passa a ser verdade, incluindo o que se perde.
- **Status:** aceita | superada por <data/título>
```

## Índice

| Data | Decisão | Arquivo |
|------|---------|---------|
| 2026-07-18 | Monorepo, backend integrado por subtree em `backend/` | [decisions-2026.md](decisions-2026.md) |
| 2026-07-18 | O pacote web vai para `frontend/` (supera o layout da entrada acima) | [decisions-2026.md](decisions-2026.md) |
| 2026-07-18 | Documentação concentrada em `docs/` com camada de memória | [decisions-2026.md](decisions-2026.md) |
| 2026-07-25 | Cartão de atlas sem miniatura do mapa (descopado) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-15 | Namespace de IndexedDB por atlas, com expurgo derivado de registro (supera P12) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-15 | A fila de saída vira um banco por atlas (reverte a alternativa rejeitada da entrada acima) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-16 | Um registro único de tipo de feição, e a recusa do modelo de source por camada | [decisions-2026.md](decisions-2026.md) |
