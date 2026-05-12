const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 33;
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
			"fsr": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set FSR",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 5,
					"generated": true
				},
				"options": {
					"0": "6.114",
					"1": "4.096",
					"2": "2.048",
					"3": "1.024",
					"4": "0.512",
					"5": "0.256"
				},
				"html_id": "fsr_420ma"
			},
			"boot_up_time": {
				"read_index": 26,
				"write_index": 27,
				"descriptions": {
					"title": "Sensor Boot Time",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "sensor_boot_time_420ma"
			},
			"adc_pin_reading": {
				"read_index": 27,
				"validator": {
					"type": "uint16be"
				},
				"tags": [
					"diagnostics"
				]
			},
			"auto_check_interval": {
				"read_index": 29,
				"write_index": 28,
				"descriptions": {
					"title": "Auto Check Interval",
					"main_caption": "To disable the auto check interval feature make this setting active and use a value of 0."
				},
				"default_value": 60,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				},
				"html_id": "auto_check_interval_88"
			},
			"auto_check_threshold": {
				"read_index": 31,
				"write_index": 30,
				"descriptions": {
					"title": "Auto Check Threshold",
					"main_caption": "This is a percent value. It will dictate a new transmission if the percentage change since last transmission exceeds the percentage set in this field."
				},
				"default_value": 20,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				},
				"html_id": "auto_check_threshold_88"
			},
			"always_on": {
				"read_index": 33,
				"write_index": 32,
				"descriptions": {
					"title": "Set Sensor Always On",
					"main_caption": "This command will keep the external power to the sensor always enabled."
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
				"html_id": "always_on_420ma"
			},
			"calibration_one": {
				"read_index": 34,
				"write_index": 15,
				"descriptions": {
					"title": "Low Calibration Point",
					"main_caption": ""
				},
				"default_value": 68805,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"html_id": "low_calibration_420ma"
			},
			"calibration_two": {
				"read_index": 38,
				"write_index": 19,
				"descriptions": {
					"title": "Mid Calibration Point",
					"main_caption": ""
				},
				"default_value": 68724,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"html_id": "mid_calibration_420ma"
			},
			"calibration_three": {
				"read_index": 42,
				"write_index": 23,
				"descriptions": {
					"title": "High Calibration Point",
					"main_caption": ""
				},
				"default_value": 68714,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"html_id": "high_calibration_420ma"
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
		let firmware = frame[2];
		if(firmware > 13){ // firmware 14 and above
			let frame_data = {};
			let auto_check_interval = frame.slice(20, 22).reduce(msbLsb);
			if(!auto_check_interval){
				frame_data.auto_check_interval = 'Disabled';
			}else{
				frame_data.auto_check_interval = auto_check_interval + " sec";
			}
			frame_data.always_on = frame[24]?"Enabled":"Disabled";
			switch(frame[16]){
				case 0:
					frame_data.fsr = "+-6.114 V";
				break;
				case 1:
					frame_data.fsr = "+-4.096 V";
				break;
				case 2:
					frame_data.fsr = "+-2.048 V";
				break;
				case 3:
					frame_data.fsr = "+-1.024 V";
				break;
				case 4:
					frame_data.fsr = "+-0.512 V";
				break;
				case 5:
					frame_data.fsr = "+-0.256 V";
				break;
			}
			return {
				'firmware': frame[2],
				'fsr': frame_data.fsr,
				'boot_up_time': frame[17] + " sec",
				'adc_pin_reading': frame.slice(18, 20).reduce(msbLsb),
				'auto_check_interval': frame_data.auto_check_interval,
				'auto_check_threshold': frame.slice(22, 24).reduce(msbLsb),
				'always_on': frame_data.always_on,
				'calibration_one': frame.slice(25, 29).reduce(msbLsb),
				'calibration_two':frame.slice(29, 33).reduce(msbLsb),
				'calibration_three':frame.slice(33, 37).reduce(msbLsb),
				'hardware_id': frame.slice(37, 40),
				'report_rate': frame.slice(40, 44).reduce(msbLsb) + " sec",
				'tx_life_counter': frame.slice(44, 48).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'fsr': frame[16],
					'boot_up_time': frame[17],
					'adc_pin_reading': frame.slice(18, 20),
					'auto_check_interval': frame.slice(20, 22),
					'auto_check_percentage': frame.slice(22, 24),
					'always_on': frame[24],
					'calibration_one': frame.slice(25, 29),
					'calibration_two':frame.slice(29, 33),
					'calibration_three':frame.slice(33, 37),
					'hardware_id': frame.slice(37, 40),
					'report_rate': frame.slice(40, 44),
					'tx_life_counter': frame.slice(44, 48)
				}
			}
		}
	};

	const parse = (d) => {
		var adc1 = signInt(d.slice(0, 2).reduce(msbLsb));
		var adc2 = signInt(d.slice(2, 4).reduce(msbLsb));
		var adc3 = signInt(d.slice(4, 6).reduce(msbLsb));
		var adc4 = signInt(d.slice(6, 8).reduce(msbLsb));
		var ma1 = (signInt(d.slice(8, 10).reduce(msbLsb)))/100.0;
		var ma2 = (signInt(d.slice(10, 12).reduce(msbLsb)))/100.0;
		var ma3 = (signInt(d.slice(12, 14).reduce(msbLsb)))/100.0;
		var ma4 = (signInt(d.slice(14, 16).reduce(msbLsb)))/100.0;
		return {
			adc1: adc1,
			adc2: adc2,
			adc3: adc3,
			adc4: adc4,
			ma1: ma1,
			ma2: ma2,
			ma3: ma3,
			ma4: ma4
		};
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 107,
		name: '16-Bit 4-Channel 4-20mA',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};