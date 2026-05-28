// Leaflet control for wind and AIS alarm toggles with +/- steppers.
// Positioned at topright, independent of the anchor toolbar.

const PLUGIN_BASE = "/plugins/y2k-anchor-alarm";

function saveConfig(updates) {
  fetch(`${PLUGIN_BASE}/saveConfig`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  }).catch((err) => console.error("Save config failed:", err));
}

export const AlarmPanel = L.Control.extend({
  options: { position: "topright" },

  onAdd: function () {
    const container = L.DomUtil.create("div", "alarm-panel leaflet-bar");
    L.DomEvent.disableClickPropagation(container);
    container.id = "alarmPanel";
    container.innerHTML = `
      <div class="alarm-section">
        <label class="alarm-toggle">
          <input type="checkbox" id="alarmWindToggle" />
          <span>Wind Speed</span>
        </label>
        <div class="alarm-stepper" id="alarmWindStepper" style="display:none">
          <button class="stepper-btn" id="alarmWindDec">-</button>
          <button class="stepper-val" id="alarmWindVal">30</button>
          <button class="stepper-btn" id="alarmWindInc">+</button>
          <span class="stepper-unit">kts</span>
        </div>
      </div>

      <div class="alarm-section">
        <label class="alarm-toggle">
          <input type="checkbox" id="alarmWindShiftToggle" />
          <span>Wind Shift</span>
        </label>
        <div class="alarm-stepper" id="alarmWindShiftStepper" style="display:none">
          <button class="stepper-btn" id="alarmWindShiftDec">-</button>
          <button class="stepper-val" id="alarmWindShiftVal">90</button>
          <button class="stepper-btn" id="alarmWindShiftInc">+</button>
          <span class="stepper-unit">&deg;</span>
        </div>
      </div>

      <div class="alarm-section">
        <label class="alarm-toggle">
          <input type="checkbox" id="alarmAisToggle" />
          <span>AIS Proximity</span>
        </label>
        <div class="alarm-stepper" id="alarmAisStepper" style="display:none">
          <button class="stepper-btn" id="alarmAisDec">-</button>
          <button class="stepper-val" id="alarmAisVal">200</button>
          <button class="stepper-btn" id="alarmAisInc">+</button>
          <span class="stepper-unit">m</span>
        </div>
      </div>
    `;
    this._container = container;

    // Cache refs
    this._windToggle = container.querySelector("#alarmWindToggle");
    this._windStepper = container.querySelector("#alarmWindStepper");
    this._windVal = container.querySelector("#alarmWindVal");
    this._windShiftToggle = container.querySelector("#alarmWindShiftToggle");
    this._windShiftStepper = container.querySelector("#alarmWindShiftStepper");
    this._windShiftVal = container.querySelector("#alarmWindShiftVal");
    this._aisToggle = container.querySelector("#alarmAisToggle");
    this._aisStepper = container.querySelector("#alarmAisStepper");
    this._aisVal = container.querySelector("#alarmAisVal");

    // Wind Speed
    this._windToggle.addEventListener("change", () => {
      const on = this._windToggle.checked;
      this._windStepper.style.display = on ? "flex" : "none";
      // Send threshold AND toggle in one call to avoid race with +/- value
      saveConfig({
        windEnabled: on,
        windSpeedThreshold: parseFloat(this._windVal.textContent),
      });
    });
    this._windVal.addEventListener("click", () => {
      const input = prompt("Wind speed threshold (knots):", this._windVal.textContent);
      if (input === null) return;
      const v = parseFloat(input);
      if (v > 0 && v <= 200) {
        this._windVal.textContent = v;
        saveConfig({ windSpeedThreshold: v });
      }
    });
    container.querySelector("#alarmWindInc").addEventListener("click", () => {
      const v = Math.min(200, parseInt(this._windVal.textContent, 10) + 5);
      this._windVal.textContent = v;
      if (this._windToggle.checked)
        saveConfig({ windSpeedThreshold: v, windEnabled: true });
    });
    container.querySelector("#alarmWindDec").addEventListener("click", () => {
      const v = Math.max(5, parseInt(this._windVal.textContent, 10) - 5);
      this._windVal.textContent = v;
      if (this._windToggle.checked)
        saveConfig({ windSpeedThreshold: v, windEnabled: true });
    });

    // Wind Shift
    this._windShiftToggle.addEventListener("change", () => {
      const on = this._windShiftToggle.checked;
      this._windShiftStepper.style.display = on ? "flex" : "none";
      saveConfig({
        windDirChangeEnabled: on,
        windDirChangeDegrees: parseFloat(this._windShiftVal.textContent),
      });
    });
    this._windShiftVal.addEventListener("click", () => {
      const input = prompt("Wind shift threshold (degrees):", this._windShiftVal.textContent);
      if (input === null) return;
      const v = parseFloat(input);
      if (v > 0 && v <= 360) {
        this._windShiftVal.textContent = v;
        saveConfig({ windDirChangeDegrees: v });
      }
    });
    container.querySelector("#alarmWindShiftInc").addEventListener("click", () => {
      const v = Math.min(360, parseInt(this._windShiftVal.textContent, 10) + 10);
      this._windShiftVal.textContent = v;
      if (this._windShiftToggle.checked)
        saveConfig({ windDirChangeDegrees: v, windDirChangeEnabled: true });
    });
    container.querySelector("#alarmWindShiftDec").addEventListener("click", () => {
      const v = Math.max(10, parseInt(this._windShiftVal.textContent, 10) - 10);
      this._windShiftVal.textContent = v;
      if (this._windShiftToggle.checked)
        saveConfig({ windDirChangeDegrees: v, windDirChangeEnabled: true });
    });

    // AIS Proximity
    this._aisToggle.addEventListener("change", () => {
      const on = this._aisToggle.checked;
      this._aisStepper.style.display = on ? "flex" : "none";
      saveConfig({
        aisProximityEnabled: on,
        aisProximityRadius: parseFloat(this._aisVal.textContent),
      });
    });
    this._aisVal.addEventListener("click", () => {
      const input = prompt("AIS proximity radius (meters):", this._aisVal.textContent);
      if (input === null) return;
      const v = parseFloat(input);
      if (v > 0 && v <= 5000) {
        this._aisVal.textContent = v;
        saveConfig({ aisProximityRadius: v });
      }
    });
    container.querySelector("#alarmAisInc").addEventListener("click", () => {
      const v = Math.min(5000, parseInt(this._aisVal.textContent, 10) + 10);
      this._aisVal.textContent = v;
      if (this._aisToggle.checked)
        saveConfig({ aisProximityRadius: v, aisProximityEnabled: true });
    });
    container.querySelector("#alarmAisDec").addEventListener("click", () => {
      const v = Math.max(10, parseInt(this._aisVal.textContent, 10) - 10);
      this._aisVal.textContent = v;
      if (this._aisToggle.checked)
        saveConfig({ aisProximityRadius: v, aisProximityEnabled: true });
    });

    return container;
  },

  setConfig: function (cfg) {
    const windOn = cfg.windEnabled === true;
    this._windToggle.checked = windOn;
    this._windStepper.style.display = windOn ? "flex" : "none";
    this._windVal.textContent = cfg.windSpeedThreshold ?? 30;

    // Wind shift is controlled by windDirChangeEnabled in config
    const shiftOn = cfg.windDirChangeEnabled === true;
    this._windShiftToggle.checked = shiftOn;
    this._windShiftStepper.style.display = shiftOn ? "flex" : "none";
    this._windShiftVal.textContent = cfg.windDirChangeDegrees ?? 90;

    const aisOn = cfg.aisProximityEnabled === true;
    this._aisToggle.checked = aisOn;
    this._aisStepper.style.display = aisOn ? "flex" : "none";
    this._aisVal.textContent = cfg.aisProximityRadius ?? 200;
  },

  // Disable toggles when not anchored — alarms only make sense at anchor
  update: function (state) {
    const anchored = state.isAnchored && state.isAnchored();
    this._windToggle.disabled = !anchored;
    this._windShiftToggle.disabled = !anchored;
    this._aisToggle.disabled = !anchored;
  },
});
