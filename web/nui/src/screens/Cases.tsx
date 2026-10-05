import { useEffect, useState } from 'react';
import type { CaseRecord } from '../../../../shared/contracts/api';
import {
  Choice,
  Empty,
  ErrorNote,
  Field,
  Lines,
  ListView,
  Loading,
  ReasonForm,
  Section,
  useToast,
} from '../components/ui';
import { actionLabel, ago, dateTime, errorText } from '../lib/format';
import { usePagedList, useQuery } from '../lib/hooks';
import { t } from '../lib/i18n';
import type { Nav } from '../lib/nav';
import { rpc } from '../lib/rpc';
import { useSession } from '../lib/session';
import { CaptureRow, CaseRow, caseStatus, DetectionRow, detectionStatus } from './records';

const FILTERS = [
  'cases.filter_active',
  'cases.filter_open',
  'cases.filter_investigating',
  'cases.filter_closed',
  'cases.filter_all',
] as const;
const STATUS_CHOICES = [
  'cases.status_open',
  'cases.status_investigating',
  'cases.status_closed',
] as const;
const statusFor: Record<string, 'open' | 'investigating' | 'closed' | undefined> = {
  'cases.filter_open': 'open',
  'cases.filter_investigating': 'investigating',
  'cases.filter_closed': 'closed',
  'cases.status_open': 'open',
  'cases.status_investigating': 'investigating',
  'cases.status_closed': 'closed',
};

export function Cases({ nav }: { nav: Nav }) {
  const [filter, setFilter] = useState<string>(FILTERS[0]);
  const status = statusFor[filter];
  const list = usePagedList<'cases.list', CaseRecord>('cases.list', status ? { status } : {});
  // "Active" hides closed cases without asking the server for a second filter.
  const visible =
    filter === 'cases.filter_active'
      ? { ...list, items: list.items.filter((item) => item.status !== 'closed') }
      : list;
  return (
    <>
      <div className="workspace-toolbar">
        <span className="eyebrow">{t('cases.header')}</span>
        <Choice
          label={t('cases.filter_label')}
          keys={FILTERS}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <ListView
        list={visible}
        empty={t('cases.empty')}
        render={(item) => <CaseRow key={item.id} record={item} nav={nav} />}
      />
    </>
  );
}

const fieldLabel = (key: string): string =>
  ['status', 'priority', 'assignedTo'].includes(key) ? t(`cases.field_${key}`) : key;

const eventText = (type: string, body: Record<string, unknown>): string => {
  if (type === 'case.note') return String(body['note'] ?? '');
  if (type === 'case.updated') {
    const changes = body['changes'] as Record<string, { from: unknown; to: unknown }> | undefined;
    return Object.entries(changes ?? {})
      .map(([key, change]) => {
        const shown = (value: unknown): string =>
          key === 'status' && typeof value === 'string' ? caseStatus(value) : String(value ?? '—');
        return `${fieldLabel(key)}: ${shown(change.from)} → ${shown(change.to)}`;
      })
      .join(' · ');
  }
  if (type === 'detection.reviewed') {
    return t('cases.event_detection_reviewed', detectionStatus(String(body['to'] ?? '')));
  }
  return Object.values(body).map(String).join(' · ').slice(0, 160);
};

export function CaseDetail({
  id,
  nav,
  onTitle,
}: {
  id: string;
  nav: Nav;
  onTitle: (title: string, detail: string) => void;
}) {
  const query = useQuery('cases.get', { id: id as never });
  const { can, session } = useSession();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState('');
  const [assignMe, setAssignMe] = useState(false);
  const [statusChoice, setStatusChoice] = useState<string>(STATUS_CHOICES[0]);
  const record = query.data;
  const recordStatus = record?.status;
  useEffect(() => {
    if (recordStatus) setStatusChoice(`cases.status_${recordStatus}`);
  }, [recordStatus]);
  useEffect(() => {
    if (record)
      onTitle(
        record.title,
        t('cases.subtitle', caseStatus(record.status), record.priority, ago(record.updatedAt)),
      );
  }, [record, onTitle]);
  if (query.error && !record) return <ErrorNote message={query.error} onRetry={query.reload} />;
  if (!record) return <Loading />;

  const update =
    (change: {
      status?: 'open' | 'investigating' | 'closed';
      priority?: number;
      assignedTo?: string | null;
    }) =>
    async (reason: string) => {
      await rpc('cases.update', { id: id as never, ...change, reason });
      toast(t('cases.updated'), reason);
      query.reload();
    };
  const me = session.staff.playerId ?? session.staff.name;

  return (
    <section className="record-detail">
      <div className="detail-status">
        <span>{t('cases.case_status')}</span>
        <strong>{caseStatus(record.status)}</strong>
      </div>
      <div className="detail-columns">
        <Section title={t('cases.summary')}>
          <Lines
            rows={[
              [t('cases.priority'), String(record.priority)],
              [t('cases.assigned_to'), record.assignedTo ?? t('cases.nobody')],
              [t('cases.opened'), dateTime(record.createdAt)],
              [t('cases.signals'), String(record.detectionCount)],
            ]}
          />
          <div className="inline-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => nav.open('player', record.playerId)}
            >
              {t('common.open_player')}
            </button>
          </div>
        </Section>
        <Section title={t('cases.timeline')}>
          {record.events.length ? (
            [...record.events].reverse().map((event) => (
              <div className="feed-row" key={event.id}>
                <span className="status-dot" />
                <span>
                  <strong>
                    {actionLabel(event.type === 'case.note' ? 'case.note_added' : event.type)}
                  </strong>
                  <small>{eventText(event.type, event.body)}</small>
                </span>
                <time>{ago(event.createdAt)}</time>
              </div>
            ))
          ) : (
            <p className="muted-note">{t('cases.no_events')}</p>
          )}
        </Section>
      </div>

      <Section title={t('cases.signals_title', record.detections.length)}>
        <div className="record-list">
          {record.detections.length ? (
            record.detections.map((detection) => (
              <DetectionRow key={detection.id} detection={detection} nav={nav} />
            ))
          ) : (
            <Empty>{t('cases.no_detections')}</Empty>
          )}
        </div>
      </Section>
      <Section title={t('cases.evidence_title', record.captures.length)}>
        <div className="record-list">
          {record.captures.length ? (
            record.captures.map((capture) => (
              <CaptureRow key={capture.id} capture={capture} nav={nav} />
            ))
          ) : (
            <Empty>{t('cases.no_screenshots')}</Empty>
          )}
        </div>
      </Section>

      {can('cases.manage') ? (
        <>
          <div className="action-form">
            <h3>{t('cases.add_note')}</h3>
            <label>
              {t('cases.note')}
              <textarea
                value={note}
                maxLength={2000}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('cases.note_placeholder')}
              />
            </label>
            <button
              type="button"
              className="primary"
              disabled={!note.trim()}
              onClick={() => {
                rpc('cases.note', { id: id as never, note: note.trim() })
                  .then(() => {
                    setNote('');
                    toast(t('cases.note_added'), t('cases.note_added_detail'));
                    query.reload();
                  })
                  .catch((failure: unknown) =>
                    toast(t('cases.note_failed'), errorText(failure), 'info'),
                  );
              }}
            >
              {t('cases.add_note_button')}
            </button>
          </div>
          <ReasonForm
            title={t('cases.change_title')}
            hint={t('cases.change_hint')}
            button={t('cases.save')}
            onSubmit={async (reason) => {
              const status = statusFor[statusChoice];
              await update({
                ...(status && status !== record.status ? { status } : {}),
                ...(assignMe && record.assignedTo !== me ? { assignedTo: me } : {}),
                ...(priority.trim() && Number(priority) !== record.priority
                  ? { priority: Math.max(0, Math.min(100, Number(priority))) }
                  : {}),
              })(reason);
              setPriority('');
              setAssignMe(false);
            }}
          >
            <Field label={t('cases.status_field')}>
              <Choice
                label={t('cases.case_status')}
                keys={STATUS_CHOICES}
                value={statusChoice}
                onChange={setStatusChoice}
              />
            </Field>
            <Field label={t('cases.priority_field')}>
              <input
                type="number"
                min={0}
                max={100}
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                placeholder={String(record.priority)}
              />
            </Field>
            <label className="toggle-row">
              <span>{t('cases.assign_me')}</span>
              <input
                type="checkbox"
                checked={assignMe}
                onChange={(event) => setAssignMe(event.target.checked)}
              />
            </label>
          </ReasonForm>
        </>
      ) : (
        <Empty>{t('common.needs_permission', t('permissions.cases_manage'))}</Empty>
      )}
    </section>
  );
}
