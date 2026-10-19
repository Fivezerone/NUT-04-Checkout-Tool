package ke.co.nutriscore.core.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ke.co.nutriscore.core.designsystem.theme.toBackgroundColor
import ke.co.nutriscore.core.designsystem.theme.toContentColor
import ke.co.nutriscore.core.model.NutriScoreGrade

@Composable
fun GradeBadge(
    grade: NutriScoreGrade,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    fontSize: TextUnit = 20.sp,
    cornerRadius: Dp = 8.dp
) {
    val bgColor = remember(grade) { grade.toBackgroundColor() }
    val contentColor = remember(grade) { grade.toContentColor() }

    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(cornerRadius))
            .background(bgColor),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = grade.name,
            color = contentColor,
            fontWeight = FontWeight.Black,
            fontSize = fontSize
        )
    }
}
