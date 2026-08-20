// Path: tests/fixtures/censo-superficies/exemplo-sem-regime-de-cache.controller.js
//
// FIXTURE DO CONTROLE NEGATIVO da varredura 4 (regime de cache), metade SEM cabeçalho.
//
// Um handler de resposta escopada que não emite `Cache-Control` nenhum — o estado que
// a varredura de PRESENÇA anterior não conseguia enxergar, porque ela procurava o
// cabeçalho e um cabeçalho ausente não casa com nada. Aqui ele existe para ser MEDIDO:
// o censo declara um regime para esta rota, o código não o cumpre, e a varredura
// precisa acusar.
//
// Ele mora num arquivo SEPARADO da metade com cabeçalho de propósito: a checagem de
// buraco olha também o ARQUIVO do handler, então juntar os dois faria a metade sem
// cabeçalho herdar o cabeçalho da irmã e o controle deixaria de discriminar.

export const semCabecalho = async (req, res) => {
  res.json({ data: [] });
};
