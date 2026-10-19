package ke.co.nutriscore.core.network.model

import ke.co.nutriscore.core.model.CanonicalProduct
import ke.co.nutriscore.core.model.NutrientValues
import ke.co.nutriscore.core.model.NutriScoreGrade
import ke.co.nutriscore.core.model.PackagingUnit
import ke.co.nutriscore.core.model.Retailer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class NetworkProduct(
    @SerialName("product_id") val productId: String,
    @SerialName("product_name") val productName: String,
    @SerialName("retailer") val retailer: String,
    @SerialName("normalized_name") val normalizedName: String,
    @SerialName("brand_name") val brandName: String? = null,
    @SerialName("retailer_product_url") val retailerProductUrl: String? = null,
    @SerialName("pack_size_unit") val packSizeUnit: String? = null,
    @SerialName("current_price_kes") val currentPriceKes: Double,
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
    @SerialName("phosphorus_mg") val phosphorusMg: Double? = null,
    @SerialName("nutriscore_grade") val nutriscoreGrade: String,
    @SerialName("nova_group") val novaGroup: Int? = null,
    @SerialName("category") val category: String? = null
) {
    fun toDomainModel(): CanonicalProduct = CanonicalProduct(
        productId = productId,
        productName = productName,
        retailer = Retailer.fromString(retailer),
        normalizedName = normalizedName,
        brandName = brandName,
        retailerProductUrl = retailerProductUrl,
        packSizeUnit = PackagingUnit.fromRaw(packSizeUnit),
        currentPriceKes = currentPriceKes,
        nutrients = NutrientValues(
            energyKcal = energyKcal,
            energyKj = energyKj,
            fatG = fatG,
            saturatedFatG = saturatedFatG,
            carbohydratesG = carbohydratesG,
            sugarsG = sugarsG,
            fibreG = fibreG,
            proteinG = proteinG,
            sodiumMg = sodiumMg,
            saltG = saltG,
            potassiumMg = potassiumMg,
            phosphorusMg = phosphorusMg
        ),
        nutriscoreGrade = NutriScoreGrade.fromString(nutriscoreGrade),
        novaGroup = novaGroup,
        category = category
    )
}

@Serializable
data class LivePriceResponse(
    @SerialName("product_id") val productId: String,
    @SerialName("retailer") val retailer: String,
    @SerialName("price_kes") val priceKes: Double,
    @SerialName("verified_at") val verifiedAt: String
)
