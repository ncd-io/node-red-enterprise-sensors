const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 14;
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
			response.auto_raw_destination_address = "0000ffff";
		};
		return response;
	};

	const parse = (d) => {
		return {
			humidity: msbLsb(d[0], d[1])/100,
			temperature: signInt((msbLsb(d[2], d[3])), 16)/100
		};
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
	type: 1,
		name: 'Temperature/Humidity',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse
	};
};