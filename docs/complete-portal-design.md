# Complete Wigglesworth portal redesign

User request: rework the sign-in page and all four below-hero areas shown in the five screenshots, including layout, colors and buttons; carry the approved purple fantasy homepage through the whole experience and remove the generic editorial/template presentation.

Design direction: extend the already-approved purple-black crystalline/ruins visual system. Clear short headings, normal readable text and controls, silver/lilac text, selective violet highlights, angular buttons, unique role emblems. The homepage hero and primary navigation stay in the approved style.

Approach: reuse the existing HTML/Express site and hooks. A new shared portal stylesheet follows existing styles; focused markup changes restructure the sections. A small presentation controller handles support tabs. Role renderer markup changes only, keeping IDs/config/availability and pickType behavior. No framework migration, backend changes, endpoint changes, role-ID changes or data rewrite.

Sections: sign-in with welcome artwork and a usable form; community illustration and open requirements list; horizontal role rows with availability; support workspace with question/report choices and a ticket lookup; full-width application lookup plus readable FAQ accordion. Sign-in dashboard and application-form states also inherit the new styling.

Constraints: preserve account code and ID sign-in, redirects, application form validation/submission, status, reports/evidence, tickets/threads, staff/admin, saved data and config hooks. All forms retain their IDs, handlers, names and endpoints. Saved announcements and role states remain true to the configuration. Existing custom wording may differ from concept defaults. Purely decorative labels/chapter numbering can be removed. Never send synthetic records/emails to production.

Verification: isolated synthetic DATA_FILE with disabled external integrations; browser checks on desktop/tablet/320px/mobile, sign-in variants, account dashboard, role availability, full submission, support switching/deep links, ticket/report/status, FAQ, keyboard and reduced motion, axe A/AA. Compare each section concept to browser screenshots using view_image. Keep latest remote data when publishing; manual Render deploy to confirmed wigglestotheworth workspace only after checks pass.
