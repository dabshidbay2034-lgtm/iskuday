export type PropertyType = "villa" | "apartment" | "hotel" | "bnb" | "commercial";

/** What a listing is for: monthly rent or one-time sale. Only agencies can list for sale. */
export type ListingPurpose = "rent" | "sell";

export type UserRole = "user" | "owner" | "hotel_manager" | "agent" | "admin" | "semi_admin";

export interface Property {
  id: string;
  title: string;
  description: string;
  type: PropertyType;
  price: number;
  deposit: number;
  location: string;
  images: string[];
  owner_id: string;
  org_id?: string | null;
  created_at: string;
  is_available: boolean;
  purpose?: ListingPurpose;
  // House specific
  bedrooms?: number;
  living_rooms?: number;
  kitchens?: number;
  toilets?: number;
  has_cctv?: boolean;
  has_parking?: boolean;
  // Apartment specific
  floor_number?: number;
  has_balcony?: boolean;
  // Hotel specific (price is per night)
  is_daily_rate?: boolean;
  is_furnished?: boolean;
  // Universal amenity
  has_elevator?: boolean;
  // Hotel amenities (20260902000002)
  has_free_wifi?: boolean;
  has_coffee_shop?: boolean;
  has_airport_transport?: boolean;
  has_business_center?: boolean;
  has_banquet_room?: boolean;
  is_all_inclusive?: boolean;
  has_24h_security?: boolean;
  has_secured_parking?: boolean;
  has_restaurant?: boolean;
  has_breakfast?: boolean;
  has_breakfast_buffet?: boolean;
  has_shuttle?: boolean;
  has_car_hire?: boolean;
  has_meeting_rooms?: boolean;
  has_24h_front_desk?: boolean;
  has_express_checkout?: boolean;
  has_clothes_dryer?: boolean;
  has_laundry?: boolean;
  // In-room features (20260902000003) — apartments get air-conditioning,
  // hotel/bnb rooms get the rest.
  has_air_conditioning?: boolean;
  has_desk?: boolean;
  has_housekeeping?: boolean;
  has_room_service?: boolean;
  has_refrigerator?: boolean;
  has_cable_tv?: boolean;
  has_flatscreen_tv?: boolean;
  has_bath_shower?: boolean;
  has_safe?: boolean;
  has_telephone?: boolean;
  has_vip_facilities?: boolean;
  has_bottled_water?: boolean;
  has_iron?: boolean;
  has_toiletries?: boolean;
}

export interface UserProfile {
  id: string;
  full_name: string;
  avatar_url?: string;
  phone?: string;
  role: UserRole;
  is_verified?: boolean;
}
