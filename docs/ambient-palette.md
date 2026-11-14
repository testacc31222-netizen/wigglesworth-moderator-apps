# Copper and ice ambient palette

Replaced bright ivory public/account backgrounds with static midnight gradients lit by subdued orange at the left edge and icy blue at the right. Navigation, inputs, application steps, messages, status badges and staff surfaces use corresponding dark fills and readable light text. Former ivory primary actions now use a restrained copper-to-blue treatment. The original character, footage and animation behavior are unchanged.

Implemented in ambient.css, loaded after the existing campaign styles on the main and account pages. Static gradients add no animation loop, filters, or JavaScript. Existing reduced-motion behavior remains intact.

Verification used local Edge/Playwright because the Browser plugin is unavailable. WCAG A/AA checks passed for the public page, role details, application and validation states, reports, sign-in and signed-in dashboard. Staff application/general/text editor contrast checks passed. Public/account reflow passed at 320/390/760/1024/1440 px. Staff newest/oldest sorting, review filters and shared text editing passed with mocked local data. No browser exceptions; screenshots inspected for desktop world/community/roles/forms and desktop/mobile account pages.

Only presentation styles and stylesheet links changed. No backend, data, endpoint or dependency changes.
