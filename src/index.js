/*
 * Copyright 2016 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { distance, point } from "@turf/turf";
import { Watchdog } from "./watchdog.js";
import { metas, buildSchema, applyDefaults, migrateConfig, readZoneConfig } from "./schema.js";
import { watchZoneFromConfig } from "../shared/watch-zones/index.js";
import { SignalKBus } from "./signalk-bus.js";
import { Utils } from "./utils.js";
import { register as registerHttpRoutes } from "./http-routes.js";
import { ValidationError, StateError } from "./errors.js";

export default function (app) {
  const plugin = {};

  // ============================================================
  // PLUGIN IDENTITY & STATE
  // ============================================================

  plugin.id = "y2k-anchor-alarm";
  plugin.name = "Y2K's Anchor Alarm";
  plugin.description = "Anchor alarm with wind speed, wind shift & AIS proximity alarms, scope calculator and engine override.";

  plugin.subscriberPeriod = 1000;

  plugin.onStop = [];
  plugin.alarm_state = undefined;
  plugin.configuration = undefined;
  plugin.lastAlarmSent = 0;
  plugin.positionWatchdogTimer = false;

  // Wind alarm state
  plugin.windSubscription = [];
  plugin.windReferenceDirection = null;
  plugin.windSpeedAlarmState = "normal";
  plugin.windDirAlarmState = "normal";
  plugin.lastWindSpeedAlarm = 0;
  plugin.lastWindDirAlarm = 0;

  // AIS proximity alarm state
  plugin.aisAlarmState = "normal";
  plugin.lastAISAlarm = 0;

  plugin.bus = new SignalKBus(app, plugin.id);

  // ============================================================
  // PLUGIN LIFECYCLE
  // ============================================================

  plugin.start = function (props) {
    app.setPluginStatus("Started");

    plugin.alarm_state = "normal";
    plugin.updateAnchorAlarm(plugin.alarm_state, "Started", ["visual"]);

    for (const [key, value] of Object.entries(metas))
      plugin.bus.queueMeta(key, value);

    plugin.configuration = props || {};
    // v2.1 -> v2.2 upgrade: legacy `radius` becomes a `zone` config.
    // Persist immediately so the next restart sees the migrated shape.
    const migrated = migrateConfig(plugin.configuration);
    plugin.configuration = applyDefaults(app, plugin.configuration);
    if (migrated) {
      app.debug("migrated legacy radius config to zone shape");
      plugin.savePluginOptions();
    }

    try {
      //save our anchor roller height to the tree so we can access it from the web side
      if (typeof plugin.configuration["bowAnchorRollerHeight"] != "undefined")
        plugin.bus.queueDelta("design.bowAnchorRollerHeight", parseFloat(plugin.configuration["bowAnchorRollerHeight"]));

      //save our total anchor chain length to the tree so we can access it from the web side
      if (typeof plugin.configuration["totalAnchorChainLength"] != "undefined")
        plugin.bus.queueDelta("design.totalAnchorChainLength", parseFloat(plugin.configuration["totalAnchorChainLength"]));

      //setup our watchdog timer
      const noPositionAlarmTime = plugin.configuration["noPositionAlarmTime"];
      if (typeof noPositionAlarmTime != "undefined") {
        if (noPositionAlarmTime > 0) {
          plugin.positionWatchdogTimer = new Watchdog(
            noPositionAlarmTime * 1000,
            () => {
              plugin.alarm_state = "warn";
              plugin.updateAnchorAlarm(
                plugin.alarm_state,
                `No position data received for ${noPositionAlarmTime} seconds.`,
              );
            },
          );
        }
      }

      //should we be watching?
      const zoneConfig = readZoneConfig(plugin.configuration);
      const anchorPosition = zoneConfig?.position;
      const zone = watchZoneFromConfig(zoneConfig);
      if (anchorPosition && zone) {
        plugin.updateAnchorState({
          anchorPosition: anchorPosition,
          zone: zone,
          isSet: true,
        });

        plugin.startWatchingPosition();
      }

      // Init wind alarms
      if (plugin.configuration.windEnabled || plugin.configuration.windDirChangeEnabled) {
        plugin.startWatchingWind();
      }

      // Seed surfaceToTransducer = 0 for derived-data transducerToKeel calculation
      plugin.bus.queueDelta("environment.depth.surfaceToTransducer", 0);

      // Init alarm notifications (idle state so UI shows "normal" immediately)
      plugin.updateWindAlarm("speed", "normal", "Wind alarm idle");
      plugin.updateWindAlarm("directionChange", "normal", "Wind direction alarm idle");
      plugin.updateAISAlarm("normal", "AIS proximity alarm idle");

      //OLD APIs - only here for backwards compatibility
      if (app.registerActionHandler) {
        app.registerActionHandler(
          "vessels.self",
          `navigation.anchor.position`,
          plugin.putPosition,
        );

        app.registerActionHandler(
          "vessels.self",
          `navigation.anchor.maxRadius`,
          plugin.putRadius,
        );
      }
    } catch (e) {
      plugin.started = false;
      app.error("error: " + e);
      console.error(e.stack);
      return e;
    }

    plugin.bus.sendUpdates();
  };

  plugin.stop = function () {
    if (plugin.alarm_state != "normal") {
      plugin.alarm_state = "normal";
      plugin.updateAnchorAlarm(plugin.alarm_state, "Stopped", ["visual"]);
    }

    plugin.updateAnchorState({
      isSet: false,
    });

    plugin.stopWatchingPosition();
    plugin.stopWatchingWind();

    app.setPluginStatus("Stopped");
  };

  // ============================================================
  // CONFIGURATION SCHEMA
  // ============================================================

  plugin.schema = function () {
    return buildSchema(app);
  };

  // ============================================================
  // ANCHOR STATE (SignalK delta emission)
  // ============================================================

  plugin.updateAnchorAlarm = function (state, message, method) {
    if (!message)
      message = state.charAt(0).toUpperCase() + state.slice(1);

    if (!method)
      method = ["visual", "sound"];

    plugin.bus.queueDelta("notifications.navigation.anchor", {
      state: state,
      method: method,
      message: message,
    });

    plugin.bus.sendUpdates();
  };

  plugin.updateWindAlarm = function (type, state, message) {
    if (!message)
      message = state.charAt(0).toUpperCase() + state.slice(1);

    plugin.bus.queueDelta(`notifications.environment.wind.${type}`, {
      state: state,
      method: ["visual", "sound"],
      message: message,
    });

    plugin.bus.sendUpdates();
  };

  plugin.updateAISAlarm = function (state, message) {
    if (!message)
      message = state.charAt(0).toUpperCase() + state.slice(1);

    plugin.bus.queueDelta("notifications.environment.ais.proximity", {
      state: state,
      method: ["visual", "sound"],
      message: message,
    });

    plugin.bus.sendUpdates();
  };

  plugin.updateAnchorState = function (params) {
    if (params.isSet) {
      plugin.bus.queueDelta("navigation.anchor.state", "on");

      if (params.anchorPosition) {
        const anchorPosition = {
          latitude: parseFloat(params.anchorPosition.latitude),
          longitude: parseFloat(params.anchorPosition.longitude),
        };

        plugin.bus.queueDelta("navigation.anchor.position", anchorPosition);
      }

      if (params.currentRadius != null) {
        plugin.bus.queueDelta(
          "navigation.anchor.currentRadius",
          parseFloat(params.currentRadius),
        );
      }

      if (params.zone) {
        plugin.bus.queueDelta("navigation.anchor.watchZone", params.zone.getConfig());

        // Keep maxRadius (and the legacy zones meta array) populated for
        // circle shapes so external consumers like Freeboard keep working.
        // Non-circle shapes clear maxRadius — the watchZone path is the
        // canonical source of truth.
        const circleRadius = params.zone.getCircleRadius();
        if (circleRadius != null) {
          plugin.bus.queueDelta("navigation.anchor.maxRadius", circleRadius);
          const zones = [
            {
              state: "normal",
              lower: 0,
              upper: circleRadius,
            },
            {
              state: plugin.configuration.state,
              lower: circleRadius,
            },
          ];
          plugin.bus.queueDelta("navigation.anchor.meta", { zones: zones });
        } else {
          plugin.bus.queueDelta("navigation.anchor.maxRadius", null);
        }
      }
    } else {
      plugin.bus.queueDelta("navigation.anchor.position", null);
      plugin.bus.queueDelta("navigation.anchor.state", "off");
      plugin.bus.queueDelta("navigation.anchor.currentRadius", null);
      plugin.bus.queueDelta("navigation.anchor.maxRadius", null);
      plugin.bus.queueDelta("navigation.anchor.watchZone", null);
    }

    plugin.bus.sendUpdates();
  };

  // ============================================================
  // POSITION MONITORING
  // ============================================================

  plugin.startWatchingPosition = function () {
    if (plugin.onStop.length > 0)
      return;

    plugin.alarm_state = "normal";
    plugin.updateAnchorAlarm(plugin.alarm_state, "Watching", ["visual"]);

    app.setPluginStatus("Watching");

    if (plugin.positionWatchdogTimer)
      plugin.positionWatchdogTimer.start();

    app.subscriptionmanager.subscribe(
      {
        context: "vessels.self",
        subscribe: [
          {
            path: "navigation.position",
            period: plugin.subscriberPeriod,
          },
        ],
      },
      plugin.onStop,
      (err) => {
        app.error(err);
        app.setProviderError(err);
      },
      plugin.handlePositionUpdate,
    );
  };

  plugin.handlePositionUpdate = function (delta) {
    let vesselPosition;

    if (delta.updates) {
      delta.updates.forEach((update) => {
        if (update.values) {
          update.values.forEach((vp) => {
            if (vp.path === "navigation.position") {
              vesselPosition = vp.value;
            }
          });
        }
      });
    }

    if (vesselPosition) {
      if (plugin.positionWatchdogTimer)
        plugin.positionWatchdogTimer.reset();
      plugin.checkPosition(vesselPosition);
    }
  };

  plugin.stopWatchingPosition = function () {
    plugin.alarm_state = "normal";
    plugin.updateAnchorAlarm(plugin.alarm_state, "Off", ["visual"]);

    if (plugin.positionWatchdogTimer)
      plugin.positionWatchdogTimer.stop();

    app.setPluginStatus("Off");

    plugin.onStop.forEach((f) => f());
    plugin.onStop = [];

    // Clear wind reference from SignalK tree
    plugin.bus.queueDelta("environment.wind.referenceDirection", null);
    plugin.bus.sendUpdates();
    plugin.windReferenceDirection = null;

    // Reset all alarm flags on raise anchor
    plugin.configuration.windEnabled = false;
    plugin.configuration.windDirChangeEnabled = false;
    plugin.configuration.aisProximityEnabled = false;
    plugin.savePluginOptions();

    // Reset alarm states and notifications
    plugin.windSpeedAlarmState = "normal";
    plugin.windDirAlarmState = "normal";
    plugin.aisAlarmState = "normal";
    plugin.lastWindSpeedAlarm = 0;
    plugin.lastWindDirAlarm = 0;
    plugin.lastAISAlarm = 0;
    plugin.updateWindAlarm("speed", "normal", "Wind alarm idle");
    plugin.updateWindAlarm("directionChange", "normal", "Wind direction idle");
    plugin.updateAISAlarm("normal", "AIS proximity idle");

    // Stop wind subscription if running
    plugin.stopWatchingWind();
  };

  // ============================================================
  // WIND MONITORING
  // ============================================================

  plugin.startWatchingWind = function () {
    if (plugin.windSubscription.length > 0)
      return;

    app.debug("starting wind monitoring");

    app.subscriptionmanager.subscribe(
      {
        context: "vessels.self",
        subscribe: [
          {
            path: "environment.wind.speedApparent",
            period: plugin.subscriberPeriod,
          },
          {
            path: "environment.wind.directionTrue",
            period: plugin.subscriberPeriod,
          },
        ],
      },
      plugin.windSubscription,
      (err) => {
        app.error(err);
        app.setProviderError(err);
      },
      plugin.handleWindUpdate,
    );

    // Also poll wind directly from the tree every second as fallback
    // (deltas can be unreliable depending on SignalK subscription policies)
    plugin._windTimer = setInterval(() => {
      plugin.checkWindSpeedFromTree();
      plugin.checkWindDirection();
    }, plugin.subscriberPeriod);
  };

  plugin.stopWatchingWind = function () {
    plugin.windSubscription.forEach((f) => f());
    plugin.windSubscription = [];

    if (plugin._windTimer) {
      clearInterval(plugin._windTimer);
      plugin._windTimer = null;
    }
  };

  plugin.handleWindUpdate = function (delta) {
    if (!plugin.configuration ||
        (!plugin.configuration.windEnabled && !plugin.configuration.windDirChangeEnabled))
      return;

    let speedKnots, directionRad;

    if (delta.updates) {
      delta.updates.forEach((update) => {
        if (update.values) {
          update.values.forEach((vp) => {
            if (vp.path === "environment.wind.speedApparent") {
              // SignalK stores wind in m/s, convert to knots
              speedKnots = vp.value * 1.94384;
            }
            if (vp.path === "environment.wind.directionTrue") {
              directionRad = vp.value;
            }
          });
        }
      });
    }

    if (typeof speedKnots === "number")
      plugin.checkWindSpeed(speedKnots);

    if (typeof directionRad === "number")
      plugin.checkWindDirection();
  };

  plugin.checkWindSpeed = function (speedKnots) {
    const configuration = plugin.configuration;
    const threshold = configuration.windSpeedThreshold;

    if (speedKnots >= threshold) {
      const interval = configuration.windAlarmInterval;
      if (plugin.lastWindSpeedAlarm + interval * 1000 < Date.now()) {
        // Engine override: if engines are on, silence
        if (configuration.enableEngineCheck && Utils.checkEngineState(app))
          return;

        plugin.windSpeedAlarmState = configuration.windAlarmSeverity;
        plugin.lastWindSpeedAlarm = Date.now();
        plugin.updateWindAlarm(
          "speed",
          plugin.windSpeedAlarmState,
          `Wind ${speedKnots.toFixed(0)} kts exceeds ${threshold} kts`,
        );
      }
    } else {
      // Revert to normal when under threshold
      if (plugin.windSpeedAlarmState !== "normal") {
        plugin.windSpeedAlarmState = "normal";
        plugin.updateWindAlarm("speed", "normal", "Wind speed normal");
      }
    }
  };

  // Poll wind speed directly from SignalK tree (fallback timer)
  plugin.checkWindSpeedFromTree = function () {
    const speedMs = app.getSelfPath("environment.wind.speedApparent.value");
    if (typeof speedMs === "number") {
      plugin.checkWindSpeed(speedMs * 1.94384);
    }
  };

  plugin.checkWindDirection = function () {
    if (plugin.windReferenceDirection === null)
      return;
    if (!plugin.configuration.windDirChangeEnabled)
      return;

    // Read latest value directly from SignalK tree
    const directionRad = app.getSelfPath("environment.wind.directionTrue.value");
    if (typeof directionRad !== "number")
      return;

    const directionDeg = directionRad * (180 / Math.PI);
    const refDeg = plugin.windReferenceDirection * (180 / Math.PI);

    // Calculate shortest angular difference in [-180, 180]
    let diff = directionDeg - refDeg;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;

    const absDiff = Math.abs(diff);
    const threshold = plugin.configuration.windDirChangeDegrees;

    if (absDiff >= threshold) {
      const interval = plugin.configuration.windAlarmInterval;
      if (plugin.lastWindDirAlarm + interval * 1000 < Date.now()) {
        // Engine override
        if (plugin.configuration.enableEngineCheck && Utils.checkEngineState(app))
          return;

        plugin.windDirAlarmState = plugin.configuration.windAlarmSeverity;
        plugin.lastWindDirAlarm = Date.now();
        plugin.updateWindAlarm(
          "directionChange",
          plugin.windDirAlarmState,
          `Wind shifted ${diff >= 0 ? "+" : ""}${Math.round(diff)}\u00b0 (ref ${Math.round(refDeg)}\u00b0)`,
        );
      }
    } else {
      if (plugin.windDirAlarmState !== "normal") {
        plugin.windDirAlarmState = "normal";
        plugin.updateWindAlarm("directionChange", "normal", "Wind direction normal");
      }
    }
  };

  plugin.resetWindReference = function () {
    const dir = app.getSelfPath("environment.wind.directionTrue.value");
    if (typeof dir === "number") {
      plugin.windReferenceDirection = dir;
      plugin.windDirAlarmState = "normal";

      // Write reference to SignalK tree for UI display
      plugin.bus.queueDelta("environment.wind.referenceDirection", dir);

      plugin.updateWindAlarm("directionChange", "normal",
        `Reference reset to ${(dir * 180 / Math.PI).toFixed(0)}\u00b0`);
      app.debug("wind reference reset to: " + dir);
    }
  };

  // ============================================================
  // POSITION CHECKS
  // ============================================================

  plugin.checkPosition = function (vesselPosition) {
    const configuration = plugin.configuration;
    const zoneConfig = readZoneConfig(configuration);
    const anchorPosition = zoneConfig?.position;
    const zone = watchZoneFromConfig(zoneConfig);

    // currentRadius keeps its v2.1 semantics — straight-line distance from
    // anchor to GPS. Even with non-circle zones it's a useful display value
    // and downstream SignalK consumers (logging, telemetry) still rely on it.
    const currentRadius = distance(
      point([vesselPosition.longitude, vesselPosition.latitude]),
      point([anchorPosition.longitude, anchorPosition.latitude]),
      { units: "meters" },
    );

    //update our parameter that may change.
    plugin.updateAnchorState({
      currentRadius: currentRadius,
      isSet: true,
    });

    let new_state = "normal";
    let do_update = false;
    let message = "Watching";

    const outside = !zone.contains(vesselPosition, anchorPosition);
    if (outside) {
      //okay, we're dragging.
      new_state = configuration.state;
      message = `Anchor Dragging (${Math.round(currentRadius)}m)`;

      //how often should we send it?
      const interval = configuration["anchorAlarmInterval"];
      if (typeof interval !== "undefined")
        if (plugin.lastAlarmSent + interval * 1000 < Date.now())
          do_update = true;

      //wait, do we have engines on?
      if (configuration.enableEngineCheck) {
        if (Utils.checkEngineState(app)) {
          app.debug("anchor alarm disabled due to engines on");
          do_update = true;
          new_state = "normal";
          message = "Engines on, alarm disabled.";

          plugin.raiseAnchor();

          app.setPluginStatus(message);
        }
      }
    }

    if (new_state !== plugin.alarm_state || do_update) {
      plugin.alarm_state = new_state;
      app.debug("alarm state change: %s -> %s", plugin.alarm_state, message);
      plugin.updateAnchorAlarm(plugin.alarm_state, message);

      if (plugin.alarm_state == "normal")
        app.setPluginStatus("Watching");
      else {
        plugin.lastAlarmSent = Date.now();
        app.setPluginError("Dragging");
      }
    }

    // AIS proximity check
    if (plugin.configuration.aisProximityEnabled) {
      plugin.checkAISProximity(vesselPosition);
    }
  };

  // ============================================================
  // AIS PROXIMITY CHECK
  // ============================================================

  plugin.checkAISProximity = function (vesselPosition) {
    const radius = plugin.configuration.aisProximityRadius;
    const vessels = app.getPath("vessels");
    if (!vessels || typeof vessels !== "object")
      return;

    // Get own vessel's identity to skip self
    const ownContext = app.selfContext;
    // Extract own MMSI from context string like "urn:mrn:imo:mmsi:247067640"
    let ownMmsi = app.getSelfPath("navigation.mmsi.value");
    if (!ownMmsi && ownContext) {
      const parts = ownContext.split(":");
      ownMmsi = parts[parts.length - 1];
    }

    const ownLat = vesselPosition.latitude;
    const ownLng = vesselPosition.longitude;

    let nearestVessel = null;
    let nearestDist = Infinity;

    for (const [context, vessel] of Object.entries(vessels)) {
      if (!vessel || typeof vessel !== "object")
        continue;
      // Skip own vessel: context, MMSI (top-level in vessels tree), or name
      if (context === "self") continue;
      if (ownContext && context === ownContext) continue;
      // MMSI is a top-level string property on the vessel in the vessels tree
      const vesselMmsi = vessel.mmsi;
      if (ownMmsi && vesselMmsi === ownMmsi) continue;

      const pos = vessel?.navigation?.position?.value;
      if (!pos || typeof pos.latitude !== "number" || typeof pos.longitude !== "number")
        continue;

      const dist = distance(
        point([pos.longitude, pos.latitude]),
        point([ownLng, ownLat]),
        { units: "meters" },
      );

      if (dist < radius && dist < nearestDist) {
        nearestDist = dist;
        nearestVessel = vessel?.name || vessel?.mmsi || context;
      }
    }

    const interval = plugin.configuration.aisProximityInterval;

    if (nearestVessel !== null) {
      // Vessel within radius — trigger alarm with rate limiting
      if (plugin.lastAISAlarm + interval * 1000 < Date.now()) {
        if (plugin.configuration.enableEngineCheck && Utils.checkEngineState(app))
          return;

        plugin.aisAlarmState = plugin.configuration.aisProximitySeverity;
        plugin.lastAISAlarm = Date.now();
        plugin.updateAISAlarm(
          plugin.aisAlarmState,
          `${nearestVessel} at ${Math.round(nearestDist)}m`,
        );
      }
    } else {
      // No vessel within radius — revert to normal
      if (plugin.aisAlarmState !== "normal") {
        plugin.aisAlarmState = "normal";
        plugin.updateAISAlarm("normal", "AIS proximity normal");
      }
    }
  };

  // ============================================================
  // ANCHOR SERVICE
  // ============================================================

  // Build a WatchZone from a full zone config object. Throws ValidationError
  // when none of the inputs yield a usable zone.
  plugin.resolveZone = function (zone) {
    if (zone != null) {
      if (typeof zone !== "object")
        throw new ValidationError("zone must be an object");
      try {
        return watchZoneFromConfig(zone);
      } catch (err) {
        throw new ValidationError(err.message);
      }
    }

    const existing = readZoneConfig(plugin.configuration);
    if (existing) {
      return watchZoneFromConfig(existing);
    }

    throw new ValidationError("zone required");
  };

  plugin.dropAnchor = function ({ position, zone }) {
    if (
      !position ||
      position.latitude == null ||
      position.longitude == null
    ) {
      throw new ValidationError("position with latitude and longitude required");
    }

    const parsedPosition = {
      latitude: parseFloat(position.latitude),
      longitude: parseFloat(position.longitude),
    };
    if (isNaN(parsedPosition.latitude) || isNaN(parsedPosition.longitude)) {
      throw new ValidationError("position latitude and longitude must be numeric");
    }

    const resolvedZone = plugin.resolveZone(zone);

    app.debug(
      "drop anchor at: " +
      parsedPosition.latitude +
      " " +
      parsedPosition.longitude,
    );

    plugin.updateAnchorState({
      anchorPosition: parsedPosition,
      currentRadius: 0,
      zone: resolvedZone,
      isSet: true,
    });

    plugin.configuration.zone = JSON.stringify({
      ...resolvedZone.getConfig(),
      position: parsedPosition,
    });

    plugin.startWatchingPosition();

    // Always record wind reference when dropping anchor for display
    plugin.resetWindReference();

    plugin.savePluginOptions();
  };

  plugin.setZone = function (zone) {
    if (zone == null) {
      throw new ValidationError("zone required");
    }

    const existingZoneConfig = readZoneConfig(plugin.configuration);
    const anchorPosition = existingZoneConfig?.position;
    if (!anchorPosition) {
      throw new StateError("no anchor is currently dropped");
    }

    const vesselPosition = app.getSelfPath("navigation.position.value");
    if (!vesselPosition) {
      throw new StateError("no GPS position available");
    }

    const resolvedZone = plugin.resolveZone(zone);

    app.debug("set anchor zone: " + JSON.stringify(resolvedZone.getConfig()));

    plugin.updateAnchorState({
      zone: resolvedZone,
      isSet: true,
    });

    plugin.configuration.zone = JSON.stringify({
      ...resolvedZone.getConfig(),
      position: anchorPosition,
    });
    plugin.savePluginOptions();
  };

  // Legacy shim: treats `radius` as a circle zone and routes through setZone.
  plugin.setRadius = function (radius) {
    if (radius == null) {
      throw new ValidationError("radius required");
    }
    const parsed = parseFloat(radius);
    if (isNaN(parsed)) {
      throw new ValidationError("radius must be numeric");
    }
    plugin.setZone({ type: "circle", radius: parsed });
  };

  plugin.raiseAnchor = function () {
    app.debug("raise anchor");

    plugin.updateAnchorState({ isSet: false });

    delete plugin.configuration.zone;
    plugin.savePluginOptions();

    plugin.stopWatchingPosition();
  };

  // ============================================================
  // PUT / ACTION HANDLERS (legacy — HTTP routes are canonical)
  // ============================================================

  plugin.putPosition = function (context, path, value) {
    try {
      if (value == null) {
        plugin.raiseAnchor();
      } else {
        plugin.dropAnchor({ position: value, zone: { type: "circle", radius: value.radius } });
      }
      return { state: "SUCCESS" };
    } catch (err) {
      app.error(err);
      return { state: "FAILURE", message: err.message };
    }
  };

  plugin.putRadius = function (context, path, value) {
    try {
      plugin.setRadius(value);
      return { state: "SUCCESS" };
    } catch (err) {
      app.error(err);
      return { state: "FAILURE", message: err.message };
    }
  };

  // ============================================================
  // HTTP API ROUTES
  // ============================================================

  plugin.registerWithRouter = function (router) {
    registerHttpRoutes(app, plugin, router);
  };

  // ============================================================
  // PERSISTENCE
  // ============================================================

  plugin.savePluginOptions = function () {
    app.savePluginOptions(plugin.configuration, (err) => {
      if (err) {
        app.error(err);
      }
    });
  };

  return plugin;
}
