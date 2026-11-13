# Calm portal redesign

Implemented on `feat/calm-community-portal`. The user approved publication after reviewing the tested revision. Deployment status is reported in the chat separately from this implementation record.

The complete site was inspected in the in-app browser: sign-in, main page, role availability, dynamic application steps, support and reports, status, FAQ, and staff entry. No production form was submitted. The account dashboard and protected staff tools were exercised with synthetic local data.

## Changes

- Replaced the journey and portal fantasy presentation stylesheets with one shared `public/calm.css`. The legacy base styles remain for existing staff and application structure; scoped rules replace their public presentation.
- Removed the ruins, moon, crystals, role-emblem artwork, scroll/seal, and glowing crest from the active page markup. Removed ornamental animation initialization and the hero-image preload. Existing asset files and staff uploads/data remain available.
- Kept the deep plum/lilac identity with flat backgrounds, sans-serif headings, quiet dividers and consistent controls. The action color was darkened from the preview to `#825c9e` for readable white button text.
- Reordered the existing page into an introduction, full-width role rows with requirements alongside, community/process, support, status and FAQ. Desktop retains the left navigation; mobile retains the top controls and fixed five-item navigation.
- Restyled sign-in, account dashboard, application steps, support/reporting, status, FAQ, dialogs and staff tools. All original static IDs are retained without duplicates.
- Added a restrained pointer-following highlight to open role rows and a one-pixel button hover lift. No cursor replacement or continuous animation loop. Pointer work uses a single scheduled frame and stops for reduced motion, touch, pointer exit, or a hidden document.

`server.js`, `signin.js`, `site-copy.js`, all endpoints, data, manifests and Render configuration are unchanged. The only `app.js` change removes the illustrated emblem from the role renderer and changes the open-role affordance to “View role”. Closed roles remain disabled.

## Verification

The in-app browser could not reach the initial local server (`ERR_CONNECTION_TIMED_OUT`), so repeatable local checks used Playwright with installed Microsoft Edge against `http://127.0.0.1:3001`. A separate DATA_FILE contained only synthetic records and existing presentation configuration. Email, GitHub sync, Discord and AI integrations were disabled.

27 final check groups passed, including:

- Account/staff access protections, keyboard sign-in tabs, real local Application ID recovery, account dashboard, and sign-out.
- Role availability, illustration removal, complete multi-step application submission and receipt, status lookup, support tab keyboard behavior/draft retention, private ticket creation and lookup, FAQ and staff unlock/lock.
- Pointer effect and reduced-motion cleanup; no JavaScript exceptions.
- Portal reflow at 320, 390, 760, 768, 1024, 1240 and 1536px, mobile application reflow, sign-in reflow at 320, 390, 768 and 1536px, and mobile drawer destination focus.
- Zero axe WCAG A/AA violations in the tested sign-in fallback, dashboard, desktop portal/application/report and mobile portal/application/sign-in states. This is bounded test coverage, not a compliance certification.

Syntax checks, original-ID comparison and `git diff --check` passed. Independent static review found no important regressions. Visual QA fixed inherited role-grid rules, footer drag offset, teal/red section surfaces, narrow ticket controls, mobile step minimum widths, contrast failures, and numbered form-label decorations.

## Visual comparison and intentional differences

Compared the latest role preview (`exec-2f2862f1-4972-4af3-9127-170d022f2430.png`) and coordinated form reference (`exec-d4e6eadf-c92d-4ca9-ab2d-d3b5d582d909.png`) with final browser captures using `view_image`. Inspected palette, typography, role-row anatomy, gutters, navigation, field labels, button treatment, FAQ controls, and mobile wrapping. Desktop was reviewed at 1536×1024; mobile at 390×844. The restrained visual direction was verified across the implemented surfaces.

Existing role order, descriptions, questions, rules, staff-edited About content, announcements and availability are retained. The preview's unimplemented “save your progress” claim and closed-role “View details” actions are intentionally omitted. Existing duplicate title/subtitle/logo visibility follows the previous portal; none of those saved values was deleted. Existing social preview metadata is unchanged.

The saved announcement says staff applications are closed while Content Creator is open. Both values are preserved; staff should reconcile them before release. Preserving the announcement and editable community copy adds vertical space compared with the concept. The preview's drawn W was implemented as a plain typographic monogram. Supporting concepts show representative form fields; actual configured questions and required account behavior remain intact.

Final screenshots and `calm-qa.json` are in the chat artifact directory under `C:/Users/testa/.codex/visualizations/2026/11/09/01a1c200-a7a1-79e0-aadb-81f06968c3eb/`. Main screenshots: `calm-home-desktop.png`, `calm-home-mobile.png`, `calm-signin-desktop.png`, `calm-signin-mobile.png`; additional captures cover roles, process, application, support, reports, status, dashboard and staff tools.

Production mail delivery, production submissions, and other browser engines were not tested. No live user records were accessed or changed.
