package ke.co.nutriscore.core.model

import kotlinx.serialization.Serializable

@Serializable
data class HealthAlert(
    val condition: String,
    val nutrientName: String,
    val actualValue: Double,
    val thresholdValue: Double,
    val unit: String,
    val hexColor: String
)

@Serializable
data class ProductHealthAssessment(
    val hasViolations: Boolean,
    val activeAlerts: List<HealthAlert>
)

@Serializable
data class CartItem(
    val id: String, // Unique composite: "${retailer}_${productId}"
    val productId: String,
    val productName: String,
    val retailer: Retailer,
    val quantity: Int,
    val priceKes: Double,
    val nutriscoreGrade: NutriScoreGrade,
    val nutrients: NutrientValues,
    val addedAt: Long
) {
    val totalCostKes: Double
        get() = priceKes * quantity
}
