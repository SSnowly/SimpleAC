declare global {
  interface Window {
    /** Injected by the FiveM client into every NUI page. Absent in a regular browser. */
    invokeNative?: unknown;
  }
  /** Injected by the FiveM client into every NUI page; the name of this resource. */
  function GetParentResourceName(): string;
}

/**
 * The game's native marker selects NUI. Production outside the game uses authenticated HTTP; Vite's root
 * serves fixtures, while its /panel/ path previews browser mode.
 */
export const isGame: boolean = typeof window.invokeNative === 'function';
export const isBrowser: boolean =
  !isGame && (!import.meta.env.DEV || /\/panel\/?$/.test(window.location.pathname));
export const isDev: boolean = !isGame && !isBrowser;
