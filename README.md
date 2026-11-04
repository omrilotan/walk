<p align="center">
	<img src="public/icon.svg" alt="" width="88" height="88" />
</p>

<h1 align="center">Walk</h1>

<p align="center">
	<b>Your Superun or DeerRun walking pad, without the PitPat app.</b><br />
	Control the pad from your browser and see every walk you've taken.
</p>

<p align="center">
	<a href="https://walk.omrilotan.com/app/"><b>Open Walk →</b></a>
	&nbsp;·&nbsp; <a href="https://walk.omrilotan.com/">About</a>
	&nbsp;·&nbsp; <a href="https://walk.omrilotan.com/privacy/">Privacy</a>
	&nbsp;·&nbsp; <a href="https://walk.omrilotan.com/terms/">Terms</a>
	&nbsp;·&nbsp; <a href="CHANGELOG.md">Changelog</a>
</p>

![A walking pad under a standing desk, with Walk open on the monitor mid-walk](public/images/home-office.jpg)

## Why Walk

<table>
	<tr>
		<td width="33%" valign="top">📲 <b>No app to install</b><br />Runs in Chrome, Edge or Opera.</td>
		<td width="33%" valign="top">✈️ <b>Works offline</b><br />Install it from your browser, on a computer or phone.</td>
		<td width="33%" valign="top">🔒 <b>Private first</b><br />No account needed. Your walks stay on your device.</td>
	</tr>
	<tr>
		<td valign="top">☁️ <b>Optional cloud sync</b><br />Your walks in every browser you use.</td>
		<td valign="top">🤖 <b>Connect your AI agent</b><br />Claude, ChatGPT and others follow your walks.</td>
		<td valign="top">💚 <b>Free and open source</b><br />No ads, no subscription.</td>
	</tr>
</table>

<p align="center">
	<img src="public/images/phone-light.png" alt="Walk on a phone in light mode, mid-walk at 4.5 km/h with Start, Pause, Stop, speed controls and presets" width="280" />
	&nbsp;
	<img src="public/images/phone-dark.png" alt="Walk on a phone in dark mode, showing the same walk" width="280" />
</p>

**Controls first:** big Start, Pause and Stop buttons, an exact speed, one-tap presets and keyboard shortcuts. **Every step counted:** distance, time, steps and calories, kept through pauses and dropouts. **Your progress:** a daily goal, your week, weekly trends, an activity calendar and records.

## Get started

| | |
| --- | --- |
| **1. Turn on the pad** | Close the PitPat phone app: the pad connects to one device at a time. |
| **2. Open Walk** | [walk.omrilotan.com/app](https://walk.omrilotan.com/app/) in Chrome, Edge or Opera, and press **Connect**. |
| **3. Pick your pad** | From the list your browser shows. |
| **4. Walk** | Press **Start** or tap a preset. The belt ramps up to your speed. |

| Works with | Not supported |
| --- | --- |
| Superun, DeerRun and other pads that use the PitPat app | Pads that use another app, like KingSmith WalkingPad |
| Chrome, Edge or Opera on Windows, macOS, Linux, ChromeOS or Android | iPhone and iPad, Safari, Firefox: they don't let websites use Bluetooth |

<kbd>Space</kbd> start or pause &nbsp;·&nbsp; <kbd>↑</kbd> <kbd>↓</kbd> speed &nbsp;·&nbsp; <kbd>Esc</kbd> stop

## Your data

|                       | 🔒 On your device (default)                | ☁️ With cloud sync (optional)                       |
| --------------------- | ------------------------------------------ | --------------------------------------------------- |
| **Account**           | None                                       | Your email. We send a code; no password             |
| **Walks**             | In your browser                            | Totals also in the EU, on Cloudflare                |
| **Per-second data**   | In your browser                            | Stays in your browser                               |
| **Across browsers**   | Export backup, then Import                 | Automatic                                           |
| **AI agents**         | In the same browser (WebMCP)               | From anywhere (remote MCP)                          |
| **Delete everything** | Reset my data                              | Delete account (or download it all first)           |

No analytics, no tracking, no ads, no request logs, and no third-party requests: even the fonts and icons are served by Walk. Sign in from the menu, under **Sync and assistants**; it happens on the same page, so the pad stays connected. Details in the [privacy notice](https://walk.omrilotan.com/privacy/).

## Connect your AI agent

> [!TIP]
> **Recommended:** turn on cloud sync and connect your assistant through remote MCP. It follows your walks from anywhere, with no Walk tab open.

### A week with your assistant

> **Monday, on the train.** *"How did my walks go last week?"*<br />
> 🤖 *26 km over five days, up 12% on the week before. Thursday was your best, 6.1 km.*
>
> **Monday, after a lunchtime walk.** *"Did I hit my goal?"*<br />
> 🤖 *4.2 km so far. 800 m to go.*
>
> **Wednesday evening.** *"Am I on track?"*<br />
> 🤖 *Yes. Three days at goal, and your streak is at 9 days.*
>
> **Friday.** *"How was my week?"*<br />
> 🤖 *You hit your goal every day. Raise it to 6 km?* You say yes, and every browser with Walk picks up the new goal.

### Set it up

1. **Turn on cloud sync:** in Walk, open the menu and sign in under **Sync and assistants**.
2. **Copy the address:** `https://walk.omrilotan.com/mcp`
3. **Add it to your assistant:**

   | Assistant | Where |
   | --- | --- |
   | **Claude** | Settings, Connectors, Add custom connector |
   | **ChatGPT** | Settings, Apps & Connectors, Advanced settings, Developer mode, Create |
   | **Claude Code** | `claude mcp add --transport http walk https://walk.omrilotan.com/mcp` |
   | **Others** | Any assistant that supports remote MCP servers with sign-in |

4. **Sign in, press Allow,** and ask: *"How did my walks go this week?"*

| Tool | What it does | Changes anything? |
| --- | --- | --- |
| `get_summary` | Today, your goal, this week against last, streak, records, last walk | No |
| `get_daily_totals` | Day by day, with whether you met your goal | No |
| `get_walks` | Individual walks, optionally between two dates | No |
| `set_goal` | Sets your daily goal | Yes, only if you allowed it |

The read-only tools can be set to "Always allow" in your assistant. A walk appears once it syncs, usually when it ends. See and disconnect assistants under **Sync and assistants**.

### Optional: without an account (WebMCP)

> [!NOTE]
> Rather not sync? An assistant in the same Chrome window can work with Walk through [WebMCP](https://developer.chrome.com/docs/ai/webmcp/imperative-api). Nothing leaves your device. It works only while Walk is open, in Chrome only, for now. In return, it can run the pad with you.

| It can | How |
| --- | --- |
| Read your status, progress, week and records | Anytime |
| Pause or stop the belt | Right away |
| Change speed | At most 1 km/h per step |
| Start or resume the belt | Walk asks first: **Allow**, **Always allow** or **Deny** |
| Change your daily goal | When you ask |

You always press Connect yourself; an assistant can't pair the pad.

![A six-panel stick-figure comic of a walk with an AI agent. 10:40: "Walk me while I clear email. Easy pace." The laptop asks "Start at 3.0 km/h?" Walk asks first: the screen reads "An agent wants to start the belt at 3.0 km/h" and the walker taps Allow. 11:00: the phone rings, "Pause for the call." "Paused." 12:32: the laptop asks "400 m to your goal. Eight more minutes?" and the walker answers "Keep going." 12:40: arms up, "Stop." "Stopped. 5.0 km, saved." Friday, coffee in hand: the laptop asks "Your goal was hit every day this week. Raise it to 6?" and the walker answers "Nope."](public/images/agent-comic.jpg)

<details>
<summary>Read the comic as text</summary>

It's 10:40. The pad is under the standing desk and Walk is open and connected. You type to the browser's assistant: *"Walk me while I clear email. Easy pace."* It suggests 3 km/h, and Walk asks: **"An agent wants to start the belt at 3.0 km/h."** You tap Allow.

At 11:00 a call comes in. *"Pause for the call."* The belt pauses at once. At 11:20: *"Back on."* You tap Allow again.

At 12:32 you're at 4.6 km: *"400 m to your goal. Eight more minutes?"* You keep going. At 12:40: *"Stop."* The walk is saved.

On Friday: *"Your goal was hit every day this week. Raise it to 6?"* You say no.

</details>

## Works offline

Install Walk from your browser: the install icon in the address bar on a computer, or **Add to Home screen** on Android. Installed, it opens and runs the pad without internet. If you sync, your walks catch up when you're back online.

## On a bigger screen

![Walk on a desktop browser: live walk, controls, today's goal, weekly charts, activity calendar, recent walks and records](public/images/desktop.png)

> [!WARNING]
> Walk controls moving equipment. Keep the pad's remote within reach, and step off before starting or changing speed while testing. Use at your own risk.

---

<sub>Built on the protocol work of [PitPat-WebBT](https://github.com/KeiranY/PitPat-WebBT), [pitpat-treadmill](https://github.com/Razzolate99/pitpat-treadmill) and [pacekeeper](https://github.com/peteh/pacekeeper). Walk is an independent project, not affiliated with or endorsed by PitPat, Superun or DeerRun; their names are used only to describe compatibility. Public domain, under [The Unlicense](LICENSE). Bundled fonts and icons keep their own licenses, in `public/vendor/`.</sub>
