// Path: js/ui/loading-screen.js

/**
 * @module ui/loading-screen
 * @description Loading screen management.
 * Extracted from index.js to break the circular dependency with map_sig.js.
 */

/**
 * Hides the loading screen with fade-out animation.
 * Shows elements marked with 'loading-hidden' class.
 */
export function hideLoadingScreen() {
    const loadingBg = document.querySelector('.loading-background');
    if (loadingBg) {
        // O SPLASH PARA DE ENGOLIR CLIQUE NO INSTANTE EM QUE COMECA A SUMIR.
        //
        // Ele e `position: fixed`, `100vw` por `100vh`, `z-index: 9999` (a folha esta em
        // `index.html`), e nao declarava `pointer-events`. Entao, durante o meio segundo INTEIRO
        // da transicao, a pessoa via o mapa aparecendo e nao conseguia tocar nele: o clique
        // morria no retangulo transparente por cima. Sem erro, sem aviso, so um clique que nao
        // fez nada, em TODA carga de pagina, e cada troca de atlas e uma carga de pagina.
        //
        // MEDIDO: a transicao custa 531 a 611 ms, mais que o DOBRO de toda a janela de trabalho
        // entre o `load` do MapLibre e o splash comecar a sumir (200 a 250 ms). Ou seja, o maior
        // pedaco do tempo em que a tela ficava inerte nao era calculo, era esta cortina.
        //
        // A linha de `pointerEvents` nao encurta a animacao nem muda o que se ve. Ela separa o
        // que a cortina ainda FAZ (desaparecer suavemente) do que ela nao deveria mais fazer
        // (bloquear).
        //
        // A DURACAO, agora, e 200 ms, e a medida acima e quem a escolhe. A cortina existe para
        // cobrir a janela de trabalho do boot, e essa janela mede 200 a 250 ms. Meio segundo de
        // cortina cobria essa janela DUAS VEZES: o app ficava pronto e a pessoa continuava
        // olhando para o veu por mais 300 ms de nada. 200 ms cobrem a janela e param nela.
        //
        // OS DOIS NUMEROS TEM DE CONTINUAR IGUAIS. A transicao diz quanto tempo a cortina leva
        // para sumir, e o `setTimeout` diz quando ela sai do DOM. Remover antes do fim faz a
        // cortina PISCAR para fora ainda visivel. Remover depois deixa um retangulo invisivel
        // (e ja inerte, pelo `pointerEvents`) parado na arvore sem motivo.
        //
        // O QUE NAO FOI FEITO, de proposito: derrubar a cortina no evento `load` do MapLibre.
        // Naquele instante o ESTILO carregou, mas os TILES podem nao ter chegado. Isso trocaria
        // cortina por mapa cinza vazio, que e pior: a cortina se anuncia como espera, o mapa
        // vazio se le como defeito.
        const MS_DA_CORTINA = 200;
        loadingBg.style.pointerEvents = 'none';
        loadingBg.style.transition = `opacity ${MS_DA_CORTINA}ms`;
        loadingBg.style.opacity = '0';
        setTimeout(() => loadingBg.remove(), MS_DA_CORTINA);
    }

    document.querySelectorAll('.loading-hidden').forEach(function (el) {
        el.classList.add('loaded');
    });
}
