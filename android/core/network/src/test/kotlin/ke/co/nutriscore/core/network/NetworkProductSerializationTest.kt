package ke.co.nutriscore.core.network

import ke.co.nutriscore.core.model.NutriScoreGrade
import ke.co.nutriscore.core.model.PackagingUnit
import ke.co.nutriscore.core.model.Retailer
import ke.co.nutriscore.core.network.model.NetworkProduct
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class NetworkProductSerializationTest {

    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }

    @Test
    fun `NetworkProduct decodes valid backend JSON and maps to domain accurately`() {
        val rawJson = """
            {
                "product_id": "NAIVAS_99182",
                "product_name": "Brookside Low Fat Milk 500ml",
                "retailer": "NAIVAS",
                "normalized_name": "brookside low fat milk 500ml",
                "brand_name": "Brookside",
                "pack_size_unit": "ML",
                "current_price_kes": 70.00,
                "energy_kcal": 45.0,
                "sugars_g": 4.8,
                "sodium_mg": 48.0,
                "nutriscore_grade": "A",
                "nova_group": 1,
                "category": "Dairy"
            }
        """.trimIndent()

        val networkModel = json.decodeFromString<NetworkProduct>(rawJson)
        val domain = networkModel.toDomainModel()

        assertEquals("NAIVAS_99182", domain.productId)
        assertEquals(Retailer.NAIVAS, domain.retailer)
        assertEquals(PackagingUnit.ML, domain.packSizeUnit)
        assertEquals(70.00, domain.currentPriceKes, 0.001)
        assertEquals(NutriScoreGrade.A, domain.nutriscoreGrade)
        assertEquals(4.8, domain.nutrients.sugarsG ?: 0.0, 0.001)
        assertEquals(48.0, domain.nutrients.effectiveSodiumMg ?: 0.0, 0.001)
    }
}
