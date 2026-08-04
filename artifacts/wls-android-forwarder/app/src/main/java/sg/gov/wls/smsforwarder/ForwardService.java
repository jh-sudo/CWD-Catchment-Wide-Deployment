package sg.gov.wls.smsforwarder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class ForwardService extends Service {
    private static final String TAG = "WLS_ForwardService";
    private static final String CHANNEL_ID = "wls_channel";
    private static final int NOTIF_ID = 1001;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
            .build();

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Must call startForeground immediately on Android 12+
        startForeground(NOTIF_ID, buildNotification("Forwarding WLS SMS…"));

        if (intent == null) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        String smsText = intent.getStringExtra("smsText");
        String senderName = intent.getStringExtra("senderName");

        if (smsText == null || smsText.trim().isEmpty()) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }

        final int sid = startId;
        executor.submit(() -> {
            try {
                forward(smsText, senderName);
                updateNotification("✓ WLS SMS forwarded successfully");
            } catch (Exception e) {
                Log.e(TAG, "Forward failed: " + e.getMessage(), e);
                updateNotification("⚠ Forward failed: " + e.getMessage());
            } finally {
                // Keep notification visible briefly then stop
                try { Thread.sleep(3000); } catch (InterruptedException ignored) {}
                stopSelf(sid);
            }
        });

        return START_NOT_STICKY;
    }

    private void forward(String smsText, String senderName) throws IOException {
        Config config = new Config(this);
        String url = config.getApiUrl();

        JSONObject body = new JSONObject();
        try {
            body.put("smsText", smsText);
            if (senderName != null) body.put("senderName", senderName);
        } catch (Exception e) {
            throw new IOException("JSON build failed: " + e.getMessage());
        }

        Log.d(TAG, "POST → " + url);
        RequestBody rb = RequestBody.create(body.toString(), JSON);
        Request req = new Request.Builder().url(url).post(rb).build();

        try (Response resp = client.newCall(req).execute()) {
            String respBody = resp.body() != null ? resp.body().string() : "(empty)";
            if (!resp.isSuccessful()) {
                throw new IOException("HTTP " + resp.code() + ": " + respBody);
            }
            Log.i(TAG, "Forwarded OK: " + respBody);
        }
    }

    private void createNotificationChannel() {
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "WLS SMS Forwarder", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Background WLS SMS forwarding status");
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    private Notification buildNotification(String text) {
        return new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("WLS Forwarder")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setOngoing(false)
                .build();
    }

    private void updateNotification(String text) {
        getSystemService(NotificationManager.class)
                .notify(NOTIF_ID, buildNotification(text));
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
