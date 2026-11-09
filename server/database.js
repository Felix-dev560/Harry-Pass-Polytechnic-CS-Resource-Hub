'use strict';
const { createClient } = require('@supabase/supabase-js');
require('./config');

// Service-role client: server-side only. Never expose this key to the browser.
module.exports = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
