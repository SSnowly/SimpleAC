// Collects device attributes for ban-evasion matching. Raw values leave this page once, are normalised and
// hashed with a per-server salt on the server, and are never stored in the clear.
(() => {
  const STORAGE_ID_KEY = 'simpleac.sid';
  const TOKEN_KEY = 'simpleac.device';

  const readStorage = (key) => {
    try {
      return window.localStorage.getItem(key) || '';
    } catch {
      return '';
    }
  };

  const writeStorage = (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  };

  const toHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  const sha256 = async (text) => {
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return toHex(new Uint8Array(digest));
    } catch {
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
      }
      return (hash >>> 0).toString(16);
    }
  };

  const storageId = () => {
    let id = readStorage(STORAGE_ID_KEY);
    if (!id) {
      id = toHex(crypto.getRandomValues(new Uint8Array(16)));
      writeStorage(STORAGE_ID_KEY, id);
    }
    return id;
  };

  const canvasSignature = async () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 60;
      const context = canvas.getContext('2d');
      context.textBaseline = 'alphabetic';
      context.fillStyle = '#f60';
      context.fillRect(100, 1, 62, 20);
      context.fillStyle = '#069';
      context.font = '14px Arial';
      context.fillText('SimpleAC fp 1.0 \u{1F512}', 2, 15);
      context.fillStyle = 'rgba(102, 204, 0, 0.7)';
      context.font = '18px Times New Roman';
      context.fillText('SimpleAC fp 1.0 \u{1F512}', 4, 45);
      return await sha256(canvas.toDataURL());
    } catch {
      return '';
    }
  };

  const webgl = async () => {
    const result = { webglVendor: '', webglRenderer: '', webglSignature: '' };
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return result;

      const info = gl.getExtension('WEBGL_debug_renderer_info');
      result.webglVendor = String(gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
      result.webglRenderer = String(
        gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      );

      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(
        program,
        compile(
          gl.VERTEX_SHADER,
          'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}',
        ),
      );
      gl.attachShader(
        program,
        compile(
          gl.FRAGMENT_SHADER,
          'precision highp float;varying vec2 v;void main(){gl_FragColor=vec4(sin(v.x*12.9898)*.5+.5,cos(v.y*78.233)*.5+.5,sin((v.x+v.y)*43758.5453)*.5+.5,1.);}',
        ),
      );
      gl.linkProgram(program);
      // biome-ignore lint/correctness/useHookAtTopLevel: WebGL useProgram, not a React hook
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const location = gl.getAttribLocation(program, 'p');
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const pixels = new Uint8Array(64 * 64 * 4);
      gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      result.webglSignature = await sha256(toHex(pixels));
    } catch {}
    return result;
  };

  const audioSignature = async () => {
    try {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline) return '';
      const context = new Offline(1, 5000, 44100);
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 10000;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;
      oscillator.connect(compressor);
      compressor.connect(context.destination);
      oscillator.start(0);

      const buffer = await Promise.race([
        context.startRendering(),
        new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (!buffer) return '';
      const samples = buffer.getChannelData(0).slice(4500);
      let sum = 0;
      for (let index = 0; index < samples.length; index += 1) sum += Math.abs(samples[index]);
      return await sha256(sum.toFixed(10));
    } catch {
      return '';
    }
  };

  const collect = async () => {
    const [canvas, gl, audio] = await Promise.all([canvasSignature(), webgl(), audioSignature()]);
    return {
      userAgent: navigator.userAgent,
      platform: navigator.userAgentData?.platform || navigator.platform || '',
      locale: navigator.language || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      colorDepth: window.screen.colorDepth,
      pixelRatio: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      canvasSignature: canvas,
      audioSignature: audio,
      storageId: storageId(),
      ...gl,
    };
  };

  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data) return;

    if (data.action === 'simpleac:fingerprint:collect') {
      const attributes = await collect();
      fetch(`https://${GetParentResourceName()}/fingerprint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes, storageToken: readStorage(TOKEN_KEY) }),
      }).catch(() => {});
    } else if (data.action === 'simpleac:fingerprint:store' && typeof data.token === 'string') {
      writeStorage(TOKEN_KEY, data.token);
    }
  });
})();
