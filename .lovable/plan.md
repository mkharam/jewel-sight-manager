# Plan: External Website Access to Project Backend

## Goal
Let another website or mobile app read/write data from this project’s backend (Lovable Cloud / Supabase) safely, without giving away full database access.

## Recommended approach: Edge Functions as a controlled API

Instead of exposing the public Supabase anon key to an external site and widening RLS, create dedicated Edge Functions that act as a secure gateway. This keeps the existing staff permissions intact and lets you decide exactly what the external site can do.

## Why this approach

- The current app uses branch-scoped RLS and staff-only auth; opening that to an external domain is risky.
- Edge Functions run with a service-role client, so they can bypass RLS while enforcing their own rules.
- You can add API-key or webhook-secret validation per external client.
- CORS is handled inside the function, so any domain you whitelist can call it.

## What will be built

1. **Public catalog endpoint** — `GET /public-products`
   - Returns available products for a selected branch or all branches.
   - Filters: category, karat, price range, search text.
   - Returns safe fields only: name, sku, karat, weight, sale_price, promo_price, primary image URL, branch name.

2. **Inquiry submission endpoint** — `POST /public-inquiry`
   - Lets a customer on the external site submit an inquiry.
   - Creates a row in `customer_inquiries` tied to a branch.
   - Triggers the existing push notification to that branch’s staff.

3. **API-key protection**
   - Store an `external_api_key` secret.
   - Each public endpoint requires the key in the `x-api-key` header.

4. **CORS setup**
   - Allow the external website’s origin(s) in function responses.

5. **External-site integration guide**
   - Provide a small JavaScript snippet showing how to call the endpoints.

## Technical steps

1. Add a migration that creates no new tables but ensures `customer_inquiries` can be inserted by the service role (already true) and that `products` SELECT is reachable for the function.
2. Create `supabase/functions/public-catalog/index.ts`.
3. Create `supabase/functions/public-inquiry/index.ts`.
4. Store `EXTERNAL_API_KEY` as an Edge Function secret.
5. Deploy the new Edge Functions.
6. Add a short usage snippet to the project README.

## Alternative: Direct Supabase client

If the external site is also built by you and you want real-time subscriptions, we can instead give it the Supabase URL + anon key and add an `anon` SELECT policy on `products` plus an `anon` INSERT policy on `customer_inquiries`. This is faster to set up but less flexible and harder to audit.

## Out of scope

- OAuth server / user-delegated access (only needed if the external site must act as a logged-in staff user).
- Modifying the existing staff app UI or RLS beyond what the new endpoints require.
