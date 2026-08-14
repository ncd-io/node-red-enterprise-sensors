const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 34;
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
			"debouncing_timeout": {
				"read_index": 21,
				"write_index": 10,
				"descriptions": {
					"title": "Set Input Debounce Time",
					"main_caption": "Configures the debounce time in milliseconds for all inputs. State changes occurring within this debounce period will be ignored."
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 10,
					"max": 65000,
					"generated": true
				},
				"converter": {
					"units": " msec"
				},
				"html_id": "debounce_time_123"
			},
			"input_1_active_edge": {
				"read_index": 23,
				"write_index": 12,
				"descriptions": {
					"title": "Set Input 1 Detection",
					"main_caption": "Configures how the counter increments and how uptime is calculated for Input 1"
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "Falling Edge Trigger",
					"1": "Rising Edge Trigger"
				},
				"html_id": "input_one_123"
			},
			"input_2_active_edge": {
				"read_index": 24,
				"write_index": 13,
				"descriptions": {
					"title": "Set Input 2 Detection",
					"main_caption": "Configures how the counter increments and how uptime is calculated for Input 2"
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "Falling Edge Trigger",
					"1": "Rising Edge Trigger"
				},
				"html_id": "input_two_123"
			},
			"input_3_active_edge": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set Input 3 Detection",
					"main_caption": "Configures how the counter increments and how uptime is calculated for Input 3"
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "Falling Edge Trigger",
					"1": "Rising Edge Trigger"
				},
				"html_id": "input_three_123"
			},
			"counter_threshold": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Counter Threshold",
					"main_caption": "The sensor will transmit data when any connected counter reaches a multiple of this threshold value."
				},
				"default_value": 1000,
				"validator": {
					"type": "uint32be",
					"min": 1,
					"max": 65534,
					"generated": true
				},
				"html_id": "counter_threshold_108"
			},
			"trasnmit_on_change_status": {
				"read_index": 30,
				"write_index": 19,
				"descriptions": {
					"title": "Enable Push Notification",
					"main_caption": "Enables the sensor to immediately transmit data upon detecting a signal change on the specified input(s)."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 6,
					"generated": true
				},
				"options": {
					"0": "Disabled All",
					"1": "Enable on IO1",
					"2": "Enable on IO2",
					"3": "Enable on IO1 and IO2",
					"4": "Enable on IO3",
					"5": "Enable on IO1 and IO3",
					"6": "Enable on IO2 and IO3",
					"7": "Enable All"
				},
				"html_id": "push_notification_123"
			},
			"shift_end_one_hours": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Shift 1 End Time Hours",
					"main_caption": "Based on the Real-Time Clock (RTC), configures one of four specific daily times (24-hour format) for the sensor to perform an automatic reset."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 24,
					"generated": true
				},
				"html_id": "shift_one_hours_108",
				"html_active_id": "shift_one_108_active"
			},
			"shift_end_one_minutes": {
				"read_index": 32,
				"write_index": 21,
				"descriptions": {
					"title": "Shift 1 End Time Minutes",
					"main_caption": "Based on the Real-Time Clock (RTC), configures one of four specific daily times (24-hour format) for the sensor to perform an automatic reset."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 60,
					"generated": true
				},
				"html_id": "shift_one_minutes_108",
				"html_active_id": "shift_one_108_active"
			},
			"shift_end_two_hours": {
				"read_index": 33,
				"write_index": 22,
				"descriptions": {
					"title": "Shift 2 End Time Hours",
					"main_caption": "Based on the Real-Time Clock (RTC), configures two of four specific daily times (24-hour format) for the sensor to perform an automatic reset."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 24,
					"generated": true
				},
				"html_id": "shift_two_hours_108",
				"html_active_id": "shift_two_108_active"
			},
			"shift_end_two_minutes": {
				"read_index": 34,
				"write_index": 23,
				"descriptions": {
					"title": "Shift 2 End Time Minutes",
					"main_caption": "Based on the Real-Time Clock (RTC), configures two of four specific daily times (24-hour format) for the sensor to perform an automatic reset."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 60,
					"generated": true
				},
				"html_id": "shift_two_minutes_108",
				"html_active_id": "shift_two_108_active"
			},
			"shift_end_three_hours": {
				"read_index": 35,
				"write_index": 24,
				"descriptions": {
					"title": "Shift 3 End Time Hours",
					"main_caption": "Based on the Real-Time Clock (RTC), configures three of four specific daily times (24-hour format) for the sensor to perform an automatic reset."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 24,
					"generated": true
				},
				"html_id": "shift_three_hours_108",
				"html_active_id": "shift_three_108_active"
			},
			"shift_end_three_minutes": {
				"read_index": 36,
				"write_index": 25,
				"descriptions": {
					"title": "Shift 3 End Time Minutes",
					"main_caption": "Based on the Real-Time Clock (RTC), configures three of four specific daily times (24-hour format) for the sensor to perform an automatic reset."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 60,
					"generated": true
				},
				"html_id": "shift_three_minutes_108",
				"html_active_id": "shift_three_108_active"
			},
			"shift_end_four_hours": {
				"read_index": 37,
				"write_index": 26,
				"descriptions": {
					"title": "Shift 4 End Time Hours",
					"main_caption": "Based on the Real-Time Clock (RTC), configures four of four specific daily times (24-hour format) for the sensor to perform an automatic reset."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 24,
					"generated": true
				},
				"html_id": "shift_four_hours_108",
				"html_active_id": "shift_four_108_active"
			},
			"shift_end_four_minutes": {
				"read_index": 38,
				"write_index": 27,
				"descriptions": {
					"title": "Shift 4 End Time Minutes",
					"main_caption": "Based on the Real-Time Clock (RTC), configures four of four specific daily times (24-hour format) for the sensor to perform an automatic reset."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 60,
					"generated": true
				},
				"html_id": "shift_four_minutes_108",
				"html_active_id": "shift_four_108_active"
			},
			"reset_timeout": {
				"read_index": 39,
				"write_index": 28,
				"descriptions": {
					"title": "Reset Timeout",
					"main_caption": "Defines the duration (in seconds) after which the sensor will automatically reset. Before resetting, it will transmit its current data values."
				},
				"default_value": 600,
				"validator": {
					"type": "uint16be",
					"min": 10,
					"max": 65000,
					"generated": true
				},
				"converter": {
					"units": " seconds"
				},
				"html_id": "reset_timeout_108"
			},
			"counter_reset_mode": {
				"read_index": 41,
				"write_index": 30,
				"descriptions": {
					"title": "Set Reset Mode",
					"main_caption": "This setting specifies which automatic reset option the sensor will utilize."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 2,
					"generated": true
				},
				"options": {
					"0": "Do not reset counters",
					"1": "Based on Shift Ends",
					"2": "Based on the Timeout Provided"
				},
				"html_id": "reset_mode_to_disabled_108"
			},
			"sampling_interval": {
				"read_index": 42,
				"write_index": 31,
				"descriptions": {
					"title": "Data Transmission Interval",
					"main_caption": "Sets the regular interval at which the sensor wakes up and transmits its data. This interval operates independently of any interrupt-driven (Push Notifications or Resets)."
				},
				"default_value": 3,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 12,
					"generated": true
				},
				"options": {
					"0": "1 minute",
					"1": "5 minutes",
					"2": "15 minutes",
					"3": "30 minutes",
					"4": "1 hour",
					"5": "2 hours",
					"6": "3 hours",
					"7": "6 hours",
					"8": "12 hours",
					"9": "5 seconds",
					"10": "10 seconds",
					"11": "15 seconds",
					"12": "30 seconds"
				},
				"html_id": "transmission_interval_108"
			},
			"interrupt_timeout": {
				"read_index": 43,
				"write_index": 32,
				"descriptions": {
					"title": "Set Interrupt Timeout",
					"main_caption": "Set the sensor to detect an initial IO (input/output) change and not transmit subsequent IO changes for a specified duration; set the duration value to control how long changes are ignored in milliseconds, set it to 0 to disable ignoring."
				},
				"default_value": 0,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65000,
					"generated": true
				},
				"converter": {
					"units": " msec"
				},
				"html_id": "interrupt_timeout_108"
			},
			// "sync_interval": {
			// 	"read_index": 0,
			// 	"write_index": 0,
			// 	"descriptions": {
			// 		"title": "Set FLY Interval",
			// 		"main_caption": "This setting dictates the interval at which the sensor will transmit the FLY message."
			// 	},
			// 	"default_value": 0,
			// 	"validator": {
			// 		"type": "uint16be",
			// 		"min": 0,
			// 		"max": 65000,
			// 		"generated": true
			// 	},
			// 	"html_id": "fly_interval_108"
			// }
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
		let reset_mode = "Disabled";
		switch(frame[36]){
			case 0:
				reset_mode = "Disabled";
				break;
			case 1:
				reset_mode = "Shift Ends";
				break;
			case 2:
				reset_mode = "Timeout";
				break;
		}
		let rtc_sampling_interval = "5sec";
		switch(frame[37]){
			case 0:
				rtc_sampling_interval = "1min";
				break;
			case 1:
				rtc_sampling_interval = "5min";
				break;
			case 2:
				rtc_sampling_interval = "15min";
				break;
			case 3:
				rtc_sampling_interval = "30min";
				break;
			case 4:
				rtc_sampling_interval = "1h";
				break;
			case 5:
				rtc_sampling_interval = "2h";
				break;
			case 6:
				rtc_sampling_interval = "3h";
				break;
			case 7:
				rtc_sampling_interval = "6h";
				break;
			case 8:
				rtc_sampling_interval = "12h";
				break;
			case 9:
				rtc_sampling_interval = "5sec";
				break;
			case 10:
				rtc_sampling_interval = "10sec";
				break;
			case 11:
				rtc_sampling_interval = "15sec";
				break;
			case 12:
				rtc_sampling_interval = "30sec";
				break;
		}
		return {
			'firmware': frame[2],
			'debouncing_timeout': frame.slice(16, 18).reduce(msbLsb) + "msec",
			'input_1_active_edge': frame[18]? "Rising": "Falling",
			'input_2_active_edge': frame[19]? "Rising": "Falling",
			'input_3_active_edge': frame[20]? "Rising": "Falling",
			'counter_threshold': frame.slice(21, 25).reduce(msbLsb),
			'trasnmit_on_change_status': frame[25]? "Enabled": "Disabled",
			'Shift_end_1': [
				String(frame[26]).padStart(2, '0'),
				String(frame[27]).padStart(2, '0')
			].join(':'),
			'Shift_end_2': [
				String(frame[28]).padStart(2, '0'),
				String(frame[29]).padStart(2, '0')
			].join(':'),
			'Shift_end_3': [
				String(frame[30]).padStart(2, '0'),
				String(frame[31]).padStart(2, '0')
			].join(':'),
			'Shift_end_4': [
				String(frame[32]).padStart(2, '0'),
				String(frame[33]).padStart(2, '0')
			].join(':'),
			'reset_timeout': frame.slice(34, 36).reduce(msbLsb) + "min",
			'counter_reset_mode': reset_mode,
			'sampling_interval': rtc_sampling_interval,
			'interrupt_timeout': frame.slice(38, 40).reduce(msbLsb) + "msec",
			'hardware_id': frame.slice(40, 43),
			'report_rate': frame.slice(43, 47).reduce(msbLsb) + "sec",
			'tx_life_counter': frame.slice(47, 51).reduce(msbLsb),
			'machine_values': {
				'firmware': frame[2],
				'debouncing_timeout': frame.slice(16, 18),
				'input_1_active_edge': frame[18],
				'input_2_active_edge': frame[19],
				'input_3_active_edge': frame[20],
				'counter_threshold': frame.slice(21, 25),
				'trasnmit_on_change_status': frame[25],
				'Shift_end_1': frame.slice(26, 28),
				'Shift_end_2': frame.slice(28, 30),
				'Shift_end_3': frame.slice(30, 32),
				'Shift_end_4': frame.slice(32, 34),
				'reset_timeout': frame.slice(34, 36),
				'counter_reset_mode': frame[36],
				'sampling_interval': frame[37],
				'interrupt_timeout': frame.slice(38, 40),
				'hardware_id': frame.slice(40, 43),
				'report_rate': frame.slice(43, 47),
				'tx_life_counter': frame.slice(47, 51)
			}
		}
	};

	const parse = (d, payload) => {
		let report_type = "Regular";
		switch(d[25]){
			case 0:
				report_type = "Regular";
				break;
			case 1:
				report_type = "Shift end";
				break;
			case 2:
				report_type = "Interrupt";
				break;
			case 3:
				report_type = "Threshold";
				break;
		}
		return {
			digital_input_1_counter: d.slice(0, 4).reduce(msbLsb),
			digital_input_1_uptime: d.slice(4, 8).reduce(msbLsb),
			digital_input_2_counter: d.slice(8, 12).reduce(msbLsb),
			digital_input_2_uptime: d.slice(12, 16).reduce(msbLsb),
			digital_input_3_counter: d.slice(16, 20).reduce(msbLsb),
			digital_input_3_uptime: d.slice(20, 24).reduce(msbLsb),
			input_1: d[24] & 1 ? 1 : 0,
			input_2: d[24] & 2 ? 1 : 0,
			input_3: d[24] & 4 ? 1 : 0,
			report_type: report_type,
			rtc: [
				String(d[26]).padStart(2, '0'),
				String(d[27]).padStart(2, '0'),
				String(d[28]).padStart(2, '0')
			].join(':')
		};
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 123,
		name: '3 Channel Production Counter',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};