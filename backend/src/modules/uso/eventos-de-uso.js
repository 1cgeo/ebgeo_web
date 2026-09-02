// Path: src/modules/uso/eventos-de-uso.js
/**
 * @fileoverview O VOCABULÁRIO DO USO: quais gestos o produto conta, em quais páginas, e
 * qual qualificador cada gesto aceita.
 *
 * ESTE ARQUIVO É UM ESPELHO, e o par dele é `frontend/src/js/session/eventos-de-uso.js`. A
 * lista vive duas vezes porque as duas pontas fazem coisas diferentes com ela e nenhuma
 * substitui a outra: o cliente decide o que EMITIR (e não pode emitir o que o servidor
 * recusa, senão o lote inteiro morre com 422), e o servidor decide o que ACEITAR, na borda
 * e de novo no CHECK da coluna. Evento novo entra nos dois no mesmo commit, e a guarda é o
 * teste de espelho de cada lado.
 *
 * ZERO IMPORTS, e isso é contrato, pelo mesmo motivo de `origens-de-erro.js`: o Joi da
 * borda e os testes o carregam, e ele precisa continuar carregável em node puro, sem
 * `DATABASE_URL` e sem `JWT_SECRET`, que são o que a avaliação de `config.js` exige. Um
 * import daqui para qualquer coisa do módulo arrastaria serviço, banco e config atrás de
 * três listas.
 *
 * A ORDEM É PARTE DO CONTRATO, porque o espelho compara termo a termo, e ela é a da
 * JORNADA e não alfabética: a página vista, o atlas aberto, a ferramenta usada, e depois os
 * quatro visualizadores pesados, o briefing, a linha do tempo, as três saídas de arquivo, e
 * por último o desfecho que não é gesto de ninguém (a tela de indisponibilidade). Alfabética
 * faria um leitor procurar significado na vizinhança e não achar nenhum.
 *
 * O QUE ESTE VOCABULÁRIO NÃO TEM, e a ausência é o desenho inteiro: identidade, geometria,
 * nome de atlas, nome de camada, texto digitado. Um evento é (que gesto, em que página, com
 * qual qualificador FECHADO), e o servidor só guarda CONTAGEM por dia. Não há linha por
 * pessoa e não há linha por gesto: ver o cabeçalho de `020_uso_de_produto.sql`.
 */

/**
 * Os treze gestos que o produto conta, na ordem da jornada.
 *
 * Cada um responde "o que a pessoa fez", nunca "quem ela é":
 *  - `pagina.vista`            uma das quatro páginas do produto foi aberta;
 *  - `atlas.aberto`            um atlas entrou em foco (qualificado por procedência);
 *  - `ferramenta.ativada`      uma ferramenta da barra foi ligada (qualificada pelo id dela);
 *  - `medicao.aberta`          a caixa de medição foi aberta;
 *  - `visualizador3d.aberto`   o Cesium subiu;
 *  - `visualizador360.aberto`  o visualizador de foto 360 subiu;
 *  - `primeira-pessoa.aberto`  a cena caminhável (Gaussian splatting) subiu;
 *  - `briefing.apresentado`    o modo de apresentação entrou;
 *  - `temporal.ativado`        a linha do tempo do mapa foi ligada;
 *  - `pdf.exportado`           saiu um PDF (qualificado por motor: folha ou mosaico);
 *  - `ebgeo.exportado`         saiu um `.ebgeo`;
 *  - `ebgeo.importado`         entrou um `.ebgeo`;
 *  - `indisponivel.visto`      a tela de indisponibilidade foi desenhada. É o único que não
 *                              é gesto de ninguém, e é o mais importante da lista: ele conta
 *                              quantas pessoas bateram no boot fail-fast, que é a única
 *                              medida de disponibilidade VISTA DA PONTA que este produto tem.
 */
export const EVENTOS_DE_USO = Object.freeze([
  'pagina.vista',
  'atlas.aberto',
  'ferramenta.ativada',
  'medicao.aberta',
  'visualizador3d.aberto',
  'visualizador360.aberto',
  'primeira-pessoa.aberto',
  'briefing.apresentado',
  'temporal.ativado',
  'pdf.exportado',
  'ebgeo.exportado',
  'ebgeo.importado',
  'indisponivel.visto',
]);

/**
 * O QUALIFICADOR de cada evento, e o valor da chave tem TRÊS significados, não dois.
 *
 * Esta é a parte que se lê errado, então ela está dita em voz alta:
 *  - uma LISTA NÃO VAZIA  o `prop` precisa ser um daqueles valores (ou vazio, ver abaixo);
 *  - uma LISTA VAZIA      o evento não aceita qualificador nenhum, e `prop` não vazio é 422;
 *  - `null`               o qualificador é LIVRE, limitado por forma (o id da ferramenta).
 *
 * `null` NÃO significa "sem qualificador", que é a leitura natural e é o avesso do que ele
 * quer dizer. Quem confundir os dois estados escreve um gate que aceita qualquer texto no
 * evento errado, ou que recusa o id de toda ferramenta nova. A distinção é `=== null` contra
 * `.length === 0`, e nunca uma checagem de veracidade.
 *
 * `prop` VAZIO É SEMPRE ACEITO, inclusive nos eventos com lista fechada, e isso é decisão
 * com preço declarado. Um cliente que não sabe qualificar o gesto manda o evento sem
 * qualificador, e a linha resultante continua sendo uma contagem VERDADEIRA (o total daquele
 * gesto, sem recorte); um cliente que INVENTE um qualificador polui o agrupamento, que é a
 * única coisa que o recorte existe para dar. É a mesma escolha, pela mesma razão, do relato
 * de erro do navegador (`diag.schemas.js`): perder o dado inteiro para salvar a coerência da
 * decoração é o câmbio errado, mas decoração inventada não entra.
 *
 * POR QUE `ferramenta.ativada` É A ÚNICA LIVRE. As ferramentas de desenho nascem por skill
 * (`new-tool`) e o inventário delas cresce com o produto; fechá-lo aqui obrigaria uma
 * migração a cada ferramenta nova, para um campo que não gateia nada e não autoriza nada. O
 * preço é a única dimensão de cardinalidade aberta da tabela de contagens, e ele está
 * medido, com o teto que o contém, no cabeçalho de `020_uso_de_produto.sql`.
 */
export const PROPS_PERMITIDAS = Object.freeze({
  'pagina.vista': Object.freeze([]),
  // A procedência do atlas: é o que separa "o produto é usado offline" de "o produto é usado
  // no servidor", que é a pergunta de produto mais cara de responder por qualquer outro meio.
  'atlas.aberto': Object.freeze(['local', 'servidor', 'publico']),
  // O id da ferramenta, livre por forma. Ver o parágrafo acima.
  'ferramenta.ativada': null,
  'medicao.aberta': Object.freeze([]),
  'visualizador3d.aberto': Object.freeze([]),
  'visualizador360.aberto': Object.freeze([]),
  'primeira-pessoa.aberto': Object.freeze([]),
  'briefing.apresentado': Object.freeze([]),
  'temporal.ativado': Object.freeze([]),
  // Os DOIS motores de PDF do mesmo painel (`isMosaic` decide qual roda), e eles não têm as
  // mesmas propriedades: a folha única sai georreferenciada por GDAL, o mosaico sai por
  // jsPDF e não sai. Contar os dois juntos apagaria justamente a diferença que interessa.
  'pdf.exportado': Object.freeze(['folha', 'mosaico']),
  'ebgeo.exportado': Object.freeze([]),
  'ebgeo.importado': Object.freeze([]),
  'indisponivel.visto': Object.freeze([]),
});

/**
 * As QUATRO páginas do produto, e a lista é a mesma dos quatro `input` de `vite.config.js`.
 *
 * Ela é fechada aqui e no CHECK da coluna porque é a dimensão de agrupamento de tudo o mais:
 * uma quinta página inventada pelo cliente não seria um dado a mais, seria uma linha que não
 * casa com nenhuma tela e que ninguém consegue interpretar depois.
 */
export const PAGINAS = Object.freeze(['mapa', 'atlas', 'admin', 'calibracao']);
