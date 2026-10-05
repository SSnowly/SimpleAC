import { Camera, Eye } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PanelOutput } from '../../../../shared/contracts/panel';
import { Empty, useToast } from '../components/ui';
import { errorText } from '../lib/format';
import { hasString, t } from '../lib/i18n';
import { rpc } from '../lib/rpc';
import { withStartBitrate } from '../lib/sdp';
import { useSession } from '../lib/session';

type Phase = 'idle' | 'starting' | 'connecting' | 'live' | 'ended' | 'failed';

interface Run {
  id: string;
  pc: RTCPeerConnection;
  off: () => void;
}

type WatchEvent =
  | { type: 'offer'; id: string; sdp: string }
  | { type: 'ended'; id: string; reason: string };

const GATHER_TIMEOUT_MS = 4000;

/** Why a live view ended, in words. */
const endedText = (reason: string): string =>
  hasString(`live.ended_${reason}`) ? t(`live.ended_${reason}`) : t('live.ended_default');

/** Resolves when ICE candidates are collected (or after a short wait), so the answer carries them all. */
const gathered = (pc: RTCPeerConnection): Promise<void> =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const done = () => {
      window.clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = window.setTimeout(done, GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });

/**
 * Live video of a player's game, sent over WebRTC. This panel is the receiving end: the server hands over the
 * player's offer, this answers it, and the video then flows to the `<video>` below.
 */
export function LiveWatch({ playerId, online }: { playerId: string; online: boolean }) {
  const { can } = useSession();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [relayed, setRelayed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const run = useRef<Run | null>(null);

  const cleanup = useCallback((tellServer: boolean) => {
    const current = run.current;
    run.current = null;
    if (!current) return;
    current.off();
    current.pc.close();
    if (video.current) video.current.srcObject = null;
    if (tellServer) void rpc('watch.stop', { id: current.id as never }).catch(() => undefined);
  }, []);

  // Leaving the tab, the player or the panel ends the view, so a stream never outlives what is looking at it.
  useEffect(() => () => cleanup(true), [cleanup]);

  const start = () => {
    cleanup(true);
    setPhase('starting');
    setMessage('');
    setRelayed(false);
    let pendingOffer: { id: string; sdp: string } | null = null;
    let handled = false;
    let started: PanelOutput<'watch.start'> | null = null;
    let pc: RTCPeerConnection | null = null;

    const answerOffer = async (sdp: string) => {
      if (!pc || !started || handled) return;
      handled = true;
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp });
        const created = await pc.createAnswer();
        await pc.setLocalDescription({ type: 'answer', sdp: withStartBitrate(created.sdp ?? '') });
        await gathered(pc);
        const answer = pc.localDescription?.sdp;
        if (!answer) throw new Error('No answer was created.');
        await rpc('watch.answer', { id: started.id as never, sdp: answer });
        setPhase((current) => (current === 'live' ? current : 'connecting'));
      } catch (failure: unknown) {
        cleanup(true);
        setPhase('failed');
        setMessage(errorText(failure));
      }
    };

    const onMessage = (event: MessageEvent<{ action?: string; event?: WatchEvent } | null>) => {
      if (event.data?.action !== 'simpleac:panel:watch' || !event.data.event) return;
      const signal = event.data.event;
      if (signal.type === 'offer') {
        if (started && signal.id === started.id) void answerOffer(signal.sdp);
        else pendingOffer = { id: signal.id, sdp: signal.sdp };
      } else if (started && signal.id === started.id) {
        cleanup(false);
        setPhase('ended');
        setMessage(endedText(signal.reason));
      }
    };
    window.addEventListener('message', onMessage);
    const off = () => window.removeEventListener('message', onMessage);

    rpc('watch.start', { playerId: playerId as never })
      .then((result) => {
        started = result;
        pc = new RTCPeerConnection({
          iceServers: result.iceServers,
          iceTransportPolicy: result.relayOnly ? 'relay' : 'all',
        });
        pc.ontrack = (event) => {
          if (!video.current) return;
          video.current.srcObject = event.streams[0] ?? new MediaStream([event.track]);
          void video.current.play().catch(() => undefined);
        };
        pc.onconnectionstatechange = () => {
          if (!pc) return;
          if (pc.connectionState === 'connected') setPhase('live');
          if (pc.connectionState === 'failed') {
            cleanup(true);
            setPhase('failed');
            setMessage(t('live.connect_failed'));
          }
        };
        setRelayed(result.relayOnly);
        run.current = { id: result.id, pc, off };
        setPhase('connecting');
        if (pendingOffer && pendingOffer.id === result.id) void answerOffer(pendingOffer.sdp);
      })
      .catch((failure: unknown) => {
        off();
        setPhase('failed');
        setMessage(errorText(failure));
      });
  };

  const stop = () => {
    cleanup(true);
    setPhase('idle');
  };

  if (!can('live.watch')) {
    return <Empty>{t('common.needs_permission', t('permissions.live_watch'))}</Empty>;
  }

  const active = phase === 'starting' || phase === 'connecting' || phase === 'live';
  return (
    <>
      <div className={`watch-viewport ${active ? 'watch-active' : ''}`}>
        <span className="watch-label">{phase === 'live' ? t('app.live') : t('live.label')}</span>
        <video
          ref={video}
          className={`live-video ${phase === 'live' ? 'show' : ''}`}
          autoPlay
          muted
          playsInline
        />
        {phase !== 'live' && (
          <>
            <Eye size={44} />
            <h3>
              {phase === 'starting'
                ? t('live.starting')
                : phase === 'connecting'
                  ? t('live.connecting')
                  : phase === 'failed' || phase === 'ended'
                    ? t('live.stopped')
                    : t('live.idle_title')}
            </h3>
            <p>
              {message ||
                (phase === 'idle'
                  ? online
                    ? t('live.idle_online')
                    : t('live.idle_offline')
                  : t('live.wait'))}
            </p>
          </>
        )}
      </div>
      <div className="inline-actions">
        {active ? (
          <button type="button" className="primary" onClick={stop}>
            {t('live.stop')}
          </button>
        ) : (
          <button type="button" className="primary" disabled={!online} onClick={start}>
            {phase === 'idle' ? t('live.start') : t('common.try_again')}
          </button>
        )}
        {can('evidence.capture') && (
          <button
            type="button"
            className="secondary"
            disabled={!online}
            onClick={() => {
              rpc('evidence.request', {
                playerId: playerId as never,
                reason: t('live.capture_reason'),
              })
                .then(() =>
                  toast(t('player.screenshot_requested'), t('player.screenshot_requested_detail')),
                )
                .catch((failure: unknown) =>
                  toast(t('player.request_failed'), errorText(failure), 'info'),
                );
            }}
          >
            <Camera size={15} />
            {t('live.save_screenshot')}
          </button>
        )}
      </div>
      <p className="muted-note">
        {relayed ? t('live.note_relayed') : t('live.note_direct')} {t('live.note_audit')}
      </p>
    </>
  );
}
