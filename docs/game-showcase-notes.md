# Unified game showcase and recruitment journey

This local revision preserves the existing original character, scroll-through-eye sequence, silent footage, backend, records and staff systems. No new game features, testimonials or statistics are invented. All imagery comes from the supplied assets. The site is still hosted in the existing repository/Render service.

Navigation becomes Discover, Roles, Process and FAQ, plus Play and Account. Existing `#apply` and application IDs remain; `#discover` is an entrance alias. Play is immediately available in the hero and desktop navigation, while a persistent application shortcut bypasses the cinematic sequence and restores the role picker when necessary. The mobile drawer focuses the labeled entrance section for Discover.

A midnight-blue showcase now follows the eye entrance and precedes the ivory recruitment sections. It includes an introductory editorial section, a large real gameplay video, the relocated portrait character/community clip, and a transition into recruitment. The new video uses the already-present silent gameplay resource, so there is no additional media file. All three videos have independent play/pause controls, offscreen pausing, and reduced-motion/manual-play behavior from the existing controller.

The existing managed About/community text remains in Process. Roles, emblems, availability, application questions, validation/progress/confirmation, status lookup, support, reports and staff tools retain their existing handlers. New static copy is included in the shared text catalog. Original user-managed strings may differ from the new default design.

Verification used the established read-only local static fixture (public configuration only) and mocked staff saves, with installed Edge through Playwright. Passed: entrance reset and replay, mouse-wheel zoom, delayed silent reveal, reduced motion; four-item navigation; immediate Play and Apply access; hidden-picker restoration; required-field validation; new showcase ordering and manual silent playback; mobile drawer destination focus; reflow at 320/390/760/768/1024/1440px; no duplicate IDs or JS exceptions; staff newest/oldest sorting, filters, and a public headline edit visible in a separate visitor page. axe WCAG A/AA found no violations in the checked showcase state. Screenshots were inspected locally. These are bounded checks, not certification or production transaction tests.

The existing homepage sign-in gate is preserved, as explicitly confirmed by the user. No production deployment has been performed for this revision.
