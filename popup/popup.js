const toggle = document.getElementById('enabled');

chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  toggle.checked = enabled;
});

toggle.addEventListener('change', async () => {
  await chrome.storage.sync.set({ enabled: toggle.checked });
  // El login reorganiza el DOM, así que lo más limpio es recargar la pestaña activa.
  chrome.tabs.reload();
});
