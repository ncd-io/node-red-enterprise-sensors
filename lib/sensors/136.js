const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 24;
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
					"main_caption": "Used to isolate wireless devices into specific groups. Devices with one Network ID won't be able to transmit or receive from devices on another Network ID."
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
					"main_caption": "Used to tell this sensor to only transmit to a single gateway/receiver. The value should be set to the Lower Address (last 8 characters) of the Gateway/Receiver's wireless module."
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
					"main_caption": "Optional parameter to set a numeric ID for a specific sensor or group of sensors for simple processing/identification. It is generally recommended to identify wireless devices by their unique address for scalable solutions."
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
					"title": "Sampling Interval",
					"main_caption": "How often the sensor wakes to capture and report temperature and humidity, in seconds."
				},
				"default_value": 3,
				"validator": {
					"type": "uint32be"
				},
				"html_id": "delay"
			},
			"full_scale_range": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set Full Scale Range",
					"main_caption": ""
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 3
				},
				"options": {
					"0": "+/- 2g",
					"1": "+/- 4g",
					"2": "+/- 8g"
				},
				"html_id": "full_scale_range_136"
			},
			"max_motion_tx_per_interval": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set Max Motion Transmissions Per Interval",
					"main_caption": "Set the number of times the sensor will send data due to motion triggers per Transmission Interval (Delay).",
					"note": "Default value: 1. Note: Setting this to a higher value will drain the battery."
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 255
				},
				"html_id": "max_num_motion_tx_delay_136"
			},
			"motion_threshold": {
				"read_index": 27,
				"write_index": 16,
				"descriptions": {
					"title": "Set Motion Threshold",
					"main_caption": "Set a motion detection threshold for the sensor to trigger a data transmission. This is an interrupt-based configuration, the transmitted message will have a report_type property of 'Motion'. A value of 0 will disable this feature.",
				},
				"default_value": 1000,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"converter": {
					"units": "ug"
				},
				"html_id": "motion_detect_threshold_136"
			},
			"deadband": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Set Dead Band Threshold",
					"main_caption": "Filters out acceleration values below the Dead Band Threshold, treating them as noise. This value determines the minimum acceleration value to be registered as a part of the measurement. Values below the threshold would be perceived as 0.",
					"note": "Example: A value of 10 would mean that vibrations below 10ug would be considered as 0."
				},
				"default_value": 0,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"converter": {
					"units": "ug"
				},
				"html_id": "deadband_136"
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
			// response.auto_raw_destination_address = "0000ffff";
		};
		return response;
	};

	const parse = (payload, parsed, mac) => {
		let report_type_text = 'Regular';
		let reserved = payload[7];
		if (reserved & 2){
			report_type_text = 'Invalid_data';
		}
		if (reserved & 4){
			report_type_text = 'Motion';
		}
		return {
			report_type: report_type_text,
			peak_gnd_acc_x_ug: payload.slice(8, 12).reduce(msbLsb),
			peak_gnd_acc_y_ug: payload.slice(12, 16).reduce(msbLsb),
			peak_gnd_acc_z_ug: payload.slice(16, 20).reduce(msbLsb),
			rms_gnd_acc_x_ug: payload.slice(20, 24).reduce(msbLsb),
			rms_gnd_acc_y_ug: payload.slice(24, 28).reduce(msbLsb),
			rms_gnd_acc_z_ug: payload.slice(28, 32).reduce(msbLsb),
			peak_gnd_vel_x_um_s: payload.slice(32, 36).reduce(msbLsb),
			peak_gnd_vel_y_um_s: payload.slice(36, 40).reduce(msbLsb),
			peak_gnd_vel_z_um_s: payload.slice(40, 44).reduce(msbLsb),
			rms_gnd_vel_x_um_s: payload.slice(44, 48).reduce(msbLsb),
			rms_gnd_vel_y_um_s: payload.slice(48, 52).reduce(msbLsb),
			rms_gnd_vel_z_um_s: payload.slice(52, 56).reduce(msbLsb),
			peak_gnd_disp_x_um: payload.slice(56, 60).reduce(msbLsb),
			peak_gnd_disp_y_um: payload.slice(60, 64).reduce(msbLsb),
			peak_gnd_disp_z_um: payload.slice(64, 68).reduce(msbLsb),
			rms_gnd_disp_x_um: payload.slice(68, 72).reduce(msbLsb),
			rms_gnd_disp_y_um: payload.slice(72, 76).reduce(msbLsb),
			rms_gnd_disp_z_um: payload.slice(76, 80).reduce(msbLsb),
			freq_1_hz: parseFloat((payload.slice(80, 82).reduce(msbLsb) / 1000).toFixed(2)),
			freq_2_hz: parseFloat((payload.slice(82, 84).reduce(msbLsb) / 1000).toFixed(2)),
			freq_3_hz: parseFloat((payload.slice(84, 86).reduce(msbLsb) / 1000).toFixed(2)),
			freq_4_hz: parseFloat((payload.slice(86, 88).reduce(msbLsb) / 1000).toFixed(2)),
			freq_5_hz: parseFloat((payload.slice(88, 90).reduce(msbLsb) / 1000).toFixed(2))
		};
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 136,
		name: 'Wireless Seismic Sensor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse
	};
};