const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 16;
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
					"title": "Sampling Interval",
					"main_caption": "Set how often will the sensor transmit measurement data. Note: For this sensor, this value functions as the sampling interval rather than a traditional delay.",
					"sub_caption": "Default value: 20 milliseconds."
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
				"default_value": 3,
				"validator": {
					"type": "uint32be"
				},
				"html_id": "delay"
			},
			"sensor_interface": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set RTD Wire Type",
					"main_caption": "The wire type of RTD Sensor Probe to be connected."
				},
				"default_value": 0,
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
			"sensor_range": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set RTD Range",
					"main_caption": "Type of PT Sensor Probe to be connected."
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
		let firmware = frame[2];
		if(firmware > 5){
			const interface_types = ["rtd_2_wire", "rtd_3_wire", "rtd_4_wire"];
			const rtd_types = ["rtd_pt_100", "rtd_pt_1000"];
			return {
				'firmware': frame[2],
				'sensor_interface': interface_types[frame[12]],
				'sensor_type': rtd_types[frame[13]],
				'hardware_id': frame.slice(14, 17),
				'report_rate': frame.slice(17, 21).reduce(msbLsb) + " sec",
				'tx_life_counter': frame.slice(21, 25).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'sensor_interface': frame[12],
					'sensor_type': frame[13],
					'hardware_id': frame.slice(14, 17),
					'report_rate': frame.slice(17, 21),
					'tx_life_counter': frame.slice(21, 25)
				}
			}
		}
	};

	const parse = (payload, parsed, mac) => {
		if(parsed.firmware > 5){
			let reserved = payload[7] >> 1; // Fault status (1-bit left shifted)
			let fault_status = '';
			if (reserved === 0) {
				fault_status = 'data_valid';
			} else if (reserved === 15) {
				fault_status = 'data_invalid';
			} else {
				const faultTypeBits = reserved & 0b00111100;
				switch (faultTypeBits) {
					case 32: 
						fault_status = 'ref_in_vbias'; 
						break;
					case 16: 
						fault_status = 'ref_in_force_close'; 
						break;
					case 8: 
						fault_status = 'rtd_in_force_open'; 
						break;
					case 4: 
						fault_status = 'over_under_voltage'; 
						break;
				}
			}
			return {
				fault_status: fault_status,
				temperature: signInt(payload.slice(8, 12).reduce(msbLsb), 32) / 100
			};
		} else {
			return {
				temperature: signInt(payload.slice(8, 12).reduce(msbLsb), 32) / 100
			};
		}
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 39,
		name: 'RTD Temperature Sensor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};