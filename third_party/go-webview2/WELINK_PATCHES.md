# WeLink patch

Source: github.com/jchv/go-webview2, version v0.0.0-20260205173254-56598839c808. The upstream MIT license is retained in LICENSE.

Expose `SetVisible(bool)` to update the WebView2 controller through its COM API. Showing only the parent HWND can leave the controller hidden after the installer starts the process with SW_HIDE. WeLink calls this on startup and tray restoration, and hides the controller when hiding the main window. Showing also refreshes the controller bounds and parent position. Tests check the actual Chromium child window visibility, rather than treating a DOM callback as proof that pixels are visible.
