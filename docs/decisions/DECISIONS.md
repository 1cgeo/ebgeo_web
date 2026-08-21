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
| 2026-08-16 | Capa de atlas enviada pelo usuário (supera a recusa de 2026-07-25) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-16 | Recursos privados do catálogo, concessão em árvore e empréstimo por atlas (D1 a D6) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-17 | O escopo de produção é uma coluna em `users`, não uma tabela de vínculos (supera D6) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-17 | O prazo da concessão morre no predicado, nunca em varredura | [decisions-2026.md](decisions-2026.md) |
| 2026-08-17 | A trilha de auditoria é completa e vive fora do atlas | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | `streetview_markers` sai do sistema, sem depreciação | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | O empréstimo por atlas alcança o 360, e o UUID do atlas não é senha | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | Concessão expira, escopo de produção não (assimetria deliberada) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | Os bytes do 3D seguem o recurso, e a rota continua sem consultar o banco | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | O cookie de sessão NÃO é emitido no login | [decisions-2026.md](decisions-2026.md) |
| 2026-08-18 | A coluna legada `maps.catalog_layers` sai, e a definição é podada na saída do log | [decisions-2026.md](decisions-2026.md) |
| 2026-08-19 | As 22 migrações viram 8 baselines por domínio, e o histórico passa a viver só no git | [decisions-2026.md](decisions-2026.md) |
| 2026-08-19 | O acesso geográfico por zonas sai inteiro, a busca de topônimo perde o eixo de acesso, e conceder a um coletivo renasce no schema da aplicação | [decisions-2026.md](decisions-2026.md) |
| 2026-08-19 | Administrar grupo de acesso é papel global de dado (administrador ou credenciado), e listar grupo não é administrar | [decisions-2026.md](decisions-2026.md) |
| 2026-08-20 | O grupo de acesso vira entidade de usuário, com dono, e o produtor ganha visibilidade e concessão de raiz (supera a linha acima) | [decisions-2026.md](decisions-2026.md) |
| 2026-08-20 | O eixo de papel dentro da organização (`org_role`) sai do código inteiro: coluna, claim, consultas, formulário e a semente do papel por atlas no cliente | [decisions-2026.md](decisions-2026.md) |
| 2026-08-20 | A panorâmica 360 passa a ser servida em pirâmide de tiles, e o manifesto de ingestão deixa de exigir tamanho de blob | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | Produzir exige a OM produtora viva; o rebaixamento de quem concedeu continua não propagando, agora medido | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | O compartilhamento de atlas ganha o eixo de grupo, e ele chega a `manage`, com as duas mitigações no mesmo commit | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | O `details` da trilha carrega um de-para seletivo (valor, impressão HMAC, nome-só), e o vídeo de prévia vale para quatro tipos, sem o basemap | [decisions-2026.md](decisions-2026.md) |
| 2026-08-21 | As pendências da integração main/360 são pagas, e o inventário que as listava é apagado | [decisions-2026.md](decisions-2026.md) |
| 2026-08-15 | Fase multi-aba: o plano como executado (registro, com as sete decisões de desenho por extenso) | [fase-multiaba-2026-08.md](fase-multiaba-2026-08.md) |

As duas linhas de 2026-08-16 acima entraram em 2026-08-18: as entradas integrais existiam no arquivo
do ano e ninguém acrescentara a linha aqui, que é a metade do procedimento que falha calada (o índice
não erra, ele só encolhe). Quem escrever a próxima entrada confere a contagem dos dois lados.
