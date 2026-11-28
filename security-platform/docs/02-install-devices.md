# 02 — Installing on phones and computers

SecureOps is used through the web browser at your company's address (for example `https://app.yourcompany.com`). On every kind of device it can also be **installed as an app**: it gets its own icon, opens full-screen without browser bars, and can show notifications. There is nothing to download from an app store, and updates arrive automatically.

> Everyone needs **their own login** (email + password). The owner or an administrator creates it under **Settings → Users & logins** ([11](11-roles-and-permissions.md)). Don't share logins: the activity log, time clock and chat all depend on knowing who did what.

---

## What the app asks permission for, and why

| Permission | Used for | Who needs it |
|---|---|---|
| **Notifications** | New chat messages, incoming in-app calls, tasks, time-off decisions, alerts | Everyone (strongly recommended) |
| **Location** | Recorded once with each **clock in / clock out** (not tracked in between) | Everyone who uses the time clock |
| **Camera** | Job photos (before/after), equipment serial labels, vehicle check damage, chat photos | Technicians (anyone taking photos) |
| **Microphone** | **In-app calls** to other team members | Anyone who makes or takes in-app calls |

You can always change these later in the phone's settings (see each section below).

---

## iPhone and iPad

**Requirements:** iOS / iPadOS **16.4 or newer** for notifications (Settings → General → About → *iOS Version*). Older versions work but can't receive notifications.

### Install

1. Open **Safari** (on iOS 16.4+ Chrome and Edge also work) and go to your company's address, e.g. `app.yourcompany.com`.
2. Sign in.
3. Tap the **Share** button (the square with an arrow pointing up; at the bottom of the screen on iPhone, top on iPad).
4. Scroll and tap **Add to Home Screen**.
5. Keep the name "SecureOps" (or rename it) and tap **Add**.
6. **Close Safari and open SecureOps from the new Home Screen icon.** From now on always use the icon. On iPhone, notifications only work in the installed app, not in a Safari tab.
7. Sign in again inside the app if asked (the installed app keeps its own login).

### Turn on notifications

1. In the app, open **Team chat**.
2. Tap **Turn on** in the "Get a notification on this device" box.
3. Tap **Allow** when iOS asks.

To check later: iPhone **Settings → Notifications → SecureOps**: *Allow Notifications* on, and choose banners/sounds. Focus modes (Do Not Disturb, Work…) can silence it; add SecureOps to the Focus's allowed apps if techs need calls and messages while on a Focus.

### Location (time clock)

The first time you clock in, iOS asks to share your location: tap **Allow** (or *Allow While Using App*).

If you tapped *Don't Allow* by mistake: iPhone **Settings → Privacy & Security → Location Services**. Make sure Location Services is on, then open **Safari Websites** and choose **Ask Next Time Or When I Share** or **While Using the App**. Open the app again and clock in.

### Camera and microphone

The first time you take a job photo or make an in-app call, iOS asks; tap **Allow**. If denied, iOS asks again the next time, or reset it under **Settings → Safari → Camera / Microphone** → *Ask* or *Allow*.

### Things to know on iPhone

- **Incoming in-app calls** ring when the app is open. When it's closed, you get a notification ("📞 Mike is calling"); tap it within about 35 seconds to answer. An iPhone won't ring like a normal phone call for in-app calls.
- If the app looks stuck, swipe it away in the app switcher and open it again.
- To remove it: press and hold the icon → **Remove App** → *Delete from Home Screen*. Nothing is stored only on the phone; everything is on the server.

---

## Android phones and tablets

**Requirements:** Android 8 or newer with **Google Chrome** (Samsung Internet and Edge also work).

### Install

1. Open **Chrome** and go to your company's address.
2. Sign in.
3. Tap **⋮** (top right) → **Install app** (on some phones: **Add to Home screen → Install**). Chrome may also show an "Install" banner at the bottom; tapping it does the same.
4. Confirm **Install**. The SecureOps icon appears on the home screen and in the app drawer.
5. Open it from the icon from now on.

### Turn on notifications

1. In the app, open **Team chat** → tap **Turn on** → **Allow**.
2. To check later: long-press the SecureOps icon → **App info** → **Notifications** → on. Battery-saver modes on some phones (Samsung, Xiaomi, OnePlus) can delay notifications; set SecureOps (or Chrome) to **Unrestricted** battery use: App info → Battery → *Unrestricted*.

### Location, camera, microphone

Android asks the first time each is needed; tap **Allow** / **While using the app**. To change later: long-press the icon → **App info → Permissions**. If the app was installed through Chrome, the setting may be under Chrome: **Chrome → ⋮ → Settings → Site settings → Location / Camera / Microphone** → your company's address → *Allow*.

### Things to know on Android

- Incoming in-app calls show as a notification when the app is closed; tap it to open the call screen and answer.
- To uninstall: long-press the icon → **Uninstall** (or drag to *Uninstall*).

---

## Windows computers

**Requirements:** Windows 10 or 11 with **Microsoft Edge** (built in) or **Google Chrome**.

### Install with Microsoft Edge

1. Open Edge and go to your company's address. Sign in.
2. In the address bar, click the **App available** icon (a small square with a plus) → **Install**.
   - Or: **⋯** menu → **Apps → Install this site as an app**.
3. Edge asks whether to **Pin to taskbar**, **Pin to Start**, **Create desktop shortcut** and **Auto-start on device login**. Pick what's useful: office staff usually want the taskbar and auto-start.
4. SecureOps opens in its own window. Use the new icon from now on.

### Install with Google Chrome

1. Open Chrome, go to the address, sign in.
2. Click the **install icon** at the right end of the address bar (a monitor with a down arrow) → **Install**.
   - Or: **⋮ → Cast, save and share → Install page as app…** (older Chrome: **⋮ → Install SecureOps…**).
3. Right-click the icon on the taskbar → **Pin to taskbar** if you want it there permanently.

### Notifications on Windows

In the app: **Team chat → Turn on → Allow**. Then check **Windows Settings → System → Notifications**: notifications on, and Edge / Chrome / SecureOps allowed. *Do not disturb* / *Focus* hides them.

### Microphone for in-app calls

The first call asks for the microphone: click **Allow**. Choose the right headset in **Windows Settings → System → Sound → Input**. If it was blocked: click the **lock / site info** icon (in the app window's title bar menu **⋯ → App info / Site permissions**) → Microphone → *Allow*.

### Uninstall

Edge: `edge://apps` → the app's **⋯ → Uninstall**. Chrome: `chrome://apps` → right-click → **Remove from Chrome**. Or Windows Settings → Apps → Installed apps → SecureOps → Uninstall.

---

## Mac computers

- **Chrome or Edge:** same as Windows (install icon in the address bar). The app appears in Launchpad / Applications; right-click its Dock icon → *Options → Keep in Dock*.
- **Safari (macOS Sonoma 14 or newer):** open the address → **File → Add to Dock…** → *Add*.
- Notifications: **System Settings → Notifications → SecureOps** (or the browser) → *Allow notifications*.
- Microphone: **System Settings → Privacy & Security → Microphone** → allow the browser / SecureOps.

---

## Signing in, out and on several devices

- You can be signed in on your phone and your computer at the same time.
- **Sign out** is at the top right of every screen.
- Forgot your password: ask an owner or administrator; they set a temporary one under **Settings → Users & logins → Edit**. Change it yourself under **My account** (click your name at the top right).
- **Lost or stolen phone / employee leaves:** an owner or administrator opens **Settings → Users & logins → Edit**, and either resets the password or unticks **Active**. Both immediately sign that person out on every device.

---

## Do we need App Store or Windows .exe versions?

**Not today.** The installed web app already covers:

- home-screen / Start-menu icons;
- full-screen windows;
- notifications (iPhone 16.4+, Android, Windows, Mac);
- camera, location and microphone;
- instant updates.

Reasons you might want store versions later:

| Situation | Why a store/native app would help |
|---|---|
| A customer's or company's IT department only allows apps from the App Store / Microsoft Store / managed app catalog | Store distribution and MDM (device management) deployment |
| iPhone techs need in-app calls to **ring like a phone call** with the app closed | Only a native iOS app can use Apple's CallKit |
| Tracking a tech's location **continuously in the background** | Web apps can't; today the app uses the vehicle GPS tracker instead |

Store apps cost developer accounts (Apple $99/year, Google $25 once), review time, and ongoing maintenance for each platform. A Windows `.exe` would need a code-signing certificate (often $200–500/year) to avoid security warnings. None of that is needed to run the business on SecureOps as it is.
