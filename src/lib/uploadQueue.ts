// مخزن عام (خارج React) لطابور الرفع — يبقى حياً عند التنقّل بين صفحات التطبيق
// لأنه لا يرتبط بدورة حياة أي مكوّن. الوعود (promises) الفعلية للرفع/الحفظ تستمر
// بالعمل في الخلفية بغض النظر عمّا إذا كانت صفحة الرفع معروضة حالياً أم لا.
import { useEffect, useState } from "react";

// exists = القطعة موجودة قبل (نفس الباركود) فما تنزلتش مرة ثانية — مش فشل.
export type QueueItemStatus = "uploading" | "analyzing" | "saving" | "done" | "exists" | "error";

export type QueueItem = {
  id: string;
  previewUrl: string;
  label: string;
  status: QueueItemStatus;
  message?: string;
  /** للحالة exists: القطعة الموجودة قبل — باش الموظف يفتحها. */
  productId?: string;
};

/** لسه قاعد يترفع/يتحلّل/يتحفظ. */
export const isUploading = (it: QueueItem) => it.status === "uploading" || it.status === "analyzing" || it.status === "saving";

type Listener = () => void;

class UploadQueueStore {
  private items: QueueItem[] = [];
  private listeners = new Set<Listener>();

  getItems() {
    return this.items;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  add(item: QueueItem) {
    this.items = [item, ...this.items];
    this.notify();
  }

  update(id: string, patch: Partial<QueueItem>) {
    this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    this.notify();
  }

  remove(id: string) {
    this.items = this.items.filter((it) => it.id !== id);
    this.notify();
  }

  /** يمسح كل اللي خلص (تم، موجودة قبل، فشل) — الصور الفاشلة تبقى محفوظة محلياً وتتعاود وحدها. */
  clearFinished() {
    this.items = this.items.filter(isUploading);
    this.notify();
  }
}

export const uploadQueue = new UploadQueueStore();

export function useUploadQueue() {
  const [items, setItems] = useState(uploadQueue.getItems());
  useEffect(() => {
    const unsubscribe = uploadQueue.subscribe(() => setItems(uploadQueue.getItems()));
    return () => { unsubscribe(); };
  }, []);
  return items;
}

/** عدد العناصر التي ما زالت تُرفع/تُحفظ — تُستخدم لشارة صغيرة في شريط التنقّل. */
export function useUploadQueuePendingCount() {
  const items = useUploadQueue();
  return items.filter(isUploading).length;
}
