const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 23;
	};

	const get_config_map = (firmware) => {
		console.log('Generating sync map for firmware version', firmware);
		
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
					"title": "Tx Lifetime Counter",
					"main_caption": "Total number of transmissions the node has made since it was manufactured."
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
				"default_value": 1800,
				"validator": {
					"type": "uint32be"
				},
				"converter": {
					"units": " seconds"
				},
				"html_id": "delay"
			},
			"base_line": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "",
					"main_caption": ""
				},
				"default_value": 60,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"converter": {
					"units": " dBuV"
				},
				"html_id": "baseline_105"
			},
			"max_consecutive_auto_lube": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "",
					"main_caption": ""
				},
				"default_value": 3,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "max_consecutive_auto_lube_105"
			},
			"lube_on_time": {
				"read_index": 27,
				"write_index": 16,
				"descriptions": {
					"title": "",
					"main_caption": ""
				},
				"default_value": 10,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 255
				},
				"converter": {
					"units": " seconds"
				},
				"html_id": "lube_on_time_105"
			},
			"baseline_kurtosis": {
				"read_index": 28,
				"write_index": 17,
				"descriptions": {
					"title": "",
					"main_caption": ""
				},
				"default_value": 3,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 255
				},
				"html_id": "baseline_kurtosis_105"
			},
			"kurtosis_margin": {
				"read_index": 29,
				"write_index": 18,
				"descriptions": {
					"title": "",
					"main_caption": ""
				},
				"default_value": 2,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 255
				},
				"html_id": "kurtosis_margin_105"
			},
			"delta": {
				"read_index": 30,
				"write_index": 19,
				"descriptions": {
					"title": "Set Delta",
					"main_caption": ""
				},
				"default_value": 3,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 255
				},
				"converter": {
					"units": " dBuV"
				},
				"html_id": "delta_105"
			},
			"lubrication_mode": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Set Lubrication Mode",
					"main_caption": ""
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 2
				},
				"options": {
					"0": "Manual",
					"1": "Auto",
					"2": "Time"
				},
				"html_id": "lubrication_mode_105"
			},
			"auto_lube_deadband": {
				"read_index": 32,
				"write_index": 21,
				"descriptions": {
					"title": "",
					"main_caption": ""
				},
				"default_value": 20,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"converter": {
					"units": " mg"
				},
				"html_id": "auto_lube_deadband_105"
			},
			"fly_timeout": {
				"read_index": 33,
				"write_index": 22,
				"descriptions": {
					"title": "Set FLY Timeout",
					"main_caption": ""
				},
				"default_value": 5,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 10
				},
				"converter": {
					"units": " seconds"
				},
				"html_id": "fly_timeout_105"
			}
		};
	};

	const sync_parse = (rep_buffer) => {
		let response = {
			'human_readable': {},
			'machine_values': {}
		};

		// Get the map based on the sensor type byte
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
				case 'uint16le':
					response.machine_values[key] = rep_buffer.readUInt16LE(idx);
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
					human_value = human_value * converter.multiplier;
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

	const parse_fly = (frame) => {
		let firmware = frame[2];
		if (firmware > 13) { // firmware 14 and above
			let frame_data = {};
			let auto_check_interval = frame.slice(20, 22).reduce(msbLsb);
			if (!auto_check_interval) {
				frame_data.auto_check_interval = 'Disabled';
			} else {
				frame_data.auto_check_interval = auto_check_interval + " sec";
			}
			frame_data.always_on = frame[24] ? "Enabled" : "Disabled";
			switch (frame[16]) {
				case 0:
					frame_data.fsr = "+-6.114 V";
					break;
				case 1:
					frame_data.fsr = "+-4.096 V";
					break;
				case 2:
					frame_data.fsr = "+-2.048 V";
					break;
				case 3:
					frame_data.fsr = "+-1.024 V";
					break;
				case 4:
					frame_data.fsr = "+-0.512 V";
					break;
				case 5:
					frame_data.fsr = "+-0.256 V";
					break;
			}
			return {
				'firmware': frame[2],
				'fsr': frame_data.fsr,
				'boot_up_time': frame[17] + " sec",
				'adc_pin_reading': frame.slice(18, 20).reduce(msbLsb),
				'auto_check_interval': frame_data.auto_check_interval,
				'auto_check_threshold': frame.slice(22, 24).reduce(msbLsb),
				'always_on': frame_data.always_on,
				'calibration_one': frame.slice(25, 29).reduce(msbLsb),
				'calibration_two': frame.slice(29, 33).reduce(msbLsb),
				'calibration_three': frame.slice(33, 37).reduce(msbLsb),
				'hardware_id': frame.slice(37, 40),
				'report_rate': frame.slice(40, 44).reduce(msbLsb) + " sec",
				'tx_life_counter': frame.slice(44, 48).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'fsr': frame[16],
					'boot_up_time': frame[17],
					'adc_pin_reading': frame.slice(18, 20),
					'auto_check_interval': frame.slice(20, 22),
					'auto_check_percentage': frame.slice(22, 24),
					'always_on': frame[24],
					'calibration_one': frame.slice(25, 29),
					'calibration_two': frame.slice(29, 33),
					'calibration_three': frame.slice(33, 37),
					'hardware_id': frame.slice(37, 40),
					'report_rate': frame.slice(40, 44),
					'tx_life_counter': frame.slice(44, 48)
				}
			}
		}
	};

	const parse = (payload, parsed, mac) => {

		const MSG_TYPE_REPORT = 0x01;
		const MSG_TYPE_LUBE_REPORT = 0x02;

		let out = {};
		let msg_type = payload[8];

		if (msg_type === MSG_TYPE_LUBE_REPORT) {
			let lubrication_mode_text = '';
			switch(payload[15]){
				case 0:
					lubrication_mode_text = 'manual';
					break;
				case 1:
					lubrication_mode_text = 'auto';
					break;
				case 2:
					lubrication_mode_text = 'time';
					break;
			}
			out = {
				msg_type: 'lube_status',
				lube_cycles_this_burst: payload[9],
				lube_total_cycles: payload.slice(10, 14).reduce(msbLsb),
				dispenser_status: payload[14] ? 'healthy' : 'unhealthy',
				lubrication_mode: lubrication_mode_text
			};
		} else if (msg_type === MSG_TYPE_REPORT) {
			out = {
				msg_type: 'sensor_data',
				lube_cycles: payload[9],
				rms_uV: payload.slice(10, 14).reduce(msbLsb),
				rms_ultrasound_dBuV: payload.slice(14, 16).reduce(msbLsb),
				peak_uV: payload.slice(16, 20).reduce(msbLsb),
				ultrasound_peak_dBuV: payload.slice(20, 22).reduce(msbLsb),
				peak_to_peak_uV: payload.slice(22, 26).reduce(msbLsb),
				ultrasound_peak_to_peak_dBuV: payload.slice(26, 28).reduce(msbLsb),
				crest_factor: payload.slice(28, 30).reduce(msbLsb) / 100,
				temperature: signInt(payload.slice(30, 31).reduce(msbLsb), 16) / 100,
				frequency_1_Hz: payload.slice(32, 34).reduce(msbLsb),
				frequency_2_Hz: payload.slice(34, 36).reduce(msbLsb),
				frequency_3_Hz: payload.slice(36, 38).reduce(msbLsb)
			}
		}
		return out;
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties
	// that need to be called from outside the scrip
	return {
		type: 105,
		name: '1 Channel Automatic Luber With Ultrasound Vibration Sensor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};