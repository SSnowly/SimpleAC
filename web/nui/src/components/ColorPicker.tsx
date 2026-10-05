import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';

function toHsv(hex: string, fallbackHue: number) {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  const hue =
    delta === 0
      ? fallbackHue
      : ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) *
          60 +
          360) %
        360;
  return { h: hue, s: max === 0 ? 0 : delta / max, v: max };
}
function toHex(h: number, s: number, v: number) {
  const channel = (offset: number) => {
    const k = (offset + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}
export function ColorPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'picker' | 'sliders'>('picker');
  const [draft, setDraft] = useState(value);
  const [hue, setHue] = useState(() => toHsv(value, 0).h);
  const lastEmitted = useRef(value);
  const hsv = toHsv(value, hue);
  useEffect(() => {
    setDraft(value);
    if (value !== lastEmitted.current) setHue(toHsv(value, 0).h);
  }, [value]);
  const emit = (next: string) => {
    lastEmitted.current = next;
    onChange(next);
  };
  const pick = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const v = 1 - Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    emit(toHex(hue, s, v));
  };
  const channels = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return (
    <div className="custom-color">
      <button
        type="button"
        className="color-trigger"
        aria-expanded={expanded}
        aria-label={t('color.edit', t(`theme.${name}`))}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{t(`theme.${name}`)}</span>
        <span className="color-swatch" style={{ background: value }} />
        <code>{value}</code>
      </button>
      {expanded && (
        <div className="color-editor">
          <div className="color-mode">
            {(['picker', 'sliders'] as const).map((option) => (
              <button
                type="button"
                key={option}
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
              >
                {option === 'picker' ? t('color.picker') : t('color.sliders')}
              </button>
            ))}
          </div>
          {mode === 'picker' ? (
            <>
              <button
                type="button"
                className="color-plane"
                style={{ backgroundColor: `hsl(${hue} 100% 50%)` }}
                aria-label={t('color.area', t(`theme.${name}`))}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  pick(event);
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
                    return;
                  event.preventDefault();
                  const step = event.shiftKey ? 0.1 : 0.01;
                  const s = Math.max(
                    0,
                    Math.min(
                      1,
                      hsv.s +
                        (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
                    ),
                  );
                  const v = Math.max(
                    0,
                    Math.min(
                      1,
                      hsv.v +
                        (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0),
                    ),
                  );
                  emit(toHex(hue, s, v));
                }}
              >
                <span
                  className="color-cursor"
                  style={{
                    left: `${hsv.s * 100}%`,
                    top: `${(1 - hsv.v) * 100}%`,
                    background: value,
                  }}
                />
              </button>
              <input
                className="hue-strip"
                aria-label={t('color.hue', t(`theme.${name}`))}
                type="range"
                min="0"
                max="359"
                value={Math.round(hue)}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setHue(next);
                  emit(toHex(next, hsv.s, hsv.v));
                }}
              />
            </>
          ) : (
            <>
              <div className="color-preview" style={{ background: value }} />
              {channels.map((channel, index) => (
                <label className="channel-control" key={['red', 'green', 'blue'][index]}>
                  <span>{t(`color.${['red', 'green', 'blue'][index] ?? 'red'}`)}</span>
                  <input
                    type="range"
                    min="0"
                    max="255"
                    value={channel}
                    aria-label={t(
                      'color.channel',
                      t(`theme.${name}`),
                      t(`color.${['red', 'green', 'blue'][index] ?? 'red'}`),
                    )}
                    onChange={(event) => {
                      const next = channels.map((item, position) =>
                        position === index ? Number(event.target.value) : item,
                      );
                      const hex = `#${next.map((item) => item.toString(16).padStart(2, '0')).join('')}`;
                      setHue(toHsv(hex, hue).h);
                      emit(hex);
                    }}
                  />
                  <output>{channel}</output>
                </label>
              ))}
            </>
          )}
          <label className="hex-field">
            HEX
            <input
              aria-label={t('color.hex', t(`theme.${name}`))}
              value={draft}
              maxLength={7}
              spellCheck={false}
              onChange={(event) => {
                setDraft(event.target.value);
                if (/^#[0-9a-f]{6}$/i.test(event.target.value)) {
                  setHue(toHsv(event.target.value, hue).h);
                  emit(event.target.value);
                }
              }}
              onBlur={() => setDraft(value)}
            />
          </label>
          <button type="button" className="back-link" onClick={() => setExpanded(false)}>
            {t('color.done')}
          </button>
        </div>
      )}
    </div>
  );
}
