// قارئ مخصّص لوجه بيانات الوسم (BRANCH/KARAT/TYPE/WEIGHT) — يعمل محلياً بالكامل في
// المتصفح عبر Tesseract.js (OCR) بدل الاعتماد فقط على نداء شبكة للذكاء الاصطناعي، تماماً
// كما decodeBarcodeFromImage.ts قارئ مخصّص لوجه الباركود. أسرع (لا رحلة شبكة)، يعمل بلا
// اتصال إنترنت، ولا يتأثر بازدحام مزوّدات الذكاء الاصطناعي — لكنه أقل دقة من الرؤية
// الاصطناعية في الصور غير الواضحة، لذا يبقى نداء analyze-tag احتياطياً في LiveAdd عندما
// لا يجد هذا القارئ شيئاً.
//
// ملاحظة من الاختبار الفعلي على وسوم حقيقية: OCR محلي بسيط كهذا كثيراً ما يُشوّه نص
// التسميات نفسها ("BRANCH"، "KARAT"...) بينما يقرأ القيم المجاورة لها بدقة أفضل نسبياً
// (مثال حقيقي: "Balen : o1" بدل "BRANCH : 01"، لكن "94.990" قريبة جداً من "94.90"
// الفعلية). لذا لا نعتمد إطلاقاً على مطابقة نص التسمية، بل نبحث في النص كاملاً عن
// نمط شكل القيمة نفسها (رقم عشري للوزن، رقمان يتبعهما K للعيار...).
import { createWorker } from "tesseract.js";

export type LocalTagInfo = {
  branch_code: string | null;
  karat_raw: string | null;
  type_raw: string | null;
  weight_grams: number | null;
};

async function toPreprocessedCanvas(source: File | Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });

    // نكبّر قليلاً إن كانت الصورة صغيرة، ونحوّلها لتدرج رمادي — بلا عتبة ثنائية صارمة،
    // فالتجربة الفعلية أظهرت أن التدرج الرمادي وحده يُعطي OCR أدق من التحويل لأبيض/أسود
    // صريح (الذي يفقد تفاصيل حواف الخط النقطي الرفيعة).
    const scale = img.naturalWidth < 900 ? 900 / img.naturalWidth : 1;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = gray;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// نطاق وزن معقول لقطعة مجوهرات — يستبعد أرقاماً عشوائية أخرى قد يلتقطها OCR بالخطأ
// (كرقم فرع أو جزء من رمز آخر) ويرفض قراءات غير منطقية بدل تمريرها كوزن خاطئ.
const MIN_PLAUSIBLE_WEIGHT = 0.1;
const MAX_PLAUSIBLE_WEIGHT = 500;

function parseInfoText(text: string): LocalTagInfo {
  // الوزن: الحقل الوحيد الذي يحتوي فاصلة عشرية — نمط مميّز جداً لا يتشابه مع أي حقل آخر
  // على الوسم، فنبحث عنه مباشرة بغض النظر عن وضوح تسمية "WEIGHT" نفسها. نشترط رقمين
  // صحيحين على الأقل قبل الفاصلة تحديداً — تجربة فعلية أظهرت أن OCR قد يُسقط أول رقم
  // من الجزء الصحيح (مثال حقيقي: "94.90" تُقرأ "4.990")، فقبول رقم صحيح من خانة واحدة
  // فقط يعني تمرير وزن خاطئ بثقة كاذبة بدل الاعتراف بعدم اليقين — أخطر بكثير من عدم
  // إيجاد شيء إطلاقاً (يبقى نداء الذكاء الاصطناعي احتياطياً في هذه الحالة).
  let weight: number | null = null;
  for (const m of text.matchAll(/\b(\d{2,4})[.,](\d{1,3})\b/g)) {
    const v = parseFloat(`${m[1]}.${m[2]}`);
    if (!isNaN(v) && v >= MIN_PLAUSIBLE_WEIGHT && v <= MAX_PLAUSIBLE_WEIGHT) {
      weight = v;
      break;
    }
  }

  // العيار: رقمان (18 أو 21 عملياً في مخزون المحل) متبوعان مباشرة بحرف K (بأي حالة أحرف،
  // وأحياناً حرف إضافي بعده مثل "18KB") — نمط أدق من محاولة قراءة تسمية "KARAT" نفسها.
  const karatMatch = text.match(/\b(18|21)\s*[kK][a-zA-Z]?\b/) ?? text.match(/\b(18|21)[kK]\d\b/);
  const karat = karatMatch ? karatMatch[0].replace(/\s+/g, "") : null;

  // رمز الفرع: رقمان في بداية السطر الأول عادة (غير حرج — لا يُستخدم حالياً في الحفظ).
  const branch = text.match(/^\s*(\d{2})\b/m)?.[1] ?? null;

  // النوع: حرفان إلى ثلاثة أحرف كبيرة منعزلة على سطرها الخاص تقريباً — أقل الحقول ثباتاً
  // في القراءة فنتركه اختيارياً تماماً بلا تأثير على النتيجة الإجمالية.
  const type = text.match(/\b([A-Z]{2,3})\b/)?.[1] ?? null;

  return {
    branch_code: branch,
    karat_raw: karat,
    type_raw: type,
    weight_grams: weight,
  };
}

let workerPromise: ReturnType<typeof createWorker> | null = null;
async function getWorker() {
  if (!workerPromise) workerPromise = createWorker("eng");
  return workerPromise;
}

/**
 * يقرأ وجه بيانات الوسم محلياً بلا أي اتصال شبكة. يُعيد null إن لم يتعرّف على الوزن أو
 * العيار (الحقلان الوحيدان ذوا النمط المميّز بما يكفي للثقة بهما) — عندها يُستحسن
 * اللجوء لقراءة الذكاء الاصطناعي كاحتياط.
 */
export async function readInfoTagLocally(source: File | Blob): Promise<LocalTagInfo | null> {
  const canvas = await toPreprocessedCanvas(source);
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  const parsed = parseInfoText(data.text || "");
  const confident = parsed.weight_grams != null || parsed.karat_raw != null;
  return confident ? parsed : null;
}
