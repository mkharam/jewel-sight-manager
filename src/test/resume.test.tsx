import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// resume.ts يحمل حالة على مستوى الوحدة (LOAD_ID، فتحة جديدة، تحديث جاهز) — نعيد تحميلها
// لكل اختبار كي يمثّل كل اختبار "فتحة" مستقلة للتطبيق.
async function freshModule() {
  vi.resetModules();
  return await import("@/lib/resume");
}

const KEY = "lamaa.resume.";
const writeFromEarlierLoad = (key: string, v: unknown, ageMs: number) =>
  localStorage.setItem(KEY + key, JSON.stringify({ v, at: Date.now() - ageMs, loadId: "earlier-load" }));

describe("readResume", () => {
  beforeEach(() => localStorage.clear());

  it("returns state saved in the same load regardless of age", async () => {
    const r = await freshModule();
    r.saveResume("x", 1);
    expect(r.readResume("x")).toBe(1);
  });

  it("returns state from an earlier load only inside the resume window", async () => {
    const r = await freshModule();
    writeFromEarlierLoad("recent", "yes", 5 * 60 * 1000);
    writeFromEarlierLoad("old", "no", r.RESUME_WINDOW_MS + 1000);
    expect(r.readResume("recent")).toBe("yes");
    expect(r.readResume("old")).toBeNull();
    expect(localStorage.getItem(KEY + "old")).toBeNull();
  });

  it("restarts the window when the app is hidden", async () => {
    const r = await freshModule();
    r.saveResume("page", "/chat");
    const entry = JSON.parse(localStorage.getItem(KEY + "page")!);
    localStorage.setItem(KEY + "page", JSON.stringify({ ...entry, at: 0 }));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(JSON.parse(localStorage.getItem(KEY + "page")!).at).toBeGreaterThan(Date.now() - 1000);
  });
});

describe("useResumeRoute", () => {
  let seen: string[];
  let nav: ReturnType<typeof useNavigate>;

  async function renderAt(path: string, uploadsActive = () => false) {
    const r = await freshModule();
    function Probe() {
      r.useResumeRoute(uploadsActive);
      const loc = useLocation();
      nav = useNavigate();
      seen.push(loc.pathname);
      return null;
    }
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    return r;
  }

  beforeEach(() => {
    localStorage.clear();
    seen = [];
  });

  it("reopens the last page after a relaunch, keeping search underneath for back", async () => {
    writeFromEarlierLoad("route", "/products/abc", 60 * 1000);
    await renderAt("/");
    expect(seen.at(-1)).toBe("/products/abc");
    act(() => nav(-1));
    expect(seen.at(-1)).toBe("/");
  });

  it("starts fresh when the last visit is older than the window", async () => {
    writeFromEarlierLoad("route", "/products/abc", 2 * 60 * 60 * 1000);
    await renderAt("/");
    expect(seen.at(-1)).toBe("/");
  });

  it("respects a direct link (e.g. a notification) instead of resuming", async () => {
    writeFromEarlierLoad("route", "/products/abc", 60 * 1000);
    await renderAt("/chat");
    expect(seen.at(-1)).toBe("/chat");
  });

  it("applies a pending update on the next navigation, but never during uploads", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload }, configurable: true });

    let uploading = true;
    const r = await renderAt("/", () => uploading);
    r.markUpdateReady();
    act(() => nav("/chat"));
    expect(reload).not.toHaveBeenCalled();

    uploading = false;
    act(() => nav("/inquiries"));
    expect(reload).toHaveBeenCalledTimes(1);
    // الصفحة التي قصدها محفوظة قبل إعادة التحميل، فلا يرتدّ لصفحة سابقة بعدها.
    expect(JSON.parse(localStorage.getItem(KEY + "route")!).v).toBe("/inquiries");
  });
});
