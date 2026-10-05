import { useLayoutEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { tourSteps } from '../tour';
export function Tour({
  onFinish,
  step,
  onStep,
}: {
  onFinish: () => void;
  step: number;
  onStep: (step: number) => void;
}) {
  const [rect, setRect] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const current = tourSteps[step];
  useLayoutEffect(() => {
    if (!current) return;
    const target = document.querySelector(current.target);
    if (!target) return;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const update = () => {
      const box = target.getBoundingClientRect();
      setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
    };
  }, [current]);
  if (!current) return null;
  const width = Math.min(330, window.innerWidth - 32);
  const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
  const top =
    rect.top + rect.height + 220 < window.innerHeight
      ? rect.top + rect.height + 14
      : Math.max(16, rect.top - 210);
  return (
    <div
      className="tour-layer"
      role="dialog"
      aria-modal="true"
      aria-label={t('tour_ui.label')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onFinish();
        }
      }}
    >
      <div className="tour-spotlight" style={{ ...rect }} />
      <section className="tour-card" style={{ left, top, width }}>
        <span className="eyebrow">{t('tour_ui.progress', step + 1, tourSteps.length)}</span>
        <h2>{t(current.title)}</h2>
        <p>{t(current.description)}</p>
        <div className="tour-controls">
          <button type="button" className="back-link" onClick={onFinish}>
            {t('tour_ui.skip')}
          </button>
          {step > 0 && (
            <button type="button" className="secondary" onClick={() => onStep(step - 1)}>
              {t('tour_ui.back')}
            </button>
          )}
          <button
            type="button"
            className="primary"
            ref={(element) => {
              element?.focus();
            }}
            onClick={() => (step === tourSteps.length - 1 ? onFinish() : onStep(step + 1))}
          >
            {step === tourSteps.length - 1 ? t('tour_ui.finish') : t('tour_ui.next')}
          </button>
        </div>
      </section>
    </div>
  );
}
