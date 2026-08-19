import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Null when the project is not configured.
 *
 * Persistence is an enhancement, not a prerequisite. Local history and the
 * measurement itself work with no backend at all, so the absence of keys
 * disables sharing rather than breaking the site.
 */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey, { auth: { persistSession: false } }) : null;

export const SHARING_ENABLED = supabase !== null;
