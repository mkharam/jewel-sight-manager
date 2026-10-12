import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { usePersistentState } from "@/lib/resume";

function Field({ k }: { k: string | null }) {
  const [v, setV, clear] = usePersistentState(k, "");
  return (
    <div>
      <input aria-label="f" value={v} onChange={(e) => setV(e.target.value)} />
      <button onClick={clear}>clear</button>
    </div>
  );
}

describe("usePersistentState", () => {
  beforeEach(() => localStorage.clear());

  it("restores what was typed after the app is killed and reopened", () => {
    const { unmount } = render(<Field k="t:a" />);
    fireEvent.change(screen.getByLabelText("f"), { target: { value: "وليد" } });
    unmount(); // the phone closed the app
    render(<Field k="t:a" />);
    expect((screen.getByLabelText("f") as HTMLInputElement).value).toBe("وليد");
  });

  it("does not create a draft just by opening an empty form", () => {
    render(<Field k="t:b" />);
    expect(Object.keys(localStorage).some((k) => k.includes("t:b"))).toBe(false);
  });

  it("clear() wipes the draft so the next open starts empty", () => {
    const { unmount } = render(<Field k="t:c" />);
    fireEvent.change(screen.getByLabelText("f"), { target: { value: "x" } });
    fireEvent.click(screen.getByText("clear"));
    unmount();
    render(<Field k="t:c" />);
    expect((screen.getByLabelText("f") as HTMLInputElement).value).toBe("");
  });

  it("key null behaves like plain useState", () => {
    const { unmount } = render(<Field k={null} />);
    fireEvent.change(screen.getByLabelText("f"), { target: { value: "y" } });
    unmount();
    render(<Field k={null} />);
    expect((screen.getByLabelText("f") as HTMLInputElement).value).toBe("");
  });
});
