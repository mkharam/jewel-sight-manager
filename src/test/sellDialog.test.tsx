import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const single = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(() => ({ insert: (row: unknown) => { insert(row); return { select: () => ({ single }) }; } })) },
}));
// البائع في فرع "القادسية" والقطعة بلا فرع — الحالة التي كانت تُرفض بـ403.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, profile: { branch_id: "seller-branch" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SellDialog from "@/components/SellDialog";

const piece = { id: "p1", name: "طقم", sku: "S1", karat: "18K", weight_grams: 20, branch_id: null, sale_price: null, promo_price: null };

function open(props: Partial<Parameters<typeof SellDialog>[0]> = {}) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/products/p1"]}>
        <Routes>
          <Route path="/products/p1" element={<SellDialog product={piece} open onOpenChange={() => {}} hideTrigger {...props} />} />
          <Route path="/sales/:id/receipt" element={<p>RECEIPT PAGE</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByLabelText("السعر النهائي (د.ل)") as HTMLInputElement;
}

describe("SellDialog", () => {
  beforeEach(() => {
    insert.mockReset();
    single.mockReset().mockResolvedValue({ data: { id: "sale-1" }, error: null });
  });

  it("prefills today's price when the piece has no fixed price", () => {
    expect(open({ suggestedPrice: 5230.4 }).value).toBe("5230");
  });

  it("accepts Arabic-keyboard digits instead of rejecting the price", () => {
    const input = open();
    fireEvent.change(input, { target: { value: "٤٥٠٠" } });
    expect(input.value).toBe("4500");
  });

  it("records the sale under the seller's branch and opens the receipt", async () => {
    open({ suggestedPrice: 4500 });
    fireEvent.click(screen.getByRole("button", { name: "بطاقة" }));
    fireEvent.click(screen.getByRole("button", { name: /تأكيد البيع/ }));
    await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
    expect(insert.mock.calls[0][0]).toMatchObject({
      product_id: "p1", final_price: 4500, payment_method: "بطاقة", sold_by: "u1", branch_id: "seller-branch", discount: 0,
    });
    expect(await screen.findByText("RECEIPT PAGE")).toBeInTheDocument();
  });

  it("won't confirm without a price", () => {
    open();
    expect(screen.getByRole("button", { name: "اكتب السعر" })).toBeDisabled();
  });
});
