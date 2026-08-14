# Log de Decisões

Registro append-only de decisões de arquitetura e processo (ADRs leves). Este arquivo é o **índice**: uma linha por decisão. As entradas integrais vivem em `decisions-<ano>.md`.

Toda decisão nova acrescenta a entrada completa no arquivo do ano **e** uma linha aqui. **Não reescreva entrada antiga**: adicione uma nova marcando que supera a anterior. É o mecanismo antipodridão — o histórico do porquê sobrevive à mudança de rumo.

## Quando escrever uma decisão

O gatilho é estreito de propósito: registro que dispara para tudo vira ruído e morre. Escreva quando a decisão

1. **cria ou muda um padrão obrigatório** (ex.: "transação do store é persistence-first"),
2. **rejeita uma alternativa óbvia por motivo não-óbvio** (ex.: "múltiplos atlas locais nomeados é non-goal"), ou
3. **é cara de reverter** (schema, contrato congelado, formato de dado persistido).

Nada mais. Escolha de biblioteca trivial, refatoração local e correção de bug não viram decisão — viram commit, teste e, se ensinaram algo, linha no [`docs/livro-razao.md`](../livro-razao.md).

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
| 2026-07-18 | Monorepo: backend integrado por subtree em `backend/` | [decisions-2026.md](decisions-2026.md) |
| 2026-07-18 | Documentação concentrada em `docs/` com camada de memória | [decisions-2026.md](decisions-2026.md) |
| 2026-07-25 | Cartão de atlas sem miniatura do mapa (descopado) | [decisions-2026.md](decisions-2026.md) |
