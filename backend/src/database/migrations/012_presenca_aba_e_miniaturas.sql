-- Primeira migração incremental depois das bases consolidadas (decisão do dono, 2026-09-22).
--
-- POR QUE UM ARQUIVO NOVO E NÃO UMA EDIÇÃO DE BASE. O stack de teste publicado no servidor
-- (`/ebgeo_novo/`) já aplicou as onze bases e guarda o trabalho dos testadores. O migrador
-- recusa arquivo já aplicado cujo conteúdo mudou, então editar a `011` ou a `005` obrigaria a
-- recriar aquele banco. A partir daqui as bases ficam congeladas e o schema anda por arquivo
-- numerado, que é o regime que o README desta pasta previa para depois da primeira implantação.
--
-- Tudo aqui é idempotente: reaplicar não muda nada.

-- 1. PRESENÇA: o documento que pulsou por último.
-- `aba_id` identifica o DOCUMENTO (um id novo por carga de página). A saída explícita enviada
-- no `pagehide` apaga a linha só quando vem desse mesmo documento, de modo que a saída atrasada
-- da página que navegou, ou de uma de duas abas do mesmo navegador, não apaga um navegador que
-- continua aberto.
ALTER TABLE uso_presenca ADD COLUMN IF NOT EXISTS aba_id UUID;

-- 2. MINIATURAS DOS MAPAS BASE SEMEADOS.
-- A base do catálogo semeou as três miniaturas como `./images/layers/*-thumb.png`, mas os
-- arquivos publicados sempre foram `.webp` (a constante do cliente em
-- `base-layer-selector.constants.js` já dizia isso), e o seletor pedia um 404 por mapa base.
-- Só se corrige a linha que ainda traz o valor semeado: uma miniatura trocada pelo painel de
-- administração é escolha de alguém e fica como está.
UPDATE basemaps
   SET config = jsonb_set(config, '{image}',
                          to_jsonb(regexp_replace(config->>'image', '\.png$', '.webp')))
 WHERE id IN ('carta-topografica', 'carta-ortoimagem', 'bdgex')
   AND config->>'image' ~ '^\./images/layers/[a-z-]+-thumb\.png$';
