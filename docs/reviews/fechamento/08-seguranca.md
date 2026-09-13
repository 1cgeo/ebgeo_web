# Segurança e dependências restantes

Status: pendente. Prioridade: bloqueia lançamento. Inventário pode continuar cedo; conclusão exige o candidato final.

## Estado comprovado

Instalação limpa e auditoria npm do primeiro checkpoint terminaram sem alertas na raiz, frontend e backend. As versões corrigidas e evidências estão no [inventário datado](../dependencias-lancamento-inventario.json). Isso não cobre automaticamente vendors distribuídos, imagem de runtime ou bibliotecas WASM, nem transforma o aviso da branch padrão em avaliação desta branch.

Pontos de atenção já identificados: versão/proveniência de Turf e GDAL; divergência entre banner e versão interna de milsymbol; componentes de documentação e renderização; imagem Docker efetivamente usada na rede interna. As observações do inventário são pistas para confirmar, não resultados finais de vulnerabilidade.

## Trabalho

1. Fixar o SHA candidato e atualizar o inventário de dependências diretas, transitivas, vendors, WASM e imagem/runtime. Confirmar versão por fonte confiável, hash e proveniência; não inferir apenas do nome do arquivo.
2. Consultar avisos oficiais atuais e classificar versão afetada, exposição real, runtime/build/teste, correção disponível e impacto. Registrar data e fonte. Não repetir como atuais contagens históricas de alertas.
3. Atualizar ou substituir componentes afetados de forma controlada. Preservar instalação reproduzível; não executar correção forçada indiscriminada. Ausência de correção exige mitigação verificável e decisão explícita.
4. Revisar autorização entre atlas, acesso a uploads/recibos/sockets após revogação, expiração e limites de recursos. Seguir `CONSTITUICAO.md`, sem criar papéis ou atalhos de permissão.
5. Registrar dependências da infraestrutura que não puderem ser verificadas localmente para a [liberação interna](10-liberacao-interna.md).

## Aceite

Nenhuma vulnerabilidade crítica/alta aplicável e explorável permanece sem correção ou mitigação demonstrada. Riscos restantes têm decisão e responsável. Instalação limpa, lint, testes, build e cenários dos componentes alterados passam. Zero alertas npm sozinho não encerra esta tarefa. Alterar vendors, lockfiles ou implantação exige respeitar o contexto de autorização e as instruções do repositório, sem modificar o servidor interno nesta sessão.
