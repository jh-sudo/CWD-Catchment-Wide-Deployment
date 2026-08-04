package sg.gov.wls.smsforwarder;

import android.content.Context;
import android.content.SharedPreferences;

public class Config {
    private static final String PREFS = "wls_prefs";
    static final String DEFAULT_API_URL = "https://example-project.example-team.stg.paas.sandbox.gov.sg/api/wls/ingest";

    private final SharedPreferences prefs;

    Config(Context ctx) {
        prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public String getApiUrl() {
        return prefs.getString("api_url", DEFAULT_API_URL);
    }

    public void setApiUrl(String url) {
        prefs.edit().putString("api_url", url).apply();
    }

    /** Comma-separated list of allowed sender name fragments (case-insensitive). Empty = accept all. */
    public String getAllowedSenders() {
        return prefs.getString("allowed_senders", "CWS,winsystech");
    }

    public void setAllowedSenders(String senders) {
        prefs.edit().putString("allowed_senders", senders).apply();
    }

    public boolean isEnabled() {
        return prefs.getBoolean("enabled", true);
    }

    public void setEnabled(boolean v) {
        prefs.edit().putBoolean("enabled", v).apply();
    }

    /** Return true if this sender should be forwarded. */
    public boolean senderAllowed(String sender) {
        String allowed = getAllowedSenders().trim();
        if (allowed.isEmpty()) return true;
        String[] parts = allowed.split(",");
        String s = sender.toLowerCase();
        for (String p : parts) {
            if (s.contains(p.trim().toLowerCase())) return true;
        }
        return false;
    }
}
