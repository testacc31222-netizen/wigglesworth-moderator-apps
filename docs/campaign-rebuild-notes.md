# Wigglesworth campaign rebuild

## Delivered

- Replaced the previous showcase composition with an asymmetric character campaign, editorial world introduction, wide gameplay feature, offset community spread, dark contribution/process chapter, large role selector and dual-action closing composition.
- Changed main/mobile navigation to Discover, Community, Roles and FAQ. Kept Play, Account, staff access, status, support and application shortcuts.
- Added a role-detail step using configured role names, descriptions and availability. Reused the original editable requirement nodes, with an explicit Start application action.
- Added focused application and confirmation modes around the existing form/stepper/submission handlers. Returning to roles restores keyboard focus; the brand exits application mode and resets the entrance.
- Rebuilt the eye choreography as approach, darkness, then gameplay. Static reduced-motion entrance, manual video controls, lazy loading, offscreen pausing and silent playback remain.
- Rebuilt sign-in composition and polished application/status/message controls with the same midnight/ivory/copper/ice palette.

## Verification

Browser plugin unavailable; used Playwright with installed Microsoft Edge against a local static fixture and an isolated instance of the actual Express server. No production submissions, messages or configuration writes.

- Responsive page and application reflow: 320, 390, 760, 768, 1024 and 1440 px. Signed-out account reflow: 320, 390, 760, 1024 and 1440 px.
- Real local account recovery, authenticated homepage, multi-step application submission, confirmation, status lookup, private-ticket creation/lookup, and dashboard records passed.
- Axe WCAG 2 A/AA and 2.1 AA checks passed for showcase, role details, application, account and confirmation. Mobile drawer destination focus, role focus restoration, logo exit and disabled closed roles passed.
- Desktop/mobile approach → darkness → gameplay choreography passed. Reload/reset, wheel zoom, manual silent playback and reduced-motion checks passed.
- Staff newest/oldest sorting, review filter/reset, shared headline editing and moved requirement editing passed. Saved text verified in a separate visitor page.
- Screenshots inspected for desktop/mobile hero, world, community, contribution chapter, roles, detail, application, account and closing composition. Fixed inherited low contrast, button transforms, phone account containment and obsolete account display rules found during visual inspection.
- JavaScript syntax, unique IDs, absence of browser exceptions and git whitespace checks passed.
- Original character SHA256 remains B5A584A4D22DE20D448B0C41426E9AFC40AC3D101DAC6639551FBDDA0570B60A.

## Scope and release

No changes to server.js, dependency manifests, Render configuration, database schemas or stored records. Homepage authentication requirement remains. Footage and character are supplied assets; no invented game claims, metrics or testimonials.

The entrance uses the original 1254px raster, not a 3D model; the dark passage conceals its most enlarged frames. Responsive checks emulate phone viewports rather than physical devices.

This rebuild is implemented locally and has not been published to production.
