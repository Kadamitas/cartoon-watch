# Cartoon Watch branding

Original CW lettering, cream outline, coral face, mint sparkle, and dark background. The artwork contains no external images or fonts.

Android uses vector launcher resources. The shared app uses `brand.svg`; LG, Samsung, and Roku use the committed PNGs at their existing platform dimensions. Building or installing the app does not require regenerating artwork.

To change the design, edit `tools/generate_branding.cjs`, install the existing companion dependencies, then run `node tools/generate_branding.cjs` from the repository root. It regenerates all platform assets and writes large previews to `outputs/`. `PLAYWRIGHT_EXECUTABLE_PATH` can select an installed browser.
