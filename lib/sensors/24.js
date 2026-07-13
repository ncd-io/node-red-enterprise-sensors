const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const get_write_buffer_size = (firmware) => {
		return 25;
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
			"output_data_rate": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Data Rate",
					"main_caption": "This would determine how many samples the output data has."
				},
				"default_value": 5,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 7,
					"generated": true
				},
				"options": {
					"1": "1Hz",
					"2": "10Hz",
					"3": "25Hz",
					"4": "50Hz",
					"5": "100Hz",
					"6": "200Hz",
					"7": "400Hz"
				},
				"html_id": "impact_data_rate"
			},
			"motion_duration": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set Motion Duration",
					"main_caption": "Sets the minimum amount of time in milliseconds that motion/impact must continuously persist before triggering an alert. This filters out single, brief vibrations or random background noise from causing false alarms."
				},
				"default_value": 20,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535,
					"generated": true
				},
				"converter": {
					"units":"msec"
				},
				"html_id": "impact_duration"
			},
			"motion_trigger_logic": {
				"read_index": 28,
				"write_index": 17,
				"descriptions": {
					"title": "Set Motion Trigger Logic",
					"main_caption": "This setting determins how the sensor handles the X, Y, and Z axes to trigger an immediate sensor data transmission (motion). It allows you to choose whether a single axis or a combination of axes must cross your safety threshold before sending a Motion message."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1
				},
				"options": {
					"0": "OR Mode",
					"1": "AND Mode",
					"generated": true
				},
				"html_id": "interrupt_mode_24"
			},
			"motion_threshold": {
				"read_index": 29,
				"write_index": 18,
				"descriptions": {
					"title": "Set Motion Threshold",
					"main_caption": "Set a motion detection threshold in mg for the sensor to trigger a data transmission. This is an interrupt-based configuration."
				},
				"default_value": 200,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 23622,
					"generated": true
				},
				"converter": {
					"units":"mg"
				},
				"html_id": "impact_threshold"
			},
			"enable_axis_x": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Set Enable Axes",
					"main_caption": ""
				},
				"default_value": 1,
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
				"html_id": "enable_axis_x_24"
			},
			"enable_axis_y": {
				"read_index": 32,
				"write_index": 21,
				"descriptions": {
					"title": "Set Enable Axes",
					"main_caption": ""
				},
				"default_value": 1,
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
				"html_id": "enable_axis_y_24"
			},
			"enable_axis_z": {
				"read_index": 33,
				"write_index": 22,
				"descriptions": {
					"title": "Set Enable Axes",
					"main_caption": ""
				},
				"default_value": 1,
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
				"html_id": "enable_axis_z_24"
			},
			"full_scale_range": {
				"read_index": 34,
				"write_index": 23,
				"descriptions": {
					"title": "Set Full Scale Range",
					"main_caption": "Set how large of a range the device can measure acceleration in."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 3,
					"generated": true
				},
				"options": {
					"0": "±2g",
					"1": "±4g",
					"2": "±8g",
					"3": "±16g"
				},
				"html_id": "impact_accel"
			},
			"max_motion_tx_per_interval": {
				"read_index": 35,
				"write_index": 24,
				"descriptions": {
					"title": "Set Max Motion Tx Per Interval",
					"main_caption": "Set Number of times device will transmit a motion data message due to motion triggers per interval."
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 30,
					"generated": true
				},
				"html_id": "max_tx_per_interval_24"
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
		let firmware = payload[1];
		if(firmware > 5){
			let reserved = payload[7];
			let status = ((reserved >> 1) & 0x01);
			let msg_type = ((reserved >> 1) & 0x02);
			status = status?'invalid':'valid';
			msg_type = msg_type?'motion':'regular';
			return {
				status: status,
				msg_type: msg_type,
				acc_x: signInt(payload.slice(8, 10).reduce(msbLsb), 16),
				acc_y: signInt(payload.slice(10, 12).reduce(msbLsb), 16),
				acc_z: signInt(payload.slice(12, 14).reduce(msbLsb), 16)
			};
		}else{
			return {
				acc_x: signInt(payload.slice(8, 10).reduce(msbLsb), 16),
				acc_y: signInt(payload.slice(10, 12).reduce(msbLsb), 16),
				acc_z: signInt(payload.slice(12, 14).reduce(msbLsb), 16),
				temp_change: signInt((payload).slice(14, 16).reduce(msbLsb), 16)
			};
		}
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 24,
		name: 'Activity Detection',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse
	};
};