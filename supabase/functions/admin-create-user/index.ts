import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authorization = req.headers.get("Authorization");
  if (!url || !serviceKey || !authorization?.startsWith("Bearer ")) return respond({ error: "認証が必要です。" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = authorization.slice(7);
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) return respond({ error: "ログインし直してください。" }, 401);

  let payload: { action?: string; id?: string; password?: string; display_name?: string; users?: Array<{ id?: string; password?: string; display_name?: string }> };
  try { payload = await req.json(); } catch { return respond({ error: "入力内容を読み取れません。" }, 400); }

  if (payload.action === "change-password") {
    const currentPassword = payload.currentPassword ?? "";
    const newPassword = payload.newPassword ?? "";
    if (!anonKey || !user.email) return respond({ error: "認証設定が不足しています。管理者に確認してください。" }, 500);
    if (newPassword.length < 10 || newPassword.length > 72) return respond({ error: "新しいパスワードは10〜72文字にしてください。" }, 400);
    const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signedIn, error: passwordError } = await userClient.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (passwordError || signedIn.user?.id !== user.id) return respond({ error: "現在のパスワードが正しくありません。" }, 400);
    const { error: updateError } = await userClient.auth.updateUser({ password: newPassword });
    if (updateError) return respond({ error: "パスワードを変更できませんでした。" }, 400);
    if (user.app_metadata?.must_change_password === true) {
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        app_metadata: { ...user.app_metadata, must_change_password: false },
      });
      if (error) return respond({ error: "パスワードは変更されましたが初回設定を完了できませんでした。再ログインしてもう一度お試しください。" }, 500);
    }
    return respond({ ok: true });
  }

  if (user.app_metadata?.role !== "admin") return respond({ error: "管理者権限が必要です。" }, 403);
  if (payload.action === "list-users") {
    const { data, error } = await admin.from("user_profiles").select("user_id,login_id,display_name,created_at").order("login_id");
    if (error) return respond({ error: "利用者一覧を読み込めませんでした。" }, 500);
    return respond({ accounts: (data ?? []).map((row) => ({ id: row.login_id, display_name: row.display_name, user_id: row.user_id, created_at: row.created_at })) });
  }
  const inputs = payload.action === "create-user"
    ? [{ id: payload.id, password: payload.password, display_name: payload.display_name }]
    : payload.action === "create-users" ? payload.users : null;
  if (!inputs) return respond({ error: "操作を確認してください。" }, 400);
  if (inputs.length < 1 || inputs.length > 100) return respond({ error: "一度に発行できるのは1〜100件です。" }, 400);
  const created: Array<{ id: string; display_name: string; password: string; user_id: string; created_at: string }> = [];
  const failed: Array<{ id: string; error: string }> = [];
  for (const input of inputs) {
    const id = input.id?.trim() ?? "";
    const password = input.password ?? "";
    const displayName = input.display_name?.trim() ?? "";
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(id)) { failed.push({ id, error: "IDは英数字、.、_、- の1〜64文字で入力してください。" }); continue; }
    if (password.length < 12 || password.length > 72) { failed.push({ id, error: "初期パスワードは12〜72文字にしてください。" }); continue; }
    if (displayName.length > 40) { failed.push({ id, error: "表示名は40文字以内にしてください。" }); continue; }
    const email = `${id.toLowerCase()}@${new URL(url).hostname}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username: id }, app_metadata: { must_change_password: true } });
    if (error || !data.user) { failed.push({ id, error: error?.message.includes("already") ? "このIDはすでに発行されています。" : "アカウントを発行できませんでした。" }); continue; }
    const { error: profileError } = await admin.from("user_profiles").upsert({ user_id: data.user.id, login_id: id.toLowerCase(), display_name: displayName }, { onConflict: "user_id" });
    if (profileError) { await admin.auth.admin.deleteUser(data.user.id); failed.push({ id, error: "表示名の保存に失敗したため、発行を取り消しました。" }); continue; }
    created.push({ id, display_name: displayName, password, user_id: data.user.id, created_at: data.user.created_at });
  }
  return respond({ ok: failed.length === 0, created, failed, ...(payload.action === "create-user" && created[0] ? { id: created[0].id, user_id: created[0].user_id } : {}) });
});
