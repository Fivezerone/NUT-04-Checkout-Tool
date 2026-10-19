package ke.co.nutriscore.core.designsystem.theme

import androidx.compose.ui.graphics.Color
import ke.co.nutriscore.core.model.NutriScoreGrade
import ke.co.nutriscore.core.model.Retailer

/**
 * NutriScore Official Grade Colors (WCAG AAA/AA Compliant)
 * Exactly matched to src/extension/adapters/grade-colors.js & globals.css:
 * A: { bg: "#037b3e", txt: "#ffffff", on: "#ffffff" }
 * B: { bg: "#85bb2f", txt: "#14320a", on: "#14320a" }
 * C: { bg: "#fecb02", txt: "#3a2e00", on: "#3a2e00" }
 * D: { bg: "#ee8100", txt: "#331c00", on: "#331c00" }
 * E: { bg: "#e63e11", txt: "#ffffff", on: "#ffffff" }
 */
val GradeColorA = Color(0xFF037B3E)
val GradeOnColorA = Color(0xFFFFFFFF)

val GradeColorB = Color(0xFF85BB2F)
val GradeOnColorB = Color(0xFF14320A)

val GradeColorC = Color(0xFFFECB02)
val GradeOnColorC = Color(0xFF3A2E00)

val GradeColorD = Color(0xFFEE8100)
val GradeOnColorD = Color(0xFF331C00)

val GradeColorE = Color(0xFFE63E11)
val GradeOnColorE = Color(0xFFFFFFFF)

/**
 * Supermarket Retailer Identity Tokens
 */
val RetailerNaivasColor = Color(0xFF00843D)
val RetailerCarrefourColor = Color(0xFF004E9A)
val RetailerQuickmartColor = Color(0xFFEE3434)

/**
 * Disease Engine Medical Profile Colors (From health-modes.mjs)
 */
val DiseaseGeneralColor = Color(0xFF2E7D32)
val DiseaseDiabetesColor = Color(0xFFD32F2F)
val DiseaseHypertensionColor = Color(0xFFE65100)
val DiseaseRenalColor = Color(0xFF00796B)
val DiseaseObesityColor = Color(0xFF7B1FA2)

// Neutral UI Palette
val BackgroundLight = Color(0xFFF9FAFB)
val SurfaceCard = Color(0xFFFFFFFF)
val TextPrimary = Color(0xFF111827)
val TextSecondary = Color(0xFF6B7280)
val DividerColor = Color(0xFFE5E7EB)

fun NutriScoreGrade.toBackgroundColor(): Color = when (this) {
    NutriScoreGrade.A -> GradeColorA
    NutriScoreGrade.B -> GradeColorB
    NutriScoreGrade.C -> GradeColorC
    NutriScoreGrade.D -> GradeColorD
    NutriScoreGrade.E -> GradeColorE
}

fun NutriScoreGrade.toContentColor(): Color = when (this) {
    NutriScoreGrade.A -> GradeOnColorA
    NutriScoreGrade.B -> GradeOnColorB
    NutriScoreGrade.C -> GradeOnColorC
    NutriScoreGrade.D -> GradeOnColorD
    NutriScoreGrade.E -> GradeOnColorE
}

fun Retailer.toBrandColor(): Color = when (this) {
    Retailer.NAIVAS -> RetailerNaivasColor
    Retailer.CARREFOUR -> RetailerCarrefourColor
    Retailer.QUICKMART -> RetailerQuickmartColor
}
