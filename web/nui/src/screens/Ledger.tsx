import { Check } from 'lucide-react';
import type { ApiAction } from '../../../../shared/contracts/api';
import { ListView, Row } from '../components/ui';
import { actionLabel, actionTone, ago } from '../lib/format';
import { usePagedList } from '../lib/hooks';
import { t } from '../lib/i18n';
import type { Nav } from '../lib/nav';

/**
 * The action ledger. "Actions" shows what was done to players (bans, kicks, warnings, automatic enforcement);
 * "Audit" shows everything, including staff work on cases, evidence and access.
 */
export function Ledger({ nav, group }: { nav: Nav; group: 'moderation' | 'all' }) {
  const list = usePagedList<'actions.list', ApiAction>('actions.list', { group });
  return (
    <>
      <div className="workspace-toolbar">
        <span className="eyebrow">
          {group === 'moderation' ? t('ledger.header_actions') : t('ledger.header_audit')}
        </span>
      </div>
      <ListView
        list={list}
        empty={group === 'moderation' ? t('ledger.empty_actions') : t('ledger.empty_audit')}
        render={(entry) => {
          const playerId = entry.targetType === 'player' ? entry.targetId : null;
          return (
            <Row
              key={entry.id}
              icon={<Check size={18} />}
              title={actionLabel(entry.actionType)}
              detail={`${entry.reason ?? t('ledger.no_reason')} · ${entry.actorType === 'system' ? t('ledger.automatic') : (entry.actorId ?? entry.actorType)} · ${ago(entry.createdAt)}`}
              id={entry.targetId ?? entry.id}
              tone={actionTone(entry.actionType)}
              status={entry.reversesActionId ? t('ledger.reversal') : undefined}
              {...(playerId ? { onClick: () => nav.open('player', playerId) } : {})}
            />
          );
        }}
      />
    </>
  );
}
