package ke.co.nutriscore.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CanonicalProductTest {

    @Test
    fun `effectiveSodiumMg uses sodiumMg when present`() {
        val nutrients = NutrientValues(
            sodiumMg = 500.0,
            saltG = 2.0
        )
        assertEquals(500.0, nutrients.effectiveSodiumMg ?: 0.0, 0.001)
    }

    @Test
    fun `effectiveSodiumMg falls back to saltG times 400 when sodiumMg is null`() {
        val nutrients = NutrientValues(
            sodiumMg = null,
            saltG = 2.0
        )
        // 2g salt * 400 = 800mg sodium
        assertEquals(800.0, nutrients.effectiveSodiumMg ?: 0.0, 0.001)
    }

    @Test
    fun `effectiveSodiumMg returns null when both sodiumMg and saltG are null`() {
        val nutrients = NutrientValues(
            sodiumMg = null,
            saltG = null
        )
        assertNull(nutrients.effectiveSodiumMg)
    }

    @Test
    fun `NutriScoreGrade fromString parses valid and fallback values accurately`() {
        assertEquals(NutriScoreGrade.A, NutriScoreGrade.fromString("A"))
        assertEquals(NutriScoreGrade.B, NutriScoreGrade.fromString("b"))
        assertEquals(NutriScoreGrade.C, NutriScoreGrade.fromString("unknown_val"))
        assertEquals(NutriScoreGrade.E, NutriScoreGrade.fromString("E "))
    }

    @Test
    fun `PackagingUnit parses various raw size labels`() {
        assertEquals(PackagingUnit.G, PackagingUnit.fromRaw("gms"))
        assertEquals(PackagingUnit.KG, PackagingUnit.fromRaw("KG"))
        assertEquals(PackagingUnit.L, PackagingUnit.fromRaw("litres"))
        assertEquals(PackagingUnit.ML, PackagingUnit.fromRaw("ml"))
        assertEquals(PackagingUnit.PCS, PackagingUnit.fromRaw("pieces"))
        assertNull(PackagingUnit.fromRaw("custom_pack"))
    }
}
