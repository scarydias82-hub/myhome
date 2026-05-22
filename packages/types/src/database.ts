// Generated-style Supabase Database type.
// In M0 this is a hand-written stub. Regenerate with:
//   supabase gen types typescript --linked > packages/types/src/database.ts
// once the project is linked.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          first_name: string | null;
          created_at: string;
          pinterest_connected_at: string | null;
        };
        Insert: {
          id: string;
          email: string;
          first_name?: string | null;
          created_at?: string;
          pinterest_connected_at?: string | null;
        };
        Update: {
          email?: string;
          first_name?: string | null;
          pinterest_connected_at?: string | null;
        };
      };
      rooms: {
        Row: {
          id: string;
          user_id: string;
          photo_url: string;
          depth_map_url: string | null;
          masks_json: Json | null;
          room_type: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          photo_url: string;
          depth_map_url?: string | null;
          masks_json?: Json | null;
          room_type?: string | null;
          created_at?: string;
        };
        Update: {
          photo_url?: string;
          depth_map_url?: string | null;
          masks_json?: Json | null;
          room_type?: string | null;
        };
      };
      style_profiles: {
        Row: {
          id: string;
          user_id: string;
          source: string;
          source_ref: string | null;
          style_descriptor: string;
          palette: Json;
          materials: string[];
          mood: string[];
          created_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          source: string;
          source_ref?: string | null;
          style_descriptor: string;
          palette: Json;
          materials: string[];
          mood: string[];
          created_at?: string;
          expires_at?: string | null;
        };
        Update: {
          source?: string;
          style_descriptor?: string;
          palette?: Json;
          materials?: string[];
          mood?: string[];
          expires_at?: string | null;
        };
      };
      renders: {
        Row: {
          id: string;
          user_id: string;
          room_id: string;
          style_profile_id: string;
          output_url: string | null;
          picking_list: Json;
          cost_estimate_aud: number | null;
          status: string;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          room_id: string;
          style_profile_id: string;
          output_url?: string | null;
          picking_list?: Json;
          cost_estimate_aud?: number | null;
          status?: string;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          output_url?: string | null;
          picking_list?: Json;
          cost_estimate_aud?: number | null;
          status?: string;
          completed_at?: string | null;
        };
      };
      products: {
        Row: {
          id: string;
          retailer: string;
          sku: string;
          name: string;
          category: string;
          price_aud: number;
          image_url: string;
          product_url: string;
          affiliate_url: string | null;
          dimensions: Json | null;
          materials: string[];
          colors: string[];
          in_stock: boolean;
          ships_to: string[];
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          retailer: string;
          sku: string;
          name: string;
          category: string;
          price_aud: number;
          image_url: string;
          product_url: string;
          affiliate_url?: string | null;
          dimensions?: Json | null;
          materials?: string[];
          colors?: string[];
          in_stock?: boolean;
          ships_to?: string[];
          last_seen_at?: string;
        };
        Update: {
          retailer?: string;
          sku?: string;
          name?: string;
          category?: string;
          price_aud?: number;
          image_url?: string;
          product_url?: string;
          affiliate_url?: string | null;
          dimensions?: Json | null;
          materials?: string[];
          colors?: string[];
          in_stock?: boolean;
          ships_to?: string[];
          last_seen_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
