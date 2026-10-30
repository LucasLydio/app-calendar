-- Initial application availability. Reruns preserve any schedule already set.
INSERT INTO public.availability (singleton_id, time_zone, weekly_slots)
VALUES (
  1,
  'UTC',
  '[{"day":"Monday","active":true,"start":"09:00","end":"17:00","blackoutSlots":[]},{"day":"Tuesday","active":true,"start":"09:00","end":"17:00","blackoutSlots":[]},{"day":"Wednesday","active":true,"start":"09:00","end":"17:00","blackoutSlots":[]},{"day":"Thursday","active":true,"start":"09:00","end":"17:00","blackoutSlots":[]},{"day":"Friday","active":true,"start":"09:00","end":"17:00","blackoutSlots":[]},{"day":"Saturday","active":false,"start":"09:00","end":"17:00","blackoutSlots":[]},{"day":"Sunday","active":false,"start":"09:00","end":"17:00","blackoutSlots":[]}]'::jsonb
)
ON CONFLICT (singleton_id) DO NOTHING;
