package io.github.yayacyan.kanjitestmaker;

import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * アプリ ID（io.github.yayacyan.kanjitestmaker）は、最初のストア公開の前なら変えられます。
 * WebView の window.print() だけでは Android の印刷画面が開かないため、
 * サイト側が KanjiPrint.print() を呼んだときだけ PrintManager を使います。
 * その画面で「PDF に保存」も選べます。
 */
public class MainActivity extends BridgeActivity {
    private boolean printBridgeAdded = false;

    @Override
    public void onStart() {
        super.onStart();
        WebView webView = getBridge().getWebView();
        if (!printBridgeAdded && webView != null) {
            webView.addJavascriptInterface(new KanjiPrint(webView), "KanjiPrint");
            printBridgeAdded = true;
        }
    }

    private final class KanjiPrint {
        private final WebView webView;

        KanjiPrint(WebView webView) {
            this.webView = webView;
        }

        @JavascriptInterface
        public void print() {
            runOnUiThread(() -> {
                PrintManager manager = (PrintManager) getSystemService(PRINT_SERVICE);
                if (manager == null) return;
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter("kanji-test");
                manager.print("漢字テスト", adapter, new PrintAttributes.Builder().build());
            });
        }
    }
}
