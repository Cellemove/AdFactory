# Cellumove image-ad logo

`cellumove-dark.png` and `cellumove-white.png` are the original transparent Canva exports. Keep their filenames and transparent backgrounds when replacing them; restart the server after replacing assets because the trimmed versions are cached in memory.

New image ads automatically receive the exact logo in their saved pixels. The renderer trims the empty Canva canvas, preserves the wordmark's proportions, and places it at 26% of image width with a 4% right margin. Its top margin is 4% for square/feed ads and 14% for stories to leave room for platform controls. Generation prompts reserve this area. Local background contrast determines the dark or white version; busy backgrounds receive a subtle light backing.

Older ads can use **Add logo to existing images** in their batch gallery. This makes no image-generation API call and keeps the previous image URL in the candidate's `unbrandedImageUrl`. Review placement on older ads, whose prompts did not reserve logo space. Already-branded candidates are skipped.

The assets are included in the Next.js server deployment through `outputFileTracingIncludes`. Branding happens before PNG compression, so even a compression fallback retains the logo. Missing or invalid assets fail before a paid generation begins.
