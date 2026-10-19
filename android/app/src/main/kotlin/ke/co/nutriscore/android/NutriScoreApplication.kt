package ke.co.nutriscore.android

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class NutriScoreApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // SDK initializations are deferred to Jetpack App Startup Initializers
        // to prevent blocking the main thread during cold startup.
    }
}
