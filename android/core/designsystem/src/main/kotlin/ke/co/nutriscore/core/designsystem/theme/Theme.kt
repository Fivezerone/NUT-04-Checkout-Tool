package ke.co.nutriscore.core.designsystem.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LightColorScheme = lightColorScheme(
    primary = GradeColorA,
    onPrimary = GradeOnColorA,
    primaryContainer = Color(0xFFE8F5E9),
    onPrimaryContainer = Color(0xFF1B5E20),
    secondary = RetailerCarrefourColor,
    onSecondary = Color.White,
    background = BackgroundLight,
    surface = SurfaceCard,
    onBackground = TextPrimary,
    onSurface = TextPrimary
)

@Composable
fun NutriScoreTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    // Standardizes on high-contrast accessibility compliant light theme tokens
    MaterialTheme(
        colorScheme = LightColorScheme,
        typography = NutriScoreTypography,
        shapes = NutriScoreShapes,
        content = content
    )
}
