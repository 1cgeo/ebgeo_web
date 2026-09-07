// Path: tests/unit/substituir-atual-nomeia-a-perda.test.js

/**
 * @fileoverview Arrastar um `.ebgeo` para o mapa e escolher "Substituir Atual" ESVAZIA os dez
 * bancos de dado do atlas montado. O diálogo que pergunta isso tem de dizer.
 *
 * O QUE MOTIVOU. O modal do arrastar tinha duas frases ("Importar Atlas" / "Como deseja importar
 * este atlas?") e dois botões, nenhum deles chamado "Cancelar" (só clicar fora), nenhum marcado
 * como destrutivo, e nenhuma menção ao atlas montado nem ao que ele contém. O vizinho que faz
 * MENOS já perguntava melhor: "Limpar tudo" na aba Mapas nomeia o atlas, diz que NÃO pode ser
 * desfeito e marca a perda item a item. Num navegador que veio de uma versão anterior do produto o
 * atlas montado é o acervo inteiro da pessoa.
 *
 * O DIÁLOGO PASSOU A SER O DA CASA (`showChoice`, três ações rotuladas), e não mais um modal
 * próprio: ele já tem a marca destrutiva (`variant: 'danger'`), o foco no botão inerte, o Enter
 * deliberadamente morto no modo de N ações e o `data-testid` por escolha. Um segundo modal com as
 * mesmas responsabilidades era a segunda cópia dessas decisões.
 *
 * A ASSIMETRIA QUE O TEXTO PRECISA RESPEITAR, e que uma frase única faria mentir: num atlas de
 * SERVIDOR "Substituir Atual" NÃO apaga nada, porque o import não aditivo abre um atlas local NOVO
 * e deixa o do servidor intacto (`_prepareNonAdditiveTarget`). Anunciar destruição ali seria falso
 * alarme; anunciar preservação num atlas local seria o contrário, e é o que este arquivo impede.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@utils/toast_service.js', () => ({
    showError: vi.fn(),
    showWarning: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
}));

vi.mock('@store', () => ({
    isCurrentMapLockedSync: vi.fn(() => false),
}));

vi.mock('@modals/confirm.modal.js', () => ({
    showChoice: vi.fn(async () => null),
    showConfirm: vi.fn(async () => false),
}));

const { showChoice } = await import('@modals/confirm.modal.js');
const { default: DragDropHandler, importModeDialog } =
    await import('../../src/js/import_export/drag-drop.handler.js');

const CHEIO = { maps: 14, features: 805, images: 149 };

/** Um handler com os colaboradores dublados, igual ao da suíte de classificação. */
function makeHandler(alvo) {
    const handler = new DragDropHandler(
        { style: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), appendChild: vi.fn(),
            getBoundingClientRect: () => ({ left: 0, top: 0 }) },
        { deactivateCurrentTool: vi.fn() },
        { processFileDirectly: vi.fn() },
        { processFileDirectly: vi.fn() },
        { map: { unproject: vi.fn() }, addImageFeature: vi.fn() },
    );
    // A LEITURA DO ATLAS MONTADO É DUBLADA, e só ela: ela alcança o registro de atlas locais e o
    // IndexedDB do escopo montado, que é o que `tests/e2e-ui` prova no navegador. O que se mede
    // aqui é o que o diálogo DIZ com a resposta dela, e para onde cada botão resolve.
    handler.describeTarget = vi.fn(async () => alvo);
    return handler;
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ============================================================================
// A FRASE, pura
// ============================================================================

describe('o diálogo do arrastar, num atlas LOCAL', () => {
    const ALVO = { servidor: false, name: 'Meu Atlas', contents: CHEIO };

    it('nomeia o atlas e conta o que "Substituir Atual" apaga', () => {
        const { message } = importModeDialog(ALVO);
        expect(message).toContain('"Meu Atlas"');
        expect(message).toContain('14 mapas');
        expect(message).toContain('805 feições');
        expect(message).toContain('149 imagens');
        expect(message).toMatch(/NÃO pode ser desfeito/);
    });

    it('diz o que "Adicionar ao Atual" faz, que é a alternativa não destrutiva', () => {
        expect(importModeDialog(ALVO).message).toMatch(/Adicionar ao Atual/);
    });

    it('as três ações existem, na ordem do reversível ao destrutivo', () => {
        const { choices } = importModeDialog(ALVO);
        expect(choices.map((c) => c.id)).toEqual(['cancel', 'add', 'replace']);
        expect(choices.map((c) => c.label))
            .toEqual(['Cancelar', 'Adicionar ao Atual', 'Substituir Atual']);
    });

    it('"Substituir Atual" é a ÚNICA marcada como destrutiva, e "Cancelar" é a inerte', () => {
        const { choices } = importModeDialog(ALVO);
        const porId = Object.fromEntries(choices.map((c) => [c.id, c.variant]));
        expect(porId.replace).toBe('danger');
        expect(porId.cancel).toBe('ghost');
        expect(porId.add).toBe('primary');
        expect(choices.filter((c) => c.variant === 'danger')).toHaveLength(1);
    });

    it('atlas local VAZIO: continua avisando que substitui, sem inventar contagem', () => {
        const { message } = importModeDialog({ servidor: false, name: 'Novo', contents: null });
        expect(message).toContain('"Novo"');
        expect(message).toMatch(/NÃO pode ser desfeito/);
        expect(message).not.toMatch(/\d+ (mapas?|feiç|imagens?)/);
    });

    it('sem nome resolvido, não escreve "undefined"', () => {
        const { message } = importModeDialog({ servidor: false, name: null, contents: CHEIO });
        expect(message).not.toMatch(/undefined|null/);
        expect(message).toMatch(/NÃO pode ser desfeito/);
    });
});

describe('CONTROLE: num atlas de SERVIDOR o mesmo botão não apaga nada, e a frase muda', () => {
    // Sem este controle, uma frase que dissesse "apaga tudo" SEMPRE passaria no caso local sem
    // provar que ela é a frase certa, e mentiria no caso de servidor.
    const NO_SERVIDOR = { servidor: true, name: 'Operação Alfa', contents: null };

    it('não promete destruição, e diz para onde o arquivo vai', () => {
        const { message } = importModeDialog(NO_SERVIDOR);
        expect(message).not.toMatch(/NÃO pode ser desfeito/);
        expect(message).toMatch(/atlas local NOVO/);
        expect(message).toMatch(/continua intacto/);
    });

    it('e "Substituir Atual" deixa de ser destrutiva ali', () => {
        const porId = Object.fromEntries(
            importModeDialog(NO_SERVIDOR).choices.map((c) => [c.id, c.variant])
        );
        expect(porId.replace).not.toBe('danger');
        // "Cancelar" continua existindo nos dois: é ela que faltava.
        expect(porId.cancel).toBe('ghost');
    });
});

// ============================================================================
// A ESCOLHA: o que cada botão devolve ao chamador
// ============================================================================

describe('askImportMode: o id escolhido vira a decisão do import', () => {
    const CASOS = [
        ['replace', { cancelled: false, additive: false }],
        ['add', { cancelled: false, additive: true }],
        ['cancel', { cancelled: true }],
        // Dispensar (Esc, clique fora) resolve `null` no `showChoice`, e tem de ser inerte.
        [null, { cancelled: true }],
    ];

    it.each(CASOS)('escolha %s', async (id, esperado) => {
        showChoice.mockResolvedValueOnce(id);
        const handler = makeHandler({ servidor: false, name: 'Meu Atlas', contents: CHEIO });
        expect(await handler.askImportMode()).toEqual(esperado);
    });

    it('pergunta pelo diálogo da casa, com o título e as três ações', async () => {
        showChoice.mockResolvedValueOnce('cancel');
        const handler = makeHandler({ servidor: false, name: 'Meu Atlas', contents: CHEIO });
        await handler.askImportMode();

        expect(showChoice).toHaveBeenCalledTimes(1);
        const [titulo, opcoes] = showChoice.mock.calls[0];
        expect(titulo).toMatch(/Importar/);
        expect(opcoes.choices).toHaveLength(3);
        expect(opcoes.message).toContain('"Meu Atlas"');
        expect(opcoes.message).toContain('805 feições');
    });

    it('a leitura do atlas montado acontece ANTES da pergunta', async () => {
        // Perguntar primeiro e contar depois deixaria o diálogo sem os números na primeira vez.
        const ordem = [];
        showChoice.mockImplementationOnce(async () => { ordem.push('perguntar'); return 'cancel'; });
        const handler = makeHandler({ servidor: false, name: 'X', contents: CHEIO });
        handler.describeTarget = vi.fn(async () => {
            ordem.push('descrever');
            return { servidor: false, name: 'X', contents: CHEIO };
        });
        await handler.askImportMode();
        expect(ordem).toEqual(['descrever', 'perguntar']);
    });

    it('leitura do alvo que FALHA não trava o arrastar: pergunta mesmo assim', async () => {
        const erro = vi.spyOn(console, 'warn').mockImplementation(() => {});
        showChoice.mockResolvedValueOnce('cancel');
        const handler = makeHandler(null);
        handler.describeTarget = vi.fn(async () => { throw new Error('idb morreu'); });
        expect(await handler.askImportMode()).toEqual({ cancelled: true });
        expect(showChoice).toHaveBeenCalledTimes(1);
        erro.mockRestore();
    });
});

// ============================================================================
// CONTROLE: o modal próprio saiu, e com ele o caminho sem "Cancelar"
// ============================================================================

describe('o modal artesanal de dois botões não existe mais', () => {
    it('a classe que o desenhava não é mais construída pelo handler', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const fonte = readFileSync(
            fileURLToPath(new URL('../../src/js/import_export/drag-drop.handler.js', import.meta.url)),
            'utf8'
        );
        expect(fonte).not.toContain('import-mode-modal');
        expect(fonte).not.toContain('createImportModeModal');
        // E o handler não guarda mais um construtor de DOM para esta pergunta.
        const handler = makeHandler({ servidor: false, name: 'X', contents: null });
        expect(handler.createImportModeModal).toBeUndefined();
    });
});
