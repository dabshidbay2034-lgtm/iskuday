export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      favorites: {
        Row: {
          created_at: string
          id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      inquiries: {
        Row: {
          created_at: string
          id: string
          message: string
          property_id: string
          sender_email: string
          sender_id: string | null
          sender_name: string
          sender_phone: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          property_id: string
          sender_email: string
          sender_id?: string | null
          sender_name: string
          sender_phone?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          property_id?: string
          sender_email?: string
          sender_id?: string | null
          sender_name?: string
          sender_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inquiries_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_contacts: {
        Row: {
          alt_phone: string | null
          phone: string | null
          updated_at: string
          user_id: string
          whatsapp: string | null
        }
        Insert: {
          alt_phone?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
          whatsapp?: string | null
        }
        Update: {
          alt_phone?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          org_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name: string
          id?: string
          org_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          org_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      staff_permissions: {
        Row: {
          created_at: string
          invited_by: string | null
          org_id: string
          permissions: string[]
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          org_id: string
          permissions?: string[]
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string | null
          org_id?: string
          permissions?: string[]
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          bedrooms: number | null
          created_at: string
          deposit: number
          description: string | null
          floor_number: number | null
          has_24h_front_desk: boolean
          has_24h_security: boolean
          has_air_conditioning: boolean
          has_airport_transport: boolean
          has_balcony: boolean | null
          has_banquet_room: boolean
          has_bath_shower: boolean
          has_bottled_water: boolean
          has_cable_tv: boolean
          has_desk: boolean
          has_flatscreen_tv: boolean
          has_housekeeping: boolean
          has_iron: boolean
          has_refrigerator: boolean
          has_room_service: boolean
          has_safe: boolean
          has_telephone: boolean
          has_toiletries: boolean
          has_vip_facilities: boolean
          has_breakfast: boolean
          has_breakfast_buffet: boolean
          has_business_center: boolean
          has_car_hire: boolean
          has_cctv: boolean | null
          has_clothes_dryer: boolean
          has_coffee_shop: boolean
          has_elevator: boolean
          has_express_checkout: boolean
          has_free_wifi: boolean
          has_laundry: boolean
          has_meeting_rooms: boolean
          has_parking: boolean | null
          has_restaurant: boolean
          has_secured_parking: boolean
          has_shuttle: boolean
          id: string
          is_all_inclusive: boolean
          is_available: boolean
          is_daily_rate: boolean
          is_furnished: boolean | null
          is_hidden: boolean
          is_listed: boolean
          kitchens: number | null
          living_rooms: number | null
          location: string
          occupancy_status: string
          org_id: string | null
          owner_id: string
          price: number
          title: string
          toilets: number | null
          type: Database["public"]["Enums"]["property_type"]
          updated_at: string
          views: number
          purpose: Database["public"]["Enums"]["property_purpose"]
        }
        Insert: {
          bedrooms?: number | null
          created_at?: string
          deposit?: number
          description?: string | null
          floor_number?: number | null
          has_24h_front_desk?: boolean
          has_24h_security?: boolean
          has_air_conditioning?: boolean
          has_airport_transport?: boolean
          has_balcony?: boolean | null
          has_banquet_room?: boolean
          has_bath_shower?: boolean
          has_bottled_water?: boolean
          has_cable_tv?: boolean
          has_desk?: boolean
          has_flatscreen_tv?: boolean
          has_housekeeping?: boolean
          has_iron?: boolean
          has_refrigerator?: boolean
          has_room_service?: boolean
          has_safe?: boolean
          has_telephone?: boolean
          has_toiletries?: boolean
          has_vip_facilities?: boolean
          has_breakfast?: boolean
          has_breakfast_buffet?: boolean
          has_business_center?: boolean
          has_car_hire?: boolean
          has_cctv?: boolean | null
          has_clothes_dryer?: boolean
          has_coffee_shop?: boolean
          has_elevator?: boolean
          has_express_checkout?: boolean
          has_free_wifi?: boolean
          has_laundry?: boolean
          has_meeting_rooms?: boolean
          has_parking?: boolean | null
          has_restaurant?: boolean
          has_secured_parking?: boolean
          has_shuttle?: boolean
          id?: string
          is_all_inclusive?: boolean
          is_available?: boolean
          is_daily_rate?: boolean
          is_furnished?: boolean | null
          is_hidden?: boolean
          is_listed?: boolean
          kitchens?: number | null
          living_rooms?: number | null
          location: string
          occupancy_status?: string
          org_id?: string | null
          owner_id: string
          price: number
          title: string
          toilets?: number | null
          type?: Database["public"]["Enums"]["property_type"]
          updated_at?: string
          views?: number
          purpose?: Database["public"]["Enums"]["property_purpose"]
        }
        Update: {
          bedrooms?: number | null
          created_at?: string
          deposit?: number
          description?: string | null
          floor_number?: number | null
          has_24h_front_desk?: boolean
          has_24h_security?: boolean
          has_air_conditioning?: boolean
          has_airport_transport?: boolean
          has_balcony?: boolean | null
          has_banquet_room?: boolean
          has_bath_shower?: boolean
          has_bottled_water?: boolean
          has_cable_tv?: boolean
          has_desk?: boolean
          has_flatscreen_tv?: boolean
          has_housekeeping?: boolean
          has_iron?: boolean
          has_refrigerator?: boolean
          has_room_service?: boolean
          has_safe?: boolean
          has_telephone?: boolean
          has_toiletries?: boolean
          has_vip_facilities?: boolean
          has_breakfast?: boolean
          has_breakfast_buffet?: boolean
          has_business_center?: boolean
          has_car_hire?: boolean
          has_cctv?: boolean | null
          has_clothes_dryer?: boolean
          has_coffee_shop?: boolean
          has_elevator?: boolean
          has_express_checkout?: boolean
          has_free_wifi?: boolean
          has_laundry?: boolean
          has_meeting_rooms?: boolean
          has_parking?: boolean | null
          has_restaurant?: boolean
          has_secured_parking?: boolean
          has_shuttle?: boolean
          id?: string
          is_all_inclusive?: boolean
          is_available?: boolean
          is_daily_rate?: boolean
          is_furnished?: boolean | null
          is_hidden?: boolean
          is_listed?: boolean
          kitchens?: number | null
          living_rooms?: number | null
          location?: string
          occupancy_status?: string
          org_id?: string | null
          owner_id?: string
          price?: number
          title?: string
          toilets?: number | null
          type?: Database["public"]["Enums"]["property_type"]
          updated_at?: string
          views?: number
          purpose?: Database["public"]["Enums"]["property_purpose"]
        }
        Relationships: []
      }
      property_images: {
        Row: {
          created_at: string
          id: string
          image_url: string
          property_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          image_url: string
          property_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string
          property_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "property_images_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_private: {
        Row: {
          internal_ref: string | null
          org_id: string | null
          private_notes: string | null
          property_id: string
          updated_at: string
        }
        Insert: {
          internal_ref?: string | null
          org_id?: string | null
          private_notes?: string | null
          property_id: string
          updated_at?: string
        }
        Update: {
          internal_ref?: string | null
          org_id?: string | null
          private_notes?: string | null
          property_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_private_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: true
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      rent_ledger: {
        Row: {
          amount_due: number
          amount_paid: number
          created_at: string
          id: string
          marked_by: string | null
          method: string | null
          note: string | null
          org_id: string | null
          paid_at: string | null
          period_month: string
          property_id: string
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          amount_due?: number
          amount_paid?: number
          created_at?: string
          id?: string
          marked_by?: string | null
          method?: string | null
          note?: string | null
          org_id?: string | null
          paid_at?: string | null
          period_month: string
          property_id: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          created_at?: string
          id?: string
          marked_by?: string | null
          method?: string | null
          note?: string | null
          org_id?: string | null
          paid_at?: string | null
          period_month?: string
          property_id?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rent_ledger_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rent_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_inquiries: {
        Row: {
          created_at: string
          id: string
          message: string
          property_id: string | null
          property_ref: string | null
          sender_email: string
          sender_name: string
          sender_phone: string | null
          service_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          property_id?: string | null
          property_ref?: string | null
          sender_email: string
          sender_name: string
          sender_phone?: string | null
          service_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          property_id?: string | null
          property_ref?: string | null
          sender_email?: string
          sender_name?: string
          sender_phone?: string | null
          service_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_inquiries_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_inquiries_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          icon: string | null
          id: string
          image_url: string | null
          is_published: boolean
          price_from: number | null
          price_note: string | null
          slug: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_published?: boolean
          price_from?: number | null
          price_note?: string | null
          slug: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          image_url?: string | null
          is_published?: boolean
          price_from?: number | null
          price_note?: string | null
          slug?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          contact_phone: string | null
          created_at: string
          deposit_held: number
          full_name: string
          id: string
          is_active: boolean
          lease_end: string | null
          lease_start: string | null
          org_id: string | null
          property_id: string | null
        }
        Insert: {
          contact_phone?: string | null
          created_at?: string
          deposit_held?: number
          full_name: string
          id?: string
          is_active?: boolean
          lease_end?: string | null
          lease_start?: string | null
          org_id?: string | null
          property_id?: string | null
        }
        Update: {
          contact_phone?: string | null
          created_at?: string
          deposit_held?: number
          full_name?: string
          id?: string
          is_active?: boolean
          lease_end?: string | null
          lease_start?: string | null
          org_id?: string | null
          property_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenants_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          is_verified: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          is_verified?: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          is_verified?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      utility_bills: {
        Row: {
          amount: number
          created_at: string
          id: string
          meter_reading: number | null
          note: string | null
          org_id: string | null
          period_month: string
          property_id: string
          recorded_by: string | null
          status: string
          updated_at: string
          utility_type: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          meter_reading?: number | null
          note?: string | null
          org_id?: string | null
          period_month: string
          property_id: string
          recorded_by?: string | null
          status?: string
          updated_at?: string
          utility_type: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          meter_reading?: number | null
          note?: string | null
          org_id?: string | null
          period_month?: string
          property_id?: string
          recorded_by?: string | null
          status?: string
          updated_at?: string
          utility_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "utility_bills_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_property_view: {
        Args: { property_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "user"
        | "owner"
        | "hotel_manager"
        | "agent"
        | "admin"
        | "semi_admin"
      property_type: "villa" | "apartment" | "hotel" | "bnb" | "commercial"
      property_purpose: "rent" | "sell"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "user",
        "owner",
        "hotel_manager",
        "agent",
        "admin",
        "semi_admin",
      ],
      property_type: ["villa", "apartment", "hotel", "bnb", "commercial"],
      property_purpose: ["rent", "sell"],
    },
  },
} as const
