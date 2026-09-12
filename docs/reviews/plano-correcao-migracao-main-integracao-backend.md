# Plano de correção da atualização main → integracao_backend

Data: 12/09/2026. Status: correções implementadas localmente; homologação e publicação pendentes.
Evidências e limites: [execução do plano](execucao-correcao-migracao-2026-09-12.md).
Base: [revisão e reproduções](2026-09-12-migracao-main-integracao-backend.md).

## Objetivo e condições de aceite

Atualizar instalações antigas sem perder conteúdo ou associações entre mapas, feições,
imagens, camadas e grupos, mesmo quando o usuário pular versões ou a migração for interrompida.
Manter domínio, protocolo e porta. A publicação permanece bloqueada até os critérios abaixo
serem demonstrados.

- Migração concluída significa conteúdo validado e destino ativado, não apenas versão gravada.
- A retomada reutiliza os mesmos IDs e resultados; não duplica entidades nem cria outro atlas.
- Nenhum caminho de erro limpa o acervo ou inicia um editor gravando sobre estado parcial.
- Uma aba antiga não pode sobrescrever o atlas que a versão nova está editando.
- Alterações tardias no armazenamento legado precisam ser detectadas e oferecidas para
  recuperação; isolamento, sozinho, não é prova de que a cópia inicial incluiu essas alterações.
- O retorno meses depois funciona diretamente, sem depender de uma visita a uma versão intermediária.

## Decisões de implementação

**R1 e R2 serão uma correção conjunta.** Manter a conversão para UUID onde o contrato atual
a exige, mas calcular e persistir a correspondência antes de transformar registros. Preservar
UUIDs já válidos e migrar as referências às imagens junto com as feições. O planejamento dos
IDs deve distinguir tipo/escopo e tratar explicitamente referências compartilhadas.

**Usar preparação em um namespace separado para acervos legados expostos à main.** Os bancos
sem sufixo permanecem como origem de recuperação. Os resultados só se tornam o atlas ativo
após validação. Isso substitui a adoção sem cópia nesse caminho: tem custo de disco, mas impede
que uma aba da main continue escrevendo no destino da integração. Não aplicar cópia indiscriminada
a atlas novos que já estejam em namespaces exclusivos.

Essa mudança precisa incluir o slot sem sufixo que já tenha sido adotado e carimbado 3.0 por
uma versão anterior da integração. O critério é o endereço de armazenamento e o estado da
transição, não somente `schemaVersion`. Manter estável a identidade pública do atlas ao trocar
seu endereço de armazenamento.

**Não assumir que silêncio significa ausência de aba antiga.** A ponte `PING`/`PONG` ajuda
a identificar conflitos conhecidos; não comprova que uma aba suspensa morreu. Web Locks entre
clientes novos também não bloqueiam um escritor antigo que nunca participou deles. A proteção
dos dados dependerá do isolamento, da validação e da recuperação de divergências.

**Preservar a origem durante a transição.** Não apagar automaticamente o legado ao terminar.
Identificar sua finalidade e contabilizar o espaço, para que duas cópias não sejam apresentadas
como dois atlas independentes. A limpeza posterior será um fluxo separado, condicionado a
recuperação/exportação verificada e ausência de pendências; não é requisito deste primeiro corte.

## Entrega 1 : Preparar a proteção antes de qualquer escrita

Dependências: nenhuma. Resolve a ordem de inicialização e prepara R3.

1. Mapear os primeiros escritores do boot: registro de atlas, promoção de origem, migração de
   fila, criação de mapa padrão e inicialização de serviços. Incluir `index.html`, `atlas.html`
   e entradas por link remoto. A proteção deve anteceder essas escritas no acervo legado.
2. Criar uma etapa inicial de leitura/classificação do armazenamento: vazio, legado,
   transição pendente, destino validado ou situação que exige recuperação.
3. Serializar os novos clientes que tentem migrar a mesma origem. Definir e testar o comportamento
   quando a primitiva de exclusão estiver indisponível; não conceder migração concorrente
   apenas porque o navegador não suporta o mecanismo.
4. Implementar a ponte do protocolo antigo nas duas ordens de abertura. Quando houver uma aba
   antiga detectada, manter a nova na tela de transição e orientar salvar/fechar a antiga.
   Não apresentar o `TAKEOVER` antigo como confirmação de que todas as gravações terminaram.
5. Centralizar a seleção de namespace para impedir que outro caminho contorne essa etapa.

Arquivos principais: `frontend/src/js/index.js`, `store/store.js`, `utilities/tab-lock.js`,
`store/atlas-namespace.js`, `store/local-atlas.api.js` e os pontos de entrada de atlas.

Aceite: instrumentar as escritas e provar que nenhuma migração/limpeza do legado acontece
antes da classificação. Dois clientes novos convergem para uma única transição. Uma aba da
main detectada não divide a permissão de escrita com a nova.

## Entrega 2 : Construir a migração retomável e preservar as imagens

Dependências: entrega 1. Resolve R1 e R2; fornece o isolamento necessário a R3.

1. Criar um registro persistido de transição contendo origem, destino, versão do procedimento,
   inventário de entrada, correspondência de IDs e progresso por unidade de trabalho.
   Persistir o endereço de destino antes de copiar: um reinício não deve criar outro namespace.
2. Ler e preservar os registros de entrada usados na transformação. O plano de IDs deve ficar
   persistido antes da primeira gravação transformada. Retomadas não geram novos UUIDs para
   entidades que já tenham correspondência.
3. Aplicar as etapas históricas no destino, deixando a origem intacta. Copiar por unidades
   limitadas e registrar progresso depois de confirmar a escrita. Uma unidade repetida deve
   produzir o mesmo resultado. Evitar carregar todas as imagens simultaneamente em memória.
4. Remapear feições, camadas, grupos, camada ativa e referências relacionadas; copiar blobs sob
   os IDs finais. Inventariar também símbolos, medidas, ícones personalizados, anexos e referências
   3D/360, preservando os IDs que não pertençam à transformação.
5. Validar o destino por leitura independente: registros, relações, geometria, atributos,
   associações e bytes/hash das imagens. Comparar anomalias preexistentes com o inventário
   original para distinguir dado já incompleto de corrupção introduzida pela migração.
6. Conferir alterações na origem durante a preparação. Havendo divergência ou associação
   inconsistente, manter a transição pendente e preservar as versões encontradas. Duas leituras
   iguais não serão anunciadas como prova de ausência de escritor legado.
7. Após validação, marcar o destino pronto e só então atualizar o registro/ponteiro que o ativa.
   Um fechamento entre esses passos deve retomar o mesmo destino pronto. O marcador de versão
   fica no destino; o legado não recebe um carimbo que impeça sua recuperação.
8. Tratar `QuotaExceededError` em qualquer passo. A estimativa de espaço é informativa;
   as gravações ainda podem falhar. Nesse caso, preservar a origem, manter o progresso utilizável
   e oferecer recuperação/exportação sem recomendar limpar os dados do site.

Arquivos principais: `store/migration/*`, `store/repository.js`, `store/atlas-namespace.js`,
`store/local-atlas.api.js`. Criar módulos pequenos para plano/progresso e validação.

Aceite: R1 e R2 passam; interromper antes/depois de cada gravação e da ativação final,
reiniciar o processo e obter o mesmo atlas, com as mesmas associações e imagens. Repetir com
falha de quota na preparação, nos blobs e no registro final. A origem permanece recuperável.

## Entrega 3 : Fechar a convivência com abas antigas e a recuperação

Dependências: entregas 1 e 2. Fecha R3 e o comportamento de erro do boot.

1. Trocar o retorno silencioso de migração parcial para um resultado explícito de recuperação.
   Não abrir o editor gravável nem sincronizar um destino ainda não validado.
2. Apresentar estados compreensíveis: atualização em andamento, outra janela aberta, falta de
   espaço, atualização interrompida e dados antigos alterados. Oferecer retomar e salvar cópia
   de recuperação. Não transformar mensagens de suporte em instruções para apagar armazenamento.
3. Verificar novamente o legado ao retomar foco e em boots posteriores. Uma aba antiga pode
   gravar depois de o destino ter sido ativado. Guardar um ponto de comparação e importar a
   divergência como material recuperável, sem sobrescrever automaticamente o trabalho novo.
   Se não houver base confiável para mesclar, permitir abrir/exportar uma cópia identificada.
4. Não tentar adivinhar associações já perdidas por migrações anteriores. Usar correspondência
   preservada quando existir; quando faltar evidência, conservar os blobs/registros e informar
   a pendência em vez de associar uma imagem à feição errada.
5. Disponibilizar a recuperação local mesmo quando a API de configuração estiver indisponível.
   Isso pode ser uma tela pequena e independente do editor; não exige tornar toda a aplicação
   utilizável offline. A cópia de recuperação deve incluir o estado bruto necessário à retomada,
   pois o `.ebgeo` normal não representa todos os campos do armazenamento.
6. Registrar sucesso/erro por versão de entrada e etapa, contagens e categoria da falha.
   Não registrar geometrias, imagens ou conteúdo do usuário nos eventos de diagnóstico.

Aceite: falha de migração ou de API não força o usuário a limpar dados; ele consegue preservar
o acervo. Aba da main reativada não escreve no destino; suas alterações tardias são detectadas
e podem ser recuperadas. O teste R3 original deve continuar exigindo segurança; ampliar os
testes para provar também isolamento e recuperação, sem trocar a expectativa pelo defeito.

## Entrega 4 : Ensaiar a atualização real

Dependências: entregas 1–3.

1. Produzir dados com builds históricos em perfis descartáveis: 1.3–1.7, 2.0–2.4 e a main
   publicada. Capturar IndexedDB e metadados diretamente, além dos arquivos `.ebgeo` existentes.
2. Cobrir também settings 1.7 com atlas 2.4, marcador ausente/ilegível, origem vazia, versão
   inferior ao mínimo, slot legado já carimbado 3.0 e vários atlas locais. Para versões
   não suportadas, o aceite é recuperação explícita sem destruição, não migração fictícia.
3. Trocar o build na mesma origem e perfil. Testar main + integração nas duas ordens, aba
   em segundo plano, suspensão/retorno, fechamento durante a migração e edição nas duas versões.
4. Comparar inventários e hashes antes/depois; verificar segundo e terceiro boots, troca de
   mapas/atlas, exportação/importação, envio ao servidor, imagens baixadas e cópia de volta.
5. Testar volumes grandes e pouca cota. Medir espaço adicional, memória e tempo para definir
   mensagens de progresso e limites com dados, sem estimativas inventadas.
6. Executar os três testes de reprodução, a suíte de migração/namespace, os testes de navegador
   afetados, lint e build. Ao fechar as mudanças, executar frontend e backend completos;
   investigar qualquer timeout em vez de tratá-lo como aprovação da rodada.

Aceite: três bloqueadores corrigidos, nenhum skip nos cenários de liberação, nenhum vínculo
ou byte perdido nos inventários comparados. Ausência de acesso a um motor de navegador usado
na rede deve ficar registrada como validação pendente, não como aprovação implícita.

## Entrega 5 : Preparar a publicação e a reversão

Dependências: entrega 4. Verificação do servidor feita na rede interna pelo responsável pelo deploy.

1. Validar API de configuração, autenticação, imagens e WebSocket pelo proxy real antes da troca
   do frontend. Conferir origem, headers de cache, ausência de `Clear-Site-Data` e URLs de assets.
2. Preparar uma versão de recuperação compatível com o esquema e os namespaces novos. Ensaiar
   a reversão usando uma cópia já migrada; o comando de rollback de arquivos não restaura dados.
3. Fazer piloto com perfis de teste e cópias recuperáveis. Definir responsáveis por observar
   erros de migração, divergência do inventário e quota, e por interromper a expansão do piloto.
4. Publicar somente após os aceites técnicos e operacionais. Comunicar exportação preventiva
   aos usuários ativos, mantendo o caminho automático para os que só retornarem meses depois.
5. Manter a origem legada durante o período de recuperação. Planejar sua limpeza como mudança
   posterior, com tratamento de alterações tardias e impacto de espaço já medidos.

## Organização do trabalho

| Etapa | Resultado revisável | Dependência |
|---|---|---|
| 1 | Boot protegido, classificação e coordenação de clientes | Nenhuma |
| 2 | Plano persistido, destino isolado, imagens e retomada consistentes | 1 |
| 3 | Recuperação, divergências tardias e ponte com a main completas | 1 e 2 |
| 4 | Evidência em builds históricos, navegador e suítes | 1–3 |
| 5 | Piloto, checklist interno e reversão ensaiada | 4 |

Cada etapa deve produzir uma alteração revisável com seus testes. Etapas intermediárias não
são candidatas a produção. Não usar prazo como substituto dos critérios de aceite; a primeira
medição de acervo grande e de coexistência com main real deve orientar o tamanho final do trabalho.
