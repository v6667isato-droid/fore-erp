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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      accounting_invoices: {
        Row: {
          amount_ex_tax: number | null
          amount_inc_tax: number | null
          buyer_tax_id: string | null
          created_at: string | null
          deduction_code: number
          deleted_at: string | null
          error: string | null
          exported_at: string | null
          file_hash: string | null
          file_name: string | null
          file_path: string
          file_url: string
          format_code: string
          gmail_account: string | null
          gmail_from: string | null
          gmail_message_id: string | null
          gmail_subject: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          media_type: string | null
          notes: string | null
          purchase_order_id: string | null
          recognized: Json | null
          review_checks: Json | null
          reviewed_at: string | null
          seller_name: string | null
          seller_tax_id: string | null
          source: string
          status: string
          tax_amount: number | null
          tax_type: number
        }
        Insert: {
          amount_ex_tax?: number | null
          amount_inc_tax?: number | null
          buyer_tax_id?: string | null
          created_at?: string | null
          deduction_code?: number
          deleted_at?: string | null
          error?: string | null
          exported_at?: string | null
          file_hash?: string | null
          file_name?: string | null
          file_path: string
          file_url: string
          format_code?: string
          gmail_account?: string | null
          gmail_from?: string | null
          gmail_message_id?: string | null
          gmail_subject?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          media_type?: string | null
          notes?: string | null
          purchase_order_id?: string | null
          recognized?: Json | null
          review_checks?: Json | null
          reviewed_at?: string | null
          seller_name?: string | null
          seller_tax_id?: string | null
          source?: string
          status?: string
          tax_amount?: number | null
          tax_type?: number
        }
        Update: {
          amount_ex_tax?: number | null
          amount_inc_tax?: number | null
          buyer_tax_id?: string | null
          created_at?: string | null
          deduction_code?: number
          deleted_at?: string | null
          error?: string | null
          exported_at?: string | null
          file_hash?: string | null
          file_name?: string | null
          file_path?: string
          file_url?: string
          format_code?: string
          gmail_account?: string | null
          gmail_from?: string | null
          gmail_message_id?: string | null
          gmail_subject?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          media_type?: string | null
          notes?: string | null
          purchase_order_id?: string | null
          recognized?: Json | null
          review_checks?: Json | null
          reviewed_at?: string | null
          seller_name?: string | null
          seller_tax_id?: string | null
          source?: string
          status?: string
          tax_amount?: number | null
          tax_type?: number
        }
        Relationships: [
          {
            foreignKeyName: "accounting_invoices_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          content: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          title: string
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          title: string
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          title?: string
        }
        Relationships: []
      }
      annual_leave_grants: {
        Row: {
          days: number
          employee_id: string
          granted_at: string
          id: string
          milestone_years: number
          note: string | null
        }
        Insert: {
          days: number
          employee_id: string
          granted_at?: string
          id?: string
          milestone_years: number
          note?: string | null
        }
        Update: {
          days?: number
          employee_id?: string
          granted_at?: string
          id?: string
          milestone_years?: number
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "annual_leave_grants_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      attendance_logs: {
        Row: {
          check_type: string
          created_at: string
          distance_meters: number
          employee_id: string
          id: string
          latitude: number
          longitude: number
          source: string
        }
        Insert: {
          check_type: string
          created_at?: string
          distance_meters: number
          employee_id: string
          id?: string
          latitude: number
          longitude: number
          source?: string
        }
        Update: {
          check_type?: string
          created_at?: string
          distance_meters?: number
          employee_id?: string
          id?: string
          latitude?: number
          longitude?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_items: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          parent_part_id: string | null
          part_id: string
          quantity: number
          unit: string | null
          variant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          parent_part_id?: string | null
          part_id: string
          quantity: number
          unit?: string | null
          variant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          parent_part_id?: string | null
          part_id?: string
          quantity?: number
          unit?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_items_parent_part_id_fkey"
            columns: ["parent_part_id"]
            isOneToOne: false
            referencedRelation: "part_stock_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_items_parent_part_id_fkey"
            columns: ["parent_part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_items_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "part_stock_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_items_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_lines: {
        Row: {
          created_at: string
          exclusive_group: string | null
          exclusive_key: string | null
          id: string
          line_type: string
          notes: string | null
          part_id: string | null
          part_variant_id: string | null
          quantity: number
          series_id: string
          unit: string | null
        }
        Insert: {
          created_at?: string
          exclusive_group?: string | null
          exclusive_key?: string | null
          id?: string
          line_type: string
          notes?: string | null
          part_id?: string | null
          part_variant_id?: string | null
          quantity?: number
          series_id: string
          unit?: string | null
        }
        Update: {
          created_at?: string
          exclusive_group?: string | null
          exclusive_key?: string | null
          id?: string
          line_type?: string
          notes?: string | null
          part_id?: string | null
          part_variant_id?: string | null
          quantity?: number
          series_id?: string
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_lines_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "part_stock_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_part_variant_id_fkey"
            columns: ["part_variant_id"]
            isOneToOne: false
            referencedRelation: "part_variant_stock_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_part_variant_id_fkey"
            columns: ["part_variant_id"]
            isOneToOne: false
            referencedRelation: "part_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "product_series"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          code: string | null
          created_at: string | null
          id: string
          name: string
          portal_code: string | null
          portal_password: string | null
          sort_order: number | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          id?: string
          name: string
          portal_code?: string | null
          portal_password?: string | null
          sort_order?: number | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          id?: string
          name?: string
          portal_code?: string | null
          portal_password?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
      company_event: {
        Row: {
          category: string
          created_at: string
          description: string | null
          event_date: string
          id: string
          image_url: string | null
          title: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          event_date: string
          id?: string
          image_url?: string | null
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          event_date?: string
          id?: string
          image_url?: string | null
          title?: string
        }
        Relationships: []
      }
      company_event_assignees: {
        Row: {
          company_event_id: string
          completed: boolean
          employee_id: string
          id: string
          updated_at: string
        }
        Insert: {
          company_event_id: string
          completed?: boolean
          employee_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          company_event_id?: string
          completed?: boolean
          employee_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_event_assignees_company_event_id_fkey"
            columns: ["company_event_id"]
            isOneToOne: false
            referencedRelation: "company_event"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_event_assignees_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          company_name: string | null
          id: number
          tax_id: string | null
          tax_registration_number: string | null
          updated_at: string | null
        }
        Insert: {
          company_name?: string | null
          id?: number
          tax_id?: string | null
          tax_registration_number?: string | null
          updated_at?: string | null
        }
        Update: {
          company_name?: string | null
          id?: number
          tax_id?: string | null
          tax_registration_number?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      custom_cases: {
        Row: {
          base_price: number | null
          case_code: string | null
          category: string | null
          completed_year: string | null
          created_at: string | null
          deleted_at: string | null
          dimension_d: number | null
          dimension_h: number | null
          dimension_w: number | null
          dimensions_note: string | null
          id: string
          image_url: string | null
          kind: string
          material: string | null
          name_en: string | null
          name_zh: string
          notes: string | null
          object_position: string | null
          order_id: string | null
          process_image_urls: Json
          published: boolean
          sort_order: number | null
          story_en: string | null
          story_zh: string | null
        }
        Insert: {
          base_price?: number | null
          case_code?: string | null
          category?: string | null
          completed_year?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dimension_d?: number | null
          dimension_h?: number | null
          dimension_w?: number | null
          dimensions_note?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          material?: string | null
          name_en?: string | null
          name_zh: string
          notes?: string | null
          object_position?: string | null
          order_id?: string | null
          process_image_urls?: Json
          published?: boolean
          sort_order?: number | null
          story_en?: string | null
          story_zh?: string | null
        }
        Update: {
          base_price?: number | null
          case_code?: string | null
          category?: string | null
          completed_year?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dimension_d?: number | null
          dimension_h?: number | null
          dimension_w?: number | null
          dimensions_note?: string | null
          id?: string
          image_url?: string | null
          kind?: string
          material?: string | null
          name_en?: string | null
          name_zh?: string
          notes?: string | null
          object_position?: string | null
          order_id?: string | null
          process_image_urls?: Json
          published?: boolean
          sort_order?: number | null
          story_en?: string | null
          story_zh?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_cases_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          alias: string | null
          channel_id: string | null
          company: string | null
          contact_method: string | null
          contact_person: string | null
          created_at: string | null
          customer_type: string | null
          deleted_at: string | null
          delivery_address: string | null
          has_elevator: boolean
          id: string
          ig_account: string | null
          invoice_carrier: string | null
          invoice_email: string | null
          invoice_title: string | null
          line_id: string | null
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          tax_id: string | null
        }
        Insert: {
          alias?: string | null
          channel_id?: string | null
          company?: string | null
          contact_method?: string | null
          contact_person?: string | null
          created_at?: string | null
          customer_type?: string | null
          deleted_at?: string | null
          delivery_address?: string | null
          has_elevator?: boolean
          id?: string
          ig_account?: string | null
          invoice_carrier?: string | null
          invoice_email?: string | null
          invoice_title?: string | null
          line_id?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          tax_id?: string | null
        }
        Update: {
          alias?: string | null
          channel_id?: string | null
          company?: string | null
          contact_method?: string | null
          contact_person?: string | null
          created_at?: string | null
          customer_type?: string | null
          deleted_at?: string | null
          delivery_address?: string | null
          has_elevator?: boolean
          id?: string
          ig_account?: string | null
          invoice_carrier?: string | null
          invoice_email?: string | null
          invoice_title?: string | null
          line_id?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          tax_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_attendance: {
        Row: {
          attendance_date: string
          clock_in: string | null
          clock_out: string | null
          created_at: string | null
          employee_id: string | null
          id: string
          is_abnormal: boolean | null
          status_tags: string[] | null
          total_hours: number | null
          updated_at: string | null
        }
        Insert: {
          attendance_date: string
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string | null
          employee_id?: string | null
          id?: string
          is_abnormal?: boolean | null
          status_tags?: string[] | null
          total_hours?: number | null
          updated_at?: string | null
        }
        Update: {
          attendance_date?: string
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string | null
          employee_id?: string | null
          id?: string
          is_abnormal?: boolean | null
          status_tags?: string[] | null
          total_hours?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_tasks: {
        Row: {
          created_at: string | null
          due_date: string | null
          employee_id: string
          id: string
          status: string | null
          task_title: string
        }
        Insert: {
          created_at?: string | null
          due_date?: string | null
          employee_id: string
          id?: string
          status?: string | null
          task_title: string
        }
        Update: {
          created_at?: string | null
          due_date?: string | null
          employee_id?: string
          id?: string
          status?: string | null
          task_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_tasks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          annual_leave_remaining: number | null
          comp_leave_remaining: number | null
          created_at: string | null
          daily_wage: number | null
          deleted_at: string | null
          email: string | null
          emergency_contact: string | null
          employment_status: boolean | null
          health_employee_burden: number | null
          health_employee_burden_number: number | null
          health_employer_burden: number | null
          hire_date: string | null
          id: string
          labor_employee_burden: number | null
          labor_employer_burden: number | null
          labor_insurance_bracket: number | null
          labor_pension_employer: number | null
          line_bind_code: string | null
          line_user_id: string | null
          monthly_wage: number | null
          name: string
          overtime_rate: number | null
          payroll_notification_email: string | null
          personal_leave_days: number
          phone: string | null
          primary_role: string | null
          profile_id: string | null
          remittance_account: string | null
          remittance_bank: string | null
          secondary_role: string | null
          share_count: number
          sick_leave_days: number
          timeclock_uid: number | null
          unpaid_leave_months: string[]
        }
        Insert: {
          annual_leave_remaining?: number | null
          comp_leave_remaining?: number | null
          created_at?: string | null
          daily_wage?: number | null
          deleted_at?: string | null
          email?: string | null
          emergency_contact?: string | null
          employment_status?: boolean | null
          health_employee_burden?: number | null
          health_employee_burden_number?: number | null
          health_employer_burden?: number | null
          hire_date?: string | null
          id?: string
          labor_employee_burden?: number | null
          labor_employer_burden?: number | null
          labor_insurance_bracket?: number | null
          labor_pension_employer?: number | null
          line_bind_code?: string | null
          line_user_id?: string | null
          monthly_wage?: number | null
          name: string
          overtime_rate?: number | null
          payroll_notification_email?: string | null
          personal_leave_days?: number
          phone?: string | null
          primary_role?: string | null
          profile_id?: string | null
          remittance_account?: string | null
          remittance_bank?: string | null
          secondary_role?: string | null
          share_count?: number
          sick_leave_days?: number
          timeclock_uid?: number | null
          unpaid_leave_months?: string[]
        }
        Update: {
          annual_leave_remaining?: number | null
          comp_leave_remaining?: number | null
          created_at?: string | null
          daily_wage?: number | null
          deleted_at?: string | null
          email?: string | null
          emergency_contact?: string | null
          employment_status?: boolean | null
          health_employee_burden?: number | null
          health_employee_burden_number?: number | null
          health_employer_burden?: number | null
          hire_date?: string | null
          id?: string
          labor_employee_burden?: number | null
          labor_employer_burden?: number | null
          labor_insurance_bracket?: number | null
          labor_pension_employer?: number | null
          line_bind_code?: string | null
          line_user_id?: string | null
          monthly_wage?: number | null
          name?: string
          overtime_rate?: number | null
          payroll_notification_email?: string | null
          personal_leave_days?: number
          phone?: string | null
          primary_role?: string | null
          profile_id?: string | null
          remittance_account?: string | null
          remittance_bank?: string | null
          secondary_role?: string | null
          share_count?: number
          sick_leave_days?: number
          timeclock_uid?: number | null
          unpaid_leave_months?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      inquiries: {
        Row: {
          contact: string
          created_at: string
          id: string
          message: string | null
          name: string
          status: string
          type: string | null
        }
        Insert: {
          contact: string
          created_at?: string
          id?: string
          message?: string | null
          name: string
          status?: string
          type?: string | null
        }
        Update: {
          contact?: string
          created_at?: string
          id?: string
          message?: string | null
          name?: string
          status?: string
          type?: string | null
        }
        Relationships: []
      }
      invoice_scans: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          error: string | null
          file_name: string | null
          file_path: string
          file_url: string
          id: string
          media_type: string | null
          purchase_order_id: string | null
          recognized: Json | null
          reviewed_at: string | null
          status: string
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          error?: string | null
          file_name?: string | null
          file_path: string
          file_url: string
          id?: string
          media_type?: string | null
          purchase_order_id?: string | null
          recognized?: Json | null
          reviewed_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          error?: string | null
          file_name?: string | null
          file_path?: string
          file_url?: string
          id?: string
          media_type?: string | null
          purchase_order_id?: string | null
          recognized?: Json | null
          reviewed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_scans_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_posts: {
        Row: {
          content_en: Json
          content_zh: Json
          created_at: string
          deleted_at: string | null
          excerpt_en: string | null
          excerpt_zh: string | null
          id: string
          image_url: string | null
          notes: string | null
          object_position: string | null
          post_code: string
          post_date: string
          published: boolean
          sort_order: number | null
          tag: string
          title_en: string | null
          title_zh: string
          updated_at: string
        }
        Insert: {
          content_en?: Json
          content_zh?: Json
          created_at?: string
          deleted_at?: string | null
          excerpt_en?: string | null
          excerpt_zh?: string | null
          id?: string
          image_url?: string | null
          notes?: string | null
          object_position?: string | null
          post_code: string
          post_date?: string
          published?: boolean
          sort_order?: number | null
          tag?: string
          title_en?: string | null
          title_zh: string
          updated_at?: string
        }
        Update: {
          content_en?: Json
          content_zh?: Json
          created_at?: string
          deleted_at?: string | null
          excerpt_en?: string | null
          excerpt_zh?: string | null
          id?: string
          image_url?: string | null
          notes?: string | null
          object_position?: string | null
          post_code?: string
          post_date?: string
          published?: boolean
          sort_order?: number | null
          tag?: string
          title_en?: string | null
          title_zh?: string
          updated_at?: string
        }
        Relationships: []
      }
      leave_requests: {
        Row: {
          attachment_url: string | null
          created_at: string | null
          employee_id: string
          end_date: string
          hours_count: number | null
          id: string
          leave_type: string
          reason: string | null
          start_date: string
          status: string | null
          total_days: number
          updated_at: string
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string | null
          employee_id: string
          end_date: string
          hours_count?: number | null
          id?: string
          leave_type: string
          reason?: string | null
          start_date: string
          status?: string | null
          total_days: number
          updated_at?: string
        }
        Update: {
          attachment_url?: string | null
          created_at?: string | null
          employee_id?: string
          end_date?: string
          hours_count?: number | null
          id?: string
          leave_type?: string
          reason?: string | null
          start_date?: string
          status?: string | null
          total_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          active: boolean
          annual_limit_days: number | null
          approval_notes: string | null
          category: string
          code: string
          description: string | null
          name: string
          pay_ratio: number
          proof_required: string
          proof_threshold_days: number | null
          sort_order: number
          statutory_days: number | null
          tracks_balance: boolean
        }
        Insert: {
          active?: boolean
          annual_limit_days?: number | null
          approval_notes?: string | null
          category: string
          code: string
          description?: string | null
          name: string
          pay_ratio?: number
          proof_required?: string
          proof_threshold_days?: number | null
          sort_order?: number
          statutory_days?: number | null
          tracks_balance?: boolean
        }
        Update: {
          active?: boolean
          annual_limit_days?: number | null
          approval_notes?: string | null
          category?: string
          code?: string
          description?: string | null
          name?: string
          pay_ratio?: number
          proof_required?: string
          proof_threshold_days?: number | null
          sort_order?: number
          statutory_days?: number | null
          tracks_balance?: boolean
        }
        Relationships: []
      }
      materials: {
        Row: {
          aliases: string[]
          code: string
          created_at: string
          name_zh: string
          sort_order: number
        }
        Insert: {
          aliases?: string[]
          code: string
          created_at?: string
          name_zh: string
          sort_order?: number
        }
        Update: {
          aliases?: string[]
          code?: string
          created_at?: string
          name_zh?: string
          sort_order?: number
        }
        Relationships: []
      }
      option_types: {
        Row: {
          code: string
          id: string
          name_zh: string
          sort_order: number
        }
        Insert: {
          code: string
          id?: string
          name_zh: string
          sort_order?: number
        }
        Update: {
          code?: string
          id?: string
          name_zh?: string
          sort_order?: number
        }
        Relationships: []
      }
      option_values: {
        Row: {
          code: string
          created_at: string
          id: string
          name_zh: string
          option_type_id: string
          price_delta: number
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name_zh: string
          option_type_id: string
          price_delta?: number
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name_zh?: string
          option_type_id?: string
          price_delta?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "option_values_option_type_id_fkey"
            columns: ["option_type_id"]
            isOneToOne: false
            referencedRelation: "option_types"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          channel_unit_price: number | null
          created_at: string | null
          custom_case_id: string | null
          custom_category: string | null
          custom_description: string | null
          custom_dimension_d: number | null
          custom_dimension_h: number | null
          custom_dimension_w: number | null
          custom_name: string | null
          custom_notes: string | null
          id: string
          image_url: string | null
          line_order: number
          order_id: string | null
          quantity: number
          seat_height_cm: number | null
          unit_price: number
          variant_id: string | null
          wood_type: string | null
        }
        Insert: {
          channel_unit_price?: number | null
          created_at?: string | null
          custom_case_id?: string | null
          custom_category?: string | null
          custom_description?: string | null
          custom_dimension_d?: number | null
          custom_dimension_h?: number | null
          custom_dimension_w?: number | null
          custom_name?: string | null
          custom_notes?: string | null
          id?: string
          image_url?: string | null
          line_order?: number
          order_id?: string | null
          quantity?: number
          seat_height_cm?: number | null
          unit_price: number
          variant_id?: string | null
          wood_type?: string | null
        }
        Update: {
          channel_unit_price?: number | null
          created_at?: string | null
          custom_case_id?: string | null
          custom_category?: string | null
          custom_description?: string | null
          custom_dimension_d?: number | null
          custom_dimension_h?: number | null
          custom_dimension_w?: number | null
          custom_name?: string | null
          custom_notes?: string | null
          id?: string
          image_url?: string | null
          line_order?: number
          order_id?: string | null
          quantity?: number
          seat_height_cm?: number | null
          unit_price?: number
          variant_id?: string | null
          wood_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_custom_case_id_fkey"
            columns: ["custom_case_id"]
            isOneToOne: false
            referencedRelation: "custom_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          customer_id: string | null
          deleted_at: string | null
          deposit_amount: number | null
          deposit_date: string | null
          expected_delivery_date: string | null
          explanation_image_url: string | null
          final_payment_amount: number | null
          final_payment_date: string | null
          id: string
          internal_notes: string | null
          invoice_tax_id: string | null
          invoice_title: string | null
          order_date: string | null
          order_number: string
          payment_status: string | null
          shipping_address: string | null
          shipping_contact_name: string | null
          shipping_contact_phone: string | null
          shipping_fee: number
          shipping_has_elevator: boolean | null
          source: string | null
          status: string | null
          total_amount: number | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          deposit_amount?: number | null
          deposit_date?: string | null
          expected_delivery_date?: string | null
          explanation_image_url?: string | null
          final_payment_amount?: number | null
          final_payment_date?: string | null
          id?: string
          internal_notes?: string | null
          invoice_tax_id?: string | null
          invoice_title?: string | null
          order_date?: string | null
          order_number: string
          payment_status?: string | null
          shipping_address?: string | null
          shipping_contact_name?: string | null
          shipping_contact_phone?: string | null
          shipping_fee?: number
          shipping_has_elevator?: boolean | null
          source?: string | null
          status?: string | null
          total_amount?: number | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          deposit_amount?: number | null
          deposit_date?: string | null
          expected_delivery_date?: string | null
          explanation_image_url?: string | null
          final_payment_amount?: number | null
          final_payment_date?: string | null
          id?: string
          internal_notes?: string | null
          invoice_tax_id?: string | null
          invoice_title?: string | null
          order_date?: string | null
          order_number?: string
          payment_status?: string | null
          shipping_address?: string | null
          shipping_contact_name?: string | null
          shipping_contact_phone?: string | null
          shipping_fee?: number
          shipping_has_elevator?: boolean | null
          source?: string | null
          status?: string | null
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      overtime_records: {
        Row: {
          created_at: string | null
          created_by: string | null
          employee_id: string | null
          hours: number
          id: string
          overtime_date: string
          reason: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          employee_id?: string | null
          hours: number
          id?: string
          overtime_date: string
          reason?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          employee_id?: string | null
          hours?: number
          id?: string
          overtime_date?: string
          reason?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "overtime_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      part_make_tasks: {
        Row: {
          assignee_id: string
          completed: boolean
          completed_at: string | null
          created_at: string | null
          due_date: string | null
          id: string
          instructions: string | null
          items: Json
        }
        Insert: {
          assignee_id: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          instructions?: string | null
          items?: Json
        }
        Update: {
          assignee_id?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          instructions?: string | null
          items?: Json
        }
        Relationships: [
          {
            foreignKeyName: "part_make_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      part_option_groups: {
        Row: {
          category: string
          code: string
          created_at: string
          deleted_at: string | null
          id: string
          name_zh: string
          notes: string | null
          sort_order: number
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name_zh: string
          notes?: string | null
          sort_order?: number
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name_zh?: string
          notes?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      part_option_values: {
        Row: {
          code: string
          created_at: string
          deleted_at: string | null
          group_id: string
          id: string
          name_zh: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          deleted_at?: string | null
          group_id: string
          id?: string
          name_zh: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          deleted_at?: string | null
          group_id?: string
          id?: string
          name_zh?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "part_option_values_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "part_option_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      part_variants: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          material_code: string | null
          part_id: string
          reorder_point_override: number | null
          safety_stock_override: number | null
          sku: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          material_code?: string | null
          part_id: string
          reorder_point_override?: number | null
          safety_stock_override?: number | null
          sku: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          material_code?: string | null
          part_id?: string
          reorder_point_override?: number | null
          safety_stock_override?: number | null
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "part_variants_material_code_fkey"
            columns: ["material_code"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "part_variants_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "part_stock_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_variants_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      parts: {
        Row: {
          attachment_urls: Json
          category: string
          created_at: string | null
          deleted_at: string | null
          dim_length_mm: number | null
          dim_thickness_mm: number | null
          dim_width_mm: number | null
          drawing_url: string | null
          has_material_axis: boolean
          id: string
          is_component: boolean
          name: string
          name_code: string | null
          notes: string | null
          part_no: string
          procurement_material_id: string | null
          procurement_type: string
          reference_unit_price: number | null
          reorder_point: number
          safety_stock: number
          series_id: string | null
          sop: string | null
          source_type: string
          unit: string
          vendor_id: string | null
          wood_species: string | null
        }
        Insert: {
          attachment_urls?: Json
          category: string
          created_at?: string | null
          deleted_at?: string | null
          dim_length_mm?: number | null
          dim_thickness_mm?: number | null
          dim_width_mm?: number | null
          drawing_url?: string | null
          has_material_axis?: boolean
          id?: string
          is_component?: boolean
          name: string
          name_code?: string | null
          notes?: string | null
          part_no: string
          procurement_material_id?: string | null
          procurement_type?: string
          reference_unit_price?: number | null
          reorder_point?: number
          safety_stock?: number
          series_id?: string | null
          sop?: string | null
          source_type?: string
          unit?: string
          vendor_id?: string | null
          wood_species?: string | null
        }
        Update: {
          attachment_urls?: Json
          category?: string
          created_at?: string | null
          deleted_at?: string | null
          dim_length_mm?: number | null
          dim_thickness_mm?: number | null
          dim_width_mm?: number | null
          drawing_url?: string | null
          has_material_axis?: boolean
          id?: string
          is_component?: boolean
          name?: string
          name_code?: string | null
          notes?: string | null
          part_no?: string
          procurement_material_id?: string | null
          procurement_type?: string
          reference_unit_price?: number | null
          reorder_point?: number
          safety_stock?: number
          series_id?: string | null
          sop?: string | null
          source_type?: string
          unit?: string
          vendor_id?: string | null
          wood_species?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parts_procurement_material_id_fkey"
            columns: ["procurement_material_id"]
            isOneToOne: false
            referencedRelation: "procurement_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "product_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          base_salary: number
          bonus_and_overtime: number
          bonuses: number | null
          comp_leave_remaining_after: number | null
          created_at: string | null
          employee_id: string
          health_insurance_employee: number
          health_insured_persons: number | null
          id: string
          labor_insurance_employee: number
          leave_days: number
          leave_deduction: number
          leave_deductions: number | null
          month_label: string | null
          Name: string | null
          net_pay: number
          net_salary: number
          notes: string | null
          other_adjust: number
          other_leave_days: number
          other_leave_detail: string | null
          overtime_days: number
          pay_period: string
          payment_date: string | null
          payroll_bonus: number
          period_key: string | null
          special_leave_days_settled: number
          special_leave_remaining_after: number | null
          status: string | null
        }
        Insert: {
          base_salary: number
          bonus_and_overtime?: number
          bonuses?: number | null
          comp_leave_remaining_after?: number | null
          created_at?: string | null
          employee_id: string
          health_insurance_employee?: number
          health_insured_persons?: number | null
          id?: string
          labor_insurance_employee?: number
          leave_days?: number
          leave_deduction?: number
          leave_deductions?: number | null
          month_label?: string | null
          Name?: string | null
          net_pay?: number
          net_salary: number
          notes?: string | null
          other_adjust?: number
          other_leave_days?: number
          other_leave_detail?: string | null
          overtime_days?: number
          pay_period: string
          payment_date?: string | null
          payroll_bonus?: number
          period_key?: string | null
          special_leave_days_settled?: number
          special_leave_remaining_after?: number | null
          status?: string | null
        }
        Update: {
          base_salary?: number
          bonus_and_overtime?: number
          bonuses?: number | null
          comp_leave_remaining_after?: number | null
          created_at?: string | null
          employee_id?: string
          health_insurance_employee?: number
          health_insured_persons?: number | null
          id?: string
          labor_insurance_employee?: number
          leave_days?: number
          leave_deduction?: number
          leave_deductions?: number | null
          month_label?: string | null
          Name?: string | null
          net_pay?: number
          net_salary?: number
          notes?: string | null
          other_adjust?: number
          other_leave_days?: number
          other_leave_detail?: string | null
          overtime_days?: number
          pay_period?: string
          payment_date?: string | null
          payroll_bonus?: number
          period_key?: string | null
          special_leave_days_settled?: number
          special_leave_remaining_after?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_bonus_issuance_rows: {
        Row: {
          ability_grade: number
          ability_pct: number
          created_at: string | null
          employee_id: string | null
          employee_name: string
          id: string
          issuance_id: string
          participates_in_profit_sharing: boolean
          performance: number
          performance_pct: number
          profit_sharing_bonus: number
          salary: number
          salary_pct: number
          seniority_label: string | null
          seniority_pct: number
          seniority_years: number
          share_bonus: number
          shares: number
          sort_order: number
          tenure_ratio: number
          total_bonus: number
          total_pct: number
          year_end_bonus: number
        }
        Insert: {
          ability_grade?: number
          ability_pct?: number
          created_at?: string | null
          employee_id?: string | null
          employee_name: string
          id?: string
          issuance_id: string
          participates_in_profit_sharing?: boolean
          performance?: number
          performance_pct?: number
          profit_sharing_bonus?: number
          salary?: number
          salary_pct?: number
          seniority_label?: string | null
          seniority_pct?: number
          seniority_years?: number
          share_bonus?: number
          shares?: number
          sort_order?: number
          tenure_ratio?: number
          total_bonus?: number
          total_pct?: number
          year_end_bonus?: number
        }
        Update: {
          ability_grade?: number
          ability_pct?: number
          created_at?: string | null
          employee_id?: string | null
          employee_name?: string
          id?: string
          issuance_id?: string
          participates_in_profit_sharing?: boolean
          performance?: number
          performance_pct?: number
          profit_sharing_bonus?: number
          salary?: number
          salary_pct?: number
          seniority_label?: string | null
          seniority_pct?: number
          seniority_years?: number
          share_bonus?: number
          shares?: number
          sort_order?: number
          tenure_ratio?: number
          total_bonus?: number
          total_pct?: number
          year_end_bonus?: number
        }
        Relationships: [
          {
            foreignKeyName: "performance_bonus_issuance_rows_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_bonus_issuance_rows_issuance_id_fkey"
            columns: ["issuance_id"]
            isOneToOne: false
            referencedRelation: "performance_bonus_issuances"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_bonus_issuances: {
        Row: {
          cost: number | null
          created_at: string | null
          half: string
          id: string
          issue_year_end_bonus: boolean
          issued_at: string
          profit: number
          profit_meta: string | null
          profit_sharing_pct: number
          profit_sharing_pool: number
          revenue: number | null
          share_bonus_pct: number
          share_bonus_pool: number
          total_bonus: number
          weight_ability: number
          weight_performance: number
          weight_salary: number
          weight_seniority: number
          weighted_profit_sharing_pool: number
          year: number
          year_end_bonus_salary_pct: number
          year_end_bonus_total: number
        }
        Insert: {
          cost?: number | null
          created_at?: string | null
          half: string
          id?: string
          issue_year_end_bonus?: boolean
          issued_at?: string
          profit?: number
          profit_meta?: string | null
          profit_sharing_pct?: number
          profit_sharing_pool?: number
          revenue?: number | null
          share_bonus_pct?: number
          share_bonus_pool?: number
          total_bonus?: number
          weight_ability?: number
          weight_performance?: number
          weight_salary?: number
          weight_seniority?: number
          weighted_profit_sharing_pool?: number
          year: number
          year_end_bonus_salary_pct?: number
          year_end_bonus_total?: number
        }
        Update: {
          cost?: number | null
          created_at?: string | null
          half?: string
          id?: string
          issue_year_end_bonus?: boolean
          issued_at?: string
          profit?: number
          profit_meta?: string | null
          profit_sharing_pct?: number
          profit_sharing_pool?: number
          revenue?: number | null
          share_bonus_pct?: number
          share_bonus_pool?: number
          total_bonus?: number
          weight_ability?: number
          weight_performance?: number
          weight_salary?: number
          weight_seniority?: number
          weighted_profit_sharing_pool?: number
          year?: number
          year_end_bonus_salary_pct?: number
          year_end_bonus_total?: number
        }
        Relationships: []
      }
      procurement_materials: {
        Row: {
          amortization_months: number | null
          created_at: string | null
          id: string
          item_category: string | null
          name: string
          notes: string | null
          spec: string | null
          spec2: string | null
          unit: string | null
        }
        Insert: {
          amortization_months?: number | null
          created_at?: string | null
          id?: string
          item_category?: string | null
          name: string
          notes?: string | null
          spec?: string | null
          spec2?: string | null
          unit?: string | null
        }
        Update: {
          amortization_months?: number | null
          created_at?: string | null
          id?: string
          item_category?: string | null
          name?: string
          notes?: string | null
          spec?: string | null
          spec2?: string | null
          unit?: string | null
        }
        Relationships: []
      }
      product_accessories: {
        Row: {
          category: string
          created_at: string | null
          deleted_at: string | null
          id: string
          image_url: string | null
          material: string | null
          name: string
          notes: string | null
          price: number | null
          sort_order: number | null
          spec: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          material?: string | null
          name: string
          notes?: string | null
          price?: number | null
          sort_order?: number | null
          spec?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          image_url?: string | null
          material?: string | null
          name?: string
          notes?: string | null
          price?: number | null
          sort_order?: number | null
          spec?: string | null
        }
        Relationships: []
      }
      product_options: {
        Row: {
          option_value_id: string
          price_delta_override: number | null
          series_id: string
        }
        Insert: {
          option_value_id: string
          price_delta_override?: number | null
          series_id: string
        }
        Update: {
          option_value_id?: string
          price_delta_override?: number | null
          series_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_options_option_value_id_fkey"
            columns: ["option_value_id"]
            isOneToOne: false
            referencedRelation: "option_values"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_options_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "product_series"
            referencedColumns: ["id"]
          },
        ]
      }
      product_series: {
        Row: {
          base_price: number | null
          category: string | null
          code_rule: string | null
          created_at: string | null
          customization_rules: string | null
          deleted_at: string | null
          design_concept: string | null
          detail_image_urls: Json
          faq_scripts: string | null
          id: string
          image_meta: Json
          image_url: string | null
          notes: string | null
          production_time: string | null
          series_name: string
          size_chart_urls: Json
          social_media_copy: string | null
          website: string | null
          website_article: string | null
        }
        Insert: {
          base_price?: number | null
          category?: string | null
          code_rule?: string | null
          created_at?: string | null
          customization_rules?: string | null
          deleted_at?: string | null
          design_concept?: string | null
          detail_image_urls?: Json
          faq_scripts?: string | null
          id?: string
          image_meta?: Json
          image_url?: string | null
          notes?: string | null
          production_time?: string | null
          series_name: string
          size_chart_urls?: Json
          social_media_copy?: string | null
          website?: string | null
          website_article?: string | null
        }
        Update: {
          base_price?: number | null
          category?: string | null
          code_rule?: string | null
          created_at?: string | null
          customization_rules?: string | null
          deleted_at?: string | null
          design_concept?: string | null
          detail_image_urls?: Json
          faq_scripts?: string | null
          id?: string
          image_meta?: Json
          image_url?: string | null
          notes?: string | null
          production_time?: string | null
          series_name?: string
          size_chart_urls?: Json
          social_media_copy?: string | null
          website?: string | null
          website_article?: string | null
        }
        Relationships: []
      }
      product_series_channel_discounts: {
        Row: {
          channel_id: string
          created_at: string | null
          discount_percent: number
          id: string
          series_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string | null
          discount_percent: number
          id?: string
          series_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string | null
          discount_percent?: number
          id?: string
          series_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_series_channel_discounts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_series_channel_discounts_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "product_series"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variant_channel_prices: {
        Row: {
          channel_id: string
          created_at: string | null
          id: string
          price: number
          variant_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string | null
          id?: string
          price: number
          variant_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string | null
          id?: string
          price?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variant_channel_prices_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variant_channel_prices_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          base_price: number | null
          config_value_id: string | null
          created_at: string | null
          cushion_value_id: string | null
          deleted_at: string | null
          desktop_area: number | null
          dimension_d: number | null
          dimension_h: number | null
          dimension_w: number | null
          id: string
          image_url: string | null
          is_custom_order: boolean
          price_override: number | null
          product_code: string
          seat_height_cm: number | null
          series_id: string | null
          size_value_id: string | null
          spec1: string | null
          wood_type: string | null
          wood_value_id: string | null
        }
        Insert: {
          base_price?: number | null
          config_value_id?: string | null
          created_at?: string | null
          cushion_value_id?: string | null
          deleted_at?: string | null
          desktop_area?: number | null
          dimension_d?: number | null
          dimension_h?: number | null
          dimension_w?: number | null
          id?: string
          image_url?: string | null
          is_custom_order?: boolean
          price_override?: number | null
          product_code: string
          seat_height_cm?: number | null
          series_id?: string | null
          size_value_id?: string | null
          spec1?: string | null
          wood_type?: string | null
          wood_value_id?: string | null
        }
        Update: {
          base_price?: number | null
          config_value_id?: string | null
          created_at?: string | null
          cushion_value_id?: string | null
          deleted_at?: string | null
          desktop_area?: number | null
          dimension_d?: number | null
          dimension_h?: number | null
          dimension_w?: number | null
          id?: string
          image_url?: string | null
          is_custom_order?: boolean
          price_override?: number | null
          product_code?: string
          seat_height_cm?: number | null
          series_id?: string | null
          size_value_id?: string | null
          spec1?: string | null
          wood_type?: string | null
          wood_value_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_config_value_id_fkey"
            columns: ["config_value_id"]
            isOneToOne: false
            referencedRelation: "option_values"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_cushion_value_id_fkey"
            columns: ["cushion_value_id"]
            isOneToOne: false
            referencedRelation: "option_values"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "product_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_size_value_id_fkey"
            columns: ["size_value_id"]
            isOneToOne: false
            referencedRelation: "option_values"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_wood_value_id_fkey"
            columns: ["wood_value_id"]
            isOneToOne: false
            referencedRelation: "option_values"
            referencedColumns: ["id"]
          },
        ]
      }
      production_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string | null
          employee_id: string | null
          id: string
          image_url: string | null
          notes: string | null
          report: string | null
          reported_at: string | null
          source: string | null
          status: string | null
          step_name: string
          step_order: number
          work_order_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          employee_id?: string | null
          id?: string
          image_url?: string | null
          notes?: string | null
          report?: string | null
          reported_at?: string | null
          source?: string | null
          status?: string | null
          step_name: string
          step_order: number
          work_order_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          employee_id?: string | null
          id?: string
          image_url?: string | null
          notes?: string | null
          report?: string | null
          reported_at?: string | null
          source?: string | null
          status?: string | null
          step_name?: string
          step_order?: number
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "production_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_tasks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_tasks_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      project_progress: {
        Row: {
          created_at: string | null
          due_date: string | null
          id: string
          notes: string | null
          progress_pct: number | null
          project_name: string
          start_date: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          progress_pct?: number | null
          project_name: string
          start_date?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          due_date?: string | null
          id?: string
          notes?: string | null
          progress_pct?: number | null
          project_name?: string
          start_date?: string | null
          status?: string | null
        }
        Relationships: []
      }
      public_holidays: {
        Row: {
          created_at: string | null
          holiday_date: string
          id: string
          is_paid: boolean | null
          is_workday: boolean | null
          name: string
        }
        Insert: {
          created_at?: string | null
          holiday_date: string
          id?: string
          is_paid?: boolean | null
          is_workday?: boolean | null
          name: string
        }
        Update: {
          created_at?: string | null
          holiday_date?: string
          id?: string
          is_paid?: boolean | null
          is_workday?: boolean | null
          name?: string
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          created_at: string | null
          deleted_at: string | null
          id: string
          invoice_files: Json
          notes: string | null
          po_number: string
          purchase_date: string
          vendor_name: string | null
        }
        Insert: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          invoice_files?: Json
          notes?: string | null
          po_number: string
          purchase_date?: string
          vendor_name?: string | null
        }
        Update: {
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          invoice_files?: Json
          notes?: string | null
          po_number?: string
          purchase_date?: string
          vendor_name?: string | null
        }
        Relationships: []
      }
      purchases: {
        Row: {
          amortization_months: number | null
          amount_ex_tax: number | null
          created_at: string | null
          deleted_at: string | null
          id: string
          item_category: string | null
          item_name: string
          material_id: string | null
          purchase_date: string
          purchase_order_id: string | null
          quantity: number
          spec: string | null
          spec2: string | null
          tax_included_amount: number | null
          total_amount: number | null
          unit: string | null
          unit_price: number
          unit_price_ex_tax: number | null
          unit_price_inc_tax: number | null
          unit_price_is_tax_inclusive: boolean
          vendor_name: string | null
        }
        Insert: {
          amortization_months?: number | null
          amount_ex_tax?: number | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          item_category?: string | null
          item_name: string
          material_id?: string | null
          purchase_date?: string
          purchase_order_id?: string | null
          quantity?: number
          spec?: string | null
          spec2?: string | null
          tax_included_amount?: number | null
          total_amount?: number | null
          unit?: string | null
          unit_price: number
          unit_price_ex_tax?: number | null
          unit_price_inc_tax?: number | null
          unit_price_is_tax_inclusive?: boolean
          vendor_name?: string | null
        }
        Update: {
          amortization_months?: number | null
          amount_ex_tax?: number | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          item_category?: string | null
          item_name?: string
          material_id?: string | null
          purchase_date?: string
          purchase_order_id?: string | null
          quantity?: number
          spec?: string | null
          spec2?: string | null
          tax_included_amount?: number | null
          total_amount?: number | null
          unit?: string | null
          unit_price?: number
          unit_price_ex_tax?: number | null
          unit_price_inc_tax?: number | null
          unit_price_is_tax_inclusive?: boolean
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "procurement_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_vendor_name_fkey"
            columns: ["vendor_name"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["name"]
          },
        ]
      }
      sales_allowances: {
        Row: {
          allowance_date: string | null
          allowance_number: string | null
          amount_ex_tax: number | null
          amount_inc_tax: number | null
          created_at: string | null
          deleted_at: string | null
          exported_at: string | null
          external_id: string | null
          id: string
          invoice_id: string
          reason: string | null
          status: string
          sync_error: string | null
          sync_status: string
          synced_at: string | null
          tax_amount: number | null
        }
        Insert: {
          allowance_date?: string | null
          allowance_number?: string | null
          amount_ex_tax?: number | null
          amount_inc_tax?: number | null
          created_at?: string | null
          deleted_at?: string | null
          exported_at?: string | null
          external_id?: string | null
          id?: string
          invoice_id: string
          reason?: string | null
          status?: string
          sync_error?: string | null
          sync_status?: string
          synced_at?: string | null
          tax_amount?: number | null
        }
        Update: {
          allowance_date?: string | null
          allowance_number?: string | null
          amount_ex_tax?: number | null
          amount_inc_tax?: number | null
          created_at?: string | null
          deleted_at?: string | null
          exported_at?: string | null
          external_id?: string | null
          id?: string
          invoice_id?: string
          reason?: string | null
          status?: string
          sync_error?: string | null
          sync_status?: string
          synced_at?: string | null
          tax_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_allowances_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoice_items: {
        Row: {
          amount: number
          created_at: string | null
          description: string
          id: string
          invoice_id: string
          order_item_id: string | null
          quantity: number
          sort_order: number
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          amount?: number
          created_at?: string | null
          description: string
          id?: string
          invoice_id: string
          order_item_id?: string | null
          quantity?: number
          sort_order?: number
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string
          id?: string
          invoice_id?: string
          order_item_id?: string | null
          quantity?: number
          sort_order?: number
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoices: {
        Row: {
          amount_ex_tax: number | null
          amount_inc_tax: number | null
          buyer_email: string | null
          buyer_name: string | null
          buyer_tax_id: string | null
          carrier_id: string | null
          carrier_type: string | null
          created_at: string | null
          deleted_at: string | null
          donation_code: string | null
          exported_at: string | null
          external_id: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          invoice_type: string
          issued_at: string | null
          notes: string | null
          order_id: string | null
          print_flag: boolean
          status: string
          sync_error: string | null
          sync_status: string
          synced_at: string | null
          tax_amount: number | null
          tax_type: number
          void_date: string | null
          void_reason: string | null
        }
        Insert: {
          amount_ex_tax?: number | null
          amount_inc_tax?: number | null
          buyer_email?: string | null
          buyer_name?: string | null
          buyer_tax_id?: string | null
          carrier_id?: string | null
          carrier_type?: string | null
          created_at?: string | null
          deleted_at?: string | null
          donation_code?: string | null
          exported_at?: string | null
          external_id?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string
          issued_at?: string | null
          notes?: string | null
          order_id?: string | null
          print_flag?: boolean
          status?: string
          sync_error?: string | null
          sync_status?: string
          synced_at?: string | null
          tax_amount?: number | null
          tax_type?: number
          void_date?: string | null
          void_reason?: string | null
        }
        Update: {
          amount_ex_tax?: number | null
          amount_inc_tax?: number | null
          buyer_email?: string | null
          buyer_name?: string | null
          buyer_tax_id?: string | null
          carrier_id?: string | null
          carrier_type?: string | null
          created_at?: string | null
          deleted_at?: string | null
          donation_code?: string | null
          exported_at?: string | null
          external_id?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string
          issued_at?: string | null
          notes?: string | null
          order_id?: string | null
          print_flag?: boolean
          status?: string
          sync_error?: string | null
          sync_status?: string
          synced_at?: string | null
          tax_amount?: number | null
          tax_type?: number
          void_date?: string | null
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string | null
          employee_id: string | null
          id: string
          movement_date: string
          movement_type: string
          notes: string | null
          order_id: string | null
          part_id: string
          part_variant_id: string | null
          quantity: number
          work_order_id: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id?: string | null
          id?: string
          movement_date?: string
          movement_type: string
          notes?: string | null
          order_id?: string | null
          part_id: string
          part_variant_id?: string | null
          quantity: number
          work_order_id?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string | null
          id?: string
          movement_date?: string
          movement_type?: string
          notes?: string | null
          order_id?: string | null
          part_id?: string
          part_variant_id?: string | null
          quantity?: number
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "part_stock_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_part_variant_id_fkey"
            columns: ["part_variant_id"]
            isOneToOne: false
            referencedRelation: "part_variant_stock_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_part_variant_id_fkey"
            columns: ["part_variant_id"]
            isOneToOne: false
            referencedRelation: "part_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      stocktake_tasks: {
        Row: {
          assignee_id: string
          category: string | null
          completed: boolean
          completed_at: string | null
          created_at: string | null
          due_date: string | null
          id: string
          instructions: string | null
          part_ids: string[] | null
        }
        Insert: {
          assignee_id: string
          category?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          instructions?: string | null
          part_ids?: string[] | null
        }
        Update: {
          assignee_id?: string
          category?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          id?: string
          instructions?: string | null
          part_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "stocktake_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_bot_invites: {
        Row: {
          code: string
          created_at: string
          employee_id: string | null
          expires_at: string
          id: string
          name: string | null
          role: string
          used_at: string | null
          used_by_chat_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          employee_id?: string | null
          expires_at?: string
          id?: string
          name?: string | null
          role?: string
          used_at?: string | null
          used_by_chat_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          employee_id?: string | null
          expires_at?: string
          id?: string
          name?: string | null
          role?: string
          used_at?: string | null
          used_by_chat_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_bot_invites_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_bot_users: {
        Row: {
          chat_id: string
          created_at: string
          employee_id: string | null
          is_active: boolean
          name: string
          note: string | null
          role: string
          updated_at: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          employee_id?: string | null
          is_active?: boolean
          name: string
          note?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          employee_id?: string | null
          is_active?: boolean
          name?: string
          note?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_bot_users_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_conversations: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      telegram_pending_tasks: {
        Row: {
          chat_id: string
          created_at: string
          due_date: string | null
          employee_id: string
          employee_name: string
          id: string
          image_url: string | null
          status: string
          title: string
        }
        Insert: {
          chat_id: string
          created_at?: string
          due_date?: string | null
          employee_id: string
          employee_name: string
          id?: string
          image_url?: string | null
          status?: string
          title: string
        }
        Update: {
          chat_id?: string
          created_at?: string
          due_date?: string | null
          employee_id?: string
          employee_name?: string
          id?: string
          image_url?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_pending_tasks_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feedback: {
        Row: {
          category: string
          completed_at: string | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          id: string
          internal_notes: string | null
          priority: string | null
          reporter: string | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          category: string
          completed_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          internal_notes?: string | null
          priority?: string | null
          reporter?: string | null
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          completed_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          internal_notes?: string | null
          priority?: string | null
          reporter?: string | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          created_at: string | null
          email: string
          employee_id: string | null
          full_name: string | null
          role: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          employee_id?: string | null
          full_name?: string | null
          role?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          employee_id?: string | null
          full_name?: string | null
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      variant_channel_price_overrides: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          notes: string | null
          price: number
          variant_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          notes?: string | null
          price: number
          variant_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          price?: number
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variant_channel_price_overrides_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variant_channel_price_overrides_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_category_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          subcategories: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          subcategories?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          subcategories?: string[]
        }
        Relationships: []
      }
      vendor_item_aliases: {
        Row: {
          alias_text: string
          created_at: string | null
          id: string
          material_id: string
          vendor_name: string
        }
        Insert: {
          alias_text: string
          created_at?: string | null
          id?: string
          material_id: string
          vendor_name?: string
        }
        Update: {
          alias_text?: string
          created_at?: string | null
          id?: string
          material_id?: string
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_item_aliases_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "procurement_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string | null
          deleted_at: string | null
          email: string | null
          fax: string | null
          id: string
          main_category: string | null
          name: string
          notes: string | null
          phone: string | null
          tax_id: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          main_category?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          fax?: string | null
          id?: string
          main_category?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          tax_id?: string | null
          website?: string | null
        }
        Relationships: []
      }
      work_order_stage_history: {
        Row: {
          changed_at: string
          changed_by_employee_id: string | null
          changed_by_user_id: string | null
          id: string
          new_stage: string
          old_stage: string | null
          work_order_id: string
        }
        Insert: {
          changed_at?: string
          changed_by_employee_id?: string | null
          changed_by_user_id?: string | null
          id?: string
          new_stage: string
          old_stage?: string | null
          work_order_id: string
        }
        Update: {
          changed_at?: string
          changed_by_employee_id?: string | null
          changed_by_user_id?: string | null
          id?: string
          new_stage?: string
          old_stage?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_stage_history_changed_by_employee_id_fkey"
            columns: ["changed_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_stage_history_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          assignee_id: string | null
          created_at: string | null
          id: string
          notes: string | null
          order_item_id: string
          planned_end_date: string | null
          planned_start_date: string | null
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          assignee_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          order_item_id: string
          planned_end_date?: string | null
          planned_start_date?: string | null
          stage?: string
          status?: string
          updated_at?: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          assignee_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          order_item_id?: string
          planned_end_date?: string | null
          planned_start_date?: string | null
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      part_stock_status: {
        Row: {
          below_safety: boolean | null
          category: string | null
          current_stock: number | null
          id: string | null
          is_component: boolean | null
          name: string | null
          needs_reorder: boolean | null
          part_no: string | null
          procurement_type: string | null
          reorder_point: number | null
          safety_stock: number | null
          source_type: string | null
          unit: string | null
          vendor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      part_variant_stock_status: {
        Row: {
          below_safety: boolean | null
          category: string | null
          current_stock: number | null
          id: string | null
          is_component: boolean | null
          material_code: string | null
          material_name: string | null
          name: string | null
          name_code: string | null
          needs_reorder: boolean | null
          part_id: string | null
          procurement_type: string | null
          reorder_point: number | null
          safety_stock: number | null
          series_id: string | null
          sku: string | null
          source_type: string | null
          unit: string | null
          vendor_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "part_variants_material_code_fkey"
            columns: ["material_code"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "part_variants_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "part_stock_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_variants_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "product_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      approve_overtime_to_comp_leave: {
        Args: {
          p_employee_id: string
          p_hours: number
          p_overtime_date: string
          p_reason: string
        }
        Returns: Json
      }
      current_employee_id: { Args: never; Returns: string }
      revoke_overtime_comp_leave: {
        Args: { p_record_id: string }
        Returns: Json
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
