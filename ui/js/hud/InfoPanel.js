// Leaflet map overlay control. Owns its DOM, caches element refs during
// onAdd, and exposes update methods so the host can drive it without
// touching the document directly. Element IDs are preserved for CSS hooks
// in style.css; do not rename without updating the stylesheet.

import { DisplayUnit } from "../DisplayUnit.js";

function formatClockTime(value) {
  const d = new Date(value);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const TIDE_ARROW_UP = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"12\" fill=\"currentColor\" viewBox=\"0 0 16 16\"><path fill-rule=\"evenodd\" d=\"M8 15a.5.5 0 0 0 .5-.5V2.707l3.146 3.147a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 1 0 .708.708L7.5 2.707V14.5a.5.5 0 0 0 .5.5\"/></svg>`;
const TIDE_ARROW_DOWN = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"12\" fill=\"currentColor\" viewBox=\"0 0 16 16\"><path fill-rule=\"evenodd\" d=\"M8 1a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 13.293V1.5A.5.5 0 0 1 8 1\"/></svg>`;

function alarmClass(state) {
  if (!state || state === "normal") return "";
  if (state === "warn" || state === "alert") return "wind-warning";
  return "wind-alarm";
}

function degreesToCompass(deg) {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(deg / 22.5) % 16;
  return dirs[index];
}

export const InfoPanel = L.Control.extend({
  options: { position: "bottomright" },

  onAdd: function () {
    const container = L.DomUtil.create("div", "info leaflet-bar");
    L.DomEvent.disableClickPropagation(container);
    container.id = "infoUI";
    container.innerHTML = `
        <table>
          <tr id="currentTideRow">
            <th><a href="/signalk-tides">Current&nbsp;Tide:</a></th>
            <td><span title="Current Tide" id='currentTide'>~</span><span id='currentTideDirection'></span></td>
          </tr>
          <tr id="highTideRow">
            <th>High&nbsp;Tide:</th>
            <td><span title="High Tide" id='highTide'>~</span></td>
          </tr>
          <tr id="lowTideRow">
            <th>Low&nbsp;Tide:</th>
            <td><span title="Low Tide" id='lowTide'>~</span></td>
          </tr>
          <tr>
            <th>Depth:</th>
            <td><span title="Depth" id='depthValue'>~</span></td>
          </tr>
          <tr>
            <th>Status:</th>
            <td><span id='pluginStatus'>Loading</span></td>
          </tr>
        </table>

        <hr class="info-separator" />
        <div id="windAlarmSection" style="display:none">
          <div class="info-section-header">VENTO</div>
          <table>
            <tr id="windSpeedRow">
              <th>Speed:</th>
              <td><span id="windSpeedValue">~</span></td>
            </tr>
            <tr id="windDirectionRow">
              <th>Direction:</th>
              <td><span id="windDirValue">~</span></td>
            </tr>
            <tr id="windShiftRow">
              <th>Ref:</th>
              <td><span id="windShiftValue">~</span></td>
            </tr>
          </table>
          <button id="resetWindRefBtn" class="reset-wind-btn" title="Reset wind direction reference to current">&#x21BA; Reset Wind Ref</button>
        </div>

        <hr class="info-separator" />
        <div id="aisAlarmSection" style="display:none">
          <div class="info-section-header">AIS</div>
          <table>
            <tr id="aisNearestRow">
              <th>Nearest:</th>
              <td><span id="aisNearestValue">~</span></td>
            </tr>
          </table>
        </div>
    `;
    this._container = container;
    this._depthValue = container.querySelector("#depthValue");
    this._currentTide = container.querySelector("#currentTide");
    this._currentTideDirection = container.querySelector("#currentTideDirection");
    this._currentTideRow = container.querySelector("#currentTideRow");
    this._tideHighTime = container.querySelector("#highTide");
    this._tideHighTimeRow = container.querySelector("#highTideRow");
    this._tideLowTime = container.querySelector("#lowTide");
    this._tideLowTimeRow = container.querySelector("#lowTideRow");
    this._pluginStatus = container.querySelector("#pluginStatus");

    // Wind alarm refs
    this._windAlarmSection = container.querySelector("#windAlarmSection");
    this._windSpeedValue = container.querySelector("#windSpeedValue");
    this._windDirValue = container.querySelector("#windDirValue");
    this._windShiftValue = container.querySelector("#windShiftValue");
    this._windSpeedRow = container.querySelector("#windSpeedRow");
    this._windDirectionRow = container.querySelector("#windDirectionRow");
    this._windShiftRow = container.querySelector("#windShiftRow");
    this._resetWindRefBtn = container.querySelector("#resetWindRefBtn");

    // AIS alarm refs
    this._aisAlarmSection = container.querySelector("#aisAlarmSection");
    this._aisNearestValue = container.querySelector("#aisNearestValue");
    this._aisNearestRow = container.querySelector("#aisNearestRow");

    // Reset wind ref button handler
    L.DomEvent.on(this._resetWindRefBtn, "click", () => {
      fetch("/plugins/y2k-anchor-alarm/resetWindReference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch((err) => console.error("Reset wind ref failed:", err));
    });

    return container;
  },

  update: function (state) {

    // InfoPanel only makes sense while anchored. ScopePanel is its raised
    // counterpart — the two are mutually exclusive in the bottom-right slot.
    if (!state.isAnchored() && state.belowSurface) {
      this.hide();
      return;
    }
    this.show();

    if (state.tide) {
      this.setCurrentTide(state.tide.heightNow, this.computeTideRising(state.tide));
      this.arrangeTideTimes(state.tide.timeHigh, state.tide.timeLow);
      this.setHighTime(state.tide.timeHigh);
      this.setLowTime(state.tide.timeLow);
    } else {
      this._currentTideRow.style.display = "none";
      this._tideHighTimeRow.style.display = "none";
      this._tideLowTimeRow.style.display = "none";
    }

    if (state.belowSurface)
      this.setDepthValue(state.belowSurface);
    else if (state.belowKeel)
      this.setDepthValue(state.belowKeel);
    else if (state.belowTransducer)
      this.setDepthValue(state.belowTransducer);
    else
      this.setDepthValue(null);
    this.setStatus(state.anchor);

    // Wind alarm section
    this.updateWindAlarms(state);

    // AIS alarm section
    this.updateAISAlarms(state);
  },

  // ============================================================
  // WIND ALARMS
  // ============================================================

  updateWindAlarms: function (state) {
    const hasWind = state.aws || state.twa;
    const hasAlarms = state.windSpeedAlarm || state.windDirAlarm;

    if (!hasWind) {
      this._windAlarmSection.style.display = "none";
      return;
    }
    this._windAlarmSection.style.display = "";

    // Wind speed
    if (state.aws) {
      const speedKts = state.aws.value * 1.94384; // m/s to knots
      this._windSpeedValue.textContent = `${Math.round(speedKts)} kts`;
      const speedState = state.windSpeedAlarm?.value?.state || "normal";
      this._windSpeedRow.className = alarmClass(speedState);
    } else {
      this._windSpeedValue.textContent = "~";
      this._windSpeedRow.className = "";
    }

    // Wind direction
    if (state.twa) {
      const dirDeg = state.twa.value * (180 / Math.PI);
      const compass = degreesToCompass(dirDeg);
      this._windDirValue.textContent = `${Math.round(dirDeg)}° (${compass})`;
      this._windDirectionRow.className = "";
    } else {
      this._windDirValue.textContent = "~";
      this._windDirectionRow.className = "";
    }

    // Wind reference direction (always shown when set)
    if (state.windRefDir && state.windRefDir.value != null) {
      const refDeg = state.windRefDir.value * (180 / Math.PI);
      const refCompass = degreesToCompass(refDeg);
      const dirDeg = state.twa ? state.twa.value * (180 / Math.PI) : null;
      let shiftText = `${Math.round(refDeg)}° (${refCompass})`;
      if (dirDeg !== null) {
        let diff = dirDeg - refDeg;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        shiftText += `  Δ${diff > 0 ? "+" : ""}${Math.round(diff)}°`;
      }
      this._windShiftValue.textContent = shiftText;
      this._windShiftRow.style.display = "";

      // Apply alarm color based on direction shift alarm state
      const dirAlarm = state.windDirAlarm?.value;
      if (dirAlarm && dirAlarm.state !== "normal") {
        this._windShiftRow.className = alarmClass(dirAlarm.state);
      } else {
        this._windShiftRow.className = "";
      }
    } else {
      this._windShiftValue.textContent = "—";
      this._windShiftRow.style.display = "";
      this._windShiftRow.className = "";
    }

    // No separate shift alarm message row — reference + delta + color is enough
  },

  // ============================================================
  // AIS ALARMS
  // ============================================================

  updateAISAlarms: function (state) {
    if (!state.aisAlarm) {
      this._aisAlarmSection.style.display = "none";
      return;
    }
    this._aisAlarmSection.style.display = "";

    const alarm = state.aisAlarm.value;
    if (alarm) {
      this._aisNearestValue.textContent = alarm.message || "~";
      this._aisNearestRow.className = alarmClass(alarm.state);
    } else {
      this._aisNearestValue.textContent = "~";
      this._aisNearestRow.className = "";
    }
  },

  // ============================================================
  // TIDE / DEPTH / STATUS (existing)
  // ============================================================

  setCurrentTide: function (currentTide, rising) {
    if (currentTide) {
      this._currentTide.textContent = DisplayUnit.formatDelta(currentTide);
      if (rising === true)
        this._currentTideDirection.innerHTML = TIDE_ARROW_UP;
      else if (rising === false)
        this._currentTideDirection.innerHTML = TIDE_ARROW_DOWN;
      else
        this._currentTideDirection.innerHTML = "";
      this._currentTideRow.style.display = "";
    } else {
      this._currentTideRow.style.display = "none";
    }
  },

  computeTideRising: function (tide) {
    if (!tide.timeHigh || !tide.timeLow)
      return null;
    return new Date(tide.timeHigh.value) < new Date(tide.timeLow.value);
  },

  arrangeTideTimes: function (highTime, lowTime) {
    if (!highTime || !lowTime)
      return;
    const parent = this._tideHighTimeRow.parentNode;
    if (new Date(highTime.value) > new Date(lowTime.value))
      parent.insertBefore(this._tideLowTimeRow, this._tideHighTimeRow);
    else
      parent.insertBefore(this._tideHighTimeRow, this._tideLowTimeRow);
  },

  setHighTime: function (highTime) {
    if (highTime) {
      this._tideHighTime.textContent = formatClockTime(highTime.value);
      this._tideHighTimeRow.style.display = "";
    } else {
      this._tideHighTimeRow.style.display = "none";
    }
  },

  setLowTime: function (lowTime) {
    if (lowTime) {
      this._tideLowTime.textContent = formatClockTime(lowTime.value);
      this._tideLowTimeRow.style.display = "";
    } else {
      this._tideLowTimeRow.style.display = "none";
    }
  },

  setDepthValue: function (depth) {
    if (depth)
      this._depthValue.textContent = DisplayUnit.formatDelta(depth);
    else
      this._depthValue.textContent = "~";
  },

  setStatus: function (anchor) {
    this._pluginStatus.className = "";
    if (anchor.state && anchor.notification) {
      if (anchor.state.value === "off")
        this._pluginStatus.textContent = "Off";
      else if (anchor.state.value === "on") {
        const notice = anchor.notification;
        this._pluginStatus.classList.add(notice.value.state);
        if (notice.value.message === "Watching")
          this._pluginStatus.textContent = "Watching";
        else
          this._pluginStatus.textContent = notice.value.state.toUpperCase();
      }
    } else
      this._pluginStatus.textContent = "Unknown";
  },

  show: function () {
    if (this._container)
      this._container.style.display = "";
  },
  hide: function () {
    if (this._container)
      this._container.style.display = "none";
  },
});
