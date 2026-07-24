#!/usr/bin/env node
/**
 * Contador canônico dos três relatórios de auditoria.
 *
 * Existe porque contador ad-hoc erra em silêncio, e errou três vezes numa única
 * sessão: uma regex com `\w+` que não casa o acento de `## Severidade média` (77
 * itens somem para a seção anterior), e uma versão que checava o marcador
 * `CORRIGIDO` só no corpo, ignorando os achados que o trazem no TÍTULO
 * (`### 7. [CORRIGIDO — ver achado 28]`). As duas contagens pareciam plausíveis e
 * discordavam entre si; a segunda chegou a parecer perda de dado no arquivo.
 *
 * A regra, num lugar só: um item está feito se o marcador aparece no título OU
 * no corpo do bloco. Rode isto em vez de escrever o seu.
 *
 *   node scripts/auditoria-inventario.mjs [--json]
 */
import fs from 'fs';

const RELATORIOS = [
    ['bugs-backend.md', /^## (Crítico|Alto|Médio|Baixo)\s*$/],
    ['testes-backend.md', /^## (P\d[^\n]*)$/],
    ['documentacao-backend.md', /^## (Severidade .+?)\s*$/],
];

/** @returns {{n:number, secao:string, titulo:string, feito:boolean}[]} */
function inventariar(caminho, reSecao) {
    const linhas = fs.readFileSync(caminho, 'utf8').split(/\r?\n/);
    const itens = [];
    let secao = '(sem seção)';
    let atual = null;

    for (const linha of linhas) {
        const s = linha.match(reSecao);
        if (s) { secao = s[1].trim(); continue; }

        const h = linha.match(/^### (\d+)\.\s*(.*)$/);
        if (h) {
            if (atual) itens.push(atual);
            atual = { n: Number(h[1]), secao, titulo: h[2], corpo: '' };
            continue;
        }
        if (atual) atual.corpo += linha + '\n';
    }
    if (atual) itens.push(atual);

    return itens.map(({ n, secao, titulo, corpo }) => ({
        n,
        secao,
        titulo,
        // Título OU corpo: as duas formas existem no corpus e ignorar uma delas
        // foi exatamente o erro que motivou este arquivo.
        //
        // No corpo a marca é ANCORADA (`> **CORRIGIDO`), não a palavra solta: vários
        // blocos mencionam "CORRIGIDO" na própria evidência, ao se referir a um
        // achado irmão já fechado, e contá-los daria o item por feito sem que fosse.
        feito: /CORRIGIDO/.test(titulo) || /^\s*>\s*\*\*CORRIGIDO/m.test(corpo),
    }));
}

const json = process.argv.includes('--json');
const saida = {};

for (const [arquivo, re] of RELATORIOS) {
    if (!fs.existsSync(arquivo)) continue;
    const itens = inventariar(arquivo, re);
    const porSecao = {};
    for (const i of itens) {
        porSecao[i.secao] ??= { total: 0, feitos: 0 };
        porSecao[i.secao].total++;
        if (i.feito) porSecao[i.secao].feitos++;
    }
    saida[arquivo] = { itens, porSecao };

    if (!json) {
        const t = itens.length;
        const f = itens.filter((i) => i.feito).length;
        console.log(`\n=== ${arquivo} — ${t} itens, ${f} feitos, ${t - f} pendentes`);
        for (const [s, v] of Object.entries(porSecao)) {
            console.log(`   ${s.padEnd(22)} total=${String(v.total).padEnd(5)}feitos=${String(v.feitos).padEnd(5)}faltam=${v.total - v.feitos}`);
        }
    }
}

if (json) console.log(JSON.stringify(saida, null, 1));
