import { useEffect, useState } from 'react';
import type { Capture } from '../../../../shared/contracts/api';
import {
  Empty,
  ErrorNote,
  Lines,
  ListView,
  Loading,
  ReasonForm,
  Section,
  useToast,
} from '../components/ui';
import { dateTime, errorText } from '../lib/format';
import { usePagedList, useQuery } from '../lib/hooks';
import { t } from '../lib/i18n';
import type { Nav } from '../lib/nav';
import { rpc } from '../lib/rpc';
import { useSession } from '../lib/session';
import { CaptureRow, captureState, ImageViewer, trigger } from './records';

export function Evidence({ nav }: { nav: Nav }) {
  const [matched, setMatched] = useState(false);
  const list = usePagedList<'evidence.list', Capture>(
    'evidence.list',
    matched ? { matchedOnly: true } : {},
  );
  return (
    <>
      <div className="workspace-toolbar">
        <span className="eyebrow">
          {matched ? t('evidence.header_matched') : t('evidence.header')}
        </span>
        <button
          type="button"
          className={`chip ${matched ? 'active' : ''}`}
          aria-pressed={matched}
          onClick={() => setMatched(!matched)}
        >
          {t('evidence.matches_only')}
        </button>
      </div>
      <ListView
        list={list}
        empty={matched ? t('evidence.empty_matched') : t('evidence.empty')}
        render={(item) => <CaptureRow key={item.id} capture={item} nav={nav} />}
      />
    </>
  );
}

export function CaptureDetail({
  id,
  nav,
  onTitle,
}: {
  id: string;
  nav: Nav;
  onTitle: (title: string, detail: string) => void;
}) {
  const query = useQuery('evidence.get', { id: id as never });
  const { can } = useSession();
  const toast = useToast();
  const capture = query.data;
  useEffect(() => {
    if (capture)
      onTitle(t('records.capture_title', trigger(capture.trigger)), dateTime(capture.createdAt));
  }, [capture, onTitle]);
  if (query.error && !capture) return <ErrorNote message={query.error} onRetry={query.reload} />;
  if (!capture) return <Loading />;
  const stored = capture.status === 'uploaded';
  const latest = capture.ocr[0];

  return (
    <section className="record-detail">
      <div className="detail-status">
        <span>{t('evidence.capture_status')}</span>
        <strong>
          {stored
            ? t('records.capture_stored')
            : capture.error === 'sweep_clean'
              ? t('evidence.discarded_clean')
              : capture.error === 'deleted_by_staff'
                ? t('evidence.deleted_by_staff')
                : captureState(capture)}
        </strong>
      </div>
      {stored ? <ImageViewer id={id} /> : <Empty>{t('evidence.image_gone')}</Empty>}
      <div className="detail-columns">
        <Section title={t('evidence.capture')}>
          <Lines
            rows={[
              [t('evidence.taken'), dateTime(capture.createdAt)],
              [t('evidence.trigger'), trigger(capture.trigger)],
              [
                t('evidence.size'),
                capture.width && capture.height
                  ? `${String(capture.width)}×${String(capture.height)}`
                  : '—',
              ],
              [t('evidence.storage'), capture.storageBackend ?? '—'],
              ['SHA-256', capture.sha256 ? `${capture.sha256.slice(0, 16)}…` : '—'],
            ]}
          />
          <div className="inline-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => nav.open('player', capture.playerId)}
            >
              {t('common.open_player')}
            </button>
            {capture.caseId && (
              <button
                type="button"
                className="secondary"
                onClick={() => nav.open('case', capture.caseId ?? '')}
              >
                {t('common.open_case')}
              </button>
            )}
            {capture.detectionId && (
              <button
                type="button"
                className="secondary"
                onClick={() => nav.open('detection', capture.detectionId ?? '')}
              >
                {t('common.open_detection')}
              </button>
            )}
          </div>
        </Section>
        <Section title={t('evidence.text_found')}>
          {latest ? (
            <>
              <div className="permission-tags">
                {[...new Set(latest.matches.map((match) => match.term))].map((term) => (
                  <span key={term}>{term}</span>
                ))}
              </div>
              {latest.matches.length === 0 && (
                <p className="muted-note">{t('evidence.no_matches')}</p>
              )}
              <pre className="ocr-text">{latest.text.trim() || t('evidence.no_text')}</pre>
              <p className="muted-note">
                {t('evidence.read_in', latest.durationMs, latest.ruleVersion)}
              </p>
            </>
          ) : (
            <p className="muted-note">
              {stored ? t('evidence.waiting_ocr') : t('evidence.no_ocr_result')}
            </p>
          )}
        </Section>
      </div>

      {stored && can('evidence.capture') && (
        <>
          <div className="inline-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                rpc('evidence.rescan', { id: id as never })
                  .then(() => {
                    toast(t('evidence.rereading'), t('evidence.rereading_detail'));
                    window.setTimeout(query.reload, 3000);
                  })
                  .catch((failure: unknown) =>
                    toast(t('evidence.reread_failed'), errorText(failure), 'info'),
                  );
              }}
            >
              {t('evidence.read_again')}
            </button>
          </div>
          <ReasonForm
            title={t('evidence.delete_title')}
            hint={t('evidence.delete_hint')}
            button={t('evidence.delete_button')}
            danger
            onSubmit={async (reason) => {
              await rpc('evidence.delete', { id: id as never, reason });
              toast(t('evidence.deleted'), t('evidence.deleted_detail'));
              query.reload();
            }}
          />
        </>
      )}
    </section>
  );
}
