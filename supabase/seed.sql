-- Initial application availability. Reruns preserve any schedule already set.
INSERT INTO public.availability (singleton_id, time_zone, weekly_slots)
VALUES (
  1,
  'UTC',
  '[{"day":"mon","start":"09:00","end":"17:00"},{"day":"tue","start":"09:00","end":"17:00"},{"day":"wed","start":"09:00","end":"17:00"},{"day":"thu","start":"09:00","end":"17:00"},{"day":"fri","start":"09:00","end":"17:00"}]'::jsonb
)
ON CONFLICT (singleton_id) DO NOTHING;