package com.rajanenterprises.sunosathi;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallActionReceiver extends BroadcastReceiver {

    public static final String ACTION_ACCEPT  = "com.rajanenterprises.sunosathi.ACCEPT_CALL";
    public static final String ACTION_DECLINE = "com.rajanenterprises.sunosathi.DECLINE_CALL";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action    = intent.getAction();
        String sessionId = intent.getStringExtra("sessionId");
        String kind      = intent.getStringExtra("kind");

        // Dismiss the incoming-call notification
        if (sessionId != null) {
            NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(Math.abs(sessionId.hashCode()));
            }
        }

        if (ACTION_ACCEPT.equals(action)) {
            // Open MainActivity so the web app can handle the accept
            Intent launch = new Intent(context, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra("from", "fcm_accept");
            launch.putExtra("sessionId", sessionId);
            launch.putExtra("kind", kind != null ? kind : "call");
            context.startActivity(launch);
        }
        // For DECLINE we just cancel the notification (already done above)
    }
}
