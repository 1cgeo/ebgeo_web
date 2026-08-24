import { describe, it, expect } from 'vitest';
import {
    SEEN_MARK_VERSION,
    BADGE_MAX_COUNT,
    seenMarkStorageKey,
    parseSeenMark,
    serializeSeenMark,
    sharedAtlasIds,
    newSharedAtlasIds,
    nextSeenIds,
    resolveSharedBadge,
    badgeText,
    badgeAccessibleLabel,
    badgeScopeNotice,
} from '../../src/js/projects/shared-atlas-badge.js';

// O CONTADOR DE NOVIDADES DA ABA "COMPARTILHADOS COMIGO".
//
// O servidor NÃO tem noção de lido ou não lido, e isso foi medido antes de qualquer linha:
// `GET /atlas` traz `created_at`/`updated_at` DO ATLAS (que mexem quando qualquer pessoa edita),
// `GET /atlas/overview` traz cinco campos cujo único carimbo de tempo é o da CAPA, e
// `atlas_shares.added_at` (o dado certo) só sai por `GET /atlas/:id/sharing`, uma rota por atlas
// com portão `manage`, que o leitor comum não atravessa. "Usuário X abriu o atlas Y" não existe
// em coluna nenhuma.
//
// Logo a marca do que já foi visto mora no cliente, e a aritmética inteira é este arquivo.
//
// O CASO QUE DECIDE O PRODUTO É A PRIMEIRA VISITA. Sem marca, a leitura ingênua é "nada foi
// visto", e alguém com dez atlas antigos abriria a página com dez novidades falsas. É por isso
// que a discriminação cobrada aqui não é só "conta certo": é que marca AUSENTE e marca VAZIA
// produzam resultados DIFERENTES. As duas são "seen.length === 0"; confundi-las engole
// exatamente o primeiro convite que a funcionalidade existe para anunciar.

describe('seenMarkStorageKey — a chave, por conta', () => {
    it('escopa por usuário, com o prefixo da casa', () => {
        expect(seenMarkStorageKey('u-1')).toBe('ebgeo_shared_atlas_seen:u-1');
        expect(seenMarkStorageKey('u-2')).toBe('ebgeo_shared_atlas_seen:u-2');
        // DISCRIMINAÇÃO: duas contas na mesma máquina não podem apagar a marca uma da outra.
        expect(seenMarkStorageKey('u-1')).not.toBe(seenMarkStorageKey('u-2'));
    });

    it('não devolve chave para visitante anônimo, em nenhuma das formas de vazio', () => {
        expect(seenMarkStorageKey(null)).toBeNull();
        expect(seenMarkStorageKey(undefined)).toBeNull();
        expect(seenMarkStorageKey('')).toBeNull();
        expect(seenMarkStorageKey('   ')).toBeNull();
    });
});

describe('parseSeenMark — ler de volta o que ficou guardado', () => {
    it('aceita o que ele mesmo escreveu (ida e volta)', () => {
        const raw = serializeSeenMark(['a', 'b']);
        expect(parseSeenMark(raw)).toEqual({ ids: ['a', 'b'] });
    });

    it('normaliza duplicata, vazio e não-string na leitura', () => {
        const raw = JSON.stringify({ v: SEEN_MARK_VERSION, ids: ['a', 'a', '', '  b  ', null, 7] });
        expect(parseSeenMark(raw)).toEqual({ ids: ['a', 'b', '7'] });
    });

    it('devolve null para TODA forma ilegível, que é o lado seguro do erro', () => {
        expect(parseSeenMark(null)).toBeNull();
        expect(parseSeenMark(undefined)).toBeNull();
        expect(parseSeenMark('')).toBeNull();
        expect(parseSeenMark('   ')).toBeNull();
        expect(parseSeenMark('{')).toBeNull();
        expect(parseSeenMark('[]')).toBeNull();
        expect(parseSeenMark('"texto"')).toBeNull();
        expect(parseSeenMark(JSON.stringify({ ids: ['a'] }))).toBeNull();
        expect(parseSeenMark(JSON.stringify({ v: SEEN_MARK_VERSION + 1, ids: ['a'] }))).toBeNull();
        expect(parseSeenMark(JSON.stringify({ v: SEEN_MARK_VERSION, ids: 'a' }))).toBeNull();
    });

    it('a marca VAZIA é legível e NÃO é null, que é a distinção do produto inteiro', () => {
        const raw = serializeSeenMark([]);
        expect(parseSeenMark(raw)).toEqual({ ids: [] });
        // Sem esta linha, "vazio" e "ausente" se confundem, e o primeiro convite some.
        expect(parseSeenMark(raw)).not.toBeNull();
    });
});

describe('sharedAtlasIds — quem está na aba', () => {
    const lista = [
        { id: 'meu', user_permission: 'owner' },
        { id: 'leitura', user_permission: 'read' },
        { id: 'gestao', user_permission: 'manage' },
        { id: 'comentario', user_permission: 'comment' },
        { id: 'escrita', user_permission: 'write' },
        { id: 'nenhum', user_permission: null },
    ];

    it('pega tudo que não é posse, e NÃO por lista fechada de níveis', () => {
        expect(sharedAtlasIds(lista)).toEqual(['leitura', 'gestao', 'comentario', 'escrita']);
    });

    it('um nível que este arquivo nunca viu continua sendo um compartilhamento', () => {
        // A lista fechada `perm === 'write' || perm === 'owner'` é o defeito que a constituição
        // proíbe e que já custou dois bugs reais. Aqui ele apareceria como `manage` sumindo.
        expect(sharedAtlasIds(lista)).toContain('gestao');
        expect(sharedAtlasIds([{ id: 'x', user_permission: 'nivel-do-futuro' }])).toEqual(['x']);
    });

    it('exclui a posse e o sem-nível', () => {
        expect(sharedAtlasIds(lista)).not.toContain('meu');
        expect(sharedAtlasIds(lista)).not.toContain('nenhum');
    });

    it('sobrevive a entrada que não é lista', () => {
        expect(sharedAtlasIds(null)).toEqual([]);
        expect(sharedAtlasIds(undefined)).toEqual([]);
        expect(sharedAtlasIds({})).toEqual([]);
        expect(sharedAtlasIds([null, undefined, {}])).toEqual([]);
    });
});

describe('newSharedAtlasIds — a subtração', () => {
    it('zero: tudo o que está na aba já foi visto', () => {
        expect(newSharedAtlasIds(['a', 'b'], ['a', 'b'])).toEqual([]);
    });

    it('um', () => {
        expect(newSharedAtlasIds(['a', 'b'], ['a'])).toEqual(['b']);
    });

    it('vários, na ordem da lista', () => {
        expect(newSharedAtlasIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    });

    it('marca vazia: TODO atlas compartilhado é novo', () => {
        expect(newSharedAtlasIds(['a', 'b'], [])).toEqual(['a', 'b']);
    });

    it('id que saiu da aba não vira novidade nem conta', () => {
        // A marca tem 'z', a aba não. O resultado é sobre a aba, nunca sobre a marca.
        expect(newSharedAtlasIds(['a'], ['z'])).toEqual(['a']);
        expect(newSharedAtlasIds([], ['z'])).toEqual([]);
    });

    it('compara como string, para 3 e "3" não contarem duas vezes', () => {
        expect(newSharedAtlasIds([3, '4'], ['3'])).toEqual(['4']);
    });
});

describe('nextSeenIds — o que se grava depois de olhar', () => {
    it('é exatamente a aba de agora, PODADA do que saiu dela', () => {
        expect(nextSeenIds(['a', 'b'])).toEqual(['a', 'b']);
        // O id antigo não sobrevive: quem tirou e devolveu o acesso conta como novo de novo.
        expect(nextSeenIds([])).toEqual([]);
    });

    it('poda a duplicata, para o blob não crescer sozinho', () => {
        expect(nextSeenIds(['a', 'a', 'b'])).toEqual(['a', 'b']);
    });
});

describe('resolveSharedBadge — a decisão inteira num lugar só', () => {
    const projetos = [
        { id: 'meu', user_permission: 'owner' },
        { id: 'a', user_permission: 'read' },
        { id: 'b', user_permission: 'manage' },
    ];

    it('PRIMEIRA VISITA (marca ausente): adota em silêncio e não anuncia nada', () => {
        const r = resolveSharedBadge({ projects: projetos, storedMark: null });
        expect(r.adopt).toBe(true);
        expect(r.count).toBe(0);
        expect(r.newIds).toEqual([]);
        // E o que se grava é a lista inteira, senão a adoção não adota nada.
        expect(r.seenIds).toEqual(['a', 'b']);
    });

    it('marca ILEGÍVEL cai no mesmo ramo da ausente', () => {
        const r = resolveSharedBadge({ projects: projetos, storedMark: parseSeenMark('lixo') });
        expect(r.adopt).toBe(true);
        expect(r.count).toBe(0);
    });

    it('marca VAZIA NÃO adota: o primeiro convite conta', () => {
        const r = resolveSharedBadge({ projects: projetos, storedMark: { ids: [] } });
        // DISCRIMINAÇÃO contra o caso acima: mesmo projeto, contagem oposta.
        expect(r.adopt).toBe(false);
        expect(r.count).toBe(2);
        expect(r.newIds).toEqual(['a', 'b']);
    });

    it('zero novidades quando tudo já foi visto', () => {
        const r = resolveSharedBadge({ projects: projetos, storedMark: { ids: ['a', 'b'] } });
        expect(r.adopt).toBe(false);
        expect(r.count).toBe(0);
        expect(r.newIds).toEqual([]);
    });

    it('uma novidade', () => {
        const r = resolveSharedBadge({ projects: projetos, storedMark: { ids: ['a'] } });
        expect(r.count).toBe(1);
        expect(r.newIds).toEqual(['b']);
    });

    it('o atlas que a pessoa POSSUI nunca vira novidade', () => {
        const r = resolveSharedBadge({ projects: projetos, storedMark: { ids: ['a', 'b'] } });
        expect(r.newIds).not.toContain('meu');
        expect(r.seenIds).not.toContain('meu');
    });

    it('lista vazia com marca de pé: zero, e a marca a gravar esvazia junto', () => {
        const r = resolveSharedBadge({ projects: [], storedMark: { ids: ['a'] } });
        expect(r.count).toBe(0);
        expect(r.seenIds).toEqual([]);
    });

    it('entrada ausente por inteiro não explode', () => {
        const r = resolveSharedBadge(undefined);
        expect(r.adopt).toBe(true);
        expect(r.count).toBe(0);
        expect(r.seenIds).toEqual([]);
    });
});

describe('badgeText — o que se desenha dentro do selo', () => {
    it('zero e negativo não desenham selo nenhum', () => {
        expect(badgeText(0)).toBe('');
        expect(badgeText(-1)).toBe('');
    });

    it('um e vários', () => {
        expect(badgeText(1)).toBe('1');
        expect(badgeText(5)).toBe('5');
        expect(badgeText(BADGE_MAX_COUNT)).toBe(String(BADGE_MAX_COUNT));
    });

    it('acima do teto vira "9+", porque a aba é uma aba', () => {
        expect(badgeText(BADGE_MAX_COUNT + 1)).toBe(`${BADGE_MAX_COUNT}+`);
        expect(badgeText(420)).toBe(`${BADGE_MAX_COUNT}+`);
    });

    it('nunca escreve NaN, Infinity nem fração', () => {
        expect(badgeText(NaN)).toBe('');
        // Infinity não é uma contagem, é a ausência de uma: selo nenhum, como NaN.
        expect(badgeText(Infinity)).toBe('');
        expect(badgeText(-Infinity)).toBe('');
        expect(badgeText(null)).toBe('');
        expect(badgeText(undefined)).toBe('');
        expect(badgeText('3')).toBe('3');
        expect(badgeText('abc')).toBe('');
        expect(badgeText(2.7)).toBe('2');
        expect(badgeText(0.4)).toBe('');
    });
});

describe('badgeAccessibleLabel — o dígito não é a informação', () => {
    it('vazio quando não há selo, para não sobrar frase sem número', () => {
        expect(badgeAccessibleLabel(0)).toBe('');
        expect(badgeAccessibleLabel(NaN)).toBe('');
        expect(badgeAccessibleLabel(-3)).toBe('');
    });

    it('concorda em número, e "atlas" é invariável em pt-BR', () => {
        expect(badgeAccessibleLabel(1)).toBe('1 atlas novo compartilhado com você');
        expect(badgeAccessibleLabel(2)).toBe('2 atlas novos compartilhados com você');
        // DISCRIMINAÇÃO: singular e plural não podem ser a mesma frase.
        expect(badgeAccessibleLabel(1)).not.toBe(badgeAccessibleLabel(2));
    });

    it('NÃO corta no teto: quem ouve a frase merece o número real', () => {
        expect(badgeText(30)).toBe('9+');
        expect(badgeAccessibleLabel(30)).toContain('30');
    });
});

describe('badgeScopeNotice — o que a marca não sabe, dito em voz alta', () => {
    it('nomeia as três consequências de a marca morar no navegador', () => {
        const texto = badgeScopeNotice();
        expect(texto).toContain('navegador');
        expect(texto).toContain('aparelho');
        expect(texto).toContain('limpos');
        expect(texto).toContain('novidade');
    });

    it('é prosa em pt-BR acentuada, sem em-dash', () => {
        const texto = badgeScopeNotice();
        expect(texto).not.toContain('—');
        expect(texto).toMatch(/[áàâãéêíóôõúç]/i);
        expect(texto.length).toBeGreaterThan(60);
    });
});
