// Corre en document_start. Todo el CSS de la skin está bajo html:not(.skinupq-off),
// así que por defecto la skin está activa (sin parpadeo) y solo se apaga si el
// usuario lo desactivó desde el popup.
chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  document.documentElement.classList.toggle('skinupq-off', !enabled);
});
