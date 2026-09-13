# Presença administrativa: quem está com o produto aberto agora

O número que o painel do administrador publica conta NAVEGADORES vistos numa janela de 90 segundos, não pessoas, e a "duração" que aparece ao lado dele é o intervalo observado desde a abertura do segmento, nunca tempo comprovado de trabalho.

Não confundir com [[presenca-colaborativa]], que é o roster efêmero de quem está dentro de um atlas, propagado pelo WebSocket. Esta é a contagem administrativa, que atravessa as quatro páginas e existe mesmo para quem nunca entrou numa conta. O cliente é `frontend/src/js/session/presenca.js`, o servidor é `backend/src/modules/uso/uso.presenca.js`.

## Os três períodos, e por que eles são três

- **Pulso do navegador: 30 s.** Cada aba visível bate; aba oculta não bate, e um pulso perdido simplesmente expira no servidor.
- **Painel: 15 s.** A tela pede mais rápido do que o navegador informa, de propósito: com os dois no mesmo período, metade das atualizações mostraria o mesmo estado.
- **Janela do servidor: 90 s** (`PRESENCA_JANELA_SEGUNDOS`). Ela é três pulsos, e não um, porque uma aba que perde uma batida por rede ruim não pode sumir da tela; e não é dez, porque a pergunta é "agora".

A limpeza é separada da janela: linhas paradas há mais de cinco minutos são apagadas, em lotes, na própria escrita do pulso. Sem isso a tabela cresceria com todo navegador que passou.

## O que este número NÃO é, e a ressalva vai na tela

- **Anônimo é NAVEGADOR, nunca pessoa.** A deduplicação entre abas é por um identificador aleatório guardado localmente (`ebgeo:telemetria:navegador`), então duas abas contam uma vez e dois computadores da mesma pessoa contam duas. Sem armazenamento disponível a dedup degrada para POR PÁGINA, e ali a mesma pessoa em três abas conta três.
- **Perda de coleta não é ausência de gente.** Falha de telemetria e banco fora aparecem como indisponibilidade da FONTE, e nunca como zero usuário; a idade desconhecida viaja como nulo e não como zero, pela mesma razão.
- **"Duração" é o intervalo observado desde a abertura do segmento**, delimitado pela carga do documento e pela mudança de identidade. Não é tempo comprovado de trabalho e **não se usa como produtividade individual.** A restrição é de produto, não de precisão: o número existe para dimensionar uso, e um sistema em que a lotação e o posto de cada conta estão a um JOIN de distância não pode publicar uma métrica que se leia como desempenho de pessoa.
- **Atividade anônima que chega depois do login continua anônima**, e lote identificado nunca é reatribuído no reenvio. Ver [[observabilidade]], seção do uso de produto.

## Os limitadores são independentes, e o default é generoso de propósito

Uso e presença têm limitadores separados, com 600 requisições por minuto por endereço no default (`backend/src/modules/uso/uso.rate-limit.js`), ajustáveis por variável de ambiente. O número é alto porque a rede interna sai por NAT compartilhado: um teto apertado por endereço apagaria a telemetria de uma OM inteira e o sintoma seria "ninguém usa o produto", que é indistinguível de sucesso do limitador. Validação e identidade verificada continuam sendo responsabilidades separadas do limitador.

## Ver também

[[observabilidade]] para o resto do rastro (log, defeito, uso de produto e a sonda externa); [[gestao-usuarios]] para a última autenticação, que é OUTRO campo e não se confunde com a última atividade; [[presenca-colaborativa]] para o roster dentro de um atlas.
