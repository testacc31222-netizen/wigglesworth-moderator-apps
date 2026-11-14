# Wigglesworth campaign rebuild

**Goal:** Replace the previous portal composition with an immersive game campaign and a focused recruitment journey.

**Architecture:** Keep the existing vanilla HTML/JS application and all backend contracts. Recompose the page in index.html, replace showcase.css with the campaign design system, and extend app.js only for role details and application presentation. Keep the exact character PNG and silent footage.

**Design:** An asymmetric oversized headline frames the character. A staged zoom fades into black before footage arrives. An ivory editorial introduction leads into wide gameplay, then an offset portrait community spread. A midnight contribution chapter leads to large numbered role selections and an inline detail spread. Starting an application isolates its existing stepper and receipt. A full-width closing invitation ends the page.

**Constraints:** Existing sign-in gate, IDs, endpoints, role availability, text editing, data and staff tools remain. No invented statistics or game claims. No generated replacement artwork. Discover, Community, Roles, FAQ navigation; immediate Play, Account and application access. Reduced motion uses static imagery and manual video controls.

## Implementation
- [x] Recompose navigation, hero, world/community, recruitment bridge and footer.
- [x] Add accessible role detail/explicit application action and focused application mode.
- [x] Replace showcase styles with a coherent responsive campaign system, including account/status/messages.
- [x] Rebuild staged eye choreography and section reveals with reduced-motion fallback.
- [x] Verify desktop/mobile screenshots, keyboard/mobile navigation, role availability, validation, submission/account/ticket flows using isolated data, shared text editing and staff sorting.
- [x] Review the final diff and report release status.

## Review focus
Hidden required fields must not block the stepper. Closed roles must never expose application actions. Leaving application mode must restore navigation and the selected-role context. The eye scene must reset without compositor drift. Staff configuration and public text overrides must survive the new markup.
