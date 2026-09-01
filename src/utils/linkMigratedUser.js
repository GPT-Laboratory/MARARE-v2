/**
 * Links legacy migrated users to new Supabase accounts on login.
 * File: src/utils/linkMigratedUser.js
 */
import { socketURL } from "../services/meeting/socketInstance";

const linkStorageKey = (userId) => `migration_linked_${userId}`;

/** Attach Mongo-imported rows to the current Supabase auth user (matched by email). */
export async function linkMigratedUserIfNeeded(user) {
  const email = user?.email?.trim();
  const userId = user?.id;
  if (!email || !userId) {
    return null;
  }

  if (localStorage.getItem(linkStorageKey(userId)) === "true") {
    return null;
  }

  try {
    const response = await fetch(`${socketURL}/migration/link-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, user_id: userId }),
    });
    const data = await response.json();
    if (response.ok) {
      localStorage.setItem(linkStorageKey(userId), "true");
    }
    return data;
  } catch (error) {
    console.warn("Migration link request failed:", error);
    return null;
  }
}
