# Verify OpenRouter vision analysis

The OpenRouter key is now saved and the code path is already in place (OpenRouter → Groq → Gemini). Remaining work is verification only.

## Steps

1. Redeploy the three AI functions so they pick up the new secret: `analyze-product-image`, `image-search`, `reindex-product-images`.
2. Run one live analysis call with a real product image and read the function logs to confirm:
   - which OpenRouter free vision model actually answered,
   - that the returned JSON has `name_ar`, `category_name`, `karat`, `metal_color`, `style`, `gemstones`, `description_ar`.
3. If the chosen free model IDs are no longer served, re-query OpenRouter's models list and swap in currently-free vision models, then re-test.
4. Report the confirmed working model and whether bulk import / visual search now run without the "all providers busy" message.

No schema or UI changes.
