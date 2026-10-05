import { Camera } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ApiAction, Capture, CaseRecord, Detection } from '../../../../shared/contracts/api';
import { MetricMeter } from '../components/Metrics';
import {
  Choice,
  Empty,
  ErrorNote,
  Field,
  Lines,
  ListView,
  Loading,
  ReasonForm,
  Row,
  Section,
  useToast,
} from '../components/ui';
import { actionLabel, actionTone, ago, coords, dateTime, errorText } from '../lib/format';
import { usePagedList, useQuery } from '../lib/hooks';
import { t } from '../lib/i18n';
import type { Nav } from '../lib/nav';
import { rpc } from '../lib/rpc';
import { useSession } from '../lib/session';
import type { Theme } from '../theme';
import { LiveWatch } from './LiveWatch';
import { CaptureRow, CaseRow, DetectionRow } from './records';

const TABS = [
  'player.tab_summary',
  'player.tab_live',
  'player.tab_detections',
  'player.tab_cases',
  'player.tab_evidence',
  'player.tab_identifiers',
  'player.tab_actions',
] as const;
type Tab = (typeof TABS)[number];

const ACTIONS = [
  'player.action_warn',
  'player.action_kick',
  'player.action_temporary',
  'player.action_permanent',
] as const;
const DURATIONS = [
  'player.duration_1h',
  'player.duration_6h',
  'player.duration_24h',
  'player.duration_3d',
  'player.duration_7d',
  'player.duration_30d',
] as const;
const hoursOf: Record<string, number> = {
  'player.duration_1h': 1,
  'player.duration_6h': 6,
  'player.duration_24h': 24,
  'player.duration_3d': 72,
  'player.duration_7d': 168,
  'player.duration_30d': 720,
};

export function PlayerDetail({
  id,
  nav,
  colors,
  onTitle,
}: {
  id: string;
  nav: Nav;
  colors: Theme;
  onTitle: (title: string, detail: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(TABS[0]);
  const query = useQuery('players.get', { id: id as never });
  const loaded = query.data;
  useEffect(() => {
    if (!loaded) return;
    const { player, online } = loaded;
    onTitle(
      player.displayName ?? t('common.unknown_player'),
      online
        ? t('player.subtitle_online', online.source, online.ping)
        : t('players.last_seen', ago(player.lastSeenAt)),
    );
  }, [loaded, onTitle]);
  if (query.error && !query.data) return <ErrorNote message={query.error} onRetry={query.reload} />;
  if (!query.data) return <Loading />;

  return (
    <>
      <div className="detail-tabs">
        {TABS.map((name) => (
          <button
            type="button"
            key={name}
            className={tab === name ? 'active' : ''}
            onClick={() => setTab(name)}
          >
            {t(name)}
          </button>
        ))}
      </div>
      {tab === 'player.tab_summary' && (
        <Summary data={query.data} colors={colors} onChanged={query.reload} />
      )}
      {tab === 'player.tab_live' && (
        <LiveWatch key={id} playerId={id} online={query.data.online !== null} />
      )}
      {tab === 'player.tab_detections' && <PlayerDetections id={id} nav={nav} />}
      {tab === 'player.tab_cases' && <PlayerCases id={id} nav={nav} />}
      {tab === 'player.tab_evidence' && <PlayerEvidence id={id} nav={nav} />}
      {tab === 'player.tab_identifiers' && <Identifiers id={id} data={query.data} nav={nav} />}
      {tab === 'player.tab_actions' && (
        <PlayerActions id={id} data={query.data} onChanged={query.reload} />
      )}
    </>
  );
}

type PlayerData = NonNullable<ReturnType<typeof useQuery<'players.get'>>['data']>;

function Summary({
  data,
  colors,
  onChanged,
}: {
  data: PlayerData;
  colors: Theme;
  onChanged: () => void;
}) {
  const { player, online } = data;
  const { can } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const activeBan = player.bans.find((ban) => ban.active);
  const capture = () => {
    setBusy(true);
    rpc('evidence.request', { playerId: player.id, reason: t('player.capture_reason') })
      .then(() => {
        toast(t('player.screenshot_requested'), t('player.screenshot_requested_detail'));
        onChanged();
      })
      .catch((failure: unknown) => toast(t('player.request_failed'), errorText(failure), 'info'))
      .finally(() => setBusy(false));
  };
  return (
    <>
      <div className="player-metrics">
        <div>
          <span>{t('player.risk_score')}</span>
          <strong>{Math.round(player.riskScore)}/100</strong>
          <MetricMeter
            label={t('player.risk_score')}
            value={player.riskScore}
            max={100}
            color={player.riskScore >= 70 ? colors.danger : colors.accent}
          />
        </div>
        <div>
          <span>{t('player.health')}</span>
          <strong>{online ? online.health : '—'}</strong>
          {online && (
            <MetricMeter
              label={t('player.health')}
              value={online.health}
              max={200}
              color={colors.success}
            />
          )}
        </div>
        <div>
          <span>{t('player.armor')}</span>
          <strong>{online ? online.armor : '—'}</strong>
          {online && (
            <MetricMeter
              label={t('player.armor')}
              value={online.armor}
              max={100}
              color={colors.info}
            />
          )}
        </div>
        <div>
          <span>{t('player.connection')}</span>
          <strong>{online ? `${String(online.ping)} ms` : t('common.offline')}</strong>
        </div>
      </div>
      <div className="detail-columns">
        <Section title={t('player.current_session')}>
          <Lines
            rows={[
              [t('player.location'), online ? coords(online.coords) : t('player.not_connected')],
              [
                t('player.vehicle'),
                online ? (online.inVehicle ? t('player.in_vehicle') : t('player.on_foot')) : '—',
              ],
              [t('player.bucket'), online ? String(online.bucket) : '—'],
              [t('player.first_seen'), dateTime(player.firstSeenAt)],
              [t('player.identity'), player.id],
            ]}
          />
          {can('evidence.capture') && (
            <div className="inline-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy || !online}
                onClick={capture}
              >
                <Camera size={15} />
                {t('player.screenshot')}
              </button>
            </div>
          )}
        </Section>
        <Section title={t('player.standing')}>
          {activeBan ? (
            <p className="muted-note">
              {t('player.banned', activeBan.reason)}
              {activeBan.expiresAt
                ? ` · ${t('exceptions.until', dateTime(activeBan.expiresAt))}`
                : ` · ${t('player.permanent')}`}
            </p>
          ) : (
            <p className="muted-note">{t('player.no_ban')}</p>
          )}
          <h3 className="sub-heading">{t('player.recent_sessions')}</h3>
          {player.recentSessions.length ? (
            player.recentSessions.slice(0, 5).map((session) => (
              <div className="session-line" key={session.id}>
                <span>{dateTime(session.connectedAt)}</span>
                <strong>
                  {session.disconnectedAt
                    ? (session.disconnectReason ?? t('player.disconnected'))
                    : t('player.connected')}
                </strong>
              </div>
            ))
          ) : (
            <p className="muted-note">{t('player.no_sessions')}</p>
          )}
        </Section>
      </div>
    </>
  );
}

function PlayerDetections({ id, nav }: { id: string; nav: Nav }) {
  const list = usePagedList<'detections.list', Detection>('detections.list', {
    playerId: id as never,
  });
  return (
    <ListView
      list={list}
      empty={t('player.no_detections')}
      render={(item) => <DetectionRow key={item.id} detection={item} nav={nav} />}
    />
  );
}

function PlayerCases({ id, nav }: { id: string; nav: Nav }) {
  const { can } = useSession();
  const toast = useToast();
  const list = usePagedList<'cases.list', CaseRecord>('cases.list', { playerId: id as never });
  const [title, setTitle] = useState('');
  return (
    <>
      {can('cases.manage') && (
        <ReasonForm
          title={t('player.open_case_title')}
          hint={t('player.open_case_hint')}
          button={t('common.open_case')}
          onSubmit={async (reason) => {
            const created = await rpc('cases.create', {
              playerId: id as never,
              title: title.trim(),
              reason,
            });
            setTitle('');
            toast(t('player.case_opened'), created.title);
            nav.open('case', created.id);
          }}
        >
          <label>
            {t('player.case_title')}
            <input
              value={title}
              maxLength={120}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('player.case_title_placeholder')}
            />
          </label>
        </ReasonForm>
      )}
      <ListView
        list={list}
        empty={t('player.no_cases')}
        render={(item) => <CaseRow key={item.id} record={item} nav={nav} />}
      />
    </>
  );
}

function PlayerEvidence({ id, nav }: { id: string; nav: Nav }) {
  const list = usePagedList<'evidence.list', Capture>('evidence.list', { playerId: id as never });
  return (
    <ListView
      list={list}
      empty={t('player.no_screenshots')}
      render={(item) => <CaptureRow key={item.id} capture={item} nav={nav} />}
    />
  );
}

function Identifiers({ id, data, nav }: { id: string; data: PlayerData; nav: Nav }) {
  const toast = useToast();
  const links = useQuery('players.links', { id: id as never }, data.identifiersVisible);
  if (!data.identifiersVisible) {
    return <Empty>{t('player.identifiers_hidden')}</Empty>;
  }
  return (
    <>
      <Section title={t('player.linked_identifiers')}>
        {(data.player.identifiers ?? []).map((identifier) => (
          <div className="identifier-row" key={identifier.key}>
            <code>{identifier.key}</code>
            <button
              type="button"
              className="back-link"
              onClick={() => {
                void navigator.clipboard
                  .writeText(identifier.key)
                  .then(() => toast(t('player.copied'), t('player.copied_detail')))
                  .catch(() =>
                    toast(t('player.clipboard_unavailable'), t('player.clipboard_hint'), 'info'),
                  );
              }}
            >
              {t('common.copy')}
            </button>
          </div>
        ))}
      </Section>
      <Section title={t('player.alternate_accounts')}>
        {links.error ? (
          <ErrorNote message={links.error} />
        ) : links.data?.items.length ? (
          links.data.items.map((link) => (
            <Row
              key={link.id}
              title={`${link.playerId}`}
              detail={link.signals
                .map((signal) => `${signal.signal} (${signal.weight})`)
                .join(' · ')}
              status={t('player.link_score', link.score.toFixed(1))}
              tone={link.otherBanned ? 'danger' : 'muted'}
              onClick={() => nav.open('player', link.playerId)}
            />
          ))
        ) : (
          <p className="muted-note">{t('player.no_links')}</p>
        )}
      </Section>
    </>
  );
}

function PlayerActions({
  id,
  data,
  onChanged,
}: {
  id: string;
  data: PlayerData;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const toast = useToast();
  const [choice, setChoice] = useState<string>(ACTIONS[0]);
  const [duration, setDuration] = useState<string>(DURATIONS[2]);
  const ledger = usePagedList<'actions.list', ApiAction>('actions.list', { targetId: id });
  const activeBans = data.player.bans.filter((ban) => ban.active);

  return (
    <>
      {can('players.moderate') ? (
        <ReasonForm
          title={t('player.action_title')}
          hint={t('player.action_hint')}
          button={t(`${choice}_button`)}
          danger={choice !== 'player.action_warn'}
          onSubmit={async (reason) => {
            const playerId = id as never;
            if (choice === 'player.action_warn') {
              const result = await rpc('moderation.warn', { playerId, reason });
              toast(
                t('player.warning_recorded'),
                result.delivered ? t('player.warning_seen') : t('player.warning_offline'),
              );
            } else if (choice === 'player.action_kick') {
              const result = await rpc('moderation.kick', { playerId, reason });
              toast(
                t('player.kick_recorded'),
                result.dropped ? t('player.kick_removed') : t('player.kick_offline'),
              );
            } else {
              await rpc('moderation.ban', {
                playerId,
                reason,
                durationHours:
                  choice === 'player.action_permanent' ? null : (hoursOf[duration] ?? 24),
              });
              toast(t('player.banned_toast'), reason, 'ban');
            }
            onChanged();
            ledger.reload();
          }}
        >
          <Field label={t('player.action_field')}>
            <Choice
              label={t('player.action_label')}
              keys={ACTIONS}
              value={choice}
              onChange={setChoice}
            />
          </Field>
          {choice === 'player.action_temporary' && (
            <Field label={t('player.duration')}>
              <Choice
                label={t('player.duration_label')}
                keys={DURATIONS}
                value={duration}
                onChange={setDuration}
              />
            </Field>
          )}
        </ReasonForm>
      ) : (
        <Empty>{t('common.needs_permission', t('permissions.players_moderate'))}</Empty>
      )}

      {activeBans.length > 0 && can('players.moderate') && (
        <Section title={t('player.active_bans')}>
          {activeBans.map((ban) => (
            <div key={ban.id}>
              <p className="muted-note">
                {ban.reason} ·{' '}
                {ban.expiresAt
                  ? t('exceptions.until', dateTime(ban.expiresAt))
                  : t('player.permanent')}
              </p>
              <ReasonForm
                button={t('player.revoke_ban')}
                onSubmit={async (reason) => {
                  await rpc('moderation.unban', { banId: ban.id, reason });
                  toast(t('player.ban_revoked'), ban.id);
                  onChanged();
                  ledger.reload();
                }}
              />
            </div>
          ))}
        </Section>
      )}

      <Section title={t('player.history')}>
        <ListView
          list={ledger}
          empty={t('player.no_history')}
          render={(entry) => (
            <Row
              key={entry.id}
              title={actionLabel(entry.actionType)}
              detail={`${entry.reason ?? ''} · ${ago(entry.createdAt)}`}
              tone={actionTone(entry.actionType)}
            />
          )}
        />
      </Section>
    </>
  );
}
