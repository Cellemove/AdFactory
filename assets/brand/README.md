# Cellumove image-ad logo

`cellumove-dark.png` and `cellumove-white.png` are the original transparent Canva exports. Keep their filenames and transparent backgrounds when replacing them; restart the server after replacing assets because the trimmed versions are cached in memory.

New image ads automatically receive the exact dark logo in a separate white header. The renderer trims the empty Canva canvas and preserves the wordmark's proportions, at 26% of export width with a 4% right margin. The header takes 8% of feed/square height; stories use 18%, with the logo starting at 14% to leave room above it. The complete artwork is scaled proportionally to fit below the header without cropping or enlargement. Final export dimensions stay unchanged. No logo or backing plate overlaps artwork pixels, regardless of whether the model follows the prompt. White side margins may appear as the complete artwork is fitted into the remaining space.

The gallery's **Add or fix logos** action brands untouched ads and repairs older overlays when a clean `unbrandedImageUrl` is available, without an image-generation API call. Candidates with `logoLayoutVersion: 2` are skipped. Older overlays with no clean source cannot be safely repaired: the gallery explains that the user must regenerate those ads if text is covered. It never silently adds another logo over an already damaged image. New generations retain a clean source in `unbrandedImageUrl` for future repairs.

The assets are included in the Next.js server deployment through `outputFileTracingIncludes`. Branding happens before PNG compression, so even a compression fallback retains the logo. Missing or invalid assets fail before a paid generation begins.
