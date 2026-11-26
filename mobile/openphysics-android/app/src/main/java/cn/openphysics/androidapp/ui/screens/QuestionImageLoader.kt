package cn.openphysics.androidapp.ui.screens

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import cn.openphysics.androidapp.domain.QuestionImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URL

@Composable
fun rememberQuestionBitmap(image: QuestionImage?): Bitmap? {
    var bitmap by remember(image?.imageUrl) { mutableStateOf<Bitmap?>(null) }
    LaunchedEffect(image?.imageUrl) {
        bitmap = null
        val url = image?.imageUrl?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        bitmap = withContext(Dispatchers.IO) {
            runCatching {
                URL(url).openStream().use { BitmapFactory.decodeStream(it) }
            }.getOrNull()
        }
    }
    return bitmap
}
