package com.dadameun.calendar;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 휴대폰 알람(AlarmManager)으로 정확한 시각에 알림을 울리게 맞춰두는 곳.
 * - 알람 목록은 달력 웹페이지가 넘겨줌 (지금 켜놓은 탭의 알람만)
 * - 목록은 휴대폰에 저장해둬서, 휴대폰을 껐다 켜도 다시 맞출 수 있음
 */
public final class AlarmScheduler {
    static final String CHANNEL_ID = "dadameun_alarm";
    private static final String PREFS = "dadameun_alarms";
    private static final String KEY_LIST = "list";
    private static final String KEY_COUNT = "scheduled_count";
    private static final String KEY_FIRED_DAY = "fired_day";
    private static final String KEY_FIRED_IDS = "fired_ids";
    private static final int MAX_ALARMS = 200;

    private AlarmScheduler() {
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 알림 채널 (알람 소리 + 진동) */
    static void ensureChannel(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "일정 알람", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("달력에 맞춰둔 알람");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 400, 250, 400, 250, 400});
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        ch.setSound(sound, attrs);
        nm.createNotificationChannel(ch);
    }

    /** 달력이 넘겨준 목록으로 기존 알람을 모두 지우고 새로 맞춤 */
    static synchronized void replaceAll(Context c, String json) {
        if (json == null) json = "[]";
        try {
            new JSONArray(json); // 형식 확인
        } catch (Exception e) {
            return;
        }
        prefs(c).edit().putString(KEY_LIST, json).apply();
        scheduleFromStore(c);
    }

    /** 저장해둔 목록대로 알람을 다시 맞춤 (휴대폰 재부팅, 앱 업데이트 후에도 사용) */
    static synchronized void scheduleFromStore(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        SharedPreferences p = prefs(c);

        // 1) 예전에 맞춰둔 알람 전부 취소
        int prevCount = p.getInt(KEY_COUNT, 0);
        for (int i = 0; i < prevCount; i++) {
            am.cancel(pendingFor(c, i, null, null, null));
        }

        // 2) 새로 맞춤
        int count = 0;
        try {
            JSONArray arr = new JSONArray(p.getString(KEY_LIST, "[]"));
            long now = System.currentTimeMillis();
            for (int i = 0; i < arr.length() && count < MAX_ALARMS; i++) {
                JSONObject o = arr.getJSONObject(i);
                long at = o.optLong("at", 0);
                if (at <= now) continue;
                PendingIntent pi = pendingFor(c, count, o.optString("key"), o.optString("title"), o.optString("body"));
                setExact(c, am, at, pi);
                count++;
            }
        } catch (Exception ignored) {
        }
        p.edit().putInt(KEY_COUNT, count).apply();
    }

    private static PendingIntent pendingFor(Context c, int requestCode, String key, String title, String body) {
        Intent i = new Intent(c, AlarmReceiver.class);
        i.setAction("com.dadameun.calendar.ALARM");
        if (key != null) {
            i.putExtra("key", key);
            i.putExtra("title", title);
            i.putExtra("body", body);
        }
        return PendingIntent.getBroadcast(c, requestCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void setExact(Context c, AlarmManager am, long at, PendingIntent pi) {
        boolean canExact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            if (canExact) {
                // "알람 시계" 방식: 절전 모드에서도 정확한 시각에 울림
                Intent open = new Intent(c, MainActivity.class);
                PendingIntent show = PendingIntent.getActivity(c, 0, open,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    private static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /** 앱이 알림으로 울린 알람을 기록 (오늘 것만 보관) */
    static synchronized void markFired(Context c, String key) {
        if (key == null || key.isEmpty()) return;
        SharedPreferences p = prefs(c);
        String day = today();
        JSONArray ids;
        try {
            ids = day.equals(p.getString(KEY_FIRED_DAY, "")) ? new JSONArray(p.getString(KEY_FIRED_IDS, "[]")) : new JSONArray();
        } catch (Exception e) {
            ids = new JSONArray();
        }
        ids.put(key);
        p.edit().putString(KEY_FIRED_DAY, day).putString(KEY_FIRED_IDS, ids.toString()).apply();
    }

    static synchronized String getFiredIds(Context c) {
        SharedPreferences p = prefs(c);
        if (!today().equals(p.getString(KEY_FIRED_DAY, ""))) return "[]";
        return p.getString(KEY_FIRED_IDS, "[]");
    }
}
