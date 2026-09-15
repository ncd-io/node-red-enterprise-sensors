const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 26;
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
				"default_value": "600",
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 65535,
					"generated": true
				},
				"html_id": "delay",
				"tags": [
					"generic"
				]
			},
			"sensor_1_fs": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set Pressure Sensor Full Scale Channel 1",
					"main_caption": "Set the Max Pressure Range for Channel 2."
				},
				"default_value": 20,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 5,
				},
				"options": {
					"0": "10 PSI",
					"1": "20 PSI",
					"2": "100 PSI",
					"3": "500 PSI",
					"4": "1000 PSI",
					"5": "5000 PSI"
				},
				"html_id": "pressure_sensor_fs_ch1_118"
			},
			"sensor_2_fs": {
				"read_index": 30,
				"write_index": 19,
				"descriptions": {
					"title": "Set Pressure Sensor Full Scale Channel 2",
					"main_caption": "Set the Max Pressure Range for Channel 2."
				},
				"default_value": 20,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 5,
				},
				"options": {
					"0": "10 PSI",
					"1": "20 PSI",
					"2": "100 PSI",
					"3": "500 PSI",
					"4": "1000 PSI",
					"5": "5000 PSI"
				},
				"html_id": "pressure_sensor_fs_ch2_118"
			},
			"auto_check_interval": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set Auto Check Interval",
					"main_caption": "Defines how frequently (in seconds) the sensor wakes up specifically to compare the live Pressure or Temperature against your configured Auto Check Percentage (Pressure or Temperature)."
				},
				"default_value": 0,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535,
				},
				"converter": {
					"units": " seconds"
				},
				"html_id": "auto_check_interval_118"
			},
			"press_auto_check_percent": {
				"read_index": 28,
				"write_index": 17,
				"descriptions": {
					"title": "Set Pressure Auto Check Percentage",
					"main_caption": "Sets the sensitivity for event-based reporting. The sensor will trigger an immediate push transmission if the difference between the live Pressure reading and the last transmitted reading meets or exceeds this percentage threshold."
				},
				"default_value": 10,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 65535,
				},
				"converter": {
					"units": " %"
				},
				"html_id": "press_auto_check_percent_118"
			},
			"temp_auto_check_percent": {
				"read_index": 29,
				"write_index": 18,
				"descriptions": {
					"title": "Set Temperature Auto Check Percentage",
					"main_caption": "Sets the sensitivity for event-based reporting. The sensor will trigger an immediate push transmission if the difference between the live Temperature reading and the last transmitted reading meets or exceeds this percentage threshold."
				},
				"default_value": 10,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 65535,
				},
				"converter": {
					"units": " %"
				},
				"html_id": "temp_auto_check_percent_118"
			},
			"always_on": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Set Always On",
					"main_caption": "This setting strictly controls whether the sensor is allowed to go to sleep."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "Disable",
					"1": "Enable"
				},
				"html_id": "always_on_26"
			},
			"sensor_1_pressure_limit": {
				"read_index": 32,
				"write_index": 21,
				"descriptions": {
					"title": "Set Pressure Limit",
					"main_caption": "Defines the absolute pressure threshold that will trigger an alert event when exceeded."
				},
				"default_value": 10000,
				"validator": {
					"type": "uint16be",
					"min": 5,
					"max": 65535,
				},
				"converter": {
					"units": " PSI"
				},
				"html_id": "pressure_limit_26"
			},
			"sensor_2_pressure_limit": {
				"read_index": 35,
				"write_index": 24,
				"descriptions": {
					"title": "Set Pressure Limit Channel 2",
					"main_caption": ""
				},
				"default_value": 10000,
				"validator": {
					"type": "uint16be",
					"min": 5,
					"max": 65535,
				},
				"converter": {
					"units": " PSI"
				},
				"html_id": "pressure_limit_2_118"
			},
			"pressure_check_mode": {
				"read_index": 34,
				"write_index": 23,
				"descriptions": {
					"title": "Set Pressure Check Mode",
					"main_caption": "Sets the operational logic the sensor uses to evaluate and trigger alerts."
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "Absolute",
					"1": "Normal"
				},
				"html_id": "pressure_check_mode_26"
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
			if(options && options[response.machine_values[key]]){
				human_value = options[response.machine_values[key]];
			}else{
				if(converter && converter.multiplier){
					human_value = human_value * converter.multiplier;
				}
				if(converter && converter.units){
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
		let psi_1;
		let psi_2;
		switch(frame[12]){
			case 0:
				psi_1 = "10 PSI"
				break;
			case 1:
				psi_1 = "20 PSI"
				break;
			case 2:
				psi_1 = "100 PSI"
				break;
			case 3:
				psi_1 = "500 PSI"
				break;
			case 4:
				psi_1 = "1000 PSI"
				break;
			case 5:
				psi_1 = "5000 PSI"
				break;
			case 6:
				psi_1 = "10000 PSI"
				break;
		}
		switch(frame[13]){
			case 0:
				psi_2 = "10 PSI"
				break;
			case 1:
				psi_2 = "20 PSI"
				break;
			case 2:
				psi_2 = "100 PSI"
				break;
			case 3:
				psi_2 = "500 PSI"
				break;
			case 4:
				psi_2 = "1000 PSI"
				break;
			case 5:
				psi_2 = "5000 PSI"
				break;
			case 6:
				psi_2 = "10000 PSI"
				break;
		}
		return {
			'firmware': frame[2],
			'sensor_1_fs': psi_1,
			'sensor_2_fs': psi_2,
			'auto_check_interval': frame.slice(14, 16).reduce(msbLsb) + " Sec.",
			'press_auto_check_percent': frame[17] + " %",
			'temp_auto_check_percent': frame[17] + " %",
			'hardware_id': frame.slice(18, 21),
			'sample_rate': frame.slice(21, 25).reduce(msbLsb) + " Sec.",
			'tx_life_counter': frame.slice(25, 29).reduce(msbLsb),
			'machine_values': {
				'firmware': frame[2],
				'sensor_1_fs': frame[12],
				'sensor_2_fs': frame[13],
				'auto_check_interval': frame.slice(14, 16),
				'press_auto_check_percent': frame[16],
				'temp_auto_check_percent': frame[17],
				'hardware_id': frame.slice(18, 21),
				'sample_rate': frame.slice(21, 25),
				'tx_life_counter': frame.slice(25, 29),
			}
		}
	};

	const parse = (payload, parsed, mac) => {
		let res = {};

		res.pressure_s1 = signInt(payload.slice(8, 12).reduce(msbLsb),32)/100;
		res.temperature_s1 = signInt(payload.slice(12, 14).reduce(msbLsb),16)/100;
		if((payload[7] & 2)){
			res.error_s1 = 'Error: Sensor Probe 1 communication error';
		}

		res.pressure_s2 = signInt(payload.slice(14, 18).reduce(msbLsb),32)/100;
		res.temperature_s2 = signInt(payload.slice(18, 20).reduce(msbLsb),16)/100;
		if((payload[7] & 4)){
			res.error_s2 = 'Error: Sensor Probe 2 communication error';
		}
		return res;
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 118,
		name: 'Dual Pressure and Temperature Sensor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};