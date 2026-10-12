import { afterEach, describe, expect, it, vi } from "vitest";
import { pieceShareText, sharePiece } from "@/lib/sharePiece";

describe("pieceShareText", () => {
  it("lists name, karat/colour, weight, price and piece number", () => {
    const text = pieceShareText({ name: "طقم عرايسي", karat: "18K", colorLabel: "أصفر", weight_grams: 42.5, price: 12500, sku: "B1-S-0042" });
    expect(text.split("\n")).toEqual([
      "طقم عرايسي",
      "18K · أصفر",
      expect.stringContaining("الوزن:"),
      expect.stringContaining("السعر:"),
      "رقم القطعة: B1-S-0042",
    ]);
  });

  it("never mentions a price the employee cannot see", () => {
    const text = pieceShareText({ name: "خاتم", karat: "21K", price: null });
    expect(text).not.toContain("السعر");
    expect(text).toBe("خاتم\n21K");
  });
});

describe("sharePiece", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shares the photo with the text when the device supports files", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, canShare: () => true });
    const file = new File(["x"], "piece.jpg", { type: "image/jpeg" });
    expect(await sharePiece("طقم", file)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [file], text: "طقم" });
  });

  it("treats closing the share sheet as cancelled, not an error", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(abort), canShare: () => true });
    expect(await sharePiece("طقم", null)).toBe("cancelled");
  });

  it("copies the text on computers without a share sheet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await sharePiece("طقم", null)).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("طقم");
  });
});
