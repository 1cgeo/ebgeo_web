// Path: tests/unit/menu-de-clipboard-por-estado.test.js
// QUAL COMANDO DE COPIAR/COLAR O MENU DO MAPA OFERECE, e para quem.
//
// Irmão de `aba-mapas-acoes-por-estado.test.js`, e pelo mesmo motivo: a pergunta "o que ESTA
// pessoa vê" só se respondia lendo `context-menu.control.js`, que importa o barril `@store`,
// MapLibre e o despachante de GeoJSON, e portanto não carrega no ambiente node puro desta
// suíte. Aqui são cinco entradas simples e uma lista devolvida.
//
// ================= O DEFEITO QUE ELE FECHA ===================================
//
// `_addDefaultOptions` olhava `hasSelected` e `locked` e NENHUMA permissão. Um Leitor num
// atlas remoto recebia "Duplicar Seleção", que é `copy()` + `paste()`, que chega em
// `addFeatures`, cujo `guardWrite(CREATE_FEATURE)` devolve `undefined` em silêncio. Ninguém
// lia esse retorno: a colagem seguia para `updateMapSources`, `autoSelectPastedFeatures` e um
// toast de SUCESSO, ao lado do toast de recusa que `store-error-listener.js` mostrava. No F5
// as feições sumiam. "Colar Aqui" seria uma segunda porta para o mesmo defeito, e é por isso
// que os dois gates são decididos JUNTOS, nesta tabela, e não um em cada sítio de desenho.
//
// ================= O QUE ESTE ARQUIVO PROVA, E O QUE NÃO ======================
//
// Ele mede a DECISÃO. Que `context-menu.control.js` de fato consulte esta tabela, e que o
// item bloqueado saia com `aria-disabled` e sem `disabled`, é do Playwright
// (`colar-aqui-por-papel-e-por-estado.spec.js`); um verde aqui com o menu ignorando a tabela
// continua verde. O caso CONTROLE abaixo é o que impede a armadilha simétrica: uma tabela que
// escondesse TUDO passaria em todas as asserções de ausência.

import { describe, it, expect } from 'vitest';
import {
    ClipboardMenuAction,
    CLIPBOARD_MENU_CAPABILITY,
    clipboardMenuActions,
} from '../../src/js/context-menu/clipboard-menu-actions.js';
import { LOCKED_MAP_NOTICE } from '../../src/js/sidebar/tabs/map-menu-actions.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUncopyableFeatureType } from '../../src/js/store/store.constants.js';

/** Predicate that allows everything (an Editor and up, for CREATE_FEATURE). */
const podeTudo = () => true;
/** Predicate that allows nothing (a Leitor). */
const naoPodeNada = () => false;

/** Ids of the returned commands, in order. */
const ids = (list) => list.map((c) => c.id);

/** The single returned command with this id, or undefined. */
const acao = (list, id) => list.find((c) => c.id === id);

/** A selection of two features, one feature under the cursor, one item on the clipboard. */
const CONTEXTO_CHEIO = {
    can: podeTudo,
    locked: false,
    selectedCount: 2,
    hasFeatureUnderCursor: true,
    clipboardCount: 1,
};

// ============================================================================
// A TABELA
// ============================================================================

describe('CLIPBOARD_MENU_CAPABILITY', () => {
    it('gateia SÓ os dois comandos que escrevem, e os dois pela mesma chave', () => {
        // Copiar preenche um clipboard em memória e não toca a store: gatear por posto
        // recusaria uma capacidade que a pessoa comprovadamente tem (um Leitor pode copiar de
        // um atlas que só lê e colar no atlas local dele).
        expect(CLIPBOARD_MENU_CAPABILITY[ClipboardMenuAction.COPY_SELECTION]).toBeUndefined();
        expect(CLIPBOARD_MENU_CAPABILITY[ClipboardMenuAction.COPY_UNDER_CURSOR]).toBeUndefined();

        // As duas escritas pedem a MESMA chave, que é a que a store consulta lá adiante
        // (`addFeatures` → `guardWrite(CREATE_FEATURE)`). Um gate de cliente mais fino que o
        // da store só consegue recusar trabalho que a store aceitaria.
        expect(CLIPBOARD_MENU_CAPABILITY[ClipboardMenuAction.PASTE_HERE]).toBe('CREATE_FEATURE');
        expect(CLIPBOARD_MENU_CAPABILITY[ClipboardMenuAction.DUPLICATE_SELECTION]).toBe('CREATE_FEATURE');
    });

    it('é congelada, porque uma tabela de gate que se pode reescrever em runtime não é gate', () => {
        expect(Object.isFrozen(CLIPBOARD_MENU_CAPABILITY)).toBe(true);
        expect(Object.isFrozen(ClipboardMenuAction)).toBe(true);
    });
});

// ============================================================================
// POSTO: o comando SOME
// ============================================================================

describe('clipboardMenuActions — posto', () => {
    it('um Leitor NÃO recebe "Colar Aqui" nem "Duplicar Seleção"', () => {
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, can: naoPodeNada });

        expect(acao(lista, ClipboardMenuAction.PASTE_HERE)).toBeUndefined();
        expect(acao(lista, ClipboardMenuAction.DUPLICATE_SELECTION)).toBeUndefined();
    });

    it('...e CONTINUA recebendo copiar, que não escreve nada', () => {
        // O controle negativo do caso acima: sem ele, uma tabela que escondesse tudo passaria.
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, can: naoPodeNada });
        expect(ids(lista)).toEqual([ClipboardMenuAction.COPY_SELECTION]);
    });

    it('CONTROLE: um Editor recebe os quatro comandos disponíveis no contexto', () => {
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, selectedCount: 0 });
        expect(ids(lista)).toEqual([
            ClipboardMenuAction.COPY_UNDER_CURSOR,
            ClipboardMenuAction.PASTE_HERE,
        ]);

        const comSelecao = clipboardMenuActions(CONTEXTO_CHEIO);
        expect(ids(comSelecao)).toEqual([
            ClipboardMenuAction.DUPLICATE_SELECTION,
            ClipboardMenuAction.COPY_SELECTION,
            ClipboardMenuAction.PASTE_HERE,
        ]);
    });

    it('FALHA FECHADA: um preditor que LANÇA esconde o comando, não o oferece', () => {
        const lista = clipboardMenuActions({
            ...CONTEXTO_CHEIO,
            can: () => { throw new Error('sessão ainda hidratando'); },
        });
        expect(acao(lista, ClipboardMenuAction.PASTE_HERE)).toBeUndefined();
        expect(acao(lista, ClipboardMenuAction.DUPLICATE_SELECTION)).toBeUndefined();
        expect(acao(lista, ClipboardMenuAction.COPY_SELECTION)).toBeDefined();
    });

    it('FALHA FECHADA: um preditor que devolve algo que não é `true` também esconde', () => {
        // `checkPermission(...).allowed` pode ser `undefined` num duplo mal montado, e
        // `undefined` é falsy mas `!== false`: comparar por igualdade estrita é o que faz o
        // gate recusar em vez de conceder por acidente.
        for (const resposta of [undefined, null, 1, 'sim', {}]) {
            const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, can: () => resposta });
            expect(acao(lista, ClipboardMenuAction.PASTE_HERE)).toBeUndefined();
        }
    });

    it('pergunta ao preditor com a chave de GuardAction, não com o id do comando', () => {
        const perguntas = [];
        clipboardMenuActions({
            ...CONTEXTO_CHEIO,
            can: (chave) => { perguntas.push(chave); return true; },
        });
        expect(perguntas).toEqual(['CREATE_FEATURE', 'CREATE_FEATURE']);
    });

    it('NÃO consulta o preditor para copiar (nem uma vez)', () => {
        const perguntas = [];
        clipboardMenuActions({
            can: (chave) => { perguntas.push(chave); return true; },
            selectedCount: 3,
            clipboardCount: 0,
        });
        // Só "Duplicar Seleção" está no contexto, e só ele pergunta.
        expect(perguntas).toEqual(['CREATE_FEATURE']);
    });
});

// ============================================================================
// ESTADO: o comando é desenhado e o CLIQUE recusa
// ============================================================================

describe('clipboardMenuActions — estado (mapa travado)', () => {
    it('mapa travado DESENHA "Colar Aqui" e "Duplicar", com a frase do estado', () => {
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, locked: true });

        expect(acao(lista, ClipboardMenuAction.PASTE_HERE).blocked).toBe(LOCKED_MAP_NOTICE);
        expect(acao(lista, ClipboardMenuAction.DUPLICATE_SELECTION).blocked).toBe(LOCKED_MAP_NOTICE);
    });

    it('a frase é A MESMA do menu de mapa, e não uma quarta cópia dela', () => {
        // Asserção ABSOLUTA além da igualdade importada: duas cópias erradas do mesmo jeito
        // passariam por uma comparação sozinha.
        expect(LOCKED_MAP_NOTICE).toBe('Este mapa está bloqueado. Destrave-o para fazer esta alteração.');
    });

    it('copiar NÃO é bloqueado pela trava: um mapa travado é somente-leitura, e copiar lê', () => {
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, locked: true });
        expect(acao(lista, ClipboardMenuAction.COPY_SELECTION).blocked).toBeNull();

        const semSelecao = clipboardMenuActions({ ...CONTEXTO_CHEIO, locked: true, selectedCount: 0 });
        expect(acao(semSelecao, ClipboardMenuAction.COPY_UNDER_CURSOR).blocked).toBeNull();
    });

    it('CONTROLE: destravado, nenhum comando carrega frase', () => {
        const lista = clipboardMenuActions(CONTEXTO_CHEIO);
        expect(lista.every((c) => c.blocked === null)).toBe(true);
        expect(lista.length).toBeGreaterThan(0);
    });

    it('POSTO VENCE ESTADO: um Leitor num mapa travado não recebe o comando nem bloqueado', () => {
        // A ordem importa: bloquear antes de esconder mostraria ao Leitor uma linha que fala
        // do cadeado quando o problema dele é outro, e que continuaria lá depois de destravado.
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, can: naoPodeNada, locked: true });
        expect(acao(lista, ClipboardMenuAction.PASTE_HERE)).toBeUndefined();
        expect(acao(lista, ClipboardMenuAction.DUPLICATE_SELECTION)).toBeUndefined();
    });
});

// ============================================================================
// CONTEXTO: o que não tem sobre o que agir fica AUSENTE
// ============================================================================

describe('clipboardMenuActions — contexto', () => {
    it('clipboard vazio não oferece "Colar Aqui"', () => {
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, clipboardCount: 0 });
        expect(acao(lista, ClipboardMenuAction.PASTE_HERE)).toBeUndefined();
    });

    it('sem seleção não oferece "Copiar Feições" nem "Duplicar Seleção"', () => {
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, selectedCount: 0 });
        expect(acao(lista, ClipboardMenuAction.COPY_SELECTION)).toBeUndefined();
        expect(acao(lista, ClipboardMenuAction.DUPLICATE_SELECTION)).toBeUndefined();
    });

    it('seleção e cursor são EXCLUSIVOS: nunca os dois copiares ao mesmo tempo', () => {
        const comSelecao = clipboardMenuActions(CONTEXTO_CHEIO);
        expect(acao(comSelecao, ClipboardMenuAction.COPY_SELECTION)).toBeDefined();
        expect(acao(comSelecao, ClipboardMenuAction.COPY_UNDER_CURSOR)).toBeUndefined();

        const semSelecao = clipboardMenuActions({ ...CONTEXTO_CHEIO, selectedCount: 0 });
        expect(acao(semSelecao, ClipboardMenuAction.COPY_SELECTION)).toBeUndefined();
        expect(acao(semSelecao, ClipboardMenuAction.COPY_UNDER_CURSOR)).toBeDefined();
    });

    it('sem seleção E sem feição sob o cursor, nenhum copiar aparece', () => {
        const lista = clipboardMenuActions({
            ...CONTEXTO_CHEIO,
            selectedCount: 0,
            hasFeatureUnderCursor: false,
        });
        expect(ids(lista)).toEqual([ClipboardMenuAction.PASTE_HERE]);
    });

    it('o contexto totalmente vazio devolve lista vazia (nada em que agir)', () => {
        expect(clipboardMenuActions({ can: podeTudo })).toEqual([]);
        expect(clipboardMenuActions()).toEqual([]);
    });
});

// ============================================================================
// A CONTAGEM QUE O RÓTULO MOSTRA
// ============================================================================

describe('clipboardMenuActions — contagem', () => {
    it('"Copiar Feições" propaga a contagem da SELEÇÃO', () => {
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, selectedCount: 7 });
        expect(acao(lista, ClipboardMenuAction.COPY_SELECTION).count).toBe(7);
    });

    it('"Colar Aqui" propaga a contagem do CLIPBOARD, que é outra coisa', () => {
        // Trocar as duas é o erro barato: com 7 selecionadas e 2 copiadas o rótulo diria
        // "Colar Aqui (7)" e colaria duas.
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, selectedCount: 7, clipboardCount: 2 });
        expect(acao(lista, ClipboardMenuAction.PASTE_HERE).count).toBe(2);
        expect(acao(lista, ClipboardMenuAction.COPY_SELECTION).count).toBe(7);
    });

    it('os comandos sem número no rótulo trazem `count` nulo, não zero', () => {
        // Zero seria indistinguível de "não há nada", e o desenho renderizaria "(0)".
        const lista = clipboardMenuActions({ ...CONTEXTO_CHEIO, selectedCount: 0 });
        expect(acao(lista, ClipboardMenuAction.COPY_UNDER_CURSOR).count).toBeNull();

        const comSelecao = clipboardMenuActions(CONTEXTO_CHEIO);
        expect(acao(comSelecao, ClipboardMenuAction.DUPLICATE_SELECTION).count).toBeNull();
    });

    it('devolve um array NOVO a cada chamada (o chamador o consome por Map)', () => {
        const a = clipboardMenuActions(CONTEXTO_CHEIO);
        const b = clipboardMenuActions(CONTEXTO_CHEIO);
        expect(a).not.toBe(b);
        expect(a).toEqual(b);
    });
});

// ============================================================================
// O GATE DE "Copiar Feição", QUE NÃO É DESTA TABELA
// ============================================================================
//
// A tabela acima decide se o COMANDO existe; quem decide se há uma feição copiável sob o
// cursor é `_findCopiableHitUnderCursor`, em `context-menu.control.js`. Ele merece caso
// próprio porque errou de um jeito que nenhuma asserção sobre a tabela pegaria: o gate era
// `clipboardManager.filterCopiableFeatures([target])`, SÍNCRONO, e esse filtro procura a
// ferramenta em `selectionManager.controls`, onde só as SEIS ansiosas estão antes do primeiro
// clique. Botão direito sobre círculo, retângulo, setor, seta, divisa ou símbolo militar não
// oferecia "Copiar Feição" e não dizia por quê, e o item voltava um clique depois, quando
// outra coisa tivesse carregado a ferramenta. Isso se lê como menu quebrado, não como regra.
//
// O QUE ESTE BLOCO PROVA, E COMO. A metade de baixo é comportamento puro sobre o registro de
// tipos: os seis tipos tardios são copiáveis POR TIPO, então o predicado que sobrou no gate
// os aceita. A metade de cima é estrutural, e é a única forma de alcançar aquele arquivo
// daqui: ele importa o barril `@store`, MapLibre e o despachante, e não carrega em node puro.
// Ela lê o CORPO da função e cobra a ausência da chamada síncrona. Reverter o conserto (voltar
// a `filterCopiableFeatures`) deixa a metade de cima vermelha; o controle negativo foi rodado.

const RAIZ_FRONTEND = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..');

/** O corpo de `_findCopiableHitUnderCursor`, sem o JSDoc que o precede. */
function corpoDoGateDeCursor() {
    const linhas = readFileSync(
        resolvePath(RAIZ_FRONTEND, 'src/js/context-menu/context-menu.control.js'),
        'utf8',
    // CRLF neste repositório: parte-se no LF e tira-se o CR que sobra.
    ).split(String.fromCharCode(10))
        .map((l) => (l.endsWith(String.fromCharCode(13)) ? l.slice(0, -1) : l));

    const abre = linhas.findIndex((l) => l.includes('_findCopiableHitUnderCursor(selection) {'));
    if (abre < 0) return null;
    // O método fecha na primeira linha que seja exatamente `    }`, a indentação de fechamento
    // de método de classe. Um `}` mais fundo (o de um `if`) traz mais espaços e não casa.
    const fecha = linhas.findIndex((l, i) => i > abre && l === '    }');
    if (fecha < 0) return null;
    return linhas.slice(abre, fecha + 1).join(String.fromCharCode(10));
}

describe('gate de "Copiar Feição" sob o cursor', () => {
    it('o corpo da função existe e é encontrável (senão as asserções abaixo seriam vazias)', () => {
        const corpo = corpoDoGateDeCursor();
        expect(corpo, 'não achei `_findCopiableHitUnderCursor` em context-menu.control.js').toBeTruthy();
        // Cobertura vazia passa verde: sem esta âncora, um `expect(corpo).not.toContain(...)`
        // sobre string vazia passaria com a função renomeada ou apagada.
        expect(corpo).toContain('getClickedCustomFeature');
    });

    it('NÃO consulta `filterCopiableFeatures`, que exige a ferramenta já carregada', () => {
        expect(corpoDoGateDeCursor()).not.toContain('filterCopiableFeatures');
    });

    it('gateia pelo TIPO, que é o que se sabe sem carregar ferramenta nenhuma', () => {
        expect(corpoDoGateDeCursor()).toContain('isUncopyableFeatureType');
    });

    it('os seis tipos de ferramenta TARDIA passam pelo predicado que sobrou', () => {
        // Os mesmos seis do defeito. Se um deles virasse não-copiável no registro, este caso
        // fica vermelho e a frase do `fileoverview` do controle precisa mudar junto.
        for (const tipo of ['circle', 'rectangle', 'sector', 'arrow', 'boundary', 'military_symbol']) {
            expect(isUncopyableFeatureType(tipo), `${tipo} deixou de ser copiável`).toBe(false);
        }
    });

    it('e o predicado ainda RECUSA alguém, senão ele não estaria discriminando nada', () => {
        // Os dois únicos do registro (`row.copiable === false`): visada e visibilidade são
        // SAÍDAS de análise, refeitas a partir da entrada, e copiá-las produziria um desenho
        // órfão da conta que o gerou.
        expect(isUncopyableFeatureType('los')).toBe(true);
        expect(isUncopyableFeatureType('visibility')).toBe(true);
    });
});
