# Presença administrativa: quem está com o produto aberto agora

O número que o painel do administrador publica conta NAVEGADORES vistos numa janela de 90 segundos, não pessoas, e a "duração" que aparece ao lado dele é o intervalo observado desde a abertura do segmento, nunca tempo comprovado de trabalho.

Não confundir com [[presenca-colaborativa]], que é o roster efêmero de quem está dentro de um atlas, propagado pelo WebSocket. Esta é a contagem administrativa, que atravessa as quatro páginas e existe mesmo para quem nunca entrou numa conta. O cliente é `frontend/src/js/session/presenca.js`, o servidor é `backend/src/modules/uso/uso.presenca.js`.

## Os três períodos, e por que eles são três

- **Pulso do navegador: 30 s.** Toda aba aberta bate, a oculta inclusive (desde 2026-09-22, ver abaixo), e um pulso perdido simplesmente expira no servidor.
- **Painel: 15 s.** A tela pede mais rápido do que o navegador informa, de propósito: com os dois no mesmo período, metade das atualizações mostraria o mesmo estado.
- **Janela do servidor: 90 s** (`PRESENCA_JANELA_SEGUNDOS`). Ela é três pulsos, e não um, porque uma aba que perde uma batida por rede ruim não pode sumir da tela; e não é dez, porque a pergunta é "agora".

A limpeza é separada da janela: linhas paradas há mais de cinco minutos são apagadas, em lotes, na própria escrita do pulso. Sem isso a tabela cresceria com todo navegador que passou.

## A saída é explícita, e a janela virou rede de segurança (2026-09-22)

Relato do dono: "ainda diz que tem usuário presente mesmo que depois de sair". Até esta data a única forma de um navegador deixar de contar era a janela passar, então quem fechava a aba continuava logado no painel por um minuto e meio, mais os 15 s do ciclo da tela. O pulso ganhou uma SAÍDA: no `pagehide` a página manda `saindo: true` com `keepalive` (`frontend/src/js/session/presenca.js`), e o servidor apaga a linha (`registrarPresenca`, `backend/src/modules/uso/uso.presenca.js`). A janela continua valendo para o que não avisa: a aba que trava, o notebook que suspende, a rede que cai.

**A saída só apaga se o último pulso foi do MESMO DOCUMENTO**, e é a coluna `aba_id` que guarda qual foi. O `abaId` é novo a cada carga de página, não o da aba do navegador, e a diferença é o ponto: sem a condição, duas situações normais apagariam quem continua presente. A navegação do mapa para `atlas.html` é uma página nova que pode pulsar antes de a saída da velha chegar; e duas abas do mesmo navegador pulsam sob o mesmo `navegadorId`, então fechar uma apagaria a outra. As abas irmãs também são avisadas por um BroadcastChannel e pulsam na hora, de modo que a sobrevivente recria a linha um instante depois mesmo no caso em que a saída venceu.

**A aba OCULTA passou a pulsar**, e a regra anterior ("aba oculta não bate") saiu. Ela fazia uma aba deixada em segundo plano sumir do painel em 90 s com o produto aberto nela, o contrário do que a lista de colaboração faz desde 2026-08-28 ([[canal-collab-websocket]] §"Vivacidade"). O navegador estrangula o temporizador da página oculta (medido no Chrome: um disparo por minuto depois de uns cinco minutos), e um por minuto ainda cabe na janela de 90 s. O que continua de fora, agora por uma razão escrita, é pulsar ao ENTRAR em segundo plano: fechar a aba dispara `visibilitychange` logo antes do `pagehide`, e aquele pulso chegaria depois da saída e manteria o navegador contado a janela inteira. Voltar do cache de navegação (`pageshow` com `persisted`) pulsa de novo.

O logout já trocava a identidade na hora (o `onSessionChanged` de `frontend/src/js/session/uso-telemetria.js` pulsa sem credencial), e continua igual. Guardas: `frontend/tests/unit/presenca-saida-explicita.test.js` e os três casos novos de `backend/tests/integration/monitoramento-presenca.test.js`.

## O que este número NÃO é, e a ressalva vai na tela

- **Anônimo é NAVEGADOR, nunca pessoa.** A deduplicação entre abas é por um identificador aleatório guardado localmente (`ebgeo:telemetria:navegador`), então duas abas contam uma vez e dois computadores da mesma pessoa contam duas. Sem armazenamento disponível a dedup degrada para POR PÁGINA, e ali a mesma pessoa em três abas conta três.
- **Perda de coleta não é ausência de gente.** Falha de telemetria e banco fora aparecem como indisponibilidade da FONTE, e nunca como zero usuário; a idade desconhecida viaja como nulo e não como zero, pela mesma razão.
- **"Duração" é o intervalo observado desde a abertura do segmento**, delimitado pela carga do documento e pela mudança de identidade. Não é tempo comprovado de trabalho e **não se usa como produtividade individual.** A restrição é de produto, não de precisão: o número existe para dimensionar uso, e um sistema em que a lotação e o posto de cada conta estão a um JOIN de distância não pode publicar uma métrica que se leia como desempenho de pessoa.
- **Atividade anônima que chega depois do login continua anônima**, e lote identificado nunca é reatribuído no reenvio. Ver [[observabilidade]], seção do uso de produto.

## Os limitadores são independentes, e o default é generoso de propósito

Uso e presença têm limitadores separados, com 600 requisições por minuto por endereço no default (`backend/src/modules/uso/uso.rate-limit.js`), ajustáveis por variável de ambiente. O número é alto porque a rede interna sai por NAT compartilhado: um teto apertado por endereço apagaria a telemetria de uma OM inteira e o sintoma seria "ninguém usa o produto", que é indistinguível de sucesso do limitador. Validação e identidade verificada continuam sendo responsabilidades separadas do limitador.

## Ver também

[[observabilidade]] para o resto do rastro (log, defeito, uso de produto e a sonda externa); [[gestao-usuarios]] para a última autenticação, que é OUTRO campo e não se confunde com a última atividade; [[presenca-colaborativa]] para o roster dentro de um atlas.
