import { Bell, Check, ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';
import { t } from '../lib/i18n';
export type AdminNotification = {
  id: number;
  title: string;
  message: string;
  kind: 'info' | 'success' | 'ban';
  createdAt: number;
  count: number;
};
function Notification({
  item,
  dismiss,
}: {
  item: AdminNotification;
  dismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(
      () => dismiss(item.id),
      Math.max(0, item.createdAt + 7000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [item, dismiss]);
  const Icon = item.kind === 'ban' ? ShieldAlert : item.kind === 'success' ? Check : Bell;
  return (
    <article className={`admin-notification notification-${item.kind}`}>
      <span className="notification-icon">
        <Icon size={20} />
      </span>
      <div>
        <span className="notification-source">{t('brand.alert')}</span>
        <strong>{item.title}</strong>
        <p>{item.message}</p>
      </div>
      {item.count > 1 && (
        <span className="notification-count" title={t('metrics.notifications_count', item.count)}>
          ×{item.count}
        </span>
      )}
      <span key={item.count} className="notification-lifetime" />
    </article>
  );
}
export function AdminNotifications({
  compact,
  items,
  dismiss,
}: {
  items: AdminNotification[];
  compact: boolean;
  dismiss: (id: number) => void;
}) {
  return (
    <aside
      className={`admin-notifications ${compact ? 'notifications-compact' : ''}`}
      aria-label={t('metrics.notifications_label')}
      aria-live="polite"
      aria-relevant="additions text"
    >
      {items.map((item) => (
        <Notification key={item.id} item={item} dismiss={dismiss} />
      ))}
    </aside>
  );
}
