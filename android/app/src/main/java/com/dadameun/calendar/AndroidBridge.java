package com.dadameun.calendar;

import android.content.Context;
import android.webkit.JavascriptInterface;

/**
 * 달력 웹페이지에서 window.DadameunAndroid 로 부를 수 있는 것들.
 * 알람 목록을 넘겨받고, 앱이 이미 울린 알람이 뭔지 알려주는 일만 함 (일정 데이터는 다루지 않음).
 */
public class AndroidBridge {
    private final Context context;

    AndroidBridge(Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public boolean isApp() {
        return true;
    }

    /** 달력이 넘겨준 "앞으로 울릴 알람 목록"으로 휴대폰 알람을 새로 맞춤 */
    @JavascriptInterface
    public void syncAlarms(String json) {
        AlarmScheduler.replaceAll(context, json);
    }

    /** 앱이 꺼져 있는 동안 알림으로 울린 오늘 알람들 (달력 화면에서 중복으로 또 울리지 않게) */
    @JavascriptInterface
    public String getFiredIds() {
        return AlarmScheduler.getFiredIds(context);
    }
}
