import { parentPort } from 'node:worker_threads';
import { prepareForOcr } from './prepare.js';

// Runs off FXServer's main thread: decoding and resizing a 1080p screenshot takes tens of milliseconds of pure CPU.
parentPort?.on('message', (message: { id: number; bytes: Uint8Array; maxWidth: number }) => {
  const result = prepareForOcr(Buffer.from(message.bytes), message.maxWidth);
  const out = new Uint8Array(result.bytes);
  parentPort?.postMessage({ id: message.id, bytes: out, scale: result.scale }, [out.buffer]);
});
