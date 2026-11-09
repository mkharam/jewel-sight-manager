import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// supabase-js يبعت حدث كل ما الجلسة تتجدد (كل ساعة، وكل ما يرجع للتطبيق): الصفحة ما لازمش تتبنى من جديد.
type Listener = (event: string, session: unknown) => void;
let listener: Listener = () => {};
const rolesQuery = vi.fn();
const sessionOf = (id: string) => ({ user: { id }, access_token: `t-${id}` });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: Listener) => { listener = cb; return { data: { subscription: { unsubscribe: () => {} } } }; },
      getSession: () => Promise.resolve({ data: { session: sessionOf("u1") } }),
      signOut: vi.fn(),
    },
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, id: string) => {
          if (table === "user_roles") { rolesQuery(id); return Promise.resolve({ data: [{ role: "admin" }] }); }
          return { maybeSingle: () => Promise.resolve({ data: { full_name: "x", branch_id: "b1" } }) };
        },
      }),
    }),
  },
}));
vi.mock("@/lib/presence", () => ({ startPresence: () => undefined }));

import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";

let mounts = 0;
function Page() {
  useEffect(() => { mounts++; }, []);
  return <p>PAGE</p>;
}

function renderApp() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <ProtectedRoute><Page /></ProtectedRoute>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("session refresh", () => {
  beforeEach(() => { mounts = 0; rolesQuery.mockReset(); });

  it("keeps the page mounted when the same user's session is refreshed", async () => {
    renderApp();
    expect(await screen.findByText("PAGE")).toBeInTheDocument();
    expect(mounts).toBe(1);

    act(() => {
      listener("TOKEN_REFRESHED", sessionOf("u1"));
      listener("SIGNED_IN", sessionOf("u1"));
    });
    // ما فيش شاشة «جارٍ التحميل» بدل الصفحة، ولا لحظة.
    expect(screen.queryByText("PAGE")).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByText("PAGE")).toBeInTheDocument();
    expect(mounts).toBe(1);
    expect(rolesQuery).toHaveBeenCalledTimes(1);
  });

  it("reloads roles when a different user signs in", async () => {
    renderApp();
    await screen.findByText("PAGE");
    await act(async () => {
      listener("SIGNED_IN", sessionOf("u2"));
      await new Promise((r) => setTimeout(r, 10));
    });
    await waitFor(() => expect(rolesQuery).toHaveBeenLastCalledWith("u2"));
    expect(rolesQuery).toHaveBeenCalledTimes(2);
  });
});
