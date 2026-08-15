-- =============================================================================
-- Migration: 20260902000002_hotel_amenities.sql
--
-- Adds 19 hotel-focused amenity flags to `properties` (rooms at hotels) so a
-- hotelier can advertise what their property offers:
--
--   Free parking, Free WiFi, Coffee shop, Airport transportation,
--   Business Center, Banquet room, All Inclusive, 24-hour security,
--   Secured parking, Restaurant, Breakfast available, Breakfast buffet,
--   Shuttle bus service, Car hire, Meeting rooms, 24-hour front desk,
--   Express check-in/check-out, Clothes dryer, Laundry service
--
-- All columns default to FALSE and are nullable to match the pattern of the
-- existing amenity flags (has_cctv, has_parking & co are boolean nullable).
--
-- RE-RUNNABLE: ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
-- =============================================================================

-- Free parking → reuses the existing has_parking flag; this migration adds the
-- remaining hotel amenities as first-class boolean columns.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS has_free_wifi        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_coffee_shop      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_airport_transport BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_business_center  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_banquet_room     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_all_inclusive     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_24h_security     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_secured_parking  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_restaurant       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_breakfast        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_breakfast_buffet BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_shuttle          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_car_hire         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_meeting_rooms    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_24h_front_desk   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_express_checkout BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_clothes_dryer    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_laundry          BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.properties.has_free_wifi IS
  'Free high-speed internet (WiFi) available to guests.';
COMMENT ON COLUMN public.properties.has_coffee_shop IS
  'An on-site coffee shop open to guests.';
COMMENT ON COLUMN public.properties.has_airport_transport IS
  'Airport pickup/drop-off transportation offered.';
COMMENT ON COLUMN public.properties.has_business_center IS
  'Business center with internet access available.';
COMMENT ON COLUMN public.properties.has_banquet_room IS
  'Banquet / function room available for events.';
COMMENT ON COLUMN public.properties.is_all_inclusive IS
  'All-inclusive package (room + meals + drinks).';
COMMENT ON COLUMN public.properties.has_24h_security IS
  '24-hour security on the premises.';
COMMENT ON COLUMN public.properties.has_secured_parking IS
  'Secured parking available for guests.';
COMMENT ON COLUMN public.properties.has_restaurant IS
  'On-site restaurant.';
COMMENT ON COLUMN public.properties.has_breakfast IS
  'Breakfast available (included or at extra cost).';
COMMENT ON COLUMN public.properties.has_breakfast_buffet IS
  'Breakfast buffet served.';
COMMENT ON COLUMN public.properties.has_shuttle IS
  'Shuttle bus service to key destinations.';
COMMENT ON COLUMN public.properties.has_car_hire IS
  'Car hire / rental arranged from the property.';
COMMENT ON COLUMN public.properties.has_meeting_rooms IS
  'Meeting rooms available.';
COMMENT ON COLUMN public.properties.has_24h_front_desk IS
  'Reception staffed 24 hours a day.';
COMMENT ON COLUMN public.properties.has_express_checkout IS
  'Express check-in / check-out available.';
COMMENT ON COLUMN public.properties.has_clothes_dryer IS
  'Clothes dryer available for guest use.';
COMMENT ON COLUMN public.properties.has_laundry IS
  'Laundry service offered.';