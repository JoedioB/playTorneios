/** Reduz a imagem escolhida para caber no torneio (até 256 px, ~90 KB) e devolve um data URL. */
export async function resizeLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use uma imagem PNG, JPEG ou WebP.');
  if (file.size > 5_000_000) throw new Error('A imagem é muito grande (máximo de 5 MB).');
  const bmp = await createImageBitmap(file);
  for (const max of [256, 192, 128, 96]) {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png');
    if (url.length <= 85_000) return url;
  }
  throw new Error('Não foi possível reduzir esta imagem. Tente uma versão mais simples.');
}
