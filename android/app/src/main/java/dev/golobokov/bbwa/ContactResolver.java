package dev.golobokov.bbwa;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import java.util.HashMap;

public class ContactResolver {

    private static final String PREFS_ALIASES = "chat_aliases";

    // Sentinel stored in cache when a number resolves to nothing.
    private static final String NOT_FOUND = "";

    private static final HashMap<String, String> cache = new HashMap<String, String>();

    /**
     * Strips the WhatsApp domain suffix from a JID, e.g.
     * "447911123456@s.whatsapp.net" → "447911123456".
     * Returns the input unchanged if it contains no '@'.
     */
    public static String extractNumber(String jid) {
        if (jid == null) return null;
        int at = jid.indexOf('@');
        return at > 0 ? jid.substring(0, at) : jid;
    }

    /** Clears the in-memory cache so the next call re-queries all sources. */
    public static void clearCache() {
        cache.clear();
    }

    /** Persists a custom alias for {@code number} to SharedPreferences. */
    public static void saveAlias(Context context, String number, String alias) {
        context.getSharedPreferences(PREFS_ALIASES, Context.MODE_PRIVATE)
               .edit().putString(number, alias).commit();
    }

    /** Removes any custom alias for {@code number} from SharedPreferences. */
    public static void removeAlias(Context context, String number) {
        context.getSharedPreferences(PREFS_ALIASES, Context.MODE_PRIVATE)
               .edit().remove(number).commit();
    }

    /**
     * Returns the best available display name for {@code phoneNumber}, with
     * this priority order:
     *
     *   1. Custom alias (SharedPreferences "chat_aliases")
     *   2. Device contact (ContactsContract)
     *   3. null  →  caller should fall back to WhatsApp pushName
     *
     * Results are cached so the database is queried at most once per unique
     * number between cache clears, making it safe to call from getView().
     */
    public static String getName(Context context, String phoneNumber) {
        if (phoneNumber == null || phoneNumber.length() == 0) return null;

        if (cache.containsKey(phoneNumber)) {
            String cached = cache.get(phoneNumber);
            return cached.length() > 0 ? cached : null;
        }

        // Priority 1: custom alias
        SharedPreferences prefs = context.getSharedPreferences(PREFS_ALIASES, Context.MODE_PRIVATE);
        if (prefs.contains(phoneNumber)) {
            String alias = prefs.getString(phoneNumber, null);
            cache.put(phoneNumber, alias != null ? alias : NOT_FOUND);
            return alias;
        }

        // Priority 2: device contacts
        String name = queryContact(context, phoneNumber);
        cache.put(phoneNumber, name != null ? name : NOT_FOUND);
        return name;
    }

    private static String queryContact(Context context, String number) {
        // PhoneLookup matches on a normalised index maintained by the provider,
        // so the provider does the work. The previous implementation selected
        // every row in the contacts database and compared each one in Java,
        // which is a full scan per unknown number — on the UI thread.
        Uri uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number));

        Cursor cursor = null;
        try {
            cursor = context.getContentResolver().query(
                    uri,
                    new String[]{ContactsContract.PhoneLookup.DISPLAY_NAME},
                    null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        } catch (SecurityException e) {
            // READ_CONTACTS revoked or never granted: fall back to pushName.
            return null;
        } finally {
            if (cursor != null) cursor.close();
        }
        return null;
    }
}
