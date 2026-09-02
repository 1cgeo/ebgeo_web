// Path: js/session/sessao-id.js

/**
 * @fileoverview O IDENTIFICADOR DESTA ABA, e só desta aba. Um UUID por carga de página, guardado
 * no `sessionStorage`.
 *
 * PARA QUE ELE EXISTE: sem ele, dois erros do servidor são dois erros; com ele, são a MESMA
 * pessoa batendo duas vezes, ou duas pessoas batendo uma vez cada, e as duas leituras pedem
 * respostas opostas. Ele também é o que costura o relato do navegador com a linha do log do
 * servidor, porque o mesmo valor viaja no cabeçalho `X-EBGeo-Sessao` de todo pedido REST.
 *
 * NÃO É IDENTIDADE. Ele não diz quem é a pessoa (isso é assunto do cookie ou do token), não
 * sobrevive ao fechamento da aba e não é compartilhado entre abas: `sessionStorage`, e não
 * `localStorage`, é a escolha inteira. Duas abas do mesmo usuário são dois valores, que é
 * justamente o que se quer quando o defeito é "só numa aba".
 *
 * POR QUE ELE CUNHA O PRÓPRIO UUID em vez de usar o `generateUUID()` da casa, e a razão NÃO é o
 * barril: `utilities/uuid.js` é folha e se importa por arquivo sem arrastar coisa nenhuma. A razão
 * é que `generateUUID()` chama `crypto.getRandomValues` SEM GUARDA, e `crypto` não existe em
 * contexto não seguro (uma origem `http:` que não seja `localhost`) nem em navegador antigo: a
 * chamada LANÇA. Isso é inaceitável aqui, porque este valor é lido na primeira linha do boot das
 * quatro páginas e dentro do capturador de erro, que são os dois piores lugares do produto para
 * uma exceção. {@link sortearUuid} faz a mesma coisa com `try` em volta e com um caminho de
 * reserva, e é só por isso que ele existe. O arquivo é FOLHA, com ZERO IMPORTS, como os outros
 * módulos de decisão da telemetria, mas essa é uma propriedade dele, não o motivo da duplicação.
 *
 * TODO ACESSO AO ARMAZENAMENTO ESTÁ DENTRO DE `try`. Em modo privado, com cookies de terceiros
 * bloqueados ou com o armazenamento do site desabilitado, ler `sessionStorage` não devolve `null`:
 * ele LANÇA, e um `throw` daqui derrubaria a primeira linha do boot das quatro páginas por causa
 * do campo mais dispensável do relato. O desfecho de uma falha é um id só de memória, vivo
 * enquanto a página estiver, que é exatamente o que se precisa para agrupar o que acontecer nela.
 */

/** Onde o id mora. Prefixado, porque o `sessionStorage` é compartilhado com tudo da origem. */
export const CHAVE_DA_SESSAO = 'ebgeo:sessao-id';

/**
 * A forma que o servidor aceita. O corpo do relato só carrega o campo se ele casar isto, pelo
 * mesmo motivo do `atlasId`: a coluna é `uuid`, e um valor de outra forma custaria o relato
 * INTEIRO num 422 por causa do campo mais dispensável dele.
 */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O sorteio de reserva, para quando `crypto.randomUUID` não existe.
 *
 * ELE NÃO É EQUIVALENTE, e a diferença está declarada aqui para não ser descoberta por engano:
 * `randomUUID` é criptograficamente forte, e `Math.random` não é. Isto não importa para o uso
 * (agrupar relatos de uma aba não é segredo nem credencial, e o valor não autoriza nada), e a
 * alternativa seria não ter id nenhum em navegador antigo ou em contexto não seguro, onde
 * `crypto.randomUUID` simplesmente não é exposto. `getRandomValues` é tentado primeiro porque ele
 * é exposto em mais lugares que `randomUUID`.
 * @returns {string} Um UUID na forma da versão 4.
 */
function sortearUuid() {
    const bytes = new Uint8Array(16);
    let preenchido = false;
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
            crypto.getRandomValues(bytes);
            preenchido = true;
        }
    } catch {
        preenchido = false;
    }
    if (!preenchido) {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    // Versão 4 e variante RFC 4122, para que o valor case a forma que o servidor valida.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** O cunhador padrão: `crypto.randomUUID` quando existe, sorteio quando não. @returns {string} */
function uuidPadrao() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        // Contexto não seguro, ou `crypto` sequestrado: cai no sorteio.
    }
    return sortearUuid();
}

/**
 * Uma fábrica de id de sessão sobre um armazenamento injetado.
 *
 * FÁBRICA E SINGLETON, os dois: o singleton é o que o produto usa (uma aba, um id), e a fábrica é
 * o que torna as três propriedades testáveis em node puro, onde não existe `sessionStorage`
 * nenhum — cunha uma vez, reusa o que já está guardado, e degrada para a memória quando o
 * armazenamento recusa.
 *
 * @param {Object} [opcoes]
 * @param {{getItem: Function, setItem: Function}|null} [opcoes.storage] - O armazenamento. `null`
 *   é um valor legítimo e significa "só memória".
 * @param {() => string} [opcoes.uuid] - O cunhador. Um retorno que não seja UUID é descartado e
 *   substituído pelo sorteio, porque um valor de outra forma não chega ao servidor.
 * @param {string} [opcoes.chave] - A chave no armazenamento.
 * @returns {() => string} A função que devolve SEMPRE o mesmo id para esta página.
 */
export function criarSessaoId({ storage, uuid = uuidPadrao, chave = CHAVE_DA_SESSAO } = {}) {
    /** O id desta página, uma vez resolvido. Memorizar é o que sustenta o caso degradado. */
    let memoria = null;

    return function sessaoIdDaAba() {
        if (memoria) return memoria;

        let guardado = null;
        try {
            guardado = storage?.getItem(chave) ?? null;
        } catch {
            guardado = null;
        }
        if (typeof guardado === 'string' && RE_UUID.test(guardado)) {
            memoria = guardado;
            return memoria;
        }

        let novo = null;
        try {
            novo = uuid();
        } catch {
            novo = null;
        }
        if (typeof novo !== 'string' || !RE_UUID.test(novo)) novo = sortearUuid();

        try {
            storage?.setItem(chave, novo);
        } catch {
            // Modo privado, cota estourada, armazenamento bloqueado: o id vive só na memória, e
            // isso basta para agrupar o que acontecer nesta carga da página.
        }
        memoria = novo;
        return memoria;
    };
}

/** O `sessionStorage` da página, ou `null` quando lê-lo lança. */
let _armazenamento = null;
try {
    _armazenamento = globalThis.sessionStorage ?? null;
} catch {
    // Só acessar a propriedade já lança com o armazenamento bloqueado; daí o `try` em volta de
    // uma linha que parece não precisar de um.
    _armazenamento = null;
}

/**
 * O id desta aba. Mesmo valor em toda chamada, em toda a vida da página.
 * @returns {string}
 */
export const sessaoId = criarSessaoId({ storage: _armazenamento });
