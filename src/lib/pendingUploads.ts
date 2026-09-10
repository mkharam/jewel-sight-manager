/**
 * حفظ الصور المنتظرة في IndexedDB حتى لا تضيع إن أُغلق التطبيق أثناء الرفع.
 *
 * الرفع يجري داخل المتصفح، ومتصفحات الهاتف تُجمّد الصفحة أو تقتل التبويب بالكامل عند
 * الخروج من التطبيق أو ضغط الذاكرة. قبل هذا الملف كان طابور الرفع في الذاكرة فقط، فأي
 * صورة لم يكتمل رفعها تختفي بلا أثر — والموظف لا يعرف أصلاً أيّ القطع ضاعت لأن الصورة
 * جاءت من الكاميرا ولا نسخة منها في مكان آخر.
 *
 * نخزّن الملف نفسه (Blob) لأن صورة الكاميرا لا يمكن استرجاعها بأي طريقة أخرى بعد فقدها.
 * IndexedDB تقبل Blob مباشرة بلا تحويل إلى base64 (التحويل يضخّم الحجم ~33% ويستهلك ذاكرة).
 * السجل يُحذف فور نجاح رفع صورته، فلا يتراكم شيء في الحالة الطبيعية.
 */

const DB_NAME = "mkharam-uploads";
const STORE = "pending";
const DB_VERSION = 1;

export type PendingUpload = {
  id: string;
  file: Blob;
  fileName: string;
  branchId: string | null;
  weightGrams?: number | null;
  barcodeValue?: string | null;
  karat?: string | null;
  itemType?: string | null;
  trayMode?: boolean;
  createdAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

/** كل عمليات التخزين تحسينية — فشلها (وضع التصفح الخاص مثلاً) يجب ألا يمنع الرفع نفسه. */
export async function savePending(item: PendingUpload): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(item));
  } catch { /* تجاهل */ }
}

export async function removePending(id: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(id));
  } catch { /* تجاهل */ }
}

export async function listPending(): Promise<PendingUpload[]> {
  try {
    const all = await tx<PendingUpload[]>("readonly", (s) => s.getAll() as IDBRequest<PendingUpload[]>);
    return (all ?? []).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function countPending(): Promise<number> {
  try {
    return await tx<number>("readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

/**
 * ينظّف السجلات القديمة جداً — صورة بقيت أسبوعاً غالباً تخصّ جهازاً/جلسة انتهت، وإبقاؤها
 * يملأ حصة التخزين بلا فائدة.
 */
export async function prunePending(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  for (const item of await listPending()) {
    if (item.createdAt < cutoff) await removePending(item.id);
  }
}
