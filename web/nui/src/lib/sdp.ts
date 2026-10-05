const CODEC = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//;
const PARAMS = 'x-google-start-bitrate=6000;x-google-min-bitrate=3000;x-google-max-bitrate=8000';

/**
 * Tells the video encoder where to start. Without it every connection starts by assuming a slow link and an older
 * embedded browser answers by dropping the picture to a few hundred pixels before it ramps back up.
 */
export function withStartBitrate(sdp: string): string {
  if (sdp.includes('x-google-start-bitrate')) return sdp;
  const lines = sdp.split('\r\n');
  const codecs = new Set<string>();
  for (const line of lines) {
    const match = CODEC.exec(line);
    if (match?.[1]) codecs.add(match[1]);
  }
  const out: string[] = [];
  for (const line of lines) {
    const fmtp = /^a=fmtp:(\d+) /.exec(line);
    if (fmtp?.[1] && codecs.has(fmtp[1])) {
      out.push(`${line};${PARAMS}`);
      continue;
    }
    out.push(line);
    const map = CODEC.exec(line);
    if (map?.[1] && !lines.some((other) => other.startsWith(`a=fmtp:${map[1]} `))) {
      out.push(`a=fmtp:${map[1]} ${PARAMS}`);
    }
  }
  return out.join('\r\n');
}
