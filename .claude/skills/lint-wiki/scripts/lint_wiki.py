#!/usr/bin/env python3
"""Auditoria de higiene da wiki do EBGeo.

Detecta o que a leitura humana nao pega em escala: pagina orfa, wikilink
quebrado, contradicao pendente, duplicata semantica e pagina que virou
recontagem do codigo.

A duplicata semantica e a checagem que motivou o script: a semeadura da wiki
dividiu os documentos em fatias tematicas para paralelizar, e fatias diferentes
escreveram o MESMO conceito com slugs diferentes (4 paginas sobre presenca).
Dedup por slug nao pega isso; similaridade de conteudo pega.

Uso:  python .claude/skills/lint-wiki/scripts/lint_wiki.py [--json]
Saida: relatorio legivel; exit 1 se houver ERRO (contradicao pendente, link
quebrado ou orfa), 0 se so houver AVISO.
"""
import io
import json
import os
import re
import sys
from collections import Counter

WIKI = os.path.join('docs', 'wiki')
IGNORAR = {'index', 'wiki-schema'}

RE_WIKILINK = re.compile(r'\[\[([^\]]+)\]\]')
RE_CONTRADICAO = re.compile(r'>\s*\[!CONTRADICAO\s+(\d{4}-\d{2}-\d{2})\]\s*(.+)')
RE_DEBATE = re.compile(r'>\s*\[!DEBATE\s+(\d{4}-\d{2}-\d{2})\]')
# O prefixo NAO e lista fechada, e a razao e um defeito medido: esta regex exigia
# `src|backend|tests`, que sao os prefixos PRE-monorepo. Desde 2026-07-18 o pacote
# web mora em `frontend/`, entao as 44 paginas que citam o caminho CERTO
# (`frontend/src/js/...`) nao casavam, e o linter acusava "nao cita nenhum arquivo
# de codigo" em 17 delas. Um detector de cobertura vazia que erra por lista fechada
# de prefixo produz exatamente o que existe para achar: um aviso que nao aponta
# para nada e um silencio onde havia problema.
#
# O `docs-integridade.test.js` cometeu e corrigiu o MESMO erro, com estas palavras:
# "lista fechada silencia o que nao conhece, entao aqui a regra e inversa: colete
# QUALQUER token com cara de caminho e extensao conhecida". Aqui vale igual.
RE_CAMINHO_CODIGO = re.compile(
    r'`([A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+\.(?:js|cjs|mjs|sql|json|css|html))`')
# Marcadores de conhecimento que o codigo NAO carrega. Uma pagina sem nenhum
# deles provavelmente so reconta o codigo.
RE_PORQUE = re.compile(
    r'\b(por que|porque|razao|decidi|decisao|alternativa|rejeit|em vez de|'
    r'armadilha|cuidado|nunca|jamais|atencao|contrato|congelad|nao pode|'
    r'quebra|custo|limite|gotcha|parece|engana)\b',
    re.IGNORECASE,
)


def carregar():
    paginas = {}
    for nome in sorted(os.listdir(WIKI)):
        if not nome.endswith('.md'):
            continue
        slug = nome[:-3]
        paginas[slug] = io.open(os.path.join(WIKI, nome), encoding='utf-8').read()
    return paginas


def tokens(texto):
    """Bag of words minusculo, sem marcacao, para similaridade grosseira."""
    limpo = re.sub(r'```.*?```', ' ', texto, flags=re.S)
    limpo = re.sub(r'[^a-zA-Zaaaeeiooouc\s]', ' ', limpo.lower())
    return {p for p in limpo.split() if len(p) > 4}


def main():
    if not os.path.isdir(WIKI):
        print(f'ERRO: {WIKI} nao existe')
        return 1

    paginas = carregar()
    conteudo = {s: t for s, t in paginas.items() if s not in IGNORAR}
    erros, avisos = [], []

    # --- wikilinks: quebrados e grafo de entrada ---
    entradas = Counter()
    for slug, texto in paginas.items():
        for m in RE_WIKILINK.finditer(texto):
            alvo = m.group(1).split('|')[0].strip()
            if alvo not in paginas:
                erros.append(f'link quebrado: {slug} -> [[{alvo}]]')
            elif alvo != slug:
                entradas[alvo] += 1

    # --- orfas: nenhuma pagina aponta para ela ---
    for slug in conteudo:
        if entradas[slug] == 0:
            erros.append(f'orfa (nenhuma pagina aponta): {slug}')

    # --- integracao fraca: so o index aponta ---
    links_do_index = {m.group(1).split('|')[0].strip() for m in RE_WIKILINK.finditer(paginas.get('index', ''))}
    for slug in conteudo:
        if entradas[slug] == 1 and slug in links_do_index:
            avisos.append(f'integracao fraca (so o index aponta): {slug}')

    # --- contradicoes pendentes e debates ---
    for slug, texto in conteudo.items():
        for m in RE_CONTRADICAO.finditer(texto):
            if 'RESOLVIDO' not in m.group(2).upper():
                erros.append(f'contradicao pendente: {slug} ({m.group(1)})')
        for m in RE_DEBATE.finditer(texto):
            avisos.append(f'debate aberto (aceito): {slug} ({m.group(1)})')

    # --- duplicata semantica (Jaccard sobre tokens) ---
    toks = {s: tokens(t) for s, t in conteudo.items()}
    slugs = sorted(toks)
    for i, a in enumerate(slugs):
        for b in slugs[i + 1:]:
            ta, tb = toks[a], toks[b]
            if not ta or not tb:
                continue
            j = len(ta & tb) / len(ta | tb)
            if j >= 0.45:
                erros.append(f'duplicata provavel (Jaccard {j:.2f}): {a} <-> {b}')
            elif j >= 0.35:
                avisos.append(f'sobreposicao alta (Jaccard {j:.2f}): {a} <-> {b}')

    # --- pagina sem porque: so reconta o codigo ---
    for slug, texto in conteudo.items():
        corpo = '\n'.join(l for l in texto.split('\n') if not l.startswith('#'))
        sinais = len(RE_PORQUE.findall(corpo))
        linhas = max(1, len([l for l in corpo.split('\n') if l.strip()]))
        if sinais / linhas < 0.12:
            avisos.append(
                f'pouco "porque" ({sinais} sinais em {linhas} linhas): {slug} '
                f'- confira se nao virou recontagem do codigo'
            )

    # --- afirmacao sobre codigo sem citar arquivo ---
    # Este aviso e o detector de COBERTURA VAZIA, nao de estilo: pagina sem
    # caminho verificavel passa verde no docs-integridade sem que ele cheque
    # nada. Foi o que pegou as 1.054 citacoes encurtadas para o basename.
    for slug, texto in conteudo.items():
        if not RE_CAMINHO_CODIGO.search(texto):
            avisos.append(f'nao cita nenhum arquivo de codigo: {slug}')

    # --- em-dash: a regra so vale se for mecanica ---
    # Estava enunciada no wiki-schema e violada em toda parte, inclusive na
    # pagina que a enuncia. Regra escrita e ignorada treina o agente a ignorar
    # regra escrita, entao ou vira checagem ou sai.
    for slug, texto in conteudo.items():
        n = texto.count('—')
        if n:
            avisos.append(f'{n} em-dash (use virgula, dois-pontos ou frase separada): {slug}')

    if '--json' in sys.argv:
        print(json.dumps({'erros': erros, 'avisos': avisos, 'paginas': len(conteudo)}, ensure_ascii=False, indent=2))
        return 1 if erros else 0

    print(f'Wiki: {len(conteudo)} paginas de conteudo (+ {len(IGNORAR)} estruturais)')
    print(f'Wikilinks de entrada: {sum(entradas.values())} | densidade: {sum(entradas.values())/max(1,len(conteudo)):.1f} por pagina')
    print()
    if erros:
        print(f'ERROS ({len(erros)}):')
        for e in erros:
            print(f'  X {e}')
        print()
    if avisos:
        print(f'AVISOS ({len(avisos)}):')
        for a in avisos:
            print(f'  ! {a}')
        print()
    if not erros and not avisos:
        print('Nenhum problema encontrado.')
    return 1 if erros else 0


if __name__ == '__main__':
    sys.exit(main())
