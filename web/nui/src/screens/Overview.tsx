import { Radar } from 'lucide-react';
import { MetricMeter, Sparkline } from '../components/Metrics';
import { Empty, ErrorNote, Loading, Row } from '../components/ui';
import { actionLabel, actionTone, ago, ruleTitle } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { t } from '../lib/i18n';
import type { Nav } from '../lib/nav';
import type { Theme } from '../theme';

const uptime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? t('time.hours_minutes', hours, minutes) : t('time.minutes', minutes);
};

export function Overview({ nav, colors }: { nav: Nav; colors: Theme }) {
  const query = useQuery('overview.get', {});
  if (query.error && !query.data) return <ErrorNote message={query.error} onRetry={query.reload} />;
  if (!query.data) return <Loading />;
  const { stats, trends, attention, activity, server } = query.data;
  return (
    <>
      <div className="player-metrics overview-metrics">
        <div>
          <span>{t('overview.players_online')}</span>
          <strong>{server.online}</strong>
          <small>{t('overview.slots_of', server.slots)}</small>
          <MetricMeter
            label={t('overview.slots_used')}
            value={server.online}
            max={Math.max(1, server.slots)}
            color={colors.accent}
          />
        </div>
        <div className="metric-with-chart">
          <span>{t('overview.detections_today')}</span>
          <strong>{stats.detections.last24h}</strong>
          <small>{t('overview.need_review', stats.detections.open)}</small>
          <Sparkline
            points={trends.detections}
            color={colors.accent}
            label={t('overview.detections_unit')}
          />
        </div>
        <div className="metric-with-chart">
          <span>{t('overview.open_cases')}</span>
          <strong>{stats.cases.open + stats.cases.investigating}</strong>
          <small>{t('overview.investigating', stats.cases.investigating)}</small>
          <Sparkline points={trends.cases} color={colors.purple} label={t('overview.cases_unit')} />
        </div>
        <div>
          <span>{t('overview.evidence_today')}</span>
          <strong>{stats.captures.last24h}</strong>
          <small>
            {t('overview.evidence_detail', stats.captures.ocrMatchesLast24h, stats.bans.active)}
          </small>
        </div>
      </div>

      <div className="workspace-toolbar">
        <span className="eyebrow">{t('overview.attention')}</span>
        <span className="eyebrow">
          {t('overview.up', uptime(server.uptimeSeconds).toUpperCase())} ·{' '}
          {(server.profile ?? t('server.no_profile')).toUpperCase()}
        </span>
      </div>
      <div className="record-list">
        {attention.length ? (
          attention.map((detection) => (
            <Row
              key={detection.id}
              icon={<Radar size={18} />}
              title={ruleTitle(detection.ruleKey)}
              detail={t(
                'overview.detection_line',
                detection.score.toFixed(0),
                detection.outcome,
                ago(detection.occurredAt),
              )}
              id={detection.id}
              status={t('records.status_open')}
              onClick={() => nav.open('detection', detection.id)}
            />
          ))
        ) : (
          <Empty>{t('overview.nothing')}</Empty>
        )}
      </div>

      <section className="inset-card overview-feed">
        <h3>{t('overview.recent')}</h3>
        {activity.length ? (
          activity.map((event) => (
            <div className="feed-row" key={event.id}>
              <span className={`status-dot tone-${actionTone(event.actionType)}`} />
              <span>
                <strong>{actionLabel(event.actionType)}</strong>
                <small>{event.reason ?? event.targetId ?? event.origin}</small>
              </span>
              <time>{ago(event.createdAt)}</time>
            </div>
          ))
        ) : (
          <Empty>{t('overview.no_activity')}</Empty>
        )}
      </section>
    </>
  );
}
