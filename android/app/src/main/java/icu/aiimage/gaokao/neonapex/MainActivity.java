package icu.aiimage.gaokao.neonapex;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

public final class MainActivity extends Activity {
  private WebView webView;
  private WebViewAssetLoader assetLoader;

  @Override
  protected void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

    assetLoader = new WebViewAssetLoader.Builder()
        .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
        .build();

    webView = new WebView(this);
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setBuiltInZoomControls(false);
    settings.setDisplayZoomControls(false);
    settings.setSupportZoom(false);
    settings.setTextZoom(100);
    settings.setUserAgentString(settings.getUserAgentString() + " NeonApexAndroid/1.1");
    webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
    webView.setBackgroundColor(0x00000000);
    webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
    webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
    webView.setHapticFeedbackEnabled(true);
    webView.setLongClickable(false);
    webView.setWebChromeClient(new WebChromeClient());
    webView.setWebViewClient(new WebViewClientCompat() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return assetLoader.shouldInterceptRequest(request.getUrl());
      }
    });
    setContentView(webView);
    webView.loadUrl("https://appassets.androidplatform.net/index.html");
  }

  @Override
  protected void onPause() {
    if (webView != null) {
      webView.onPause();
      webView.pauseTimers();
    }
    super.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (webView != null) {
      webView.onResume();
      webView.resumeTimers();
    }
  }

  @Override
  public void onBackPressed() {
    if (webView == null) {
      exitFromBack();
      return;
    }
    webView.evaluateJavascript(
        "window.__NEON_APEX_ANDROID_BACK__ ? window.__NEON_APEX_ANDROID_BACK__() : false",
        handled -> {
          if (!"true".equals(handled)) exitFromBack();
        });
  }

  private void exitFromBack() {
    super.onBackPressed();
  }

  @Override
  protected void onDestroy() {
    if (webView != null) {
      webView.stopLoading();
      webView.destroy();
    }
    super.onDestroy();
  }
}
