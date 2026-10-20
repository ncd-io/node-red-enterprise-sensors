# Changelog

Notable changes to `@ncd-io/node-red-enterprise-sensors`. Newest first.

## v2.2.0

### Added
- **Type 137 - Wireless Steam Trap Monitor.** Reports inlet and outlet RTD temperatures, ultrasound levels
  (RMS, average, peak, modulation, floor), discharge duty and cycles, the on-device trap state (raw and
  confirmed), shock / vibration, and the per-capture ultrasound profile. RTD settings and the steam trap
  thresholds are configured through SYNC (Wireless Device Node or API Configuration Node). The Wireless Device
  Node can also learn or clear the acoustic baseline. Gateway helpers are available for the app commands
  (`config_set_steam_trap_cfg_137`, `config_set_steam_trap_baseline_137` and the matching getters).
- **Type 105 (Automatic Luber with Ultrasound, pre-release):** Filter Mode setting (`filter_mode`, options 1, 2, 3)
  and `kurtosis` in ultrasound reports.

### Changed
- **Type 105 (pre-release): report and SYNC layout track the current development firmware.** `dispenser_status`
  now reports `powered_off`, `healthy`, `error_undefined` or `lube_empty`.
- **Input Debounce Time for types 33, 125 and 126 is now limited to 10 - 1000 ms** (default 10 ms) and has its
  own row in the Wireless Device Node editor. Before, these types shared the row used by types 35, 123, 132
  and 133, which allows up to 65000 ms. Those four types are unchanged.
- **Wireless Device Node editor: section headings.** Large configuration groups can now carry a highlighted
  heading; the first is "Steam Trap Thresholds" on type 137. No functional change.
- **Sensors go back to sleep after a check-in that needs no configuration changes.** Before this change, a
  sensor stayed awake after a regular SYNC check-in until its awake window ran out, even when there was
  nothing to write. Now the gateway sends the sensor's exit command 100 ms after the check-in. This applies when either:
  - the API Configuration Node controls the sensor, and its desired configs match what the sensor reported; or
  - a Wireless Device Node exists for the sensor and has no configs to write on this check-in. This does not
    depend on Auto Config or On The Fly being enabled.

  The exit command is **not** sent:
  - on manual check-ins (button press), so the sensor stays reachable;
  - for sensors queued for a firmware update;
  - when **Enable Fly Compatibility** is on in the Serial Device (gateway config) node;
  - for sensor types 101, 102, 103 and 202, which stay awake for the RTC broadcast;
  - for sensors with neither an API Configuration Node entry nor a Wireless Device Node.

  Each of these check-ins now also produces a `sync_end` message, which is expected.

  **If your flow sends its own commands to a sensor right after it checks in**, those commands may now arrive
  after the sensor has gone back to sleep and time out. To keep the old behaviour, enable **Enable Fly
  Compatibility** in the Serial Device node.

### Fixed
- Wireless Device Node: after a SYNC configuration write, the exit and reboot commands now go out on the same
  modem as the write (`config_gateway`). Before, they went out on the data modem, so they were sent through
  the wrong modem whenever "Serial Device for Config" pointed at a different modem.
