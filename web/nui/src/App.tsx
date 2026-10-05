import { ArrowLeft, ChevronRight, Settings2, Shield, ShieldCheck, Users, X } from 'lucide-react';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import type { PanelSession } from '../../../shared/contracts/panel';
import './styles.css';
import { type AdminNotification, AdminNotifications } from './components/AdminNotifications';
import { BrowserLogin } from './components/BrowserLogin';
import { Logo } from './components/Logo';
import { Tour } from './components/Tour';
import { ToastContext } from './components/ui';
import { devSession } from './lib/dev-backend';
import { isBrowser, isDev } from './lib/env';
import { errorText } from './lib/format';
import { setStrings, t } from './lib/i18n';
import { type DetailKind, type Nav, type Route, type Screen, screenOf, screens } from './lib/nav';
import { notifyClosed, rpc } from './lib/rpc';
import { SessionProvider } from './lib/session';
import { listenWebEvents, loadWebSession, logoutWeb } from './lib/web-panel';
import { Access } from './screens/Access';
import { CaseDetail, Cases } from './screens/Cases';
import { Configuration } from './screens/Configuration';
import { DetectionDetail, Detections } from './screens/Detections';
import { CaptureDetail, Evidence } from './screens/Evidence';
import { Exceptions } from './screens/Exceptions';
import { Ledger } from './screens/Ledger';
import { Overview } from './screens/Overview';
import { PlayerDetail } from './screens/PlayerDetail';
import { Players } from './screens/Players';
import { ProfileDetail, Profiles } from './screens/Profiles';
import { loadTheme, saveTheme, type Theme } from './theme';
import { tourSteps } from './tour';

type PanelPhase = 'closed' | 'opening' | 'open' | 'closing';
const OPEN_MS = 1100;
const CLOSE_MS = 450;
const motionDuration = (ms: number) =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;

const screenKey: Record<Screen, string> = {
  Overview: 'overview',
  Players: 'players',
  Detections: 'detections',
  Cases: 'cases',
  Evidence: 'evidence',
  Actions: 'actions',
  Exceptions: 'exceptions',
  Profiles: 'profiles',
  Audit: 'audit',
  Configuration: 'configuration',
  'Panel access': 'panel_access',
};

type MessageData = {
  action?: string;
  session?: PanelSession;
  strings?: Record<string, string>;
} | null;

export function App() {
  const [webLoading, setWebLoading] = useState(isBrowser);
  const [webError, setWebError] = useState('');
  const [session, setSession] = useState<PanelSession | null>(isDev ? devSession : null);
  const [stack, setStack] = useState<Route[]>([{ screen: 'Overview' }]);
  const [heading, setHeading] = useState<{ title: string; detail: string } | null>(null);
  const [visible, setVisible] = useState(isDev || isBrowser);
  const [phase, setPhase] = useState<PanelPhase>(isDev ? 'opening' : 'closed');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const closeTimer = useRef<number | undefined>(undefined);
  const [tour, setTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const tourReturn = useRef<Route[] | null>(null);
  const opened = useRef(false);
  const tourSeen = useRef(false);
  const [colors, setColorsState] = useState<Theme>(loadTheme);
  const [bypass, setBypass] = useState(false);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const notificationId = useRef(0);

  const route = stack.at(-1) ?? { screen: 'Overview' as Screen };

  useEffect(() => {
    try {
      tourSeen.current = localStorage.getItem('simpleac-tour-seen') === 'true';
    } catch {
      /* Storage may be unavailable in NUI. */
    }
  }, []);

  const startTour = () => {
    tourReturn.current = stack;
    showTourStep(0);
    setTour(true);
  };
  const startInitialTour = useEffectEvent(startTour);

  useEffect(() => {
    if (!visible || phase !== 'opening') return;
    const timer = setTimeout(() => {
      setPhase('open');
      if (opened.current) return;
      opened.current = true;
      if (!tourSeen.current) startInitialTour();
    }, motionDuration(OPEN_MS));
    return () => clearTimeout(timer);
  }, [visible, phase]);

  const showPanel = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    phaseRef.current = 'opening';
    setVisible(true);
    setPhase('opening');
  }, []);

  const reloadWeb = useCallback(() => {
    setWebLoading(true);
    setWebError('');
    void loadWebSession()
      .then((result) => {
        setSession(result);
        setBypass(result.staff.bypass);
        showPanel();
      })
      .catch((failure: unknown) => {
        setSession(null);
        if (!(failure instanceof Error && failure.message === 'Sign in to the panel.'))
          setWebError(errorText(failure));
      })
      .finally(() => setWebLoading(false));
  }, [showPanel]);

  useEffect(() => {
    if (isBrowser) reloadWeb();
  }, [reloadWeb]);

  useEffect(() => {
    if (!isBrowser || !session) return;
    const onAccess = (event: Event) => {
      setSession(null);
      setWebError(
        (event as CustomEvent<string>).detail === 'forbidden'
          ? t('browser.denied')
          : t('browser.expired'),
      );
    };
    window.addEventListener('simpleac:web:access', onAccess);
    const off = listenWebEvents();
    return () => {
      off();
      window.removeEventListener('simpleac:web:access', onAccess);
    };
  }, [session]);

  // The panel stays mounted while it plays the closing animation; only then is it removed and the game told.
  const hidePanel = useCallback(() => {
    if (isBrowser) {
      void logoutWeb().catch((failure: unknown) => {
        setSession(null);
        setWebError(errorText(failure));
      });
      return;
    }
    if (phaseRef.current === 'closing' || phaseRef.current === 'closed') return;
    phaseRef.current = 'closing';
    setTour(false);
    setPhase('closing');
    closeTimer.current = window.setTimeout(() => {
      setVisible(false);
      setPhase('closed');
      notifyClosed();
    }, motionDuration(CLOSE_MS));
  }, []);

  const pushNotification = useCallback(
    (title: string, message: string, kind: AdminNotification['kind'] = 'success') => {
      const item = {
        id: ++notificationId.current,
        title,
        message,
        kind,
        createdAt: Date.now(),
        count: 1,
      };
      setNotifications((items) => {
        const existing = items.find((notification) => notification.kind === kind);
        if (!existing) return [...items.slice(-3), item];
        return items.map((notification) =>
          notification.kind === kind
            ? { ...item, id: notification.id, count: notification.count + 1 }
            : notification,
        );
      });
    },
    [],
  );
  const dismissNotification = useCallback(
    (id: number) => setNotifications((items) => items.filter((item) => item.id !== id)),
    [],
  );

  const nav: Nav = {
    route,
    canGoBack: stack.length > 1,
    open: (kind: DetailKind, id: string) => {
      setHeading(null);
      setStack((previous) => [...previous, { screen: screenOf[kind], detail: { kind, id } }]);
    },
    go: (screen: Screen) => {
      setHeading(null);
      setStack([{ screen }]);
    },
    back: () => {
      setHeading(null);
      setStack((previous) => (previous.length > 1 ? previous.slice(0, -1) : previous));
    },
  };

  const handleEscape = () => {
    if (stack.length > 1) nav.back();
    else if (!isBrowser) hidePanel();
  };
  const escapeRef = useRef(handleEscape);
  escapeRef.current = handleEscape;

  useEffect(() => {
    const onMessage = (event: MessageEvent<MessageData>) => {
      if (isBrowser) return;
      const data = event.data;
      if (data?.action === 'simpleac:panel:open') {
        setStrings(data.strings);
        if (data.session) {
          setSession(data.session);
          setBypass(data.session.staff.bypass);
        }
        setStack([{ screen: 'Overview' }]);
        setHeading(null);
        showPanel();
      }
      if (data?.action === 'simpleac:panel:close') hidePanel();
      if (data?.action === 'simpleac:panel:escape') escapeRef.current();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [showPanel, hidePanel]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') escapeRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const showTourStep = (index: number) => {
    const step = tourSteps[index];
    if (!step) return;
    setTourStep(index);
    setHeading(null);
    setStack([{ screen: step.screen }]);
  };
  const finishTour = () => {
    setTour(false);
    if (tourReturn.current) setStack(tourReturn.current);
    tourSeen.current = true;
    try {
      localStorage.setItem('simpleac-tour-seen', 'true');
    } catch {
      /* Keep completion in memory. */
    }
  };

  const setColors = (next: Theme) => {
    setColorsState(next);
    saveTheme(next);
  };
  const onTitle = useCallback((title: string, detail: string) => setHeading({ title, detail }), []);

  const style = Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [`--${key}`, value]),
  ) as CSSProperties;
  if (!session) {
    if (isBrowser)
      return (
        <div className="app preview" style={style}>
          <BrowserLogin loading={webLoading} error={webError} retry={reloadWeb} />
        </div>
      );
    // Nothing to show until the server has said who this is.
    return (
      <div className={`app ${isDev ? 'preview' : 'game'}`} data-env={isDev ? 'dev' : 'game'} />
    );
  }

  const { staff, server } = session;
  const initials = staff.name
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const admin = staff.permissions.includes('access.manage');
  const detail = route.detail;
  const title = detail
    ? (heading?.title ?? t('common.loading'))
    : route.screen === 'Overview'
      ? t('app.server_overview')
      : t(`nav.${screenKey[route.screen]}`);
  const subtitle = detail ? (heading?.detail ?? '') : t(`nav_desc.${screenKey[route.screen]}`);
  const serverName = server.name || t('server.fallback_name');

  const renderContent = () => {
    if (detail) {
      switch (detail.kind) {
        case 'player':
          return (
            <PlayerDetail
              key={detail.id}
              id={detail.id}
              nav={nav}
              colors={colors}
              onTitle={onTitle}
            />
          );
        case 'detection':
          return <DetectionDetail key={detail.id} id={detail.id} nav={nav} onTitle={onTitle} />;
        case 'case':
          return <CaseDetail key={detail.id} id={detail.id} nav={nav} onTitle={onTitle} />;
        case 'capture':
          return <CaptureDetail key={detail.id} id={detail.id} nav={nav} onTitle={onTitle} />;
        case 'profile':
          return <ProfileDetail key={detail.id} id={detail.id} onTitle={onTitle} />;
      }
    }
    switch (route.screen) {
      case 'Overview':
        return <Overview nav={nav} colors={colors} />;
      case 'Players':
        return <Players nav={nav} />;
      case 'Detections':
        return <Detections nav={nav} />;
      case 'Cases':
        return <Cases nav={nav} />;
      case 'Evidence':
        return <Evidence nav={nav} />;
      case 'Actions':
        return <Ledger nav={nav} group="moderation" />;
      case 'Audit':
        return <Ledger nav={nav} group="all" />;
      case 'Exceptions':
        return <Exceptions />;
      case 'Profiles':
        return <Profiles nav={nav} />;
      case 'Configuration':
        return <Configuration colors={colors} setColors={setColors} />;
      case 'Panel access':
        return <Access />;
    }
  };

  return (
    <ToastContext.Provider value={pushNotification}>
      <SessionProvider session={session}>
        <div
          className={`app ${isDev || isBrowser ? 'preview' : 'game'}`}
          style={style}
          data-env={isDev ? 'dev' : 'game'}
        >
          {!visible && isDev && (
            <button type="button" className="reopen primary" onClick={showPanel}>
              Open SimpleAC
            </button>
          )}
          {visible && (
            <div className="stage">
              <main
                className={`panel refined-panel ${phase === 'opening' || phase === 'closing' ? phase : ''}`}
                inert={tour || phase === 'closing'}
              >
                <header className="topbar">
                  <button type="button" className="brand" onClick={() => nav.go('Overview')}>
                    <Logo />
                    <span>
                      SIMPLE<span className="brand-ac">AC</span>
                      <small>{t('brand.administration')}</small>
                    </span>
                  </button>
                  <nav aria-label={t('common.main_navigation')}>
                    {screens.map((item) => (
                      <button
                        type="button"
                        key={item}
                        className={route.screen === item ? 'active' : ''}
                        onClick={() => nav.go(item)}
                      >
                        {t(`nav.${screenKey[item]}`)}
                      </button>
                    ))}
                  </nav>
                  <button
                    type="button"
                    className="close"
                    aria-label={isBrowser ? t('browser.signout') : t('common.close_panel')}
                    onClick={hidePanel}
                  >
                    <X size={17} />
                  </button>
                </header>
                <div className="console-layout">
                  <aside className="operator-sidebar">
                    <div className="identity-banner">
                      <Shield size={95} />
                      <span>{t('brand.authorized')}</span>
                    </div>
                    <div className="avatar">{initials}</div>
                    <div className="operator-name">
                      {staff.name}
                      <small>
                        {admin ? t('app.administrator') : t('app.staff')} ·{' '}
                        {isBrowser ? t('browser.session') : `#${staff.source}`}
                      </small>
                    </div>
                    <div className="sidebar-section">
                      <span className="eyebrow">{t('app.your_session')}</span>
                      <div className="session-line">
                        <span>{t('app.permissions')}</span>
                        <strong>{staff.permissions.length}</strong>
                      </div>
                      <label className="toggle-row bypass-control">
                        <span>
                          <Shield size={14} /> {t('app.bypass')}
                        </span>
                        <input
                          type="checkbox"
                          role="switch"
                          className="custom-switch"
                          checked={bypass}
                          aria-checked={bypass}
                          disabled={
                            !staff.permissions.includes('exceptions.manage') || !staff.playerId
                          }
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            rpc('bypass.set', { enabled })
                              .then((result) => {
                                setBypass(result.bypass);
                                pushNotification(
                                  result.bypass ? t('app.bypass_on') : t('app.bypass_off'),
                                  t('app.bypass_applies'),
                                );
                              })
                              .catch((failure: unknown) =>
                                pushNotification(
                                  t('app.bypass_failed'),
                                  errorText(failure),
                                  'info',
                                ),
                              );
                          }}
                        />
                      </label>
                      <p className="muted-note">{t('app.bypass_note')}</p>
                    </div>
                    <div className="sidebar-section">
                      <span className="eyebrow">{t('app.administration')}</span>
                      {admin && (
                        <button
                          type="button"
                          className={`side-link ${route.screen === 'Panel access' ? 'chosen' : ''}`}
                          onClick={() => nav.go('Panel access')}
                        >
                          <Users size={16} />
                          {t('nav.panel_access')}
                          <ChevronRight size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        className={`side-link ${route.screen === 'Configuration' ? 'chosen' : ''}`}
                        onClick={() => nav.go('Configuration')}
                      >
                        <Settings2 size={16} />
                        {t('nav.configuration')}
                        <ChevronRight size={13} />
                      </button>
                    </div>
                    <div className="sidebar-bottom">
                      <ShieldCheck size={20} />
                      <strong>{server.profile ?? t('server.no_profile')}</strong>
                      <small>{t('server.active_profile')}</small>
                    </div>
                  </aside>
                  <section className="content-pane">
                    <div className="page-heading">
                      <div>
                        {detail ? (
                          <button type="button" className="back-link" onClick={nav.back}>
                            <ArrowLeft size={15} />
                            {t('common.back')}
                          </button>
                        ) : (
                          <span className="eyebrow">{serverName}</span>
                        )}
                        <h2>{title}</h2>
                        <p>{subtitle}</p>
                      </div>
                      {detail ? (
                        <code className="heading-id">{detail.id}</code>
                      ) : (
                        <span className="live-badge">{t('app.live')}</span>
                      )}
                    </div>
                    {renderContent()}
                  </section>
                </div>
                <footer>
                  <button
                    type="button"
                    className="back-link"
                    onClick={() => {
                      nav.go('Overview');
                      startTour();
                    }}
                  >
                    {t('app.replay_tour')}
                  </button>
                  <span>
                    <ShieldCheck size={13} />
                    {serverName}
                    <i />v{server.version}
                  </span>
                  {!isBrowser && (
                    <span>
                      <kbd>ESC</kbd>
                      {stack.length > 1 ? t('common.back') : t('common.close_panel')}
                    </span>
                  )}
                </footer>
              </main>
            </div>
          )}
          {visible && tour && <Tour onFinish={finishTour} step={tourStep} onStep={showTourStep} />}
          <AdminNotifications
            items={notifications}
            dismiss={dismissNotification}
            compact={visible}
          />
        </div>
      </SessionProvider>
    </ToastContext.Provider>
  );
}
