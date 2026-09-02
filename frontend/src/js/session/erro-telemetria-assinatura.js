// Path: js/session/erro-telemetria-assinatura.js

/**
 * @fileoverview A DECISÃO da telemetria de erro: como um erro do navegador vira uma assinatura de
 * agrupamento, e quando ele PODE ser enviado. Sem uma linha de `window`, de `fetch` ou de rede.
 *
 * ZERO IMPORTS por contrato, como os outros módulos de decisão da casa. Duas razões, e a segunda é
 * a que importa: ele é testável em node puro (a lógica que segura o incidente é a que precisa de
 * controle negativo, e ela não pode morar atrás de um `addEventListener`), e ele é carregado nas
 * QUATRO páginas, três das quais bootam sem a store — um import a mais aqui é peso em todas elas.
 *
 * O INCIDENTE QUE ORIGINOU TUDO ISTO foram 19 linhas idênticas de console coladas à mão, porque
 * erro de navegador não era registrado em lugar nenhum e a evidência se perdia. As 19 são o
 * argumento dos dois lados deste arquivo:
 *
 *   - AGRUPAR. As 19 eram O MESMO defeito. Enviadas cruas elas viram 19 grupos no servidor, porque
 *     a mensagem carrega o hash do build (`core-Ab12Cd34.js`), o UUID do atlas e o carimbo de HMR
 *     (`?t=1712345678901`): cada CARGA da página produz strings diferentes para o mesmo erro, e um
 *     agrupador que compare texto cru não agrupa nada. Daí {@link normalizarMensagem}, que troca
 *     cada uma dessas famílias por um marcador, e daí a assinatura ser mensagem normalizada MAIS o
 *     primeiro quadro útil da pilha: só a mensagem colide entre defeitos diferentes que falham com
 *     a mesma frase ("Cannot read properties of undefined"), que é a frase mais comum do produto.
 *
 *   - LIMITAR. As 19 chegaram em segundos. Uma telemetria que as repasse transforma um defeito do
 *     cliente num ataque ao servidor, com o agravante de que quem está com o defeito é justamente
 *     quem tem o laço apertado (um `requestAnimationFrame` que lança é 60 pedidos por segundo).
 *     {@link criarLimitador} é o que decide, e ele recusa por TRÊS motivos distintos que valem ser
 *     distinguidos no estado interno: assinatura repetida, teto da sessão e intervalo mínimo.
 *
 * O QUE ELE DELIBERADAMENTE NÃO FAZ: não enfileira o que RECUSOU. A distinção passou a importar em
 * 2026-09-01, quando nasceu `session/fila-de-relatos.js`, e ler as duas como uma só desfaz o
 * desenho: o que a fila guarda é o relato que o limitador APROVOU e cujo ENVIO falhou (servidor
 * fora, que é justamente o incidente que a telemetria não conseguia registrar). O que o limitador
 * recusa continua morrendo aqui, sem fila, porque uma fila do recusado é a rajada de volta com
 * atraso, que é o pico que ele existe para impedir.
 */

/**
 * Os tetos de tamanho do corpo, iguais aos que a rota valida. Truncar AQUI é o que impede um 422
 * numa telemetria que, por desenho, ninguém observa: uma pilha de 30 kB não é rara (um laço de
 * recursão a produz), e o desfecho de um 422 é a evidência perdida de novo.
 */
export const TETOS = Object.freeze({
    assinatura: 300,
    mensagem: 500,
    stack: 4000,
    stackBruta: 4000,
    url: 500,
    pagina: 500,
    release: 100,
    userAgent: 300,
});

/**
 * Os tetos dos campos de {@link contextoSeguro}, que são pequenos de propósito.
 *
 * ELES FICAM FORA DE {@link TETOS} porque o contexto é um objeto ANINHADO no corpo, e o espelho
 * que compara teto a teto com o Joi da rota casa `^\s{2}campo:` — isto é, o campo de primeiro
 * nível. Misturá-los ali faria o espelho procurar no lugar errado e passar verde sem comparar.
 *
 * Os números são o tamanho de um RÓTULO, não o de uma frase: `causa` carrega o nome de um evento
 * ou de um estado (`STORE_PERSIST_ERROR`, `closed`), `camada` carrega um id de camada, e nenhum
 * dos dois é texto escrito por gente.
 */
export const TETOS_DE_CONTEXTO = Object.freeze({
    conexao: 20,
    causa: 40,
    camada: 80,
});

/** Os três tipos de atlas que o contexto sabe nomear. Fora disso, o campo não viaja. */
export const TIPOS_DE_ATLAS = Object.freeze(['local', 'servidor', 'publico']);

/** Quantos envios uma sessão pode fazer, no total. */
export const MAX_ENVIOS_POR_SESSAO = 20;

/** Quanto tempo tem de passar entre dois envios. */
export const INTERVALO_MINIMO_MS = 2000;

/** Por que um erro não foi enviado (ou, no caso de `NOVO`, por que foi). */
export const MotivoDeEnvio = Object.freeze({
    NOVO: 'novo',
    DUPLICADA: 'duplicada',
    TETO: 'teto',
    INTERVALO: 'intervalo',
});

/** O que a assinatura diz quando a pilha não rendeu um quadro. */
export const SEM_QUADRO = 'sem-quadro';

/** O que a mensagem vira quando não há mensagem nenhuma a extrair. */
export const SEM_MENSAGEM = '(sem mensagem)';

// AS FAMÍLIAS QUE MUDAM A CADA CARGA, na ordem em que precisam ser trocadas: `blob:`/`data:` antes
// de tudo (carregam hex e dígitos dentro), UUID antes do hex genérico (um UUID É hex), e o hash de
// nome de arquivo antes do hex genérico pelo mesmo motivo.
const RE_BLOB = /\bblob:[^\s"')]+/gi;
const RE_DATA_URI = /\bdata:[^\s"')]{16,}/gi;
const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// O hash que o Vite assa no nome do arquivo (`core-Ab12Cd34.js`). EXIGE UM DÍGITO, e é o que
// impede que `-configuration.js` seja lido como hash: um nome de módulo raramente traz dígito, e
// um hash de base64url de oito caracteres quase sempre traz.
const RE_HASH_DE_ARQUIVO = /-(?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]{8,}(?=\.(?:js|css|mjs)\b)/g;
// O carimbo de HMR do dev server, que muda a cada salvamento de arquivo.
const RE_HMR = /\?t=\d+/g;
// Hex solto de sete ou mais, EXIGINDO uma letra E um dígito. As duas exigências carregam um caso
// cada: sem a letra, um carimbo de tempo (`1712345678901`, que é só dígito) viraria `<hash>` em vez
// do `<n>` que a linha seguinte lhe dá; sem o dígito, `defaced` (sete letras, todas no alfabeto
// hexadecimal) viraria `<hash>` e a mensagem perderia uma palavra de verdade.
const RE_HEX = /\b(?=[a-f0-9]*[a-f])(?=[a-f0-9]*\d)[a-f0-9]{7,}\b/gi;
// Carimbo de tempo, contador, id numérico. Cinco dígitos deixa de fora a porta (`3000`, `8080`) e
// o número de linha ordinário, que são justamente os que ajudam a identificar o defeito.
const RE_NUMERO_LONGO = /\b\d{5,}\b/g;
const RE_ESPACO = /\s+/g;

/**
 * O par (arquivo:linha:coluna) dentro de UMA linha de pilha. Casa as três formas que os motores
 * escrevem: `at f (http://h/a.js:1:2)` do V8, `at http://h/a.js:1:2` do V8 sem nome, e
 * `f@http://h/a.js:1:2` do Firefox.
 */
const RE_QUADRO = /([^\s()]+?):(\d+):(\d+)/g;

/**
 * As ÚNICAS chaves cujo VALOR pode viajar, e o que elas têm em comum: as duas são CÓDIGO, não
 * texto. Um `code` é um símbolo de protocolo (`FORBIDDEN`, `ECONNRESET`) e um `status` é um número
 * do HTTP: nenhum dos dois é escrito por gente.
 *
 * `message` ESTEVE NESTA LISTA E SAIU, e a retirada é a mesma correção do repro. Uma `message` é
 * texto livre de procedência desconhecida: ela é o campo em que um servidor ecoa o que o usuário
 * mandou ("a feição 'Posto do Cel Fulano' não pôde ser salva"), e deixá-la passar era o resíduo
 * exato do vazamento que {@link formaDeValor} existe para fechar. O `message` de um `Error` de
 * verdade continua inteiro, porque ele é escrito por programador e nem chega a este ramo.
 */
const CHAVES_COM_VALOR = Object.freeze(['code', 'status']);

/** Quantas chaves de topo são nomeadas. Doze descreve a forma; a lista inteira vira um despejo. */
const MAX_CHAVES_DA_FORMA = 12;

/** Teto do valor de uma das três chaves acima. Um código, não um parágrafo. */
const TETO_DO_VALOR = 40;

/**
 * A FORMA de um objeto que não é `Error`: o tipo, as chaves de topo, e o valor de no máximo três
 * chaves de um vocabulário fechado.
 *
 * ISTO SUBSTITUIU UM `JSON.stringify`, E A TROCA É DE PRIVACIDADE, NÃO DE ESTILO. A razão original
 * do JSON era boa (o objeto rejeitado quase sempre é um corpo de resposta, e `{"status":500}` é
 * muito mais útil que `[object Object]`), mas ele serializa o que estiver ali, e o que costuma
 * estar ali no EBGeo é dado do usuário: um `Promise.reject(feature)` manda o `nome` da feição, a
 * `descricao` escrita pela pessoa e as coordenadas decimais da posição dela, e a telemetria é
 * justamente o tipo de dado que acaba num log, num relatório e num anexo de e-mail. Uma
 * `FeatureCollection` rejeitada por engano vazaria o mapa inteiro, quinhentos caracteres por vez.
 *
 * O QUE SOBRA AINDA DIAGNOSTICA: `Object{features,type}` diz que alguém rejeitou um GeoJSON, que
 * é a informação que faz alguém achar a linha; `Response{status,statusText} status=500` diz o que
 * o JSON dizia. O que se perde é o conteúdo, que nunca foi o que se estava lendo.
 *
 * NUNCA LANÇA, e cada leitura tem `try` próprio: `constructor`, `Object.keys` e o acesso a uma
 * propriedade são três coisas que um `Proxy` hostil (ou um objeto de outro realm) faz explodir.
 * @param {Object|Function} valor
 * @returns {string} Nunca vazia.
 */
export function formaDeValor(valor) {
    try {
        let nome = 'Object';
        try {
            const construtor = valor?.constructor?.name;
            if (typeof construtor === 'string' && construtor) nome = construtor;
            else if (Array.isArray(valor)) nome = 'Array';
        } catch {
            nome = 'Object';
        }

        let chaves = [];
        try {
            // ORDENADAS: a ordem de inserção varia entre dois objetos com a mesma forma, e uma
            // forma que muda de texto é uma assinatura que muda de grupo.
            chaves = Object.keys(valor).sort();
        } catch {
            chaves = [];
        }
        const mostradas = chaves.slice(0, MAX_CHAVES_DA_FORMA);
        const sobra = chaves.length - mostradas.length;
        const lista = mostradas.join(',') + (sobra > 0 ? `,+${sobra}` : '');

        const partes = [`${nome}{${lista}}`];
        for (const chave of CHAVES_COM_VALOR) {
            let bruto;
            try {
                if (!Object.hasOwn(valor, chave)) continue;
                bruto = valor[chave];
            } catch {
                continue;
            }
            if (typeof bruto === 'number' && Number.isFinite(bruto)) {
                partes.push(`${chave}=${bruto}`);
            } else if (typeof bruto === 'string' && bruto.trim()) {
                partes.push(`${chave}=${bruto.trim().slice(0, TETO_DO_VALOR)}`);
            }
        }
        return partes.join(' ');
    } catch {
        return SEM_MENSAGEM;
    }
}

/**
 * Extrai mensagem e pilha de QUALQUER coisa que um capturador de erro possa receber.
 *
 * O ARGUMENTO NÃO É UM `Error`, e presumir que seja é o defeito clássico deste ponto do código.
 * Um `unhandledrejection` carrega o que quer que tenham rejeitado: uma string, um número, um
 * objeto de resposta, `undefined` (um `Promise.reject()` seco). Um `window.onerror` de script de
 * outra origem entrega a string `"Script error."` e mais nada.
 *
 * NUNCA LANÇA: um `toString` que lance (um objeto com `get message()` explosivo, um Proxy) sai
 * daqui como {@link SEM_MENSAGEM}, porque um erro dentro do capturador de erro é o pior defeito
 * possível deste subsistema.
 * @param {*} valor - Erro, razão de rejeição, ou o que houver.
 * @returns {{ mensagem: string, stack: string }} Ambos sempre strings; `stack` pode ser vazia.
 */
export function textoDeErro(valor) {
    try {
        if (valor === null || valor === undefined) return { mensagem: SEM_MENSAGEM, stack: '' };
        if (typeof valor === 'string') {
            return { mensagem: valor.trim() || SEM_MENSAGEM, stack: '' };
        }
        if (typeof valor !== 'object' && typeof valor !== 'function') {
            // Número, booleano, bigint, símbolo: `String()` é o melhor que existe, e `String()` de
            // um símbolo lança, o que o `catch` de fora cobre.
            return { mensagem: String(valor), stack: '' };
        }

        const stack = typeof valor.stack === 'string' ? valor.stack : '';
        if (typeof valor.message === 'string' && valor.message.trim()) {
            const nome = typeof valor.name === 'string' && valor.name ? `${valor.name}: ` : '';
            return { mensagem: `${nome}${valor.message}`.trim(), stack };
        }

        // Objeto que não é `Error`: descreve-se a FORMA, nunca o conteúdo. Ver {@link formaDeValor}.
        return { mensagem: formaDeValor(valor), stack };
    } catch {
        return { mensagem: SEM_MENSAGEM, stack: '' };
    }
}

/**
 * A mensagem sem o que muda a cada carga da página. É metade da assinatura, e é também o que se
 * ENVIA: normalizar só para agrupar e mandar o texto cru daria dois textos ao servidor, e o
 * agrupamento dele deixaria de casar com o do cliente sem ninguém perceber.
 * @param {*} texto
 * @returns {string} Normalizada e com espaço colapsado. Vazia só se a entrada for vazia.
 */
export function normalizarMensagem(texto) {
    try {
        if (typeof texto !== 'string') return normalizarMensagem(textoDeErro(texto).mensagem);
        return texto
            .replace(RE_BLOB, '<blob>')
            .replace(RE_DATA_URI, '<data>')
            .replace(RE_UUID, '<uuid>')
            .replace(RE_HASH_DE_ARQUIVO, '-<hash>')
            .replace(RE_HMR, '')
            .replace(RE_HEX, '<hash>')
            .replace(RE_NUMERO_LONGO, '<n>')
            .replace(RE_ESPACO, ' ')
            .trim();
    } catch {
        return '';
    }
}

/**
 * Normaliza a pilha PRESERVANDO as quebras de linha, que é a diferença para {@link
 * normalizarMensagem}: uma pilha colapsada num parágrafo é ilegível para quem for depurar.
 * @param {*} stack
 * @returns {string}
 */
export function normalizarStack(stack) {
    try {
        if (typeof stack !== 'string' || !stack) return '';
        return stack
            .split('\n')
            .map((linha) => normalizarMensagem(linha))
            .join('\n')
            .trim();
    } catch {
        return '';
    }
}

/**
 * O primeiro quadro ÚTIL da pilha, como `arquivo:linha`.
 *
 * "Útil" é o primeiro quadro que nomeia um arquivo com número de linha, DESCONTADOS os quadros
 * desta própria telemetria: um erro levantado dentro do capturador se agruparia por ele, e todos
 * os defeitos do produto virariam um grupo só chamado `erro-telemetria.js`.
 *
 * A COLUNA FICA DE FORA de propósito. Ela muda com qualquer reformatação do minificador, então
 * incluí-la faz a assinatura mudar entre dois builds do mesmo código, que é exatamente o que este
 * módulo existe para impedir. A linha também muda, mas muito menos.
 * @param {*} stack
 * @returns {string} `arquivo:linha`, ou vazio quando a pilha não rende nada.
 */
export function quadroUtil(stack) {
    try {
        if (typeof stack !== 'string' || !stack) return '';
        for (const linha of stack.split('\n')) {
            // O ÚLTIMO par da linha, e não o primeiro: `at eval (http://h/a.js:1:2), <anonymous>:3:4`
            // e as formas com `eval at` põem o quadro de verdade no fim.
            let ultimo = null;
            RE_QUADRO.lastIndex = 0;
            let casou;
            while ((casou = RE_QUADRO.exec(linha)) !== null) ultimo = casou;
            if (!ultimo) continue;

            const semQuery = ultimo[1].split('?')[0].split('#')[0];
            const base = semQuery.split('/').pop().split('\\').pop();
            if (!base) continue;
            // O próprio subsistema não assina defeito de ninguém.
            if (base.startsWith('erro-telemetria')) continue;

            const arquivo = base
                .replace(RE_UUID, '<uuid>')
                .replace(RE_HASH_DE_ARQUIVO, '-<hash>');
            return `${arquivo}:${ultimo[2]}`;
        }
        return '';
    } catch {
        return '';
    }
}

/**
 * A chave de agrupamento: mensagem normalizada MAIS o primeiro quadro útil.
 *
 * OS DOIS, e não um só. Só a mensagem funde defeitos diferentes que falham com a mesma frase, e a
 * frase mais comum do produto ("Cannot read properties of undefined (reading 'x')") é justamente
 * a mais genérica. Só o quadro funde defeitos diferentes do mesmo arquivo.
 * @param {{ mensagem?: * , stack?: * }} entrada
 * @returns {string}
 */
export function assinaturaDeErro({ mensagem, stack } = {}) {
    const texto = normalizarMensagem(mensagem) || SEM_MENSAGEM;
    return `${texto}@${quadroUtil(stack) || SEM_QUADRO}`;
}

/** As quatro páginas do produto, pelo nome do arquivo que as serve. */
const PAGINAS = Object.freeze({
    '': 'mapa',
    'index.html': 'mapa',
    'atlas.html': 'atlas',
    'admin.html': 'admin',
    'calibracao.html': 'calibracao',
});

/**
 * Qual das quatro páginas está falando.
 *
 * `Object.hasOwn` e não `PAGINAS[base] ?? ...`: a tabela é indexada por um valor que vem da barra
 * de endereços, e `/toString` devolveria a função herdada do protótipo. `Object.freeze` não
 * protege disso (é a mesma armadilha já paga em `ARRIVAL_NOTICES`).
 * @param {*} pathname - `location.pathname`.
 * @returns {string} Um dos quatro nomes, ou o nome do arquivo quando a página não é conhecida.
 */
export function paginaDaUrl(pathname) {
    try {
        if (typeof pathname !== 'string') return 'desconhecida';
        const base = pathname.split('?')[0].split('#')[0].split('/').pop();
        if (Object.hasOwn(PAGINAS, base)) return PAGINAS[base];
        return base.slice(0, TETOS.pagina);
    } catch {
        return 'desconhecida';
    }
}

/** Corta uma string no teto, sem lançar para entrada estranha. @returns {string} */
export function truncar(texto, teto) {
    if (typeof texto !== 'string') return '';
    return texto.length > teto ? texto.slice(0, teto) : texto;
}

/**
 * Os parâmetros de URL que NÃO viajam, porque são credenciais de uso único.
 *
 * O endereço é o campo mais útil do corpo e o único que pode carregar segredo: `?verify=` é o
 * token de confirmação de e-mail e `?atlasPublico=` é o link que dá acesso de leitura ao atlas.
 * O destino é o próprio servidor, mas telemetria é o tipo de dado que acaba num log, num relatório
 * e num anexo de e-mail, e nenhum dos três é lugar de credencial.
 */
const PARAMS_SENSIVEIS = Object.freeze(['verify', 'atlasPublico', 'token', 'access_token']);

/**
 * O endereço, sem as credenciais de uso único. Tudo o mais é preservado, porque `?atlas=`,
 * `?aba=` e `?photo=` são metade do diagnóstico.
 * @param {*} href
 * @returns {string}
 */
export function urlSegura(href) {
    try {
        if (typeof href !== 'string' || !href) return '';
        // Base fixa só para tolerar um caminho relativo; a origem é descartada se não veio no href.
        const url = new URL(href, 'http://local.invalid');
        let mexeu = false;
        for (const chave of PARAMS_SENSIVEIS) {
            if (url.searchParams.has(chave)) {
                url.searchParams.set(chave, '<oculto>');
                mexeu = true;
            }
        }
        if (!mexeu) return truncar(href, TETOS.url);
        const texto = url.origin === 'http://local.invalid' && !href.startsWith('http')
            ? `${url.pathname}${url.search}${url.hash}`
            : url.href;
        return truncar(texto, TETOS.url);
    } catch {
        // URL que o parser recusa: melhor um endereço cru truncado que endereço nenhum.
        return truncar(String(href ?? ''), TETOS.url);
    }
}

/** Um UUID inteiro, e nada mais. Ver {@link montarCorpo}. */
const RE_UUID_INTEIRO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A forma de uma origem. Ver {@link montarCorpo}: o VOCABULÁRIO é conferido pela fiação.
 *
 * O DÍGITO É OBRIGATÓRIO NA CLASSE, e a primeira versão desta linha o esqueceu: `sv360` é uma das
 * dez, e sem ele a origem do visualizador 360 sumia do corpo em silêncio, que é a pior forma de
 * uma etiqueta falhar (o relato chega, o filtro não acha).
 */
const RE_ORIGEM = /^[a-z][a-z0-9-]{0,19}$/;

/**
 * O contexto, reduzido às cinco chaves que ele pode ter.
 *
 * ELE É UMA ENUMERAÇÃO, E NUNCA UM OBJETO LIVRE, e essa é a decisão inteira. Um campo de contexto
 * aberto é um convite a `{ feature }`, `{ payload }`, `{ resposta }`, e cada um deles é dado do
 * usuário indo para um log — o mesmo vazamento que {@link formaDeValor} acabou de fechar do outro
 * lado, reaberto por uma porta com nome amigável. O que passa é: de que TIPO era o atlas, em que
 * estado estava a conexão, o RÓTULO da causa, o ID (nunca o nome) da camada e um código HTTP.
 *
 * O QUE NÃO PASSA SOME EM SILÊNCIO, de propósito: quem escreveu `{ feature }` não pode ser
 * recompensado com um 422 que derruba o relato inteiro, e também não pode ser recompensado com o
 * vazamento. A chave desconhecida simplesmente não existe na saída.
 *
 * `status` FORA DA FAIXA HTTP NÃO VIAJA. O `0` que o `fetch` reporta para pedido bloqueado ou
 * abortado não é resposta nenhuma, e mandá-lo como se fosse põe um número medido na tela de quem
 * não mediu nada (mesma regra que `LayerFailureNotice.report` já aplica).
 * @param {*} contexto
 * @returns {Object|null} `null` quando não sobrou nada, para que o campo simplesmente não exista.
 */
export function contextoSeguro(contexto) {
    try {
        if (contexto === null || typeof contexto !== 'object' || Array.isArray(contexto)) {
            return null;
        }
        const saida = {};
        if (typeof contexto.atlasKind === 'string' && TIPOS_DE_ATLAS.includes(contexto.atlasKind)) {
            saida.atlasKind = contexto.atlasKind;
        }
        for (const campo of Object.keys(TETOS_DE_CONTEXTO)) {
            const bruto = contexto[campo];
            if (typeof bruto !== 'string') continue;
            const limpo = bruto.replace(RE_ESPACO, ' ').trim();
            if (limpo) saida[campo] = limpo.slice(0, TETOS_DE_CONTEXTO[campo]);
        }
        const status = contexto.status;
        if (Number.isInteger(status) && status >= 100 && status <= 599) saida.status = status;
        return Object.keys(saida).length > 0 ? saida : null;
    } catch {
        return null;
    }
}

/**
 * O corpo do POST, com todo campo já dentro do teto que a rota valida.
 *
 * OS OPCIONAIS SAEM QUANDO NÃO EXISTEM, em vez de irem como `null`. `release` só existe se o build
 * carimbou uma versão, e `atlasId` só existe dentro de um atlas de SERVIDOR: mandar `null`
 * obrigaria a rota a aceitar dois tipos por campo, e "o campo não veio" é a informação honesta.
 *
 * O `atlasId` PRECISA SER UM UUID, e o filtro é do cliente porque a consequência é do cliente: a
 * coluna do servidor é `uuid` e o Joi da borda recusa qualquer outra forma com 422 — isto é, um
 * atlas LOCAL (cujo id não é UUID) derrubaria o envio INTEIRO por causa do campo mais dispensável
 * dele. Um erro no atlas local é justamente um dos que mais precisam chegar.
 *
 * NENHUM CAMPO DE USUÁRIO, e a ausência é o contrato: quem está falando é assunto do token (ou do
 * cookie) que o navegador anexa, e um `userId` no corpo é um `userId` que qualquer um escreve. O
 * `userAgent` não é identidade: é o navegador, e é o primeiro campo que qualquer diagnóstico de
 * defeito de tela pergunta. O `sessaoId` também não é: ele é a ABA, cunhado no cliente, sem nome e
 * sem conta atrás, e é o que separa "cinco pessoas com o mesmo defeito" de "uma pessoa cinco
 * vezes" — as duas leituras pedem respostas opostas e eram indistinguíveis sem ele.
 *
 * `stack` E `stackBruta` VIAJAM AS DUAS, e a redundância é o ponto. A normalizada é a que o
 * agrupamento usa (sem hash de build, sem UUID, sem carimbo de HMR), e é ela que faz duas cargas
 * do mesmo defeito caírem no mesmo grupo; a bruta é a que permite ler o sourcemap DAQUELE build,
 * que é o que se abre quando alguém finalmente vai depurar. Descobrir no meio do diagnóstico que o
 * `<hash>` apagou justamente o nome do arquivo que se precisava custa o incidente inteiro. A
 * ASSINATURA NÃO MUDA por causa dela: quem assina é a normalizada, hoje como ontem.
 * @param {Object} entrada
 * @returns {Object} Os campos do contrato, todos truncados.
 */
export function montarCorpo({
    assinatura, mensagem, stack, stackBruta, url, pagina, release, atlasId, userAgent,
    sessaoId, origem, contexto,
} = {}) {
    const corpo = {
        // A ASSINATURA VIAJA, e é ela que o servidor agrupa. Ela é montada AQUI, no cliente, porque
        // é aqui que se sabe o que muda a cada carga da página; o padrão a recalcula para que um
        // chamador que a esqueça não mande a chave errada, mas o caminho normal é passar a MESMA
        // que o limitador deduplicou, senão as duas contagens divergem sem ninguém ver.
        assinatura: truncar(
            typeof assinatura === 'string' && assinatura
                ? assinatura
                : assinaturaDeErro({ mensagem, stack }),
            TETOS.assinatura,
        ),
        mensagem: truncar(normalizarMensagem(mensagem) || SEM_MENSAGEM, TETOS.mensagem),
        stack: truncar(normalizarStack(stack), TETOS.stack),
        url: urlSegura(url),
        pagina: truncar(typeof pagina === 'string' ? pagina : 'desconhecida', TETOS.pagina),
    };
    if (typeof release === 'string' && release) corpo.release = truncar(release, TETOS.release);
    if (typeof userAgent === 'string' && userAgent) {
        corpo.userAgent = truncar(userAgent, TETOS.userAgent);
    }
    if (typeof atlasId === 'string' && RE_UUID_INTEIRO.test(atlasId)) corpo.atlasId = atlasId;
    // Mesmo filtro do `atlasId`, e pela mesma razão: a coluna é `uuid` do outro lado, e um valor
    // de outra forma derruba o relato INTEIRO num 422 por causa do campo mais dispensável dele.
    if (typeof sessaoId === 'string' && RE_UUID_INTEIRO.test(sessaoId)) corpo.sessaoId = sessaoId;
    if (typeof stackBruta === 'string' && stackBruta) {
        corpo.stackBruta = truncar(stackBruta, TETOS.stackBruta);
    }
    // A FORMA se confere aqui; o VOCABULÁRIO das dez origens se confere na fiação
    // (`session/erro-telemetria.js`, contra `ORIGENS_DE_ERRO`), porque este módulo é folha de zero
    // imports e uma segunda cópia da lista divergiria da primeira em silêncio.
    if (typeof origem === 'string' && RE_ORIGEM.test(origem)) corpo.origem = origem;
    const seguro = contextoSeguro(contexto);
    if (seguro) corpo.contexto = seguro;
    return corpo;
}

/**
 * O portão do envio: dedupe por assinatura, teto por sessão e intervalo mínimo entre envios.
 *
 * A ORDEM DAS TRÊS PERGUNTAS É O DESENHO. A duplicata vem primeiro porque ela é o caso do
 * incidente (19 iguais em segundos) e porque responder "duplicada" é mais barato que olhar o
 * relógio. O teto vem antes do intervalo porque, esgotado o teto, o relógio não muda mais nada.
 *
 * O RECUSADO NÃO É MEMORIZADO, e isso é deliberado: só o envio bem-sucedido carimba a assinatura e
 * o relógio. Memorizar o recusado por intervalo faria o primeiro erro de uma rajada consumir a
 * assinatura sem nunca a enviar, e o defeito nunca chegaria ao servidor.
 *
 * O `ignorarIntervalo` EXISTE PARA UM CHAMADOR SÓ, o descarregamento da fila de relatos, e ele não
 * afrouxa nada dos outros dois. O intervalo mínimo protege contra o LAÇO VIVO (um erro dentro de um
 * `requestAnimationFrame` são sessenta por segundo), e a fila não é um laço: ela é limitada pelo
 * teto de trinta itens, sai uma vez por boot e vai em SÉRIE, um pedido esperando o anterior. Passar
 * a fila pelo relógio faria o primeiro item sair e os vinte e nove seguintes serem descartados no
 * mesmo milissegundo, que é perder a evidência guardada de propósito. A duplicata e o teto da
 * sessão continuam valendo para ela, e são eles que impedem o despejo de virar rajada.
 * @param {Object} [opcoes]
 * @param {number} [opcoes.max] - Teto de envios da sessão.
 * @param {number} [opcoes.intervaloMs] - Espera mínima entre dois envios.
 * @param {() => number} [opcoes.agora] - Relógio injetável (o teste não espera dois segundos).
 * @returns {{ permite: (assinatura: *) => {ok: boolean, motivo: string}, estado: () => Object }}
 */
export function criarLimitador({
    max = MAX_ENVIOS_POR_SESSAO,
    intervaloMs = INTERVALO_MINIMO_MS,
    agora = () => Date.now(),
} = {}) {
    const vistas = new Set();
    let enviados = 0;
    let duplicadas = 0;
    let limitadas = 0;
    let ultimoEnvio = null;

    return {
        /**
         * @param {*} assinatura
         * @param {{ignorarIntervalo?: boolean}} [opcoes] - Ver o `fileoverview` desta função: só o
         *   descarregamento da fila usa a bandeira, e ela NÃO dispensa a duplicata nem o teto.
         * @returns {{ok: boolean, motivo: string}}
         */
        permite(assinatura, { ignorarIntervalo = false } = {}) {
            const chave = typeof assinatura === 'string' ? assinatura : String(assinatura ?? '');
            if (vistas.has(chave)) {
                duplicadas++;
                return { ok: false, motivo: MotivoDeEnvio.DUPLICADA };
            }
            if (enviados >= max) {
                limitadas++;
                return { ok: false, motivo: MotivoDeEnvio.TETO };
            }
            const t = Number(agora());
            const relogioVale = Number.isFinite(t);
            if (!ignorarIntervalo && relogioVale && ultimoEnvio !== null && (t - ultimoEnvio) < intervaloMs) {
                limitadas++;
                return { ok: false, motivo: MotivoDeEnvio.INTERVALO };
            }
            vistas.add(chave);
            enviados++;
            if (relogioVale) ultimoEnvio = t;
            return { ok: true, motivo: MotivoDeEnvio.NOVO };
        },
        estado() {
            return { enviados, duplicadas, limitadas, distintas: vistas.size };
        },
    };
}
