const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 52;
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
			"oxygen_bootup_time": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Sensor Boot Time",
					"main_caption": "This value represents the number of seconds to wait after applying power to the Oxygen sensor before taking a reading."
				},
				"default_value": 3,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 100
				},
				"html_id": "oxygen_boot_time_536"
			},
			"flow_bootup_time": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set Flow Boot Time",
					"main_caption": "This value represents the number of seconds to wait after applying power to the Flow sensor before taking a reading."
				},
				"default_value": 3,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 100
				},
				"html_id": "flow_boot_time_536"
			},
			"s1_oxygen_addr": {
				"read_index": 27,
				"write_index": 16,
				"descriptions": {
					"title": "Set Oxygen Sensors Addresses",
					"main_caption": "Set the Modbus Slave device address connected to this device"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "oxygen_addr_1_536",
				"html_active_id": "oxygen_dev_addr_536_active"
			},
			"s2_oxygen_addr": {
				"read_index": 28,
				"write_index": 17,
				"descriptions": {
					"title": "Set Oxygen Sensors Addresses",
					"main_caption": "Set the Modbus Slave device address connected to this device"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "oxygen_addr_2_536",
				"html_active_id": "oxygen_dev_addr_536_active"
			},
			"s3_oxygen_addr": {
				"read_index": 29,
				"write_index": 18,
				"descriptions": {
					"title": "Set Oxygen Sensors Addresses",
					"main_caption": "Set the Modbus Slave device address connected to this device"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "oxygen_addr_3_536",
				"html_active_id": "oxygen_dev_addr_536_active"
			},
			"s4_oxygen_addr": {
				"read_index": 30,
				"write_index": 19,
				"descriptions": {
					"title": "Set Oxygen Sensors Addresses",
					"main_caption": "Set the Modbus Slave device address connected to this device"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "oxygen_addr_4_536",
				"html_active_id": "oxygen_dev_addr_536_active"
			},
			"s1_flow_addr": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Set Flow Sensors Addresses",
					"main_caption": "Set the Modbus Slave device address connected to this device"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "flow_addr_1_536",
				"html_active_id": "flow_dev_addr_536_active"
			},
			"s2_flow_addr": {
				"read_index": 32,
				"write_index": 21,
				"descriptions": {
					"title": "Set Flow Sensors Addresses",
					"main_caption": "Set the Modbus Slave device address connected to this device"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "flow_addr_2_536",
				"html_active_id": "flow_dev_addr_536_active"
			},
			"s3_flow_addr": {
				"read_index": 33,
				"write_index": 22,
				"descriptions": {
					"title": "Set Flow Sensors Addresses",
					"main_caption": "Set the Modbus Slave device address connected to this device"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "flow_addr_3_536",
				"html_active_id": "flow_dev_addr_536_active"
			},
			"s4_flow_addr": {
				"read_index": 34,
				"write_index": 23,
				"descriptions": {
					"title": "Set Flow Sensors Addresses",
					"main_caption": "Set the Modbus Slave device address connected to this device"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "flow_addr_4_536",
				"html_active_id": "flow_dev_addr_536_active"
			},
			"oxygen_max_threshold_sensor_1": {
				"read_index": 35,
				"write_index": 24,
				"descriptions": {
					"title": "Set Oxygen Max Threshold Sensor 1",
					"main_caption": "Valid range: 0 - 2000"
				},
				"default_value": 1200,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 2000
				},
				"converter": {
					"units": "dg/l"
				},
				"html_id": "oxygen_max_threshold_s1_536"
			},
			"oxygen_max_threshold_sensor_2": {
				"read_index": 37,
				"write_index": 26,
				"descriptions": {
					"title": "Set Oxygen Max Threshold Sensor 2",
					"main_caption": "Valid range: 0 - 2000"
				},
				"default_value": 1200,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 2000
				},
				"converter": {
					"units": "dg/l"
				},
				"html_id": "oxygen_max_threshold_s2_536"
			},
			"oxygen_max_threshold_sensor_3": {
				"read_index": 39,
				"write_index": 28,
				"descriptions": {
					"title": "Set Oxygen Max Threshold Sensor 3",
					"main_caption": "Valid range: 0 - 2000"
				},
				"default_value": 1200,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 2000
				},
				"converter": {
					"units": "dg/l"
				},
				"html_id": "oxygen_max_threshold_s3_536"
			},
			"oxygen_max_threshold_sensor_4": {
				"read_index": 41,
				"write_index": 30,
				"descriptions": {
					"title": "Set Oxygen Max Threshold Sensor 4",
					"main_caption": "Valid range: 0 - 2000"
				},
				"default_value": 1200,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 2000
				},
				"converter": {
					"units": "dg/l"
				},
				"html_id": "oxygen_max_threshold_s4_536"
			},
			"oxygen_min_threshold_sensor_1": {
				"read_index": 43,
				"write_index": 32,
				"descriptions": {
					"title": "Set Oxygen Min Threshold Sensor 1",
					"main_caption": "Valid range: 0 - 2000"
				},
				"default_value": 1200,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 2000
				},
				"converter": {
					"units": "dg/l"
				},
				"html_id": "oxygen_min_threshold_s1_536"
			},
			"oxygen_min_threshold_sensor_2": {
				"read_index": 45,
				"write_index": 34,
				"descriptions": {
					"title": "Set Oxygen Min Threshold Sensor 2",
					"main_caption": "Valid range: 0 - 2000"
				},
				"default_value": 1200,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 2000
				},
				"converter": {
					"units": "dg/l"
				},
				"html_id": "oxygen_min_threshold_s2_536"
			},
			"oxygen_min_threshold_sensor_3": {
				"read_index": 47,
				"write_index": 36,
				"descriptions": {
					"title": "Set Oxygen Min Threshold Sensor 3",
					"main_caption": "Valid range: 0 - 2000"
				},
				"default_value": 1200,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 2000
				},
				"converter": {
					"units": "dg/l"
				},
				"html_id": "oxygen_min_threshold_s3_536"
			},
			"oxygen_min_threshold_sensor_4": {
				"read_index": 49,
				"write_index": 38,
				"descriptions": {
					"title": "Set Oxygen Min Threshold Sensor 4",
					"main_caption": "Valid range: 0 - 2000"
				},
				"default_value": 1200,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 2000
				},
				"converter": {
					"units": "dg/l"
				},
				"html_id": "oxygen_min_threshold_s4_536"
			},
			"oxygen_sensor_baud_rate": {
				"read_index": 51,
				"write_index": 40,
				"descriptions": {
					"title": "Set Oxygen Sensor Baud Rate",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 115200,
					"generated": true
				},
				"html_id": "oxygen_sensor_baud_rate_536"
			},
			"oxygen_sensor_parity_bits": {
				"read_index": 55,
				"write_index": 44,
				"descriptions": {
					"title": "Set Oxygen Sensor Parity Bits",
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
					"0": "none",
					"1": "odd",
					"2": "Even"
				},
				"html_id": "oxygen_sensor_parity_bits_536"
			},
			"oxygen_sensor_stop_bits": {
				"read_index": 56,
				"write_index": 45,
				"descriptions": {
					"title": "Set Oxygen Sensor Stop Bits",
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
					"0": "Half bits",
					"1": "1 bit",
					"2": "1.5 bits",
					"3": "2 bits"
				},
				"html_id": "oxygen_sensor_stop_bits_536"
			},
			"flow_sensor_baud_rate": {
				"read_index": 57,
				"write_index": 46,
				"descriptions": {
					"title": "Set Flow Sensor Baud Rate",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 115200,
					"generated": true
				},
				"html_id": "flow_sensor_baud_rate_536"
			},
			"flow_sensor_parity_bits": {
				"read_index": 61,
				"write_index": 50,
				"descriptions": {
					"title": "Set Flow Sensor Parity Bits",
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
					"0": "none",
					"1": "odd",
					"2": "Even"
				},
				"html_id": "flow_sensor_parity_bits_536"
			},
			"flow_sensor_stop_bits": {
				"read_index": 62,
				"write_index": 51,
				"descriptions": {
					"title": "Set Flow Sensor Stop Bits",
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
					"0": "Half bits",
					"1": "1 bit",
					"2": "1.5 bits",
					"3": "2 bits"
				},
				"html_id": "flow_sensor_stop_bits_536"
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
		return {
			'firmware': frame[2],
			'oxygen_bootup_time': frame[12] + 'sec',
			'flow_bootup_time': frame[13]+ 'sec',
			's1_oxygen_addr': frame[14],
			's2_oxygen_addr': frame[15],
			's3_oxygen_addr': frame[16],
			's4_oxygen_addr': frame[17],
			's1_flow_addr': frame[18],
			's2_flow_addr': frame[19],
			's3_flow_addr': frame[20],
			's4_flow_addr': frame[21],
			'hardware_id': frame.slice(22, 25),
			'report_rate': frame.slice(25, 29).reduce(msbLsb) + 'sec',
			'tx_life_counter': frame.slice(29, 33).reduce(msbLsb),
			'machine_values': {
				'firmware': frame[2],
				'oxygen_bootup_time': frame[12],
				'flow_bootup_time': frame[13],
				's1_oxygen_addr': frame[14],
				's2_oxygen_addr': frame[15],
				's3_oxygen_addr': frame[16],
				's4_oxygen_addr': frame[17],
				's1_flow_addr': frame[18],
				's2_flow_addr': frame[19],
				's3_flow_addr': frame[20],
				's4_flow_addr': frame[21],
				'hardware_id': frame.slice(22, 25),
				'report_rate': frame.slice(25, 29),
				'tx_life_counter': frame.slice(29, 33)
			}
		}
	};

	const parse = (payload, parsed) => {
		return {
			error_status: payload[0],
			s1_oxygen_temp: payload.slice(1, 3).reduce(msbLsb)/100,
			s2_oxygen_temp: payload.slice(3, 5).reduce(msbLsb)/100,
			s3_oxygen_temp: payload.slice(5, 7).reduce(msbLsb)/100,
			s4_oxygen_temp: payload.slice(7, 9).reduce(msbLsb)/100,
			s1_saturation_percent: payload.slice(9, 13).reduce(msbLsb)/100,
			s2_saturation_percent: payload.slice(13, 17).reduce(msbLsb)/100,
			s3_saturation_percent: payload.slice(17, 21).reduce(msbLsb)/100,
			s4_saturation_percent: payload.slice(21, 25).reduce(msbLsb)/100,
			s1_oxigen_ppm: payload.slice(25, 29).reduce(msbLsb)/100,
			s2_oxigen_ppm: payload.slice(29, 33).reduce(msbLsb)/100,
			s3_oxigen_ppm: payload.slice(33, 37).reduce(msbLsb)/100,
			s4_oxigen_ppm: payload.slice(37, 41).reduce(msbLsb)/100,
			s1_oxigen_mg_l: payload.slice(41, 45).reduce(msbLsb)/100,
			s2_oxigen_mg_l: payload.slice(45, 49).reduce(msbLsb)/100,
			s3_oxigen_mg_l: payload.slice(49, 53).reduce(msbLsb)/100,
			s4_oxigen_mg_l: payload.slice(53, 57).reduce(msbLsb)/100,
			s1_flow_rate: payload.slice(57, 61).reduce(msbLsb)/100,
			s2_flow_rate: payload.slice(61, 65).reduce(msbLsb)/100,
			s3_flow_rate: payload.slice(65, 69).reduce(msbLsb)/100,
			s4_flow_rate: payload.slice(69, 73).reduce(msbLsb)/100,
			s1_solenoid_status: payload[73],
			s2_solenoid_status: payload[74],
			s3_solenoid_status: payload[75],
			s4_solenoid_status: payload[76]
		}
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 536,
		name: 'Wireless Oxygen Flow Meter',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};