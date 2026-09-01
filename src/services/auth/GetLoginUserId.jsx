/**
 * Reads current Supabase user ID from localStorage.
 * File: src/services/auth/GetLoginUserId.jsx
 */
import { getSupabaseAuthStorageKey } from '../../services/supabase/supabaseclient';

export const getUserId = () => {
  const storageKey = getSupabaseAuthStorageKey();
  if (!storageKey) {
    return null;
  }

  const authData = localStorage.getItem(storageKey);
  if (!authData) {
    return null;
  }

  try {
    const parsedData = JSON.parse(authData);
    return parsedData?.user?.id || null;
  } catch (error) {
    console.error("Error parsing auth data:", error);
    return null;
  }
};
