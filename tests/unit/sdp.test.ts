import { describe, expect, it } from 'vitest';
import { withStartBitrate } from '../../web/nui/src/lib/sdp';

const NL = '\r\n';
const sdp = [
  'v=0',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98',
  'a=rtpmap:96 VP8/90000',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rtpmap:98 H264/90000',
  'a=fmtp:98 profile-level-id=42e01f;packetization-mode=1',
  '',
].join(NL);

describe('withStartBitrate', () => {
  const result = withStartBitrate(sdp);

  it('adds the start bitrate to codecs that have no parameters yet', () => {
    expect(result).toContain(`a=rtpmap:96 VP8/90000${NL}a=fmtp:96 x-google-start-bitrate=6000`);
  });

  it('appends to the parameters a codec already has', () => {
    expect(result).toMatch(
      /a=fmtp:98 profile-level-id=42e01f;packetization-mode=1;x-google-start-bitrate=6000/,
    );
  });

  it('leaves retransmission streams alone', () => {
    expect(result).toContain(`a=fmtp:97 apt=96${NL}`);
    expect(result).not.toMatch(/a=fmtp:97 [^\r]*x-google/);
  });

  it('can be applied twice without changing the result', () => {
    expect(withStartBitrate(result)).toBe(result);
  });
});
