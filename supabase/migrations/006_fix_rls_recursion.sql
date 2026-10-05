-- 006_fix_rls_recursion.sql — Fix infinite RLS recursion on public.profiles table.

-- Drop the recursive read policy
drop policy if exists profiles_read_own on public.profiles;

-- Create simple, non-recursive read policy for authenticated users
create policy profiles_read_authenticated on public.profiles for select to authenticated using (true);
