// وقت التصوير الحقيقي من بيانات EXIF داخل صورة JPEG (DateTimeOriginal). نرتّب به صور جلسة
// التصوير لأن ترتيب الاختيار من المعرض وتاريخ الملف لا يعكسان دائماً ترتيب التصوير.
export async function exifDate(file: Blob): Promise<number | null> {
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < buf.byteLength) {
      const marker = buf.getUint16(off);
      const len = buf.getUint16(off + 2);
      if (marker === 0xffe1 && buf.getUint32(off + 4) === 0x45786966) return parseTiff(buf, off + 10);
      if ((marker & 0xff00) !== 0xff00) return null;
      off += 2 + len;
    }
  } catch { /* صورة بلا EXIF */ }
  return null;
}

function parseTiff(v: DataView, start: number): number | null {
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o: number) => v.getUint16(start + o, le);
  const u32 = (o: number) => v.getUint32(start + o, le);
  const readIfd = (ifd: number, want: number): number | null => {
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === want) return want === 0x8769 ? u32(e + 8) : u32(e + 8);
    }
    return null;
  };
  const exifIfd = readIfd(u32(4), 0x8769);
  if (exifIfd == null) return null;
  const strOff = readIfd(exifIfd, 0x9003);
  if (strOff == null) return null;
  let s = "";
  for (let i = 0; i < 19; i++) s += String.fromCharCode(v.getUint8(start + strOff + i));
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}
