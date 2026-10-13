package com.dadameun.calendar;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 알람 시각이 되면 휴대폰이 불러주는 곳.
 * 달력 화면을 보고 있는 중이면 달력이 직접 알람 창을 띄우므로 여기서는 아무것도 안 하고,
 * 앱이 꺼져 있거나 다른 화면에 있으면 알림(소리+진동)으로 울림.
 */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String key = intent.getStringExtra("key");
        if (key == null) return;
        if (MainActivity.inForeground) return; // 화면에 달력이 떠 있으면 달력이 울림

        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        if (title == null || title.isEmpty()) title = "⏰ 알람";
        if (body == null) body = "";

        AlarmScheduler.ensureChannel(context);
        AlarmScheduler.markFired(context, key);

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(context, key.hashCode(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification n = new Notification.Builder(context, AlarmScheduler.CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setCategory(Notification.CATEGORY_ALARM)
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setShowWhen(true)
                .build();

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try {
                nm.notify(key.hashCode(), n);
            } catch (SecurityException ignored) {
                // 알림 권한을 허용하지 않은 경우
            }
        }
    }
}
