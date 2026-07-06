# لمعة (Lamaa) — Project Handoff Brief

Paste this to Claude (or any other AI) so it has full context on what's built and what's pending.

---

## What the app is

**لمعة** — Arabic RTL, mobile-first web app for managing a chain of 5 gold & jewelry shops in Libya (جرابة، حي الأندلس، بنعاشور، النوفليين، القادسية).

Primary user = a shop employee standing next to a customer, using a phone. Top priority = *find the piece fast and quote a price in one tap*.

## Stack

- React 18 + Vite 5 + TypeScript + Tailwind v3 + shadcn/ui
- Lovable Cloud backend (Supabase under the hood): Postgres + Auth + Storage + Edge Functions + Realtime
- Auth: username-only login (internally mapped to `username@lamaa.local`). Accounts created by admin. Seed account: `admin` / `1234`.
- Roles in a separate `user_roles` table (`admin` / `manager` / `employee`) with `has_role()` SECURITY DEFINER function.
- Design: gold gradient `hsl(38 65% 42%)`, ivory background, Cairo/Tajawal fonts. No purple. Semantic tokens in `src/index.css`.

## What's already built

**Pages** (`src/pages/`): `Auth`, `ProductSearch` (home), `ProductDetail`, `ProductForm`, `Inquiries`, `ImportProducts`, `ImportSocial`, `Staff`, `Transfers`.

**Key features live:**
- Product catalog with images, karat, weight, ring size, price, promo price, status, branch, category.
- Search page with sticky search bar, image search button, karat/category chips, full filter sheet, saved last search in localStorage (`lamaa.lastSearch.v1`).
- Image search via `supabase/functions/image-search` (currently Gemini vision — quota issues, see below).
- Social media image import via `social-fetch-images` + `social-analyze-image` edge functions.
- Branch-to-branch **transfers** with Realtime updates, notifications bell.
- Customer inquiries (`customer_inquiries`) and per-quote logging (`product_quotes`) — every price shown to a customer must be recorded to prevent price drift between branches.
- Staff management by admin.
- **QuickQuoteSheet** component (bottom sheet) started for one-tap price quoting from product cards.

**Explicitly killed:** barcode scanning. Never re-add. Search is name/description/filters only.

## Plan document

`.lovable/plan.md` contains the full improvement roadmap agreed with the user. Priorities in order:
1. Quick Quote + last-prices suggestion + ±10% price drift warning
2. Sticky search + chip filters + last-search memory (mostly done)
3. Bottom navigation + FAB for mobile
4. Unified `customers` table + link quotes/inquiries to it
5. Transfers UX (badge, "request to my branch" button in card, realtime sound)

**Deferred:** manager reports dashboard, offline mode (internet always available for this user).

## Current blocker

**AI vision quota.** Lovable AI credits ran out; Gemini free tier also exhausted. Last recommendation to user was to switch `image-search` and `social-analyze-image` edge functions to **OpenRouter** (free vision models: Llama 3.2 Vision, Qwen2-VL, Gemini Free — ~200 req/day each). Waiting on user to provide `OPENROUTER_API_KEY`. Cloudflare Workers AI (LLaVA, 10k req/day) is the backup option.

## Comparison context

User compared لمعة to Seraj ERP (tic-ly.com/seraj-erp). Seraj = general-purpose accounting/ERP, desktop. لمعة = jewelry-specific, mobile-first, cloud, with AI image search and per-customer relationship tracking. Missing vs Seraj: daily employee report, Z-report/daily close, purchase cost & profit margin per product — user has not yet decided whether to add these.

## Conventions to respect

- Never hardcode colors — use semantic tokens from `index.css`.
- All new `public` tables need `GRANT` + RLS + policies in the same migration.
- Never edit `src/integrations/supabase/client.ts` or `types.ts` (auto-generated).
- Say "Lovable Cloud" / "backend" to the user, never "Supabase".
- RTL Arabic everywhere; keep gold luxury aesthetic.

## Next concrete step (when unblocked)

Either (a) get OpenRouter key from user and swap the two edge functions off Gemini, or (b) start Quick Quote step 1 from the plan without touching AI. User's call.
