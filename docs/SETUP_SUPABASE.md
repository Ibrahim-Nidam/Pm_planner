# Supabase setup (step by step)

1. Create a project at supabase.com. Note the **Project URL** and the **anon public key** (Settings, API).
2. In **SQL Editor**, run the migrations in `supabase/migrations/` **in numeric order**: `001_schema.sql`, `002_functions.sql`, `003_rls.sql`, `004_seed_machines.sql`, `005` … through `023`. Skipping numbers leaves the database with old function versions (for example an old `start_pm` that refuses overdue PMs). Fix any error before moving on — an error like `type "public.pm_tasks" does not exist` means a lower-numbered migration (usually `001_schema.sql`) has not been run on that database yet. Existing databases only need to run the new migrations they have not applied yet.
3. **Authentication, Providers, Email**: turn off "Confirm email".
4. Create the first **team lead** manually: Authentication, Users, Add user, email `lead@pmplanner.local` (or `<username>@pmplanner.local`), a password, tick "Auto confirm". Copy its UUID, then in SQL Editor:
   ```sql
   insert into public.profiles (id, username, full_name, role, must_change_password)
   values ('<UUID>', 'lead', 'Team Lead', 'team_lead', false);
   ```
5. Deploy Edge Functions with the Supabase CLI (`supabase functions deploy admin-create-user admin-reset-password admin-set-active`) and set the secret: `supabase secrets set DEFAULT_PASSWORD=<choose one>`. The service role key is provided to functions automatically.
6. Put the URL and anon key in `js/config.js`.
7. Push to GitHub and enable GitHub Pages (branch `main`, root).
8. Log in as lead, create the 4 technicians (SPECS §4), assign machines, then generate the roster and the first schedule.
