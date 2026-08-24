// Path: tests/unit/concessoes-frases.test.js

/**
 * @fileoverview O VOCABULÁRIO DA ABA "CONCESSÕES", que é a primeira superfície do produto a falar
 * com quem RECEBEU um acesso.
 *
 * O QUE ESTA SUÍTE EXISTE PARA PRENDER, e por que não é higiene:
 *
 *   1. **O prazo é um VALOR, não uma string.** A morte de uma concessão mora no predicado do
 *      servidor: no dia seguinte o recurso some do catálogo sem evento e sem aviso. A tela precisa
 *      distinguir "venceu" de "vence em três dias" de "vence daqui a um ano", e um rótulo só não
 *      deixaria. Os limites (hoje, dentro de sete dias) são aritmética de calendário, que é
 *      exatamente o tipo de coisa que passa verde no caminho feliz e erra na virada do dia.
 *   2. **A conta é por DIA DE CALENDÁRIO.** Uma concessão que vence amanhã às 09:00, olhada hoje às
 *      23:00, dista 0,4 dia, e "faltam 0 dias" é falso para quem lê um calendário. Os casos de
 *      borda abaixo são justamente esses, com horas escolhidas para reprovar a diferença de
 *      instantes.
 *   3. **O desconhecido não vira o conhecido.** Tipo de recurso e nível são vocabulários fechados
 *      que o servidor pode ampliar depois deste build. Cair no primeiro item conhecido, num eixo de
 *      ACESSO, mente sobre o que a pessoa pode fazer: dizer "Ver" a quem tem "Ver e compartilhar"
 *      esconde um poder, e o inverso promete um que não existe.
 *   4. **`viaGroup` é a única transferência de autoridade sem linha em `resource_grants`.** Quem vê
 *      por membresia perde o acesso ao sair do grupo, e não há concessão para revogar nem para
 *      renovar. Se a frase não disser isso, a pessoa procura uma linha que não existe.
 *
 * AS DATAS SÃO CONSTRUÍDAS COM COMPONENTES LOCAIS (`new Date(ano, mes, dia, hora)`), nunca por ISO
 * com `Z`: a conta é de dia de calendário LOCAL, e uma fixture em UTC faria a suíte passar ou
 * reprovar conforme o fuso da máquina, que é a forma de flake mais cara de diagnosticar.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    EXPIRY_SOON_DAYS,
    EXPIRY_STATE,
    GRANT_LEVEL_LABELS,
    RESOURCE_TYPE_LABELS,
    daysUntilExpiry,
    expiryChip,
    expiryState,
    grantLevelDescription,
    grantLevelLabel,
    granteeGroupNotice,
    granteeLabel,
    grantorLabel,
    grantsScopeNotice,
    isGroupGrant,
    isKnownGrantLevel,
    isKnownResourceType,
    issuedEmptyNotice,
    issuedFailureNotice,
    issuedRevocationSummary,
    issuedRevocationWarning,
    receivedEmptyNotice,
    receivedExpiryNotice,
    receivedFailureNotice,
    receivedNotRevocableNotice,
    resourceDisplayName,
    resourceIdentityTitle,
    resourceTypeLabel,
    shortDate,
    viaGroupLabel,
    viaGroupNotice,
} from '../../src/js/admin/grant-phrases.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Um instante de referência estável: 10 de agosto de 2026, meio-dia local. */
const AGORA = new Date(2026, 7, 10, 12, 0, 0);

/** @param {number} dias @param {number} [hora] @returns {Date} */
function emDias(dias, hora = 12) {
    return new Date(2026, 7, 10 + dias, hora, 0, 0);
}

describe('grant-phrases — o tipo de recurso', () => {
    it('cada tipo conhecido tem rótulo em pt-BR', () => {
        expect(resourceTypeLabel('tileset')).toBe('Modelo 3D');
        expect(resourceTypeLabel('data_layer')).toBe('Camada de dados');
        expect(resourceTypeLabel('analysis_layer')).toBe('Camada de análise');
        expect(resourceTypeLabel('sv360_project')).toBe('Projeto 360');
    });

    it('um tipo NOVO vira o próprio valor, e não o rótulo de outro tipo', () => {
        expect(resourceTypeLabel('terrain_dem')).toBe('terrain_dem');
        // A degradação que isto impede: assumir o primeiro tipo conhecido.
        expect(resourceTypeLabel('terrain_dem')).not.toBe(RESOURCE_TYPE_LABELS.tileset);
    });

    it('sem tipo nenhum a palavra genérica entra, em vez de branco', () => {
        for (const vazio of [null, undefined, '', '   ', 7, {}]) {
            expect(resourceTypeLabel(vazio)).toBe('Recurso');
        }
    });

    it('isKnownResourceType discrimina, e não é um `true` constante', () => {
        for (const tipo of Object.keys(RESOURCE_TYPE_LABELS)) {
            expect(isKnownResourceType(tipo), tipo).toBe(true);
        }
        expect(isKnownResourceType('terrain_dem')).toBe(false);
        expect(isKnownResourceType(null)).toBe(false);
        // Herdado do prototype não conta como tipo (`Object.hasOwn`, não `in`).
        expect(isKnownResourceType('toString')).toBe(false);
    });
});

describe('grant-phrases — o nome do recurso na linha', () => {
    it('o nome ganha do id, e o id ganha do vazio', () => {
        expect(resourceDisplayName({ resourceName: 'Ortofoto Sul', resourceId: 'orto-sul' }))
            .toBe('Ortofoto Sul');
        // O ID É O ÚLTIMO RECURSO e não um travessão: com ele ainda dá para achar o recurso no
        // catálogo, e um travessão deixaria a linha inacionável.
        expect(resourceDisplayName({ resourceId: 'orto-sul' })).toBe('orto-sul');
        expect(resourceDisplayName({ resourceName: '   ', resourceId: 'orto-sul' })).toBe('orto-sul');
        expect(resourceDisplayName({})).toBe('Recurso sem nome');
        expect(resourceDisplayName(null)).toBe('Recurso sem nome');
    });

    it('o title identifica sem ambiguidade: tipo mais id', () => {
        expect(resourceIdentityTitle({ resourceType: 'sv360_project', resourceId: 'x1' }))
            .toBe('Projeto 360 · x1');
        // Sem id, o title não vira "Projeto 360 · " com o separador solto.
        expect(resourceIdentityTitle({ resourceType: 'sv360_project' })).toBe('Projeto 360');
    });
});

describe('grant-phrases — o nível, e o que ele autoriza', () => {
    it('os dois níveis do contrato têm rótulo', () => {
        expect(grantLevelLabel('view')).toBe('Ver');
        expect(grantLevelLabel('view_share')).toBe('Ver e compartilhar');
    });

    it('um nível NOVO vira o valor cru, nos dois sentidos do erro', () => {
        expect(grantLevelLabel('view_edit')).toBe('view_edit');
        // Cair em "Ver" esconderia um poder; cair em "Ver e compartilhar" prometeria um que não há.
        expect(grantLevelLabel('view_edit')).not.toBe(GRANT_LEVEL_LABELS.view);
        expect(grantLevelLabel('view_edit')).not.toBe(GRANT_LEVEL_LABELS.view_share);
        expect(grantLevelLabel(null)).toBe('');
        expect(isKnownGrantLevel('view_edit')).toBe(false);
    });

    it('só o view_share anuncia a consequência do repasse', () => {
        expect(grantLevelDescription('view')).toMatch(/não pode repassá-lo/);
        expect(grantLevelDescription('view_share')).toMatch(/cai junto/);
        expect(grantLevelDescription('view_edit')).toMatch(/não sabe descrevê-lo/);
        expect(grantLevelDescription('view_edit')).toContain('view_edit');
        expect(grantLevelDescription(null)).toBe('');
    });

    it('os níveis ESPELHAM `GRANT_LEVELS` do catálogo, que é o contrato do servidor', () => {
        // Espelho e não import: `catalog.constants.js` importa `forma-3d.js` e é do mapa, e esta
        // página boota sem a store. O que não pode é divergir em silêncio.
        const src = readFileSync(resolve(FRONT, 'src/js/catalog/catalog.constants.js'), 'utf8');
        const bloco = src.match(/export const GRANT_LEVELS = Object\.freeze\(\[([\s\S]*?)\]\);/);
        expect(bloco, 'GRANT_LEVELS não foi encontrado em catalog.constants.js').not.toBeNull();
        const valores = [...bloco[1].matchAll(/value:\s*'([^']+)'/g)].map((m) => m[1]);
        // Controle de vácuo: uma varredura que casasse zero valores passaria verde sem provar nada.
        expect(valores.length).toBeGreaterThanOrEqual(2);
        expect(valores.sort()).toEqual(Object.keys(GRANT_LEVEL_LABELS).sort());
    });
});

describe('grant-phrases — a data curta', () => {
    it('formata em dd/mm/aaaa, com dois algarismos', () => {
        expect(shortDate(new Date(2026, 0, 5, 10))).toBe('05/01/2026');
        expect(shortDate(new Date(2026, 11, 31, 10))).toBe('31/12/2026');
    });

    it('ausência e lixo viram string vazia, nunca "Invalid Date"', () => {
        for (const ruim of [null, undefined, '', 'ontem', NaN, {}]) {
            expect(shortDate(ruim), String(ruim)).toBe('');
        }
    });
});

describe('grant-phrases — os dias até o vencimento, contados por CALENDÁRIO', () => {
    it('a virada do dia manda, e não a diferença de instantes', () => {
        // O caso que reprova a diferença de instantes: agora 23:00, vence amanhã 09:00. São
        // 0,4 dia de relógio e UM dia de calendário, e é o calendário que a pessoa lê.
        const tarde = new Date(2026, 7, 10, 23, 0, 0);
        const amanhaCedo = new Date(2026, 7, 11, 9, 0, 0);
        expect(daysUntilExpiry(amanhaCedo, tarde)).toBe(1);
        // E o simétrico: vence hoje às 00:30, olhado hoje às 23:00, ainda é HOJE (zero), e não -1.
        expect(daysUntilExpiry(new Date(2026, 7, 10, 0, 30), tarde)).toBe(0);
    });

    it('conta positivo, zero e negativo', () => {
        expect(daysUntilExpiry(emDias(30), AGORA)).toBe(30);
        expect(daysUntilExpiry(emDias(0), AGORA)).toBe(0);
        expect(daysUntilExpiry(emDias(-3), AGORA)).toBe(-3);
    });

    it('sem data utilizável devolve null, e não 0', () => {
        // A distinção é toda: 0 é "vence hoje" e null é "não sei". Colapsá-los faria a tela
        // anunciar um vencimento que o servidor nunca mandou.
        for (const ruim of [null, undefined, '', 'nunca', NaN]) {
            expect(daysUntilExpiry(ruim, AGORA), String(ruim)).toBeNull();
        }
        expect(daysUntilExpiry(emDias(1), 'ontem')).toBeNull();
    });

    it('atravessa a virada do mês e do ano', () => {
        expect(daysUntilExpiry(new Date(2027, 0, 1, 12), new Date(2026, 11, 31, 12))).toBe(1);
        expect(daysUntilExpiry(new Date(2026, 8, 1, 12), new Date(2026, 7, 31, 12))).toBe(1);
    });
});

describe('grant-phrases — os cinco estados do prazo', () => {
    it('classifica cada faixa, com os limites exatos', () => {
        expect(expiryState(emDias(-1), AGORA)).toBe(EXPIRY_STATE.VENCIDA);
        expect(expiryState(emDias(0), AGORA)).toBe(EXPIRY_STATE.HOJE);
        expect(expiryState(emDias(1), AGORA)).toBe(EXPIRY_STATE.PROXIMA);
        // O limite INCLUSIVO, e o primeiro dia fora dele: um `<` no lugar do `<=` moveria a
        // fronteira um dia, o que ninguém percebe olhando a tela.
        expect(expiryState(emDias(EXPIRY_SOON_DAYS), AGORA)).toBe(EXPIRY_STATE.PROXIMA);
        expect(expiryState(emDias(EXPIRY_SOON_DAYS + 1), AGORA)).toBe(EXPIRY_STATE.DISTANTE);
        expect(expiryState(null, AGORA)).toBe(EXPIRY_STATE.SEM_PRAZO);
    });

    it('os cinco estados são distintos: nenhum é apelido de outro', () => {
        expect(new Set(Object.values(EXPIRY_STATE)).size).toBe(5);
    });
});

describe('grant-phrases — o chip de prazo', () => {
    it('a linha vencida diz que já não vale, e cita a data', () => {
        const chip = expiryChip(emDias(-2), { now: AGORA, perspective: 'received' });
        expect(chip.state).toBe(EXPIRY_STATE.VENCIDA);
        expect(chip.label).toBe('Venceu em 08/08/2026');
        expect(chip.days).toBe(-2);
        expect(chip.title).toMatch(/sem aviso/);
    });

    it('a que vence hoje avisa que amanhã o recurso some', () => {
        const chip = expiryChip(emDias(0), { now: AGORA });
        expect(chip.label).toBe('Vence hoje (10/08/2026)');
        expect(chip.days).toBe(0);
        expect(chip.title).toMatch(/amanhã/);
    });

    it('a contagem regressiva CONCORDA em número, inclusive no singular', () => {
        // A mesma classe de deslize que `toCount` existe para impedir do outro lado: "faltam 1
        // dias" é o que sai de uma interpolação sem concordância.
        expect(expiryChip(emDias(1), { now: AGORA }).label).toBe('Vence em 11/08/2026 (falta 1 dia)');
        expect(expiryChip(emDias(3), { now: AGORA }).label).toBe('Vence em 13/08/2026 (faltam 3 dias)');
    });

    it('a distante não vira contagem regressiva', () => {
        const chip = expiryChip(emDias(200), { now: AGORA });
        expect(chip.state).toBe(EXPIRY_STATE.DISTANTE);
        expect(chip.label).toBe('Vence em 26/02/2027');
        expect(chip.label).not.toMatch(/falta/);
    });

    it('SEM prazo diz que é falta de informação, e NÃO acesso permanente', () => {
        const chip = expiryChip(null, { now: AGORA });
        expect(chip.state).toBe(EXPIRY_STATE.SEM_PRAZO);
        expect(chip.days).toBeNull();
        expect(chip.label).toBe('Sem prazo registrado');
        expect(chip.title).toMatch(/não acesso permanente/);
        expect(chip.title).toMatch(/falta de informação/);
    });

    it('a PERSPECTIVA muda a frase e nunca o estado', () => {
        const recebido = expiryChip(emDias(3), { now: AGORA, perspective: 'received' });
        const concedido = expiryChip(emDias(3), { now: AGORA, perspective: 'issued' });
        expect(concedido.state).toBe(recebido.state);
        expect(concedido.label).toBe(recebido.label);
        expect(concedido.title).not.toBe(recebido.title);
        // Quem RECEBEU precisa saber que o recurso some do catálogo dele; quem concedeu precisa
        // saber como renovar. Números de controle absolutos, e não só "são diferentes".
        expect(recebido.title).toMatch(/seu catálogo/);
        expect(concedido.title).toMatch(/[Cc]onceda de novo/);
    });

    it('o padrão da perspectiva é a de quem RECEBEU, que é o lado novo do produto', () => {
        expect(expiryChip(emDias(3), { now: AGORA }).title)
            .toBe(expiryChip(emDias(3), { now: AGORA, perspective: 'received' }).title);
    });
});

describe('grant-phrases — beneficiário, concedente e caminho de grupo', () => {
    it('o coletivo é distinguido pelo CAMPO, não pela ausência de nome', () => {
        expect(isGroupGrant({ granteeKind: 'group' })).toBe(true);
        expect(isGroupGrant({ granteeKind: 'user' })).toBe(false);
        expect(isGroupGrant({})).toBe(false);
        expect(isGroupGrant(null)).toBe(false);
    });

    it('o nome do beneficiário cai para o genérico CERTO de cada natureza', () => {
        expect(granteeLabel({ granteeKind: 'group', granteeName: 'Equipe Alfa' })).toBe('Equipe Alfa');
        // Um grupo sem nome não pode virar "Usuário": foi o defeito real que `granteeName`
        // (`catalog/grant-tree.js`) já pagou, chamando um grupo de doze pessoas de "Usuário".
        expect(granteeLabel({ granteeKind: 'group' })).toBe('Grupo');
        expect(granteeLabel({ granteeKind: 'user' })).toBe('Usuário');
        expect(granteeLabel({ granteeKind: 'user', granteeName: '  Ana  ' })).toBe('Ana');
    });

    it('só o COLETIVO recebe a nota de delegação, e é o contraste que a faz informar', () => {
        const nota = granteeGroupNotice({ granteeKind: 'group', granteeName: 'Equipe Alfa' });
        expect(nota).toContain('Equipe Alfa');
        expect(nota).toMatch(/sem passar por você/);
        expect(granteeGroupNotice({ granteeKind: 'user', granteeName: 'Ana' })).toBe('');
    });

    it('concessão sem concedente diz "pelo sistema", e não um travessão', () => {
        expect(grantorLabel({ grantorName: 'Cap Silva' })).toBe('Cap Silva');
        // `granted_by` nulo é a concessão da administração. "Pelo sistema" responde a quem NÃO
        // pedir renovação, e um travessão não responde nada.
        expect(grantorLabel({})).toBe('Concedido pelo sistema');
        expect(grantorLabel({ grantorName: '   ' })).toBe('Concedido pelo sistema');
    });

    it('viaGroup nomeia o grupo E anuncia a perda ao sair dele', () => {
        expect(viaGroupLabel({ id: 'g1', name: 'Equipe Alfa' })).toBe('Pelo grupo "Equipe Alfa"');
        const nota = viaGroupNotice({ id: 'g1', name: 'Equipe Alfa' });
        expect(nota).toContain('Equipe Alfa');
        // A CONSEQUÊNCIA que ninguém adivinha: não há linha em `resource_grants` para revogar nem
        // para renovar, e o acesso cai junto com a membresia.
        expect(nota).toMatch(/sair do grupo|tirar você dele/);
    });

    it('acesso DIRETO não ganha rótulo de grupo nenhum', () => {
        for (const vazio of [null, undefined]) {
            expect(viaGroupLabel(vazio), String(vazio)).toBe('');
            expect(viaGroupNotice(vazio), String(vazio)).toBe('');
        }
    });

    it('grupo sem nome ainda diz que HÁ um grupo, em vez de sumir', () => {
        expect(viaGroupLabel({ id: 'g1' })).toBe('Por um grupo');
        expect(viaGroupNotice({ id: 'g1' })).toMatch(/membro do grupo/);
    });
});

describe('grant-phrases — revogar daqui', () => {
    it('o aviso NÃO inventa número, e nomeia recurso e beneficiário', () => {
        const aviso = issuedRevocationWarning({
            resourceName: 'Ortofoto Sul', granteeKind: 'user', granteeName: 'Ana',
        });
        expect(aviso).toContain('Ortofoto Sul');
        expect(aviso).toContain('Ana');
        expect(aviso).toMatch(/não sabe quantos acessos caem/);
        // Fabricar aritmética é o defeito exato que o irmão `leaveGroupWarning` evita: esta lista
        // é de recursos diferentes e não carrega árvore nenhuma.
        expect(aviso).not.toMatch(/\d+ concess/);
    });

    it('revogar de um GRUPO diz que alcança todo mundo lá dentro', () => {
        const aviso = issuedRevocationWarning({
            resourceName: 'Ortofoto Sul', granteeKind: 'group', granteeName: 'Equipe Alfa',
        });
        expect(aviso).toMatch(/todas as pessoas que estão dentro/);
        expect(aviso).toContain('Equipe Alfa');
    });

    it('o toast usa os números do SERVIDOR, e junta reparented com trimmed', () => {
        // Do ponto de vista de quem revogou, "reparentada" e "aparada" são a mesma notícia:
        // continua com acesso. É a divisão de `catalog/resource-share.modal.js`.
        expect(issuedRevocationSummary({ revoked: [1, 2, 3], reparented: [4], trimmed: [5] }))
            .toBe('Acesso removido. 3 concessões caíram junto. 2 concessões foram mantidas por outro caminho de acesso.');
        expect(issuedRevocationSummary({ revoked: [1], reparented: [2] }))
            .toBe('Acesso removido. 1 concessão foi mantida por outro caminho de acesso.');
    });

    it('o caso comum não vira susto: zero não é anunciado', () => {
        expect(issuedRevocationSummary({ revoked: [1] })).toBe('Acesso removido.');
        expect(issuedRevocationSummary({})).toBe('Acesso removido.');
        expect(issuedRevocationSummary(null)).toBe('Acesso removido.');
        // Payload malformado (o servidor mandando número onde a tela espera lista) não pode virar
        // "NaN concessões".
        expect(issuedRevocationSummary({ revoked: 3, reparented: 'x' })).toBe('Acesso removido.');
    });
});

describe('grant-phrases — vazio, falha e escopo dizem coisas DIFERENTES', () => {
    it('a falha nunca se parece com lista vazia', () => {
        // A distinção é a mesma de `groupsLoadFailureNotice`: quem lê a frase de vazio depois de um
        // erro conclui que não tem acesso nenhum, o que é afirmar uma coisa falsa.
        for (const falha of [issuedFailureNotice(), receivedFailureNotice()]) {
            expect(falha).toMatch(/não ausência/);
        }
        expect(issuedEmptyNotice()).not.toMatch(/servidor/);
        expect(receivedEmptyNotice()).not.toMatch(/servidor/);
        // E os dois lados não trocam de frase entre si.
        expect(issuedFailureNotice()).not.toBe(receivedFailureNotice());
        expect(issuedEmptyNotice()).not.toBe(receivedEmptyNotice());
    });

    it('a nota de escopo diz o que a aba NÃO mostra', () => {
        const nota = grantsScopeNotice();
        expect(nota).toMatch(/papel/);
        expect(nota).toMatch(/público/);
        expect(nota).toMatch(/atlas/);
    });

    it('a nota de prazo nomeia o silêncio, que é o fato do lado recebido', () => {
        expect(receivedExpiryNotice()).toMatch(/sem aviso/);
    });

    it('a recusa de revogar do lado recebido oferece a saída real', () => {
        // Negativa sem saída é só um muro: a saída aqui é pedir a quem concedeu.
        expect(receivedNotRevocableNotice()).toMatch(/peça a quem concedeu/);
    });
});

describe('grant-phrases — a propriedade estrutural que a função pura não prova', () => {
    it('o módulo é FOLHA: zero imports, senão `admin.html` arrasta a store', () => {
        const src = readFileSync(resolve(FRONT, 'src/js/admin/grant-phrases.js'), 'utf8');
        expect(src).not.toMatch(/^\s*import\s/m);
        expect(src).not.toMatch(/\brequire\s*\(/);
    });
});
