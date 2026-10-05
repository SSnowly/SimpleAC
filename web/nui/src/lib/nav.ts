export const screens = [
  'Overview',
  'Players',
  'Detections',
  'Cases',
  'Evidence',
  'Actions',
  'Exceptions',
  'Profiles',
  'Audit',
] as const;

export type Screen = (typeof screens)[number] | 'Configuration' | 'Panel access';

export type DetailKind = 'player' | 'detection' | 'case' | 'capture' | 'profile';

export interface Route {
  screen: Screen;
  detail?: { kind: DetailKind; id: string };
}

/** Which screen a record belongs to, so opening it from anywhere highlights the right tab. */
export const screenOf: Record<DetailKind, Screen> = {
  player: 'Players',
  detection: 'Detections',
  case: 'Cases',
  capture: 'Evidence',
  profile: 'Profiles',
};

export interface Nav {
  route: Route;
  /** Opens a record, keeping the way back to where the user was. */
  open: (kind: DetailKind, id: string) => void;
  go: (screen: Screen) => void;
  back: () => void;
  canGoBack: boolean;
}

/** Maps the type a lookup returns (`SAC-PLY`, ...) to something the panel can open. */
export function kindForLookup(type: string): DetailKind | null {
  switch (type) {
    case 'SAC-PLY':
      return 'player';
    case 'SAC-DET':
      return 'detection';
    case 'SAC-CASE':
      return 'case';
    case 'SAC-CAP':
      return 'capture';
    case 'SAC-PRF':
      return 'profile';
    default:
      return null;
  }
}
