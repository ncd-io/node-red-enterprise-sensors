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
			"sensor_range": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set Pressure Sensor Range",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 27,
					"generated": true
				},
				"html_id": "pressure_sensor_range_AMS5812_21"
			},
			"sensor_ams_type": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set Pressure Sensor Type",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 3,
					"generated": true
				},
				"options": {
					"0": "AMS5812",
					"1": "AMS5915",
					"2": "AMS5935"
				},
				"html_id": "pressure_sensor_type_21"
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
			// response.auto_raw_destination_address = "0000ffff";
		};
		return response;
	};

	const parse_fly = (frame) => {
		let sensor_type = '';
		switch(frame[13]){
			case 0:
				sensor_type = 'AMS5812';
				break;
			case 1:
				sensor_type = 'AMS5915';
				break;
		}
		let sensor_range = '';
		if(frame[13]){ // if sensor type is 5915
			switch(frame[12]){
				case 0:
					sensor_range = '0005_D';
					break;
				case 1:
					sensor_range = '0010_D';
					break;
				case 2:
					sensor_range = '0002_D_B';
					break;
				case 3:
					sensor_range = '0005_D_B';
					break;
				case 4:
					sensor_range = '0010_D_B';
					break;
				case 5:
					sensor_range = '0020_D';
					break;
				case 6:
					sensor_range = '0035_D';
					break;
				case 7:
					sensor_range = '0050_D';
					break;
				case 8:
					sensor_range = '0100_D';
					break;
				case 9:
					sensor_range = '0020_D_B';
					break;
				case 10:
					sensor_range = '0035_D_B';
					break;
				case 11:
					sensor_range = '0050_D_B';
					break;
				case 12:
					sensor_range = '0100_D_B';
					break;
				case 13:
					sensor_range = '0200_D';
					break;
				case 14:
					sensor_range = '0350_D';
					break;
				case 15:
					sensor_range = '0500_D';
					break;
				case 16:
					sensor_range = '1000_D';
					break;
				case 17:
					sensor_range = '2000_D';
					break;
				case 18:
					sensor_range = '4000_D';
					break;
				case 19:
					sensor_range = '7000_D';
					break;
				case 20:
					sensor_range = '10000_D';
					break;
				case 21:
					sensor_range = '0200_D_B';
					break;
				case 22:
					sensor_range = '0350_D_B';
					break;
				case 23:
					sensor_range = '0500_D_B';
					break;
				case 24:
					sensor_range = '1000_D_B';
					break;
			}
		}
		else{ // sensor type is 5812
			switch(frame[12]){
				case 0:
					sensor_range = '0000_D';
					break;
				case 1:
					sensor_range = '0001_D';
					break;
				case 2:
					sensor_range = '0000_D_B';
					break;
				case 3:
					sensor_range = '0001_D_B';
					break;
				case 4:
					sensor_range = '0003_D';
					break;
				case 5:
					sensor_range = '0008_D';
					break;
				case 6:
					sensor_range = '0015_D';
					break;
				case 7:
					sensor_range = '0003_D_B';
					break;
				case 8:
					sensor_range = '0008_D_B';
					break;
				case 9:
					sensor_range = '0015_D_B';
					break;
				case 10:
					sensor_range = '0030_D';
					break;
				case 11:
					sensor_range = '0050_D';
					break;
				case 12:
					sensor_range = '0150_D';
					break;
				case 13:
					sensor_range = '0300_D';
					break;
				case 14:
					sensor_range = '0600_D';
					break;
				case 15:
					sensor_range = '1000_D';
					break;
				case 16:
					sensor_range = '0030_D_B';
					break;
				case 17:
					sensor_range = '0050_D_B';
					break;
				case 18:
					sensor_range = '0150_D_B';
					break;
				case 19:
					sensor_range = '0150_B';
					break;
				case 20:
					sensor_range = '0150_A';
					break;
				case 21:
					sensor_range = '0300_A';
					break;
			}
		}
		return {
			'firmware': frame[2],
			'sensor_range': sensor_range,
			'sensor_ams_type': sensor_type,
			'hardware_id': frame.slice(14, 17),
			'report_rate': frame.slice(17, 21).reduce(msbLsb) + ' sec',
			'tx_counter': frame.slice(21, 25).reduce(msbLsb),
			'machine_values': {
				'firmware': frame[2],
				'sensor_range': frame[12],
				'sensor_ams_type': frame[13],
				'hardware_id': frame.slice(14, 17),
				'report_rate': frame.slice(17, 21),
				'tx_counter': frame.slice(21, 25)
			}
		}
	};

	const parse = (payload, parsed, mac) => {
		let pressure, temperature, raw_adc;
		if (parsed.firmware > 13){
			pressure = signInt(payload.slice(8, 10).reduce(msbLsb), 16) / 100;
			temperature = signInt(payload.slice(10, 12).reduce(msbLsb), 16) / 100;
			raw_adc = payload.slice(12, 16).reduce(msbLsb); // raw_adc 4 bytes
			return {
					pressure,
					temperature,
					raw_adc
			};
		}
		if (parsed.firmware == 13) {
			pressure = signInt(payload.slice(8, 10).reduce(msbLsb), 16) / 1000;
			temperature = signInt(payload.slice(10, 12).reduce(msbLsb), 16) / 100;
			raw_adc = signInt(payload.slice(12, 14).reduce(msbLsb), 16);
			return {
					pressure,
					temperature,
					raw_adc
			};
		} else {
			pressure = signInt(payload.slice(8, 10).reduce(msbLsb), 16) / 100;
			temperature = signInt(payload.slice(10, 12).reduce(msbLsb), 16) / 100;
			// raw_adc not present in firmware ≤ 12
			return {
					pressure,
					temperature
			};
		}
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 21,
		name: 'Differential Bidirectional Pressure Sensor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};