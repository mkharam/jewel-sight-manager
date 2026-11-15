// تحديد مكان الباركود داخل صورة كبيرة قبل قراءته: ليبل صُوّر من بعيد يصير بضع مئات من البكسلات
// في صورة 12 ميغابكسل، والقارئ على الصورة كاملة يصغّرها فيضيع. الباركود الخطي له بصمة واضحة:
// حواف كثيفة جداً وكلها بنفس الاتجاه. نقسّم الصورة لمربعات ونحسب لكل مربع «تنسور البنية»
// (Structure Tensor): كثافة الحواف + مدى توحّد اتجاهها. المجوهرات والأحجار حوافها كثيفة لكن في
// كل الاتجاهات فتُستبعد، والستائر والحواف المفردة موحّدة الاتجاه لكن قليلة الكثافة فتُستبعد.
// الناتج: مناطق مرشّحة مع زاوية ميلها، ليُقصّ كل منها ويُعدَّل ميله ويُكبَّر ثم يُقرأ.

export type BarcodeRegion = {
  /** مركز المنطقة ببكسلات الصورة */
  cx: number; cy: number;
  /** ضلع المربع الذي يحتوي الباركود كاملاً */
  size: number;
  /** زاوية اتجاه المسح (عمودي على الأشرطة) بالراديان */
  angle: number;
  score: number;
};

const BLOCK = 24;

export function locateBarcodes(rgba: Uint8ClampedArray, width: number, height: number, maxRegions = 6): BarcodeRegion[] {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;

  const bw = Math.floor(width / BLOCK), bh = Math.floor(height / BLOCK);
  const sxx = new Float64Array(bw * bh), syy = new Float64Array(bw * bh), sxy = new Float64Array(bw * bh);
  const strong = new Uint16Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let xx = 0, yy = 0, xy = 0, n = 0;
      const y0 = Math.max(1, by * BLOCK), y1 = Math.min(height - 1, (by + 1) * BLOCK);
      const x0 = Math.max(1, bx * BLOCK), x1 = Math.min(width - 1, (bx + 1) * BLOCK);
      for (let y = y0; y < y1; y++) {
        let i = y * width + x0;
        for (let x = x0; x < x1; x++, i++) {
          const gx = gray[i + 1] - gray[i - 1];
          const gy = gray[i + width] - gray[i - width];
          xx += gx * gx; yy += gy * gy; xy += gx * gy;
          if (Math.abs(gx) + Math.abs(gy) > 36) n++;
        }
      }
      const b = by * bw + bx;
      sxx[b] = xx; syy[b] = yy; sxy[b] = xy; strong[b] = n;
    }
  }

  // مربع مرشّح: حواف قوية في ربع بكسلاته على الأقل، واتجاهها موحّد.
  const cand = new Uint8Array(bw * bh);
  const area = BLOCK * BLOCK;
  for (let b = 0; b < cand.length; b++) {
    const e = sxx[b] + syy[b];
    if (!e || strong[b] / area < 0.22) continue;
    const d = sxx[b] - syy[b];
    const coherence = Math.sqrt(d * d + 4 * sxy[b] * sxy[b]) / e;
    if (coherence > 0.55) cand[b] = 1;
  }

  // تجميع المربعات المتجاورة في مناطق.
  const seen = new Uint8Array(bw * bh);
  const regions: BarcodeRegion[] = [];
  const stack: number[] = [];
  for (let start = 0; start < cand.length; start++) {
    if (!cand[start] || seen[start]) continue;
    let minX = bw, maxX = 0, minY = bh, maxY = 0, n = 0, xx = 0, yy = 0, xy = 0;
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const b = stack.pop()!;
      const bx = b % bw, by = (b - bx) / bw;
      n++; xx += sxx[b]; yy += syy[b]; xy += sxy[b];
      if (bx < minX) minX = bx; if (bx > maxX) maxX = bx; if (by < minY) minY = by; if (by > maxY) maxY = by;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = bx + dx, ny = by + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const nb = ny * bw + nx;
        if (cand[nb] && !seen[nb]) { seen[nb] = 1; stack.push(nb); }
      }
    }
    if (n < 2) continue;
    const e = xx + yy, d = xx - yy;
    const coherence = Math.sqrt(d * d + 4 * xy * xy) / e;
    if (coherence < 0.5) continue; // مربعات متجاورة باتجاهات مختلفة — ليست باركوداً واحداً
    const w = (maxX - minX + 1) * BLOCK, h = (maxY - minY + 1) * BLOCK;
    regions.push({
      cx: (minX + maxX + 1) * BLOCK / 2,
      cy: (minY + maxY + 1) * BLOCK / 2,
      size: Math.min(2400, Math.max(w, h) * 1.5 + BLOCK * 3),
      angle: 0.5 * Math.atan2(2 * xy, d),
      score: n * coherence,
    });
  }
  return regions.sort((a, b) => b.score - a.score).slice(0, maxRegions);
}
