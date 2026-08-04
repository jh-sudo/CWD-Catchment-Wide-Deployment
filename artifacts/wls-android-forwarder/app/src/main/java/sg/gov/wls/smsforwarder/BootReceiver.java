package sg.gov.wls.smsforwarder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Ensures the app is "active" after reboot so Android doesn't suppress SMS delivery.
 * No actual work needed — having RECEIVE_BOOT_COMPLETED permission + this receiver
 * keeps the app in the permitted-receiver list.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        // Nothing to do — just being registered is sufficient to
        // keep SMS delivery working after reboot.
    }
}
