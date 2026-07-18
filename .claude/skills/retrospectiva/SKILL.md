---
name: retrospectiva
description: Extrai aprendizados duráveis da sessão e consolida a memória do projeto (dreaming). Use ao final de uma sessão de trabalho substancial, ou quando eu disser "retrospectiva", "fecha a sessão", "o que aprendemos" ou "consolida a memória".
---

# Retrospectiva (dreaming)

Consolidação de memória entre sessões: revisar o que aconteceu, integrar o que é durável, podar o ruído. A tese é que a qualidade da memória importa tanto quanto a do modelo — memória enxuta e bem curada vale mais que muita anotação solta.

Doutrina: [`../_DOUTRINA.md`](../_DOUTRINA.md).

## Quando usar

No fim de uma sessão com trabalho real, ou quando eu pedir.

## Quando NÃO usar

- Só para resumo de status, sem escrever memória.
- Para auditar a wiki isoladamente: use `lint-wiki` (esta skill a chama na fase de poda).

## A regra que protege a memória: DELTAS, nunca reescrita

**Nunca devolva um `MEMORY.md` novo inteiro.** Consolidação por reescrita degrada a memória a cada rodada, e a degradação é invisível porque o resultado sempre *parece* mais limpo. Dois modos de falha documentados: *brevity bias* (a sumarização iterativa descarta o insight de domínio, que é justamente o caro de reconstruir) e *context collapse* (a reescrita erode detalhe ao longo do tempo).

Proponha **operações individuais e revisáveis**:

```
+ ADICIONAR em "Armadilhas": <bullet>
- REMOVER de "Invariantes": <bullet>  (motivo: contradiz backend/src/x.js:42)
~ CORRIGIR em "Como verificar": <antes> -> <depois>
```

Cada delta é aprovado ou recusado por si. Se um bloco inteiro precisa mudar, isso é sinal de que houve uma **decisão**: registre em `docs/decisions/`, não reescreva a memória em silêncio.

## Procedimento (4 fases)

### Fase 1: Orientar

1. Leia [`MEMORY.md`](../../../MEMORY.md), [`docs/wiki/index.md`](../../../docs/wiki/index.md) e [`livro-razao.md`](../../../livro-razao.md).
2. Folheie as páginas de wiki e os `learnings.md` tocados na sessão, para não duplicar.

### Fase 2: Coletar sinal

3. Revise a sessão e os commits recentes (`git log` dos últimos 1 a 3 dias). Separe o **durável** do efêmero.
4. **Priorize o que CONTRADIZ o estado atual**: fato que mudou, decisão revista, armadilha que se revelou falsa. Contradição tem precedência sobre novidade — memória errada custa mais que memória incompleta.
5. Aplique o filtro fato/estado. Fato ("o boot é fail-fast em `/api/config`") entra. Estado ("a fase B está em andamento") **não entra**: o git, as issues e o código sabem melhor e isso apodrece em dias.

### Fase 3: Consolidar

6. Emita os deltas de `MEMORY.md` (formato acima).
7. Aprendizado de **método** vai para o `learnings.md` da skill usada. Aprendizado de **domínio ou arquitetura** vira ou atualiza página de wiki.
8. **Antes de escrever prosa, pergunte se cabe um teste.** A forma mais forte de codificar uma lição é o teste de regressão que falha se ela for esquecida. Se couber, o teste é o learning.
9. Decisão que cria padrão, rejeita alternativa óbvia ou é cara de reverter vira entrada em [`docs/decisions/`](../../../docs/decisions/DECISIONS.md) — integral no arquivo do ano, uma linha no índice.

### Fase 4: Podar e indexar

10. Leia o `livro-razao.md` procurando **recorrência**, não volume:
    - mesma classe na **mesma** skill: o learnings não pegou. Mude a abordagem, não re-anote.
    - mesma classe **entre** skills: lacuna de doutrina ou constituição. Suba o nível.
    - classe resolvida e sem reincidência: condense numa linha de síntese e remova os eventos crus.
11. Pode o que morreu: regra que não vale mais, página dormente, learning superado. O direito de desaprender é tão sagrado quanto o de aprender (princípio 6).
12. Rode `lint-wiki` (órfãs, links quebrados, contradições pendentes) e `npm test tests/unit/docs-integridade.test.js`.
13. Confira os tetos: `MEMORY.md` <= 200 linhas / 25KB, `CLAUDE.md` <= 200 linhas. Passando de ~80%, mova detalhe para a wiki.

## O sinal honesto de que isto funciona

Não é o volume de memória escrita, nem a sensação de estar mais rápido — há evidência de que essa sensação engana (num ensaio controlado, desenvolvedores experientes ficaram 19% mais lentos com IA enquanto estimavam ter ficado 20% mais rápidos).

O único proxy confiável é o do postmortem de SRE: **a mesma correção reaparece?** É por isso que o livro-razão registra correções e é lido por recorrência, não por contagem.
