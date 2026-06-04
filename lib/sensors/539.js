const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 90;
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
			"register_to_read": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set Read Registers",
					"main_caption": "Set the total number of registers to read on interval in the Register Reads field. Set the individual Registers to read below in the correspond Register field.",
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 32,
					"generated": true
				},
				"options": {
					"0": "0",
					"1": "1",
					"2": "2",
					"3": "3",
					"4": "4",
					"5": "5",
					"6": "6",
					"7": "7",
					"8": "8",
					"9": "9",
					"10": "10",
					"11": "11",
					"12": "12",
					"13": "13",
					"14": "14",
					"15": "15",
					"16": "16",
					"17": "17",
					"18": "18",
					"19": "19",
					"20": "20",
					"21": "21",
					"22": "22",
					"23": "23",
					"24": "24",
					"25": "25",
					"26": "26",
					"27": "27",
					"28": "28",
					"29": "29",
					"30": "30",
					"31": "31",
					"32": "32"
				},
				"tags": [
					"Communications"
				],
				"html_id": "number_of_regs_to_rd_539"
			},
			"modbus_register_1": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Register 1:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_1_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_2": {
				"read_index": 28,
				"write_index": 17,
				"descriptions": {
					"title": "Register 2:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_2_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_3": {
				"read_index": 30,
				"write_index": 19,
				"descriptions": {
					"title": "Register 3:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_3_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_4": {
				"read_index": 32,
				"write_index": 21,
				"descriptions": {
					"title": "Register 4:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_4_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_5": {
				"read_index": 34,
				"write_index": 23,
				"descriptions": {
					"title": "Register 5:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_5_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_6": {
				"read_index": 36,
				"write_index": 25,
				"descriptions": {
					"title": "Register 6:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_6_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_7": {
				"read_index": 38,
				"write_index": 27,
				"descriptions": {
					"title": "Register 7:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_7_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_8": {
				"read_index": 40,
				"write_index": 29,
				"descriptions": {
					"title": "Register 8:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_8_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_9": {
				"read_index": 42,
				"write_index": 31,
				"descriptions": {
					"title": "Register 9:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_9_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_10": {
				"read_index": 44,
				"write_index": 33,
				"descriptions": {
					"title": "Register 10:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_10_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_11": {
				"read_index": 46,
				"write_index": 35,
				"descriptions": {
					"title": "Register 11:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_11_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_12": {
				"read_index": 48,
				"write_index": 37,
				"descriptions": {
					"title": "Register 12:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_12_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_13": {
				"read_index": 50,
				"write_index": 39,
				"descriptions": {
					"title": "Register 13:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_13_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_14": {
				"read_index": 52,
				"write_index": 41,
				"descriptions": {
					"title": "Register 14:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_14_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_15": {
				"read_index": 54,
				"write_index": 43,
				"descriptions": {
					"title": "Register 15:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_15_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_16": {
				"read_index": 56,
				"write_index": 45,
				"descriptions": {
					"title": "Register 16:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_16_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_17": {
				"read_index": 58,
				"write_index": 47,
				"descriptions": {
					"title": "Register 17:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_17_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_18": {
				"read_index": 60,
				"write_index": 49,
				"descriptions": {
					"title": "Register 18:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_18_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_19": {
				"read_index": 62,
				"write_index": 51,
				"descriptions": {
					"title": "Register 19:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_19_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_20": {
				"read_index": 64,
				"write_index": 53,
				"descriptions": {
					"title": "Register 20:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_20_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_21": {
				"read_index": 66,
				"write_index": 55,
				"descriptions": {
					"title": "Register 21:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_21_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_22": {
				"read_index": 68,
				"write_index": 57,
				"descriptions": {
					"title": "Register 22:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_22_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_23": {
				"read_index": 70,
				"write_index": 59,
				"descriptions": {
					"title": "Register 23:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_23_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_24": {
				"read_index": 72,
				"write_index": 61,
				"descriptions": {
					"title": "Register 24:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_24_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_25": {
				"read_index": 74,
				"write_index": 63,
				"descriptions": {
					"title": "Register 25:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_25_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_26": {
				"read_index": 76,
				"write_index": 65,
				"descriptions": {
					"title": "Register 26:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_26_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_27": {
				"read_index": 78,
				"write_index": 67,
				"descriptions": {
					"title": "Register 27:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_27_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_28": {
				"read_index": 80,
				"write_index": 69,
				"descriptions": {
					"title": "Register 28:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_28_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_29": {
				"read_index": 82,
				"write_index": 71,
				"descriptions": {
					"title": "Register 29:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_29_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_30": {
				"read_index": 84,
				"write_index": 73,
				"descriptions": {
					"title": "Register 30:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_30_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_31": {
				"read_index": 86,
				"write_index": 75,
				"descriptions": {
					"title": "Register 31:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_31_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"modbus_register_32": {
				"read_index": 88,
				"write_index": 77,
				"descriptions": {
					"title": "Register 32:",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "register_value_32_539",
				"html_active_id": "number_of_regs_to_rd_539_active"
			},
			"baud_rate": {
				"read_index": 90,
				"write_index": 79,
				"descriptions": {
					"title": "Set Baud Rate",
					"main_caption": ""
				},
				"default_value": "9600",
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 115200,
					"generated": true
				},
				"options": {
					"9600": "9600",
					"19200": "19200",
					"38400": "38400",
					"57600": "57600",
					"115200": "115200"
				},
				"html_id": "baudrate_539"
			},
			"bootup_time": {
				"read_index": 94,
				"write_index": 83,
				"descriptions": {
					"title": "Set Bootup Time",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"html_id": "bootup_time_539"
			},
			"slave_address": {
				"read_index": 95,
				"write_index": 84,
				"descriptions": {
					"title": "Set Slave ID",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"html_id": "sensor_add_539"
			},
			"response_timeout": {
				"read_index": 96,
				"write_index": 85,
				"descriptions": {
					"title": "Set Rx Timeout",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"html_id": "rx_timeout_539"
			},
			"sub_device_type": {
				"read_index": 98,
				"write_index": 87,
				"descriptions": {
					"title": "Set Sub Device Type",
					"main_caption": "",
				},
				"default_value": 10,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"html_id": "sub_device_type_539"
			},
			"read_retries": {
				"read_index": 99,
				"write_index": 88,
				"descriptions": {
					"title": "Set Number of Read Retries",
					"main_caption": "Range: 1 to 3.",
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 3,
					"generated": true
				},
				"html_id": "number_of_read_retries_539"
			},
			"modbus_command": {
				"read_index": 100,
				"write_index": 89,
				"descriptions": {
					"title": "Set Read Parameter",
					"main_caption": "",
				},
				"default_value": 3,
				"validator": {
					"type": "uint8",
					"min": 3,
					"max": 4,
					"generated": true
				},
				"html_id": "read_parameter_539"
			},
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
			//response.auto_raw_destination_address = "0000ffff";
		};
		return response;
	};

	const parse = (d) => {
		return {
			subdevice_type: d[0],
			number_of_registers: d[1],
			status_24_31: d[2],
			status_16_23: d[3],
			status_8_15:  d[4],
			status_0_7:   d[5],
			// TODO we can automatically determine how many registers are here based on the number_of_registers and create data objects appropriately
			// r1: d.slice(2,4),
			// r2: d.slice(4,6),
			// r3: d.slice(6,8),
			// r4: d.slice(8,10),
			data: d.slice(6)
		};
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 539,
		name: 'RS485 Modbus Wireless Converter',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse
	};
};