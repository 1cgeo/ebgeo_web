# Sombreamento do relevo na administração

Commit conferido: `d2f956e8`, de 12/09/2026. É anterior à sequência desta colaboração; a autoria e a validação original constam na mensagem do commit.

## Problema e correção

A configuração permitia controlar o sombreamento pela API, mas o administrador não tinha um campo correspondente na tela após a retirada do editor JSON. Além disso, um valor de tipo incorreto poderia aparecer salvo e ser interpretado como desligado pelo mapa.

A aba Sistema, seção Mapa 2D, ganhou a opção Sombreamento do relevo. O backend valida o campo como booleano. O formulário envia somente a alteração de habilitação, preservando nome, camada, fonte e estilo definidos pelo servidor. O padrão permanece desligado; a escolha passa a ser aplicada no próximo carregamento da página.

Arquivos centrais: `frontend/src/js/admin/config-tab.js` e `backend/src/modules/config/config.admin.schemas.js`.

## Evidência registrada

A mensagem do commit registra chamadas reais de configuração: valor inválido recusado com 422, habilitação aceita com 200 e releitura com o restante do bloco preservado. Registra oito testes de backend, dez de frontend, controles negativos e lint dos dois pacotes. Esses ensaios não foram refeitos nesta retrospectiva.

Regressões permanentes: `backend/tests/unit/config-sombreamento-do-relevo.test.js` e `frontend/tests/unit/admin-sombreamento-do-relevo.test.js`.

## Limites

Esta correção oferece configuração administrativa; não altera a política de habilitação padrão nem prova disponibilidade dos serviços de relevo em cada instalação. Sua presença no histórico da integração não é evidência de implantação no servidor interno.
