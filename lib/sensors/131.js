const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 15;
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
				"default_value": 600,
				"validator": {
					"type": "uint32be"
				},
				"html_id": "delay"
			},
			"pressure_sensor_type": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set Pressure Sensor Type",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 22
				},
				"options": {
					"0": "2.5MD",
					"1": "006MD",
					"2": "010MD",
					"3": "016MD",
					"4": "025MD",
					"5": "040MD",
					"6": "060MD",
					"7": "100MD",
					"8": "160MD",
					"9": "250MD",
					"10": "400MD",
					"11": "600MD",
					"12": "001BD",
					"13": "1.6BD",
					"14": "2.5BD",
					"15": "004BD",
					"16": "0001ND",
					"17": "0002ND",
					"18": "0004ND",
					"19": "0005ND",
					"20": "0010ND",
					"21": "0020ND",
					"22": "0030ND"
				},
				"html_id": "pressure_sensor_type_131"
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

	const parse = (payload, parsed, mac) => {
		let reserved = payload[7];
		let reserved_byte = reserved >> 1; // (1-bit right shifted)

		let status = {};
		const MASK_POWER_ON   = 1 << 6;
		const MASK_BUSY       = 1 << 5;
		const MASK_MEM_ERROR  = 1 << 2;
		const MASK_MATH_ERROR = 1 << 0;

		status.power = (reserved_byte & MASK_POWER_ON) ? 'powered_on' : 'powered_off';

		// Fixed typo: 'bussy' -> 'busy'
		let busy     = (reserved_byte & MASK_BUSY);
		let mem_err  = (reserved_byte & MASK_MEM_ERROR); 
		let math_err = (reserved_byte & MASK_MATH_ERROR); 

		// Non-mutually exclusive states:
		// Collect all active statuses in an array, then join them.
		let status_flags = [];

		if (busy) status_flags.push('busy');
		if (mem_err) status_flags.push('mem_error');
		if (math_err) status_flags.push('math_or_i2c_error');

		// If no flags are active, default to 'ok'
		status.sensor = status_flags.length > 0 ? status_flags.join(', ') : 'ok';

		let sensor_type_byte = payload[8];
		let sensor_type = {};
		switch(sensor_type_byte) {
			case 0:
				range = "±2.5 mbar";
				break;
			case 1:
				range = "±6 mbar";
				break;
			case 2:
				range = "±10 mbar";
				break;
			case 3:
				range = "±16 mbar";
				break;
			case 4:
				range = "±25 mbar";
				break;
			case 5:
				range = "±40 mbar";
				break;
			case 6:
				range = "±60 mbar";
				break;
			case 7:
				range = "±100 mbar";
				break;
			case 8:
				range = "±160 mbar";
				break;
			case 9:
				range = "±250 mbar";
				break;
			case 10:
				range = "±400 mbar";
				break;
			case 11:
				range = "±600 mbar";
				break;
			case 12:
				range = "±1000 mbar";
				break;
			case 13:
				range = "±1600 mbar";
				break;
			case 14:
				range = "±2500 mbar";
				break;
			case 15:
				range = "±4000 mbar";
				break;
			case 16:
				range = "±2.49 mbar";
				break;
			case 17:
				range = "±4.98 mbar";
				break;
			case 18:
				range = "±9.96 mbar";
				break;
			case 19:
				range = "±12.45 mbar";
				break;
			case 20:
				range = "±24.91 mbar";
				break;
			case 21:
				range = "±49.82 mbar";
				break;
			case 22:
				range = "±74.73 mbar";
				break;
			default:
				range = "Unknown"; 
				break;
		}

		return {
			status: status,
			pressure_range: range,
			pressure_mbar: signInt(payload.slice(9, 13).reduce(msbLsb), 32) / 1000,
			temperature_C: signInt(payload.slice(13, 15).reduce(msbLsb), 16) / 100,
			raw_pressure: payload.slice(15, 19).reduce(msbLsb),
			inches_of_water_H2O: signInt(payload.slice(19, 23).reduce(msbLsb), 32) / 1000
		};
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 131,
		name: 'Wireless Differential Pressure Sensor Gen4',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse
	};
};