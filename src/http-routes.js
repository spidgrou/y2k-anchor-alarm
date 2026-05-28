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

import { createRequire } from "module";
import { AnchorError } from "./errors.js";

const require = createRequire(import.meta.url);
const openapi = require("./openApi.json");

export function register(app, plugin, router) {
  plugin.getOpenApi = () => openapi;

  function fail(res, err) {
    if (err instanceof AnchorError) {
      app.debug(err.message);
      res.status(403).json({
        statusCode: 403,
        state: "FAILED",
        message: err.message,
      });
    } else {
      app.error(err);
      res.status(500).json({
        statusCode: 500,
        state: "FAILED",
        message: err.message || "internal error",
      });
    }
  }

  router.post("/dropAnchor", (req, res) => {
    try {
      plugin.dropAnchor({
        position: req.body.position,
        zone: req.body.zone,
      });
      res.json({ statusCode: 200, state: "COMPLETED" });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/setZone", (req, res) => {
    try {
      plugin.setZone(req.body.zone);
      res.json({ statusCode: 200, state: "COMPLETED" });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/raiseAnchor", (req, res) => {
    try {
      plugin.raiseAnchor();
      res.json({ statusCode: 200, state: "COMPLETED" });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/resetWindReference", (req, res) => {
    try {
      plugin.resetWindReference();
      res.json({ statusCode: 200, state: "COMPLETED" });
    } catch (err) {
      fail(res, err);
    }
  });

  router.post("/saveConfig", (req, res) => {
    try {
      const updates = req.body;
      if (!updates || typeof updates !== "object") {
        res.status(400).json({ statusCode: 400, state: "FAILED", message: "body must be an object" });
        return;
      }
      // Merge updates into current configuration
      Object.assign(plugin.configuration, updates);
      plugin.savePluginOptions();

      // Dynamically start/stop wind subscription based on toggle
      const wantsWind = updates.windEnabled === true || updates.windDirChangeEnabled === true;
      if (wantsWind && plugin.windSubscription.length === 0) {
        plugin.startWatchingWind();
      } else if (!wantsWind && plugin.windSubscription.length > 0) {
        plugin.stopWatchingWind();
        plugin.windSpeedAlarmState = "normal";
        plugin.windDirAlarmState = "normal";
        plugin.updateWindAlarm("speed", "normal", "Wind alarm idle");
        plugin.updateWindAlarm("directionChange", "normal", "Wind direction alarm idle");
      }

      res.json({ statusCode: 200, state: "COMPLETED" });
    } catch (err) {
      fail(res, err);
    }
  });

  router.get("/ui-config", (req, res) => {
    const config = plugin.configuration || {};
    res.json({
      fleetFilterRadius: config.fleetFilterRadius,
      connectionType: config.connectionType,
      defaultBasemap: config.defaultBasemap,
      windEnabled: config.windEnabled,
      windSpeedThreshold: config.windSpeedThreshold,
      windDirChangeEnabled: config.windDirChangeEnabled,
      windDirChangeDegrees: config.windDirChangeDegrees,
      windAlarmInterval: config.windAlarmInterval,
      windAlarmSeverity: config.windAlarmSeverity,
      aisProximityEnabled: config.aisProximityEnabled,
      aisProximityRadius: config.aisProximityRadius,
      aisProximityInterval: config.aisProximityInterval,
      aisProximitySeverity: config.aisProximitySeverity,
    });
  });
}
