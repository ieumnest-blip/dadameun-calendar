package com.dadameun.calendar;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 휴대폰을 다시 켜거나, 앱을 업데이트하거나, 시간이 바뀌면 저장해둔 알람을 다시 맞춤 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        AlarmScheduler.scheduleFromStore(context);
    }
}
