const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(v: string): boolean {
  return HEX.test(v);
}

function toRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Cor de texto (preto ou branco) com melhor contraste sobre `bg`. */
export function onColor(bg: string): string {
  return contrastRatio(bg, '#000000') >= contrastRatio(bg, '#ffffff') ? '#000000' : '#ffffff';
}

function mix(hex: string, target: [number, number, number], amount: number): string {
  const c = toRgb(hex);
  return toHex([c[0] + (target[0] - c[0]) * amount, c[1] + (target[1] - c[1]) * amount, c[2] + (target[2] - c[2]) * amount]);
}

/** Clareia ou escurece `hex` até atingir `min` de contraste contra `bg` (WCAG 1.4.3 / 1.4.11). */
export function ensureContrast(hex: string, bg: string, min: number): string {
  if (contrastRatio(hex, bg) >= min) return hex;
  const towards: [number, number, number] = luminance(bg) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  for (let i = 1; i <= 20; i++) {
    const c = mix(hex, towards, i / 20);
    if (contrastRatio(c, bg) >= min) return c;
  }
  return toHex(towards);
}

export interface DerivedTheme {
  primary: string;
  onPrimary: string;
  accent: string;
  onAccent: string;
  /** Cores ajustadas para uso como texto/ícone sobre fundo escuro e claro. */
  accentOnDark: string;
  accentOnLight: string;
  adjusted: boolean;
}

export const THEME_DARK_BG = '#0A0E14';
export const THEME_LIGHT_BG = '#FFFFFF';
/** Superfícies mais escuras onde o destaque também aparece (cartões e itens ativos): o contraste é garantido contra elas. */
export const THEME_DARK_SURFACE = '#1A2330';
export const THEME_LIGHT_SURFACE = '#E6EAEE';

/** A identidade do organizador nunca pode quebrar a legibilidade: ajustamos em vez de recusar (SPECS §10.5). */
export function deriveTheme(primary: string, accent: string): DerivedTheme {
  const p = isHexColor(primary) ? primary : '#FFB020';
  const a = isHexColor(accent) ? accent : '#FFB020';
  const accentOnDark = ensureContrast(ensureContrast(a, THEME_DARK_BG, 4.5), THEME_DARK_SURFACE, 4.5);
  const accentOnLight = ensureContrast(ensureContrast(a, THEME_LIGHT_BG, 4.5), THEME_LIGHT_SURFACE, 4.5);
  return {
    primary: p,
    onPrimary: onColor(p),
    accent: a,
    onAccent: onColor(a),
    accentOnDark,
    accentOnLight,
    adjusted: p !== primary || a !== accent || accentOnDark !== a || accentOnLight !== a,
  };
}
