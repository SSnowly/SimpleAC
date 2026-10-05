// Hosts the staff panel (a separate React page) inside this NUI page and relays messages in both directions:
// the game talks to this window, and the panel talks to the game through it.
(() => {
  const frame = document.getElementById('simpleac-panel');
  if (!frame) return;
  const callback = (name, body) =>
    fetch(`https://${GetParentResourceName()}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => undefined);
  let opened = false;

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (event.source === frame.contentWindow) {
      if (data.type === 'simpleac:rpc') {
        void callback('panelRequest', { id: data.id, op: data.op, payload: data.payload });
      } else if (data.type === 'simpleac:closed') {
        opened = false;
        frame.style.display = 'none';
        void callback('panelClosed', {});
      }
      return;
    }

    if (typeof data.action !== 'string' || !data.action.startsWith('simpleac:panel:')) return;
    if (data.action === 'simpleac:panel:open') {
      opened = true;
      frame.style.display = 'block';
      frame.focus();
    }
    if (frame.contentWindow) frame.contentWindow.postMessage(data, '*');
  });

  // The game gives focus to this page, not to the panel inside it, so Escape is handed on.
  window.addEventListener('keydown', (event) => {
    if (opened && event.key === 'Escape' && frame.contentWindow) {
      frame.contentWindow.postMessage({ action: 'simpleac:panel:escape' }, '*');
    }
  });
})();
