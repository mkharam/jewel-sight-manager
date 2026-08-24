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
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          location: string | null
          name: string
          name_en: string | null
          phone: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          location?: string | null
          name: string
          name_en?: string | null
          phone?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          location?: string | null
          name?: string
          name_en?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          name_en: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          name_en?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          name_en?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      customer_inquiries: {
        Row: {
          branch_id: string | null
          budget: number | null
          created_at: string
          created_by: string | null
          customer_image_path: string | null
          customer_name: string | null
          customer_phone: string | null
          description: string | null
          desired_karat: string | null
          desired_size: string | null
          id: string
          internal_notes: string | null
          product_id: string | null
          quoted_price: number | null
          status: Database["public"]["Enums"]["inquiry_status"]
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          budget?: number | null
          created_at?: string
          created_by?: string | null
          customer_image_path?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          desired_karat?: string | null
          desired_size?: string | null
          id?: string
          internal_notes?: string | null
          product_id?: string | null
          quoted_price?: number | null
          status?: Database["public"]["Enums"]["inquiry_status"]
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          budget?: number | null
          created_at?: string
          created_by?: string | null
          customer_image_path?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          desired_karat?: string | null
          desired_size?: string | null
          id?: string
          internal_notes?: string | null
          product_id?: string | null
          quoted_price?: number | null
          status?: Database["public"]["Enums"]["inquiry_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_inquiries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_inquiries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_inquiries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gold_prices: {
        Row: {
          created_at: string
          effective_date: string
          id: string
          karat: string
          making_charge: number
          price_per_gram: number
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          effective_date?: string
          id?: string
          karat: string
          making_charge?: number
          price_per_gram: number
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          effective_date?: string
          id?: string
          karat?: string
          making_charge?: number
          price_per_gram?: number
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gold_prices_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mstrmnd_events: {
        Row: {
          event_type: string | null
          id: string
          payload: Json
          processed: boolean
          received_at: string
        }
        Insert: {
          event_type?: string | null
          id?: string
          payload: Json
          processed?: boolean
          received_at?: string
        }
        Update: {
          event_type?: string | null
          id?: string
          payload?: Json
          processed?: boolean
          received_at?: string
        }
        Relationships: []
      }
      product_certificates: {
        Row: {
          cert_number: string | null
          created_at: string
          file_path: string | null
          id: string
          issued_at: string | null
          issuer: string | null
          notes: string | null
          product_id: string
        }
        Insert: {
          cert_number?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          issued_at?: string | null
          issuer?: string | null
          notes?: string | null
          product_id: string
        }
        Update: {
          cert_number?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          issued_at?: string | null
          issuer?: string | null
          notes?: string | null
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_certificates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          ai_embedding: string | null
          ai_labels: Json
          created_at: string
          dominant_color: string | null
          height: number | null
          id: string
          is_primary: boolean
          product_id: string
          sort_order: number
          source_url: string | null
          storage_path: string
          thumb_path: string | null
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          ai_embedding?: string | null
          ai_labels?: Json
          created_at?: string
          dominant_color?: string | null
          height?: number | null
          id?: string
          is_primary?: boolean
          product_id: string
          sort_order?: number
          source_url?: string | null
          storage_path: string
          thumb_path?: string | null
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          ai_embedding?: string | null
          ai_labels?: Json
          created_at?: string
          dominant_color?: string | null
          height?: number | null
          id?: string
          is_primary?: boolean
          product_id?: string
          sort_order?: number
          source_url?: string | null
          storage_path?: string
          thumb_path?: string | null
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_quotes: {
        Row: {
          branch_id: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          id: string
          notes: string | null
          price: number
          product_id: string
          quoted_by: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          notes?: string | null
          price: number
          product_id: string
          quoted_by?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          notes?: string | null
          price?: number
          product_id?: string
          quoted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_quotes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_quotes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_quotes_quoted_by_fkey"
            columns: ["quoted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_stones: {
        Row: {
          carat: number | null
          clarity: string | null
          color: string | null
          created_at: string
          id: string
          notes: string | null
          product_id: string
          quantity: number | null
          stone_type: string
        }
        Insert: {
          carat?: number | null
          clarity?: string | null
          color?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          quantity?: number | null
          stone_type: string
        }
        Update: {
          carat?: number | null
          clarity?: string | null
          color?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity?: number | null
          stone_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_stones_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          branch_id: string | null
          category_id: string | null
          cost_price: number | null
          created_at: string
          created_by: string | null
          description: string | null
          gold_color: string | null
          hallmark: string | null
          id: string
          internal_notes: string | null
          item_type: string | null
          karat: string | null
          making_charge: number | null
          name: string
          promo_price: number | null
          received_at: string | null
          ring_size: string | null
          sale_price: number | null
          search_blob: string | null
          search_tags: string[]
          sku: string | null
          status: Database["public"]["Enums"]["product_status"]
          supplier_id: string | null
          updated_at: string
          updated_by: string | null
          weight_grams: number | null
        }
        Insert: {
          branch_id?: string | null
          category_id?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          gold_color?: string | null
          hallmark?: string | null
          id?: string
          internal_notes?: string | null
          item_type?: string | null
          karat?: string | null
          making_charge?: number | null
          name: string
          promo_price?: number | null
          received_at?: string | null
          ring_size?: string | null
          sale_price?: number | null
          search_blob?: string | null
          search_tags?: string[]
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          supplier_id?: string | null
          updated_at?: string
          updated_by?: string | null
          weight_grams?: number | null
        }
        Update: {
          branch_id?: string | null
          category_id?: string | null
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          gold_color?: string | null
          hallmark?: string | null
          id?: string
          internal_notes?: string | null
          item_type?: string | null
          karat?: string | null
          making_charge?: number | null
          name?: string
          promo_price?: number | null
          received_at?: string | null
          ring_size?: string | null
          sale_price?: number | null
          search_blob?: string | null
          search_tags?: string[]
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          supplier_id?: string | null
          updated_at?: string
          updated_by?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          branch_id: string | null
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          agreed_price: number | null
          branch_id: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          deposit: number
          expires_at: string
          id: string
          notes: string | null
          product_id: string
          status: Database["public"]["Enums"]["reservation_status"]
          updated_at: string
        }
        Insert: {
          agreed_price?: number | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deposit?: number
          expires_at: string
          id?: string
          notes?: string | null
          product_id: string
          status?: Database["public"]["Enums"]["reservation_status"]
          updated_at?: string
        }
        Update: {
          agreed_price?: number | null
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deposit?: number
          expires_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          branch_id: string | null
          created_at: string
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          discount: number
          final_price: number
          id: string
          karat: string | null
          notes: string | null
          payment_method: string | null
          product_id: string | null
          product_name_snapshot: string | null
          sku_snapshot: string | null
          sold_at: string
          sold_by: string | null
          weight_grams: number | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          final_price: number
          id?: string
          karat?: string | null
          notes?: string | null
          payment_method?: string | null
          product_id?: string | null
          product_name_snapshot?: string | null
          sku_snapshot?: string | null
          sold_at?: string
          sold_by?: string | null
          weight_grams?: number | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          discount?: number
          final_price?: number
          id?: string
          karat?: string | null
          notes?: string | null
          payment_method?: string | null
          product_id?: string | null
          product_name_snapshot?: string | null
          sku_snapshot?: string | null
          sold_at?: string
          sold_by?: string | null
          weight_grams?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_sold_by_fkey"
            columns: ["sold_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_take_items: {
        Row: {
          checked_at: string
          checked_by: string | null
          id: string
          notes: string | null
          product_id: string | null
          result: Database["public"]["Enums"]["stock_take_result"]
          session_id: string
        }
        Insert: {
          checked_at?: string
          checked_by?: string | null
          id?: string
          notes?: string | null
          product_id?: string | null
          result?: Database["public"]["Enums"]["stock_take_result"]
          session_id: string
        }
        Update: {
          checked_at?: string
          checked_by?: string | null
          id?: string
          notes?: string | null
          product_id?: string | null
          result?: Database["public"]["Enums"]["stock_take_result"]
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_take_items_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_take_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_take_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "stock_take_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_take_sessions: {
        Row: {
          branch_id: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          notes: string | null
          started_at: string
          started_by: string | null
          status: Database["public"]["Enums"]["stock_take_status"]
          updated_at: string
        }
        Insert: {
          branch_id: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          started_at?: string
          started_by?: string | null
          status?: Database["public"]["Enums"]["stock_take_status"]
          updated_at?: string
        }
        Update: {
          branch_id?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          started_at?: string
          started_by?: string | null
          status?: Database["public"]["Enums"]["stock_take_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_take_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_take_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_take_sessions_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      transfers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          customer_name: string | null
          from_branch_id: string
          id: string
          notes: string | null
          product_id: string | null
          product_name_snapshot: string | null
          reason: string | null
          received_at: string | null
          received_by: string | null
          requested_by: string
          status: Database["public"]["Enums"]["transfer_status"]
          to_branch_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          customer_name?: string | null
          from_branch_id: string
          id?: string
          notes?: string | null
          product_id?: string | null
          product_name_snapshot?: string | null
          reason?: string | null
          received_at?: string | null
          received_by?: string | null
          requested_by: string
          status?: Database["public"]["Enums"]["transfer_status"]
          to_branch_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          customer_name?: string | null
          from_branch_id?: string
          id?: string
          notes?: string | null
          product_id?: string | null
          product_name_snapshot?: string | null
          reason?: string | null
          received_at?: string | null
          received_by?: string | null
          requested_by?: string
          status?: Database["public"]["Enums"]["transfer_status"]
          to_branch_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfers_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_from_branch_id_fkey"
            columns: ["from_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfers_to_branch_id_fkey"
            columns: ["to_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wishlist_items: {
        Row: {
          budget: number | null
          created_at: string
          created_by: string | null
          customer_id: string
          id: string
          is_fulfilled: boolean
          product_id: string | null
          wanted_text: string | null
        }
        Insert: {
          budget?: number | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          id?: string
          is_fulfilled?: boolean
          product_id?: string | null
          wanted_text?: string | null
        }
        Update: {
          budget?: number | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          id?: string
          is_fulfilled?: boolean
          product_id?: string | null
          wanted_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      expire_due_reservations: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_branch_manager: {
        Args: { _branch_id: string; _user_id: string }
        Returns: boolean
      }
      is_manager_or_admin: { Args: { _user_id: string }; Returns: boolean }
      match_product_images: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          image_id: string
          product_id: string
          similarity: number
          storage_path: string
          thumb_path: string
        }[]
      }
      match_similar_products: {
        Args: { _product_id: string; match_count?: number }
        Returns: {
          product_id: string
          similarity: number
        }[]
      }
      normalize_arabic: { Args: { input: string }; Returns: string }
      search_products_fuzzy: {
        Args: {
          _branch_id?: string
          _category_id?: string
          _karat?: string
          _limit?: number
          _max_weight?: number
          _min_weight?: number
          _query: string
          _status?: string
          _tag?: string
        }
        Returns: {
          branch_id: string
          category_id: string
          id: string
          karat: string
          name: string
          promo_price: number
          rank: number
          ring_size: string
          sale_price: number
          search_tags: string[]
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          weight_grams: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      tags_from_ai_labels: { Args: { labels: Json }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "manager" | "employee" | "kiosk"
      inquiry_status: "pending" | "found" | "quoted" | "shown" | "sold" | "lost"
      product_status:
        | "available"
        | "reserved"
        | "sold"
        | "in_transfer"
        | "damaged"
        | "lost"
      reservation_status: "active" | "expired" | "cancelled" | "converted"
      stock_take_result: "found" | "missing" | "extra"
      stock_take_status: "open" | "closed"
      transfer_status:
        | "pending"
        | "approved"
        | "in_transit"
        | "received"
        | "rejected"
        | "cancelled"
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
      app_role: ["admin", "manager", "employee", "kiosk"],
      inquiry_status: ["pending", "found", "quoted", "shown", "sold", "lost"],
      product_status: [
        "available",
        "reserved",
        "sold",
        "in_transfer",
        "damaged",
        "lost",
      ],
      reservation_status: ["active", "expired", "cancelled", "converted"],
      stock_take_result: ["found", "missing", "extra"],
      stock_take_status: ["open", "closed"],
      transfer_status: [
        "pending",
        "approved",
        "in_transit",
        "received",
        "rejected",
        "cancelled",
      ],
    },
  },
} as const
