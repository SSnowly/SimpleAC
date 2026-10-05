// Screenshot capture for evidence. Renders the game view into a WebGL render target (the same technique as
// screenshot-basic, using the CitizenFX build of three.js), encodes it and uploads it straight to the resource's
// HTTP endpoint with a single-use token. The renderer only exists while captures are being taken.
import {
  CfxTexture,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneBufferGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from '@citizenfx/three';

const MEDIA_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const WARMUP_FRAMES = 2;

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = vec2(uv.x, 1.0 - uv.y);
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

let scene = null;
const queue = [];
let working = false;

const report = (id, ok, error) => {
  fetch(`https://${GetParentResourceName()}/captureResult`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ok, error }),
  }).catch(() => {});
};

const createScene = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const camera = new OrthographicCamera(
    width / -2,
    width / 2,
    height / 2,
    height / -2,
    -10000,
    10000,
  );
  camera.position.z = 100;

  const gameTexture = new CfxTexture();
  gameTexture.needsUpdate = true;
  const material = new ShaderMaterial({
    uniforms: { tDiffuse: { value: gameTexture } },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
  const quad = new Mesh(new PlaneBufferGeometry(width, height), material);
  quad.position.z = -100;
  const root = new Scene();
  root.add(quad);

  const target = new WebGLRenderTarget(width, height, {
    minFilter: LinearFilter,
    magFilter: NearestFilter,
    format: RGBAFormat,
    type: UnsignedByteType,
  });
  const renderer = new WebGLRenderer();
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  renderer.autoClear = false;
  renderer.domElement.style.display = 'none';
  document.body.appendChild(renderer.domElement);

  return { renderer, camera, root, target, width, height };
};

const disposeScene = () => {
  if (!scene) return;
  scene.target.dispose();
  scene.renderer.dispose();
  scene.renderer.domElement.remove();
  scene = null;
};

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

const renderFrame = () => {
  scene.renderer.clear();
  scene.renderer.render(scene.root, scene.camera, scene.target, true);
};

const readPixels = async () => {
  if (scene && (scene.width !== window.innerWidth || scene.height !== window.innerHeight))
    disposeScene();
  scene ??= createScene();

  // The game texture needs a couple of frames after the renderer appears before it holds the current frame.
  for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
    await nextFrame();
    renderFrame();
  }
  const { width, height } = scene;
  const pixels = new Uint8Array(width * height * 4);
  scene.renderer.readRenderTargetPixels(scene.target, 0, 0, width, height, pixels);
  // JPEG has no alpha: make sure a transparent texel can never turn into black.
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
  return { pixels, width, height };
};

const encode = (source, request) =>
  new Promise((resolve, reject) => {
    const type = MEDIA_TYPES[request.encoding];
    const scale = Math.min(1, request.maxWidth / source.width);
    const outputWidth = Math.max(1, Math.round(source.width * scale));
    const outputHeight = Math.max(1, Math.round(source.height * scale));

    const full = document.createElement('canvas');
    full.width = source.width;
    full.height = source.height;
    full
      .getContext('2d')
      .putImageData(
        new ImageData(new Uint8ClampedArray(source.pixels.buffer), source.width, source.height),
        0,
        0,
      );

    let output = full;
    if (scale < 1) {
      output = document.createElement('canvas');
      output.width = outputWidth;
      output.height = outputHeight;
      output.getContext('2d').drawImage(full, 0, 0, outputWidth, outputHeight);
    }
    output.toBlob(
      (blob) => (blob ? resolve({ blob, type }) : reject(new Error('encode'))),
      type,
      request.quality,
    );
  });

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('read'));
    reader.readAsDataURL(blob);
  });

const takeScreenshot = async (request) => {
  try {
    const source = await readPixels();
    const { blob, type } = await encode(source, request);

    if (request.url) {
      // The server is reachable over HTTPS: upload directly with the single-use token in the URL.
      const response = await fetch(request.url, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': type },
        body: blob,
      });
      report(request.id, response.ok, response.ok ? undefined : `upload_${response.status}`);
      return;
    }

    // An HTTPS page cannot call a plain-HTTP game server, so hand the image to the client script, which sends it
    // to the server as a latent event.
    await fetch(`https://${GetParentResourceName()}/captureData`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: request.id, mediaType: type, data: await toBase64(blob) }),
    });
  } catch (error) {
    report(request.id, false, error instanceof Error ? error.message.slice(0, 48) : 'capture');
  }
};

const drain = async () => {
  if (working) return;
  working = true;
  while (queue.length > 0) await takeScreenshot(queue.shift());
  working = false;
  // Free the renderer between captures; it is cheap to rebuild and costs GPU memory while idle.
  disposeScene();
};

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.action !== 'simpleac:capture' || !data.request) return;
  const { id, url, encoding, quality, maxWidth } = data.request;
  if (typeof id !== 'string' || !MEDIA_TYPES[encoding]) return;
  queue.push({
    id,
    url: typeof url === 'string' ? url : null,
    encoding,
    quality: Number(quality) || 0.8,
    maxWidth: Number(maxWidth) || 1920,
  });
  drain();
});
