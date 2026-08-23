// Path: tests/unit/permission-levels-derivacao.test.js

/**
 * @fileoverview A ESCADA CONCEDÍVEL TEM UMA FONTE, e até 2026-08-23 tinha quatro.
 *
 * A CAUSA RAIZ. `PERMISSION_LEVELS` era um array literal de quatro `{value, label}` escrito à
 * mão em `modals/sharing.modal.js` E em `modals/create-atlas.modal.js`, com mais duas cópias da
 * lista de validação em `applyAtlasSharing` (`account/account.control.js` e
 * `projects/projects-page.js`). Nenhuma derivava de `PERMISSION_ORDER`, que a arquitetura
 * declara ser a ÚNICA implementação da hierarquia neste repositório, e duas delas faziam
 * aritmética de POSTO com `findIndex` sobre a própria cópia (`excedenteDeGrupo` e
 * `groupLevelOptions`), que é uma segunda implementação da escada com outro nome.
 *
 * O CONTROLE NEGATIVO QUE ESTE ARQUIVO CARREGA, e é o motivo de ele existir em vez de um
 * `toEqual` sozinho: a derivação é `todo degrau abaixo de owner`, então acrescentar um degrau à
 * escada muda a lista concedível SEM tocar em nenhum dos dois modais. Isso é o desenho, e
 * também é exatamente o tipo de mudança que passa calada. Aqui ela REPROVA, porque a lista é
 * asserida em absoluto (valor e rótulo), e reprova nomeando os dois consumidores.
 *
 * O que ele NÃO alcança: as duas cópias de `applyAtlasSharing`, que estão fora desta fatia, e o
 * render dos `<select>`, que só se vê por captura do Playwright.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    PERMISSION_ORDER,
    PERMISSION_LABELS,
    GRANTABLE_PERMISSIONS,
    isGrantablePermission,
    grantablePermissionOptions,
    permissionRank,
} from '@js/projects/permission-levels.js';
import { excedenteDeGrupo, groupLevelOptions, podeAdministrarGrupo, sharingGroupPickerHint }
    from '@modals/sharing.modal.js';

const leia = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('GRANTABLE_PERMISSIONS — a derivação', () => {
    it('CONTROLE NEGATIVO: é exatamente esta lista, valor a valor', () => {
        // Asserção ABSOLUTA de propósito. Um degrau novo em `PERMISSION_ORDER` entra aqui
        // sozinho (a derivação é "abaixo de owner") e chega aos dois modais sem que ninguém os
        // edite: este caso é o que transforma isso em vermelho em vez de silêncio.
        expect([...GRANTABLE_PERMISSIONS]).toEqual(['read', 'comment', 'write', 'manage']);
    });

    it('é a escada MENOS `owner`, e nada além disso', () => {
        expect([...GRANTABLE_PERMISSIONS]).toEqual(PERMISSION_ORDER.filter((l) => l !== 'owner'));
        expect(GRANTABLE_PERMISSIONS).toHaveLength(PERMISSION_ORDER.length - 1);
        // A ordem é a da escada, não a de inserção de um objeto literal.
        const postos = GRANTABLE_PERMISSIONS.map(permissionRank);
        expect(postos).toEqual([0, 1, 2, 3]);
    });

    it('`owner` fica de fora porque não é um share: é a coluna `atlas.owner_id`', () => {
        expect(GRANTABLE_PERMISSIONS).not.toContain('owner');
        expect(isGrantablePermission('owner')).toBe(false);
        // DISCRIMINAÇÃO: `owner` continua sendo um nível CONHECIDO da escada, com rótulo.
        expect(permissionRank('owner')).toBe(4);
        expect(PERMISSION_LABELS.owner).toBe('Proprietário');
    });

    it('é imutável, e nível desconhecido não é concedível', () => {
        expect(Object.isFrozen(GRANTABLE_PERMISSIONS)).toBe(true);
        for (const lixo of ['editor', 'superuser', 'READ', ' read ', '', null, undefined, 0, {},
            'constructor', 'toString']) {
            expect(isGrantablePermission(lixo)).toBe(false);
        }
    });
});

describe('grantablePermissionOptions — as linhas do `<select>`', () => {
    it('devolve os quatro pares completos, em asserção absoluta', () => {
        expect(grantablePermissionOptions()).toEqual([
            { value: 'read', label: 'Leitura' },
            { value: 'comment', label: 'Comentário' },
            { value: 'write', label: 'Edição' },
            { value: 'manage', label: 'Gestão' },
        ]);
    });

    it('nenhum rótulo é vazio, e dois níveis nunca leem igual', () => {
        const rotulos = grantablePermissionOptions().map((o) => o.label);
        expect(rotulos.every((r) => typeof r === 'string' && r.length > 0)).toBe(true);
        expect(new Set(rotulos).size).toBe(rotulos.length);
    });

    it('é um array NOVO a cada chamada: um chamador não contamina o próximo', () => {
        const a = grantablePermissionOptions();
        const b = grantablePermissionOptions();
        expect(a).not.toBe(b);
        a.pop();
        expect(b).toHaveLength(4);
    });
});

describe('os dois modais DERIVAM, e não mantêm cópia própria', () => {
    const SHARING = leia('../../src/js/modals/sharing.modal.core.js');
    const CREATE = leia('../../src/js/modals/create-atlas.modal.js');

    it('nenhum dos dois escreve os rótulos à mão', () => {
        // O texto do array literal que existia nos dois. (Verificação textual porque o valor
        // derivado é indistinguível do literal em runtime: os dois dariam a mesma lista hoje, e
        // divergiriam no primeiro degrau novo.)
        for (const [nome, fonte] of [['sharing', SHARING], ['create-atlas', CREATE]]) {
            expect(fonte, nome).not.toMatch(/\{\s*value:\s*'read',\s*label:\s*'Leitura'\s*\}/);
            expect(fonte, nome).toMatch(/grantablePermissionOptions\(\)/);
            expect(fonte, nome).toMatch(/from\s+'@js\/projects\/permission-levels\.js'/);
        }
    });

    it('nenhum dos dois faz aritmética de posto por `findIndex`', () => {
        for (const [nome, fonte] of [['sharing', SHARING], ['create-atlas', CREATE]]) {
            expect(fonte, nome).not.toMatch(/PERMISSION_LEVELS\.findIndex/);
        }
        expect(SHARING).toMatch(/permissionRank\(/);
    });

    it('a busca acha de fato o padrão proibido (controle do matcher)', () => {
        const isca = "const L = [{ value: 'read', label: 'Leitura' }];\nL.findIndex((p) => p);";
        expect(isca).toMatch(/\{\s*value:\s*'read',\s*label:\s*'Leitura'\s*\}/);
        expect(isca.replace('L.findIndex', 'PERMISSION_LEVELS.findIndex'))
            .toMatch(/PERMISSION_LEVELS\.findIndex/);
    });

    it('`create-atlas.modal.js` continua sem arrastar barrel para `atlas.html`', () => {
        // Ele é importado por `projects/atlas-drive.js`, o corpo de `atlas.html`, que boota sem
        // a store. Um import de PASTA (`@utils`, `@modals`, `@store`) resolve pelo barrel e
        // arrasta a store inteira pelo caminho transitivo.
        const importsDePasta = CREATE.match(/from\s+'@(utils|modals|store|js\/projects)'/g) ?? [];
        expect(importsDePasta).toEqual([]);
        // E a folha que ele passou a importar continua sendo folha.
        const LEVELS = leia('../../src/js/projects/permission-levels.js');
        expect(LEVELS.match(/^\s*import[\s{'"*]/gm) ?? []).toEqual([]);
    });
});

describe('excedenteDeGrupo — o selo, pela aritmética de posto', () => {
    it('mostra o nível efetivo quando o grupo dá MAIS que a linha, nos três saltos', () => {
        expect(excedenteDeGrupo({ permission: 'read', effectivePermission: 'comment' }))
            .toEqual({ label: 'Comentário' });
        expect(excedenteDeGrupo({ permission: 'read', effectivePermission: 'manage' }))
            .toEqual({ label: 'Gestão' });
        expect(excedenteDeGrupo({ permission: 'write', effectivePermission: 'manage' }))
            .toEqual({ label: 'Gestão' });
    });

    it('COBRE A ESCADA INTEIRA: acima marca, igual e abaixo não', () => {
        // O laço só vale com a contagem asserida: uma coleção vazia passaria calada.
        let acima = 0;
        let naoAcima = 0;
        for (const linha of GRANTABLE_PERMISSIONS) {
            for (const efetiva of GRANTABLE_PERMISSIONS) {
                const selo = excedenteDeGrupo({ permission: linha, effectivePermission: efetiva });
                if (permissionRank(efetiva) > permissionRank(linha)) {
                    expect(selo).toEqual({ label: PERMISSION_LABELS[efetiva] });
                    acima += 1;
                } else {
                    expect(selo).toBeNull();
                    naoAcima += 1;
                }
            }
        }
        expect(acima).toBe(6);   // os pares estritamente crescentes de uma escada de 4
        expect(naoAcima).toBe(10);
    });

    it('`owner` como efetivo não vira selo, mesmo sendo posto maior', () => {
        // É o caso que separa "usar o rank" de "usar o rank sem pensar": `owner` tem posto 4,
        // maior que qualquer linha, mas não é nível concedível e o `<select>` não o oferece.
        expect(excedenteDeGrupo({ permission: 'read', effectivePermission: 'owner' })).toBeNull();
        expect(excedenteDeGrupo({ permission: 'owner', effectivePermission: 'owner' })).toBeNull();
    });
});

describe('podeAdministrarGrupo — a autoridade otimista sobre grupo', () => {
    it('o administrador GLOBAL administra qualquer grupo, órfão inclusive', () => {
        expect(podeAdministrarGrupo({ ownerId: 'u9' }, { userId: 'u1', isAdmin: true })).toBe(true);
        expect(podeAdministrarGrupo({}, { userId: 'u1', isAdmin: true })).toBe(true);
    });

    it('o dono administra o próprio, comparando por String', () => {
        expect(podeAdministrarGrupo({ ownerId: 'u9' }, { userId: 'u9' })).toBe(true);
        expect(podeAdministrarGrupo({ ownerId: 42 }, { userId: '42' })).toBe(true);
        expect(podeAdministrarGrupo({ ownerId: 'u9' }, { userId: 'u1' })).toBe(false);
    });

    it('os dois nulos NÃO se encontram: sessão sem identidade em grupo órfão', () => {
        // Sem esta linha `null === null` entregaria a subida a quem não tem identidade nenhuma.
        expect(podeAdministrarGrupo({ ownerId: null }, { userId: null })).toBe(false);
        expect(podeAdministrarGrupo({}, {})).toBe(false);
        expect(podeAdministrarGrupo({ ownerId: '' }, { userId: '' })).toBe(false);
        expect(podeAdministrarGrupo(null, undefined)).toBe(false);
    });

    it('`isAdmin` só atravessa quando é o booleano, não um valor verdadeiro qualquer', () => {
        // A sessão entrega `sessionContext.isAdmin()`, que é booleano. Aceitar qualquer
        // truthy abriria a porta para um `'false'` vindo de um dataset.
        expect(podeAdministrarGrupo({ ownerId: 'u9' }, { userId: 'u1', isAdmin: 'sim' })).toBe(false);
        expect(podeAdministrarGrupo({ ownerId: 'u9' }, { userId: 'u1', isAdmin: 1 })).toBe(false);
    });

    it('é a MESMA decisão que `groupLevelOptions` usa para liberar a subida', () => {
        // Duas respostas para a mesma pergunta é o defeito que esta fatia inteira ataca.
        const grupo = { permission: 'read', ownerId: 'u9' };
        for (const sessao of [{ userId: 'u9' }, { userId: 'u1' }, { userId: 'u1', isAdmin: true }]) {
            const livres = groupLevelOptions(grupo, sessao).every((o) => !o.disabled);
            expect(livres).toBe(podeAdministrarGrupo(grupo, sessao));
        }
    });
});

describe('sharingGroupPickerHint — a dica manda para a porta que ESTA pessoa vê', () => {
    it('quem não administra nenhum grupo recebe o rótulo calculado, não "Grupos" fixo', () => {
        expect(sharingGroupPickerHint(0, 'Administração'))
            .toBe('Só é possível compartilhar com grupos que você administra. Crie um em Administração.');
        expect(sharingGroupPickerHint(0, 'Catálogo')).toContain('Crie um em Catálogo.');
        expect(sharingGroupPickerHint(0, 'Grupos')).toContain('Crie um em Grupos.');
    });

    it('DISCRIMINAÇÃO: as três audiências produzem três frases diferentes', () => {
        const frases = ['Administração', 'Catálogo', 'Grupos'].map((p) => sharingGroupPickerHint(0, p));
        expect(new Set(frases).size).toBe(3);
    });

    it('sem porta (anônimo, visitante de link público) não indica destino nenhum', () => {
        for (const semPorta of [null, undefined, '', '   ', 0, {}]) {
            const frase = sharingGroupPickerHint(0, semPorta);
            expect(frase).toBe('Só é possível compartilhar com grupos que você administra.');
            expect(frase).not.toContain('Crie um em');
            expect(frase).not.toContain('null');
            expect(frase).not.toContain('undefined');
        }
    });

    it('quem TEM grupos, mas todos já no atlas, recebe a outra frase, sem porta nenhuma', () => {
        // Os dois motivos para a mesma ausência de opções são diferentes, e mandar quem já tem
        // grupos criar mais um seria conselho errado.
        const frase = sharingGroupPickerHint(3, 'Administração');
        expect(frase).toBe('Todos os seus grupos já estão neste atlas.');
        expect(frase).not.toContain('Crie um em');
    });

    it('contagem suja cai no ramo de quem não tem grupo, nunca em "0 grupos"', () => {
        for (const sujo of [undefined, null, NaN, -1, 'três', {}]) {
            expect(sharingGroupPickerHint(sujo, null))
                .toBe('Só é possível compartilhar com grupos que você administra.');
        }
    });
});

describe('o cache de grupos morre a cada abertura do modal', () => {
    const SHARING = leia('../../src/js/modals/sharing.modal.core.js');

    it('`render()` zera `_myGroups` antes de disparar o carregamento', () => {
        // O defeito: `_loadMyGroups` sai cedo por `if (this._myGroups !== null) return;`, e a
        // releitura dependia de o chamador construir uma instância nova. (Verificação textual:
        // `render()` toca no DOM, que este ambiente `node` não tem.)
        const corpoDoRender = SHARING.slice(SHARING.indexOf('    render() {'));
        const ateOFim = corpoDoRender.slice(0, corpoDoRender.indexOf('_onPresenceChanged'));
        expect(ateOFim).toMatch(/this\._myGroups\s*=\s*null;/);
        // E o zerar vem ANTES do `_load()`, senão a busca acharia o cache velho.
        expect(ateOFim.indexOf('this._myGroups = null;'))
            .toBeLessThan(ateOFim.indexOf('this._load()'));
    });

    it('o early-return DENTRO da abertura continua de pé, e é deliberado', () => {
        // Tirá-lo traria um `_renderBody()` fora de ordem a cada mutação, capaz de arrancar o
        // campo de busca debaixo de quem digita.
        expect(SHARING).toMatch(/if\s*\(this\._myGroups\s*!==\s*null\)\s*return;/);
    });
});
