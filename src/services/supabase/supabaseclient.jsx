/**
 * Supabase client for auth and database.
 * File: src/services/supabase/supabaseclient.jsx
 */
import { createClient } from "@supabase/supabase-js";
import { APP_URLS } from '../../config/baseUrls.js';

const supabaseUrl = APP_URLS.supabase;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

/** Supabase localStorage key: sb-{projectRef}-auth-token */
export const getSupabaseAuthStorageKey = () => {
  const url = supabaseUrl || "";
  const match = url.match(/https?:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] ? `sb-${match[1]}-auth-token` : null;
};

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,        // ✅ store in localStorage
    autoRefreshToken: true,      // ✅ keep session alive
    detectSessionInUrl: true     // ✅ REQUIRED for Google OAuth
  }
});

export default supabase;