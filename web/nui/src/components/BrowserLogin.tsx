import { t } from '../lib/i18n';
import { webBase } from '../lib/web-panel';
import { Logo } from './Logo';

export function BrowserLogin({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  const status = new URLSearchParams(window.location.search).get('login');
  return (
    <div className="stage">
      <section className="browser-login panel" aria-busy={loading}>
        <Logo />
        <span className="eyebrow">SIMPLEAC</span>
        <h1>{t('browser.title')}</h1>
        <p>{t('browser.description')}</p>
        {loading ? (
          <p role="status">{t('common.loading')}</p>
        ) : (
          <>
            {(error || status) && (
              <p role="alert">
                {error || (status === 'denied' ? t('browser.denied') : t('browser.failed'))}
              </p>
            )}
            <a className="primary browser-signin" href={`${webBase}/auth/login`}>
              {t('browser.signin')}
            </a>
            {error && (
              <button type="button" className="back-link" onClick={retry}>
                {t('browser.retry')}
              </button>
            )}
          </>
        )}
        <small>{t('browser.access_note')}</small>
      </section>
    </div>
  );
}
