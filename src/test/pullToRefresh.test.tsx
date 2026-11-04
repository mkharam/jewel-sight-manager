import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PullToRefresh from "@/components/PullToRefresh";

const touch = (type: string, y: number, target: EventTarget = document.body) => {
  const e = new Event(type, { bubbles: true }) as Event & { touches: { clientY: number }[] };
  Object.defineProperty(e, "touches", { value: type === "touchend" ? [] : [{ clientY: y }] });
  act(() => { target.dispatchEvent(e); });
};
const pull = (dy: number, target?: EventTarget) => {
  touch("touchstart", 100, target);
  touch("touchmove", 100 + dy, target);
  touch("touchend", 0, target);
};

describe("PullToRefresh", () => {
  const reload = vi.fn();
  beforeEach(() => {
    Object.defineProperty(window, "location", { value: { ...window.location, reload }, configurable: true });
    render(<QueryClientProvider client={new QueryClient()}><PullToRefresh /></QueryClientProvider>);
  });
  afterEach(() => { reload.mockClear(); document.body.innerHTML = ""; });

  it("reloads after a long pull from the top", () => {
    pull(300);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does nothing on a short pull", () => {
    pull(60);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing while a dialog is open", () => {
    const d = document.createElement("div");
    d.setAttribute("role", "dialog");
    document.body.appendChild(d);
    pull(300);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing when the touched list is scrolled down", () => {
    const list = document.createElement("div");
    document.body.appendChild(list);
    Object.defineProperty(list, "scrollTop", { value: 50 });
    pull(300, list);
    expect(reload).not.toHaveBeenCalled();
  });
});
