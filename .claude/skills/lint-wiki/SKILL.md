---
name: lint-wiki
description: Audita a higiene da wiki em docs/wiki (órfãs, wikilinks quebrados, duplicatas semânticas, contradições pendentes, páginas que viraram recontagem do código). Use na retrospectiva, ao terminar um lote de páginas, ou quando eu disser "audita a wiki" ou "lint da wiki".
---

# lint-wiki

Auditoria de higiene da memória semântica. Detecta em escala o que a leitura humana não pega.

Doutrina: [`../_DOUTRINA.md`](../_DOUTRINA.md). Regras da wiki: [`../../../docs/wiki/wiki-schema.md`](../../../docs/wiki/wiki-schema.md).

## Por que existe

A duplicação que motivou o script: a semeadura da wiki dividiu 21 documentos em 6 fatias temáticas para paralelizar, e fatias diferentes escreveram o **mesmo conceito com slugs diferentes** (quatro páginas sobre presença, duas sobre o canal WS, duas sobre LWW). Deduplicação por slug não pega isso. Só apareceu porque alguém foi olhar a lista de arquivos na mão, e isso não escala.

O agente é bom **auditor** da wiki e arriscado como **autor solto**. Esta skill é o lado auditor.

## Uso

```bash
python .claude/skills/lint-wiki/scripts/lint_wiki.py          # relatório legível
python .claude/skills/lint-wiki/scripts/lint_wiki.py --json   # para consumo programático
```

Sai com código 1 se houver **erro**, 0 se só houver **aviso**.

## O que ele checa

**Erros** (exigem ação):

| Checagem | Por que é erro |
|---|---|
| wikilink quebrado | o formato não resolve sozinho no Claude Code; link morto é dívida silenciosa |
| página órfã | nada aponta para ela: ou falta cross-link, ou ela não deveria existir |
| contradição pendente | divergência doc↔código não resolvida; só o código decide |
| duplicata provável (Jaccard >= 0.45) | duas páginas sobre o mesmo conceito, o modo de falha que originou a skill |

**Avisos** (julgamento):

| Checagem | O que investigar |
|---|---|
| integração fraca (só o index aponta) | falta cross-link a partir das páginas relacionadas |
| sobreposição alta (Jaccard 0.35-0.45) | pode ser vizinhança legítima ou fusão pendente |
| pouco "porquê" | a página pode ter virado recontagem do código: **o critério central da wiki** |
| não cita nenhum arquivo de código | afirmação sobre comportamento sem âncora verificável |
| debate aberto | divergência intencional; não é pendência, mas vale reler |

## Como interpretar

**Contradição pendente é ouro, não sujeira.** Ela marca um ponto onde a documentação e o código discordam — resolver exige abrir o **código**, nunca decidir pela prosa. Ao resolver, corrija a página e apague o marcador.

Uma contradição contra um documento que **não existe mais** (guia absorvido e removido) não é pendência: vira `> **Nota histórica.**`, porque a wiki já afirma o que o código faz.

**"Pouco porquê" é o aviso mais importante.** Ele operacionaliza o critério que define esta wiki: o código já é a evidência, então a página só se justifica onde a leitura do código não resolve. Página com muitas linhas e poucos sinais de decisão, armadilha ou contrato provavelmente reconta o código, e prosa que reconta código é pior que ausência.

**Duplicata precisa de julgamento.** Jaccard alto entre duas sínteses que comparam o mesmo par de conceitos pode ser legítimo. Entre duas páginas de conceito, quase nunca é.

## Ao encontrar duplicata

Fundir não é escolher a melhor: é **somar sem repetir**. Páginas escritas por agentes diferentes a partir de fontes diferentes carregam material que as outras não têm. Onde discordarem, o código decide. Depois de fundir, redirecione os wikilinks das outras páginas para o slug canônico, ou o link quebra.

## Limites

A similaridade é Jaccard sobre bag-of-words, não embedding: pega repetição de vocabulário, não paráfrase. Duas páginas que dizem a mesma coisa com palavras diferentes passam. É barato e sem dependência, e o custo é esse.
