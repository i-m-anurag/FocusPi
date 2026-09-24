package expo.modules.focusdnd

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NoPolicyAccessException :
  CodedException("Do Not Disturb access is not granted. Open settings and allow it for Focus Mode.")

class FocusDndModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun openSettings(intent: Intent) {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  override fun definition() = ModuleDefinition {
    Name("FocusDnd")

    Function("hasPolicyAccess") {
      FocusController.hasPolicyAccess(context)
    }

    Function("openPolicyAccessSettings") {
      openSettings(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS))
    }

    Function("canScheduleExactAlarms") {
      FocusController.canScheduleExactAlarms(context)
    }

    Function("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        openSettings(
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))
        )
      }
    }

    Function("startFocus") { endAtMs: Double, callers: String, repeatCallers: Boolean, allowAlarms: Boolean, label: String ->
      if (!FocusController.hasPolicyAccess(context)) throw NoPolicyAccessException()
      FocusController.start(context, endAtMs.toLong(), callers, repeatCallers, allowAlarms, label)
      true
    }

    Function("setAlarmOptions") { enabled: Boolean, sound: String, seconds: Int, vibrate: Boolean ->
      FocusController.setAlarmOptions(context, enabled, sound, seconds, vibrate)
      true
    }

    Function("stopAlarm") {
      FocusController.stopAlarm(context)
      FocusController.dismissDoneNotification(context)
      true
    }

    /** Plays the alarm now so the user can hear their choice. */
    Function("previewAlarm") {
      FocusController.playAlarm(context, force = true)
      true
    }

    Function("stopFocus") { completed: Boolean ->
      FocusController.stop(context, completed)
      true
    }

    Function("getState") {
      mapOf(
        "active" to FocusController.isActive(context),
        "endAtMs" to FocusController.endAt(context).toDouble(),
        "label" to FocusController.label(context),
        "interruptionFilter" to FocusController.interruptionFilter(context),
        "hasPolicyAccess" to FocusController.hasPolicyAccess(context),
        "canScheduleExactAlarms" to FocusController.canScheduleExactAlarms(context),
        "alarmPlaying" to FocusController.isAlarmPlaying()
      )
    }
  }
}
