-- Initial application availability. Reruns preserve any schedule already set.
INSERT INTO public.availability (singleton_id, time_zone, weekly_slots)
VALUES (
  1,
  'UTC',
  '[{"day":"Monday","active":true,"start":"09:00","end":"17:00","blackout":[]},{"day":"Tuesday","active":true,"start":"09:00","end":"17:00","blackout":[]},{"day":"Wednesday","active":true,"start":"09:00","end":"17:00","blackout":[]},{"day":"Thursday","active":true,"start":"09:00","end":"17:00","blackout":[]},{"day":"Friday","active":true,"start":"09:00","end":"17:00","blackout":[]},{"day":"Saturday","active":false,"start":"09:00","end":"17:00","blackout":[]},{"day":"Sunday","active":false,"start":"09:00","end":"17:00","blackout":[]}]'::jsonb
)
ON CONFLICT (singleton_id) DO NOTHING;
