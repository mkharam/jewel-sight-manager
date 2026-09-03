# Plan: Add a Staff AI Assistant Powered by Lovable AI Gateway

## Goal
Give staff a built-in AI assistant they can use from inside the app (ask about inventory, products, sales trends, or get help with transfers). The assistant runs through Supabase Edge Functions using Lovable AI Gateway, with Claude as the preferred model if the gateway supports it.

## What will be built

1. **Supabase Edge Function: `ai-assistant`**
   - `POST /ai-assistant`
   - Accepts a message thread and an optional model choice.
   - Calls Lovable AI Gateway using the AI SDK (`@ai-sdk/openai-compatible`).
   - Uses `anthropic/claude-3.5-sonnet` or the closest Claude identifier the gateway supports; falls back to `openai/gpt-5.6-sol` if Claude is unavailable.
   - Returns the assistant reply as JSON.

2. **Secure context injection**
   - The function can optionally read the current user’s branch and role from the JWT.
   - It does NOT expose full database rows to the model; only small, safe context snippets are attached when the user asks about inventory.

3. **New page: `/assistant`**
   - Simple chat UI in the existing Arabic RTL style.
   - Message history kept in local component state (no persistent chat logs in the database).
   - Shows the active model and a fallback notice if Claude is not available.

4. **Navigation link**
   - Add "مساعد AI" to the staff navigation menu.

## Why this approach

- Keeps the AI key (`LOVABLE_API_KEY`) server-side inside the Edge Function.
- Reuses the existing Supabase auth and branch security.
- Does not change existing product/transfers/inquiry logic.
- Lets staff experiment with AI help without giving the model direct write access.

## Technical steps

1. Verify `LOVABLE_API_KEY` exists; create it if missing.
2. Create `supabase/functions/ai-assistant/index.ts` with CORS, JWT validation, and AI SDK call.
3. Create the `createLovableAiGatewayProvider` helper in `supabase/functions/_shared/ai-gateway.ts`.
4. Create `src/pages/Assistant.tsx` chat UI.
5. Add `/assistant` route in `src/App.tsx`.
6. Add the navigation item in `src/components/AppLayout.tsx`.
7. Deploy the new Edge Function.

## Out of scope

- Persistent chat history across sessions.
- Direct database writes from the AI (read-only assistant only).
- Replacing the existing image-analysis pipeline, which already uses Lovable AI.

## Note on Claude availability

Claude is available through Lovable AI Gateway only if the gateway routes to Anthropic or OpenRouter. The implementation will request a Claude model and gracefully fall back to the default GPT model if the gateway rejects the model ID.
