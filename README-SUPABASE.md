# Sentence Studio の認証設定

利用者に公開登録はありません。管理者がマイページでアカウント（IDと初期パスワード）を発行し、利用者は `login.html` からログインします。初回ログイン時は `mypage.html` でパスワード変更が必要です。

## Supabase の準備

1. Supabase Authentication の Email provider を有効にします。
2. 架空のメール形式 `ID@<project-ref>.supabase.co` をログインIDに使うため、Authentication の **Confirm email を OFF** にします。管理者発行時は Edge Function が確認済みアカウントを作成します。
3. Project Settings → API の Project URL と publishable key（旧 anon key）を `js/supabase-config.js` に設定します。ここに置けるのは公開キーだけです。`service_role` キーはブラウザーのコードや設定ファイルに絶対に置かないでください。
4. SQL Editor で `sql/setup.sql` を実行します。
5. Supabase CLI でこのフォルダをプロジェクトにリンクし、`supabase/functions/admin-create-user` をデプロイします。CLI が通常設定する `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を Edge Function のサーバー側環境変数として使います。キーをソースコードに書き込まないでください。

```sh
supabase login
supabase link --project-ref <project-ref>
supabase functions deploy admin-create-user
```

表示名とアカウント一覧を使うため、既存環境では更新した `sql/setup.sql` をもう一度実行して `user_profiles` テーブルを作成してください。既存のAuth利用者はログインIDをもとに一覧へ追加されます。更新した一括発行・一覧取得機能を有効にするには、Edge Function も再デプロイしてください。

## 管理者を1人設定する

最初の管理者アカウントは Supabase Dashboard → Authentication → Users で作成し、IDを利用者と同じルールで決めてください。User details の App Metadata に、次のロールを設定します（User Metadata ではありません）。

```json
{"role":"admin"}
```

既存ユーザーを SQL Editor から設定する場合は、対象UUIDを確認してから以下を実行します。

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where id = '';
```

この管理者でログインして `mypage.html` を開き、「利用者アカウント管理」から一括発行・一覧・範囲印刷を利用できます。表示名はIDと別に管理します。初期パスワードは発行直後の画面でのみ表示・印刷し、データベースには保存しません。管理者権限はサーバー上でログインユーザーの App Metadata を確認して判定します。

## 公開とアクセス

このフォルダをローカルWebサーバーまたは静的ホスティングに配置し、`login.html` を利用者に案内してください。JSONを読み込むため、`index.html` のファイル直開きではなくWebサーバー経由で使います。`index.html` は認証セッションを確認し、ログアウト状態ではログインページへ戻します。回答した各問題の結果は、回答時にSupabaseへ保存されます。テストを中断した場合も、回答済みの結果は残ります。

パスワード変更時は現在のパスワードを再確認します。初回変更の完了フラグは Edge Function が Auth の App Metadata に記録し、ブラウザー側から任意に外せないようにしています。
