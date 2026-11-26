package cn.openphysics.androidapp.ui.screens

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayInputStream
import java.io.File
import java.io.ByteArrayOutputStream
import java.io.InputStream

const val ANSWER_PHOTO_MIME_TYPE = "image/jpeg"
private const val MAX_ANSWER_PHOTO_DIMENSION = 1800
private const val ANSWER_PHOTO_JPEG_QUALITY = 86
const val MAX_UPLOAD_IMAGE_BYTES = 12 * 1024 * 1024

fun answerPhotoAuthority(packageName: String): String = "$packageName.fileprovider"

fun createAnswerPhotoFile(cacheDir: File, questionId: String): File {
    val dir = File(cacheDir, "answer_photos").apply { mkdirs() }
    val safeQuestionId = questionId.replace(Regex("[^A-Za-z0-9_-]"), "_").ifBlank { "question" }
    return File.createTempFile("answer_${safeQuestionId}_", ".jpg", dir)
}

data class PreparedAnswerPhoto(
    val bytes: ByteArray,
    val mimeType: String,
    val previewBitmap: Bitmap,
    val originalBytes: Int,
)

class UploadImageTooLargeException(
    val maxBytes: Int,
) : IllegalArgumentException("图片过大，请选择 12MB 以内的清晰图片")

fun readUploadImageBytesWithLimit(
    input: InputStream,
    maxBytes: Int = MAX_UPLOAD_IMAGE_BYTES,
): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var total = 0
    while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        total += read
        if (total > maxBytes) {
            throw UploadImageTooLargeException(maxBytes)
        }
        output.write(buffer, 0, read)
    }
    return output.toByteArray()
}

fun prepareAnswerPhoto(bytes: ByteArray): PreparedAnswerPhoto {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val options = BitmapFactory.Options().apply {
        inSampleSize = answerPhotoDecodeSampleSize(bounds.outWidth, bounds.outHeight)
        inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val decodedBitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        ?: throw IllegalArgumentException("无法读取图片")
    val bitmap = rotateBitmapByExif(decodedBitmap, bytes)
    if (bitmap !== decodedBitmap && !decodedBitmap.isRecycled) {
        decodedBitmap.recycle()
    }
    val scaledBitmap = scaleBitmapToMaxDimension(bitmap, MAX_ANSWER_PHOTO_DIMENSION)
    val output = ByteArrayOutputStream()
    scaledBitmap.compress(Bitmap.CompressFormat.JPEG, ANSWER_PHOTO_JPEG_QUALITY, output)
    val compressedBytes = output.toByteArray()
    if (scaledBitmap !== bitmap && !bitmap.isRecycled) {
        bitmap.recycle()
    }
    return PreparedAnswerPhoto(
        bytes = compressedBytes,
        mimeType = ANSWER_PHOTO_MIME_TYPE,
        previewBitmap = scaledBitmap,
        originalBytes = bytes.size,
    )
}

internal fun answerPhotoDecodeSampleSize(
    width: Int,
    height: Int,
    maxDimension: Int = MAX_ANSWER_PHOTO_DIMENSION,
): Int {
    require(width > 0 && height > 0 && maxDimension > 0) { "无法读取图片尺寸" }
    require(width <= 32768 && height <= 32768 && width.toLong() * height <= 200_000_000L) {
        "图片分辨率过大，请裁剪后重试"
    }
    var sampleSize = 1
    while ((maxOf(width, height).toLong() + sampleSize - 1) / sampleSize > maxDimension) {
        sampleSize *= 2
    }
    return sampleSize
}

fun rotatePreparedAnswerPhoto(photo: PreparedAnswerPhoto, degrees: Float): PreparedAnswerPhoto {
    val matrix = Matrix().apply { postRotate(degrees) }
    val rotated = Bitmap.createBitmap(
        photo.previewBitmap,
        0,
        0,
        photo.previewBitmap.width,
        photo.previewBitmap.height,
        matrix,
        true,
    )
    return photo.copy(bytes = encodeAnswerBitmap(rotated), previewBitmap = rotated)
}

/** Keeps the part of the photo inside [crop] (image fractions), chosen in AnswerPhotoCropDialog. */
fun cropPreparedAnswerPhoto(photo: PreparedAnswerPhoto, crop: AnswerCropRect): PreparedAnswerPhoto {
    val bitmap = photo.previewBitmap
    val left = (crop.left * bitmap.width).toInt().coerceIn(0, bitmap.width - 1)
    val top = (crop.top * bitmap.height).toInt().coerceIn(0, bitmap.height - 1)
    val right = (crop.right * bitmap.width).toInt().coerceIn(left + 1, bitmap.width)
    val bottom = (crop.bottom * bitmap.height).toInt().coerceIn(top + 1, bitmap.height)
    val cropped = Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top)
    return photo.copy(bytes = encodeAnswerBitmap(cropped), previewBitmap = cropped)
}

private fun encodeAnswerBitmap(bitmap: Bitmap): ByteArray {
    val output = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, ANSWER_PHOTO_JPEG_QUALITY, output)
    return output.toByteArray()
}

private fun rotateBitmapByExif(bitmap: Bitmap, bytes: ByteArray): Bitmap {
    val rotation = runCatching {
        ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL,
        )
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val degrees = when (rotation) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
    }
    if (degrees == 0f) return bitmap
    val matrix = Matrix().apply { postRotate(degrees) }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
}

fun scaleBitmapToMaxDimension(bitmap: Bitmap, maxDimension: Int): Bitmap {
    val width = bitmap.width
    val height = bitmap.height
    if (width <= maxDimension && height <= maxDimension) return bitmap
    val scale = maxDimension.toFloat() / maxOf(width, height).toFloat()
    val targetWidth = (width * scale).toInt().coerceAtLeast(1)
    val targetHeight = (height * scale).toInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(bitmap, targetWidth, targetHeight, true)
}
