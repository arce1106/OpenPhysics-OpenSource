package cn.openphysics.androidapp.ui.screens

import cn.openphysics.androidapp.data.api.*
import cn.openphysics.androidapp.domain.StudentSession
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class StudentClassesStoreTest {
    private val owner = StudentSession("token-a", "student-a", "student_account", "原姓名")
    private val member = StudentClassMembership("class-a", "高三（3）", "王老师", "007", false, true)
    private val invitation = StudentClassInvitation(member, false, "class-version-1")
    private fun actions(
        load: suspend (StudentSession) -> List<StudentClassMembership> = { emptyList() },
        preview: suspend (String, StudentSession) -> StudentClassInvitation = { _, _ -> invitation },
        join: suspend (String, String, String, StudentSession) -> StudentClassJoinResult = { _, _, name, _ -> StudentClassJoinResult(member, name) },
        leave: suspend (StudentClassMembership, StudentSession) -> Unit = { _, _ -> },
        rename: suspend (String, StudentSession) -> String = { name, _ -> name },
    ) = StudentClassActions(load, preview, join, leave, rename)

    @Test fun previewIsReadOnlyAndJoinBindsTrimmedNameToCurrentAccountOnce() = runBlocking {
        var joins = 0; var leaves = 0
        val store = StudentClassesStore(actions(join = { code, version, name, current ->
            joins++; assertEquals("AM7EMGX6", code); assertEquals("class-version-1", version)
            assertEquals("张三", name); assertEquals(owner, current)
            StudentClassJoinResult(member, name)
        }, leave = { selected, current -> leaves++; assertEquals(member, selected); assertEquals(owner, current) }))
        store.load(owner); store.code = " am7emgx6 "; store.preview(owner)
        assertTrue(store.memberships.isEmpty()); assertEquals(invitation, store.invitation)
        store.studentName = " 张三 "; store.join(owner); store.join(owner)
        assertEquals(1, joins); assertEquals(listOf(member), store.memberships)
        assertEquals("", store.code); assertNull(store.invitation)
        store.leave(member, owner); assertEquals(1, leaves); assertTrue(store.memberships.isEmpty())
    }

    @Test fun renameNeedsAClassAndAValidNameAndSendsItTrimmed() = runBlocking {
        val sent = mutableListOf<String>()
        val store = StudentClassesStore(actions(load = { listOf(member) }, rename = { name, _ -> sent += name; name }))
        store.newName = "张三"; assertFalse(store.canRename)
        store.load(owner); store.renaming = true
        for (name in listOf("", "张\n三", "张".repeat(41))) { store.newName = name; assertFalse(store.canRename); store.rename(owner) }
        store.newName = " 张三 "; store.rename(owner)
        assertEquals(listOf("张三"), sent); assertFalse(store.renaming); assertTrue(store.notice.contains("张三"))
    }

    @Test fun nameIsRequiredAndChangingCodeInvalidatesPreview() = runBlocking {
        var previews = 0
        val store = StudentClassesStore(actions(preview = { _, _ -> previews++; invitation }, join = { _, _, _, _ -> error("Must not join") }))
        store.load(owner); store.code = "123"; store.preview(owner); assertEquals(0, previews)
        store.code = "AM7EMGX6"; store.preview(owner)
        for (name in listOf("", "   ", "张\n三", "张".repeat(41))) {
            store.studentName = name; assertFalse(store.canJoin); store.join(owner)
        }
        store.studentName = "张三"; assertTrue(store.canJoin)
        store.code = "BN8FNHR7"; assertNull(store.invitation); assertFalse(store.canJoin)
    }

    @Test fun duplicateTapAndOldAccountCompletionCannotLeakData() = runBlocking {
        val pending = CompletableDeferred<StudentClassInvitation>(); var calls = 0
        val store = StudentClassesStore(actions(preview = { _, _ -> calls++; pending.await() }))
        store.load(owner); store.code = "AM7EMGX6"
        val first = launch(start = CoroutineStart.UNDISPATCHED) { store.preview(owner) }
        store.preview(owner); assertEquals(1, calls)
        store.load(owner.copy(token = "token-b", studentId = "student-b"))
        pending.complete(invitation); first.join()
        assertNull(store.invitation); assertTrue(store.memberships.isEmpty()); assertFalse(store.busy)
        assertEquals("", store.code); assertEquals("", store.studentName)
    }

    @Test fun expiredInvitationAndRejectedJoinPreserveMembershipAndAllowRetry() = runBlocking {
        var failed = true
        val store = StudentClassesStore(actions(load = { listOf(member) }, preview = { _, _ ->
            if (failed) throw ApiHttpException(400, "", "邀请码已过期") else invitation
        }, join = { _, _, _, _ -> throw ApiHttpException(403, "", "你已被移出班级") }))
        store.load(owner); store.code = "AM7EMGX6"; store.preview(owner)
        assertEquals("邀请码已过期", store.error); assertFalse(store.busy)
        failed = false; store.preview(owner); store.studentName = "张三"; store.join(owner)
        assertEquals("你已被移出班级", store.error); assertNull(store.invitation)
        assertEquals(listOf(member), store.memberships)
    }

    @Test fun alreadyJoinedPreviewCannotWriteAgain() = runBlocking {
        val store = StudentClassesStore(actions(preview = { _, _ -> invitation.copy(alreadyJoined = true) },
            join = { _, _, _, _ -> error("Must not rejoin") }))
        store.load(owner); store.code = "AM7EMGX6"; store.studentName = "张三"; store.preview(owner); store.join(owner)
        assertFalse(store.canJoin); assertTrue(store.invitation!!.alreadyJoined)
    }

    @Test fun disposalAndCancellationDoNotLeaveBusyOrApplyLateData() = runBlocking {
        val gate = CompletableDeferred<StudentClassInvitation>()
        val store = StudentClassesStore(actions(preview = { _, _ -> gate.await() }))
        store.load(owner); store.code = "AM7EMGX6"
        val job = launch(start = CoroutineStart.UNDISPATCHED) { store.preview(owner) }
        job.cancelAndJoin(); assertFalse(store.busy); assertEquals("", store.error)
        store.deactivate(); assertNull(store.invitation); assertEquals("", store.code)
    }
}
