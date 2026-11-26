package cn.openphysics.androidapp.domain

import java.time.Instant

object StudentAccessPolicy {
    fun hasFullLearningAccess(session: StudentSession, now: Instant = Instant.now()): Boolean = canReadOwnHistory(session)
    fun canReadOwnHistory(session: StudentSession): Boolean = session.accountStatus.isBlank() || session.accountStatus == "active"
    fun canAccessKp(session: StudentSession, kp: KpNode): Boolean = hasFullLearningAccess(session)
    fun canUseAdaptivePractice(session: StudentSession): Boolean = hasFullLearningAccess(session)
    fun accountRequiredMessage(): String = "账号不可用，请重新登录或联系部署管理员。"
}
