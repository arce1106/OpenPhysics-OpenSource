package cn.openphysics.androidapp.domain

import org.junit.Assert.*
import org.junit.Test

class StudentAccessPolicyTest {
    private fun account(status: String = "active") = StudentSession("token", "demo", "demo", "演示", status)
    @Test fun `active accounts can use all learning features`() {
        assertTrue(StudentAccessPolicy.hasFullLearningAccess(account()))
        assertTrue(StudentAccessPolicy.canUseAdaptivePractice(account()))
        assertTrue(StudentAccessPolicy.canReadOwnHistory(account()))
    }
    @Test fun `disabled accounts cannot use learning features`() {
        assertFalse(StudentAccessPolicy.hasFullLearningAccess(account("disabled")))
        assertFalse(StudentAccessPolicy.canUseAdaptivePractice(account("disabled")))
    }
}
