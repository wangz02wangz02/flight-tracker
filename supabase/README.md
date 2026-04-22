# Supabase setup

## 1. Run the migration
Open the Supabase SQL editor for your project and paste the contents of
`migrations/0001_init.sql`, or use the Supabase MCP server:

```
claude mcp add --transport http supabase https://mcp.supabase.com/mcp
```

Then in this directory ask Claude to apply the SQL against your linked project.

## 2. Configure Clerk as a third-party auth provider
This is what wires `auth.jwt()->>'sub'` on Supabase to the Clerk user id,
and it is the reason RLS policies actually enforce ownership. Without this
step the frontend cannot talk to RLS-protected tables.

1. In Clerk dashboard → JWT Templates → create a template named `supabase`
   (or use the default session token; Supabase accepts Clerk session tokens directly
   as of the 2025 third-party auth integration).
2. In Supabase dashboard → Authentication → Sign In / Providers → Third-party auth,
   add a new Clerk provider and paste your Clerk Frontend API URL
   (`https://YOUR-CLERK-DOMAIN.clerk.accounts.dev` or the production one).
3. Supabase will now accept the Clerk session token passed by
   `apps/web/src/lib/supabase-browser.ts` and resolve `sub` to the Clerk user id.

## 3. Verify RLS
```sql
-- as anon (no jwt): should fail
select * from public.user_favorites;
-- as a signed-in user: should only return that user's rows
```
