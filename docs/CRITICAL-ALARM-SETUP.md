# Critical Phone Alarm

When an API marked **Critical** goes down, this rings a loud alarm on your phone and repeats
every 30 seconds until you silence it or the service recovers.

On iPhone it plays through the silent switch and Do Not Disturb. On Android it rings at max
alarm volume even on silent.

---

# Set up the alarm on your phone

About 5 minutes.

## 1. Install the app

Install **Home Assistant** from the App Store or Play Store.

## 2. Sign in

Open the app. It asks for a server address — enter:

```
https://monitor-alarm.pabbly.com
```

Do not tap "Home Assistant Cloud". Ask your admin for the login details if you don't have them yet.

When it asks for a **Device name**, use **`firstname_lastname_pabbly`**, all lowercase —
for example `satish_thapa_pabbly`. Underscores only: no spaces, dots, hyphens or apostrophes.

## 3. Allow notifications

Say yes when it asks.

> **On iPhone there is a second prompt, for Critical Alerts. You must allow that one too.**
>
> Without it the alarm stays silent whenever your phone is on silent or Do Not Disturb —
> exactly when you need it most.
>
> Missed it? iOS Settings → Home Assistant → Notifications → turn on **Critical Alerts**.

**On Android you're done with notifications** — it uses your phone's own alarm tone.
Skip to step 5.

## 4. Add the alarm sound — iPhone only

Download the alarm sound to your phone:

**[biohazard-alarm.wav](https://drive.google.com/file/d/1rqSO-_q4Co2-KzR_oyYCMSS5gIi-0RL6/view?usp=sharing)**

Then in the Home Assistant app:

**Settings → Companion App → Notifications → Sounds → Import custom sound**

Pick the file and tap Done.

> **Then fully close the Home Assistant app and reopen it.** On iPhone, swipe up from the bottom
> and swipe the app away, then open it again.
>
> If the alarm still plays a short beep instead of the siren, restart the phone — Home Assistant's
> own docs say a full restart is sometimes needed before a newly imported sound will play.
>
> Either way the alarm still works; only the sound differs.

*Android doesn't need this — it already uses your phone's alarm tone, which is long and loud.*

## 5. Check it works

Tell your admin you're set up. They'll send a test alarm to your phone only, so nobody else is
disturbed. Confirm you heard it.

Then test it properly: **put your phone on silent, turn on Do Not Disturb, and ask for another
test.** It should still be loud. If it isn't, Critical Alerts wasn't allowed — go back to step 3.

## When an alarm goes off

Tap the notification. It opens a page with one button: **Silence my phone**.

That silences **your** phone only. Everyone else keeps ringing until they silence theirs.
Silencing does not mean "I'm handling this" — if you're not going to act on it, the others still
need to hear it.

The alarm also stops **by itself** when the service recovers. You don't have to do anything.

---

# Admin guide

## Adding someone

1. **Create their login** — Home Assistant → Settings → People → Add person, with login enabled.
2. **Send them** their login details and the sound file link. Point them at the setup steps above.
3. **Wait** until they confirm the app is installed and signed in. Their phone doesn't exist in
   Home Assistant until then.
4. **Find their device name** — open
   `https://monitor-alarm.pabbly.com/developer-tools/action` and search `notify`.
   It appears as `notify.mobile_app_satish_thapa_pabbly`. You need the part **after** `notify.`
5. **Add them in Status Monitor** — Admin Settings → Phone Alarm → **+ Add Device**.
   Enter that service name and a display name, then **Save & Test**. It rings their phone only.
6. **Route them to APIs** — edit an API, tick **Critical**, and select which phones it wakes.

## Choosing who gets woken

Each critical API names its own phones, so a Payments outage doesn't wake the Billing team.

**At least one phone is required.** You can't save an API as Critical without choosing who it
wakes — an alarm that rings everyone by default is how people end up muting the app.

> **There is no fallback.** If an API is routed only to people who have since been removed, it
> alarms **nobody** and logs an error. It will not fall back to waking everyone — waking the wrong
> team at 3am is its own incident. Removing a device warns you if this would happen.

## Removing someone

Admin Settings → Phone Alarm → **Remove** on their row. If that leaves a critical API with no
devices, you'll get a warning naming them. Fix those before you walk away.

## Worth knowing

- **Mark critical sparingly.** If everything is critical, people mute the app and you're worse off
  than with Google Chat alone.
- **Repeat interval and give-up time** are configurable in the Phone Alarm tab (10–300s, 1–120m).
- **Alarm state lives in the database**, so a `pm2 restart` mid-incident won't kill a live alarm.
- **A phone missing the sound file still gets the alarm**, just with the default iOS tone.
  Nobody loses the wake-up over a skipped import.
- **New phone means repeating the setup.** The device name changes, so update it in the Phone
  Alarm tab.

## Hosting the sound file

The current file lives here: **[biohazard-alarm.wav](https://drive.google.com/file/d/1rqSO-_q4Co2-KzR_oyYCMSS5gIi-0RL6/view?usp=sharing)**

If you ever replace it, use one link for everyone. It must be **32-bit float, 48 kHz WAV, under 30 seconds**. Other formats import
without any error but then silently fall back to the default tone.
