import { ChevronRight, Shield } from 'lucide-react';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { errorText } from '../lib/format';
import type { PagedList } from '../lib/hooks';
import { t } from '../lib/i18n';
import type { AdminNotification } from './AdminNotifications';
import { Dropdown } from './Dropdown';

type Notify = (title: string, message: string, kind?: AdminNotification['kind']) => void;

export const ToastContext = createContext<Notify>(() => undefined);
export const useToast = (): Notify => useContext(ToastContext);

export function Loading({ label }: { label?: string }) {
  return (
    <div className="empty-state" role="status">
      {label ?? t('common.loading')}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state error-state" role="alert">
      {message}
      {onRetry && (
        <button type="button" className="back-link" onClick={onRetry}>
          {t('common.try_again')}
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

export function Row({
  icon,
  title,
  detail,
  id,
  status,
  tone,
  extra,
  onClick,
}: {
  icon?: ReactNode | undefined;
  title: ReactNode;
  detail?: ReactNode | undefined;
  id?: string | undefined;
  status?: string | undefined;
  tone?: string | undefined;
  extra?: ReactNode | undefined;
  onClick?: (() => void) | undefined;
}) {
  const body = (
    <>
      <span className="record-icon">{icon ?? <Shield size={18} />}</span>
      <span>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
        {id && <code>{id}</code>}
      </span>
      {extra}
      {status && <span className={`record-status ${tone ? `tone-${tone}` : ''}`}>{status}</span>}
      {onClick && <ChevronRight size={15} />}
    </>
  );
  return onClick ? (
    <button type="button" className="record" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="record static">{body}</div>
  );
}

/** Renders a paged list with its loading, error and empty states, and a button for the next page. */
export function ListView<T extends { id: string }>({
  list,
  render,
  empty,
}: {
  list: PagedList<T>;
  render: (item: T) => ReactNode;
  empty?: string;
}) {
  if (list.error && list.items.length === 0)
    return <ErrorNote message={list.error} onRetry={list.reload} />;
  if (list.loading && list.items.length === 0) return <Loading />;
  return (
    <>
      <div className="record-list">
        {list.items.length ? (
          list.items.map(render)
        ) : (
          <Empty>{empty ?? t('common.nothing_to_show')}</Empty>
        )}
      </div>
      {list.error && <ErrorNote message={list.error} onRetry={list.loadMore} />}
      {list.hasMore && (
        <button
          type="button"
          className="secondary load-more"
          disabled={list.loading}
          onClick={list.loadMore}
        >
          {list.loading ? t('common.loading') : t('common.load_more')}
        </button>
      )}
    </>
  );
}

export function Section({
  title,
  children,
  aside,
}: {
  title: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="inset-card">
      <h3>
        {title}
        {aside}
      </h3>
      {children}
    </section>
  );
}

/**
 * A form that needs a written reason before it acts, as every staff action is stored with one. The button stays
 * disabled while the reason is too short or the call is running, so a double click cannot repeat it.
 */
export function ReasonForm({
  title,
  hint,
  button,
  danger,
  minimum = 3,
  onSubmit,
  children,
}: {
  title?: string;
  hint?: string;
  button: string;
  danger?: boolean;
  minimum?: number;
  onSubmit: (reason: string) => Promise<void>;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = reason.trim().length >= minimum && !busy;
  return (
    <div className="action-form">
      {title && <h3>{title}</h3>}
      {hint && <p className="muted-note">{hint}</p>}
      {children}
      <label>
        {t('common.reason')}
        <textarea
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('common.reason_placeholder')}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className={danger ? 'primary danger-button' : 'primary'}
        disabled={!ready}
        onClick={() => {
          setBusy(true);
          setError(null);
          onSubmit(reason.trim())
            .then(() => setReason(''))
            .catch((failure: unknown) => setError(errorText(failure)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? t('common.working') : button}
      </button>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="action-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function Pill({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`pill ${tone ? `tone-${tone}` : ''}`}>{children}</span>;
}

export function Lines({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <>
      {rows.map(([label, value]) => (
        <div className="session-line" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </>
  );
}

/**
 * A dropdown whose choices are locale keys. The shown text is translated, while the logic keeps working with the
 * stable key, so a filter still means the same thing in any language.
 */
export function Choice({
  label,
  keys,
  value,
  onChange,
}: {
  label: string;
  keys: readonly string[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <Dropdown
      label={label}
      value={t(value)}
      options={keys.map((key) => t(key))}
      onChange={(shown) => {
        const key = keys.find((candidate) => t(candidate) === shown);
        if (key) onChange(key);
      }}
    />
  );
}
