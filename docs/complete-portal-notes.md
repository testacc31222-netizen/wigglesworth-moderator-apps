# Complete portal: implementation and verification

The five requested surfaces now share the approved amethyst/ruins identity. `portal-refresh.css` is a scoped presentation layer; `portal-ui.js` owns accessible support/sign-in tab interaction. `index.html` and `signin.html` restructure the requested surfaces. `app.js` changes only About/role presentation and the relocated ticket loading selector; `signin.js` changes tab focus behavior only.

## Visible changes

- Sign-in: crystalline branding, welcome artwork, readable email-code/ID tabs and input sizes, angular purple primary controls, coherent account dashboard. The old arch, giant background type, essay and red/teal surfaces are removed.
- Community: generated crystal/ruins illustration, readable requirements rows, compact application process strip. Numbered chapter tags and italic marketing headings are removed.
- Roles: horizontal rows with distinct shield/clapperboard/tools/banner emblems, accurate open/closed states, active Apply action and an existing status link. Closed roles are disabled instead of shown as low-opacity clickable cards. New/custom roles get the existing crest fallback.
- Support: one workspace with question/report tabs, draft preservation, keyboard navigation, ticket lookup and evidence upload. Existing field IDs, handlers, private threads and report behavior are retained.
- Status and FAQ: full-width lookup band, generated scroll/seal artwork, readable accordion rows, clear violet borders and useful footer links.
- The homepage hero/navigation remains intact. Original functional HTML IDs are all retained, with no duplicate IDs.

## Data and behavior preservation

No changes to `server.js`, endpoints, application type IDs, authentication protocol, `site-copy.js`, dependency files, `render.yaml` or `data.live.json`. Saved announcements, role availability, role descriptions, questions and staff-edited text remain in the existing data model. Old default About copy is translated for display without rewriting saved values; custom values and future edits still render. About-managed elements are excluded from generated-copy registration so two editor controls do not compete. Legacy FAQ drag offset is normalized to avoid overflow.

## Visual comparison

Section concept references are in `docs/portal-concepts/`: signin, community, roles, support and status. Standalone concepts were compared to corresponding browser-rendered sections, including desktop and mobile. Reviewed points: section hierarchy/spacing, purple-black palette, serif headings/readable form type, angular buttons and borders, role/artwork treatment, form alignment, FAQ density, mobile wrapping and navigation.

The standalone concept header/sidebar is the existing site chrome, not additional repeated headers inside each lower section. Stored custom text can differ from the generated concept examples (the current community title is “Help Wigglesworth”). Production artwork is generated separately and has small illustration differences. The reference-only sign-in help link was omitted because the existing support route itself requires signing in; both real sign-in methods remain present. Mobile layouts adapt the desktop concepts into stacked controls with touch-sized targets.

## Verification

The in-app browser was used first for live local layout inspection and support-tab interaction. Playwright with installed Microsoft Edge provided repeatable section captures and automated regression/accessibility checks against `http://127.0.0.1:3001`. Synthetic records used a separate DATA_FILE; email, Discord and GitHub integrations were disabled. Nothing was submitted to production during local testing.

37 check groups passed in the final run, covering:

- Existing auth gate/protected endpoints; email-off fallback; email and ID validation; keyboard tab focus; real local account recovery/dashboard.
- Saved About editor fields and exclusion from duplicate generated-copy fields; role availability, custom-role fallback, role switching, and Explore roles from an open form.
- Multi-step validation and a complete synthetic application/receipt/status lookup.
- Support tab focus/drafts, ticket creation/lookup/loading state, evidence picker keyboard access, anonymous report, ticket/report deep links.
- FAQ, staff unlock/workspace/lock, mobile drawer focus, reduced motion and no JavaScript runtime errors.
- Main page at 320, 390, 760, 768, 1024, 1240 and 1440px; sign-in from 320px through desktop; no horizontal overflow.
- Zero axe WCAG A/AA violations in tested signed-out desktop, account dashboard, application form, report panel, mobile/desktop portal and mobile sign-in states. This is tested coverage, not a compliance certification.

Screenshot-only email-code previews use a test response with `mailConfigured:true` to show the normal configured state without sending an email. Actual recovery/fallback tests use the unchanged local server endpoints. Syntax checks for app/signin/portal scripts, functional-ID comparison and `git diff --check` passed.

Review findings—competing About copy targets, ticket lookup loading selector and Explore roles targeting a hidden picker—were fixed and covered by regressions. Follow-up review confirmed no outstanding findings.

## Assets

Built-in image generation produced the five section concepts, community artwork, role-emblem sprite and scroll/seal asset. Optimized runtime WebPs total about 233 KB. Existing homepage artwork/crest/button art is reused for continuity; no runtime image-generation service or dependency was added. Asset prompts and sources are recorded in `portal-concepts/prompts.md`.
