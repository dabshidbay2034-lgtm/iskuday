-- =============================================================================
-- Migration: 20260902000003_room_features.sql
--
-- Adds 14 in-room feature flags to `properties` for hotel / BnB rooms and
-- apartments:
--
--   Air conditioning, Desk, Housekeeping, Room service, Refrigerator,
--   Cable / satellite TV, Flatscreen TV, Bath / shower, Safe, Telephone,
--   VIP room facilities, Bottled water, Iron, Complimentary toiletries
--
-- ACCESS MODEL: the user asked that apartments get ONLY the air-conditioning
-- feature; every other feature is for hotel / bnb rooms. That rule is
-- enforced in the UI (AddProperty only shows the appropriate chips per type);
-- the columns themselves are plain nullable booleans matching the existing
-- amenity pattern (has_cctv, has_parking, ...).
--
-- RE-RUNNABLE: ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
-- =============================================================================
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS has_air_conditioning BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_desk            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_housekeeping    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_room_service    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_refrigerator    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_cable_tv        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_flatscreen_tv   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_bath_shower     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_safe            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_telephone       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_vip_facilities  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_bottled_water   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_iron            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_toiletries      BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.properties.has_air_conditioning IS
  'Air conditioning in the room/unit.';
COMMENT ON COLUMN public.properties.has_desk IS
  'A dedicated desk / workspace in the room.';
COMMENT ON COLUMN public.properties.has_housekeeping IS
  'Daily housekeeping service is provided.';
COMMENT ON COLUMN public.properties.has_room_service IS
  'Room service is available.';
COMMENT ON COLUMN public.properties.has_refrigerator IS
  'Refrigerator / minibar in the room.';
COMMENT ON COLUMN public.properties.has_cable_tv IS
  'Cable / satellite channels available on the TV.';
COMMENT ON COLUMN public.properties.has_flatscreen_tv IS
  'Flatscreen TV in the room.';
COMMENT ON COLUMN public.properties.has_bath_shower IS
  'Bathtub and/or shower in the en-suite bathroom.';
COMMENT ON COLUMN public.properties.has_safe IS
  'In-room safe / safety deposit box.';
COMMENT ON COLUMN public.properties.has_telephone IS
  'In-room telephone.';
COMMENT ON COLUMN public.properties.has_vip_facilities IS
  'VIP room facilities (e.g. executive lounge access).';
COMMENT ON COLUMN public.properties.has_bottled_water IS
  'Complimentary bottled water provided.';
COMMENT ON COLUMN public.properties.has_iron IS
  'Iron / ironing board available.';
COMMENT ON COLUMN public.properties.has_toiletries IS
  'Complimentary toiletries in the bathroom.';