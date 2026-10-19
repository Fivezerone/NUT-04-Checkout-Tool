package ke.co.nutriscore.core.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import ke.co.nutriscore.core.model.CartItem
import ke.co.nutriscore.core.model.NutrientValues
import ke.co.nutriscore.core.model.NutriScoreGrade
import ke.co.nutriscore.core.model.Retailer

@Entity(
    tableName = "cart_items",
    indices = [
        Index(value = ["retailer", "product_id"], unique = true)
    ]
)
data class CartItemEntity(
    @PrimaryKey
    @ColumnInfo(name = "id") val id: String, // Format: "${retailer}_${productId}"
    @ColumnInfo(name = "product_id") val productId: String,
    @ColumnInfo(name = "product_name") val productName: String,
    @ColumnInfo(name = "retailer") val retailer: String,
    @ColumnInfo(name = "quantity") val quantity: Int,
    @ColumnInfo(name = "price_kes") val priceKes: Double,
    @ColumnInfo(name = "nutriscore_grade") val nutriscoreGrade: String,
    @ColumnInfo(name = "energy_kcal") val energyKcal: Double? = null,
    @ColumnInfo(name = "energy_kj") val energyKj: Double? = null,
    @ColumnInfo(name = "sugars_g") val sugarsG: Double? = null,
    @ColumnInfo(name = "sodium_mg") val sodiumMg: Double? = null,
    @ColumnInfo(name = "salt_g") val saltG: Double? = null,
    @ColumnInfo(name = "saturated_fat_g") val saturatedFatG: Double? = null,
    @ColumnInfo(name = "fibre_g") val fibreG: Double? = null,
    @ColumnInfo(name = "protein_g") val proteinG: Double? = null,
    @ColumnInfo(name = "potassium_mg") val potassiumMg: Double? = null,
    @ColumnInfo(name = "phosphorus_mg") val phosphorusMg: Double? = null,
    @ColumnInfo(name = "added_at") val addedAt: Long = System.currentTimeMillis()
) {
    fun toDomainModel(): CartItem = CartItem(
        id = id,
        productId = productId,
        productName = productName,
        retailer = Retailer.fromString(retailer),
        quantity = quantity,
        priceKes = priceKes,
        nutriscoreGrade = NutriScoreGrade.fromString(nutriscoreGrade),
        nutrients = NutrientValues(
            energyKcal = energyKcal,
            energyKj = energyKj,
            sugarsG = sugarsG,
            sodiumMg = sodiumMg,
            saltG = saltG,
            saturatedFatG = saturatedFatG,
            fibreG = fibreG,
            proteinG = proteinG,
            potassiumMg = potassiumMg,
            phosphorusMg = phosphorusMg
        ),
        addedAt = addedAt
    )

    companion object {
        fun fromDomainModel(item: CartItem): CartItemEntity = CartItemEntity(
            id = item.id,
            productId = item.productId,
            productName = item.productName,
            retailer = item.retailer.name,
            quantity = item.quantity,
            priceKes = item.priceKes,
            nutriscoreGrade = item.nutriscoreGrade.name,
            energyKcal = item.nutrients.energyKcal,
            energyKj = item.nutrients.energyKj,
            sugarsG = item.nutrients.sugarsG,
            sodiumMg = item.nutrients.sodiumMg,
            saltG = item.nutrients.saltG,
            saturatedFatG = item.nutrients.saturatedFatG,
            fibreG = item.nutrients.fibreG,
            proteinG = item.nutrients.proteinG,
            potassiumMg = item.nutrients.potassiumMg,
            phosphorusMg = item.nutrients.phosphorusMg,
            addedAt = item.addedAt
        )
    }
}
