/**
 * Centralized sign-out — clears Supabase session and local storage.
 * File: src/utils/authLogout.js
 */
import supabase, { getSupabaseAuthStorageKey } from "../services/supabase/supabaseclient";

const isBenignSignOutError = (message = "") =>
  /session missing|refresh token not found|invalid refresh token/i.test(message);

/** Clears Supabase session and local auth state; always redirects home. */
export async function logoutUser() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error && !isBenignSignOutError(error.message)) {
      console.warn("Sign-out warning:", error.message);
    }
  } catch (error) {
    const message = error?.message || String(error);
    if (!isBenignSignOutError(message)) {
      console.warn("Sign-out error:", message);
    }
  }

  const authKey = getSupabaseAuthStorageKey();
  if (authKey) {
    localStorage.removeItem(authKey);
  }
  localStorage.removeItem("showTermsPopup");
  localStorage.removeItem("redirectAfterLogin");
  localStorage.clear();
  window.location.href = "/";
}
