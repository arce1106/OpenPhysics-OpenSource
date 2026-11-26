package cn.openphysics.androidapp.domain

object UsernamePolicy {
    const val Hint = "中文2—8字，英文4—16位；混合时汉字算2位，总长4—16位。支持汉字、字母、数字、下划线，不能为纯数字。"
    private val allowed = Regex("[\\u3400-\\u4dbf\\u4e00-\\u9fffA-Za-z0-9_]+")
    private val letter = Regex("[\\u3400-\\u4dbf\\u4e00-\\u9fffA-Za-z]")
    fun length(value: String): Int = value.fold(0) { total, char -> total + if (char.code > 127) 2 else 1 }
    fun valid(value: String): Boolean = allowed.matches(value) && letter.containsMatchIn(value) && length(value) in 4..16
}
