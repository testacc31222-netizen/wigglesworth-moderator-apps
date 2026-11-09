# Wigglesworth approved mockup implementation

The redesign is implemented in `public/index.html`, `public/journey.css`, and `public/journey.js`, with optimized background/crest assets and an SVG button border. The approved reference is `approved-mockup.png`.

Desktop uses a persistent five-item left navigation rail and a brand/account header. Mobile uses a hamburger drawer, centered crest, account control and fixed five-item bottom navigation with safe-area spacing. The original role picker, multi-step form, account gate, status lookup, support, reports, staff editor and backend remain connected through the existing IDs and scripts.

## Preservation and intentional differences

- `server.js`, `public/app.js`, `public/signin.js`, `public/site-copy.js`, package dependencies, Render configuration and `data.live.json` are unchanged.
- All existing functional HTML IDs remain. Only four gradient/pattern IDs belonging to the removed decorative SVG scene were removed; no duplicate IDs were introduced.
- Stored copy, announcements, role availability, questions and design settings remain in the database. Announcement and configurable hero content are now below the visual hero so they remain available without displacing the approved composition.
- Staff/status/support utility links remain accessible in the sidebar/drawer and footer, extending the five primary mockup destinations to preserve the existing flows.
- Artwork and crest are newly generated matching assets, rather than a pixel extraction of the original mockup; minor scene/crest details differ. The phone hardware/status bar in the reference is presentation framing and is not reproduced as website UI.
- The existing sign-in/account page remains intact. The applications portal still requires sign-in, as before; this redesign does not change public access rules.
- Existing custom footer scale is accommodated through a narrower content width and spacing, without overwriting saved data.

## Visual verification ledger

Browser: Playwright with installed Microsoft Edge. The in-app browser could not connect to the local test server, so it was not used for final QA. Test origin: `http://127.0.0.1:3000`. Synthetic records and a dedicated DATA_FILE were used; email, Discord and GitHub integrations were disabled. No production submissions or account changes were made.

The reference combines a desktop canvas and phone mockup in one 1671×941 image; the combined composition is not a single website viewport. Desktop was compared at 1240×820 and 1440×900, with phone layout at 390×844; tablet and narrow reflow checked at 320, 760, 768 and 1024px widths.

| Reference point | Rendered check and resolution |
| --- | --- |
| Left Home/Roles/Apply/Process/FAQ navigation | Five persistent desktop destinations, outlined icons, purple current-state treatment; mobile fixed five-item equivalent |
| Header brand and Sign In | Crystal crest/wordmark at left and account button at right; phone hamburger, centered crest, account icon |
| Moonlit purple ruins | Matching generated scene with moon/crest above centered copy; optimized WebP is approximately 142 KB |
| YOUR JOURNEY STARTS HERE. | Exact heading words and accent preserved; desktop two lines, phone three lines |
| Apply Now / Learn More | Accessible links, outlined document/info icons, angular glowing primary border; real role/process targets |
| Three highlights | Support the Community / Create Experiences / Make an Impact; matching outlined icons and separator lines, desktop only as in reference |
| Overflow and fixed navigation | Saved-config footer/announcement overflow fixed; responsive widths verified and bottom navigation reserved in document spacing |
| Keyboard and motion | Visible focus, skip link, drawer focus transfer/trap/Escape, reduced-motion handling; no continuous animation loop introduced |

Above-the-fold allowed-copy comparison: brand/application wordmark, five navigation labels, Sign In, hero title/description, two CTA labels and three highlights match the reference. Added utility links are intentional to preserve staff/status/support access. Reference and final screenshots were visually inspected using `view_image`; matching layout, typography, palette, icon treatment, buttons and responsive line breaks were checked. The regenerated artwork is the remaining fidelity variation; a pixel-identical claim is not made.

## Asset provenance

Built-in image generation was used with the approved mockup as reference. Outputs were optimized locally into `public/journey-ruins.webp` and `public/journey-crest.png`; no runtime image-generation dependency was added.

Background prompt: Create a production website BACKGROUND ART ASSET extracted/reconstructed from the approved reference screenshot. Output a single wide landscape 1536x1024 artwork, NOT a website mockup. Match the reference desktop central hero precisely: nearly black gothic medieval ruined stone walls at far left and right, glowing violet-purple clouds and fog, purple hanging banners bearing a luminous angular W fantasy crest, large luminous purple full moon at top center with the same crystalline angular W crest silhouetted on a mountain peak below it. Moon centered at x50%, y15%, about 24% of image width. Ruin pillars and flags occupy only outer 20% on each side; middle 60% mostly very dark empty purple-black negative space for readable website text. Fog floor at bottom 20%, gentle violet underlighting. Same intense magenta purple palette with black shadows and realistic detailed game concept art style. Reconstruct scene behind reference text: remove ALL typography, ALL interface buttons, ALL navigation, ALL borders and phone frame. No letters or words except the angular fantasy W crest integrated into moon scene and banners. No UI. Wide art composition should be usable behind centered text.

Crest prompt: Extract and recreate ONLY the small purple crystalline W logo from the top left header of the provided approved website mockup. A single isolated centered angular W fantasy crest: two sharp upward wings slant inward, lavender white highlights, rich violet amethyst crystal facets, small four-point diamond star at top center and small diamond below center. Faithfully match the header logo silhouette exactly. No moon, no mountains, no words, no border, no UI. Transparent background, compact square image with logo filling 85% of canvas. This is a production brand logo asset for that exact website.

## Release status

Implemented in local branch `feat/approved-purple-applications`. No push, merge or production deployment has occurred. Render has no selected workspace and lists `My Workspace` and `wigglestotheworth`; the user must identify the correct one before service inspection/release. The existing `/health` endpoint and deployment configuration are unchanged. A production release must retain the latest remote `data.live.json` and avoid overwriting live data with this checkout or the QA fixture.

## Final verification result

22 check groups passed in the final Playwright/Edge run, using the preserved saved configuration and isolated synthetic records: gate and protected APIs; ID sign-in/dashboard; approved hero; Apply editor hook/text/icons; role selection; Roles reset; validation; full multi-step submission; status lookup; staff rejection; staff unlock/Applications tab/lock; private support ticket; seven viewport widths; mobile menu/Escape; drawer focus; Status/Support focus; bottom navigation; mobile axe scan; desktop axe scan; reduced motion; no JavaScript runtime errors. Both axe WCAG A/AA scans reported zero violations. This is automated coverage plus visual comparison, not certification or an email-delivery test.

`node --check public/journey.js`, functional-ID comparison, duplicate-ID check and `git diff --check` passed. Review findings concerning the Apply design hook and utility-link focus were corrected and reviewed again; no additional actionable findings remained.

Screenshots: `C:/Users/testa/.codex/visualizations/2026/11/09/01a1c200-a7a1-79e0-aadb-81f06968c3eb/wigglesworth-desktop.png` and `wigglesworth-mobile.png`. Machine-readable QA results are saved alongside them as `wigglesworth-qa-results.json`.
