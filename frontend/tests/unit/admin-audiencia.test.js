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
 * asserção de presença. O anônimo continua sem porta, o administrador tem as DEZ abas
 * nomeadas e o produtor tem `catalog`, `groups`, `grants`, `audit` e `account`.
 *
 * `diagnostico` ENTROU EM 2026-08-30 e é a mais RECORTADA da tabela, ao lado de `users`, `config`
 * e `personnel`: só o administrador global. As quatro rotas de `/diag` exigem administração do
 * sistema, e o recorte no cliente existe para que ninguém bata em 403 na montagem. O controle
 * NEGATIVO dela é a linha do produtor: ele tem `audit`, que é a outra aba de consulta, e é
 * justamente por isso que a ausência de `diagnostico` na lista dele mede alguma coisa. Um recorte
 * quebrado que desse a aba a todo mundo continuaria verde numa asserção de presença sobre a linha
 * do administrador, e é por isso que as duas asserções (a igualdade absoluta e o `not.toContain`
 * das outras três audiências) andam juntas.
 *
 * `grants` PASSOU A SER UNIVERSAL entre as três audiências que abrem a porta (2026-08-24, o
 * fechamento da pendência declarada no mesmo dia), e as demais continuam recortadas. O rótulo
 * das três NÃO mudou com ela, e isso tem asserção própria: a regra do módulo protege contra
 * prometer poder a mais, e "Catálogo" com quatro abas erra para o outro lado.
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
    'src/js/session/erro-telemetria-assinatura.js':
        'Cita `admin.html` como CHAVE de uma tabela que traduz `location.pathname` no nome da '
        + 'página para a telemetria de erro ("qual das quatro páginas quebrou"). Ele não leva '
        + 'ninguém a lugar nenhum, não desenha porta e não mede audiência: nomear as quatro '
        + 'páginas é o oposto de decidir quem entra numa delas. Mesmo caso do modal abaixo, e '
        + 'classificar é mais barato que torcer o código para escapar da varredura.',
    'src/js/admin/defeito-phrases.js':
        'Cita "Administração" como RÓTULO de `admin.html` na lista `PAGINAS`, que é o seletor de '
        + 'página do filtro de defeitos ("em qual das quatro páginas isto quebrou"). Mesmo caso, '
        + 'palavra por palavra, de `erro-telemetria-assinatura.js` acima: nomear as quatro '
        + 'páginas é o oposto de decidir quem entra numa delas. O módulo é folha de zero imports '
        + 'por contrato, então consumir a definição aqui seria justamente o que ele não pode.',
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
    it('o usuário comum AUTENTICADO recebe Grupos e Concessões, sob o rótulo "Acessos"', () => {
        // ESTA LINHA MUDOU EM 2026-08-24, e o rótulo mudou COM as abas, que é a regra do módulo em
        // ação: ele nomeia o que a pessoa RECEBE, e "Grupos" deixou de nomear uma página que também
        // lista concessões. A aba nova é o inventário do que a pessoa concedeu e do que concederam
        // a ela, e o caso que a motivou é o do CREDENCIADO, que cai justamente nesta linha: papel
        // definido por conceder, sem trilha de auditoria (decisão registrada) e, até aqui, sem
        // nenhuma tela que listasse o que ele havia concedido.
        expect(adminAudience(COMUM)).toEqual({
            label: 'Acessos',
            tabIds: ['groups', 'grants', 'account'],
        });
    });

    it('DUAS abas são universais entre as três audiências da porta: concessões e a conta', () => {
        // ESTA ASSERÇÃO INVERTEU EM 2026-08-24 e ganhou a SEGUNDA universal em 2026-08-25.
        // `grants`: a versão de 2026-08-24 fechou a pendência que dizia que administrador e
        // produtor não precisavam da aba porque `audit` já seria o inventário deles. A trilha
        // registra ATO e o inventário registra ESTADO (prazo, revogar, renovar), e do lado
        // RECEBIDO a trilha é muda para os dois: para o produtor por construção, porque o recorte
        // do servidor é pela OM DONA DO RECURSO.
        // `account`: "Minha conta" deixou de ser modal e virou aba, e o critério é trivial, que é
        // o que o torna seguro: quem entrou tem conta.
        for (const audiencia of [ADMIN, PRODUTOR, COMUM]) {
            expect(adminAudience(audiencia).tabIds).toContain('grants');
            expect(adminAudience(audiencia).tabIds).toContain('account');
        }
        // A DISCRIMINAÇÃO, senão um predicado quebrado que devolvesse todas as abas para todo
        // mundo passaria verde nas linhas acima. Só essas DUAS são universais: as outras seis
        // continuam recortadas, e é o recorte que impede o 403 na montagem.
        expect(adminAudience(COMUM).tabIds).not.toContain('users');
        expect(adminAudience(COMUM).tabIds).not.toContain('audit');
        expect(adminAudience(PRODUTOR).tabIds).not.toContain('users');
        expect(adminAudience(ANONIMO).tabIds).not.toContain('grants');
        // E universal NÃO alcança quem não abre a porta: o anônimo não tem conta a mostrar.
        expect(adminAudience(ANONIMO).tabIds).not.toContain('account');
    });

    it('"Minha conta" é a ÚLTIMA de cada lista: a primeira aba é a que o painel abre', () => {
        // A ORDEM É CONTRATO, e aqui ela é a decisão registrada: ninguém abre o painel para ler o
        // próprio nome. É a mesma régua que pôs `audit` e `grants` no fim da linha do
        // administrador. Sem esta asserção, uma inserção descuidada no topo da lista faria a aba
        // de conta virar a tela de abertura das TRÊS audiências, sem nada ficar vermelho.
        for (const audiencia of [ADMIN, PRODUTOR, COMUM]) {
            const abas = adminAudience(audiencia).tabIds;
            expect(abas[abas.length - 1]).toBe('account');
        }
    });

    it('a aba nova NÃO mexeu no rótulo de ninguém, e isso é a decisão', () => {
        // A regra do módulo ("o rótulo nomeia o que a pessoa RECEBE") existe contra a promessa
        // EXCESSIVA. "Catálogo" com quatro abas erra para o outro lado, e o centro de gravidade
        // do produtor continua sendo o acervo que ele mantém, que é a primeira aba dele e a única
        // onde ele cria coisa. O caso do credenciado foi o oposto (a decisão de 2026-08-24 que
        // trocou "Grupos" por "Acessos"): lá o rótulo nomeava a metade que NÃO é a razão de ele
        // abrir a página. Se alguém renomear a porta do produtor, que seja por decisão escrita e
        // não por arrasto de uma aba nova.
        expect(adminAudience(ADMIN).label).toBe('Administração');
        expect(adminAudience(PRODUTOR).label).toBe('Catálogo');
        expect(adminAudience(COMUM).label).toBe('Acessos');
    });

    it('o anônimo não tem porta nenhuma', () => {
        expect(adminAudience(ANONIMO)).toEqual({ label: null, tabIds: [] });
        // Sem argumento nenhum (chamador que esqueceu de ler a sessão) falha FECHADO.
        expect(adminAudience()).toEqual({ label: null, tabIds: [] });
    });

    it('o administrador tem as DEZ abas, com as consultas e Minha conta no fim', () => {
        // A ORDEM É CONTRATO (é a de montagem, e a primeira aba é a que o painel abre): as duas
        // de CONSULTA ficam no fim, e entre elas a pessoal vem antes da do sistema.
        expect(adminAudience(ADMIN)).toEqual({
            label: 'Administração',
            tabIds: ['users', 'groups', 'config', 'catalog', 'personnel', 'grants', 'audit',
                'diagnostico', 'uso', 'account'],
        });
    });

    it('o produtor mantém Catálogo e Grupos, e GANHA Concessões e Auditoria', () => {
        // A trilha dele é recortada NO SERVIDOR (`requireAuditReader` + o recorte de
        // `listAudit`): a aba é a mesma, o conteúdo é o da OM dele. É esse recorte que torna
        // `grants` necessária e não redundante para ele.
        expect(adminAudience(PRODUTOR)).toEqual({
            label: 'Catálogo',
            tabIds: ['catalog', 'groups', 'grants', 'audit', 'account'],
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
            tabIds: ['users', 'groups', 'config', 'catalog', 'personnel', 'grants', 'audit',
                'diagnostico', 'uso', 'account'],
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
        expect(adminAudience(COMUM)).toEqual({
            label: 'Acessos',
            tabIds: ['groups', 'grants', 'account'],
        });
        expect(adminAudience(COMUM)).not.toEqual(adminAudience(ADMIN));
    });

    it('cada chamada devolve um array próprio: filtrar o de um chamador não contamina o outro', () => {
        const primeiro = adminAudience(ADMIN);
        primeiro.tabIds.length = 0;
        expect(adminAudience(ADMIN).tabIds)
            .toEqual(['users', 'groups', 'config', 'catalog', 'personnel', 'grants', 'audit',
                'diagnostico', 'uso', 'account']);
    });

    it('só o administrador tem Diagnóstico: as quatro rotas de /diag exigem administração', () => {
        // A aba nasceu em 2026-08-30 e é do administrador e de mais ninguém. O recorte no cliente
        // não é a fronteira de segurança (o servidor gateia as quatro rotas), e existe para que
        // produtor e credenciado não batam num 403 na PRIMEIRA requisição da aba, que é a pior
        // forma de dizer não: é a mesma razão de `users`, `config` e `personnel`.
        expect(adminAudience(ADMIN).tabIds).toContain('diagnostico');
        expect(adminAudience(PRODUTOR).tabIds).not.toContain('diagnostico');
        expect(adminAudience(COMUM).tabIds).not.toContain('diagnostico');
        expect(adminAudience(ANONIMO).tabIds).not.toContain('diagnostico');
        // O CONTROLE NEGATIVO: o produtor tem a OUTRA aba de consulta, então a ausência acima não
        // é o efeito de ele simplesmente não ter consulta nenhuma. Sem esta linha, um recorte que
        // zerasse todas as abas de consulta do produtor deixaria as três de cima verdes.
        expect(adminAudience(PRODUTOR).tabIds).toContain('audit');
    });

    it('só o administrador tem Uso: o censo do produto não tem recorte por OM', () => {
        // A aba nasceu em 2026-08-30 e é do administrador e de mais ninguém. Aqui o recorte no
        // cliente não é só a cortesia de evitar o 403 na montagem, que é a razão de `diagnostico`:
        // o que a aba mostra é o CENSO do produto inteiro (todas as contas, todos os atlas, todo o
        // volume), sem recorte por OM. Não existe versão dela que faça sentido para um produtor,
        // ao contrário de `audit`, que o servidor sabe recortar pela OM dona do recurso.
        expect(adminAudience(ADMIN).tabIds).toContain('uso');
        expect(adminAudience(PRODUTOR).tabIds).not.toContain('uso');
        expect(adminAudience(COMUM).tabIds).not.toContain('uso');
        expect(adminAudience(ANONIMO).tabIds).not.toContain('uso');
        // O CONTROLE NEGATIVO, o mesmo de `diagnostico`: o produtor TEM a outra aba de consulta,
        // então a ausência acima não é o efeito de ele não ter consulta nenhuma. Sem esta linha,
        // um recorte que zerasse toda consulta do produtor deixaria as três de cima verdes.
        expect(adminAudience(PRODUTOR).tabIds).toContain('audit');
    });

    it('Uso é a última CONSULTA: é a única aba do painel sem um único botão', () => {
        // A régua da lista é "quem abre o painel vem quase sempre para agir", e ela ordena as
        // consultas entre si: `grants` (pessoal, e com dois atos) vem antes das do sistema, `audit`
        // e `diagnostico` levam a um ato fora da tela, e `uso` é panorama pelo panorama. Esta
        // asserção prende a posição RELATIVA, e não o índice, para que uma aba nova de gestão
        // entrando no topo não a quebre por nada.
        const abas = adminAudience(ADMIN).tabIds;
        expect(abas.indexOf('uso')).toBeGreaterThan(abas.indexOf('diagnostico'));
        expect(abas.indexOf('uso')).toBeGreaterThan(abas.indexOf('audit'));
        expect(abas.indexOf('uso')).toBeLessThan(abas.indexOf('account'));
    });

    it('Diagnóstico é CONSULTA e fica com as consultas, antes só de Minha conta', () => {
        // A ORDEM É A DE MONTAGEM, e a primeira aba é a que o painel abre: ninguém abre o painel
        // para ler um gráfico de erros. Esta asserção prende a posição RELATIVA, e não o índice,
        // para que uma aba nova de gestão entrando no topo não a quebre por nada.
        const abas = adminAudience(ADMIN).tabIds;
        expect(abas.indexOf('diagnostico')).toBeGreaterThan(abas.indexOf('grants'));
        expect(abas.indexOf('diagnostico')).toBeGreaterThan(abas.indexOf('audit'));
        expect(abas.indexOf('diagnostico')).toBeLessThan(abas.indexOf('account'));
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

    /**
     * Os sítios varridos onde `hasGlobalDataAccess` é LEGÍTIMO, com o motivo escrito.
     *
     * Sem esta lista, a alternativa seria estreitar a varredura, e é o negócio errado: uma regra
     * que deixa de olhar um arquivo inteiro para acomodar um uso legítimo perde junto todos os
     * usos ilegítimos daquele arquivo. Exceção nomeada, com razão, na hora em que nasce.
     */
    const HAS_GLOBAL_DATA_ACCESS_AUTORIZADO = Object.freeze({
        'src/js/account/account.control.js':
            'NÃO decide tela: decide se, ao ENTRAR, a pessoa lê que o acervo privado dela voltou '
            + 'a aparecer no catálogo. Sair apaga a soma aditiva de `refreshVisibleResources` sem '
            + 'perguntar (decisão do dono, 2026-08-24: a saída não pergunta, a volta avisa), e a '
            + 'frase só faz sentido para quem TEM acervo privado — que é exatamente a pergunta '
            + 'que este método responde, no eixo de RECURSO. Nenhuma porta, aba ou rótulo depende '
            + 'dele aqui.',
    });

    it('nenhum dos quatro decide tela por hasGlobalDataAccess: o eixo de grupo virou posse', () => {
        // O controle de vácuo desta asserção é o próprio consumidor vivo do método: ele continua
        // decidindo o eixo de RECURSO em `resource-access.service.js`, e ali TEM de aparecer.
        // SOBRE CÓDIGO, NÃO SOBRE PROSA: `semComentarios` já existe neste arquivo e é usado nas
        // demais varreduras pela mesma razão. Um comentário que NOMEIA o método para explicar por
        // que ele seria errado ali (e há um, em `catalog/resource-share.modal.js`, descrevendo a
        // janela do token) não é um sítio de decisão; acusá-lo ensina a apagar a explicação, que
        // é o contrário do que este guarda quer.
        for (const rel of SITIOS) {
            if (HAS_GLOBAL_DATA_ACCESS_AUTORIZADO[rel]) continue;
            expect(semComentarios(fonte(rel)), rel).not.toContain('hasGlobalDataAccess');
        }
        expect(semComentarios(fonte('src/js/store/sync/resource-access.service.js')))
            .toContain('hasGlobalDataAccess');
    });

    it('toda autorização da lista acima ainda é usada (allowlist sem beneficiário se remove)', () => {
        // É assim que um guarda volta a abrir sozinho: a exceção sobrevive ao uso que a
        // justificava, e o próximo arquivo que cair naquele caminho herda o perdão de graça.
        for (const [rel, motivo] of Object.entries(HAS_GLOBAL_DATA_ACCESS_AUTORIZADO)) {
            expect(SITIOS, `${rel} não é mais varrido: tire-o da lista`).toContain(rel);
            expect(semComentarios(fonte(rel)), `${rel} não usa mais hasGlobalDataAccess: tire-o da lista`)
                .toContain('hasGlobalDataAccess');
            expect(motivo.length, `${rel} sem motivo escrito`).toBeGreaterThan(80);
        }
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
