// ControlToolbar owns the top control bar (raise/drop anchor buttons and the
// shape selector + per-shape controls). It builds its own DOM
// under the supplied parent and exposes callbacks. Per-tick state comes from
// AppState via update(appState).

import {
  createDefaultZoneConfig,
  createZoneControls,
  getZoneTypeOptions,
} from "./zones/index.js";

export class ControlToolbar {
  constructor({ parent, getMapContainer, onDrop, onRaise, onSetZone, config }) {
    this._getMapContainer = getMapContainer;
    this._onDrop = onDrop;
    this._onRaise = onRaise;
    this._onSetZone = onSetZone;
    this._config = config || {};

    this._isAnchored = false;
    this._zoneControls = null;
    this._zoneType = null;
    this._appState = null;

    this._container = document.createElement("div");
    this._container.id = "controlToolbar";
    this._container.innerHTML = `
      <div id="anchorDown">
        <button id="raiseAnchor">Raise Anchor</button>
      </div>
      <div id="anchorUp">
        <button id="dropAnchor">Drop Anchor</button>
      </div>
      <div id="zoneShapeSelect">
        <select id="zoneShape"></select>
      </div>
      <div id="zoneControlsHost"></div>
    `;
    parent.appendChild(this._container);

    this._anchorUp = this._container.querySelector("#anchorUp");
    this._anchorDown = this._container.querySelector("#anchorDown");
    this._shapeSelectWrap = this._container.querySelector("#zoneShapeSelect");
    this._shapeSelect = this._container.querySelector("#zoneShape");
    this._zoneControlsHost = this._container.querySelector("#zoneControlsHost");

    // Populate shape dropdown
    for (const option of getZoneTypeOptions()) {
      const opt = document.createElement("option");
      opt.value = option.type;
      opt.textContent = option.enabled ? option.label : `${option.label} (coming soon)`;
      opt.disabled = !option.enabled;
      this._shapeSelect.appendChild(opt);
    }

    // Event listeners
    this._container.querySelector("#raiseAnchor").addEventListener("click", () => {
      if (!this._isAnchored) return;
      if (!confirm("Do you really want to disable your anchor alarm?")) return;
      if (this._onRaise) this._onRaise();
    });
    this._container.querySelector("#dropAnchor").addEventListener("click", () => {
      if (this._onDrop) this._onDrop();
    });
    this._shapeSelect.addEventListener("change", (e) => {
      if (this._onSetZone)
        this._onSetZone(createDefaultZoneConfig(e.target.value, this._appState));
    });

    // Pinch zoom passthrough
    this._container.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const target = this._getMapContainer && this._getMapContainer();
        if (!target) return;
        target.dispatchEvent(
          new WheelEvent("wheel", {
            deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ,
            deltaMode: e.deltaMode, ctrlKey: e.ctrlKey,
            clientX: e.clientX, clientY: e.clientY,
            bubbles: false, cancelable: true,
          }),
        );
      },
      { passive: false },
    );
  }

  update(appState) {
    this._appState = appState;
    this._isAnchored = appState.isAnchored();

    this._anchorDown.style.display = this._isAnchored ? "block" : "none";
    this._anchorUp.style.display = this._isAnchored ? "none" : "block";
    this._shapeSelectWrap.style.display = this._isAnchored ? "none" : "block";

    const zone = appState.getWatchZone();
    const type = zone.getType();
    this._ensureZoneControls(type);
    if (this._shapeSelect.value !== type)
      this._shapeSelect.value = type;
    this._zoneControls?.update(appState);
  }

  _ensureZoneControls(type) {
    if (this._zoneControls && this._zoneType === type)
      return;
    if (this._zoneControls)
      this._zoneControls.destroy();
    this._zoneControls = createZoneControls(type, {
      parent: this._zoneControlsHost,
      onChange: (zoneConfig) => {
        if (this._onSetZone)
          this._onSetZone(zoneConfig);
      },
    });
    this._zoneType = type;
  }
}
