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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_generations: {
        Row: {
          created_at: string
          id: string
          kind: string
          succeeded: boolean
          tokens_in: number | null
          tokens_out: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          succeeded?: boolean
          tokens_in?: number | null
          tokens_out?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          succeeded?: boolean
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string
        }
        Relationships: []
      }
      channels: {
        Row: {
          categories: string[]
          created_at: string
          description: string
          id: string
          name: string | null
          primary_goal: string
          strategy: Json | null
          updated_at: string
          upload_frequency: string
          user_id: string
          video_style: string
        }
        Insert: {
          categories?: string[]
          created_at?: string
          description: string
          id?: string
          name?: string | null
          primary_goal: string
          strategy?: Json | null
          updated_at?: string
          upload_frequency: string
          user_id: string
          video_style: string
        }
        Update: {
          categories?: string[]
          created_at?: string
          description?: string
          id?: string
          name?: string | null
          primary_goal?: string
          strategy?: Json | null
          updated_at?: string
          upload_frequency?: string
          user_id?: string
          video_style?: string
        }
        Relationships: []
      }
      checklist_items: {
        Row: {
          completed: boolean
          content: string
          created_at: string
          id: string
          project_id: string
          sort_order: number
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          content: string
          created_at?: string
          id?: string
          project_id: string
          sort_order?: number
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          content?: string
          created_at?: string
          id?: string
          project_id?: string
          sort_order?: number
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "content_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      content_projects: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          idea_id: string | null
          plan: Json | null
          published_at: string | null
          scheduled_date: string | null
          selected_title: string | null
          status: string
          thumbnail: Json | null
          title_candidates: Json
          updated_at: string
          user_id: string
          working_title: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          idea_id?: string | null
          plan?: Json | null
          published_at?: string | null
          scheduled_date?: string | null
          selected_title?: string | null
          status?: string
          thumbnail?: Json | null
          title_candidates?: Json
          updated_at?: string
          user_id: string
          working_title: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          idea_id?: string | null
          plan?: Json | null
          published_at?: string | null
          scheduled_date?: string | null
          selected_title?: string | null
          status?: string
          thumbnail?: Json | null
          title_candidates?: Json
          updated_at?: string
          user_id?: string
          working_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_projects_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_projects_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "video_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          onboarding_completed: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          onboarding_completed?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          onboarding_completed?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      video_analyses: {
        Row: {
          attempt_count: number
          channel_id: string | null
          client_request_id: string | null
          created_at: string
          current_stage: string | null
          duration_sec: number | null
          error_code: string | null
          error_message: string | null
          execution_id: string | null
          file_size_bytes: number | null
          finished_at: string | null
          genre: string
          id: string
          pipeline_version: string
          progress: number | null
          raw_metrics: Json | null
          report: Json | null
          run_token: string | null
          started_at: string | null
          status: string
          storage_deleted_at: string | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          channel_id?: string | null
          client_request_id?: string | null
          created_at?: string
          current_stage?: string | null
          duration_sec?: number | null
          error_code?: string | null
          error_message?: string | null
          execution_id?: string | null
          file_size_bytes?: number | null
          finished_at?: string | null
          genre: string
          id?: string
          pipeline_version?: string
          progress?: number | null
          raw_metrics?: Json | null
          report?: Json | null
          run_token?: string | null
          started_at?: string | null
          status?: string
          storage_deleted_at?: string | null
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          channel_id?: string | null
          client_request_id?: string | null
          created_at?: string
          current_stage?: string | null
          duration_sec?: number | null
          error_code?: string | null
          error_message?: string | null
          execution_id?: string | null
          file_size_bytes?: number | null
          finished_at?: string | null
          genre?: string
          id?: string
          pipeline_version?: string
          progress?: number | null
          raw_metrics?: Json | null
          report?: Json | null
          run_token?: string | null
          started_at?: string | null
          status?: string
          storage_deleted_at?: string | null
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_analyses_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      video_ideas: {
        Row: {
          category: string
          channel_id: string
          created_at: string
          description: string | null
          id: string
          reason: string | null
          saved: boolean
          title: string
          user_id: string
        }
        Insert: {
          category: string
          channel_id: string
          created_at?: string
          description?: string | null
          id?: string
          reason?: string | null
          saved?: boolean
          title: string
          user_id: string
        }
        Update: {
          category?: string
          channel_id?: string
          created_at?: string
          description?: string | null
          id?: string
          reason?: string | null
          saved?: boolean
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_ideas_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_video_analysis_run: {
        Args: { p_id: string }
        Returns: {
          attempt_count: number
          channel_id: string | null
          client_request_id: string | null
          created_at: string
          current_stage: string | null
          duration_sec: number | null
          error_code: string | null
          error_message: string | null
          execution_id: string | null
          file_size_bytes: number | null
          finished_at: string | null
          genre: string
          id: string
          pipeline_version: string
          progress: number | null
          raw_metrics: Json | null
          report: Json | null
          run_token: string | null
          started_at: string | null
          status: string
          storage_deleted_at: string | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_video_analysis: {
        Args: { p_id: string }
        Returns: {
          attempt_count: number
          channel_id: string | null
          client_request_id: string | null
          created_at: string
          current_stage: string | null
          duration_sec: number | null
          error_code: string | null
          error_message: string | null
          execution_id: string | null
          file_size_bytes: number | null
          finished_at: string | null
          genre: string
          id: string
          pipeline_version: string
          progress: number | null
          raw_metrics: Json | null
          report: Json | null
          run_token: string | null
          started_at: string | null
          status: string
          storage_deleted_at: string | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_video_analysis: {
        Args: {
          p_duration_sec?: number
          p_id: string
          p_raw_metrics?: Json
          p_report: Json
          p_run_token: string
        }
        Returns: {
          attempt_count: number
          channel_id: string | null
          client_request_id: string | null
          created_at: string
          current_stage: string | null
          duration_sec: number | null
          error_code: string | null
          error_message: string | null
          execution_id: string | null
          file_size_bytes: number | null
          finished_at: string | null
          genre: string
          id: string
          pipeline_version: string
          progress: number | null
          raw_metrics: Json | null
          report: Json | null
          run_token: string | null
          started_at: string | null
          status: string
          storage_deleted_at: string | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_video_analysis: {
        Args: {
          p_channel_id?: string
          p_client_request_id?: string
          p_genre: string
        }
        Returns: {
          attempt_count: number
          channel_id: string | null
          client_request_id: string | null
          created_at: string
          current_stage: string | null
          duration_sec: number | null
          error_code: string | null
          error_message: string | null
          execution_id: string | null
          file_size_bytes: number | null
          finished_at: string | null
          genre: string
          id: string
          pipeline_version: string
          progress: number | null
          raw_metrics: Json | null
          report: Json | null
          run_token: string | null
          started_at: string | null
          status: string
          storage_deleted_at: string | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_video_analysis: {
        Args: {
          p_error_code: string
          p_error_message?: string
          p_id: string
          p_run_token: string
        }
        Returns: {
          attempt_count: number
          channel_id: string | null
          client_request_id: string | null
          created_at: string
          current_stage: string | null
          duration_sec: number | null
          error_code: string | null
          error_message: string | null
          execution_id: string | null
          file_size_bytes: number | null
          finished_at: string | null
          genre: string
          id: string
          pipeline_version: string
          progress: number | null
          raw_metrics: Json | null
          report: Json | null
          run_token: string | null
          started_at: string | null
          status: string
          storage_deleted_at: string | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_video_analysis_uploaded: {
        Args: { p_id: string }
        Returns: {
          attempt_count: number
          channel_id: string | null
          client_request_id: string | null
          created_at: string
          current_stage: string | null
          duration_sec: number | null
          error_code: string | null
          error_message: string | null
          execution_id: string | null
          file_size_bytes: number | null
          finished_at: string | null
          genre: string
          id: string
          pipeline_version: string
          progress: number | null
          raw_metrics: Json | null
          report: Json | null
          run_token: string | null
          started_at: string | null
          status: string
          storage_deleted_at: string | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      queue_video_analysis: {
        Args: { p_id: string }
        Returns: {
          attempt_count: number
          channel_id: string | null
          client_request_id: string | null
          created_at: string
          current_stage: string | null
          duration_sec: number | null
          error_code: string | null
          error_message: string | null
          execution_id: string | null
          file_size_bytes: number | null
          finished_at: string | null
          genre: string
          id: string
          pipeline_version: string
          progress: number | null
          raw_metrics: Json | null
          report: Json | null
          run_token: string | null
          started_at: string | null
          status: string
          storage_deleted_at: string | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_video_analysis_progress: {
        Args: {
          p_id: string
          p_progress: number
          p_run_token: string
          p_stage: string
        }
        Returns: {
          attempt_count: number
          channel_id: string | null
          client_request_id: string | null
          created_at: string
          current_stage: string | null
          duration_sec: number | null
          error_code: string | null
          error_message: string | null
          execution_id: string | null
          file_size_bytes: number | null
          finished_at: string | null
          genre: string
          id: string
          pipeline_version: string
          progress: number | null
          raw_metrics: Json | null
          report: Json | null
          run_token: string | null
          started_at: string | null
          status: string
          storage_deleted_at: string | null
          storage_path: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "video_analyses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
