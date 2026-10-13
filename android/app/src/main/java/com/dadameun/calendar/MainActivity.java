package com.dadameun.calendar;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 다담은, 달력 - 안드로이드 앱 화면
 *
 * 깃허브 페이지에 올라가 있는 달력 웹페이지를 그대로 띄워줌.
 * 일정 저장/동기화(Firebase)는 원래 달력 코드가 그대로 처리하고,
 * 앱은 "앱이 꺼져 있어도 알람 울리기"만 추가로 담당함 (AlarmScheduler / AlarmReceiver).
 */
public class MainActivity extends Activity {

    static final String APP_URL = "https://ieumnest-blip.github.io/dadameun-calendar/";
    private static final String APP_HOST = "ieumnest-blip.github.io";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1002;

    /** 앱 화면이 지금 보이는 중인지. 보이는 중이면 알람은 달력 화면이 직접 울리고, 아니면 앱이 알림으로 울림 */
    static volatile boolean inForeground = false;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable pauseTimersLater = new Runnable() {
        @Override
        public void run() {
            if (web != null && !inForeground) web.pauseTimers();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AlarmScheduler.ensureChannel(this);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#EEF2F5"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // localStorage (기존 달력이 쓰는 저장 방식)
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // 알람 "삐삐" 소리
        s.setTextZoom(100);             // 휴대폰 글자 크기 설정 때문에 달력 칸이 깨지지 않게
        s.setAllowFileAccess(false);
        s.setSupportMultipleWindows(false);

        web.addJavascriptInterface(new AndroidBridge(getApplicationContext()), "DadameunAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (APP_HOST.equalsIgnoreCase(uri.getHost())) return false; // 달력 페이지 안에서의 이동
                // 그 외 링크는 휴대폰의 기본 브라우저/앱으로 열기
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // 인터넷이 끊겨서 달력을 못 열었으면 10초 뒤에 다시 시도
                if (request.isForMainFrame()) {
                    handler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            if (web != null) web.reload();
                        }
                    }, 10000);
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            // 일정에 사진 붙이기 - "사진 선택" 버튼을 누르면 갤러리가 열리게
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(APP_URL);
        }

        askNotificationPermission();
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        inForeground = true;
        handler.removeCallbacks(pauseTimersLater);
        if (web != null) {
            web.onResume();
            web.resumeTimers();
            // 앱이 꺼져 있던 동안 앱이 울린 알람을 달력 화면에도 알려주고, 알람 목록을 다시 맞춤
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (web != null) web.evaluateJavascript("window.__onNativeResume && window.__onNativeResume();", null);
                }
            }, 500);
        }
    }

    @Override
    protected void onPause() {
        inForeground = false;
        if (web != null) {
            // 방금 추가한 일정이 클라우드에 바로 저장되도록 대기 중인 저장을 즉시 실행
            web.evaluateJavascript("window.flushPendingCloudPush && window.flushPendingCloudPush();", null);
            web.onPause();
            // 저장이 끝날 시간을 조금 준 뒤 화면 속 타이머를 멈춤 (백그라운드 알람은 앱이 담당)
            handler.postDelayed(pauseTimersLater, 5000);
        }
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // 뒤로가기: 열린 팝업이 있으면 그 팝업만 닫고(달력 페이지가 처리), 없으면 앱을 뒤로 보냄(종료 X → 알람 유지)
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
