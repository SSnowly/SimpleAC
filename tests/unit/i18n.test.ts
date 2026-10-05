import { afterEach, describe, expect, it } from 'vitest';
import { hasString, setStrings, t } from '../../web/nui/src/lib/i18n';

afterEach(() => setStrings(undefined));

describe('panel translation', () => {
  it('reads the bundled English by default', () => {
    expect(t('common.loading')).toBe('Loading…');
    expect(t('players.last_seen', '3m ago')).toBe('Last seen 3m ago');
  });

  it('lets the server language replace English, and keeps English for anything it lacks', () => {
    setStrings({ 'common.loading': 'Betöltés…' });
    expect(t('common.loading')).toBe('Betöltés…');
    expect(t('common.try_again')).toBe('Try again');
  });

  it('formats %s and %d with the arguments in order, and %% as a percent sign', () => {
    setStrings({ 'overview.evidence_detail': '%s találat, %s tiltás (100%%)' });
    expect(t('overview.evidence_detail', 4, 2)).toBe('4 találat, 2 tiltás (100%)');
  });

  it('shows the key itself for text nobody wrote', () => {
    expect(t('nothing.here')).toBe('nothing.here');
    expect(hasString('nothing.here')).toBe(false);
    expect(hasString('common.loading')).toBe(true);
  });
});
