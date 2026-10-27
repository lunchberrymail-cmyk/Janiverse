# Tutorial screenshots

These screenshots show Lumiverse's actual native controls in a local test instance. Group-chat examples use fictional Mira and Rowan cards; the lorebook example uses a fictional Lantern Café entry. Import screenshots use an empty assistant or synthetic practice files, never an account export. Summary screenshots show the native recap controls and built-in Add Prompt menu without the user's preset contents.

API screenshots show the native OpenRouter setup, model selection, Create, activation and a successful credential test. The example key stays masked, provider usage details are hidden, and unrelated Home content is cropped out. No chat generation was requested. Screenshots are cropped and palette-compressed for size while retaining readable controls.

Keep screenshots free of API keys, private conversations, browser account details and imported character definitions. When native controls change, update the relevant image and matching steps, numbered callouts, alt text and caption in `src/feature-tutorials.ts` and `src/tutorial-screenshots.ts`.

Arrows and numbered badges are vector/HTML overlays, with matching readable instructions below each image. Exact-screen callouts never carry over to another scene's fallback image. Back / Next is manual; these guides contain no video or slideshow playback. The original recordings remain available as separate local output files rather than extension assets.

The Hone guide uses the public repository install field, built-in Default model profile, built-in Input Single Pass selector and a fictional unsent draft. It does not show provider credentials or custom prompt text. No enhancement was run, and the sample draft was cleared after capture.

`bun run build` embeds compressed PNGs and licensed fonts for offline use. No external image hosting or media requests are required.
