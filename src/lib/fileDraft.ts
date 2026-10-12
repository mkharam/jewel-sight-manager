// صور المسودّات (قطعة جديدة، إضافة مباشرة…) في IndexedDB — localStorage لا يتّسع للصور.
// تُستعاد مع نصوص النموذج إن أغلق الآيفون التطبيق قبل الحفظ، وتُمسح بعد الحفظ.
const DB = "lamaa-file-drafts";
const STORE = "files";
// أطول من نافذة العودة للنصوص بقليل؛ الاستعادة نفسها تتم فقط حين تُستعاد نصوص النموذج.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

type Row = { at: number; files: { name: string; type: string; blob: Blob }[] };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function saveDraftFiles(key: string, files: (File | Blob)[]) {
  try {
    if (!files.length) {
      await run("readwrite", (s) => s.delete(key));
      return;
    }
    const row: Row = {
      at: Date.now(),
      files: files.map((f, i) => ({ name: f instanceof File ? f.name : `photo-${i}.jpg`, type: f.type || "image/jpeg", blob: f })),
    };
    await run("readwrite", (s) => s.put(row, key));
  } catch {
    /* IndexedDB غير متاح — المسودّة اختيارية */
  }
}

export async function loadDraftFiles(key: string): Promise<File[]> {
  try {
    const row = await run<Row | undefined>("readonly", (s) => s.get(key));
    if (!row || Date.now() - row.at > MAX_AGE_MS) return [];
    return row.files.map((f) => new File([f.blob], f.name, { type: f.type }));
  } catch {
    return [];
  }
}

export async function clearDraftFiles(key: string) {
  await saveDraftFiles(key, []);
}
