package cn.openphysics.androidapp.data.session

import android.content.Context
import cn.openphysics.androidapp.ui.theme.AppFontSize

class FontSizeStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun read(): AppFontSize {
        return AppFontSize.fromKey(prefs.getString(KEY_FONT_SIZE, null))
    }

    fun save(fontSize: AppFontSize) {
        prefs.edit().putString(KEY_FONT_SIZE, fontSize.key).apply()
    }

    private companion object {
        const val PREFS = "openphysics_display"
        const val KEY_FONT_SIZE = "font_size"
    }
}
