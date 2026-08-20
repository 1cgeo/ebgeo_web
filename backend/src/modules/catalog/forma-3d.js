// Path: src/modules/catalog/forma-3d.js
// O EIXO DECLARADO DA FORMA DE 3D, do lado da BORDA DE ESCRITA.
//
// POR QUE ELE MORA NO `config` JSONB E NAO NUMA COLUNA. As quatro tabelas de catalogo sao
// obrigadas a ter colunas IDENTICAS (`tests/integration/catalog-tabelas-paridade.test.js`), e a
// paridade nao e capricho: o `catalog.service.js` roda a MESMA string de colunas e os mesmos
// INSERT/UPDATE contra as quatro. Uma coluna util so a `tilesets` custaria a mesma coluna morta
// em `basemaps`, `data_layers` e `analysis_layers` -- tres colunas que nenhuma consulta le e que
// todo leitor do schema teria de aprender a ignorar.
//
// O QUE ESTE ARQUIVO E, E O QUE ELE NAO E. Ele e a LISTA FECHADA, e nada mais. Quem valida e o
// Joi de `catalog.schemas.js`, que so a consome; quem deriva a forma de uma linha antiga e o
// cliente (`frontend/src/js/catalog/forma-3d.js`), porque a derivacao existe para DESENHAR e
// nao para gravar. Duplicar a derivacao aqui criaria duas respostas para a mesma pergunta, e a
// do servidor nao teria nenhum leitor.
//
// A COPIA DO CLIENTE E COBRADA. A lista existe nos dois pacotes e nada, alem do teste, obriga as
// duas a concordar: `frontend/tests/unit/forma-3d-censo.test.js` abre ESTE arquivo e exige os
// mesmos quatro valores, na mesma ordem. Divergir e o defeito classico da lista fechada duplicada
// -- o backend recusa um valor que o cliente oferece, e o formulario devolve 422 sem explicacao.

/**
 * As QUATRO formas que uma linha de `tilesets` pode declarar em `config.forma3d`.
 *
 * NAO E UMA ESCADA: nenhum valor contem outro, e compara-los por ordem e erro de leitura. O
 * `pointcloud` compartilha o CARREGADOR com o `tiles3d` (o formato dele e parte do 3D Tiles) e
 * ainda assim e uma forma propria, porque o que se perde ao conflata-los e poder DIZER na tela
 * que aquele item e uma nuvem.
 */
export const FORMAS_3D = Object.freeze(['tiles3d', 'glb', 'pointcloud', 'indoor']);

/** A chave dentro do `config` JSONB que carrega o eixo. */
export const CAMPO_FORMA_3D = 'forma3d';
