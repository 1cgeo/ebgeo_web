// Path: src/utils/log-diario.js
/**
 * @fileoverview Destino de log em ARQUIVO, um por dia, com poda por idade.
 *
 * POR QUE ELE EXISTE. O `pino` sempre emitiu JSON estruturado, e ninguém o guardava: em
 * produção o destino era o stdout do container e em desenvolvimento o terminal. Quando um
 * defeito aparecia e o terminal já tinha sido fechado, a evidência simplesmente não existia
 * mais (foi o que aconteceu em 2026-08-30, com um 400 em laço no push de sync cuja mensagem
 * do servidor se perdeu). Log que não sobrevive à sessão não é log, é console.
 *
 * POR QUE ESCRITO À MÃO, e não com uma dependência de rotação. Decisão do dono em
 * 2026-08-30, com o custo declarado: isto é código de infraestrutura no caminho onde uma
 * falha silenciosa apaga justamente o que se quer ler. É por isso que o módulo é PURO onde
 * dá (nome de arquivo, decisão do que podar), recebe `agora` e `fs` por injeção, e nunca
 * engole um erro sem falar.
 *
 * AS CINCO PROPRIEDADES QUE ELE PRECISA TER, e cada uma já é a lápide de um jeito ingênuo:
 *
 * 1. **Nunca derrubar quem loga.** Um `throw` daqui subiria pelo `logger.info` de dentro de
 *    um handler HTTP e transformaria "não consegui escrever o log" em "a requisição falhou".
 *    Toda falha de escrita degrada: o destino se desliga e AVISA UMA VEZ no stderr. Avisar
 *    uma vez, e não a cada linha, porque o modo de falha típico (disco cheio, permissão do
 *    volume) se repete a cada linha e encheria o terminal com o próprio problema.
 * 2. **Falar alto ao nascer.** Se o diretório não puder ser criado, isso vai para o stderr
 *    na inicialização, e não vira um silêncio que se confunde com "não houve erro nenhum".
 *    A constituição chama isso de verificador que quebra calado, e o hook de lint desta casa
 *    já pagou por ele. **Criar não é escrever**, e esta propriedade não bastou: sobre um
 *    diretório que JÁ existe o `mkdirSync` recursivo devolve sucesso sem perguntar por
 *    escrita, e em 2026-09-22 um volume de outro dono passou calado por aqui e morreu na
 *    primeira linha. Quem prova escrita no boot é a sonda (`sonda-de-escrita.js`), que roda
 *    antes de o servidor escutar; o que sobra aqui é o desligamento em RUNTIME.
 * 3. **Podar só o que é nosso.** A varredura casa `<prefixo>-AAAA-MM-DD.jsonl` e mais nada.
 *    Um `readdir` + `unlink` frouxo num diretório que o operador aponte para o lugar errado
 *    apagaria arquivo alheio, e essa é a classe de erro que não tem desfazer.
 * 4. **Fechar é ESPERAR, com prazo.** `fechar()` devolve promessa e só resolve quando o
 *    `fs.WriteStream` terminou de escoar a fila. Quem a chama é um processo prestes a
 *    morrer, e `process.exit()` com fila pendente descarta justamente as linhas do
 *    desligamento e as da queda, que são as que explicam um deploy e um incidente. A espera
 *    é LIMITADA: sem teto, disco cheio ou cano entupido viram um processo que nunca termina,
 *    o orquestrador o mata no prazo dele, e aí se perde o log E o desligamento limpo.
 * 5. **Desligar deixa rastro FORA do arquivo.** O arquivo não tem como registrar que parou de
 *    ser escrito, e o aviso no stderr não sobrevive a um container recriado. Por isso o
 *    desligamento fica guardado em `estado()` (que `utils/logger.js` publica nas rotas de
 *    diagnóstico do processo vivo) e é entregue a `aoDesligar`, que o boot liga a um defeito
 *    de servidor no banco. As duas pontas nunca lançam para dentro daqui.
 *
 * O DIA É O LOCAL, não UTC, e isso é escolha: quem lê o log procura pelo dia em que o
 * problema aconteceu para ELE. O custo é que a virada de arquivo acompanha o fuso do
 * servidor, o que é irrelevante para uma instalação, e seria o oposto para uma frota.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Casa exatamente o que ESTE módulo escreve, e nada mais. */
const PADRAO_ARQUIVO = /^(.+)-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/**
 * O termo que ABRE a assinatura do defeito de servidor que um desligamento produz
 * (`defeitoDoLogDesligado`, em `modules/diag/defeitos-de-servidor.js`), e que o resumo procura
 * para dizer, no bloco de saúde, que a série pode ter buraco com o processo de pé.
 *
 * Símbolo exportado e não string digitada em dois lugares, pelo mesmo motivo de
 * `MARCADOR_AMOSTRA`: quem escreve e quem procura precisam do mesmo termo, senão renomear um
 * lado deixa o outro mudo e correto na aparência. Sem acento, porque é termo de busca. Ele mora
 * aqui porque este módulo é folha (só `node:fs` e `node:path`), então importá-lo não arrasta
 * `config.js` para dentro de `utils/diag-consulta.js`.
 */
export const MARCADOR_LOG_DESLIGADO = 'log em arquivo desligado';

/**
 * Teto da espera de `fechar()`. Curto de propósito: quem chama está saindo, e a alternativa
 * a desistir não é "esperar mais um pouco", é não sair nunca.
 */
const PRAZO_DE_FECHAMENTO_MS = 2000;

/**
 * O dia local de uma data, em AAAA-MM-DD.
 *
 * Escrito à mão em vez de `toISOString().slice(0,10)`, que devolve o dia em UTC: num fuso
 * negativo (o daqui é -03) toda linha escrita depois das 21h cairia no arquivo do dia
 * SEGUINTE, e o operador procuraria a ocorrência da noite no arquivo errado.
 * @param {Date} data
 * @returns {string} AAAA-MM-DD no fuso local
 */
export function diaLocal(data) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/**
 * O nome do arquivo de um dia.
 * @param {string} prefixo
 * @param {string} dia - AAAA-MM-DD
 * @returns {string}
 */
export function nomeDoArquivo(prefixo, dia) {
  return `${prefixo}-${dia}.jsonl`;
}

/**
 * Quais nomes devem ser apagados, dado o inventário do diretório.
 *
 * Puro de propósito: é a decisão que apaga arquivo, e ela precisa ser testável sem tocar
 * disco nenhum. A comparação é LEXICOGRÁFICA sobre AAAA-MM-DD, que para esse formato é a
 * mesma ordem da cronológica, e por isso não há aritmética de data aqui (aritmética de data
 * é onde nasce o erro de fuso e o de mês de 31 dias).
 *
 * O LIMITE É INCLUSIVO: com `retencaoDias: 30`, o arquivo de exatamente 30 dias atrás FICA.
 * "Guardo 30 dias" tem de significar que os 30 estão lá.
 *
 * @param {string[]} nomes - conteúdo do diretório, cru
 * @param {string} prefixo
 * @param {string} diaLimite - o dia mais ANTIGO que sobrevive (AAAA-MM-DD)
 * @returns {string[]} nomes a apagar
 */
export function arquivosExpirados(nomes, prefixo, diaLimite) {
  return nomes.filter((nome) => {
    const m = PADRAO_ARQUIVO.exec(nome);
    if (!m) return false;          // não é nosso: nunca se toca
    if (m[1] !== prefixo) return false;
    return m[2] < diaLimite;
  });
}

/**
 * O dia limite da retenção, `dias - 1` dias antes de hoje (hoje conta como o primeiro).
 * @param {Date} hoje
 * @param {number} dias
 * @returns {string} AAAA-MM-DD
 */
export function diaLimiteDaRetencao(hoje, dias) {
  const d = new Date(hoje.getTime());
  d.setDate(d.getDate() - (dias - 1));
  return diaLocal(d);
}

/**
 * Cria o destino de log diário.
 *
 * Devolve um objeto com `write(linha)`, que é a interface que o `pino` espera de um
 * destino (`pino.multistream` aceita qualquer coisa com `write`). Não é um `Writable` do
 * node de propósito: o contrato usado é de uma função só, e herdar de `Writable` traria
 * back-pressure, `cork`, `destroy` e um punhado de estados que nada aqui exercita.
 *
 * @param {Object} opts
 * @param {string} opts.diretorio - onde os arquivos moram; criado se não existir
 * @param {string} [opts.prefixo='ebgeo'] - prefixo do nome do arquivo
 * @param {number} [opts.retencaoDias=30] - quantos dias ficam (hoje inclusive)
 * @param {() => Date} [opts.agora] - relógio injetável (teste)
 * @param {Object} [opts.sistemaDeArquivos] - `fs` injetável (teste)
 * @param {(msg: string) => void} [opts.avisar] - canal do aviso de falha (stderr)
 * @param {((estado: Object) => void)|null} [opts.aoDesligar] - chamado UMA vez, com `estado()`,
 *   quando o destino se desliga; ver a propriedade (5) do cabeçalho
 * @returns {{write: (linha: string) => void, fechar: (opts?: {prazoMs?: number}) => Promise<{desfecho: string}>, diaAtual: () => string|null, estado: () => Object}}
 */
export function criarLogDiario({
  diretorio,
  prefixo = 'ebgeo',
  retencaoDias = 30,
  agora = () => new Date(),
  sistemaDeArquivos = fs,
  avisar = (msg) => process.stderr.write(`${msg}\n`),
  aoDesligar = null,
} = {}) {
  const fsys = sistemaDeArquivos;
  let fluxo = null;
  let dia = null;
  let desligado = false;
  /** Por que e quando o destino se desligou; `null` enquanto ele escreve. */
  let desligamento = null;

  /** O estado do destino, para quem precisa dizer em voz alta que ele parou. */
  function estado() {
    return {
      ligado: !desligado,
      diretorio,
      desligadoEm: desligamento ? desligamento.em : null,
      causa: desligamento ? desligamento.causa : null,
      codigo: desligamento ? desligamento.codigo : null,
      mensagem: desligamento ? desligamento.mensagem : null,
    };
  }

  /** Desliga o destino e avisa UMA vez. Ver propriedades (1) e (5) do cabeçalho. */
  function degradar(causa, err) {
    if (desligado) return;
    desligado = true;
    fluxo = null;
    // O relógio injetado pode ser justamente o que lançou (ele roda dentro do `write`), e
    // chamá-lo de novo aqui faria o caminho de degradação lançar, que é o que a propriedade (1)
    // proíbe. `Date.now()` é o recurso que não depende de ninguém.
    let em;
    try { em = agora().getTime(); } catch { em = Date.now(); }
    desligamento = {
      em,
      causa,
      codigo: err && typeof err.code === 'string' ? err.code : null,
      mensagem: String(err && err.message ? err.message : err),
    };
    avisar(`[log-diario] ${causa}: ${desligamento.mensagem}. O log em arquivo foi DESLIGADO nesta execução.`);
    if (typeof aoDesligar === 'function') {
      try {
        aoDesligar(estado());
      } catch {
        // Quem ouve o desligamento é telemetria; uma exceção dela subiria pelo `write` de dentro
        // de um handler HTTP. O aviso no stderr acima já saiu, e ele é o que sobra.
      }
    }
  }

  function podar(hoje) {
    try {
      const limite = diaLimiteDaRetencao(hoje, retencaoDias);
      for (const nome of arquivosExpirados(fsys.readdirSync(diretorio), prefixo, limite)) {
        fsys.unlinkSync(path.join(diretorio, nome));
      }
    } catch (err) {
      // A poda que falha NÃO desliga o log: escrever é o serviço, apagar é higiene, e
      // trocar um disco que enche daqui a um mês por nenhum log agora é o câmbio errado.
      avisar(`[log-diario] falha ao podar arquivos antigos: ${err && err.message ? err.message : err}`);
    }
  }

  function abrir(hojeStr, hoje) {
    if (fluxo) fluxo.end();
    const alvo = path.join(diretorio, nomeDoArquivo(prefixo, hojeStr));
    fluxo = fsys.createWriteStream(alvo, { flags: 'a' });
    // O erro de escrita chega ASSÍNCRONO (disco cheio, volume que sumiu), longe do
    // `write` que o causou: sem este ouvinte ele viraria um 'error' não tratado num
    // EventEmitter, que no node derruba o processo. O log não pode matar o servidor.
    fluxo.on('error', (err) => degradar('falha ao escrever', err));
    dia = hojeStr;
    podar(hoje);
  }

  try {
    fsys.mkdirSync(diretorio, { recursive: true });
  } catch (err) {
    degradar('não foi possível criar o diretório de log', err);
  }

  return {
    write(linha) {
      if (desligado) return;
      try {
        const hoje = agora();
        const hojeStr = diaLocal(hoje);
        if (hojeStr !== dia) abrir(hojeStr, hoje);
        fluxo.write(linha);
      } catch (err) {
        degradar('falha ao escrever', err);
      }
    },
    /**
     * Fecha o arquivo do dia ESPERANDO a fila do fluxo escoar, com prazo. Ver a propriedade
     * (4) do cabeçalho.
     *
     * O DESFECHO É DEVOLVIDO, e não engolido, porque quem chama está registrando a própria
     * morte: `'fechado'` (a fila escoou), `'prazo'` (o teto estourou, e há linha perdida),
     * `'erro'` (o fluxo reclamou) ou `'nada-aberto'` (nunca houve o que escoar: destino
     * degradado, ou processo que não chegou a logar).
     *
     * O TEMPORIZADOR NÃO É `unref`, ao contrário do `forceExit` do boot, e a diferença é o
     * que faz o código de saída valer: no fim de um desligamento o laço de eventos pode
     * estar vazio, e um temporizador `unref` deixaria o node encerrar sozinho, com código
     * 0, no meio da espera, transformando a queda que se quer registrar num desligamento
     * limpo. Ele segura o processo por `prazoMs` no pior caso, que é o teto do teto.
     *
     * @param {{prazoMs?: number}} [opts]
     * @returns {Promise<{desfecho: 'fechado'|'prazo'|'erro'|'nada-aberto'}>}
     */
    fechar({ prazoMs = PRAZO_DE_FECHAMENTO_MS } = {}) {
      const alvo = fluxo;
      fluxo = null;
      dia = null;
      if (!alvo) return Promise.resolve({ desfecho: 'nada-aberto' });

      return new Promise((resolve) => {
        let pronto = false;
        let temporizador = null;
        const terminar = (desfecho) => {
          if (pronto) return;
          pronto = true;
          if (temporizador) clearTimeout(temporizador);
          resolve({ desfecho });
        };

        temporizador = setTimeout(() => terminar('prazo'), prazoMs);
        try {
          // 'finish' diz que a fila escoou e 'close' que o descritor foi fechado. Os dois
          // são ouvidos porque o segundo é o que carrega a durabilidade e o primeiro é o
          // que chega em todo `Writable`.
          alvo.on('finish', () => terminar('fechado'));
          alvo.on('close', () => terminar('fechado'));
          alvo.on('error', () => terminar('erro'));
          alvo.end();
        } catch (err) {
          avisar(`[log-diario] falha ao fechar o arquivo do dia: ${err && err.message ? err.message : err}`);
          terminar('erro');
        }
      });
    },
    /** O dia do arquivo aberto, ou null antes da primeira escrita. Existe para o teste. */
    diaAtual() {
      return dia;
    },
    /**
     * `{ ligado, diretorio, desligadoEm, causa, codigo, mensagem }`. Os quatro últimos são
     * `null` enquanto o destino escreve; `desligadoEm` é epoch ms, como todo instante do
     * diagnóstico.
     */
    estado,
  };
}
