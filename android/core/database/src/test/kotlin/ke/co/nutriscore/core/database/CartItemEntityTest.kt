package ke.co.nutriscore.core.database

import ke.co.nutriscore.core.database.entity.CartItemEntity
import ke.co.nutriscore.core.model.CartItem
import ke.co.nutriscore.core.model.NutrientValues
import ke.co.nutriscore.core.model.NutriScoreGrade
import ke.co.nutriscore.core.model.Retailer
import org.junit.Assert.assertEquals
import org.junit.Test

class CartItemEntityTest {

    @Test
    fun `CartItemEntity roundtrip preserves all domain values accurately`() {
        val original = CartItem(
            id = "QUICKMART_12345",
            productId = "12345",
            productName = "Brookside Whole Milk 500ml",
            retailer = Retailer.QUICKMART,
            quantity = 2,
            priceKes = 65.0,
            nutriscoreGrade = NutriScoreGrade.A,
            nutrients = NutrientValues(
                energyKcal = 65.0,
                sugarsG = 4.7,
                sodiumMg = 50.0,
                saturatedFatG = 2.1
            ),
            addedAt = 1729350000000L
        )

        val entity = CartItemEntity.fromDomainModel(original)
        val roundtrip = entity.toDomainModel()

        assertEquals(original.id, roundtrip.id)
        assertEquals(original.productId, roundtrip.productId)
        assertEquals(original.productName, roundtrip.productName)
        assertEquals(original.retailer, roundtrip.retailer)
        assertEquals(original.quantity, roundtrip.quantity)
        assertEquals(original.priceKes, roundtrip.priceKes, 0.001)
        assertEquals(original.nutriscoreGrade, roundtrip.nutriscoreGrade)
        assertEquals(original.nutrients.sugarsG, roundtrip.nutrients.sugarsG)
        assertEquals(original.totalCostKes, 130.0, 0.001)
    }
}
