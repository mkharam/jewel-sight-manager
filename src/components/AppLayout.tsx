import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Search, Package, MessageCircle, Upload, LogOut, Sparkles, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const baseNav = [
  { to: "/", label: "البحث", icon: Search, end: true },
  { to: "/products", label: "المنتجات", icon: Package },
  { to: "/inquiries", label: "الاستفسارات", icon: MessageCircle },
  { to: "/import", label: "استيراد", icon: Upload },
];

export default function AppLayout() {
  const { profile, roles } = useAuth();
  const navItems = roles.includes("admin")
    ? [...baseNav, { to: "/staff", label: "الموظفون", icon: Users }]
    : baseNav;
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur shadow-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="size-9 rounded-xl bg-gold-gradient flex items-center justify-center shadow-gold">
              <Sparkles className="size-5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <h1 className="text-lg font-extrabold text-gold-gradient">لمعة</h1>
              <p className="text-[10px] text-muted-foreground -mt-0.5">إدارة المجوهرات</p>
            </div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  )
                }
              >
                <item.icon className="size-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block text-left">
              <p className="text-sm font-semibold leading-tight">{profile?.full_name ?? "—"}</p>
              <p className="text-[11px] text-muted-foreground leading-tight">
                {roles[0] === "admin" ? "مدير عام" : roles[0] === "manager" ? "مدير" : "موظف"}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="خروج">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-4 pb-24 md:pb-8">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur">
        <div className={cn("grid h-16", navItems.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-0.5 text-[11px]",
                  isActive ? "text-primary" : "text-muted-foreground"
                )
              }
            >
              <item.icon className="size-5" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
