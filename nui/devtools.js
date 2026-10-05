// Detects an attached Chrome DevTools frontend (the one `nui_devtools` opens) on this NUI frame.
// A `debugger` statement only pauses execution while a frontend is attached, so a slow probe
// means DevTools is open. If the page stays paused the probe never returns, which is why every
// tick also pings Lua: client/detection/nui_devtools.lua reports a stalled page instead.
(() => {
  let config = { intervalMs: 2000, debuggerThresholdMs: 100, progressEvery: 5 };
  let streak = 0;

  const post = (name, body) =>
    fetch(`https://${GetParentResourceName()}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});

  const probeDebugger = () => {
    const started = performance.now();
    // biome-ignore lint/suspicious/noDebugger: the pause is the detection signal
    debugger;
    return performance.now() - started > config.debuggerThresholdMs;
  };

  const tick = () => {
    // Closing DevTools resets the streak, so a brief or accidental open never reaches a report.
    streak = probeDebugger() ? streak + 1 : 0;
    post('nuiAlive', {});
    if (streak > 0 && streak % config.progressEvery === 0) {
      post('nuiDevtools', { method: 'debugger', checks: streak });
    }
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.action === 'simpleac:config' && data.config) {
      config = { ...config, ...data.config };
    }
  });

  setInterval(tick, config.intervalMs);
})();
