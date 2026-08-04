package sg.gov.wls.smsforwarder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "WLS_SmsReceiver";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) return;

        Config config = new Config(ctx);
        if (!config.isEnabled()) return;

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        Object[] pdus = (Object[]) bundle.get("pdus");
        String format = bundle.getString("format");
        if (pdus == null) return;

        // Concatenate multipart SMS
        StringBuilder bodyBuilder = new StringBuilder();
        String sender = null;
        for (Object pdu : pdus) {
            SmsMessage msg = SmsMessage.createFromPdu((byte[]) pdu, format);
            if (msg == null) continue;
            if (sender == null) sender = msg.getOriginatingAddress();
            bodyBuilder.append(msg.getMessageBody());
        }

        String body = bodyBuilder.toString().trim();
        if (sender == null || body.isEmpty()) return;

        Log.d(TAG, "SMS from: " + sender + " | len=" + body.length());

        if (!config.senderAllowed(sender)) {
            Log.d(TAG, "Sender not in allow-list, ignoring: " + sender);
            return;
        }

        // Kick off ForwardService with the SMS payload
        Intent svc = new Intent(ctx, ForwardService.class);
        svc.putExtra("smsText", body);
        svc.putExtra("senderName", sender);
        ctx.startForegroundService(svc);
    }
}
