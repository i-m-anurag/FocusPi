package expo.modules.focusdnd

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** AlarmManager fires this when the focus timer runs out. */
class FocusEndReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == FocusController.ACTION_END) {
      FocusController.stop(context, completed = true)
    }
  }
}

/** Alarms are wiped on reboot/update, so finish or re-arm a running session. */
class FocusBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> FocusController.resume(context)
    }
  }
}
