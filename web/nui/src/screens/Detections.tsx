import { useEffect, useState } from 'react';
import type { Detection } from '../../../../shared/contracts/api';
import {
  Choice,
  Empty,
  ErrorNote,
  Lines,
  ListView,
  Loading,
  ReasonForm,
  Section,
  useToast,
} from '../components/ui';
import { dateTime, ruleTitle } from '../lib/format';
import { usePagedList, useQuery } from '../lib/hooks';
import { t } from '../lib/i18n';
import type { Nav } from '../lib/nav';
import { rpc } from '../lib/rpc';
import { useSession } from '../lib/session';
import { CaptureRow, DetectionRow, detectionStatus } from './records';

const FILTERS = [
  'detections.filter_open',
  'detections.filter_confirmed',
  'detections.filter_dismissed',
  'detections.filter_all',
] as const;
const statusFor: Record<string, 'open' | 'confirmed' | 'dismissed' | undefined> = {
  'detections.filter_open': 'open',
  'detections.filter_confirmed': 'confirmed',
  'detections.filter_dismissed': 'dismissed',
};

export function Detections({ nav }: { nav: Nav }) {
  const [filter, setFilter] = useState<string>(FILTERS[0]);
  const status = statusFor[filter];
  const list = usePagedList<'detections.list', Detection>(
    'detections.list',
    status ? { status } : {},
  );
  return (
    <>
      <div className="workspace-toolbar">
        <span className="eyebrow">{t('detections.header')}</span>
        <Choice
          label={t('detections.filter_label')}
          keys={FILTERS}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <ListView
        list={list}
        empty={t('detections.empty')}
        render={(item) => <DetectionRow key={item.id} detection={item} nav={nav} />}
      />
    </>
  );
}

/** What a measurement is called. Anything else is shown under its raw name. */
const measuredLabel = (key: string): string =>
  ['captureId', 'resultId', 'terms', 'matchCount', 'severity'].includes(key)
    ? t(`detections.measured_${key}`)
    : key;

export function DetectionDetail({
  id,
  nav,
  onTitle,
}: {
  id: string;
  nav: Nav;
  onTitle: (title: string, detail: string) => void;
}) {
  const query = useQuery('detections.get', { id: id as never });
  const { can } = useSession();
  const toast = useToast();
  const detection = query.data;
  useEffect(() => {
    if (detection)
      onTitle(
        ruleTitle(detection.ruleKey),
        `${detection.category} · ${dateTime(detection.occurredAt)}`,
      );
  }, [detection, onTitle]);
  if (query.error && !detection) return <ErrorNote message={query.error} onRetry={query.reload} />;
  if (!detection) return <Loading />;

  const review = (status: 'open' | 'confirmed' | 'dismissed') => async (reason: string) => {
    await rpc('detections.review', { id: id as never, status, reason });
    toast(t('detections.reviewed'), detectionStatus(status));
    query.reload();
  };

  return (
    <section className="record-detail">
      <div className="detail-status">
        <span>{t('detections.review_status')}</span>
        <strong>{detectionStatus(detection.status)}</strong>
      </div>
      <div className="detail-columns">
        <Section title={t('detections.signal')}>
          <Lines
            rows={[
              [t('detections.rule'), detection.ruleKey],
              [t('detections.score'), detection.score.toFixed(1)],
              [
                t('detections.severity_confidence'),
                `${String(detection.severity)} · ${(detection.confidence * 100).toFixed(0)}%`,
              ],
              [t('detections.outcome'), detection.outcome],
              [t('detections.rule_version'), String(detection.ruleVersion)],
            ]}
          />
          <p className="muted-note">{t('detections.not_proof')}</p>
          <div className="inline-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => nav.open('player', detection.playerId)}
            >
              {t('common.open_player')}
            </button>
            {detection.caseId && (
              <button
                type="button"
                className="secondary"
                onClick={() => nav.open('case', detection.caseId ?? '')}
              >
                {t('common.open_case')}
              </button>
            )}
          </div>
        </Section>
        <Section title={t('detections.measured')}>
          {Object.keys(detection.measured).length ? (
            Object.entries(detection.measured).map(([key, value]) => (
              <div className="session-line" key={key}>
                <span>{measuredLabel(key)}</span>
                <strong>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</strong>
              </div>
            ))
          ) : (
            <p className="muted-note">{t('detections.no_measurements')}</p>
          )}
        </Section>
      </div>

      {detection.captures.length > 0 && (
        <Section title={t('detections.linked_screenshots')}>
          <div className="record-list">
            {detection.captures.map((capture) => (
              <CaptureRow key={capture.id} capture={capture} nav={nav} />
            ))}
          </div>
        </Section>
      )}

      {can('detections.review') ? (
        <ReasonForm
          title={
            detection.status === 'open'
              ? t('detections.review_title')
              : t('detections.change_title')
          }
          button={detection.status === 'open' ? t('detections.confirm') : t('detections.reopen')}
          onSubmit={review(detection.status === 'open' ? 'confirmed' : 'open')}
        />
      ) : null}
      {can('detections.review') && detection.status === 'open' && (
        <ReasonForm
          title={t('detections.dismiss_title')}
          hint={t('detections.dismiss_hint')}
          button={t('detections.dismiss')}
          onSubmit={review('dismissed')}
        />
      )}
      {!can('detections.review') && (
        <Empty>{t('common.needs_permission', t('permissions.detections_review'))}</Empty>
      )}
    </section>
  );
}
