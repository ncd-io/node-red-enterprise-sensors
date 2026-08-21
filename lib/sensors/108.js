const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	let screen = false;

	const get_write_buffer_size = (firmware) => {
		if(screen){
			return 39;
		} else{
			return 37;
		}
	};

	const get_config_map = (firmware) => {
		console.log('Generating sync map for firmware version', firmware);

		let res = {
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
			"accelerometer_threshold":{
				"read_index": 21,
				"write_index": 10,
				"descriptions": {
					"title": "Set Accelerometer Threshold",
					"main_caption": "Sets the threshold in multiples of 32mg in which an uptime will be detected. A value of 1 = 32mg, a value of 2 = 64mg etc. "
				},
				"default_value": 10,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"depends_on": {
					"accelero_state": 1
				},
				"converter": {
					"multiplier": 32,
					"units": " mg"
				},
				"html_id": "accelerometer_threshold_108"
			},
			"debouncing_timeout": {
				"read_index": 22,
				"write_index": 11,
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
				"html_id": "debounce_time_v10_108"
			},
			"accelero_state": {
				"read_index": 24,
				"write_index": 13,
				"descriptions": {
					"title": "Enable Accelerometer",
					"main_caption": "This setting toggles the accelerometer sensor on or off. Disabling it is recommended for applications that does not require accelerometer. "
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "Disabled",
					"1": "Enabled"
				},
				"html_id": "deactivate_activate_accelero_108"
			},
			"input_1_active_edge": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set Contact Closure Detection",
					"main_caption": "Configures how the counter increments and how uptime is calculated for Contact Closure Input:"
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
				"html_id": "input_one_108"
			},
			"input_2_active_edge": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set Current Transducer Detection",
					"main_caption": "Configures how the counter increments and how uptime is calculated for Current Transducer Input:"
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
				"html_id": "input_two_108"
			},
			"input_3_active_edge": {
				"read_index": 27,
				"write_index": 16,
				"descriptions": {
					"title": "Set Wet Contact/Optical Sensor Detection",
					"main_caption": "Configures how the counter increments and how uptime is calculated for Contact/Optical Input"
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
				"html_id": "input_three_108"
			},
			"counter_threshold": {
				"read_index": 28,
				"write_index": 17,
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
			"transmit_on_change_status": {
				"read_index": 32,
				"write_index": 21,
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
					"31": "Enable All",
					"1": "Enable on IO 1",
					"2": "Enable on IO 2",
					"4": "Enable on IO 3",
					"8": "Enable on IO 4",
					"16": "Enable on IO 5",
					"3": "Enable on IO 1 and 2",
					"5": "Enable on IO 1 and 3",
					"9": "Enable on IO 1 and 4",
					"17": "Enable on IO 1 and 5",
					"7": "Enable on IO 1, 2 and 3",
					"11": "Enable on IO 1, 2 and 4",
					"19": "Enable on IO 1, 2 and 5",
					"15": "Enable on IO 1, 2, 3 and 4",
					"27": "Enable on IO 1, 2, 4 and 5",
					"23": "Enable on IO 1, 2, 3 and 5",
					"13": "Enable on IO 1, 3 and 4",
					"29": "Enable on IO 1, 3, 4 and 5",
					"21": "Enable on IO 1, 3 and 5",
					"25": "Enable on IO 1, 4 and 5",
					"6": "Enable on IO 2 and 3",
					"10": "Enable on IO 2 and 4",
					"18": "Enable on IO 2 and 5",
					"14": "Enable on IO 2, 3 and 4",
					"22": "Enable on IO 2, 3 and 5",
					"26": "Enable on IO 2, 4 and 5",
					"30": "Enable on IO 2, 3, 4, and 5",
					"12": "Enable on IO 3 and 4",
					"20": "Enable on IO 3 and 5",
					"24": "Enable on IO 4 and 5",
					"28": "Enable on IO 3, 4 and 5"
				},
				"html_id": "push_notification_108"
			},
			"shift_end_one_hours": {
				"read_index": 33,
				"write_index": 22,
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
				"depends_on": {
					"counter_reset_mode": 1
				},
				"html_id": "shift_one_hours_108",
				"html_active_id": "shift_one_108_active"
			},
			"shift_end_one_minutes": {
				"read_index": 34,
				"write_index": 23,
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
				"depends_on": {
					"counter_reset_mode": 1
				},
				"html_id": "shift_one_minutes_108",
				"html_active_id": "shift_one_108_active"
			},
			"shift_end_two_hours": {
				"read_index": 35,
				"write_index": 24,
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
				"depends_on": {
					"counter_reset_mode": 1
				},
				"html_id": "shift_two_hours_108",
				"html_active_id": "shift_two_108_active"
			},
			"shift_end_two_minutes": {
				"read_index": 36,
				"write_index": 25,
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
				"depends_on": {
					"counter_reset_mode": 1
				},
				"html_id": "shift_two_minutes_108",
				"html_active_id": "shift_two_108_active"
			},
			"shift_end_three_hours": {
				"read_index": 37,
				"write_index": 26,
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
				"depends_on": {
					"counter_reset_mode": 1
				},
				"html_id": "shift_three_hours_108",
				"html_active_id": "shift_three_108_active"
			},
			"shift_end_three_minutes": {
				"read_index": 38,
				"write_index": 27,
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
				"depends_on": {
					"counter_reset_mode": 1
				},
				"html_id": "shift_three_minutes_108",
				"html_active_id": "shift_three_108_active"
			},
			"shift_end_four_hours": {
				"read_index": 39,
				"write_index": 28,
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
				"depends_on": {
					"counter_reset_mode": 1
				},
				"html_id": "shift_four_hours_108",
				"html_active_id": "shift_four_108_active"
			},
			"shift_end_four_minutes": {
				"read_index": 40,
				"write_index": 29,
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
				"depends_on": {
					"counter_reset_mode": 1
				},
				"html_id": "shift_four_minutes_108",
				"html_active_id": "shift_four_108_active"
			},
			"reset_timeout": {
				"read_index": 41,
				"write_index": 30,
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
				"depends_on": {
					"counter_reset_mode": 2
				},
				"converter": {
					"units": " seconds"
				},
				"html_id": "reset_timeout_108"
			},
			"counter_reset_mode": {
				"read_index": 43,
				"write_index": 32,
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
				"read_index": 44,
				"write_index": 33,
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
			"acc_odr": {
				"read_index": 45,
				"write_index": 34,
				"descriptions": {
					"title": "Set Accelerometer Sample Rate",
					"main_caption": "This setting defines the number of measurements the sensor takes per second, measured in Hertz (Hz)."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 5,
					"generated": true
				},
				"depends_on": {
					"accelero_state": 1
				},
				"options": {
					"0": "10 Hz",
					"1": "20 Hz",
					"2": "50 Hz",
					"3": "100 Hz",
					"4": "200 Hz",
					"5": "400 Hz"
				},
				"html_id": "sample_rate_108"
			}
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
		// If screen hardware, add screen to config map
		if(screen){
			res.screen_control = {
				"read_index": 46,
				"write_index": 35,
				"descriptions": {
					"title": "Set Screen Control",
					"main_caption": "Selects the type of input or data that will be displayed on the screen."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 4,
					"generated": true
				},
				"options": {
					"0": "IO1",
					"1": "IO2",
					"2": "IO3",
					"3": "Accelerometer",
					"4": "Magnetometer"
				},
				"html_id": "screen_control_108"
			};
			res.screen_on_time = {
				"read_index": 47,
				"write_index": 36,
				"descriptions": {
					"title": "Set Screen On Time",
					"main_caption": "Set the duration, in seconds, that the screen will remain active after a sensor transmission. Once this time elapses, the screen will automatically turn off."
				},
				"default_value": 5,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"html_id": "screen_on_time_108"
			};
			res.interrupt_timeout =  {
				"read_index": 48,
				"write_index": 37,
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
			};
		} else { // No screen hw
			res.interrupt_timeout =  {
				"read_index": 46,
				"write_index": 35,
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
			};
		}
		return res;
	};

	const sync_parse = (rep_buffer) => {
		let response = {
			'human_readable': {},
			'machine_values': {}
		};

		// Evaluate the sensor Hardware ID
		if(rep_buffer[13] == 75){
			// If Screen Version
			screen = true;
		}

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
		if(frame[2] > 18){
			let reset_mode = "Disabled";
			switch(frame[38]){
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
			let acc_odr = "10 Hz";
			switch(frame[40]){
				case 0:
					acc_odr = "10 Hz";
					break;
				case 1:
					acc_odr = "20 Hz";
					break;
				case 2:
					acc_odr = "50 Hz";
					break;
				case 3:
					acc_odr = "100 Hz";
					break;
				case 4:
					acc_odr = "200 Hz";
					break;
				case 5:
					acc_odr = "400 Hz";
					break;
			}
			let rtc_sampling_interval = "5 sec";
			switch(frame[39]){
				case 0:
					rtc_sampling_interval = "1 min";
					break;
				case 1:
					rtc_sampling_interval = "5 min";
					break;
				case 2:
					rtc_sampling_interval = "15 min";
					break;
				case 3:
					rtc_sampling_interval = "30 min";
					break;
				case 4:
					rtc_sampling_interval = "1 hour";
					break;
				case 5:
					rtc_sampling_interval = "2 hours";
					break;
				case 6:
					rtc_sampling_interval = "3 hours";
					break;
				case 7:
					rtc_sampling_interval = "6 hours";
					break;
				case 8:
					rtc_sampling_interval = "12 hours";
					break;
				case 9:
					rtc_sampling_interval = "5 sec";
					break;
				case 10:
					rtc_sampling_interval = "10 sec";
					break;
				case 11:
					rtc_sampling_interval = "15 sec";
					break;
				case 12:
					rtc_sampling_interval = "30 sec";
					break;
			}
			let screen_control = 0;
			switch(frame[41]){
				case 0:
					screen_control = "IO1";
					break;
				case 1:
					screen_control = "IO2";
					break;
				case 2:
					screen_control = "IO3";
					break;
				case 3:
					screen_control = "Accelero";
					break;
				case 4:
					screen_control = "Magneto";
					break;
			}
			return {
				'firmware': frame[2],
				'accelerometer_threshold': (frame[16]* 32) + " mg",
				'debouncing_timeout': frame.slice(17, 19).reduce(msbLsb) + " msec",
				'accelero_state': frame[19]? "Enabled": "Disabled",
				'input_1_active_edge': frame[20]? "Rising": "Falling",
				'input_2_active_edge': frame[21]? "Rising": "Falling",
				'input_3_active_edge': frame[22]? "Rising": "Falling",
				'counter_threshold': frame.slice(23, 27).reduce(msbLsb),
				'transmit_on_change_status': frame[27]? "Enabled": "Disabled",
				'Shift_end_1': [
					String(frame[28]).padStart(2, '0'),
					String(frame[29]).padStart(2, '0')
				].join(':'),
				'Shift_end_2': [
					String(frame[30]).padStart(2, '0'),
					String(frame[31]).padStart(2, '0')
				].join(':'),
				'Shift_end_3': [
					String(frame[32]).padStart(2, '0'),
					String(frame[33]).padStart(2, '0')
				].join(':'),
				'Shift_end_4': [
					String(frame[34]).padStart(2, '0'),
					String(frame[35]).padStart(2, '0')
				].join(':'),
				'reset_timeout': frame.slice(36, 38).reduce(msbLsb) + " min",
				'counter_reset_mode': reset_mode,
				'sampling_interval': rtc_sampling_interval,
				'acc_odr': acc_odr,
				'screen_control': screen_control,
				'screen_on_time': frame[42] + ' sec',
				'interrupt_timeout': frame.slice(43, 45).reduce(msbLsb) + ' msec',
				'hardware_id': frame.slice(45, 48),
				'report_rate': frame.slice(48, 52).reduce(msbLsb) + " sec",
				'tx_life_counter': frame.slice(52, 56).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'accelerometer_threshold': frame[16],
					'debouncing_timeout': frame.slice(17, 19),
					'accelero_state': frame[19],
					'input_1_active_edge': frame[20],
					'input_2_active_edge': frame[21],
					'input_3_active_edge': frame[22],
					'counter_threshold': frame.slice(23, 27),
					'transmit_on_change_status': frame[27],
					'Shift_end_1': frame.slice(28, 30),
					'Shift_end_2': frame.slice(30, 32),
					'Shift_end_3': frame.slice(32, 34),
					'Shift_end_4': frame.slice(34, 36),
					'reset_timeout': frame.slice(36, 38),
					'counter_reset_mode': frame[38],
					'sampling_interval': frame[39],
					'acc_odr': frame[40],
					'screen_control': frame[41],
					'screen_on_time': frame[42],
					'interrupt_timeout': frame.slice(43, 45),
					'hardware_id': frame.slice(45, 48),
					'report_rate': frame.slice(48, 52),
					'tx_life_counter': frame.slice(52, 56)
				}
			}
		}else if(frame[2] > 13){
			let reset_mode = "Disabled";
			switch(frame[38]){
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
			let acc_odr = "10Hz";
			switch(frame[40]){
				case 0:
					acc_odr = "10Hz";
					break;
				case 1:
					acc_odr = "20Hz";
					break;
				case 2:
					acc_odr = "50Hz";
					break;
				case 3:
					acc_odr = "100Hz";
					break;
				case 4:
					acc_odr = "200Hz";
					break;
				case 5:
					acc_odr = "400Hz";
					break;
			}
			let rtc_sampling_interval = "5 seconds";
			switch(frame[39]){
				case 0:
					rtc_sampling_interval = "1 minute";
					break;
				case 1:
					rtc_sampling_interval = "5 minutes";
					break;
				case 2:
					rtc_sampling_interval = "15 minutes";
					break;
				case 3:
					rtc_sampling_interval = "30 minutes";
					break;
				case 4:
					rtc_sampling_interval = "1 hour";
					break;
				case 5:
					rtc_sampling_interval = "2 hours";
					break;
				case 6:
					rtc_sampling_interval = "3 hours";
					break;
				case 7:
					rtc_sampling_interval = "6 hours";
					break;
				case 8:
					rtc_sampling_interval = "12 hours";
					break;
				case 9:
					rtc_sampling_interval = "5 seconds";
					break;
				case 10:
					rtc_sampling_interval = "10 seconds";
					break;
				case 11:
					rtc_sampling_interval = "15 seconds";
					break;
				case 12:
					rtc_sampling_interval = "30 seconds";
					break;
			}
			return {
				'firmware': frame[2],
				'accelerometer_threshold': (frame[16]* 32) + "mg",
				'debouncing_timeout': frame.slice(17, 19).reduce(msbLsb) + "msec",
				'accelero_state': frame[19]? "Enabled": "Disabled",
				'input_1_active_edge': frame[20]? "Rising": "Falling",
				'input_2_active_edge': frame[21]? "Rising": "Falling",
				'input_3_active_edge': frame[22]? "Rising": "Falling",
				'counter_threshold': frame.slice(23, 27).reduce(msbLsb),
				'transmit_on_change_status': frame[27]? "Enabled": "Disabled",
				'Shift_end_1': [
					String(frame[28]).padStart(2, '0'),
					String(frame[29]).padStart(2, '0')
				].join(':'),
				'Shift_end_2': [
					String(frame[30]).padStart(2, '0'),
					String(frame[31]).padStart(2, '0')
				].join(':'),
				'Shift_end_3': [
					String(frame[32]).padStart(2, '0'),
					String(frame[33]).padStart(2, '0')
				].join(':'),
				'Shift_end_4': [
					String(frame[34]).padStart(2, '0'),
					String(frame[35]).padStart(2, '0')
				].join(':'),
				'reset_timeout': frame.slice(36, 38).reduce(msbLsb) + "min",
				'counter_reset_mode': reset_mode,
				'sampling_interval': rtc_sampling_interval,
				'acc_odr': acc_odr,
				'counter_ignore_timeout': frame.slice(41, 43).reduce(msbLsb) + "sec",
				'hardware_id': frame.slice(43, 46),
				'report_rate': frame.slice(46, 50).reduce(msbLsb) + "sec",
				'tx_life_counter': frame.slice(50, 54).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'accelerometer_threshold': frame[16],
					'debouncing_timeout': frame.slice(17, 19),
					'accelero_state': frame[19],
					'input_1_active_edge': frame[20],
					'input_2_active_edge': frame[21],
					'input_3_active_edge': frame[22],
					'counter_threshold': frame.slice(23, 27),
					'transmit_on_change_status': frame[27],
					'Shift_end_1': frame.slice(28, 30),
					'Shift_end_2': frame.slice(30, 32),
					'Shift_end_3': frame.slice(32, 34),
					'Shift_end_4': frame.slice(34, 36),
					'reset_timeout': frame.slice(36, 38),
					'counter_reset_mode': frame[38],
					'sampling_interval': frame[39],
					'acc_odr': frame[40],
					'counter_ignore_timeout': frame.slice(41, 43),
					'hardware_id': frame.slice(43, 46),
					'report_rate': frame.slice(46, 50),
					'tx_life_counter': frame.slice(50, 54)
				}
			}
		} else if(frame[2] > 9){
			let reset_mode = "Disabled";
			switch(frame[38]){
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
			let acc_odr = "10Hz";
			switch(frame[40]){
				case 0:
					acc_odr = "10Hz";
					break;
				case 1:
					acc_odr = "20Hz";
					break;
				case 2:
					acc_odr = "50Hz";
					break;
				case 3:
					acc_odr = "100Hz";
					break;
				case 4:
					acc_odr = "200Hz";
					break;
				case 5:
					acc_odr = "400Hz";
					break;
			}
			let rtc_sampling_interval = "5 seconds";
			switch(frame[39]){
				case 0:
					rtc_sampling_interval = "1 minute";
					break;
				case 1:
					rtc_sampling_interval = "5 minutes";
					break;
				case 2:
					rtc_sampling_interval = "15 minutes";
					break;
				case 3:
					rtc_sampling_interval = "30 minutes";
					break;
				case 4:
					rtc_sampling_interval = "1 hour";
					break;
				case 5:
					rtc_sampling_interval = "2 hours";
					break;
				case 6:
					rtc_sampling_interval = "3 hours";
					break;
				case 7:
					rtc_sampling_interval = "6 hours";
					break;
				case 8:
					rtc_sampling_interval = "12 hours";
					break;
				case 9:
					rtc_sampling_interval = "5 seconds";
					break;
				case 10:
					rtc_sampling_interval = "10 seconds";
					break;
				case 11:
					rtc_sampling_interval = "15 seconds";
					break;
				case 12:
					rtc_sampling_interval = "30 seconds";
					break;
			}
			return {
				'firmware': frame[2],
				'accelerometer_threshold': (frame[16]* 32) + "mg",
				'debouncing_timeout': frame.slice(17, 19).reduce(msbLsb) + "msec",
				'accelero_state': frame[19]? "Enabled": "Disabled",
				'input_1_active_edge': frame[20]? "Rising": "Falling",
				'input_2_active_edge': frame[21]? "Rising": "Falling",
				'input_3_active_edge': frame[22]? "Rising": "Falling",
				'counter_threshold': frame.slice(23, 27).reduce(msbLsb),
				'transmit_on_change_status': frame[27]? "Enabled": "Disabled",
				'Shift_end_1': [
					String(frame[28]).padStart(2, '0'),
					String(frame[29]).padStart(2, '0')
				].join(':'),
				'Shift_end_2': [
					String(frame[30]).padStart(2, '0'),
					String(frame[31]).padStart(2, '0')
				].join(':'),
				'Shift_end_3': [
					String(frame[32]).padStart(2, '0'),
					String(frame[33]).padStart(2, '0')
				].join(':'),
				'Shift_end_4': [
					String(frame[34]).padStart(2, '0'),
					String(frame[35]).padStart(2, '0')
				].join(':'),
				'reset_timeout': frame.slice(36, 38).reduce(msbLsb) + "min",
				'counter_reset_mode': reset_mode,
				'sampling_interval': rtc_sampling_interval,
				'acc_odr': acc_odr,
				'hardware_id': frame.slice(41, 44),
				'report_rate': frame.slice(44, 48).reduce(msbLsb) + "sec",
				'tx_life_counter': frame.slice(48, 52).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'accelerometer_threshold': frame[16],
					'debouncing_timeout': frame.slice(17, 19),
					'accelero_state': frame[19],
					'input_1_active_edge': frame[20],
					'input_2_active_edge': frame[21],
					'input_3_active_edge': frame[22],
					'counter_threshold': frame.slice(23, 27),
					'transmit_on_change_status': frame[27],
					'Shift_end_1': frame.slice(28, 30),
					'Shift_end_2': frame.slice(30, 32),
					'Shift_end_3': frame.slice(32, 34),
					'Shift_end_4': frame.slice(34, 36),
					'reset_timeout': frame.slice(36, 38),
					'counter_reset_mode': frame[38],
					'sampling_interval': frame[39],
					'acc_odr': frame[40],
					'hardware_id': frame.slice(41, 44),
					'report_rate': frame.slice(44, 48),
					'tx_life_counter': frame.slice(48, 52)
				}
			}
		} else if(frame[2] > 8){
			let reset_mode = "Disabled";
			switch(frame[37]){
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
			let acc_odr = "10Hz";
			switch(frame[39]){
				case 0:
					acc_odr = "10Hz";
					break;
				case 1:
					acc_odr = "20Hz";
					break;
				case 2:
					acc_odr = "50Hz";
					break;
				case 3:
					acc_odr = "100Hz";
					break;
				case 4:
					acc_odr = "200Hz";
					break;
				case 5:
					acc_odr = "400Hz";
					break;
			}
			let rtc_sampling_interval = "5 seconds";
			switch(frame[38]){
				case 0:
					rtc_sampling_interval = "1 minute";
					break;
				case 1:
					rtc_sampling_interval = "5 minutes";
					break;
				case 2:
					rtc_sampling_interval = "15 minutes";
					break;
				case 3:
					rtc_sampling_interval = "30 minutes";
					break;
				case 4:
					rtc_sampling_interval = "1 hour";
					break;
				case 5:
					rtc_sampling_interval = "2 hours";
					break;
				case 6:
					rtc_sampling_interval = "3 hours";
					break;
				case 7:
					rtc_sampling_interval = "6 hours";
					break;
				case 8:
					rtc_sampling_interval = "12 hours";
					break;
				case 9:
					rtc_sampling_interval = "5 seconds";
					break;
				case 10:
					rtc_sampling_interval = "10 seconds";
					break;
				case 11:
					rtc_sampling_interval = "15 seconds";
					break;
				case 12:
					rtc_sampling_interval = "30 seconds";
					break;
			}
			return {
				'firmware': frame[2],
				'accelerometer_threshold': (frame[16]* 32) + "mg",
				'debouncing_timeout': frame[17] + "msec",
				'accelero_state': frame[18]? "Enabled": "Disabled",
				'input_1_active_edge': frame[19]? "Rising": "Falling",
				'input_2_active_edge': frame[20]? "Rising": "Falling",
				'input_3_active_edge': frame[21]? "Rising": "Falling",
				'counter_threshold': frame.slice(22, 26).reduce(msbLsb),
				'transmit_on_change_status': frame[26]? "Enabled": "Disabled",
				'Shift_end_1': [
					String(frame[27]).padStart(2, '0'),
					String(frame[28]).padStart(2, '0')
				].join(':'),
				'Shift_end_2': [
					String(frame[29]).padStart(2, '0'),
					String(frame[30]).padStart(2, '0')
				].join(':'),
				'Shift_end_3': [
					String(frame[31]).padStart(2, '0'),
					String(frame[32]).padStart(2, '0')
				].join(':'),
				'Shift_end_4': [
					String(frame[33]).padStart(2, '0'),
					String(frame[34]).padStart(2, '0')
				].join(':'),
				'reset_timeout': frame.slice(35, 37).reduce(msbLsb) + "min",
				'counter_reset_mode': reset_mode,
				'sampling_interval': rtc_sampling_interval,
				'acc_odr': acc_odr,
				'hardware_id': frame.slice(40, 43),
				'report_rate': frame.slice(43, 47).reduce(msbLsb) + "sec",
				'tx_life_counter': frame.slice(47, 51).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'accelerometer_threshold': frame[16],
					'debouncing_timeout': frame[17],
					'accelero_state': frame[18],
					'input_1_active_edge': frame[19],
					'input_2_active_edge': frame[20],
					'input_3_active_edge': frame[21],
					'counter_threshold': frame.slice(22, 26),
					'transmit_on_change_status': frame[26],
					'Shift_end_1': frame.slice(27, 29),
					'Shift_end_2': frame.slice(29, 31),
					'Shift_end_3': frame.slice(31, 33),
					'Shift_end_4': frame.slice(33, 35),
					'reset_timeout': frame.slice(35, 37),
					'counter_reset_mode': frame[37],
					'sampling_interval': frame[38],
					'acc_odr': frame[39],
					'hardware_id': frame.slice(40, 43),
					'report_rate': frame.slice(43, 47),
					'tx_life_counter': frame.slice(47, 51)
				}
			}
		} else{
			return {
				'firmware': frame[2],
				'report_rate': frame.slice(12, 16).reduce(msbLsb).toString() + "sec.",
				'accelerometer_threshold': (frame[16]* 32) + "mg.",
				'debouncing_timeout': frame[17].toString() + "msec.",
				'accelero_state': frame[18],
				'digital_inputs_active_edge': frame.slice(19, 22).reduce(msbLsb),
				'counter_threshold': frame.slice(22, 26).reduce(msbLsb),
				'transmit_on_change_status': frame[26],
				'machine_values': {
					'firmware': frame[2],
					'report_rate': frame.slice(12, 16),
					'accelerometer_threshold': frame[16],
					'debouncing_timeout': frame[17],
					'accelero_active_state': frame[18],
					'digital_inputs_active_edge': frame.slice(19, 22),
					'counter_threshold': frame.slice(22, 26),
					'transmit_on_change_status': frame[26]
				}
			}
		}
	};

	const parse = (d, payload) => {
		let firmware = payload[1];
		// if((payload[7] & 2) != 0){
		// 	console.log('Error found');
		// 	// parsed.data = {error: 'Error found, Accelerometer Probe may be unattached'};
		// 	let error = {error: 'Error found, Accelerometer Probe may be unattached'};
		// 	return error;
		// }
		if(firmware > 4){
			let report_type = "Regular";
			switch(d[41]){
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
			let res = {
				digital_input_counter: d.slice(0, 4).reduce(msbLsb),
				digital_input_uptime: d.slice(4, 8).reduce(msbLsb),
				ct_input_counter: d.slice(8, 12).reduce(msbLsb),
				ct_input_uptime: d.slice(12, 16).reduce(msbLsb),
				opto_input_counter: d.slice(16, 20).reduce(msbLsb),
				opto_input_uptime: d.slice(20, 24).reduce(msbLsb),
				accelerometer_counter: d.slice(24, 28).reduce(msbLsb),
				accelerometer_uptime: d.slice(28, 32).reduce(msbLsb),
				magnetometer_counter: d.slice(32, 36).reduce(msbLsb),
				magnetometer_uptime: d.slice(36, 40).reduce(msbLsb),
				input_di: d[40] & 1 ? 1 : 0,
				input_ct: d[40] & 2 ? 1 : 0,
				input_opto: d[40] & 4 ? 1 : 0,
				input_acc: d[40] & 8 ? 1 : 0,
				input_mag: d[40] & 16 ? 1 : 0,
				report_type: report_type,
				rtc: [
					String(d[42]).padStart(2, '0'),
					String(d[43]).padStart(2, '0'),
					String(d[44]).padStart(2, '0')
				].join(':')
			};
			if((payload[7] & 2) != 0){
				res.error = {
					accelerometer_counter: "Error found, Accelerometer Probe may be unattached",
					accelerometer_uptime: "Error found, Accelerometer Probe may be unattached",
					input_acc: "Error found, Accelerometer Probe may be unattached"
				}
				// res.accelerometer_counter = "No probe detected";
				// res.accelerometer_uptime = "No probe detected";
				// res.input_acc = "No probe detected";
			};
			return res;
		}else{
			let res = {
				digital_input_counter: d.slice(0, 4).reduce(msbLsb),
				digital_input_uptime: d.slice(4, 8).reduce(msbLsb),
				ct_input_counter: d.slice(8, 12).reduce(msbLsb),
				ct_input_uptime: d.slice(12, 16).reduce(msbLsb),
				opto_input_counter: d.slice(16, 20).reduce(msbLsb),
				opto_input_uptime: d.slice(20, 24).reduce(msbLsb),
				accelerometer_counter: d.slice(24, 28).reduce(msbLsb),
				accelerometer_uptime: d.slice(28, 32).reduce(msbLsb),
				magnetometer_counter: d.slice(32, 36).reduce(msbLsb),
				magnetometer_uptime: d.slice(36, 40).reduce(msbLsb),
				input_di: d[40] & 1 ? 1 : 0,
				input_ct: d[40] & 2 ? 1 : 0,
				input_opto: d[40] & 4 ? 1 : 0,
				input_acc: d[40] & 8 ? 1 : 0,
				input_mag: d[40] & 16 ? 1 : 0
			};
			if((payload[7] & 2) != 0){
				res.error = {
					accelerometer_counter: "Error found, Accelerometer Probe may be unattached",
					accelerometer_uptime: "Error found, Accelerometer Probe may be unattached",
					input_acc: "Error found, Accelerometer Probe may be unattached"
				}
			};
			return res;
		}
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 108,
		name: 'Machine Uptime Monitoring Sensor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};