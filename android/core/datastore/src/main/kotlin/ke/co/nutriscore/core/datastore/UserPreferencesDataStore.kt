package ke.co.nutriscore.core.datastore

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.doublePreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

enum class MedicalPreset { DIABETES, HYPERTENSION, RENAL, OBESITY }
enum class NutrientType { SUGAR, SODIUM, SATURATED_FAT }

data class UserPreferences(
    val authToken: String? = null,
    val userId: String? = null,
    val isGuest: Boolean = true,
    val diabetesActive: Boolean = false,
    val hypertensionActive: Boolean = false,
    val renalActive: Boolean = false,
    val obesityActive: Boolean = false,
    val customMaxSugarG: Double = 22.5,
    val customMaxSodiumMg: Double = 600.0,
    val customMaxSatFatG: Double = 5.0
)

@Singleton
class UserPreferencesDataStore @Inject constructor(
    private val dataStore: DataStore<Preferences>
) {
    private object Keys {
        val AUTH_TOKEN = stringPreferencesKey("auth_token")
        val USER_ID = stringPreferencesKey("user_id")
        val IS_GUEST = booleanPreferencesKey("is_guest")

        // Medical Preset Toggles
        val PRESET_DIABETES = booleanPreferencesKey("preset_diabetes")
        val PRESET_HYPERTENSION = booleanPreferencesKey("preset_hypertension")
        val PRESET_RENAL = booleanPreferencesKey("preset_renal")
        val PRESET_OBESITY = booleanPreferencesKey("preset_obesity")

        // Custom Nutrient Thresholds (g / mg)
        val MAX_SUGAR_G = doublePreferencesKey("max_sugar_g")
        val MAX_SODIUM_MG = doublePreferencesKey("max_sodium_mg")
        val MAX_SAT_FAT_G = doublePreferencesKey("max_sat_fat_g")
    }

    val userPreferencesFlow: Flow<UserPreferences> = dataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(emptyPreferences())
            } else {
                throw exception
            }
        }
        .map { prefs ->
            UserPreferences(
                authToken = prefs[Keys.AUTH_TOKEN],
                userId = prefs[Keys.USER_ID],
                isGuest = prefs[Keys.IS_GUEST] ?: true,
                diabetesActive = prefs[Keys.PRESET_DIABETES] ?: false,
                hypertensionActive = prefs[Keys.PRESET_HYPERTENSION] ?: false,
                renalActive = prefs[Keys.PRESET_RENAL] ?: false,
                obesityActive = prefs[Keys.PRESET_OBESITY] ?: false,
                customMaxSugarG = prefs[Keys.MAX_SUGAR_G] ?: 22.5,
                customMaxSodiumMg = prefs[Keys.MAX_SODIUM_MG] ?: 600.0,
                customMaxSatFatG = prefs[Keys.MAX_SAT_FAT_G] ?: 5.0
            )
        }

    suspend fun setAuthTokens(token: String, userId: String) {
        dataStore.edit { prefs ->
            prefs[Keys.AUTH_TOKEN] = token
            prefs[Keys.USER_ID] = userId
            prefs[Keys.IS_GUEST] = false
        }
    }

    suspend fun clearAuthTokens() {
        dataStore.edit { prefs ->
            prefs.remove(Keys.AUTH_TOKEN)
            prefs.remove(Keys.USER_ID)
            prefs[Keys.IS_GUEST] = true
        }
    }

    suspend fun updateMedicalPreset(preset: MedicalPreset, active: Boolean) {
        dataStore.edit { prefs ->
            when (preset) {
                MedicalPreset.DIABETES -> prefs[Keys.PRESET_DIABETES] = active
                MedicalPreset.HYPERTENSION -> prefs[Keys.PRESET_HYPERTENSION] = active
                MedicalPreset.RENAL -> prefs[Keys.PRESET_RENAL] = active
                MedicalPreset.OBESITY -> prefs[Keys.PRESET_OBESITY] = active
            }
        }
    }

    suspend fun updateCustomThreshold(nutrient: NutrientType, value: Double) {
        dataStore.edit { prefs ->
            when (nutrient) {
                NutrientType.SUGAR -> prefs[Keys.MAX_SUGAR_G] = value
                NutrientType.SODIUM -> prefs[Keys.MAX_SODIUM_MG] = value
                NutrientType.SATURATED_FAT -> prefs[Keys.MAX_SAT_FAT_G] = value
            }
        }
    }
}
