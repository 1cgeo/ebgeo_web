// Path: src/modules/diag/diag.controller.js
import config from '../../config.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { NotFoundError } from '../../utils/errors.js';
import * as diagService from './diag.service.js';
import * as defeitos from './defeitos.service.js';
import { montarResumoCompleto } from './resumo.service.js';
import { resolverPilhaDeDefeito } from './pilha.service.js';
import * as usoService from '../uso/uso.service.js';

/**
 * O DIRETÓRIO DE LOG É DECIDIDO AQUI E NUNCA PELO CHAMADOR.
 *
 * O comando aceita `--dir`, e o paralelo tentador seria um `?dir=` nesta rota. Não existe,
 * de propósito: seria um leitor de arquivo arbitrário do servidor, com o filtro de "linha
 * que faz JSON.parse" como única barreira, atrás de um gate de administrador — e um
 * administrador não deve poder ler `/etc` pela porta do diagnóstico. Quem precisa de outro
 * diretório usa o comando, no servidor, onde já tem shell.
 */
const diretorio = () => config.log.dir;

/**
 * A frase do 404 das TRÊS rotas que agem sobre UM defeito.
 *
 * Uma constante e não três literais: ela nomeia a causa mais provável (a poda por idade passou
 * entre a listagem e o clique), e três cópias divergiriam no dia em que o critério da poda
 * mudasse, deixando duas rotas explicando o produto de um jeito que deixou de ser verdade.
 */
const DEFEITO_INEXISTENTE = 'Defeito não encontrado. A poda por idade apaga defeito e '
  + 'ocorrências juntos, então um id que a listagem mostrou minutos atrás pode ter envelhecido.';

export const erros = asyncHandler(async (req, res) => {
  const { desde, limite } = req.query;
  res.json({ data: await diagService.erros({ diretorio: diretorio(), desde, limite }) });
});

export const lento = asyncHandler(async (req, res) => {
  const { desde, limite, porRelease } = req.query;
  res.json({ data: await diagService.lento({ diretorio: diretorio(), desde, limite, porRelease }) });
});

/**
 * OS BURACOS NA SÉRIE DE AMOSTRAS: a queda que nenhuma amostra pode declarar.
 *
 * É a segunda porta de `npm run diag -- saude`, e ela nasceu em 2026-09-02 pela decisão de que
 * o caso comum é um agente com credencial de administrador operando de FORA do host. O que ela
 * responde não está em nenhuma das irmãs: um amostrador dentro do processo não testemunha a
 * própria morte, então o sinal de queda é o SILÊNCIO entre duas amostras, e contá-lo é a única
 * pergunta desta família que o `.jsonl` responde e o banco não.
 *
 * `intervalo` ATRAVESSA COMO TEXTO até o serviço, como `desde`: o Joi valida a forma e guarda
 * a string para que a recusa possa citar o que a pessoa escreveu.
 */
export const saude = asyncHandler(async (req, res) => {
  const { desde, intervalo } = req.query;
  res.json({ data: await diagService.saude({ diretorio: diretorio(), desde, intervalo }) });
});

/**
 * O DESPEJO CRU FILTRADO: o `grep` no `.jsonl`, pela porta HTTP.
 *
 * ELA É A ÚNICA ROTA DESTA FAMÍLIA QUE NÃO AGREGA, e é por isso que ela existe: as outras
 * respondem "quais defeitos" e "o que está devagar", agrupando; esta responde "o que o servidor
 * escreveu em volta DESTE id", que é a costura entre o erro que o navegador relatou (o
 * `sessaoId` que viaja em `X-EBGeo-Sessao`) e as linhas do mesmo instante. Quem tem shell no
 * host faz isso com `grep`; quem não tem, não fazia de jeito nenhum.
 *
 * O QUE SAI É O QUE O ARQUIVO TEM. A redação de credencial acontece na ESCRITA (`redactUrl`
 * sobre a URL da requisição, `elidirSql` sobre o texto de SQL, nos dois caminhos que chegam ao
 * arquivo), e esta rota não redige nada por cima: um segundo filtro aqui faria a resposta
 * divergir do arquivo que ela afirma estar mostrando, e o operador que comparasse as duas
 * concluiria que uma delas está errada. O gate é `auth` + `requireAdmin`, e o que ele libera é
 * o log do servidor.
 *
 * `?dir=` NÃO EXISTE AQUI TAMPOUCO, e aqui a ausência pesa mais que nas irmãs: elas agregam, e
 * esta devolve LINHA. Com um diretório do chamador, ela seria um leitor de arquivo arbitrário
 * do servidor com "linha que faz JSON.parse" como única peneira.
 */
export const linhas = asyncHandler(async (req, res) => {
  const { desde, filtro, limite } = req.query;
  res.json({ data: await diagService.linhas({ diretorio: diretorio(), desde, filtro, limite }) });
});

/**
 * O pulso do serviço, MAIS a build que está no ar.
 *
 * POR QUE O `release` ENTRA AQUI E NÃO NO `/health`. O commit implantado nomeia a versão exata
 * do código rodando, e o `/health` não tem credencial nenhuma: publicá-lo lá seria entregar
 * essa informação a quem só sabe o endereço do servidor. Esta rota já é `auth` + `requireAdmin`
 * (`diag.routes.js`), e o administrador é justamente quem precisa dela — a primeira pergunta
 * diante de um erro que voltou é se ele voltou na MESMA build, e a resposta tem de estar ao
 * lado das contagens que ele acabou de ler.
 *
 * POR QUE NO CONTROLLER E NÃO NO SERVIÇO. `diag.service.js` não importa `config`, e a ausência
 * é declarada no `fileoverview` dele: é o que o mantém exercível em node sem `DATABASE_URL` nem
 * `JWT_SECRET`. Ler a env aqui é a mesma decisão (e o mesmo lugar) do `diretorio()` acima.
 *
 * `?? null` E NUNCA A CHAVE AUSENTE: aqui o `null` significa uma coisa só, "esta instalação não
 * declarou release", e a tela precisa poder dizer isso em voz alta em vez de calar. É o oposto
 * da regra do `enderecos` no relatório de erros, onde a chave ausente distingue servidor antigo
 * de zero endereços.
 *
 * ─── `releases`, desde 2026-09-02: a SAÚDE das builds que estiveram no ar ───
 *
 * `release` (singular) diz qual build ESTE processo é; `releases` (plural) diz como as builds
 * que responderam na janela estão se saindo: sessões, sessões com erro, defeitos que nasceram
 * nelas e regressões atribuídas a elas. As duas respondem perguntas diferentes e a segunda só
 * existe porque a telemetria de USO passou a existir: sem contagem de sessões, "esta build tem
 * mais defeitos" é indistinguível de "esta build foi mais usada".
 *
 * A CONSULTA MORA EM `uso`, E ESTE CONTROLLER É QUEM COMPÕE, e a direção não é acidente:
 * `diag.service.js` não importa `config` nem o banco, e essa ausência é declarada no
 * `fileoverview` de lá porque é ela que o mantém exercível em node puro. Pôr uma consulta de
 * `uso_sessoes` lá dentro derrubaria a propriedade por uma linha de payload. Aqui, ao lado do
 * `config.release` que já era lido, o custo é zero. O paralelo com `diagService.status` é
 * deliberado: uma lê DISCO e a outra lê BANCO, então elas não competem por recurso nenhum.
 *
 * ─── O `catch` NÃO É DEFENSIVO, ELE É O CONTRATO DESTA ROTA ───
 *
 * `GET /diag/status` é o PULSO, e até 2026-09-02 ela era a única rota de diagnóstico que
 * respondia com o banco fora, porque tudo o que ela lia era arquivo. Um `Promise.all` cru com
 * a consulta de release desfazia exatamente isso: a rota que o administrador abre QUANDO algo
 * está errado passaria a morrer junto com o Postgres, e o bloco de disco (contagens, faixas de
 * status, taxa de erro), que continuava perfeitamente legível, iria embora com ele. O
 * diagnóstico não pode ser a primeira coisa a cair.
 *
 * `releases: null` E NÃO `[]`, e a distinção é a resposta: `[]` significa "nenhuma build
 * respondeu nesta janela", que é um FATO sobre o produto; `null` significa "não deu para
 * perguntar", que é um fato sobre o SERVIDOR. Colapsar os dois faria a tela anunciar silêncio
 * de tráfego no exato momento em que o banco está fora, que é a leitura mais errada possível.
 * É a mesma regra do `enderecos` no relatório de erros, pelo outro lado.
 */
export const status = asyncHandler(async (req, res) => {
  const [dados, releases] = await Promise.all([
    diagService.status({ diretorio: diretorio(), desde: req.query.desde }),
    // Ver o cabeçalho: o banco fora não pode levar junto a metade de DISCO desta rota.
    usoService.saudeDasReleases({ desde: req.query.desde }).catch(() => null),
  ]);
  res.json({ data: { ...dados, release: config.release ?? null, releases } });
});

/**
 * O RELATÓRIO DE UMA TELA, das DUAS fontes, que é o que a aba de Diagnóstico mostra.
 *
 * ELE É A SEGUNDA PORTA DE `npm run diag -- resumo`, e a composição é literalmente a mesma
 * função (`montarResumo`, pura, em `src/utils/diag-consulta.js`): o documento que sai daqui é
 * o do `--json` do comando menos o campo `comando`. Uma segunda verdade sobre o que "os cinco
 * blocos" significam faria a tela e o terminal divergirem no dia em que um dos dois fosse
 * consertado, e o comando é o que um agente lê.
 *
 * O `catch` NÃO ESTÁ AQUI, e essa é a diferença para `status` logo acima. Lá o embrulho é do
 * controller porque a consulta de release é um ACRÉSCIMO a uma rota que sempre foi de disco;
 * aqui a tolerância às duas fontes é o CONTRATO do relatório, e ela mora dentro de
 * `montarResumoCompleto`, ao lado da leitura que pode falhar. Pôr um `.catch` aqui devolveria
 * `data: null` no exato caso que a rota existe para atravessar.
 *
 * O DIRETÓRIO SAI DE `diretorio()`, pela mesma razão das irmãs de log: um `?dir=` seria um
 * leitor de arquivo arbitrário do servidor atrás de um gate de administrador.
 *
 * `intervalo` ENTROU EM 2026-09-02 e é o `--intervalo` do comando. Sem ele, o bloco de saúde
 * deste relatório respondia SEMPRE sobre o intervalo inferido, e a bandeira que existe
 * justamente para o caso em que a inferência não alcança (uma série em que nenhuma distância é
 * nominal) não tinha porta HTTP nenhuma.
 */
export const resumo = asyncHandler(async (req, res) => {
  const { desde, limite, intervalo } = req.query;
  res.json({ data: await montarResumoCompleto({ diretorio: diretorio(), desde, limite, intervalo }) });
});

/**
 * Recebe um erro do navegador. 204: quem relata não tem o que fazer com um corpo.
 *
 * A IDENTIDADE SAI DE `req.user`, e o corpo não tem campo para ela (ver `diag.schemas.js`).
 * `flexibleAuth` é global e não-bloqueante, então aqui `req.user` já está preenchido para
 * quem tem credencial e ausente para o anônimo — que PRECISA passar: o app roda deslogado,
 * e é justamente no visitante que um erro de tela não tem nenhuma outra testemunha.
 *
 * O `user-agent` do CABEÇALHO tem precedência sobre o do corpo porque é o que o navegador
 * diz de si; o corpo é o que o cliente escolheu dizer. O corte em 300 repete o teto do Joi
 * porque este valor não passou por ele: cabeçalho é entrada tão externa quanto o corpo.
 */
export const registrarErroDeCliente = asyncHandler(async (req, res) => {
  const relato = {
    ...req.body,
    userAgent: (req.get('user-agent') || req.body.userAgent || '').slice(0, 300),
  };
  await defeitos.registrarErroDeCliente(relato, req.user?.id ?? null);
  res.status(204).end();
});

/**
 * A listagem TRANSITÓRIA, com o shape de quando a tabela se chamava `client_errors`.
 *
 * Ela sobrevive à renomeação porque a aba de Administração ainda a consome; o consumidor
 * troca para `defeitos` no lote seguinte, e é aí que esta rota sai. Enquanto isso, ela lê a
 * tabela nova recortada em `origem IS DISTINCT FROM 'servidor'`, ou seja, responde exatamente
 * o que respondia antes de o erro de servidor entrar na mesma tabela.
 */
export const listarErrosDeCliente = asyncHandler(async (req, res) => {
  res.json({ data: await defeitos.listarErrosDeCliente(req.query) });
});

/**
 * Os DEFEITOS da janela, com ciclo de vida.
 *
 * `req.query` VAI INTEIRO para o serviço, e isso é seguro por uma razão que precisa
 * continuar valendo: `validate()` roda com `stripUnknown`, então o que chega aqui é
 * exatamente o que `defeitosQuerySchema` declara, com os defaults já aplicados. Um filtro
 * novo que não passe pelo schema chegaria como `undefined` e sumiria calado.
 */
export const listarDefeitos = asyncHandler(async (req, res) => {
  res.json({ data: await defeitos.listarDefeitos(req.query) });
});

/**
 * UM defeito, pelo id, no MESMO shape da listagem.
 *
 * ELA EXISTIA SÓ NO COMANDO (`npm run diag -- defeitos --id <uuid>`) até 2026-09-02, e a
 * ausência dela na porta HTTP obrigava o agente de fora a paginar a listagem procurando um id
 * que ele já tinha em mãos, com os filtros e a janela dela por cima. `obterDefeito` é a MESMA
 * função de serviço que o comando chama, sobre o MESMO mapeador da listagem: é isso que
 * garante que `GET /diag/defeitos` e `GET /diag/defeitos/:id` respondam o mesmo objeto sobre o
 * mesmo defeito, que é a comparação que um agente faz para se orientar.
 *
 * 404 E NÃO LISTA VAZIA, ao contrário da rota de ocorrências logo abaixo, e a assimetria não é
 * inconsistência: lá a pergunta é "o que este defeito registrou", e zero evidências é uma
 * resposta legítima; aqui a pergunta é "me dê ESTE defeito", e um 200 com corpo vazio diria
 * que ele existe e não tem conteúdo. É a mesma regra do `PATCH`: o que não existe tem de ser
 * dito.
 *
 * A JANELA NÃO ENTRA AQUI. `SELECT_DEFEITO_POR_ID` busca pelo id e nada mais, então um defeito
 * que caiu fora da janela de sete dias continua alcançável enquanto a poda por idade não
 * passar. É o que faz esta rota servir para conferir um id anotado ontem sem ter de adivinhar
 * qual `?desde=` o traria de volta.
 */
export const obterDefeito = asyncHandler(async (req, res) => {
  const item = await defeitos.obterDefeito(req.params.id);
  if (!item) throw new NotFoundError(DEFEITO_INEXISTENTE);
  res.json({ data: item });
});

/**
 * A PILHA CRUA DE UM DEFEITO, DESMINIFICADA DO LADO DO SERVIDOR.
 *
 * ELA EXISTIA SÓ NO COMANDO, e não por acaso: `npm run diag -- pilha` precisa dos `.map` da
 * build, que moram no HOST. É justamente por isso que ela é a rota mais necessária das quatro
 * que nasceram em 2026-09-02: o agente de fora não tem aqueles arquivos e não tem como obtê-los.
 * O diretório vem de `EBGEO_MAPAS_DIR` (`config.mapasDir`), decidido pelo servidor, pela mesma
 * razão do `diretorio()` do log: um `?mapas=` seria um leitor de arquivo arbitrário do host
 * atrás de um gate de administrador.
 *
 * O DESFECHO É TERNÁRIO, e só um dos três é 404. Defeito inexistente é 404 (a pergunta era
 * sobre uma linha que não está lá); tudo o mais é 200 com `disponivel: false` e um motivo em
 * CÓDIGO, porque "o servidor não tem os mapas", "o relato não trouxe a pilha" e "a build foi
 * podada" são três providências diferentes, e duas delas nem são de quem está lendo. Um 500 em
 * qualquer desses casos diria que o diagnóstico quebrou.
 *
 * A ENTRADA É HOSTIL POR CONSTRUÇÃO, e isso decide o desenho de `pilha.service.js`:
 * `stack_bruta` é texto livre que chegou pela ÚNICA rota anônima deste servidor
 * (`POST /diag/erro-cliente`), então os endereços de dentro dela são escolhidos por quem
 * relata. O caminho do `.map` derivado deles é filtrado por FRONTEIRA DE CAMINHO contra o
 * diretório da release (`dentroDaRaiz`), e o quadro cujo candidato escapa resolve como
 * `sem-mapa`, sem tocar o disco fora dali. Nenhuma mensagem deste caminho ecoa conteúdo de
 * arquivo, e o payload não publica caminho nenhum do host.
 */
export const pilhaDeDefeito = asyncHandler(async (req, res) => {
  const defeito = await defeitos.obterDefeito(req.params.id);
  if (!defeito) throw new NotFoundError(DEFEITO_INEXISTENTE);
  res.json({ data: await resolverPilhaDeDefeito({ defeito, mapasDir: config.mapasDir }) });
});

/**
 * As ocorrências de um defeito (no máximo vinte, ver `TETO_DE_OCORRENCIAS`).
 *
 * SEM 404 PARA DEFEITO INEXISTENTE, de propósito: a poda por idade pode ter passado entre a
 * listagem que o administrador está lendo e o clique dele, e um 404 ali leria como "a rota
 * quebrou" em vez de "isto envelheceu". Lista vazia é a resposta honesta para as duas
 * causas, e a tela já precisa desenhar o vazio de qualquer jeito.
 */
export const listarOcorrencias = asyncHandler(async (req, res) => {
  res.json({ data: await defeitos.listarOcorrencias(req.params.id) });
});

/**
 * Resolve, ignora ou reabre um defeito. É a única ESCRITA de administrador deste módulo.
 *
 * 404 E NÃO 204, ao contrário da rota irmã de ocorrências logo acima, e a assimetria é
 * deliberada. Lá, defeito inexistente devolve lista VAZIA porque a pergunta é de LEITURA e a
 * poda pode ter passado entre a listagem e o clique: um 404 ali leria como "a rota quebrou".
 * Aqui a pergunta é de ESCRITA, e responder 200 sobre uma linha que não existe diria ao
 * administrador que o ato dele valeu quando ele não mudou nada. Um ato que não aconteceu tem
 * de ser dito.
 *
 * O ATOR SAI DE `req.user`, NUNCA DO CORPO. É o mesmo gate de identidade de
 * `registrarErroDeCliente`, e aqui ele pesa mais: este valor vai para `resolvido_por` E para
 * `actor_id` da trilha, ou seja, aceitá-lo do corpo deixaria um administrador assinar o ato
 * no nome de outro. `estadoDeDefeitoSchema` não tem campo para isso, e `stripUnknown`
 * descartaria um que viesse.
 *
 * A RESPOSTA É O ITEM INTEIRO, no mesmo shape de `GET /diag/defeitos`, e não um `{ ok: true }`:
 * a tela precisa redesenhar a linha com `resolvidoEm`, `resolvidoPorUsername` e
 * `resolvidoNaRelease` já preenchidos, e um segundo GET para isso abriria a janela em que
 * outro relato chega e a tela mostra um estado que não é o do ato que ela acabou de fazer.
 */
export const mudarEstadoDeDefeito = asyncHandler(async (req, res) => {
  const r = await defeitos.mudarEstadoDoDefeito({
    id: req.params.id,
    estado: req.body.estado,
    commit: req.body.commit,
    userId: req.user.id,
    req,
  });
  if (!r) throw new NotFoundError(DEFEITO_INEXISTENTE);
  res.json({ data: r.item });
});
