(() => {
  const cfg = window.APP_CONFIG || {};
  window.authClient = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;
  window.authEmail = id => `${id.trim().toLowerCase()}@${new URL(cfg.SUPABASE_URL).hostname}`;
})();
