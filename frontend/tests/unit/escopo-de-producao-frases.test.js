// Path: tests/unit/escopo-de-producao-frases.test.js

import { describe, it, expect } from 'vitest';
import {
    PruneMotive,
    verdictOfChange,
    grantLabel,
    producerScopeChangeTitle,
    producerScopeChangeWarning,
    producerScopeChangeConfirmLabel,
    producerScopeChangeSummary,
} from '../../src/js/admin/producer-scope-phrases.js';

// AS FRASES DO SALVAMENTO QUE REVOGA, na aba "Usuários".
//
// Salvar o formulário de usuário com o papel global trocado, ou com a OM produtora
// trocada, faz o servidor revogar TODA concessão viva que aquela pessoa deu, com a
// subárvore pendurada nela (`fundamentoDeRaizPerdido` + `podarPorRaizes`, origem
// `USER_DEMOTION`). Até 2026-08-23 a tela não dizia nada, nem antes nem depois, e o
// agravante é que a poda dispara na simples desigualdade `omAntes !== omDepois`: corrigir
// um ERRO DE DIGITAÇÃO na OM de um produtor destruía tudo o que ele havia concedido.
//
// O QUE ESTE ARQUIVO PRENDE é o veredito (SE poda, e por qual gesto) e a aritmética das
// frases. O veredito é um ESPELHO da decisão do servidor, e não há teste ligando os dois
// lados (o arquivo do servidor puxa banco e bcrypt), então os casos abaixo levam asserção
// ABSOLUTA em cada ramo: eles precisam falhar sozinhos quando o espelho derivar.
//
// O CONTROLE NEGATIVO É O RAMO MAIS AFIADO: promover um produtor a administrador APAGA
// `producer_org_id` (o CHECK bicondicional do banco não deixa um admin carregar escopo),
// então uma regra escrita sobre a coluna leria a promoção como perda e avisaria destruição
// no ato que AUMENTA a autoridade.

const produtorDe = (om) => ({ role: 'producer', producer_org_id: om });

describe('verdictOfChange — SE o salvamento poda, e por qual gesto', () => {
    it('trocar a OM de quem CONTINUA produtor é o gesto que surpreende', () => {
        expect(verdictOfChange(produtorDe('om-a'), produtorDe('om-b')))
            .toBe(PruneMotive.TROCOU_OM);
        expect(PruneMotive.TROCOU_OM).toBe('trocou_om');
    });

    it('rebaixar um produtor é outro gesto, e a frase precisa distingui-lo', () => {
        expect(verdictOfChange(produtorDe('om-a'), { role: 'user', producer_org_id: null }))
            .toBe(PruneMotive.REBAIXOU_PRODUTOR);
    });

    it('sair do eixo global de dado poda: o fundamento era o papel', () => {
        expect(verdictOfChange({ role: 'admin' }, { role: 'user', producer_org_id: null }))
            .toBe(PruneMotive.PAPEL_GLOBAL);
        expect(verdictOfChange({ role: 'credenciado' }, { role: 'producer', producer_org_id: 'om-a' }))
            .toBe(PruneMotive.PAPEL_GLOBAL);
    });

    // CONTROLE NEGATIVO (1): quem TERMINA com acesso global de dado não perdeu nada.
    it('PROMOVER não poda, nem quando a promoção limpa o escopo de produção', () => {
        expect(verdictOfChange(produtorDe('om-a'), { role: 'admin', producer_org_id: null }))
            .toBeNull();
        expect(verdictOfChange(produtorDe('om-a'), { role: 'credenciado', producer_org_id: null }))
            .toBeNull();
        // O movimento lateral entre os dois papéis de dado global também não poda: nenhum
        // dos dois contém o outro, e os dois concedem o acervo privado inteiro.
        expect(verdictOfChange({ role: 'admin' }, { role: 'credenciado' })).toBeNull();
    });

    // CONTROLE NEGATIVO (2): a edição comum, que é o caso de longe mais frequente.
    it('editar nome, lotação ou papel sem tocar no par de autoridade não poda', () => {
        expect(verdictOfChange(produtorDe('om-a'), produtorDe('om-a'))).toBeNull();
        expect(verdictOfChange({ role: 'user' }, { role: 'user' })).toBeNull();
        // Promover um usuário comum a Produtor: não havia OM antes, então não há acervo
        // antigo em relação ao qual ele tenha deixado de produzir.
        expect(verdictOfChange({ role: 'user', producer_org_id: null }, produtorDe('om-a')))
            .toBeNull();
    });

    it('objeto ausente ou papel ausente não explode, e é lido como usuário comum', () => {
        expect(verdictOfChange(undefined, undefined)).toBeNull();
        expect(verdictOfChange({}, {})).toBeNull();
        expect(verdictOfChange({ producer_org_id: 'om-a' }, { producer_org_id: 'om-b' }))
            .toBe(PruneMotive.REBAIXOU_PRODUTOR);
    });
});

describe('grantLabel — o plural que a string do COUNT quebraria', () => {
    it('concorda em número, com o valor chegando como número ou como string', () => {
        expect(grantLabel(1)).toBe('1 concessão');
        expect(grantLabel('1')).toBe('1 concessão');
        expect(grantLabel(3)).toBe('3 concessões');
        expect(grantLabel('3')).toBe('3 concessões');
        expect(grantLabel(0)).toBe('0 concessões');
    });

    it('ausente e lixo viram zero, nunca "NaN concessões" na tela', () => {
        expect(grantLabel(undefined)).toBe('0 concessões');
        expect(grantLabel(null)).toBe('0 concessões');
        expect(grantLabel('abc')).toBe('0 concessões');
    });
});

describe('producerScopeChangeWarning — o aviso ANTES do clique', () => {
    // ZERO NÃO ASSUSTA. Trocar a OM de um produtor que nunca concedeu nada é uma edição
    // inofensiva, e "revoga 0 concessões" transforma o caso normal num susto.
    it('ZERO concessões: diz que nada é revogado, e não promete queda nenhuma', () => {
        const frase = producerScopeChangeWarning({
            motivo: PruneMotive.TROCOU_OM, liveGrants: 0,
        });
        expect(frase).toContain('não tem nenhuma concessão viva hoje');
        expect(frase).toContain('nada é revogado');
        expect(frase).not.toContain('Isso não se desfaz');
        expect(frase).not.toContain('repassaram');
    });

    it('ZERO ainda diz o que muda na autoridade: a confirmação não é vazia', () => {
        expect(producerScopeChangeWarning({ motivo: PruneMotive.TROCOU_OM, liveGrants: 0 }))
            .toContain('continua Produtor');
        expect(producerScopeChangeWarning({ motivo: PruneMotive.REBAIXOU_PRODUTOR, liveGrants: 0 }))
            .toContain('deixa de ser Produtor');
    });

    it('UMA concessão: singular, com a cascata e o aviso de irreversibilidade', () => {
        const frase = producerScopeChangeWarning({
            motivo: PruneMotive.REBAIXOU_PRODUTOR, liveGrants: 1,
        });
        expect(frase).toContain('1 concessão que ele deu');
        expect(frase).not.toContain('1 concessões');
        expect(frase).toContain('repassaram a partir delas');
        expect(frase).toContain('Isso não se desfaz.');
    });

    it('VÁRIAS: plural, e o número do COUNT em string não vira "3 concessão"', () => {
        const frase = producerScopeChangeWarning({
            motivo: PruneMotive.PAPEL_GLOBAL, liveGrants: '3',
        });
        expect(frase).toContain('3 concessões que ele deu');
        expect(frase).toContain('acesso global aos dados');
    });

    // A DISCRIMINAÇÃO ENTRE OS GATILHOS. Sem ela, um `motivo` ignorado passaria verde em
    // toda asserção de `toContain` acima.
    it('os TRÊS gestos produzem frases DIFERENTES para a mesma contagem', () => {
        const frases = [
            PruneMotive.TROCOU_OM,
            PruneMotive.REBAIXOU_PRODUTOR,
            PruneMotive.PAPEL_GLOBAL,
        ].map((motivo) => producerScopeChangeWarning({ motivo, liveGrants: 2 }));
        expect(new Set(frases).size).toBe(3);
    });
});

describe('producerScopeChangeTitle — o gesto NOMEADO na primeira linha', () => {
    it('a troca de OM se anuncia como troca de OM, não como troca de papel', () => {
        expect(producerScopeChangeTitle({ motivo: PruneMotive.TROCOU_OM, username: 'diniz' }))
            .toBe('Trocar a OM produtora de "diniz"?');
    });

    it('os outros dois gestos se anunciam como troca de papel', () => {
        expect(producerScopeChangeTitle({
            motivo: PruneMotive.REBAIXOU_PRODUTOR, username: 'diniz',
        })).toBe('Trocar o papel de "diniz"?');
        expect(producerScopeChangeTitle({ motivo: PruneMotive.PAPEL_GLOBAL, username: 'diniz' }))
            .toBe('Trocar o papel de "diniz"?');
    });

    it('sem username, o título continua uma frase e não um buraco entre aspas', () => {
        expect(producerScopeChangeTitle({ motivo: PruneMotive.PAPEL_GLOBAL }))
            .toBe('Trocar o papel de "este usuário"?');
    });
});

describe('producerScopeChangeConfirmLabel — o botão não ameaça em falso', () => {
    it('com concessões vivas, o botão diz que vai revogar', () => {
        expect(producerScopeChangeConfirmLabel(1)).toBe('Salvar e revogar');
        expect(producerScopeChangeConfirmLabel('4')).toBe('Salvar e revogar');
    });

    it('sem concessões vivas, ele é só "Salvar"', () => {
        expect(producerScopeChangeConfirmLabel(0)).toBe('Salvar');
        expect(producerScopeChangeConfirmLabel(undefined)).toBe('Salvar');
    });
});

describe('producerScopeChangeSummary — o toast DEPOIS, com o número do servidor', () => {
    it('ZERO: volta a ser o "Usuário atualizado." de sempre, sem susto', () => {
        expect(producerScopeChangeSummary({ grantsAffected: 0, grantsReparented: 0 }))
            .toBe('Usuário atualizado.');
        expect(producerScopeChangeSummary({})).toBe('Usuário atualizado.');
        expect(producerScopeChangeSummary(undefined)).toBe('Usuário atualizado.');
    });

    it('UMA revogada: o número aparece, e é o do servidor', () => {
        expect(producerScopeChangeSummary({ grantsAffected: 1 }))
            .toBe('Usuário atualizado. Concessões revogadas: 1.');
    });

    it('VÁRIAS, com quem manteve o acesso por outro caminho', () => {
        expect(producerScopeChangeSummary({ grantsAffected: '5', grantsReparented: '2' }))
            .toBe('Usuário atualizado. Concessões revogadas: 5. Mantidas por outro caminho: 2.');
    });

    it('só reparentadas: nada caiu, e a frase não inventa uma revogação', () => {
        expect(producerScopeChangeSummary({ grantsAffected: 0, grantsReparented: 2 }))
            .toBe('Usuário atualizado. Mantidas por outro caminho: 2.');
    });
});
