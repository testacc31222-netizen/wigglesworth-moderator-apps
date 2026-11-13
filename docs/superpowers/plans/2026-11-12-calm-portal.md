# Calm community portal implementation plan

**Goal:** Apply the latest restrained purple preview across the complete existing site.

**Architecture:** Keep Express, all stored content, original DOM IDs, form handlers and endpoints. Replace the two fantasy presentation stylesheets with one shared calm stylesheet. Reorder existing sections into an introduction, roles with requirements alongside, process/community, support, status and FAQ. Keep closed roles disabled rather than inventing a details workflow.

**Design:** Latest approved direction: `exec-2f2862f1-4972-4af3-9127-170d022f2430.png`; supporting form reference: `exec-d4e6eadf-c92d-4ca9-ab2d-d3b5d582d909.png` in the chat's generated images. Background #130f18, text #f2ecf4, muted #b8aebe, rule #3b3343, action #8e6aae. Sans-serif headings, flat controls, generous section spacing, no fantasy raster art or ornamental effects. Retain all staff-managed content, including announcements and uploads.

User instructed implementation after reviewing the previews. Continue locally through verification; a production release is a separate step.

- [x] Replace presentation styling and restructure home/roles/requirements without changing IDs.
- [x] Restyle sign-in, dashboard, application, support, status, FAQ and staff surfaces.
- [x] Add restrained pointer interaction, no cursor replacement; disable for reduced motion and touch.
- [x] Test isolated local data: auth, role gating, application steps, support tabs, status, FAQ, staff entry, responsive overflow and accessibility.
- [x] Compare rendered desktop/mobile screenshots with concepts; fix mismatches; review diff and record limitations.

Rulings: closed roles retain their existing disabled behavior; the unsupported save-progress claim from the concept is omitted. Existing duplicate title/subtitle/logo hiding is retained. Button violet is darkened to #825c9e for contrast. Final verification and visual differences are recorded in `docs/calm-portal-notes.md`.

Review focus: hidden form states, custom role names/content, narrow viewports, keyboard navigation, dynamic form progress, staff-auth protection, reduced motion, and preserving saved configuration.
