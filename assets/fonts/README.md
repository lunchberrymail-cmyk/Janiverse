# Bundled interface fonts

Fraunces and Jura are distributed under the SIL Open Font License 1.1.
Their unmodified Latin variable WOFF2 files come from the official Google Fonts CSS API:

https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Jura:wght@400..700&display=swap

The adjacent Fraunces-OFL.txt and Jura-OFL.txt files preserve each family's copyright and license.
License sources: https://github.com/google/fonts/tree/main/ofl/fraunces and https://github.com/google/fonts/tree/main/ofl/jura.

The build embeds these files in the frontend bundle. The running extension makes no font CDN requests.

SHA-256:

- fraunces-latin.woff2: 7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783
- jura-latin.woff2: 99a4b2d414e1d6ee78a883c7513d5dd9da4254f2a094c76170b81f07b1620d79
