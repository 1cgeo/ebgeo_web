// Path: js/admin/lazy-tab.js

/**
 * @fileoverview Uma aba do painel que só BAIXA o próprio código quando alguém a seleciona.
 *
 * POR QUE ELA EXISTE, com a medida. As abas Diagnóstico e Uso nasceram em 2026-08-30 e são, de
 * longe, as mais pesadas do painel: as duas somam o código de tela mais os folhas de frase de cada
 * uma (`diag-phrases`, `defeito-phrases`, `resumo-phrases`, `uso-phrases`), e eram importadas
 * ESTATICAMENTE por `index.js`, ou seja, entravam no chunk de entrada de `admin.html`. Medido num
 * `dist/` fresco, a página baixava 882 kB em 24 arquivos, dos quais 616 kB eram os dois chunks de
 * entrada (o moderno e o legado, que é a mesma coisa transpilada). O painel inteiro é DESKTOP e de
 * um punhado de pessoas, mas isso não é motivo para servir a um credenciado (que recebe duas abas,
 * e nenhuma delas é destas) o código das duas telas mais caras do produto.
 *
 * AS DUAS SÃO DO ADMINISTRADOR E DE MAIS NINGUÉM (`ABAS_DO_ADMINISTRADOR`, `admin-audience.js`),
 * então o recorte por audiência já as tirava de três das quatro audiências — do PAINEL, não do
 * PAYLOAD. `adminAudience` decide quais abas se DESENHAM; o bundler não sabe nada sobre isso e
 * empacota o que o grafo de imports alcança. É essa diferença que este módulo fecha.
 *
 * O QUE ELE NÃO PODE ADIAR É O METADADO. O trilho de navegação é construído de uma vez
 * (`_buildRail`, `admin-panel.js`) e precisa de `label`, `testid` e `icon` ANTES de qualquer
 * clique: adiá-los faria o painel abrir com um trilho de botões sem nome, que é uma regressão de
 * tela para pagar uma economia de rede. Então o metadado é ANSIOSO e explícito no chamador (os
 * ícones já moravam em `admin-dom.js`, que é compartilhado, e não foram duplicados), e só o
 * `mount` é tardio. O preço é que o metadado passa a existir em dois lugares — aqui e no que a
 * fábrica real devolve — e quem paga esse preço é
 * `frontend/tests/unit/admin-abas-tardias.test.js`, que importa os dois e exige igualdade.
 *
 * QUATRO PROPRIEDADES SÃO CONTRATO, e cada uma responde a um modo de falha que a forma ingênua
 * tem:
 *
 *   1. **A FALHA TEM SAÍDA.** `import()` é rede: um `dist/` recém-publicado (chunk com hash novo,
 *      aba velha aberta), uma queda no meio da carga ou um proxy ruim rejeitam a promessa. Sem
 *      tratamento a aba fica em "Carregando…" para sempre, que é o beco que `failureState`
 *      (`admin-dom.js`) existe para não haver mais no painel. A mensagem NÃO afirma causa, pela
 *      mesma razão escrita lá: quem chega aqui não sabe se foi rede, servidor ou programa.
 *   2. **A TROCA DE ABA NO MEIO DA CARGA NÃO PINTA NADA.** O painel desmonta a aba anterior e
 *      esvazia o corpo antes de montar a próxima (`_selectTab`), e uma promessa que resolva DEPOIS
 *      disso escreveria a tela antiga por cima da nova. O `vivo` do fecho é o mesmo remédio que as
 *      abas usam para resposta de rede atrasada, e aqui ele é obrigatório porque o dado que chega
 *      tarde é a TELA INTEIRA.
 *   3. **A SEGUNDA VISITA NÃO PISCA.** A aba montada é guardada no fecho e remontada de forma
 *      SÍNCRONA na volta. Isto não é otimização: é o que preserva o comportamento de hoje, em que
 *      `createDiagTab()` é chamada UMA vez na montagem do painel e a mesma instância é remontada a
 *      cada troca (o estado de tela que ela guarda entre visitas, como a marca de visita dos
 *      defeitos, depende disso). Um `import()` resolvido é cache do próprio módulo, mas resolver
 *      uma promessa já resolvida ainda custa um microtask, e um "Carregando…" de um frame a cada
 *      volta seria tremor de tela sem nada por trás.
 *   4. **DUAS VISITAS DURANTE A MESMA CARGA PEDEM UMA VEZ SÓ.** Sair da aba e voltar antes de o
 *      chunk descer cai de novo no ramo de carga, e sem memoização isso chama a fábrica outra vez:
 *      o `import()` é cache de MÓDULO, a fábrica não é, e o resultado são duas instâncias da aba
 *      disputando o mesmo `aba`. A promessa memoizada é limpa na REJEIÇÃO, senão "Tentar de novo"
 *      reapresentaria a mesma falha para sempre.
 *
 * AS QUATRO SÃO ASSERIDAS POR COMPORTAMENTO, não por leitura de fonte, em
 * `frontend/tests/unit/admin-abas-tardias.test.js`: um grep que exija `if (!vivo) return;` fica
 * verde diante de um refactor que preserve a linha e quebre a propagação da limpeza.
 */

import { failureState } from './admin-dom.js';

/**
 * A frase de espera de uma aba tardia.
 *
 * Ela NOMEIA a aba de propósito. Um "Carregando…" solto neste ponto é ambíguo com o "Carregando…"
 * que a própria aba desenha um instante depois para as seções dela, e as duas esperas são coisas
 * diferentes: esta é o CÓDIGO da tela, a seguinte são os DADOS dela.
 * @param {string} label - O rótulo da aba, como o trilho o escreve.
 * @returns {string}
 */
export function carregandoAbaNotice(label) {
    return `Carregando a aba ${label}…`;
}

/**
 * A frase de falha ao baixar o código de uma aba tardia.
 *
 * SEM CAUSA AFIRMADA, como manda `failureState`: daqui não se distingue rede, sessão, servidor ou
 * uma publicação que trocou o hash do chunk debaixo de uma aba aberta há horas. O botão de tentar
 * de novo é o que resolve os quatro casos, e é o que a frase promete.
 * @param {string} label
 * @returns {string}
 */
export function abaNaoCarregouNotice(label) {
    return `Não foi possível carregar a aba ${label}.`;
}

/**
 * @typedef {Object} AbaTardiaMeta
 * @property {string} id
 * @property {string} label
 * @property {string} testid
 * @property {string} [icon]
 */

/**
 * Embrulha uma aba do painel numa que só baixa o próprio código ao ser selecionada.
 *
 * @param {AbaTardiaMeta} meta - O metadado ANSIOSO, o que o trilho precisa antes do clique.
 * @param {function(): Promise<import('./admin-panel.js').AdminTab>} carregar - Faz o `import()` e
 *   devolve a aba já criada. Ela é criada dentro do fecho para que o chamador possa passar à
 *   fábrica real os mesmos argumentos que passaria numa importação estática.
 * @returns {import('./admin-panel.js').AdminTab}
 */
export function lazyTab(meta, carregar) {
    /** @type {import('./admin-panel.js').AdminTab|null} A aba real, uma vez baixada. */
    let aba = null;
    /**
     * A carga EM VOO, memoizada.
     *
     * SEM ELA, DUAS VISITAS ANTES DA PRIMEIRA RESOLVER PEDEM DUAS VEZES. Sair da aba durante o
     * download e voltar a ela cai no ramo de baixo com `aba` ainda nula, e uma segunda chamada de
     * `carregar()` cria uma SEGUNDA instância da aba: o `import()` é cache de módulo, mas a
     * fábrica não é, e a instância que o `aba` guarda no fim passa a ser a da última promessa a
     * resolver, com a anterior viva em lugar nenhum. É a mesma classe de defeito que a `_geracao`
     * das abas trata para resposta de rede atrasada.
     *
     * ELA É LIMPA NA REJEIÇÃO, e essa metade é o que faz "Tentar de novo" tentar: uma promessa
     * rejeitada memoizada devolveria a mesma rejeição para sempre, e o botão viraria enfeite.
     * @type {Promise<import('./admin-panel.js').AdminTab>|null}
     */
    let promessa = null;

    return {
        id: meta.id,
        label: meta.label,
        testid: meta.testid,
        icon: meta.icon,
        mount(container) {
            let vivo = true;
            /** @type {Function|null} A limpeza que a aba real devolveu. */
            let limpezaReal = null;

            /**
             * Monta a aba real neste container, guardando a limpeza dela.
             * @param {import('./admin-panel.js').AdminTab} pronta
             */
            const montarReal = (pronta) => {
                container.replaceChildren();
                const limpeza = pronta.mount(container);
                limpezaReal = typeof limpeza === 'function' ? limpeza : null;
            };

            const abrir = () => {
                const espera = document.createElement('p');
                espera.className = 'admin-users__status';
                // NÃO reusa o prefixo `admin-tab-` dos BOTÕES do trilho: este é um elemento do
                // CORPO, e um seletor de teste que casasse os dois acharia dois nós para a
                // mesma aba.
                espera.dataset.testid = `admin-aba-carregando-${meta.id}`;
                espera.textContent = carregandoAbaNotice(meta.label);
                container.replaceChildren(espera);

                promessa ??= carregar();
                promessa.then((pronta) => {
                    // A aba pode ter sido trocada enquanto o chunk descia: ver a propriedade 2 do
                    // `@fileoverview`. Guardar `aba` mesmo assim é de propósito — o download já
                    // aconteceu, e a próxima visita não deve repeti-lo.
                    aba = pronta;
                    if (!vivo) return;
                    montarReal(pronta);
                }).catch((erro) => {
                    console.warn(`[AdminPanel] a aba ${meta.id} não carregou:`, erro);
                    // A memoização sai do caminho ANTES do botão existir, senão ele reapresenta a
                    // mesma rejeição.
                    promessa = null;
                    if (!vivo) return;
                    container.replaceChildren(
                        failureState(abaNaoCarregouNotice(meta.label), { onRetry: abrir })
                    );
                });
            };

            if (aba) montarReal(aba);
            else abrir();

            return () => {
                vivo = false;
                if (typeof limpezaReal === 'function') limpezaReal();
                limpezaReal = null;
            };
        },
    };
}
