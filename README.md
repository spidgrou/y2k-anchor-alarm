# Y2K's Anchor Alarm

> A fork of [Zach Hoeken's excellent anchor alarm plugin](https://github.com/hoeken/hoekens-anchor-alarm) — with extra wind and AIS proximity alarms.

A [Signal K](https://signalk.org/) plugin and webapp that monitors your anchored position and alerts you when something changes — your boat drifting, the wind shifting, or another vessel getting too close.

Originally built by **Scott Bender** ([sbender9/signalk-anchoralarm-plugin](https://github.com/sbender9/signalk-anchoralarm-plugin)) and then rewritten and extended by **Zach Hoeken** ([hoeken/hoekens-anchor-alarm](https://github.com/hoeken/hoekens-anchor-alarm)) with a modern web UI, engine override, scope calculator, historical tracks, and physically accurate boat icons.

This Y2K fork adds three new configurable alarms to the UI.

---

## Features

### Anchor Alarm (original)
- **Watch zones** — circle, sector, or polygon shape around the anchor
- **Anchor drag detection** — triggers when your GPS position exits the zone
- **Engine override** — auto-silences the alarm when engines are running
- **No-position watchdog** — alerts if GPS data stops
- **Scope calculator** — recommend chain length based on depth + tide + bow height
- **Historical tracks** — shows tracks of nearby vessels (requires @signalk/tracks-plugin)
- **AIS overlay** — view other vessels on the map
- **Physically accurate boat icon** — sized and rotated using LOA, beam, and GPS antenna position

### Wind Alarms ✨ (Y2K addition)
- **Wind Speed** — triggers when apparent wind exceeds a configurable threshold (knots)
- **Wind Shift** — triggers when wind direction shifts cumulatively beyond a configurable number of degrees from the direction recorded at anchor drop
- **Reset Wind Ref** — press to acknowledge a wind shift and record the new wind direction as the reference
- **Visual feedback** — the InfoPanel shows current wind direction, reference direction, and cumulative delta ∆

### AIS Proximity Alarm ✨ (Y2K addition)
- Triggers when another vessel enters a configurable radius (meters) around your GPS position
- Shows the nearest vessel name and distance in the InfoPanel
- Filters out your own vessel by MMSI and context

### UI Enhancements ✨ (Y2K addition)
- **Touch-friendly controls** — large +/- buttons for adjusting thresholds, no fiddly number inputs
- **Toggle from the map view** — enable/disable alarms directly from the webapp, no need to visit the admin config page
- **Alarm panel** — positioned top-right, shows all three alarm toggles with current values
- **Auto-reset on raise** — raising anchor disables all alarms and clears notifications
- **Disabled when not anchored** — alarm toggles are greyed out until anchor is dropped
- **Instant save** — threshold changes are saved server-side immediately on each +/- click

---

## Installation

### Via npm link (recommended for development)

```bash
cd ~/.signalk
npm install https://github.com/spidgrou/y2k-anchor-alarm
```

### Manual

```bash
git clone https://github.com/spidgrou/y2k-anchor-alarm.git
cd y2k-anchor-alarm
npm install
npm run build:ui
ln -s $(pwd) ~/.signalk/node_modules/y2k-anchor-alarm
cd ~/.signalk
npm install ./y2k-anchor-alarm
```

Then restart Signal K Server and enable the plugin from the admin UI.

---

## Configuration

### Via admin UI (Signal K → Plugin Config → Y2K's Anchor Alarm)

| Setting | Default | Description |
|---|---|---|
| Enable Wind Alarms | false | Master toggle for wind speed & direction monitoring |
| Enable Wind Shift Alarm | true | Separate toggle for direction shift alarm |
| Wind Speed Threshold | 30 kts | Triggers when wind exceeds this speed |
| Wind Direction Shift Threshold | 90° | Triggers when wind shifts this much from the anchor-drop reference |
| Wind Alarm Severity | alarm | Notification level (`alert`, `warn`, `alarm`, `emergency`) |
| Wind Alarm Interval | 60 s | Cooldown between repeat wind alarms |
| Enable AIS Proximity | false | Enables proximity detection |
| AIS Proximity Radius | 200 m | Trigger when a vessel enters this radius |
| AIS Proximity Severity | alarm | Notification level |
| AIS Proximity Interval | 60 s | Cooldown between repeat proximity alarms |

### Via webapp UI

From the anchor alarm web interface:

1. **Alarm panel** (top-right corner) — toggle each alarm on/off
2. **+ / - buttons** — adjust thresholds with large touch-friendly controls
3. **Reset Wind Ref** (InfoPanel, bottom-right) — acknowledges a wind shift and records current wind as new reference
4. **Values are saved instantly** — no need to toggle off/on after changing a threshold

---

## Notifications

The plugin writes Signal K notifications that you can route to dashboards, MQTT, or Telegram:

| Path | Example message |
|---|---|
| `notifications.navigation.anchor` | `Anchor Dragging (45m)` |
| `notifications.environment.wind.speed` | `Wind 35 kts exceeds 30 kts` |
| `notifications.environment.wind.directionChange` | `Wind shifted +45° (ref 180°)` |
| `notifications.environment.ais.proximity` | `CATALYST at 89m` |

---

## Requirements

- Node.js >= 20.19
- Signal K Server >= 2.26
- For historical tracks: `@signalk/tracks-plugin`
- For scope calculator: `signalk-tides`, `signalk-derived-data`

---

## Credits

- **Scott Bender** — original [signalk-anchoralarm-plugin](https://github.com/sbender9/signalk-anchoralarm-plugin)
- **Zach Hoeken** — complete rewrite with custom Leaflet UI, engine check, scope calculator, boat icons, tracks integration. Check out his work at [hoeken/hoekens-anchor-alarm](https://github.com/hoeken/hoekens-anchor-alarm).
- **Y2K Sailing** — wind alarms, AIS proximity alarm, touch-friendly controls, alarm panel

---

*Built for Y2K, a Beneteau Oceanis 50 sailing the South Pacific.*
*If this plugin helps you, [buy Zach a coffee](https://ko-fi.com/hoeken) — he did the heavy lifting.*
