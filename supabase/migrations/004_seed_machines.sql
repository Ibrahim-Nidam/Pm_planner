-- 004_seed_machines.sql — machines from the October 2026 PDF, in the PDF order. Run FOURTH.
-- technician_id is left NULL: create the technicians in the app first (SPECS §4), then assign machines in lead/machines.html.
-- location is left NULL: set it in lead/machines.html once known (SPECS §14 Q1). Terminal 1 / Transit, 6 lines each.
-- pm_per_month: 2 for K278–K290, 1 for K887U–K933U, 0 for K291 (out of service, is_active = false).
insert into public.machines (code, line, sort_order, pm_per_month) values
  ('K278',  'L2',  1, 2),
  ('K279',  'L5',  2, 2),
  ('K280',  'L1',  3, 2),
  ('K288',  'L4',  4, 2),
  ('K289',  'L3',  5, 2),
  ('K290',  'L6',  6, 2),
  ('K291',  null,  7, 0), -- out of service
  ('K887U', 'L1',  8, 1),
  ('K888U', 'L2',  9, 1),
  ('K889U', 'L3', 10, 1),
  ('K931U', 'L4', 11, 1),
  ('K932U', 'L5', 12, 1),
  ('K933U', 'L6', 13, 1)
on conflict (code) do nothing;

update public.machines set is_active = false where code = 'K291';
