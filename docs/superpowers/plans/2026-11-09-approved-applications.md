# Approved Wigglesworth Applications implementation plan

Goal: implement the user-approved desktop/sidebar and mobile/bottom-navigation mockup in the current Express site.

Architecture: retain the existing document, application scripts, backend, routes, IDs and data. Replace the hero and navigation markup; add a scoped presentation stylesheet and small accessible navigation controller. Generate matching standalone background and crest assets from the approved mockup.

Spec: ../approved-mockup.png and the user request in this chat.

## Constraints
- No changes to server.js, app.js, signin.js, site-copy.js, endpoints, role IDs, configuration or application data.
- Preserve the existing account gate and staff modal; do not test against real submissions or send mail.
- Exact hero copy: YOUR JOURNEY STARTS HERE.; Apply Now; Learn More.
- Desktop left Home/Roles/Apply/Process/FAQ rail, brand and Sign In header; mobile hamburger/crest/account and fixed five-item bottom navigation.
- Purple-black scene, serif type, amethyst accents, outlined icons, keyboard focus, reduced-motion support and safe-area spacing.

## Tasks
- [x] Replace chrome and hero; retain configurable content IDs in a separate content region; retain all downstream functional markup.
- [x] Add responsive purple stylesheet, matching assets and accessible current-section navigation. Keep support/status/staff accessible.
- [x] Verify application selection/validation, menu keyboard behavior, anchors, authentication gate, sign-in, staff lock and protected endpoints locally with synthetic data. Compare screenshots at desktop/tablet/mobile, zoom and reduced motion. Verify unchanged backend/data with git diff.
- [x] Review final diff and deployment configuration; report actual status. No production deploy until checks pass and a concrete release is authorized.

## Review focus
Navigation labels and targets; mobile safe-area and keyboard focus; retained IDs and config hooks; no production writes; no overflow at 320px or enlarged text.
