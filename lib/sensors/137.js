const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const trap_states = ['Normal', 'Failed Open', 'Failed Closed', 'Leaking', 'Unknown'];

	// The SYNC write (0x6C) carries the RTD settings and the steam trap configuration (0x4C layout).
	// The learned baseline is read only here, it is set with app command 0x4E.
	const get_write_buffer_size = (firmware) => {
		return 34;
	};

	const get_config_map = (firmware) => {
		return {
			"core_version": {
				"read_index": 3,
				"descriptions": {
					"title": "Core Version",
					"main_caption": "The version of the core communication stack."
				},
				"validator": {
					"type": "uint8"
				},
				"tags": [
					"system"
				]
			},
			"firmware_version": {
				"read_index": 4,
				"descriptions": {
					"title": "Firmware Version",
					"main_caption": "The application-specific firmware version."
				},
				"validator": {
					"type": "uint8"
				},
				"tags": [
					"system"
				]
			},
			"sensor_type": {
				"read_index": 5,
				"descriptions": {
					"title": "Sensor Type",
					"main_caption": "The hardware identifier for the specific sensor model."
				},
				"validator": {
					"type": "uint16be"
				},
				"tags": [
					"system"
				]
			},
			"tx_lifetime_counter": {
				"read_index": 7,
				"descriptions": {
					"title": "Transmission Lifetime Counter",
					"main_caption": "Total number of transmissions since the device was manufactured."
				},
				"validator": {
					"type": "uint32be"
				},
				"tags": [
					"diagnostics"
				]
			},
			"hardware_id": {
				"read_index": 11,
				"length": 3,
				"descriptions": {
					"title": "Hardware ID",
					"main_caption": "A unique 3-byte hardware identifier."
				},
				"validator": {
					"type": "buffer"
				},
				"tags": [
					"system"
				]
			},
			"network_id": {
				"read_index": 14,
				"write_index": 3,
				"length": 2,
				"descriptions": {
					"title": "Network ID",
					"main_caption": ""
				},
				"default_value": "7fff",
				"validator": {
					"type": "hex",
					"length": 4
				},
				"html_id": "pan_id",
				"tags": [
					"communications"
				]
			},
			"destination_address": {
				"read_index": 16,
				"write_index": 5,
				"length": 4,
				"descriptions": {
					"title": "Destination Address",
					"main_caption": ""
				},
				"default_value": "0000ffff",
				"validator": {
					"type": "mac",
					"length": 8
				},
				"html_id": "destination",
				"tags": [
					"communications"
				]
			},
			"node_id": {
				"read_index": 20,
				"write_index": 9,
				"descriptions": {
					"title": "Node ID",
					"main_caption": ""
				},
				"default_value": "0",
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"html_id": "node_id",
				"tags": [
					"generic"
				]
			},
			"report_rate": {
				"read_index": 21,
				"write_index": 10,
				"descriptions": {
					"title": "Delay",
					"main_caption": ""
				},
				"default_value": 600,
				"validator": {
					"type": "uint32be"
				},
				"html_id": "delay"
			},
			"sensor_interface_ch1": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set RTD Wire Type - Inlet",
					"main_caption": "The wire type of the trap inlet RTD probe (RTD1)."
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 2,
					"generated": true
				},
				"options": {
					"0": "2 Wires",
					"1": "3 Wires",
					"2": "4 Wires"
				},
				"html_id": "rtd_type_39"
			},
			"sensor_range_ch1": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set RTD Range - Inlet",
					"main_caption": "Type of PT probe on the trap inlet (RTD1)."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "PT 100",
					"1": "PT 1000"
				},
				"html_id": "rtd_range_39"
			},
			"sensor_interface_ch2": {
				"read_index": 27,
				"write_index": 16,
				"descriptions": {
					"title": "Set RTD Wire Type - Outlet",
					"main_caption": "The wire type of the trap outlet RTD probe (RTD2)."
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 2,
					"generated": true
				},
				"options": {
					"0": "2 Wires",
					"1": "3 Wires",
					"2": "4 Wires"
				},
				"html_id": "rtd_wire_type_ch2_54"
			},
			"sensor_range_ch2": {
				"read_index": 28,
				"write_index": 17,
				"descriptions": {
					"title": "Set RTD Range - Outlet",
					"main_caption": "Type of PT probe on the trap outlet (RTD2)."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "PT 100",
					"1": "PT 1000"
				},
				"html_id": "rtd_range_ch2_54"
			},
			"hot_inlet_temp": {
				"read_index": 29,
				"write_index": 18,
				"descriptions": {
					"title": "Hot Inlet Temperature",
					"main_caption": "Inlet temperature below which the trap is reported Failed Closed (raw value is C x 10)."
				},
				"default_value": 900,
				"validator": {
					"type": "int16be",
					"min": -2000,
					"max": 5000
				},
				"converter": {
					"multiplier": 0.1,
					"units": " C"
				},
				"html_id": "hot_inlet_temp_137",
				"tags": [
					"steam_trap"
				]
			},
			"quiet_level": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Quiet Level",
					"main_caption": "Quiet reference used without a learned baseline (raw value is dBuV x 100)."
				},
				"default_value": 3500,
				"validator": {
					"type": "uint16be",
					"min": 1,
					"max": 65535
				},
				"converter": {
					"multiplier": 0.01,
					"units": " dBuV"
				},
				"html_id": "quiet_level_137",
				"tags": [
					"steam_trap"
				]
			},
			"loud_level": {
				"read_index": 33,
				"write_index": 22,
				"descriptions": {
					"title": "Loud Level",
					"main_caption": "Loud level used without a learned baseline (raw value is dBuV x 100)."
				},
				"default_value": 6000,
				"validator": {
					"type": "uint16be",
					"min": 1,
					"max": 65535
				},
				"converter": {
					"multiplier": 0.01,
					"units": " dBuV"
				},
				"html_id": "loud_level_137",
				"tags": [
					"steam_trap"
				]
			},
			"loud_delta": {
				"read_index": 35,
				"write_index": 24,
				"descriptions": {
					"title": "Loud Delta",
					"main_caption": "Level above the baseline RMS that counts as loud (raw value is dB x 100)."
				},
				"default_value": 1000,
				"validator": {
					"type": "uint16be",
					"min": 1,
					"max": 65535
				},
				"converter": {
					"multiplier": 0.01,
					"units": " dB"
				},
				"html_id": "loud_delta_137",
				"tags": [
					"steam_trap"
				]
			},
			"cycling_level": {
				"read_index": 37,
				"write_index": 26,
				"descriptions": {
					"title": "Cycling Level",
					"main_caption": "Level above the quiet reference that counts as a discharge (raw value is dB x 100)."
				},
				"default_value": 600,
				"validator": {
					"type": "uint16be",
					"min": 1,
					"max": 65535
				},
				"converter": {
					"multiplier": 0.01,
					"units": " dB"
				},
				"html_id": "cycling_level_137",
				"tags": [
					"steam_trap"
				]
			},
			"leak_level": {
				"read_index": 39,
				"write_index": 28,
				"descriptions": {
					"title": "Leak Level",
					"main_caption": "Floor above the quiet reference that counts as leaking (raw value is dB x 100)."
				},
				"default_value": 300,
				"validator": {
					"type": "uint16be",
					"min": 1,
					"max": 65535
				},
				"converter": {
					"multiplier": 0.01,
					"units": " dB"
				},
				"html_id": "leak_level_137",
				"tags": [
					"steam_trap"
				]
			},
			"shock_threshold": {
				"read_index": 41,
				"write_index": 30,
				"descriptions": {
					"title": "Shock Threshold",
					"main_caption": "Dynamic acceleration that counts as a shock / water hammer, in mg."
				},
				"default_value": 2000,
				"validator": {
					"type": "uint16be",
					"min": 100,
					"max": 65535
				},
				"converter": {
					"units": " mg"
				},
				"html_id": "shock_threshold_137",
				"tags": [
					"steam_trap"
				]
			},
			"listen_window": {
				"read_index": 43,
				"write_index": 32,
				"descriptions": {
					"title": "Listen Window",
					"main_caption": "Ultrasound listen window per report, in seconds (one capture every 2 s)."
				},
				"default_value": 60,
				"validator": {
					"type": "uint8",
					"min": 10,
					"max": 120
				},
				"converter": {
					"units": " s"
				},
				"html_id": "listen_window_137",
				"tags": [
					"steam_trap"
				]
			},
			"confirm_count": {
				"read_index": 44,
				"write_index": 33,
				"descriptions": {
					"title": "Confirm Count",
					"main_caption": "Matching raw results in a row needed to change the confirmed trap state."
				},
				"default_value": 3,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 10
				},
				"html_id": "confirm_count_137",
				"tags": [
					"steam_trap"
				]
			},
			"baseline_valid": {
				"read_index": 45,
				"descriptions": {
					"title": "Baseline Learned",
					"main_caption": "Whether an acoustic baseline has been learned on this trap."
				},
				"validator": {
					"type": "uint8"
				},
				"options": {
					"0": "Not Learned",
					"1": "Learned"
				},
				"tags": [
					"steam_trap"
				]
			},
			"baseline_floor": {
				"read_index": 46,
				"descriptions": {
					"title": "Baseline Floor",
					"main_caption": "Learned quiet floor (raw value is dBuV x 100)."
				},
				"validator": {
					"type": "uint16be"
				},
				"converter": {
					"multiplier": 0.01,
					"units": " dBuV"
				},
				"tags": [
					"steam_trap"
				]
			},
			"baseline_rms": {
				"read_index": 48,
				"descriptions": {
					"title": "Baseline RMS",
					"main_caption": "Learned RMS level (raw value is dBuV x 100)."
				},
				"validator": {
					"type": "uint16be"
				},
				"converter": {
					"multiplier": 0.01,
					"units": " dBuV"
				},
				"tags": [
					"steam_trap"
				]
			}
		};
	};

	const sync_parse = (rep_buffer) => {
		let response = {
			'human_readable': {},
			'machine_values': {}
		};

		// Get the map based on the firmware version byte
		const sync_map = get_config_map(rep_buffer[4]);

		for (const [key, config] of Object.entries(sync_map)) {
			// Destructure 'type' from inside 'validator' and rename 'read_index' to 'idx'
			const { read_index: idx, length, validator: { type } = {}, converter, options } = config;

			// If for some reason a config doesn't have a validator/type, skip it
			if (!type) continue;

			switch (type) {
				case 'uint8':
					response.machine_values[key] = rep_buffer[idx];
					break;
				case 'uint16be':
					response.machine_values[key] = rep_buffer.readUInt16BE(idx);
					break;
				case 'int16be':
					response.machine_values[key] = rep_buffer.readInt16BE(idx);
					break;
				case 'uint32be':
					response.machine_values[key] = rep_buffer.readUInt32BE(idx);
					break;
				case 'buffer':
					response.machine_values[key] = rep_buffer.subarray(idx, idx + length);
					break;
				case 'hex':
					response.machine_values[key] = rep_buffer.subarray(idx, idx + length).toString('hex');
					break;
				case 'mac':
					response.machine_values[key] = rep_buffer.subarray(idx, idx + length).toString('hex');
					break;
			}
			let human_value = response.machine_values[key];
			if (options && options[response.machine_values[key]]) {
				human_value = options[response.machine_values[key]];
			} else {
				if (converter && converter.multiplier) {
					human_value = parseFloat((human_value * converter.multiplier).toFixed(2));
				}
				if (converter && converter.units) {
					human_value = human_value + converter.units;
				}
			}
			response.human_readable[key] = human_value;
		}
		if (Object.hasOwn(response.machine_values, 'destination_address') && response.machine_values.destination_address.toLowerCase() === '00000000') {
			console.log('##############################');
			console.log('#########Dest Override########');
			console.log('##############################');
			response.destination_address = "0000ffff";
		};
		return response;
	};

	// RTD fault status, same encoding as type 54 (1-bit left shifted). Reflects RTD2 only in firmware v1.
	const parse_fault_status = (status) => {
		let reserved = status >> 1;
		if (reserved === 0) {
			return 'data_valid';
		}
		if (reserved === 15) {
			return 'data_invalid';
		}
		let fault_status = '';
		switch ((reserved >> 2) & 0b00001111) {
			case 8:
				fault_status = 'ref_in_vbias';
				break;
			case 4:
				fault_status = 'ref_in_force_close';
				break;
			case 2:
				fault_status = 'rtd_in_force_open';
				break;
			case 1:
				fault_status = 'over_under_voltage';
				break;
		}
		switch (reserved & 0b00000011) {
			case 1:
				fault_status = fault_status + '_ch1';
				break;
			case 2:
				fault_status = fault_status + '_ch2';
				break;
		}
		return fault_status;
	};

	// payload is the report without the 0x7F header, so payload[i] is frame byte i + 1.
	const parse = (payload, parsed, mac) => {
		const capture_count = payload[36];
		return {
			fault_status: parse_fault_status(payload[7]),
			inlet_temperature_c: signInt(payload.slice(8, 12).reduce(msbLsb), 32) / 100,
			outlet_temperature_c: signInt(payload.slice(12, 16).reduce(msbLsb), 32) / 100,
			ultrasound_rms_dbuv: payload.slice(16, 18).reduce(msbLsb) / 100,
			ultrasound_average_dbuv: payload.slice(18, 20).reduce(msbLsb) / 100,
			ultrasound_peak_dbuv: payload.slice(20, 22).reduce(msbLsb) / 100,
			ultrasound_modulation_db: payload.slice(22, 24).reduce(msbLsb) / 100,
			ultrasound_floor_dbuv: payload.slice(24, 26).reduce(msbLsb) / 100,
			discharge_duty_percent: payload[26],
			discharge_cycles: payload[27],
			trap_state_raw: trap_states[payload[28]] ?? payload[28],
			trap_state_confirmed: trap_states[payload[29]] ?? payload[29],
			shock_count: payload.slice(30, 32).reduce(msbLsb),
			shock_peak_mg: payload.slice(32, 34).reduce(msbLsb),
			vibration_rms_mg: payload.slice(34, 36).reduce(msbLsb),
			capture_count: capture_count,
			capture_interval_sec: 2,
			capture_profile_dbuv: Array.from(payload.slice(37, 37 + capture_count), (v) => v / 2),
			machine_values: {
				fault_status: payload[7],
				trap_state_raw: payload[28],
				trap_state_confirmed: payload[29]
			}
		};
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties
	// that need to be called from outside the scrip
	return {
		type: 137,
		name: 'Wireless Steam Trap Monitor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse
	};
};
