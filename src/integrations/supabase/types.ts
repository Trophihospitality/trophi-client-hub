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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      client_activity: {
        Row: {
          actor: string
          actor_id: string | null
          business_id: string
          description: string
          id: string
          timestamp: string
          type: string
        }
        Insert: {
          actor: string
          actor_id?: string | null
          business_id: string
          description: string
          id?: string
          timestamp?: string
          type: string
        }
        Update: {
          actor?: string
          actor_id?: string | null
          business_id?: string
          description?: string
          id?: string
          timestamp?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_activity_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["business_id"]
          },
        ]
      }
      client_attachments: {
        Row: {
          business_id: string
          file_name: string
          file_size: number
          file_type: string
          id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string
          uploaded_by_name: string
        }
        Insert: {
          business_id: string
          file_name: string
          file_size: number
          file_type: string
          id?: string
          storage_path: string
          uploaded_at?: string
          uploaded_by: string
          uploaded_by_name: string
        }
        Update: {
          business_id?: string
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string
          uploaded_by_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_attachments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["business_id"]
          },
        ]
      }
      client_notes: {
        Row: {
          author_id: string
          author_name: string
          body: string
          business_id: string
          created_at: string
          id: string
        }
        Insert: {
          author_id: string
          author_name: string
          body: string
          business_id: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string
          author_name?: string
          body?: string
          business_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["business_id"]
          },
        ]
      }
      clients: {
        Row: {
          brands: string[]
          budget: number | null
          business_id: string
          client_type: string
          company: string
          contact_email: string
          contact_name: string
          contact_phone: string
          contact_role: string | null
          created_at: string
          is_decision_maker: boolean
          journey_status: string
          last_contact_date: string | null
          last_contact_method: string
          lead_source: string | null
          next_follow_up_date: string | null
          onboarding_sent_at: string | null
          package_type: string
          sales_person_id: string
          sent_to_onboarding: boolean
          updated_at: string
        }
        Insert: {
          brands?: string[]
          budget?: number | null
          business_id: string
          client_type: string
          company: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          contact_role?: string | null
          created_at?: string
          is_decision_maker?: boolean
          journey_status?: string
          last_contact_date?: string | null
          last_contact_method?: string
          lead_source?: string | null
          next_follow_up_date?: string | null
          onboarding_sent_at?: string | null
          package_type?: string
          sales_person_id: string
          sent_to_onboarding?: boolean
          updated_at?: string
        }
        Update: {
          brands?: string[]
          budget?: number | null
          business_id?: string
          client_type?: string
          company?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string
          contact_role?: string | null
          created_at?: string
          is_decision_maker?: boolean
          journey_status?: string
          last_contact_date?: string | null
          last_contact_method?: string
          lead_source?: string | null
          next_follow_up_date?: string | null
          onboarding_sent_at?: string | null
          package_type?: string
          sales_person_id?: string
          sent_to_onboarding?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      contact_logs: {
        Row: {
          business_id: string
          contact_date: string
          created_at: string
          discussion: string
          id: string
          logged_by: string
          logged_by_name: string
          method: string
        }
        Insert: {
          business_id: string
          contact_date: string
          created_at?: string
          discussion: string
          id?: string
          logged_by: string
          logged_by_name: string
          method: string
        }
        Update: {
          business_id?: string
          contact_date?: string
          created_at?: string
          discussion?: string
          id?: string
          logged_by?: string
          logged_by_name?: string
          method?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["business_id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          assigned_to: string
          business_id: string
          completed_at: string | null
          created_at: string
          created_by: string
          due_date: string
          id: string
          rescheduled_to: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to: string
          business_id: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          due_date: string
          id?: string
          rescheduled_to?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string
          business_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          due_date?: string
          id?: string
          rescheduled_to?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "follow_ups_rescheduled_to_fkey"
            columns: ["rescheduled_to"]
            isOneToOne: false
            referencedRelation: "follow_ups"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string
          business_id: string
          city: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          location_id: string
          name: string
          needs_onboarding: boolean
          state: string
          status: string
        }
        Insert: {
          address?: string
          business_id: string
          city?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          location_id: string
          name: string
          needs_onboarding?: boolean
          state?: string
          status?: string
        }
        Update: {
          address?: string
          business_id?: string
          city?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          location_id?: string
          name?: string
          needs_onboarding?: boolean
          state?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["business_id"]
          },
        ]
      }
      onboarding_records: {
        Row: {
          account_manager_id: string | null
          business_id: string
          created_at: string
          current_step: number
          specialist_id: string | null
          started_at: string
          status: string
          updated_at: string
          went_live_at: string | null
        }
        Insert: {
          account_manager_id?: string | null
          business_id: string
          created_at?: string
          current_step?: number
          specialist_id?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          went_live_at?: string | null
        }
        Update: {
          account_manager_id?: string | null
          business_id?: string
          created_at?: string
          current_step?: number
          specialist_id?: string | null
          started_at?: string
          status?: string
          updated_at?: string
          went_live_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_records_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "onboarding_records_current_step_fkey"
            columns: ["current_step"]
            isOneToOne: false
            referencedRelation: "onboarding_step_definitions"
            referencedColumns: ["step_number"]
          },
        ]
      }
      onboarding_step_definitions: {
        Row: {
          actor: string
          client_visible: boolean
          description: string | null
          name: string
          step_number: number
        }
        Insert: {
          actor: string
          client_visible?: boolean
          description?: string | null
          name: string
          step_number: number
        }
        Update: {
          actor?: string
          client_visible?: boolean
          description?: string | null
          name?: string
          step_number?: number
        }
        Relationships: []
      }
      onboarding_step_progress: {
        Row: {
          business_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          started_at: string | null
          status: string
          step_number: number
          updated_at: string
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          started_at?: string | null
          status?: string
          step_number: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          started_at?: string | null
          status?: string
          step_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_step_progress_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "onboarding_records"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "onboarding_step_progress_step_number_fkey"
            columns: ["step_number"]
            isOneToOne: false
            referencedRelation: "onboarding_step_definitions"
            referencedColumns: ["step_number"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      business_hours_since: { Args: { _ts: string }; Returns: number }
      can_access_client: { Args: { _business_id: string }; Returns: boolean }
      can_view_onboarding: { Args: { _business_id: string }; Returns: boolean }
      ensure_onboarding_for_client: {
        Args: { _business_id: string }
        Returns: undefined
      }
      gen_business_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_privileged: { Args: { _user_id: string }; Returns: boolean }
      sync_client_next_follow_up: {
        Args: { _business_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "manager"
        | "sales_rep"
        | "admin"
        | "onboarding_specialist"
        | "account_manager"
        | "client_admin"
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
        "manager",
        "sales_rep",
        "admin",
        "onboarding_specialist",
        "account_manager",
        "client_admin",
      ],
    },
  },
} as const
