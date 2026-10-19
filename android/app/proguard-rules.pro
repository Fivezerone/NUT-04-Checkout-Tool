# Optimization configuration for R8 Full Mode (android.enableR8.fullMode=true)

# Guard KotlinX Serialization reflection surfaces without broad wildcards
-keepclassmembers class * {
    @kotlinx.serialization.SerialName <fields>;
    @kotlinx.serialization.Serializable companion();
}

# Preserve Room generated implementations
-keep class * extends androidx.room.RoomDatabase
-keepclassmembers class * extends androidx.room.RoomDatabase {
    <init>();
}

# Preserve Retrofit interface signatures and Kotlin Coroutine continuation types
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepclassmembers,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}

# Preserve Jetpack App Startup Initializers
-keep class * extends androidx.startup.Initializer {
    <init>();
}

# Strip all logging and assertion bytecode in production release builds
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
