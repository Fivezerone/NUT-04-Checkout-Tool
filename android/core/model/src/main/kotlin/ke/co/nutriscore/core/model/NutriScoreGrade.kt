package ke.co.nutriscore.core.model

import kotlinx.serialization.Serializable

@Serializable
enum class NutriScoreGrade(val label: String, val scoreValue: Int) {
    A("Everyday Choice", 1),
    B("Great Choice", 2),
    C("Balanced Choice", 3),
    D("Enjoy Occasionally", 4),
    E("Limit Intake", 5);

    companion object {
        fun fromString(value: String?): NutriScoreGrade {
            return when (value?.trim()?.uppercase()) {
                "A" -> A
                "B" -> B
                "C" -> C
                "D" -> D
                "E" -> E
                else -> C // Default fallback for unknown or unverified items
            }
        }
    }
}

@Serializable
enum class Retailer(val displayName: String, val defaultCurrency: String) {
    NAIVAS("Naivas", "KES"),
    CARREFOUR("Carrefour", "KES"),
    QUICKMART("Quickmart", "KES");

    companion object {
        fun fromString(value: String?): Retailer {
            return when (value?.trim()?.uppercase()) {
                "NAIVAS" -> NAIVAS
                "CARREFOUR" -> CARREFOUR
                "QUICKMART" -> QUICKMART
                else -> NAIVAS
            }
        }
    }
}
