package cn.openphysics.androidapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.ViewModelProvider
import cn.openphysics.androidapp.ui.AppController
import cn.openphysics.androidapp.ui.OpenPhysicsApp

class MainActivity : ComponentActivity() {
    private lateinit var controller: AppController

    override fun onSaveInstanceState(outState: Bundle) {
        // Persist before Android can reclaim this activity while the camera is foreground.
        controller.checkpointPracticeForRecreation()?.let { outState.putString("practice_student", it) }
        super.onSaveInstanceState(outState)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        controller = ViewModelProvider(this, AppController.factory(
            applicationContext, savedInstanceState?.getString("practice_student"),
        ))[AppController::class.java]
        enableEdgeToEdge()
        setContent {
            OpenPhysicsApp(controller = controller, onExit = { finish() })
        }
    }
}
