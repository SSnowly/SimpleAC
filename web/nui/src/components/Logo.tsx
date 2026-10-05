import { useId } from 'react';
import { t } from '../lib/i18n';
export function Logo() {
  const mask = useId();
  return (
    <svg
      viewBox="0 0 1000 600"
      fill="none"
      role="img"
      aria-label={t('brand.logo')}
      className="simpleac-logo"
    >
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="600">
          <path fill="#fff" d="M0 0h1000v600H0z" />
          <path fill="#000" d="M20 475 965 15v24L20 499z" />
        </mask>
      </defs>
      <g mask={`url(#${mask})`}>
        <path
          fill="var(--accent)"
          fillRule="evenodd"
          d="M572 65h119l246 470H795l-54-104H510l-42 104H339L572 65Zm59 153-67 134h135l-68-134Z"
        />
        <path
          fill="var(--text)"
          d="M236 65h306l-69 123H246c-30 0-47 15-47 36 0 23 18 37 48 37h91c110 0 177 50 177 135 0 83-65 139-170 139H47l79-120h218c28 0 47-14 47-36 0-22-18-35-47-35h-94c-108 0-177-53-177-136C73 125 139 65 236 65Z"
        />
      </g>
    </svg>
  );
}
