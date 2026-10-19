package ke.co.nutriscore.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class PackagingUnit {
    KG, G, ML, L, PCS;

    companion object {
        fun fromRaw(raw: String?): PackagingUnit? {
            if (raw.isNullOrBlank()) return null
            val upper = raw.trim().uppercase()
            return when {
                upper == "KG" -> KG
                upper in listOf("G", "GM", "GMS") -> G
                upper == "ML" -> ML
                upper in listOf("L", "LTR", "LTRS", "LITRE", "LITRES") -> L
                upper in listOf("PCS", "PIECE", "PIECES") -> PCS
                else -> null
            }
        }
    }
}

@Serializable
data class NutrientValues(
    @SerialName("energy_kcal") val energyKcal: Double? = null,
    @SerialName("energy_kj") val energyKj: Double? = null,
    @SerialName("fat_g") val fatG: Double? = null,
    @SerialName("saturated_fat_g") val saturatedFatG: Double? = null,
    @SerialName("carbohydrates_g") val carbohydratesG: Double? = null,
    @SerialName("sugars_g") val sugarsG: Double? = null,
    @SerialName("fibre_g") val fibreG: Double? = null,
    @SerialName("protein_g") val proteinG: Double? = null,
    @SerialName("sodium_mg") val sodiumMg: Double? = null,
    @SerialName("salt_g") val saltG: Double? = null,
    @SerialName("potassium_mg") val potassiumMg: Double? = null,
    @SerialName("phosphorus_mg") val phosphorusMg: Double? = null
) {
    /**
     * Resolves effective sodium in milligrams.
     * Follows the extension rule: If sodium is absent but salt is present, 1g salt = 400mg sodium.
     */
    val effectiveSodiumMg: Double?
        get() = sodiumMg ?: saltG?.let { it * 400.0 }
}

@Serializable
data class CanonicalProduct(
    @SerialName("product_id") val productId: String,
    @SerialName("product_name") val productName: String,
    @SerialName("retailer") val retailer: Retailer,
    @SerialName("normalized_name") val normalizedName: String,
    @SerialName("brand_name") val brandName: String? = null,
    @SerialName("retailer_product_url") val retailerProductUrl: String? = null,
    @SerialName("pack_size_unit") val packSizeUnit: PackagingUnit? = null,
    @SerialName("current_price_kes") val currentPriceKes: Double,
    @SerialName("nutrients") val nutrients: NutrientValues,
    @SerialName("nutriscore_grade") val nutriscoreGrade: NutriScoreGrade,
    @SerialName("nova_group") val novaGroup: Int? = null,
    @SerialName("category") val category: String? = null,
    @SerialName("last_verified_timestamp") val lastVerifiedTimestamp: Long = System.currentTimeMillis()
)
