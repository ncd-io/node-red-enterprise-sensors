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
			"thermocouple_type": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set Thermocouple Type",
					"main_caption": "Set the type of thermocouple being used, this device supports eight thermocouple types (e.g., K, J, T, N, S, E, B, R)."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 112,
					"generated": true
				},
				"options": {
					"0": "Type K",
					"16": "Type J",
					"32": "Type T",
					"48": "Type N",
					"64": "Type S",
					"80": "Type E",
					"96": "Type B",
					"112": "Type R"
				},
				"html_id": "thermocouple_type_23"
			},
			"filter_coefficient": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set Filter Level",
					"main_caption": "The sensor applies the selected filter level by averaging multiple temperature readings over time."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 7,
					"generated": true
				},
				"options": {
					"0": "Level 0",
					"1": "Level 1",
					"2": "Level 2",
					"3": "Level 3",
					"4": "Level 4",
					"5": "Level 5",
					"6": "Level 6",
					"7": "Level 7"
				},
				"html_id": "filter_thermocouple"
			},
			"cold_junction_resolution": {
				"read_index": 27,
				"write_index": 16,
				"descriptions": {
					"title": "Set Cold Junction Resolution",
					"main_caption": "The internal chip integrates an ambient temperature sensor which can be used to measure the thermocouple cold-junction temperature."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 128,
					"generated": true
				},
				"options": {
					"0": "0.0625⁰C",
					"128": "0.25⁰C"
				},
				"html_id": "cold_junction_thermocouple"
			},
			"adc_resolution": {
				"read_index": 28,
				"write_index": 17,
				"descriptions": {
					"title": "Set ADC Resolution",
					"main_caption": "The ADC measurement resolution is selectable, which enables the user to choose faster conversion times with reduced resolution."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 96,
					"generated": true
				},
				"options": {
					"0": "18 Bits",
					"32": "16 Bits",
					"64": "14 Bits",
					"96": "12 Bits"
				},
				"html_id": "sample_resolution_thermocouple"
			},
			"number_of_samples": {
				"read_index": 29,
				"write_index": 18,
				"descriptions": {
					"title": "Set Number of Samples",
					"main_caption": "Specifies how many temperature samples are taken per measurement, in addition, if the filter option is enabled, then the filter engine is applied to each temperature sample."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 28,
					"generated": true
				},
				"options": {
					"0": "1 Sample",
					"4": "2 Samples",
					"8": "4 Samples",
					"12": "8 Samples",
					"16": "16 Samples",
					"20": "32 Samples",
					"24": "64 Samples",
					"28": "128 Samples"
				},
				"html_id": "number_of_samples_thermocouple"
			},
			"operation_mode": {
				"read_index": 30,
				"write_index": 19,
				"descriptions": {
					"title": "Set Operation Mode",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 2,
					"generated": true
				},
				"options": {
					"0": "Normal",
					"1": "Shutdown",
					"2": "Burst"
				},
				"html_id": "operation_mode_4"
			},
			"measurement_type": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Set Measurement Type",
					"main_caption": "Configures the sensor to measure either the hot-junction temperature, cold-junction temperature, or the differential between them."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 28,
					"generated": true
				},
				"options": {
					"0": "Cold Junction",
					"1": "Hot Junction",
					"2": "Delta"
				},
				"html_id": "measurement_type_thermocouple"
			},
			"boot_time": {
				"read_index": 32,
				"write_index": 21,
				"descriptions": {
					"title": "Set Boot Time",
					"main_caption": "Sets the time (in milliseconds) taken for sensor to be ready for use after it's powered on."
				},
				"default_value": 1500,
				"validator": {
					"type": "uint16be"
				},
				"html_id": "boot_time_4"
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

	const parse = (d) => {
		return {
			channel_1: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
			channel_2: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
		};
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 23,
		name: '2-Channel Thermocouple',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse
	};
};