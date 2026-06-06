export type LabelOutlineMedia = {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  shape: string;
  cornerRadiusMm: number;
};

export function renderLabelOutlineSvg(media: LabelOutlineMedia) {
  const strokeWidth = 0.35;
  const inset = strokeWidth / 2;
  const innerWidth = media.widthMm - strokeWidth;
  const innerHeight = media.heightMm - strokeWidth;

  if (media.shape === 'round') {
    const radius = Math.min(innerWidth, innerHeight) / 2;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${media.widthMm}mm" height="${media.heightMm}mm" viewBox="0 0 ${media.widthMm} ${media.heightMm}" role="img" aria-label="${escapeSvgText(media.name)} outline">
  <rect width="${media.widthMm}" height="${media.heightMm}" fill="#f8fbfd" />
  <ellipse cx="${media.widthMm / 2}" cy="${media.heightMm / 2}" rx="${radius}" ry="${radius}" fill="#ffffff" stroke="#07101f" stroke-width="${strokeWidth}" />
</svg>`;
  }

  const radius = Math.min(
    Math.max(0, media.cornerRadiusMm - inset),
    innerWidth / 2,
    innerHeight / 2,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${media.widthMm}mm" height="${media.heightMm}mm" viewBox="0 0 ${media.widthMm} ${media.heightMm}" role="img" aria-label="${escapeSvgText(media.name)} outline">
  <rect width="${media.widthMm}" height="${media.heightMm}" fill="#f8fbfd" />
  <rect x="${inset}" y="${inset}" width="${innerWidth}" height="${innerHeight}" rx="${radius}" ry="${radius}" fill="#ffffff" stroke="#07101f" stroke-width="${strokeWidth}" />
</svg>`;
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
