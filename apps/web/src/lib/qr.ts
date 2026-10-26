/**
 * Gerador de QR Code mínimo (modo byte, correção de erros M, versões 1 a 10, até 213 bytes).
 * Suficiente para o endereço do link do juiz. Verificado contra um decodificador independente nos testes.
 */
const ECC_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const QR_MAX_BYTES = 213;

function rawModules(v: number): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
}
const dataCodewords = (v: number): number => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK_M[v - 1]! * BLOCKS_M[v - 1]!;

// Aritmética em GF(256), polinômio 0x11D
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const gmul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

function rsDivisor(deg: number): number[] {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ gmul(poly[j]!, 1);
      next[j + 1] = (next[j + 1] ?? 0) ^ gmul(poly[j]!, EXP[i]!);
    }
    poly = next;
  }
  return poly.slice(1);
}
function rsRemainder(data: number[], divisor: number[]): number[] {
  const rem = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const f = b ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < divisor.length; i++) rem[i] = rem[i]! ^ gmul(divisor[i]!, f);
  }
  return rem;
}

function bchBits(data: number, gen: number, bits: number): number {
  let r = data;
  for (let i = 0; i < bits; i++) r = (r << 1) ^ ((r >>> (bits === 10 ? 9 : 11)) * gen);
  return r;
}

/** Devolve a matriz de módulos (true = escuro). Lança se o texto não couber. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  while (ver <= 10 && bytes.length + 2 > dataCodewords(ver) - (ver >= 10 ? 0 : 0)) ver++;
  if (ver > 10) throw new Error('Texto longo demais para o QR.');
  const size = ver * 4 + 17;
  const cap = dataCodewords(ver);

  // dados: modo byte (0100), contagem (8 bits até v9; 16 bits na v10), bytes, terminador e preenchimento
  const bits: number[] = [];
  const put = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver >= 10 ? 16 : 8);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; words.length < cap; pad ^= 0xec ^ 0x11) words.push(pad);

  // blocos + correção de erros
  const nb = BLOCKS_M[ver - 1]!;
  const eccLen = ECC_PER_BLOCK_M[ver - 1]!;
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = nb - (raw % nb);
  const shortLen = Math.floor(raw / nb);
  const div = rsDivisor(eccLen);
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const d = words.slice(k, k + len);
    k += len;
    blocks.push(d);
    eccs.push(rsRemainder(d, div));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[nb - 1]!.length; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < eccLen; i++) for (const e of eccs) out.push(e[i]!);

  // desenho
  const mod: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setF = (x: number, y: number, dark: boolean) => { mod[y]![x] = dark; fn[y]![x] = true; };
  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      setF(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const pos: number[] = [];
    for (let p = size - 7; pos.length < n - 1; p -= step) pos.unshift(p);
    pos.unshift(6);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(pos[i]! + dx, pos[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // reserva das áreas de formato e versão
  const drawFormat = (mask: number) => {
    const data = (0 << 3) | mask; // M = 00
    const f = ((data << 10) | (bchBits(data, 0x537, 10) & 0x3ff)) ^ 0x5412;
    const bit = (i: number) => ((f >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
    setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
    setF(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    const v = (ver << 12) | (bchBits(ver, 0x1f25, 12) & 0xfff);
    for (let i = 0; i < 18; i++) {
      const dark = ((v >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setF(a, b, dark); setF(b, a, dark);
    }
  }
  // dados em zigue-zague
  const dataBits: boolean[] = [];
  for (const w of out) for (let i = 7; i >= 0; i--) dataBits.push(((w >>> i) & 1) !== 0);
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!fn[y]![x] && k < dataBits.length) mod[y]![x] = dataBits[k++]!;
    }
  }

  // escolhe a máscara de menor penalidade
  const masks: Array<(x: number, y: number) => boolean> = [
    (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const t = mod.map((r) => r.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y]![x] && masks[m]!(x, y)) t[y]![x] = !t[y]![x];
    // reaplica o formato com esta máscara
    const saved = mod; // drawFormat escreve em `mod`; troca temporária
    const backup = saved.map((r) => r.slice());
    for (let y = 0; y < size; y++) mod[y] = t[y]!;
    drawFormat(m);
    const grid = mod.map((r) => r.slice());
    for (let y = 0; y < size; y++) mod[y] = backup[y]!;
    const s = penalty(grid);
    if (s < bestScore) { bestScore = s; best = grid; }
  }
  return best as boolean[][];
}

function penalty(g: boolean[][]): number {
  const n = g.length;
  let score = 0;
  const run = (line: boolean[]) => {
    let s = 0, len = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) len++;
      else { if (len >= 5) s += len - 2; len = 1; }
    }
    return s;
  };
  const col = (x: number) => g.map((r) => r[x]!);
  for (let i = 0; i < n; i++) score += run(g[i]!) + run(col(i));
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = g[y]![x];
    if (c === g[y]![x + 1] && c === g[y + 1]![x] && c === g[y + 1]![x + 1]) score += 3;
  }
  const pat = (line: boolean[]) => {
    let s = 0;
    const a = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], b = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let i = 0; i + 11 <= line.length; i++) {
      const w = line.slice(i, i + 11).map((v) => (v ? 1 : 0));
      if (w.every((v, j) => v === a[j]) || w.every((v, j) => v === b[j])) s += 40;
    }
    return s;
  };
  for (let i = 0; i < n; i++) score += pat(g[i]!) + pat(col(i));
  const dark = g.reduce((s, r) => s + r.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/** SVG do QR com a "zona de silêncio" de 4 módulos. */
export function qrSvgPath(text: string): { size: number; d: string } {
  const g = qrMatrix(text);
  const q = 4;
  let d = '';
  g.forEach((row, y) => row.forEach((c, x) => { if (c) d += `M${x + q} ${y + q}h1v1h-1z`; }));
  return { size: g.length + q * 2, d };
}
