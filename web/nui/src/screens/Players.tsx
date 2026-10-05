import { Search, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PanelPlayerRow } from '../../../../shared/contracts/panel';
import { ListView, Row, useToast } from '../components/ui';
import { ago, errorText } from '../lib/format';
import { usePagedList } from '../lib/hooks';
import { t } from '../lib/i18n';
import { kindForLookup, type Nav } from '../lib/nav';
import { rpc } from '../lib/rpc';

/** Anything that looks like an ID or a platform identifier is a lookup, not a name search. */
const looksLikeId = (value: string): boolean => /^SAC-[A-Z]+-/i.test(value) || value.includes(':');

export function GlobalSearch({ nav, placeholder }: { nav: Nav; placeholder: string }) {
  const [value, setValue] = useState('');
  const toast = useToast();
  return (
    <label className="search">
      <Search size={14} />
      <input
        aria-label={t('players.search_id_label')}
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          const query = value.trim();
          if (event.key !== 'Enter' || query.length < 3 || !looksLikeId(query)) return;
          rpc('lookup', { q: query })
            .then((result) => {
              const kind = kindForLookup(result.type);
              if (kind) nav.open(kind, result.id);
              else toast(t('players.found'), `${result.type} ${result.id}`, 'info');
            })
            .catch((failure: unknown) => toast(t('players.not_found'), errorText(failure), 'info'));
        }}
      />
    </label>
  );
}

export function Players({ nav }: { nav: Nav }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [everyone, setEveryone] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const searching = debounced.length > 0 && !looksLikeId(debounced);
  const list = usePagedList<'players.list', PanelPlayerRow>('players.list', {
    ...(searching ? { q: debounced } : {}),
    ...(everyone ? { all: true } : {}),
  });

  return (
    <>
      <div className="workspace-toolbar">
        <span className="eyebrow">
          {searching
            ? t('players.search_header')
            : everyone
              ? t('players.all_header')
              : t('players.online_header')}
        </span>
        <div className="toolbar-actions">
          <button
            type="button"
            className={`chip ${everyone ? 'active' : ''}`}
            aria-pressed={everyone}
            onClick={() => setEveryone(!everyone)}
          >
            {t('players.include_offline')}
          </button>
          <label className="search">
            <Search size={14} />
            <input
              aria-label={t('players.search_label')}
              placeholder={t('players.search_placeholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <GlobalSearch nav={nav} placeholder={t('players.jump_placeholder')} />
        </div>
      </div>
      <ListView
        list={list}
        empty={searching ? t('players.empty_search') : t('players.empty_online')}
        render={(player) => (
          <Row
            key={player.id}
            icon={<Users size={18} />}
            title={player.displayName ?? t('common.unknown_player')}
            detail={
              player.online
                ? t('players.online_line', player.online.source, player.online.ping)
                : t('players.last_seen', ago(player.lastSeenAt))
            }
            id={player.id}
            status={player.online ? t('common.online') : t('common.offline')}
            extra={
              <span className="risk-score">
                {Math.round(player.riskScore)}
                <small>{t('players.risk')}</small>
              </span>
            }
            onClick={() => nav.open('player', player.id)}
          />
        )}
      />
    </>
  );
}
