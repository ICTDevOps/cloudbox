// Icônes du portail : SVG intégrés (aucune ressource externe), trait en currentColor, grille 24×24.
// Les icônes d'outils (Azure, Microsoft 365, Kubernetes…) sont des évocations simplifiées, pas les
// logos officiels.
import { render, type JSX } from 'preact';

const STROKE: Record<string, JSX.Element> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  gear: <><path d="M19.22 10.39 L21.52 10.76 L21.52 13.24 L19.22 13.61 L18.25 15.96 L19.61 17.85 L17.85 19.61 L15.96 18.25 L13.61 19.22 L13.24 21.52 L10.76 21.52 L10.39 19.22 L8.04 18.25 L6.15 19.61 L4.39 17.85 L5.75 15.96 L4.78 13.61 L2.48 13.24 L2.48 10.76 L4.78 10.39 L5.75 8.04 L4.39 6.15 L6.15 4.39 L8.04 5.75 L10.39 4.78 L10.76 2.48 L13.24 2.48 L13.61 4.78 L15.96 5.75 L17.85 4.39 L19.61 6.15 L18.25 8.04Z" /><circle cx="12" cy="12" r="3" /></>,
  logout: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l-4-4 4-4M6 12h10" /></>,
  chevronsLeft: <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />,
  chevronsRight: <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />,
  hash: <path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16" />,
  layers: <><path d="M12 3 2.5 8 12 13l9.5-5z" /><path d="M2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5" /></>,
  text: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  terminal: <><rect x="2.5" y="4" width="19" height="16" rx="2" /><path d="M7 9.5l3 2.5-3 2.5M12.5 15H17" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" /></>,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 10.8l7.6-4.5M8.2 13.2l7.6 4.5" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-2s-.8-1.5-.8-2.5S14 15 15 15h2.5A3.5 3.5 0 0 0 21 11.5C21 6.8 17 3 12 3z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="14.5" cy="7" r="1" /></>,
  monitor: <><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>,
  maximize: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16" /></>,
  restore: <><rect x="4" y="8" width="12" height="12" rx="2" /><path d="M8 8V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H16" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  send: <><path d="M21 3 10 14" /><path d="M21 3l-7 18-4-7-7-4z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.5" /></>,
  wrench: <path d="M14.5 6.5a4 4 0 0 0 5 5L21 13l-1.5 1.5-1.5-1.5a4 4 0 0 1-5-5L4.5 16.5a2 2 0 1 0 3 3L16 11" />,
  cloud: <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 17.8 9.5 4.25 4.25 0 0 1 17.5 18z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>,
  memory: <><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5" /><rect x="9" y="9" width="6" height="6" rx="1" /></>,
  context: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></>,
};

export type IconName = keyof typeof STROKE | 'cube' | 'sparkle' | 'azure' | 'm365' | 'kubernetes' | 'iac' | 'powershell'
  | 'pwsh' | 'bash' | 'code' | 'webui' | 'extensions';

// Icônes pleines ou en couleur (marques évoquées, panneaux)
function special(name: IconName): JSX.Element | null {
  switch (name) {
    case 'cube':
      return (
        <>
          <path d="M12 2.5 3.5 7.2v9.6L12 21.5l8.5-4.7V7.2z" fill="currentColor" opacity="0.18" />
          <path d="M12 2.5 3.5 7.2v9.6L12 21.5l8.5-4.7V7.2zM3.5 7.2 12 12l8.5-4.8M12 12v9.5" />
        </>
      );
    case 'sparkle':
      return (
        <>
          <path d="M11 3c.6 3.9 2.6 6 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5C8.4 9 10.4 6.9 11 3z" fill="currentColor" stroke="none" />
          <path d="M18.5 14c.3 1.8 1.2 2.7 3 3-1.8.3-2.7 1.2-3 3-.3-1.8-1.2-2.7-3-3 1.8-.3 2.7-1.2 3-3z" fill="currentColor" stroke="none" />
        </>
      );
    case 'azure':
      return (
        <>
          <path d="M9.5 3.5h5L8 20.5H2.5z" fill="#3b9bf5" stroke="none" />
          <path d="M14.8 9.5 21.5 20.5H10.2l5-2.7-2.6-4.6z" fill="#1a6fd6" stroke="none" />
        </>
      );
    case 'm365':
      return (
        <>
          <rect x="3" y="3" width="8.5" height="8.5" fill="#f25022" stroke="none" />
          <rect x="12.5" y="3" width="8.5" height="8.5" fill="#7fba00" stroke="none" />
          <rect x="3" y="12.5" width="8.5" height="8.5" fill="#00a4ef" stroke="none" />
          <rect x="12.5" y="12.5" width="8.5" height="8.5" fill="#ffb900" stroke="none" />
        </>
      );
    case 'kubernetes':
      return (
        <>
          <path d="M12 2.5 20 6.4l2 8.7-5.6 7H7.6L2 15.1l2-8.7z" fill="#326ce5" stroke="none" />
          <circle cx="12" cy="12.5" r="3.6" stroke="#fff" stroke-width="1.5" />
          <path d="M12 6v3M12 16v3M6.3 9.8l2.8 1.4M14.9 13.8l2.8 1.4M6.3 15.2l2.8-1.4M14.9 11.2l2.8-1.4" stroke="#fff" stroke-width="1.5" />
        </>
      );
    case 'iac':
      return (
        <>
          <path d="M9 4.5 14.5 7.7v6.3L9 10.8z" fill="#8a5cf6" stroke="none" />
          <path d="M15.5 8.2 21 5v6.4l-5.5 3.2z" fill="#6d3fd9" stroke="none" />
          <path d="M2.5 1.5 8 4.7V11L2.5 7.8zM9 11.8l5.5 3.2v6.4L9 18.2z" fill="#8a5cf6" stroke="none" />
        </>
      );
    case 'powershell':
    case 'pwsh':
      return (
        <>
          <rect x="2" y="3.5" width="20" height="17" rx="3" fill="currentColor" stroke="none" />
          <path d="M6.5 8.5l4 3.5-4 3.5M12 16h5.5" stroke="#fff" stroke-width="2" />
        </>
      );
    case 'bash':
      return (
        <>
          <rect x="2" y="3.5" width="20" height="17" rx="3" fill="currentColor" stroke="none" />
          <path d="M8 7.5v9M10 9.3c-.5-.6-1.2-.9-2-.9-1.3 0-2.1.7-2.1 1.7 0 2.3 4.3 1.3 4.3 3.7 0 1-.9 1.8-2.2 1.8-.9 0-1.7-.4-2.2-1M12.5 16h5" stroke="#fff" stroke-width="1.8" />
        </>
      );
    case 'code':
      return (
        <>
          <rect x="2" y="3.5" width="20" height="17" rx="3" fill="currentColor" stroke="none" />
          <path d="M9.5 8C8 8 8 9 8 10.2c0 1.1-.7 1.8-1.7 1.8 1 0 1.7.7 1.7 1.8C8 15 8 16 9.5 16M14.5 8c1.5 0 1.5 1 1.5 2.2 0 1.1.7 1.8 1.7 1.8-1 0-1.7.7-1.7 1.8 0 1.2 0 2.2-1.5 2.2" stroke="#fff" stroke-width="1.8" />
        </>
      );
    case 'webui':
      return special('globe' as IconName);
    case 'extensions':
      return (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="14" y="2.5" width="7" height="7" rx="1.5" transform="rotate(15 17.5 6)" />
        </>
      );
    default:
      return STROKE[name] ?? null;
  }
}

export function Icon({ name, size = 18, class: className = '', title }: { name: IconName; size?: number; class?: string; title?: string }) {
  return (
    <svg class={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {special(name)}
    </svg>
  );
}

// Version DOM, pour les composants Dockview écrits sans Preact (rendu synchrone, puis détaché)
export function iconElement(name: IconName, size = 16, className = ''): Element {
  const holder = document.createElement('div');
  render(<Icon name={name} size={size} class={className} />, holder);
  const svg = holder.firstElementChild!;
  svg.remove();
  return svg;
}

// Drapeaux du choix de langue (les drapeaux emoji ne s'affichent pas sous Windows)
export function Flag({ lang }: { lang: 'fr' | 'en' }) {
  return lang === 'fr' ? (
    <svg class="flag" width="22" height="15" viewBox="0 0 3 2" aria-hidden="true">
      <rect width="1" height="2" fill="#0055a4" /><rect x="1" width="1" height="2" fill="#fff" /><rect x="2" width="1" height="2" fill="#ef4135" />
    </svg>
  ) : (
    <svg class="flag" width="22" height="15" viewBox="0 0 60 40" aria-hidden="true">
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0l60 40M60 0 0 40" stroke="#fff" stroke-width="8" />
      <path d="M0 0l60 40M60 0 0 40" stroke="#c8102e" stroke-width="3" />
      <path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="12" />
      <path d="M30 0v40M0 20h60" stroke="#c8102e" stroke-width="7" />
    </svg>
  );
}
