// Mirrors the public schema and guest/admin RPCs in supabase/migrations/.
// Replace with Supabase-generated types after applying the schema to a project.
export type Database = {
  public: {
    Tables: {
      services: {
        Row: {
          id: string;
          name: string;
          duration: number;
          price: number;
        };
        Insert: {
          id?: string;
          name: string;
          duration: number;
          price: number;
        };
        Update: {
          id?: string;
          name?: string;
          duration?: number;
          price?: number;
        };
        Relationships: [];
      };
      bookings: {
        Row: {
          id: string;
          customer_name: string;
          phone: string;
          service_id: string;
          slot_time: string;
          end_time: string;
          status: Database["public"]["Enums"]["booking_status"];
        };
        Insert: {
          id?: string;
          customer_name: string;
          phone: string;
          service_id: string;
          slot_time: string;
          // Derived by the database trigger; clients cannot shorten an appointment.
          end_time?: string;
          status?: Database["public"]["Enums"]["booking_status"];
        };
        Update: {
          id?: string;
          customer_name?: string;
          phone?: string;
          service_id?: string;
          slot_time?: string;
          end_time?: string;
          status?: Database["public"]["Enums"]["booking_status"];
        };
        Relationships: [
          {
            foreignKeyName: "bookings_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      list_admin_bookings: {
        Args: {
          p_view: string;
          p_offset?: number;
          p_limit?: number;
        };
        Returns: {
          id: string;
          customer_name: string;
          phone: string;
          service_id: string;
          service_name: string;
          slot_time: string;
          end_time: string;
          status: Database["public"]["Enums"]["booking_status"];
        }[];
      };
      admin_set_booking_status: {
        Args: {
          p_booking_id: string;
          p_status: Database["public"]["Enums"]["booking_status"];
        };
        Returns: {
          id: string;
          customer_name: string;
          phone: string;
          service_id: string;
          slot_time: string;
          end_time: string;
          status: Database["public"]["Enums"]["booking_status"];
        }[];
      };
      get_booking_config: {
        Args: Record<PropertyKey, never>;
        Returns: {
          time_zone: string;
          min_date: string;
          max_date: string;
        }[];
      };
      get_available_slots: {
        Args: {
          p_service_id: string;
          p_date: string;
        };
        Returns: {
          slot_time: string;
        }[];
      };
      create_booking: {
        Args: {
          p_booking_id: string;
          p_service_id: string;
          p_slot_time: string;
          p_customer_name: string;
          p_phone: string;
        };
        Returns: {
          id: string;
          service_id: string;
          customer_name: string;
          phone: string;
          slot_time: string;
          end_time: string;
          status: Database["public"]["Enums"]["booking_status"];
        }[];
      };
    };
    Enums: {
      booking_status: "pending" | "confirmed" | "completed" | "cancelled";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Service = Database["public"]["Tables"]["services"]["Row"];
export type Booking = Database["public"]["Tables"]["bookings"]["Row"];
export type BookingStatus = Database["public"]["Enums"]["booking_status"];
export type AdminBooking = Database["public"]["Functions"]["list_admin_bookings"]["Returns"][number];
export type BookingConfiguration = Database["public"]["Functions"]["get_booking_config"]["Returns"][number];
export type AvailableSlot = Database["public"]["Functions"]["get_available_slots"]["Returns"][number];
export type BookingReceipt = Database["public"]["Functions"]["create_booking"]["Returns"][number];
