import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { ExceptionRecord } from '../../../../shared/contracts/api';
import { Choice, Field, ListView, ReasonForm, Row, useToast } from '../components/ui';
import { dateTime, errorText } from '../lib/format';
import { usePagedList } from '../lib/hooks';
import { t } from '../lib/i18n';
import { rpc } from '../lib/rpc';
import { useSession } from '../lib/session';

const SCOPES = [
  'exceptions.scope_detection',
  'exceptions.scope_player',
  'exceptions.scope_resource',
] as const;
const scopeType: Record<string, 'player' | 'detection' | 'resource'> = {
  'exceptions.scope_player': 'player',
  'exceptions.scope_detection': 'detection',
  'exceptions.scope_resource': 'resource',
};
const scopeHint: Record<string, string> = {
  'exceptions.scope_player': 'exceptions.hint_player',
  'exceptions.scope_detection': 'exceptions.hint_detection',
  'exceptions.scope_resource': 'exceptions.hint_resource',
};
const EFFECTS = ['exceptions.effect_ignore', 'exceptions.effect_allow'] as const;
const effectOf: Record<string, 'allow' | 'ignore'> = {
  'exceptions.effect_allow': 'allow',
  'exceptions.effect_ignore': 'ignore',
};
const LENGTHS = [
  'exceptions.length_1h',
  'exceptions.length_24h',
  'exceptions.length_7d',
  'exceptions.length_30d',
  'exceptions.length_forever',
] as const;
const hoursOf: Record<string, number | null> = {
  'exceptions.length_1h': 1,
  'exceptions.length_24h': 24,
  'exceptions.length_7d': 168,
  'exceptions.length_30d': 720,
  'exceptions.length_forever': null,
};

export function Exceptions() {
  const { can } = useSession();
  const toast = useToast();
  const [activeOnly, setActiveOnly] = useState(true);
  const list = usePagedList<'exceptions.list', ExceptionRecord>('exceptions.list', { activeOnly });
  const [scope, setScope] = useState<string>(SCOPES[0]);
  const [value, setValue] = useState('');
  const [effect, setEffect] = useState<string>(EFFECTS[0]);
  const [length, setLength] = useState<string>(LENGTHS[1]);

  return (
    <>
      <div className="workspace-toolbar">
        <span className="eyebrow">{t('exceptions.header')}</span>
        <button
          type="button"
          className={`chip ${activeOnly ? 'active' : ''}`}
          aria-pressed={activeOnly}
          onClick={() => setActiveOnly(!activeOnly)}
        >
          {t('exceptions.active_only')}
        </button>
      </div>
      <ListView
        list={list}
        empty={t('exceptions.empty')}
        render={(item) => (
          <Row
            key={item.id}
            icon={<ShieldCheck size={18} />}
            title={`${item.effect === 'allow' ? t('exceptions.allow') : t('exceptions.ignore')} · ${item.scopeValue}`}
            detail={`${t(`exceptions.type_${item.scopeType}`)} · ${item.reason} · ${item.expiresAt ? t('exceptions.until', dateTime(item.expiresAt)) : t('exceptions.until_revoked')}`}
            id={item.id}
            status={
              item.active
                ? t('exceptions.active')
                : item.revokedByActionId
                  ? t('exceptions.revoked')
                  : t('exceptions.expired')
            }
            tone={item.active ? 'success' : 'muted'}
            extra={
              item.active && can('exceptions.manage') ? (
                <RevokeInline id={item.id} onDone={list.reload} />
              ) : undefined
            }
          />
        )}
      />
      {can('exceptions.manage') && (
        <ReasonForm
          title={t('exceptions.create_title')}
          hint={t('exceptions.create_hint')}
          button={t('exceptions.create_button')}
          onSubmit={async (reason) => {
            await rpc('exceptions.create', {
              scopeType: scopeType[scope] ?? 'detection',
              scopeValue: value.trim(),
              effect: effectOf[effect] ?? 'ignore',
              reason,
              durationHours: hoursOf[length] ?? null,
            });
            setValue('');
            toast(t('exceptions.created'), t('exceptions.created_detail'));
            list.reload();
          }}
        >
          <Field label={t('exceptions.applies_to')}>
            <Choice
              label={t('exceptions.scope_label')}
              keys={SCOPES}
              value={scope}
              onChange={setScope}
            />
          </Field>
          <label>
            {t(scope)}
            <input
              value={value}
              maxLength={200}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t(scopeHint[scope] ?? 'exceptions.hint_detection')}
            />
          </label>
          <Field label={t('exceptions.effect')}>
            <Choice
              label={t('exceptions.effect_label')}
              keys={EFFECTS}
              value={effect}
              onChange={setEffect}
            />
          </Field>
          <Field label={t('exceptions.for')}>
            <Choice
              label={t('exceptions.length_label')}
              keys={LENGTHS}
              value={length}
              onChange={setLength}
            />
          </Field>
        </ReasonForm>
      )}
    </>
  );
}

function RevokeInline({ id, onDone }: { id: string; onDone: () => void }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="back-link"
      onClick={(event) => {
        event.stopPropagation();
        rpc('exceptions.revoke', { id: id as never, reason: t('exceptions.revoke_reason') })
          .then(() => {
            toast(t('exceptions.revoked_toast'), id);
            onDone();
          })
          .catch((failure: unknown) =>
            toast(t('exceptions.revoke_failed'), errorText(failure), 'info'),
          );
      }}
    >
      {t('exceptions.revoke')}
    </button>
  );
}
