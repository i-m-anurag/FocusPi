package expo.modules.focusdnd

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.NotificationManager.Policy
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build

/**
 * Turns Android Do Not Disturb into "calls only" for the length of a focus
 * session, and puts everything back the way it was afterwards.
 *
 * - Calls ring (from anyone / contacts / starred, configurable).
 * - Every other notification still lands in the shade, but silently:
 *   no sound, no vibration, no heads-up pop-up, no LED.
 * - An AlarmManager alarm ends the session on time even if the app is killed,
 *   and a boot receiver cleans up after a reboot.
 */
object FocusController {
  private const val PREFS = "focus_dnd"
  private const val CHANNEL_ONGOING = "focus_ongoing"
  private const val CHANNEL_DONE = "focus_done"
  private const val NOTIF_ONGOING = 4201
  private const val NOTIF_DONE = 4202
  const val ACTION_END = "expo.modules.focusdnd.ACTION_END"

  private fun nm(ctx: Context) = ctx.getSystemService(NotificationManager::class.java)
  private fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun hasPolicyAccess(ctx: Context): Boolean = nm(ctx).isNotificationPolicyAccessGranted

  fun canScheduleExactAlarms(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    return ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
  }

  fun isActive(ctx: Context) = prefs(ctx).getBoolean("active", false)
  fun endAt(ctx: Context) = prefs(ctx).getLong("end_at", 0L)
  fun label(ctx: Context) = prefs(ctx).getString("label", "") ?: ""
  fun interruptionFilter(ctx: Context) = nm(ctx).currentInterruptionFilter

  fun start(
    ctx: Context,
    endAtMs: Long,
    callers: String,
    repeatCallers: Boolean,
    allowAlarms: Boolean,
    label: String
  ) {
    val nm = nm(ctx)
    if (!nm.isNotificationPolicyAccessGranted) {
      throw SecurityException("Do Not Disturb access has not been granted")
    }
    val prefs = prefs(ctx)
    val editor = prefs.edit()

    // Remember the user's own DND setup once, so a restart/resync mid-session
    // doesn't overwrite it with our focus policy.
    if (!prefs.getBoolean("active", false)) {
      val p = nm.notificationPolicy
      editor
        .putInt("prev_filter", nm.currentInterruptionFilter)
        .putInt("prev_categories", p.priorityCategories)
        .putInt("prev_calls", p.priorityCallSenders)
        .putInt("prev_messages", p.priorityMessageSenders)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        editor.putInt("prev_effects", p.suppressedVisualEffects)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        editor.putInt("prev_conversations", p.priorityConversationSenders)
      }
    }

    var categories = Policy.PRIORITY_CATEGORY_CALLS
    if (repeatCallers) categories = categories or Policy.PRIORITY_CATEGORY_REPEAT_CALLERS
    if (allowAlarms && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      categories = categories or Policy.PRIORITY_CATEGORY_ALARMS
    }
    val callSenders = when (callers) {
      "contacts" -> Policy.PRIORITY_SENDERS_CONTACTS
      "starred" -> Policy.PRIORITY_SENDERS_STARRED
      else -> Policy.PRIORITY_SENDERS_ANY
    }

    nm.notificationPolicy = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      // Blocked notifications stay in the shade and status bar, but never
      // pop up, light the LED or wake the screen.
      val effects = Policy.SUPPRESSED_EFFECT_PEEK or
        Policy.SUPPRESSED_EFFECT_LIGHTS or
        Policy.SUPPRESSED_EFFECT_FULL_SCREEN_INTENT or
        Policy.SUPPRESSED_EFFECT_AMBIENT
      Policy(categories, callSenders, Policy.PRIORITY_SENDERS_ANY, effects)
    } else {
      Policy(categories, callSenders, Policy.PRIORITY_SENDERS_ANY)
    }
    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)

    editor
      .putBoolean("active", true)
      .putLong("end_at", endAtMs)
      .putString("label", label)
      .apply()

    scheduleEnd(ctx, endAtMs)
    showOngoing(ctx, endAtMs, label)
  }

  /** Ends focus mode and restores the previous DND state. */
  fun stop(ctx: Context, completed: Boolean) {
    cancelEnd(ctx)
    nm(ctx).cancel(NOTIF_ONGOING)

    val prefs = prefs(ctx)
    if (!prefs.getBoolean("active", false)) return

    val nm = nm(ctx)
    if (nm.isNotificationPolicyAccessGranted) {
      val categories = prefs.getInt("prev_categories", 0)
      val calls = prefs.getInt("prev_calls", Policy.PRIORITY_SENDERS_ANY)
      val messages = prefs.getInt("prev_messages", Policy.PRIORITY_SENDERS_ANY)
      try {
        nm.notificationPolicy = when {
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> Policy(
            categories, calls, messages,
            prefs.getInt("prev_effects", 0),
            prefs.getInt("prev_conversations", Policy.CONVERSATION_SENDERS_IMPORTANT)
          )
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ->
            Policy(categories, calls, messages, prefs.getInt("prev_effects", 0))
          else -> Policy(categories, calls, messages)
        }
      } catch (e: Exception) {
        // Restoring the exact policy is best effort; turning DND off matters more.
      }
      var filter = prefs.getInt("prev_filter", NotificationManager.INTERRUPTION_FILTER_ALL)
      if (filter == NotificationManager.INTERRUPTION_FILTER_UNKNOWN) {
        filter = NotificationManager.INTERRUPTION_FILTER_ALL
      }
      nm.setInterruptionFilter(filter)
    }

    val label = prefs.getString("label", "") ?: ""
    prefs.edit().putBoolean("active", false).remove("end_at").apply()

    if (completed) showDone(ctx, label)
  }

  /** Called after a reboot or app update: finish or re-arm a running session. */
  fun resume(ctx: Context) {
    if (!isActive(ctx)) return
    val end = endAt(ctx)
    if (end <= System.currentTimeMillis()) {
      stop(ctx, completed = true)
    } else {
      scheduleEnd(ctx, end)
      showOngoing(ctx, end, label(ctx))
    }
  }

  // ---- alarm -----------------------------------------------------------------

  private fun endIntent(ctx: Context): PendingIntent {
    val intent = Intent(ctx, FocusEndReceiver::class.java).setAction(ACTION_END)
    return PendingIntent.getBroadcast(
      ctx, 0, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun scheduleEnd(ctx: Context, endAtMs: Long) {
    val am = ctx.getSystemService(AlarmManager::class.java)
    val pi = endIntent(ctx)
    try {
      if (canScheduleExactAlarms(ctx)) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAtMs, pi)
      } else {
        // Without the exact-alarm permission Android may delay this a few minutes.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAtMs, pi)
      }
    } catch (e: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAtMs, pi)
    }
  }

  private fun cancelEnd(ctx: Context) {
    ctx.getSystemService(AlarmManager::class.java).cancel(endIntent(ctx))
  }

  // ---- notifications ------------------------------------------------------------

  private fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = nm(ctx)
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL_ONGOING, "Focus timer", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shows the running focus countdown"
        setShowBadge(false)
      }
    )
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL_DONE, "Focus complete", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Tells you when a focus session is finished"
      }
    )
  }

  private fun builder(ctx: Context, channel: String): Notification.Builder =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(ctx, channel)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(ctx)
    }

  private fun openAppIntent(ctx: Context): PendingIntent? {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    return PendingIntent.getActivity(ctx, 1, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun showOngoing(ctx: Context, endAtMs: Long, label: String) {
    ensureChannels(ctx)
    val n = builder(ctx, CHANNEL_ONGOING)
      .setSmallIcon(R.drawable.focus_dnd_notification)
      .setContentTitle(if (label.isNotBlank()) "Focusing: $label" else "Focus mode on")
      .setContentText("Only calls can reach you. Notifications are silenced.")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(true)
      .setWhen(endAtMs)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setCategory(Notification.CATEGORY_PROGRESS)
      .setContentIntent(openAppIntent(ctx))
      .build()
    try {
      nm(ctx).notify(NOTIF_ONGOING, n)
    } catch (e: SecurityException) {
      // POST_NOTIFICATIONS not granted: focus still works, just no countdown notification.
    }
  }

  private fun showDone(ctx: Context, label: String) {
    ensureChannels(ctx)
    val n = builder(ctx, CHANNEL_DONE)
      .setSmallIcon(R.drawable.focus_dnd_notification)
      .setContentTitle("Focus session complete")
      .setContentText(if (label.isNotBlank()) "Nice work on $label. Take a short break." else "Nice work! Take a short break.")
      .setAutoCancel(true)
      .setContentIntent(openAppIntent(ctx))
      .build()
    try {
      nm(ctx).notify(NOTIF_DONE, n)
    } catch (e: SecurityException) {
    }
  }
}
