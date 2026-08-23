// Path: tests/unit/aviso-de-retirada-de-acesso.test.js
//
// AS TRÊS ESCRITAS QUE TIRAM UM RECURSO DE OUTRAS PESSOAS: o texto que elas dizem antes, e
// a estrutura que garante que elas perguntam.
//
// O BURACO QUE ESTE ARQUIVO FECHA foi medido: `_toggle360Access` e o `<select>` de acesso da
// aba Catálogo chamavam `apiClient.setResourceVisibility` direto, e `_addLending` /
// `_removeLending` chamavam as rotas de empréstimo direto. `grep showConfirm` em
// `atlas-settings.modal.js` devolvia ZERO, na mesma tela em que retirar um empréstimo tira o
// recurso de todos os participantes do atlas. As três terminavam num toast genérico.
//
// SÃO DUAS ASSERÇÕES DE NATUREZAS DIFERENTES, como em `aviso-de-perda-de-recursos.test.js`:
//   1. UNIDADE: as frases puras de `js/catalog/visibility-phrases.js`, nos DOIS sentidos
//      (destrutivo e aditivo) e com zero, um e vários. O sentido é o produto principal:
//      `visibilityChangeWarning` devolve `null` no aditivo, e é esse `null` que impede a
//      tela de pedir confirmação para tornar público.
//   2. ESTRUTURA: os três chamadores destrutivos consomem as frases e pedem confirmação
//      ANTES da escrita, e os dois caminhos aditivos NÃO pedem. A segunda metade importa
//      tanto quanto a primeira: uma confirmação em toda ação treina o operador a clicar sem
//      ler, e aí o aviso deixa de proteger o caso que ele existe para proteger.
//
// A VARREDURA ESTRUTURAL RODA SOBRE CÓDIGO, NUNCA SOBRE PROSA. Este repositório já teve duas
// vezes um guarda que ficou verde porque um COMENTÁRIO citava o símbolo que a chamada tinha
// perdido, então a fonte passa por um removedor de comentários ciente de literal de string, e
// o caso `CONTROLE` prova o par: continua vendo o código, deixou de ver a prosa.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
    toCount,
    resourceCountLabel,
    visibilityChangeWarning,
    visibilityChangeSummary,
    lendingRemovalWarning,
    lendingSummary,
    lendingScopeNote,
} from '../../src/js/catalog/visibility-phrases.js';

const URL_CATALOG_TAB = new URL('../../src/js/admin/catalog-tab.js', import.meta.url);
const URL_ATLAS_SETTINGS = new URL('../../src/js/modals/atlas-settings.modal.js', import.meta.url);

// ============================================================================
// (1) A UNIDADE: as frases
// ============================================================================

describe('`visibilityChangeWarning`: pergunta no destrutivo e cala no aditivo', () => {
    it('DESTRUTIVO: tornar privado nomeia o item, o tipo e quem continua vendo', () => {
        const texto = visibilityChangeWarning('private', { nome: 'Cidade 3D', tipoRotulo: '3D (modelos)' });

        expect(texto).toContain('"Cidade 3D"');
        expect(texto).toContain('(3D (modelos))');
        // A CONSEQUÊNCIA CONCRETA, que é o ponto do aviso: quem perde e quem fica.
        expect(texto).toContain('sai do catálogo');
        expect(texto).toContain('administradores');
        expect(texto).toContain('concessão');
        expect(texto).toContain('empreste');
        // DISCRIMINAÇÃO: a frase proibida pelo contrato de UX do lote.
        expect(texto).not.toContain('Tem certeza');
    });

    it('ADITIVO: tornar público devolve null, e o desconhecido também', () => {
        // É ESTE `null` que decide se o diálogo aparece. Um ramo aditivo que devolvesse
        // frase faria a tela confirmar uma ação que não tira nada de ninguém.
        expect(visibilityChangeWarning('public', { nome: 'Cidade 3D' })).toBeNull();
        expect(visibilityChangeWarning(undefined, { nome: 'Cidade 3D' })).toBeNull();
        expect(visibilityChangeWarning('', {})).toBeNull();
        expect(visibilityChangeWarning('nivel-que-nao-existe', { nome: 'X' })).toBeNull();
    });

    it('SUJO: sem nome e sem tipo a frase continua legível, sem aspas vazias', () => {
        const texto = visibilityChangeWarning('private', { nome: '   ', tipoRotulo: '  ' });
        expect(texto.startsWith('este recurso sai do catálogo')).toBe(true);
        expect(texto).not.toContain('""');
        expect(texto).not.toContain('()');
    });

    it('NÃO INVENTA NÚMERO: nenhuma quantidade de pessoas aparece no aviso', () => {
        // A audiência que perde o acesso é o COMPLEMENTO de um conjunto que nenhuma resposta
        // do servidor enumera (ver o `@fileoverview` do módulo). Um número aqui seria
        // estimativa apresentada como fato.
        //
        // O nome e o rótulo do caso são DIGIT-FREE de propósito: o próprio catálogo tem
        // "Cidade 3D" e "Imagens 360°", e a varredura por dígito acusaria o dado de entrada
        // em vez do texto que este teste vigia.
        const texto = visibilityChangeWarning('private', { nome: 'Carta Topográfica', tipoRotulo: 'Dados' });
        expect(texto).not.toMatch(/\d/);
        expect(texto).not.toContain('pessoas');
    });
});

describe('`visibilityChangeSummary`: o toast relata o efeito, não o sucesso', () => {
    it('os dois sentidos dizem coisas diferentes e nenhum diz "Sucesso"', () => {
        const privado = visibilityChangeSummary({ nome: 'Cidade 3D', accessLevel: 'private' });
        const publico = visibilityChangeSummary({ nome: 'Cidade 3D', accessLevel: 'public' });

        expect(privado).toBe('"Cidade 3D" agora é privado: saiu do catálogo de quem não tem acesso próprio.');
        expect(publico).toBe('"Cidade 3D" agora é público: qualquer pessoa passa a vê-lo no catálogo.');
        expect(privado).not.toBe(publico);
        for (const frase of [privado, publico]) {
            expect(frase).not.toContain('Sucesso');
        }
    });

    it('SUJO: nível ausente cai no ramo aditivo, que é o que não afirma perda', () => {
        // O ramo default precisa ser o INÓCUO: anunciar "saiu do catálogo" por causa de um
        // campo ausente seria o aviso mentindo na direção que assusta sem motivo.
        expect(visibilityChangeSummary({ nome: 'X' })).toContain('agora é público');
        expect(visibilityChangeSummary()).toBe('este recurso agora é público: qualquer pessoa passa a vê-lo no catálogo.');
    });
});

describe('empréstimo: o aviso da retirada e os dois toasts', () => {
    it('DESTRUTIVO: a retirada nomeia TODOS os participantes e o link público', () => {
        const texto = lendingRemovalWarning({ nome: 'Panorâmicas do Quartel', tipoRotulo: 'Imagens 360°' });

        expect(texto).toContain('"Panorâmicas do Quartel"');
        expect(texto).toContain('(Imagens 360°)');
        expect(texto).toContain('TODOS os participantes deste atlas');
        // A PARTE QUE NINGUÉM DEDUZ: o visitante de link público também recebe o empréstimo.
        expect(texto).toContain('link público');
        // E a reversibilidade, que é o que mantém o aviso proporcional.
        expect(texto).toContain('emprestar de novo');
        expect(texto).not.toContain('Tem certeza');
        // Mesma regra do outro eixo: sem audiência conhecida, sem número. O caso digit-free
        // é medido à parte, senão o "360" do rótulo acusaria a entrada e não a frase.
        expect(lendingRemovalWarning({ nome: 'Carta Topográfica', tipoRotulo: 'Camadas base' }))
            .not.toMatch(/\d/);
    });

    it('ADITIVO e DESTRUTIVO: os dois toasts contam efeitos opostos', () => {
        const anexo = lendingSummary({ nome: 'Carta Topográfica', acao: 'add' });
        const retirada = lendingSummary({ nome: 'Carta Topográfica', acao: 'remove' });

        expect(anexo).toBe('"Carta Topográfica" emprestado: quem abrir este atlas passa a enxergá-lo.');
        expect(retirada).toBe('Empréstimo de "Carta Topográfica" retirado: quem dependia deste atlas '
            + 'para vê-lo deixa de enxergá-lo.');
        // O toast antigo era "Empréstimo retirado.", que descreve a linha do banco e não o
        // efeito. A asserção que prende a diferença é a menção a quem deixa de ver.
        expect(retirada).toContain('deixa de enxergá-lo');
        expect(anexo).not.toContain('deixa de');
    });

    it('SUJO: ação desconhecida cai no ramo ADITIVO, que é o inócuo', () => {
        expect(lendingSummary({ nome: 'X' })).toContain('emprestado');
        expect(lendingSummary()).toContain('este recurso');
    });
});

describe('`lendingScopeNote`: zero, um e vários, e o escopo em todos', () => {
    it('ZERO: diz que não empresta nada, sem imprimir "0 recursos"', () => {
        const texto = lendingScopeNote(0);
        expect(texto.startsWith('Este atlas não empresta nenhum recurso hoje.')).toBe(true);
        expect(texto).not.toContain('0 recurso');
    });

    it('UM e VÁRIOS: o plural concorda com o número', () => {
        expect(lendingScopeNote(1)).toContain('Este atlas empresta 1 recurso.');
        expect(lendingScopeNote(4)).toContain('Este atlas empresta 4 recursos.');
        // Fronteira do plural nos dois lados do 1.
        expect(lendingScopeNote(2)).toContain('2 recursos');
    });

    it('O ESCOPO APARECE NOS TRÊS CASOS: é a frase que o selo "Privado" não conta', () => {
        const casos = [0, 1, 7];
        expect(casos, 'o laço de escopo ficou vazio e passaria verde sem verificar nada').toHaveLength(3);
        for (const n of casos) {
            const texto = lendingScopeNote(n);
            expect(texto, `escopo ausente para ${n}`).toContain('SÓ dentro deste atlas');
            expect(texto, `consequência da troca de atlas ausente para ${n}`)
                .toContain('ao abrir outro atlas');
        }
    });

    it('SUJO: contagem que chega como string, nula ou absurda não vira "NaN recursos"', () => {
        // O `COUNT` de node-postgres chega como STRING, e é a razão de `toCount` existir dos
        // dois lados (aqui e em `js/admin/group-phrases.js`).
        expect(toCount('3')).toBe(3);
        expect(toCount(1.9)).toBe(1);
        for (const lixo of [null, undefined, NaN, -5, 'abc', Infinity]) {
            expect(toCount(lixo), `toCount(${String(lixo)})`).toBe(0);
        }
        expect(resourceCountLabel('1')).toBe('1 recurso');
        expect(resourceCountLabel('2')).toBe('2 recursos');
        expect(resourceCountLabel(null)).toBe('nenhum recurso');
        expect(lendingScopeNote('2')).toContain('2 recursos');
        expect(lendingScopeNote(undefined)).toContain('não empresta nenhum recurso');
    });
});

// ============================================================================
// (2) A ESTRUTURA: quem pergunta, quem não pergunta, e a ordem
// ============================================================================

/**
 * Strips JS comments, walking string literals so a `//` inside a string survives.
 *
 * With `esvaziarStrings`, every character of a literal's BODY becomes a space and the
 * delimiters stay, which keeps the output the SAME LENGTH as the plain pass. That is what
 * lets the brace matcher run over a view where no brace can hide inside a string while the
 * offsets still address the view that kept the strings.
 *
 * @param {string} fonte
 * @param {boolean} [esvaziarStrings=false]
 * @returns {string}
 */
function semComentarios(fonte, esvaziarStrings = false) {
    let saida = '';
    let i = 0;
    while (i < fonte.length) {
        const atual = fonte[i];
        const proximo = fonte[i + 1];
        if (atual === '/' && proximo === '/') {
            while (i < fonte.length && fonte[i] !== '\n') i++;
            continue;
        }
        if (atual === '/' && proximo === '*') {
            i += 2;
            while (i < fonte.length && !(fonte[i] === '*' && fonte[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (atual === '"' || atual === "'" || atual === '`') {
            saida += atual;
            i++;
            while (i < fonte.length) {
                if (fonte[i] === '\\') {
                    saida += esvaziarStrings ? '  ' : fonte[i] + (fonte[i + 1] ?? '');
                    i += 2;
                    continue;
                }
                const fechou = fonte[i] === atual;
                saida += (esvaziarStrings && !fechou) ? ' ' : fonte[i];
                i++;
                if (fechou) break;
            }
            continue;
        }
        saida += atual;
        i++;
    }
    return saida;
}

/**
 * Brace-matched body of the function that follows `ancora`, as a [start, end) index pair on
 * the comment-stripped source. Matching runs on the string-blanked view.
 *
 * @param {string} semStr - comment-stripped, string-blanked source
 * @param {string} ancora
 * @returns {{ini: number, fim: number}|null}
 */
function faixaDoCorpo(semStr, ancora) {
    const declaracao = semStr.indexOf(ancora);
    if (declaracao === -1) return null;
    const abre = semStr.indexOf('{', declaracao);
    if (abre === -1) return null;
    let nivel = 0;
    for (let j = abre; j < semStr.length; j++) {
        if (semStr[j] === '{') {
            nivel++;
        } else if (semStr[j] === '}') {
            nivel--;
            if (nivel === 0) return { ini: abre, fim: j + 1 };
        }
    }
    return null;
}

/**
 * The comment-stripped body of one method/function, already checked for not being a stub.
 * @param {URL} url @param {string} ancora @param {number} piso
 * @returns {string}
 */
function corpoDe(url, ancora, piso = 200) {
    const bruto = readFileSync(url, 'utf8');
    const faixa = faixaDoCorpo(semComentarios(bruto, true), ancora);
    expect(faixa, `a âncora "${ancora}" não casou`).not.toBeNull();
    const corpo = semComentarios(bruto).slice(faixa.ini, faixa.fim);
    // PISO: o recorte é o corpo inteiro, e não um toco que passaria vazio.
    expect(corpo.length, `o corpo de "${ancora}" veio curto demais`).toBeGreaterThan(piso);
    expect(corpo.endsWith('}')).toBe(true);
    return corpo;
}

/** Os três caminhos DESTRUTIVOS, com a chamada de rede que não pode preceder a pergunta. */
const DESTRUTIVOS = [
    {
        nome: '360: `_toggle360Access` (aba Catálogo)',
        url: URL_CATALOG_TAB,
        ancora: 'async _toggle360Access(',
        frase: 'visibilityChangeWarning(',
        escrita: 'apiClient.setResourceVisibility(',
        aborta: true,
    },
    {
        nome: 'catálogo: o `<select>` de acesso no Salvar (`onSave`)',
        url: URL_CATALOG_TAB,
        ancora: 'const onSave = async () =>',
        frase: 'visibilityChangeWarning(',
        // A PRIMEIRA escrita do formulário, e não a de visibilidade: perguntar depois de
        // gravar o item seria perguntar sobre um ato já consumado pela metade.
        escrita: 'apiClient.updateResource(',
        // O ÚNICO dos três que NÃO aborta a rotina inteira no "Cancelar": ele devolve o
        // `<select>` ao valor de partida e salva o resto do formulário. Ver o comentário no
        // próprio `onSave`.
        aborta: false,
        recuo: 'accessInput.value = accessBefore',
    },
    {
        nome: 'empréstimo: `_removeLending` (configurações do atlas)',
        url: URL_ATLAS_SETTINGS,
        ancora: 'async _removeLending(',
        frase: 'lendingRemovalWarning(',
        escrita: 'apiClient.removeAtlasResource(',
        aborta: true,
    },
];

/** Os dois caminhos ADITIVOS, que NÃO podem pedir confirmação. */
const ADITIVOS = [
    { nome: 'empréstimo: `_addLending`', url: URL_ATLAS_SETTINGS, ancora: 'async _addLending(' },
];

describe('ESTRUTURAL: as três escritas destrutivas avisam antes de escrever', () => {
    it('CONTROLE: o removedor de comentários enxerga o CÓDIGO e deixou de enxergar a PROSA', () => {
        // O PAR DE CONTROLE que a constituição exige de qualquer guarda que varra texto: sem
        // ele, um comentário citando `showConfirm` manteria os casos abaixo verdes depois de
        // a chamada real sumir.
        const controles = [
            {
                nome: 'catalog-tab',
                url: URL_CATALOG_TAB,
                prosa: 'OS TRÊS EIXOS DESTA ABA',
                codigo: 'apiClient.setResourceVisibility(',
            },
            {
                nome: 'atlas-settings',
                url: URL_ATLAS_SETTINGS,
                prosa: 'DUAS EXCEÇÕES QUE ESTE ARQUIVO CARREGA',
                codigo: 'apiClient.removeAtlasResource(',
            },
        ];
        expect(controles, 'o laço de controle ficou vazio').toHaveLength(2);
        for (const caso of controles) {
            const bruto = readFileSync(caso.url, 'utf8');
            const limpo = semComentarios(bruto);
            expect(bruto, `${caso.nome}: a prosa de controle sumiu do arquivo`).toContain(caso.prosa);
            expect(limpo, `${caso.nome}: a PROSA sobreviveu à remoção de comentários`)
                .not.toContain(caso.prosa);
            expect(limpo, `${caso.nome}: a remoção de comentários comeu CÓDIGO`).toContain(caso.codigo);
        }

        // E o removedor não pode mexer no conteúdo de um literal de string.
        expect(semComentarios('const s = "a // b"; // fora\nconst t = `c /* d */`;'))
            .toBe('const s = "a // b"; \nconst t = `c /* d */`;');
        // A vista com strings em branco tem o MESMO comprimento, que é o que permite casar
        // os índices do casador de chaves com o texto que preservou as strings.
        const amostra = readFileSync(URL_ATLAS_SETTINGS, 'utf8');
        expect(semComentarios(amostra, true)).toHaveLength(semComentarios(amostra).length);
    });

    it.each(DESTRUTIVOS)('$nome monta a frase, confirma e só então escreve', (caso) => {
        const corpo = corpoDe(caso.url, caso.ancora);

        // 1. A frase vem do módulo puro, uma vez.
        expect(corpo.match(new RegExp(caso.frase.replace('(', '\\(').replace(')', '\\)'), 'g')),
            `nenhuma (ou mais de uma) chamada a \`${caso.frase}\` neste corpo`).toHaveLength(1);

        // 2. Ela é levada a um `showConfirm` DESTRUTIVO.
        const iConfirm = corpo.indexOf('showConfirm(');
        expect(iConfirm, 'nenhum `showConfirm(` neste corpo').toBeGreaterThan(-1);
        expect(corpo.slice(iConfirm), 'o diálogo não é o destrutivo (`destructive: true`)')
            .toContain('destructive: true');

        // 3. E a pergunta vem ANTES da escrita, com a frase montada antes da pergunta.
        const iEscrita = corpo.indexOf(caso.escrita);
        expect(iEscrita, `âncora de escrita "${caso.escrita}" não está neste corpo`).toBeGreaterThan(-1);
        expect(iConfirm, `o \`showConfirm\` só aparece DEPOIS de ${caso.escrita}`).toBeLessThan(iEscrita);
        // A frase precede a ESCRITA, e não necessariamente o `showConfirm`: dois dos três
        // caminhos a passam como argumento do próprio diálogo (`message:`), onde ela aparece
        // depois do nome da função. Exigir a ordem contra o `showConfirm` prenderia um estilo
        // de chamada, não a propriedade.
        expect(corpo.indexOf(caso.frase),
            `a frase de aviso é montada DEPOIS de ${caso.escrita}`).toBeLessThan(iEscrita);

        // 4. E o "Cancelar" tem efeito: ou aborta, ou desfaz a escolha destrutiva.
        if (caso.aborta) {
            const chamada = /const\s+(\w+)\s*=\s*await\s+showConfirm\s*\(/.exec(corpo);
            expect(chamada, 'nenhum `const x = await showConfirm(` neste corpo').not.toBeNull();
            const aborto = new RegExp(`if\\s*\\(\\s*!${chamada[1]}\\s*\\)\\s*return`).exec(corpo);
            expect(aborto, `a resposta de showConfirm ("${chamada[1]}") não tem um \`if (!x) return\``)
                .not.toBeNull();
            expect(aborto.index, 'o "Cancelar" só aborta DEPOIS da escrita').toBeLessThan(iEscrita);
        } else {
            expect(corpo, 'o "Cancelar" não devolve o controle ao valor de partida')
                .toContain(caso.recuo);
            expect(corpo.indexOf(caso.recuo)).toBeGreaterThan(iConfirm);
            expect(corpo.indexOf(caso.recuo)).toBeLessThan(iEscrita);
        }
    });

    it.each(ADITIVOS)('$nome NÃO pede confirmação: emprestar não tira nada de ninguém', (caso) => {
        const corpo = corpoDe(caso.url, caso.ancora);
        expect(corpo, 'o caminho aditivo ganhou uma confirmação, e confirmar tudo é não '
            + 'confirmar nada').not.toContain('showConfirm(');
        // CONTROLE POSITIVO: o recorte é mesmo o corpo da ação, e não um trecho vazio onde
        // qualquer `not.toContain` passaria.
        expect(corpo).toContain('apiClient.addAtlasResource(');
        expect(corpo).toContain('lendingSummary(');
    });

    it('o toast das três escritas vem do módulo puro, não de um "Sucesso" literal', () => {
        const catalogo = readFileSync(URL_CATALOG_TAB, 'utf8');
        const settings = readFileSync(URL_ATLAS_SETTINGS, 'utf8');

        expect(semComentarios(catalogo)).toContain('visibilityChangeSummary(');
        expect(semComentarios(settings)).toContain('lendingSummary(');
        // As frases que estavam ali antes e diziam a linha do banco em vez do efeito.
        expect(catalogo).not.toContain('Projeto 360° agora é privado.');
        expect(settings).not.toContain('Empréstimo retirado.');
        expect(settings).not.toContain('Recurso emprestado por este atlas.');
    });

    it('a seção de empréstimo diz na tela que o empréstimo vale só naquele atlas', () => {
        // A âncora leva o `) {` porque `_renderLendingPane` também aparece como CHAMADA
        // antes da declaração, e um `indexOf` solto recortaria o `catch` que vem depois dela.
        const corpo = corpoDe(URL_ATLAS_SETTINGS, '_renderLendingPane() {');
        expect(corpo, 'a nota de escopo saiu da seção').toContain('lendingScopeNote(');
        // Ela é escrita por `textContent`, nunca por innerHTML: o nome do recurso emprestado
        // é dado de outra pessoa.
        expect(corpo).toContain('textContent = lendingScopeNote(');
    });
});
