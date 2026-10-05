import { useState } from 'react';
import { type PanelPermission, panelPermissions } from '../../../../shared/contracts/panel';
import { ErrorNote, Loading, Section, useToast } from '../components/ui';
import { errorText } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { t } from '../lib/i18n';
import { rpc } from '../lib/rpc';

const IDENTIFIER = /^[a-z0-9_]{2,16}:[A-Za-z0-9._-]{1,200}$/;

/** The translated name of a permission such as `cases.manage`. */
const permissionLabel = (permission: PanelPermission): string =>
  t(`permissions.${permission.replace(/\./g, '_')}`);

export function Access() {
  const query = useQuery('access.list', {});
  const toast = useToast();
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [grant, setGrant] = useState<PanelPermission[]>(['players.view']);
  const [busy, setBusy] = useState(false);
  if (query.error && !query.data) return <ErrorNote message={query.error} onRetry={query.reload} />;
  if (!query.data) return <Loading />;
  const members = query.data.items;
  const valid = IDENTIFIER.test(identifier.trim()) && name.trim().length > 0 && grant.length > 0;

  return (
    <div className="access-layout">
      <Section
        title={
          <>
            {t('access.members')} <span className="count">{members.length}</span>
          </>
        }
      >
        <p className="muted-note">{t('access.admin_note')}</p>
        {members.map((member) => (
          <div className="access-member" key={member.identifier}>
            <strong>{member.name}</strong>
            <code>{member.identifier}</code>
            <div className="permission-tags">
              {member.permissions.map((permission) => (
                <span key={permission}>{permissionLabel(permission)}</span>
              ))}
            </div>
            <button
              type="button"
              className="back-link"
              onClick={() => {
                rpc('access.revoke', { identifier: member.identifier })
                  .then(() => {
                    toast(t('access.revoked'), member.name);
                    query.reload();
                  })
                  .catch((failure: unknown) =>
                    toast(t('access.revoke_failed'), errorText(failure), 'info'),
                  );
              }}
            >
              {t('access.revoke')}
            </button>
          </div>
        ))}
        {members.length === 0 && <p className="muted-note">{t('access.none')}</p>}
      </Section>
      <section className="inset-card action-form">
        <h3>{t('access.grant_title')}</h3>
        <label>
          {t('access.display_name')}
          <input
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('access.name_placeholder')}
          />
        </label>
        <label>
          {t('access.identifier')}
          <input
            value={identifier}
            maxLength={220}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="license:..."
          />
        </label>
        <div className="permissions-list">
          {panelPermissions.map((permission) => (
            <label className="toggle-row" key={permission}>
              <span>{permissionLabel(permission)}</span>
              <input
                type="checkbox"
                checked={grant.includes(permission)}
                onChange={(event) =>
                  setGrant(
                    event.target.checked
                      ? [...grant, permission]
                      : grant.filter((item) => item !== permission),
                  )
                }
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="primary"
          disabled={!valid || busy}
          onClick={() => {
            setBusy(true);
            rpc('access.grant', {
              identifier: identifier.trim(),
              name: name.trim(),
              permissions: grant,
            })
              .then(() => {
                toast(t('access.granted'), name.trim());
                setName('');
                setIdentifier('');
                query.reload();
              })
              .catch((failure: unknown) =>
                toast(t('access.grant_failed'), errorText(failure), 'info'),
              )
              .finally(() => setBusy(false));
          }}
        >
          {t('access.grant')}
        </button>
      </section>
    </div>
  );
}
