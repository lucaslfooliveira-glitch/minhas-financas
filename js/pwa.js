/* Instalação e atualização do shell. O Service Worker não armazena registros financeiros. */
export function setupPwa({ onStatus = () => {}, onInstallAvailable = () => {} } = {}) {
  let promptEvent = null;
  let registration = null;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  globalThis.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    promptEvent = event;
    onInstallAvailable(true);
  });
  globalThis.addEventListener('appinstalled', () => {
    promptEvent = null;
    onInstallAvailable(false);
    onStatus({ type: 'installed', message: 'Aplicativo instalado. Seus dados continuam no Google Drive.' });
  });
  const register = async () => {
    if (!('serviceWorker' in navigator) || !globalThis.isSecureContext || location.protocol === 'file:') {
      onStatus({ type: 'unsupported', message: 'Para instalar, abra o aplicativo por HTTPS ou em localhost.' });
      return;
    }
    try {
      registration = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname, updateViaCache: 'none' });
      const notifyWaiting = () => {
        if (registration.waiting && navigator.serviceWorker.controller) onStatus({ type: 'update', message: 'Uma atualização está pronta. Depois de concluir seus lançamentos, feche todas as janelas do aplicativo e abra novamente.' });
      };
      notifyWaiting();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed') notifyWaiting(); });
      });
      onStatus({ type: 'ready', message: 'Interface disponível para instalação. Consultas e lançamentos exigem internet.' });
    } catch (_) {
      onStatus({ type: 'error', message: 'A instalação offline não ficou disponível. Você pode continuar usando o aplicativo com internet.' });
    }
  };
  if (document.readyState === 'complete') void register();
  else globalThis.addEventListener('load', register, { once: true });
  if (ios && !standalone) onInstallAvailable(true);
  return {
    async install() {
      if (promptEvent) {
        const event = promptEvent;
        promptEvent = null;
        await event.prompt();
        const outcome = await event.userChoice;
        if (outcome?.outcome !== 'accepted') onInstallAvailable(false);
        return outcome;
      }
      const message = ios ? 'No Safari, toque em Compartilhar → Adicionar à Tela de Início.' : standalone ? 'O aplicativo já está aberto no modo instalado.' : 'No menu do navegador, procure Instalar aplicativo ou Adicionar à tela inicial. A opção depende do navegador e de uma conexão HTTPS.';
      onStatus({ type: 'instructions', message });
      return { outcome: 'instructions', message };
    },
    async update() { if (registration) await registration.update(); }
  };
}
