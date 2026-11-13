# Cinematic eye journey

Local implementation awaiting the user's final “good” before publication. Existing Render hosting and repository are retained; no AppDeploy app was created.

## Design and constraints

The approved original-image layout replaces the former sidebar hero with transparent top navigation, split oversized Manrope 300 typography, an unchanged character PNG, warm ivory controls, and orange/teal accents. Manrope approximates the thin type in the generated concept; a generated image does not identify an exact font file. The original PNG's lighting and texture are preserved rather than regenerated or retouched.

The introduction is pinned for 340 viewport heights on desktop and 270 on mobile. Scroll progress fades the split copy, scales/translates the original character toward its existing eye socket, expands a circular gameplay mask, then releases the full-screen scene into ivory editorial sections. This is a 2D, reference-inspired zoom/mask, not a rotating 3D camera: no separate eye or model file was supplied. The Jesko Jets reference was inspected in the browser, but exact timing equivalence is not claimed.

Existing roles, application forms, process/community copy, support, reports, status, FAQ, account dashboard, and staff tools retain their handlers and IDs with the shared orange/teal/ivory styling. The portrait gameplay clip appears in the community section. Both Play Wigglesworth links point to the supplied official Meta URL:
https://www.meta.com/en-gb/experiences/wigglesworth/25557330417282971/

## Assets and playback

- `wigglesworth-character.png` is byte-for-byte identical to the supplied `wigglesworthalternativelogo.png`. SHA256: B5A584A4D22DE20D448B0C41426E9AFC40AC3D101DAC6639551FBDDA0570B60A.
- Both MP4s were copied from the supplied videos with only the video stream retained (`-map 0:v:0 -c:v copy -an -movflags +faststart`). ffprobe confirms each has a video stream and **no audio stream**.
- Videos also use muted/defaultMuted, inline looping playback, pause/play controls, deferred loading, off-screen/background pausing, and autoplay restriction handling. Reduced-motion/data-saver users receive static imagery and may manually play the portrait video.
- Posters are actual frames from the supplied footage. No generated replacement artwork is used at runtime.

## Verification

23 browser check groups passed in Microsoft Edge through Playwright using an isolated localhost server, synthetic DATA_FILE, and disabled email, Discord, AI and GitHub integrations. Coverage: auth/staff protection; original asset and official link; eye reveal; silent playback and pause/resume; role availability; application/report/sign-in/account accessibility; support keyboard tabs; FAQ; portrait playback; reflow at 320,390,760,768,1024,1536px; mobile navigation; reduced motion; account recovery; staff unlock/lock; no JavaScript exceptions; full application submission; status lookup; private ticket creation/lookup.

axe WCAG A/AA checks had zero violations in the tested settled states. Transitions were allowed to finish before contrast measurements. This is bounded coverage, not certification. Production messages, submissions and mail delivery were not tested. The in-app browser had previously failed to reach this local host; repeatable tests used installed Edge instead.

Static review identified an invisible scroll link overlapping Pause video after fading. It now becomes inert during fade and hidden afterward, and resets on reverse scrolling. Contrast issues inherited from the dark theme were corrected for ivory sections. All original HTML IDs remain, with none missing or duplicated. Backend, data, application/auth handlers, package manifests and Render config are unchanged.

Private screenshots were compared with the approved original-image preview for composition, asset identity, thin typography, spacing, section colors, controls and mobile adaptation. No further previews are included in the handoff, per the user's instruction. Evidence and the 20-group base QA result are in the chat's artifact directory as `cinema-*.png` and `cinema-qa.json`; the three full-flow checks passed separately.
