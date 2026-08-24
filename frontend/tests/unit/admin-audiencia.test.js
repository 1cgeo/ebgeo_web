// Path: tests/unit/admin-audiencia.test.js

/**
 * @fileoverview AS QUATRO AUDIÊNCIAS DE `admin.html`, e o fato de serem UMA definição.
 *
 * A regra ("quem abre a página, com que rótulo, com quais abas") viveu copiada em quatro
 * sítios: a montagem do painel, o gate da página, a barra do mapa e o seletor de atlas. Quatro
 * cópias de uma regra que muda produzem uma divergência que nenhum teste de comportamento pega,
 * porque cada tela continua funcionando: a entrada aparece em `atlas.html` e falta no mapa, ou
 * aparece com dois rótulos. Desde 2026-08-20 a definição é `admin/admin-audience.js`.
 *
 * O PISO desta suíte é o usuário comum AUTENTICADO: até aqui os quatro sítios devolviam `null`
 * e nenhuma aba para ele, e a página o mandava de volta para o mapa. Ele passa a receber
 * "Grupos", porque o grupo de acesso virou entidade de usuário e ele administra os dele.
 *
 * A DISCRIMINAÇÃO é o resto da tabela, em asserção ABSOLUTA (igualdade do array inteiro, não
 * `toContain`): um predicado quebrado que devolvesse tudo para todo mundo passaria verde numa
 * asserção de presença. O anônimo continua sem porta, o administrador tem as seis abas
 * nomeadas e o produtor tem `catalog`, `groups` e `audit`.
 *
 * E O CREDENCIADO NÃO TEM LINHA: ele cai na audiência de qualquer autenticado. Isso é a
 * decisão D1 de 2026-08-20 (o eixo de GRUPO deixou de ser papel global) e é medido de duas
 * formas, porque a igualdade sozinha seria satisfeita por acidente: os quatro sítios não podem
 * mais consultar `hasGlobalDataAccess()` para decidir tela.
 *
 * As asserções ESTRUTURAIS não são higiene: a função pura seria verde para sempre mesmo que os
 * sítios voltassem a decidir sozinhos, que é exatamente o defeito que ela existe para impedir.
 * E os sítios são VARRIDOS do versionamento, não escritos à mão: a primeira versão desta suíte
 * trazia uma lista de quatro caminhos com um "se nascer um quinto, ele entra aqui", que é a
 * forma exata de conferir um subconjunto e tratar como o conjunto.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminAudience } from '../../src/js/admin/admin-audience.js';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = resolve(FRONT, 'src');

/** @param {string} rel @returns {string} */
function fonte(rel) {
    return readFileSync(resolve(FRONT, rel), 'utf8');
}

/** Remove comentários (a varredura mede CÓDIGO: prosa que cita a página não é sítio). */
const semComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * O que faz de um arquivo um SÍTIO DE AUDIÊNCIA: ele leva alguém a `admin.html`, ou
 * escreve o rótulo da porta. Os dois casos são a mesma decisão vista de dois lados, e é
 * a divergência entre eles (a entrada aparece no mapa e não em `atlas.html`, ou com dois
 * rótulos) que a definição única existe para impedir.
 */
const GATILHO = /admin\.html|Administração/;

/**
 * O SEGUNDO gatilho, e ele existe por um efeito colateral que custou um vermelho para aparecer.
 *
 * O gatilho acima acha o sítio pelo LITERAL da porta, e essa é a sua força: quem escreve o rótulo
 * à mão é exatamente quem pode divergir. Mas ele tem o avesso: um sítio que PARA de conter o
 * literal some da varredura, e some em silêncio. Foi o que aconteceu com `admin/admin-page.js`
 * quando o título provisório da aba deixou de dizer "Administração" (o produtor lia a palavra do
 * administrador durante todo o boot). O arquivo continuou sendo o gate de rota da página, continuou
 * consumindo a definição, e a varredura simplesmente parou de vigiá-lo.
 *
 * Daí o segundo sinal: quem IMPORTA a definição também é sítio. Ele não substitui o primeiro, e as
 * duas asserções abaixo continuam separadas de propósito: o piso conta o conjunto INTEIRO, e a
 * cobrança de consumo mede só quem entrou pelo literal, senão ela se provaria a si mesma.
 */
const GATILHO_DE_CONSUMO = /from '[^']*admin-audience\.js'/;

/**
 * Os DOIS que casam o gatilho e NÃO consomem a função, com o motivo escrito.
 *
 * Sem motivo escrito uma allowlist é só a lista à mão de volta, com um nome melhor.
 */
const DISPENSADOS = Object.freeze({
    'src/js/admin/admin-audience.js':
        'É a definição. Ela escreve os rótulos, e não pode importar a si mesma.',
    'src/js/admin/admin-panel.js':
        'Componente burro: recebe `title` por parâmetro e só tem "Administração" como '
        + 'default de construtor. Quem decide o título é `mountAdminPage`, que consome a função.',
    'src/js/modals/create-atlas.modal.js':
        'Cita "Administração" numa FRASE DE AJUDA ("Você não administra nenhum grupo. Crie um em '
        + 'Administração > Grupos"), e não numa decisão sobre quem vê a porta: o modal não '
        + 'desenha link nenhum para lá e não mede audiência. É o falso positivo que o gatilho por '
        + 'LITERAL compra junto com a força dele, e classificá-lo é mais barato que reescrever a '
        + 'frase para fugir da varredura, o que ensinaria a próxima pessoa a fazer o mesmo.',
});

/**
 * OS SÍTIOS SÃO DERIVADOS DO VERSIONAMENTO, e não escritos à mão.
 *
 * A versão anterior desta constante era uma lista de quatro caminhos com o comentário
 * "se nascer um quinto, ele entra aqui" — isto é, conferir um subconjunto e tratar como
 * o conjunto, que é a classe mais cara do livro-razão. Um quinto sítio que decidisse a
 * porta sozinho passaria verde para sempre. Derivado, ele reprova sozinho: ou importa a
 * definição, ou entra em `DISPENSADOS` com motivo.
 * @returns {string[]}
 */
function varrerSitios() {
    const saida = execSync('git ls-files --cached --others --exclude-standard "*.js"',
        { cwd: SRC, encoding: 'utf8' });
    return saida.split('\n').map((l) => l.trim().replace(/\\/g, '/')).filter(Boolean)
        .map((rel) => `src/${rel}`)
        .filter((rel) => {
            const codigo = semComentarios(fonte(rel));
            return GATILHO.test(codigo) || GATILHO_DE_CONSUMO.test(codigo);
        })
        .sort();
}

const VARRIDOS = varrerSitios();
const SITIOS = VARRIDOS.filter((rel) => !(rel in DISPENSADOS));
/**
 * Os que entraram pelo LITERAL da porta. É este recorte, e não `SITIOS`, que a asserção de consumo
 * cobra: um arquivo varrido por importar a definição já a consome por construção, e cobrá-lo seria
 * a cobertura vazia que este arquivo inteiro existe para não ter.
 */
const SITIOS_POR_LITERAL = SITIOS.filter((rel) => GATILHO.test(semComentarios(fonte(rel))));

const ADMIN = { isAuthenticated: true, isAdmin: true, isProducer: false };
const PRODUTOR = { isAuthenticated: true, isAdmin: false, isProducer: true };
const COMUM = { isAuthenticated: true, isAdmin: false, isProducer: false };
const ANONIMO = { isAuthenticated: false, isAdmin: false, isProducer: false };

describe('adminAudience — a tabela das quatro audiências', () => {
    it('o usuário comum AUTENTICADO passa a receber a aba Grupos (o piso da mudança)', () => {
        expect(adminAudience(COMUM)).toEqual({ label: 'Grupos', tabIds: ['groups'] });
    });

    it('o anônimo não tem porta nenhuma', () => {
        expect(adminAudience(ANONIMO)).toEqual({ label: null, tabIds: [] });
        // Sem argumento nenhum (chamador que esqueceu de ler a sessão) falha FECHADO.
        expect(adminAudience()).toEqual({ label: null, tabIds: [] });
    });

    it('o administrador tem as SEIS abas, com Auditoria por último', () => {
        expect(adminAudience(ADMIN)).toEqual({
            label: 'Administração',
            tabIds: ['users', 'groups', 'config', 'catalog', 'personnel', 'audit'],
        });
    });

    it('o produtor mantém Catálogo, Grupos, e GANHA Auditoria', () => {
        // A trilha dele é recortada NO SERVIDOR (`requireAuditReader` + o recorte de
        // `listAudit`): a aba é a mesma, o conteúdo é o da OM dele.
        expect(adminAudience(PRODUTOR)).toEqual({
            label: 'Catálogo',
            tabIds: ['catalog', 'groups', 'audit'],
        });
    });

    it('o credenciado NÃO ganha Auditoria: ele lê acervo, não a trilha do sistema', () => {
        // No cliente o credenciado é uma sessão autenticada que não é admin nem produtor,
        // e é a AUSÊNCIA de `audit` aqui que espelha o 403 do gate do servidor. Oferecer a
        // aba seria a pior forma de dizer não.
        expect(adminAudience(COMUM).tabIds).not.toContain('audit');
        // A discriminação: quem TEM a aba continua tendo, senão um recorte quebrado que
        // zerasse `audit` para todo mundo passaria verde nesta linha.
        expect(adminAudience(PRODUTOR).tabIds).toContain('audit');
        expect(adminAudience(ADMIN).tabIds).toContain('audit');
    });

    it('a ORDEM fail-open é deliberada: papel sem sessão devolve o painel, e não null', () => {
        // `isAdmin` é testado ANTES de `isAuthenticated` de propósito (está comentado na
        // função): um `false` acidental na leitura da sessão não pode esconder o painel de
        // um administrador. O estado é impossível hoje (`sessionContext.isAdmin()` pressupõe
        // sessão) e esta asserção não o abençoa como caminho: ela PRENDE a ordem, para que
        // um refactor que reordene as três linhas fique vermelho num sentido ou no outro.
        // Nada aqui é fronteira de segurança: quem gateia é o servidor.
        expect(adminAudience({ isAuthenticated: false, isAdmin: true })).toEqual({
            label: 'Administração',
            tabIds: ['users', 'groups', 'config', 'catalog', 'personnel', 'audit'],
        });
        // A discriminação: o produtor NÃO tem a mesma robustez, porque ele é testado depois
        // da sessão. Trocar as duas linhas quebraria a asserção de cima ou esta.
        expect(adminAudience({ isAuthenticated: false, isProducer: true }))
            .toEqual({ label: null, tabIds: [] });
    });

    it('administrador que também produz continua administrador, e não perde três abas', () => {
        expect(adminAudience({ isAuthenticated: true, isAdmin: true, isProducer: true }))
            .toEqual(adminAudience(ADMIN));
    });

    it('o credenciado cai na audiência do autenticado comum (D1: o eixo de grupo é posse)', () => {
        // No cliente, o credenciado é uma sessão autenticada que não é administrador nem
        // produtor. Não há terceiro booleano a passar, e é essa ausência que é a decisão.
        expect(adminAudience(COMUM)).toEqual({ label: 'Grupos', tabIds: ['groups'] });
        expect(adminAudience(COMUM)).not.toEqual(adminAudience(ADMIN));
    });

    it('cada chamada devolve um array próprio: filtrar o de um chamador não contamina o outro', () => {
        const primeiro = adminAudience(ADMIN);
        primeiro.tabIds.length = 0;
        expect(adminAudience(ADMIN).tabIds)
            .toEqual(['users', 'groups', 'config', 'catalog', 'personnel', 'audit']);
    });
});

describe('adminAudience — as propriedades estruturais que a função pura não prova', () => {
    it('o módulo é FOLHA: zero imports, senão as páginas sem mapa arrastam a store', () => {
        const src = fonte('src/js/admin/admin-audience.js');
        expect(src).not.toMatch(/^\s*import\s/m);
        expect(src).not.toMatch(/\brequire\s*\(/);
    });

    it('a varredura acha alguma coisa, e os dispensados existem (piso da derivação)', () => {
        // Cobertura vazia passa verde: um `git ls-files` que falhasse, ou um gatilho que
        // parasse de casar, deixariam as duas asserções abaixo trivialmente satisfeitas.
        expect(VARRIDOS.length, 'a varredura não achou sítio nenhum').toBeGreaterThanOrEqual(4);
        expect(SITIOS.length, 'todos os sítios foram dispensados').toBeGreaterThanOrEqual(4);
        // E o recorte por literal não pode esvaziar: se ele zerar, a asserção seguinte deixa de
        // medir o que a definição única existe para impedir, sem ficar vermelha.
        expect(SITIOS_POR_LITERAL.length, 'nenhum sítio escreve o rótulo da porta')
            .toBeGreaterThanOrEqual(3);
        for (const rel of Object.keys(DISPENSADOS)) {
            expect(VARRIDOS, `${rel} saiu da varredura: a dispensa virou entrada morta`)
                .toContain(rel);
        }
    });

    it('TODO sítio varrido consome a definição única', () => {
        for (const rel of SITIOS) {
            expect(fonte(rel), rel).toMatch(/import \{ adminAudience \} from '[^']*admin-audience\.js'/);
        }
    });

    it('nenhum dos quatro decide tela por hasGlobalDataAccess: o eixo de grupo virou posse', () => {
        // O controle de vácuo desta asserção é o próprio consumidor vivo do método: ele continua
        // decidindo o eixo de RECURSO em `resource-access.service.js`, e ali TEM de aparecer.
        for (const rel of SITIOS) {
            expect(fonte(rel), rel).not.toContain('hasGlobalDataAccess');
        }
        expect(fonte('src/js/store/sync/resource-access.service.js')).toContain('hasGlobalDataAccess');
    });

    it('todo id de aba oferecido tem fábrica, e toda fábrica é oferecida a alguém', () => {
        // O `.filter(Boolean)` de `mountAdminPage` engole um id sem fábrica em silêncio: a aba
        // simplesmente não aparece. Este é o par que fecha os dois lados.
        const oferecidos = new Set([
            ...adminAudience(ADMIN).tabIds,
            ...adminAudience(PRODUTOR).tabIds,
            ...adminAudience(COMUM).tabIds,
        ]);
        const bloco = fonte('src/js/admin/index.js').match(/TAB_FACTORIES = Object\.freeze\(\{([^}]*)\}/);
        expect(bloco).not.toBeNull();
        const comFabrica = [...bloco[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
        expect(comFabrica.length).toBeGreaterThan(0);
        expect([...oferecidos].sort()).toEqual([...comFabrica].sort());
    });
});
