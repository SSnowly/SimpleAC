import { ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { Empty, ErrorNote, Lines, Loading, Row, Section } from '../components/ui';
import { dateTime, modeLabel, ruleTitle } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { t } from '../lib/i18n';
import type { Nav } from '../lib/nav';

export function Profiles({ nav }: { nav: Nav }) {
  const query = useQuery('profiles.list', {});
  if (query.error && !query.data) return <ErrorNote message={query.error} onRetry={query.reload} />;
  if (!query.data) return <Loading />;
  return (
    <>
      <div className="workspace-toolbar">
        <span className="eyebrow">{t('profiles.header')}</span>
      </div>
      <div className="record-list">
        {query.data.items.length ? (
          query.data.items.map((profile) => (
            <Row
              key={profile.id}
              icon={<ShieldCheck size={18} />}
              title={profile.name}
              detail={profile.description ?? t('profiles.versions_count', profile.versionCount)}
              id={profile.id}
              status={
                profile.activeVersion
                  ? t('profiles.active_version', profile.activeVersion)
                  : t('profiles.inactive')
              }
              tone="success"
              onClick={() => nav.open('profile', profile.id)}
            />
          ))
        ) : (
          <Empty>{t('profiles.empty')}</Empty>
        )}
      </div>
      <p className="muted-note">{t('profiles.note')}</p>
    </>
  );
}

export function ProfileDetail({
  id,
  onTitle,
}: {
  id: string;
  onTitle: (title: string, detail: string) => void;
}) {
  const query = useQuery('profiles.get', { id: id as never });
  const profile = query.data;
  useEffect(() => {
    if (profile) onTitle(profile.name, profile.description ?? t('profiles.default_subtitle'));
  }, [profile, onTitle]);
  if (query.error && !profile) return <ErrorNote message={query.error} onRetry={query.reload} />;
  if (!profile) return <Loading />;
  const rules = profile.config?.['rules'];
  const entries =
    typeof rules === 'object' && rules !== null
      ? Object.entries(rules as Record<string, { enabled?: boolean; mode?: string }>)
      : [];
  return (
    <section className="record-detail">
      <div className="detail-columns">
        <Section title={t('profiles.profile')}>
          <Lines
            rows={[
              [
                t('profiles.active_version_label'),
                profile.activeVersion ? `v${String(profile.activeVersion)}` : t('common.none'),
              ],
              [t('profiles.versions_recorded'), String(profile.versionCount)],
              [t('profiles.created'), dateTime(profile.createdAt)],
            ]}
          />
        </Section>
        <Section title={t('profiles.versions')}>
          {profile.versions.map((version) => (
            <div className="session-line" key={version.id}>
              <span>
                v{String(version.version)} · {version.createdBy}
              </span>
              <strong>{dateTime(version.createdAt)}</strong>
            </div>
          ))}
        </Section>
      </div>
      <Section title={t('profiles.rules_title', entries.length)}>
        {entries.length ? (
          entries
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, rule]) => (
              <div className="session-line" key={key}>
                <span>{ruleTitle(key)}</span>
                <strong>
                  {rule.enabled === false ? t('common.off') : modeLabel(rule.mode ?? 'log')}
                </strong>
              </div>
            ))
        ) : (
          <p className="muted-note">{t('profiles.no_rules')}</p>
        )}
      </Section>
    </section>
  );
}
