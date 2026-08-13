package ca.uwindsor.acare;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges window.print() to Android's PrintManager.
 *
 * window.print() is a no-op inside a WebView, which would leave the Print
 * Report buttons doing nothing on Android. Printing the live WebView through
 * createPrintDocumentAdapter() keeps the app's existing @media print CSS and
 * the cloned print portal in Reports.tsx in play, so the output matches what
 * the web build produces.
 *
 * This is a local plugin rather than an npm dependency: the only published
 * option is at 0.0.6 with no stated Capacitor 8 support, and this is small
 * enough that owning it outright is the safer trade.
 */
@CapacitorPlugin(name = "Printer")
public class PrinterPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        final String jobName = call.getString("name", "ACARE Report");

        getActivity().runOnUiThread(() -> {
            try {
                PrintManager printManager =
                        (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                if (printManager == null) {
                    call.reject("Printing is not available on this device.");
                    return;
                }

                WebView webView = getBridge().getWebView();
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);

                printManager.print(
                        jobName,
                        adapter,
                        new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.NA_LETTER)
                                .build());

                call.resolve();
            } catch (Exception e) {
                call.reject("Failed to start the print job.", e);
            }
        });
    }
}
