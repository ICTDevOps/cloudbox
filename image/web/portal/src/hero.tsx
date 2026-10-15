// Illustration de la bannière d'accueil : cube isométrique lumineux au-dessus d'une ville de blocs et
// de nuages. SVG dessiné ici (aucune image externe) ; les couleurs suivent l'accent du thème.

// Bloc isométrique : losange du dessus centré en (cx, cy), demi-largeur 0,866·r, hauteur h
function Block({ cx, cy, r, h, top = '#7cc0ff', left = '#1b56c4', right = '#2b74ec', opacity = 1 }: {
  cx: number; cy: number; r: number; h: number; top?: string; left?: string; right?: string; opacity?: number;
}) {
  const w = r * 0.866;
  const t = `${cx},${cy - r / 2} ${cx + w},${cy} ${cx},${cy + r / 2} ${cx - w},${cy}`;
  const l = `${cx - w},${cy} ${cx},${cy + r / 2} ${cx},${cy + r / 2 + h} ${cx - w},${cy + h}`;
  const rt = `${cx + w},${cy} ${cx},${cy + r / 2} ${cx},${cy + r / 2 + h} ${cx + w},${cy + h}`;
  return (
    <g opacity={opacity}>
      <polygon points={l} fill={left} />
      <polygon points={rt} fill={right} />
      <polygon points={t} fill={top} />
    </g>
  );
}

// Fenêtres allumées sur la face droite d'un bloc
function Windows({ cx, cy, r, h }: { cx: number; cy: number; r: number; h: number }) {
  const w = r * 0.866;
  const dots = [];
  for (let row = 8; row < h - 4; row += 9) {
    for (let col = 0.2; col < 0.9; col += 0.3) {
      const x = cx + w * col;
      const y = cy + r / 2 - (r / 2) * col + row;
      dots.push(<rect key={`${row}-${col}`} x={x} y={y} width="3.5" height="2" fill="#bfe1ff" opacity="0.55" />);
    }
  }
  return <g>{dots}</g>;
}

export function HeroArt() {
  return (
    <svg class="hero-art" viewBox="0 0 560 170" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="hero-glow" cx="0.62" cy="0.45" r="0.5">
          <stop offset="0" stop-color="#3b8cff" stop-opacity="0.55" />
          <stop offset="1" stop-color="#3b8cff" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="hero-cloud" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#d9ecff" stop-opacity="0.75" />
          <stop offset="1" stop-color="#9cc8ff" stop-opacity="0.15" />
        </linearGradient>
        <linearGradient id="hero-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#000" stop-opacity="0" />
          <stop offset="0.25" stop-color="#fff" stop-opacity="1" />
        </linearGradient>
        <mask id="hero-mask"><rect width="560" height="170" fill="url(#hero-fade)" /></mask>
      </defs>
      <g mask="url(#hero-mask)">
        <ellipse cx="350" cy="80" rx="230" ry="110" fill="url(#hero-glow)" />
        {/* Ville en arrière-plan */}
        <Block cx={190} cy={70} r={22} h={80} opacity={0.55} />
        <Windows cx={190} cy={70} r={22} h={80} />
        <Block cx={232} cy={52} r={26} h={100} opacity={0.7} />
        <Windows cx={232} cy={52} r={26} h={100} />
        <Block cx={455} cy={40} r={24} h={110} opacity={0.75} />
        <Windows cx={455} cy={40} r={24} h={110} />
        <Block cx={505} cy={62} r={22} h={90} opacity={0.55} />
        <Windows cx={505} cy={62} r={22} h={90} />
        <Block cx={268} cy={96} r={20} h={60} opacity={0.85} />
        <Block cx={420} cy={92} r={22} h={64} opacity={0.9} />
        {/* Cube principal, lumineux */}
        <g class="hero-cube">
          <Block cx={345} cy={52} r={64} h={56} top="#9fd3ff" left="#1f63da" right="#3a8cff" />
          <polygon points="345,20 400,52 345,84 290,52" fill="none" stroke="#e6f4ff" stroke-opacity="0.8" stroke-width="1.5" />
          <Block cx={345} cy={46} r={26} h={22} top="#e3f2ff" left="#5aa6ff" right="#7dbbff" opacity={0.9} />
        </g>
        {/* Petits cubes flottants */}
        <Block cx={260} cy={34} r={10} h={9} opacity={0.9} />
        <Block cx={432} cy={20} r={8} h={7} opacity={0.8} />
        <Block cx={300} cy={128} r={9} h={8} opacity={0.85} />
        {/* Nuages */}
        <g fill="url(#hero-cloud)">
          <ellipse cx="230" cy="160" rx="70" ry="20" />
          <ellipse cx="300" cy="150" rx="55" ry="22" />
          <ellipse cx="380" cy="158" rx="80" ry="22" />
          <ellipse cx="470" cy="150" rx="60" ry="24" />
          <ellipse cx="540" cy="160" rx="60" ry="20" />
        </g>
      </g>
    </svg>
  );
}
