# Character lighting refinement

The original character PNG remains unchanged (SHA256 B5A584A4D22DE20D448B0C41426E9AFC40AC3D101DAC6639551FBDDA0570B60A). Ivory sections remain. Midnight-blue controls and dark text replace the prior green/teal emphasis; orange and icy blue are limited to focus, fine active-navigation rules, subtle pointer lighting, and edge details. Hover shadows and lift are removed from controls. Semantic status indicators remain distinct.

Each role receives a small code-native line emblem: shield, video frame, developer brackets or event calendar, with a diamond fallback for custom roles. Existing role IDs, availability, questions and handlers remain unchanged. The existing pointer controller supplies the soft hover highlight, without a replacement cursor or permanent animation loop.

The eye reveal keeps its character-first behavior and silent supplied videos. The expanding mask uses smoothstep easing and a feathered edge; the original raster uses normal browser interpolation without sharpening filters or invented image detail. Deep enlargement remains limited by the source resolution. Reduced-motion users retain the static alternative. Role details enter with a short translation, disabled under reduced motion.

Browser regressions uncovered a Home-reset offset caused by a still-settling compositor scroll. Reset now also runs on the next animation frame. Entry/reset, mouse-wheel zoom, delayed gameplay reveal, custom emblems, reflow at 320/390/760/1024/1440px, and the reduced-motion alternative were tested in installed Edge using a read-only local fixture. Staff sorting, quick filters and a saved public headline visible in another visitor page passed a separate mocked-save test. No production records were edited. This revision is local pending explicit publication approval.

Only the role presentation renderer, cinematic presentation script, stylesheet references and new atmosphere stylesheet change; backend, authentication, stored data and shared text machinery are unchanged.
