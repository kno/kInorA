# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Preserve line numbers in stack traces for crash reporting.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# Capacitor — keep all public entry points that the JS bridge calls via
# reflection.  Without these rules R8 will strip or rename them and the
# WebView bridge will break at runtime.
# ---------------------------------------------------------------------------
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.PluginMethod public *;
}

# Keep the app's main activity (Capacitor host).
-keep class com.kinora.app.MainActivity { *; }

# WebView JavaScript interface: keep any class with @JavascriptInterface methods.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# AndroidX / support library reflection used by Capacitor internals.
-keep class androidx.** { *; }
-dontwarn androidx.**

# Cordova plugin compatibility (Capacitor bridges through these at runtime).
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**
