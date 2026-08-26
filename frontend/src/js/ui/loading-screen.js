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
        // A linha nao encurta a animacao nem muda o que se ve. Ela separa o que a cortina ainda
        // FAZ (desaparecer suavemente) do que ela nao deveria mais fazer (bloquear). Encurtar os
        // 0,5 s e decisao de produto, e continua aberta.
        loadingBg.style.pointerEvents = 'none';
        loadingBg.style.transition = 'opacity 0.5s';
        loadingBg.style.opacity = '0';
        setTimeout(() => loadingBg.remove(), 500);
    }

    document.querySelectorAll('.loading-hidden').forEach(function (el) {
        el.classList.add('loaded');
    });
}
