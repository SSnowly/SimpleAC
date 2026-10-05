// Live watch, sending side. When staff watch this player the game view is drawn into a canvas, turned into a video
// stream and sent over WebRTC. The server only relays the handshake; the video itself goes straight to the staff
// member's panel (or through a TURN relay when the server is set to relay-only).
import {
  CfxTexture,
  Mesh,
  OrthographicCamera,
  PlaneBufferGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from '@citizenfx/three';

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
  }
`;

const GATHER_TIMEOUT_MS = 4000;
const START_PARAMS =
  'x-google-start-bitrate=6000;x-google-min-bitrate=3000;x-google-max-bitrate=8000';
const CODEC = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//;

// Tells the video encoder where to start, so the picture is sharp from the first second instead of ramping up
// from a few hundred pixels while the connection measures itself.
const withStartBitrate = (sdp) => {
  if (sdp.includes('x-google-start-bitrate')) return sdp;
  const lines = sdp.split(String.fromCharCode(13, 10));
  const codecs = new Set();
  for (const line of lines) {
    const match = CODEC.exec(line);
    if (match) codecs.add(match[1]);
  }
  const out = [];
  for (const line of lines) {
    const fmtp = /^a=fmtp:(\d+) /.exec(line);
    if (fmtp && codecs.has(fmtp[1])) {
      out.push(`${line};${START_PARAMS}`);
      continue;
    }
    out.push(line);
    const map = CODEC.exec(line);
    if (map && !lines.some((other) => other.startsWith(`a=fmtp:${map[1]} `))) {
      out.push(`a=fmtp:${map[1]} ${START_PARAMS}`);
    }
  }
  return out.join(String.fromCharCode(13, 10));
};

let session = null;

const post = (name, body) =>
  fetch(`https://${GetParentResourceName()}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});

/** Resolves when ICE candidates are collected (or after a short wait), so the offer carries them all. */
const gathered = (pc) =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });

const stop = () => {
  if (!session) return;
  const current = session;
  session = null;
  cancelAnimationFrame(current.frame);
  for (const track of current.stream.getTracks()) track.stop();
  current.pc.close();
  current.renderer.dispose();
  current.renderer.domElement.remove();
};

const begin = async (params) => {
  stop();
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  const width = Math.max(320, Math.min(params.width, windowWidth));
  // Video encoders want even dimensions.
  const height = Math.round((width * windowHeight) / windowWidth / 2) * 2;

  const camera = new OrthographicCamera(
    windowWidth / -2,
    windowWidth / 2,
    windowHeight / 2,
    windowHeight / -2,
    -10000,
    10000,
  );
  camera.position.z = 100;
  const texture = new CfxTexture();
  texture.needsUpdate = true;
  const quad = new Mesh(
    new PlaneBufferGeometry(windowWidth, windowHeight),
    new ShaderMaterial({
      uniforms: { tDiffuse: { value: texture } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    }),
  );
  quad.position.z = -100;
  const root = new Scene();
  root.add(quad);

  const renderer = new WebGLRenderer();
  renderer.setPixelRatio(1);
  renderer.setSize(width, height);
  // Kept on the page but out of sight: a display:none canvas may stop producing frames.
  renderer.domElement.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none;';
  document.body.appendChild(renderer.domElement);

  const stream = renderer.domElement.captureStream(params.fps);
  const pc = new RTCPeerConnection({
    iceServers: params.iceServers,
    iceTransportPolicy: params.relayOnly ? 'relay' : 'all',
  });
  const current = { id: params.id, pc, stream, renderer, frame: 0 };
  session = current;

  const draw = () => {
    renderer.render(root, camera);
    current.frame = requestAnimationFrame(draw);
  };
  draw();

  const track = stream.getVideoTracks()[0];
  // Older embedded browsers read this as "keep the resolution, drop frames if you must".
  track.contentHint = 'detail';
  const sender = pc.addTrack(track, stream);
  try {
    const parameters = sender.getParameters();
    parameters.encodings = [{ maxBitrate: params.bitrateKbps * 1000, maxFramerate: params.fps }];
    // Under pressure, drop frames before dropping resolution: the picture should stay sharp.
    parameters.degradationPreference = 'maintain-resolution';
    await sender.setParameters(parameters);
  } catch {
    // The bitrate cap is a courtesy; the stream works without it.
  }
  pc.addEventListener('connectionstatechange', () => {
    if (session === current && (pc.connectionState === 'failed' || pc.connectionState === 'closed'))
      stop();
  });

  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    if (session !== current) return;
    await post('watchSignal', { id: params.id, kind: 'offer', sdp: pc.localDescription.sdp });
  } catch {
    stop();
  }
};

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.action === 'simpleac:watch:begin') {
    void begin(data.params);
  } else if (data.action === 'simpleac:watch:answer') {
    if (session && session.id === data.id) {
      session.pc
        .setRemoteDescription({ type: 'answer', sdp: withStartBitrate(data.sdp) })
        .catch(stop);
    }
  } else if (data.action === 'simpleac:watch:end') {
    if (!session || session.id === data.id) stop();
  }
});
