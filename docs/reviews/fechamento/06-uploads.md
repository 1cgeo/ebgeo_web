# Uploads duráveis e referências de recursos

Status: pendente. Prioridade: bloqueia lançamento. Depende de [persistência](02-persistencia.md), [conflitos](03-conflitos.md) e [coordenação de sessão](05-abas-e-recuperacao.md).

## Problema e arquivos

`frontend/src/js/store/sync/image-sync.js` ainda pode deixar uma imagem somente local após falha, pedindo reinserção. Não há fila durável completa de retry dos blobs. Fila de operações vazia não prova que o colaborador consegue abrir a imagem referenciada.

Revisar esse módulo, `frontend/src/js/store/settings.operations.js`, `frontend/src/js/store/cesium3d.operations.js`, `frontend/src/js/store/streetview360.operations.js`, `backend/src/modules/images/images.service.js`, `backend/src/modules/images/images.routes.js` e `backend/src/modules/images/images.schemas.js`.

## Correção

1. Inventariar upload por desenho, colagem, importação, briefing, 3D e 360. Identificar quais referências são uploads locais e quais apontam para recursos já existentes no servidor.
2. Persistir blob e metadados no escopo do atlas antes de anunciar retomada. Usar identidade estável de tentativa e resultado deduplicável no backend, com autorização, tamanho e formato validados.
3. Vincular a operação ao recurso obrigatório. Só confirmar sincronização completa quando o recurso existir e puder ser acessado por um colaborador autorizado.
4. Retomar após F5, rede oscilante, expiração e resposta perdida após upload concluído. Distinguir erro transitório de recusa definitiva; não criar novo recurso a cada retry.
5. Logout confirmado descarta as pendências locais abrangidas, sem excluir recursos já confirmados no servidor. Limpeza de temporários/órfãos precisa respeitar referências válidas e uploads em andamento.

## Aceite

Falhar antes/depois do blob local, no meio da transferência e depois da gravação remota antes da resposta. Reabrir e verificar o mesmo recurso, sem duplicação, em outro cliente. Testar quota, arquivo inválido, limite de tamanho, revogação e troca/logout durante callback. O indicador deve permanecer pendente ou apresentar recusa enquanto o recurso necessário não estiver disponível. Integrar resultados com [indicadores e administração](07-indicadores-e-administracao.md).
