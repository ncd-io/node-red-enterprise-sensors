const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 36;
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
					"title": "Tx Lifetime Counter",
					"main_caption": "Total number of transmissions the node has made since it was manufactured."
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
				"default_value": 1800,
				"validator": {
					"type": "uint32be"
				},
				"converter":{
					"units": " seconds"
				},
				"html_id": "delay"
			},
			"adc_pin_reading": {
				"read_index": 25,
				"validator": {
					"type": "uint16be"
				},
				"tags": [
					"diagnostics"
				]
			},
			"fsr": {
				"read_index": 27,
				"write_index": 14,
				"descriptions": {
					"title": "Set FSR",
					"main_caption": ""
				},
				"default_value": 3,
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
			"calibration_one": {
				"read_index": 28,
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
				"read_index": 32,
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
				"read_index": 36,
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
			},
			"boot_up_time": {
				"read_index": 40,
				"write_index": 27,
				"descriptions": {
					"title": "Sensor Boot Time",
					"main_caption": ""
				},
				"default_value": 8,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 255
				},
				"converter":{
					"units": " seconds"
				},
				"html_id": "sensor_boot_time_420ma"
			},
			"friction_noise_level": {
				"read_index": 41,
				"write_index": 28,
				"descriptions": {
					"title": "Set Friction Noise Level",
					"main_caption": "At or above this level, and below the faulty level, the dispenser is run."
				},
				"default_value": 35,
				"validator": {
					"type": "uint16le",
					"min": 1,
					"max": 254
				},
				"converter":{
					"units": " dB"
				},
				"html_id": "friction_level_105"
			},
			"faulty_noise_level": {
				"read_index": 43,
				"write_index": 30,
				"descriptions": {
					"title": "Set Faulty Noise Level",
					"main_caption": "At or above this level the machine is treated as faulty and is not lubricated."
				},
				"default_value": 45,
				"validator": {
					"type": "uint16le",
					"min": 2,
					"max": 255
				},
				"converter":{
					"units": " dB"
				},
				"html_id": "faulty_level_105"
			},
			"max_lube_attempts": {
				"read_index": 45,
				"write_index": 32,
				"descriptions": {
					"title": "Max Lube Attempts",
					"main_caption": "How many times in a row the dispenser will run before the machine is treated as faulty, if the noise level is not coming down."
				},
				"default_value": 3,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 10
				},
				"html_id": "max_lube_attempts_105"
			},
			"lube_1_on_time": {
				"read_index": 46,
				"write_index": 33,
				"descriptions": {
					"title": "Lube On Time 1",
					"main_caption": "Seconds the dispenser is powered for each lubrication cycle. One discharge happens per cycle regardless of this value, it only has to be long enough for the dispenser to complete its stroke."
				},
				"default_value": 10,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 255
				},
				"converter":{
					"units": " seconds"
				},
				"html_id": "lube_on_time_1_105"
			},
			"lube_1_total_cycles": {
				"read_index": 47,
				"descriptions": {
					"title": "Lube Total Cycles 1",
					"main_caption": "Lifetime total of lubrication cycles run by dispenser 1 since the counter was last reset. Compare against the impulses-per-LC figures in the dispenser manual to predict a cartridge running empty."
				},
				"default_value": 0,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				}
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
				case 'uint16le':
					response.machine_values[key] = rep_buffer.readUInt16LE(idx);
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

	const parse = (payload, parsed, mac) => {

		const MSG_TYPE_REPORT = 0x01;
		const MSG_TYPE_LUBE_REPORT = 0x02;

		let status = '';
		let out = {};
		let p = payload.slice(8);
		let status_byte =payload[7] >> 1;
		let msg_type = payload[8];
		
		if (msg_type === MSG_TYPE_LUBE_REPORT) {
			status = 'cycle_completed';
			if((status_byte & 0x01) !== 0) status = 'dispenser_fault';
			//if((status_byte & 0x02) !== 0) status = 'dispenser_2_fault';
			// if((app === 0x03)) status = 'dispenser_1_and_2_fault';

			let pins = p[4];
			let pin_0 = (pins & 0x01) !== 0;
			let pin_1 = (pins & 0x02) !== 0;
		
			let decode_dispenser_pins = {};

			if (pin_0 && !pin_1) {
				decode_dispenser_pins = { pin_0, pin_1, ok: true, state: 'ok', description: 'Healthy' };
			} else if (pin_0 && pin_1) {
				decode_dispenser_pins = { pin_0, pin_1, ok: false, state: 'lc_empty', description: 'Lubricant container empty' };
			} else if (!pin_0 && !pin_1) {
				decode_dispenser_pins = { pin_0, pin_1, ok: false, state: 'error', description: 'Both status lines low' };
			} else {
				decode_dispenser_pins = { pin_0, pin_1, ok: false, state: 'error', description: 'Unexpected status line combination' };
			}
			out = {
				status: status,
				msg_type: 'lube_status',
				lube_cycles_this_burst: p[1],
				lube_total_cycles: p.slice(2, 4).reduce(msbLsb),
				dispenser_status: decode_dispenser_pins
			};
		} else if (msg_type === MSG_TYPE_REPORT) {
			status = 'data_valid';
			if((status_byte & 0x01) !== 0) status = 'data_invalid';
			let noise_byte = p[7];
			let channel = 0; // Single channel app

			const bits = (noise_byte >>> (channel * 3)) & 0x07;
			const friction = (bits & 0x01) !== 0;
			const faulty = (bits & 0x02) !== 0;
			const out_of_tries = (bits & 0x04) !== 0;

			let lubrication = {
				friction,
				faulty,
				out_of_tries,
				state: faulty ? 'faulty'
					: out_of_tries ? 'out_of_tries'
					: friction ? 'friction'
					: 'normal'
			};
			out = {
				status: status,
				msg_type: 'sensor_data',
				raw_adc: p.slice(1, 3).reduce(msbLsb),
				ma: p.slice(3, 5).reduce(msbLsb) / 100,
				db: p.slice(5, 7).reduce(msbLsb),
				lubrication: lubrication.state,
				lube_total_cycles: p.slice(8, 10).reduce(msbLsb)
			};
		}
		return out;
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties
	// that need to be called from outside the scrip
	return {
		type: 105,
		name: '1 Channel Automatic Luber With Ultrasound Vibration Sensor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};