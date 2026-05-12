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
			"flow_unit": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set Flow Unit",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 24,
					"generated": true
				},
				"options": {
					"0": "scf_m",
					"1": "scf_h",
					"2": "nm3_h",
					"3": "nm3_m",
					"4": "kg_h",
					"5": "kg_m",
					"6": "kg_s",
					"7": "lbs_h",
					"8": "lbs_m",
					"9": "lbs_s",
					"10": "nlp_h",
					"11": "nlp_m",
					"12": "mmscf_d",
					"13": "lbs_d",
					"14": "slp_m",
					"15": "nlp_s",
					"16": "mscf_d",
					"17": "sm3_h",
					"18": "mt_h",
					"19": "nm3_d",
					"20": "mmscf_m",
					"21": "scf_d",
					"22": "mcf_d",
					"23": "sm3_m",
					"24": "sm3_d"
				},
				"html_id": "flow_unit_545"
			},
			"temperature_unit": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set Temperature Unit",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "Fahrenheit",
					"1": "Celsius"
				},
				"html_id": "temperature_unit_545"
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
			// response.auto_raw_destination_address = "0000ffff";
		};
		return response;
	};

	const parse_fly = (frame) => {
		let frame_data = {};
		switch(frame[12]){
			case 0:
				frame_data.flow_unit = 'scf_m';
				break;
			case 1:
				frame_data.flow_unit = 'scf_h';
				break;
			case 2:
				frame_data.flow_unit = 'nm3_h';
				break;
			case 3:
				frame_data.flow_unit = 'nm3_m';
				break;
			case 4:
				frame_data.flow_unit = 'kg_h';
				break;
			case 5:
				frame_data.flow_unit = 'kg_m';
				break;
			case 6:
				frame_data.flow_unit = 'kg_s';
				break;
			case 7:
				frame_data.flow_unit = 'lbs_h';
				break;
			case 8:
				frame_data.flow_unit = 'lbs_m';
				break;
			case 9:
				frame_data.flow_unit = 'lbs_s';
				break;
			case 10:
				frame_data.flow_unit = 'nlp_h';
				break;
			case 11:
				frame_data.flow_unit = 'nlp_m';
				break;
			case 12:
				frame_data.flow_unit = 'mmscf_d';
				break;
			case 13:
				frame_data.flow_unit = 'lbs_d';
				break;
			case 14:
				frame_data.flow_unit = 'slp_m';
				break;
			case 15:
				frame_data.flow_unit = 'nlp_s';
				break;
			case 16:
				frame_data.flow_unit = 'mscf_d';
				break;
			case 17:
				frame_data.flow_unit = 'sm3_h';
				break;
			case 18:
				frame_data.flow_unit = 'mt_h';
				break;
			case 19:
				frame_data.flow_unit = 'nm3_d';
				break;
			case 20:
				frame_data.flow_unit = 'mmscf_m';
				break;
			case 21:
				frame_data.flow_unit = 'scf_d';
				break;
			case 22:
				frame_data.flow_unit = 'mcf_d';
				break;
			case 23:
				frame_data.flow_unit = 'sm3_m';
				break;
			case 24:
				frame_data.flow_unit = 'sm3_d';
				break;
		}
		switch(frame[13]){
			case 0:
				frame_data.temperature_unit = 'F';
				break;
			case 1:
				frame_data.temperature_unit = 'C';
				break;
		}
		return {
			'firmware': frame[2],
			'flow_unit': frame_data.flow_unit,
			'temperature_unit': frame_data.temperature_unit,
			'hardware_id': frame.slice(14, 17),
			'report_rate': frame.slice(17, 21).reduce(msbLsb),
			'tx_life_counter': frame.slice(21, 25).reduce(msbLsb),
			'machine_values': {
				'firmware': frame[2],
				'flow_unit': frame[12],
				'temperature_unit': frame[13],
				'hardware_id': frame.slice(14, 17),
				'report_rate': frame.slice(17, 21),
				'tx_life_counter': frame.slice(21, 25)
			}
		}
	}

	const parse = (payload, parsed, mac) => {
		let firmware = payload[1];
		let sensor_status = '';
		const error_message = [];
		if(payload[8] & 1){
			error_message.push('pwr_up');
		}
		if(payload[8] & 2){
			error_message.push('flw_hi_lim');
		}
		if(payload[8] & 4){
			error_message.push('flw_lo_lim');
		}
		if(payload[8] & 8){
			error_message.push('tmp_hi_lim');
		}
		if(payload[8] & 16){
			error_message.push('tmp_lo_lim');
		}
		if(payload[8] & 32){
			error_message.push('sensor_oor');
		}
		if(payload[8] & 64){
			error_message.push('gas_mix_err');
		}
		if(payload[8] & 128){
			error_message.push('inc_set');
		}
		if(error_message.length === 0){
			sensor_status = 'ready';
		} else {
			sensor_status = error_message.join(', ');
		}

		const calv_value = payload.slice(9, 11).reduce(msbLsb) / 100;
		let cal_val = '';
		if(calv_value < 0.80){ 
			cal_val = 'pass';
		} else if(calv_value <= 1.0){ 
			cal_val = 'warning';
		} else { 
			cal_val = 'fail';
		}
		
		if(firmware > 1){
			let read_status = payload[7] >> 1;
			let sensor_read_status = '';
			switch (read_status){
				case 0: sensor_read_status = 'valid_data'; break;
				case 2: sensor_read_status = 'invalid_data'; break;
			}
			return{
				sensor_read: sensor_read_status,
				sensor_status: sensor_status,
				calcv_value: payload.slice(9, 11).reduce(msbLsb) / 100,
				calcv_status: cal_val,
				flow: payload.slice(11, 15).reduce(msbLsb)/100,
				ghv: payload.slice(15, 19).reduce(msbLsb)/100,
				total_flow: payload.slice(19, 27).reduce(msbLsb)/100,
				temperature: payload.slice(27,29).reduce(msbLsb)/100,
				density: payload.slice(29, 31).reduce(msbLsb)/100,
				sensor_fw_ver: payload.slice(31, 33).reduce(msbLsb)/10,
				model_status: payload.slice(33, 34).reduce(msbLsb),
				calib_valid_res: payload.slice(35, 39).reduce(msbLsb)/100,
				meter_serial_num: payload.slice(39, 43)
			};
		} else {
			return{
				sensor_status: sensor_status,
				calcv_value: payload.slice(9, 11).reduce(msbLsb) / 100,
				calcv_status: cal_val,
				flow: payload.slice(11, 15).reduce(msbLsb)/100,
				ghv: payload.slice(15, 19).reduce(msbLsb)/100,
				total_flow: payload.slice(19, 27).reduce(msbLsb)/100,
				temperature: payload.slice(27,29).reduce(msbLsb)/100,
				density: payload.slice(29, 31).reduce(msbLsb)/100
			};
		}
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 545,
		name: 'Fox Thermal Flow Sensor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};