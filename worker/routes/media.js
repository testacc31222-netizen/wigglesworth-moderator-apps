// Raw media uploads. Byte sniffing, R2 storage and URL shaping live in
// worker/uploads.js; this module only registers the routes and checks auth.

import { json } from '../http.js';
import { audit, isStaffAdmin } from './misc.js';
import { handleEvidenceUpload, handleVideoUpload } from '../uploads.js';

export function register(router) {
  router.post('/api/admin/upload-video', async c => {
    if (!await isStaffAdmin(c)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    const res = await handleVideoUpload(c);
    // server.js audits the stored video name under vids/.
    if (res.ok) {
      try {
        const j = await res.clone().json();
        const raw = String(j.rawUrl || j.url || '');
        const m = /\/evidence\/ev-([^/]+)$/.exec(raw) || /\/vids\/([^/]+)$/.exec(raw);
        if (m) {
          audit(c, 'video_upload', 'vids/' + m[1]);
          await c.store.save();
        }
      } catch {}
    }
    return res;
  });

  router.post('/api/report-evidence', c => handleEvidenceUpload(c));
}
