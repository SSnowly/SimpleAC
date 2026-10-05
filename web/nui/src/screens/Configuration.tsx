import { ColorPicker } from '../components/ColorPicker';
import { ErrorNote, Lines, Loading, Section, useToast } from '../components/ui';
import { category, modeLabel, ruleTitle } from '../lib/format';
import { useQuery } from '../lib/hooks';
import { t } from '../lib/i18n';
import { type Theme, theme } from '../theme';

/**
 * What the server is actually running, read-only, plus this viewer's own colours. Protection settings live in the
 * files under `configs/`, so they are shown rather than edited here.
 */
export function Configuration({
  colors,
  setColors,
}: {
  colors: Theme;
  setColors: (next: Theme) => void;
}) {
  const query = useQuery('config.get', {});
  const toast = useToast();
  if (query.error && !query.data) return <ErrorNote message={query.error} onRetry={query.reload} />;
  if (!query.data) return <Loading />;
  const { profile, rules, evidence } = query.data;
  const groups = new Map<string, typeof rules>();
  for (const rule of rules) {
    const key = category(rule.key);
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  }

  return (
    <>
      <div className="configuration-grid">
        <Section title={t('config.evidence')}>
          <Lines
            rows={[
              [t('config.storage'), evidence.storage],
              [
                t('config.retention'),
                evidence.retentionDays
                  ? t('config.days', evidence.retentionDays)
                  : t('config.kept_forever'),
              ],
              [t('config.ocr'), evidence.ocrEnabled ? t('common.on') : t('common.off')],
              [
                t('config.ocr_width'),
                evidence.ocrMaxWidth
                  ? t('config.pixels', evidence.ocrMaxWidth)
                  : t('config.original_size'),
              ],
              [
                t('config.text_rules'),
                evidence.ocr
                  ? t('config.rules_summary', evidence.ocr.version, evidence.ocr.rules.length)
                  : '—',
              ],
            ]}
          />
          <p className="muted-note">{t('config.evidence_note')}</p>
        </Section>
        <Section title={t('config.protection', profile.name)}>
          <Lines
            rows={[
              [t('config.profile_version'), profile.version ? `v${String(profile.version)}` : '—'],
              [
                t('config.rules_enabled'),
                t('config.of', rules.filter((rule) => rule.enabled).length, rules.length),
              ],
              [
                t('config.preventing'),
                String(rules.filter((rule) => rule.enabled && rule.mode === 'cancel').length),
              ],
            ]}
          />
        </Section>
        {[...groups.entries()].map(([name, items]) => (
          <Section key={name} title={name}>
            {items.map((rule) => (
              <div className="session-line" key={rule.key}>
                <span>{ruleTitle(rule.key)}</span>
                <strong>{rule.enabled ? modeLabel(rule.mode) : t('common.off')}</strong>
              </div>
            ))}
          </Section>
        ))}
      </div>
      <section className="inset-card">
        <h3>{t('config.appearance')}</h3>
        <p className="muted-note">{t('config.appearance_note')}</p>
        <button
          type="button"
          className="secondary preview-alert"
          onClick={() => toast(t('config.preview_title'), t('config.preview_message'), 'ban')}
        >
          {t('config.preview_button')}
        </button>
        <div className="color-grid">
          {Object.entries(colors).map(([key, value]) => (
            <ColorPicker
              key={key}
              name={key}
              value={value}
              onChange={(next) => setColors({ ...colors, [key]: next })}
            />
          ))}
        </div>
        <button type="button" className="back-link" onClick={() => setColors(theme)}>
          {t('config.restore_theme')}
        </button>
      </section>
    </>
  );
}
