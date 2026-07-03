const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

	const clear_globalDevices_stream = (deviceAddr) => {
		if (Object.hasOwn(globalDevices, deviceAddr)) {
			if (Object.hasOwn(globalDevices[deviceAddr], 'packet_stream_timeout')) {
				clearTimeout(globalDevices[deviceAddr].packet_stream_timeout);
			}
			delete globalDevices[deviceAddr];
		}
	};

	const init_globalDevices_stream = (deviceAddr, payload, expected_packets, parsed) => {
		let mode = (payload[7] >> 1) & 0x01;

		globalDevices[deviceAddr] = {
			data: {},
			ct_const: payload.slice(12, 16).reduce(msbLsb),
			expected_packets: expected_packets
		};
		globalDevices[deviceAddr].packet_stream_timeout = setTimeout(() => {
			// Calling sibling function directly
			parsed.sensor_data = concat_data(deviceAddr, mode);
			parsed.sensor_data.error = 'Time Series Data Stream Timeout - incomplete data received';

			emitter.emit('sensor_data', parsed);
			emitter.emit('sensor_data-87', parsed);
			emitter.emit('sensor_data' + '-' + deviceAddr, parsed);
		}, 60000);
	};

	const concat_data = (deviceAddr, mode) => {
		var raw_data = new Array();
		for (const packet in globalDevices[deviceAddr].data) {
			raw_data = raw_data.concat(globalDevices[deviceAddr].data[packet]);
		}
		var label = 0;
		var raw_time_series = [];
		var increment = 2;

		for (var i = 0; i < raw_data.length; i += increment) {
			label++;
			raw_time_series.push(parseFloat((signInt(((raw_data[i] << 8) + (raw_data[i + 1])), 16)).toFixed(3)));
		}

		var concat_obj = {
			mode: 'raw',
			mac_address: deviceAddr,
			ct_const: globalDevices[deviceAddr].ct_const,
			total_samples: label,
			confidence: ((Object.keys(globalDevices[deviceAddr].data).length / globalDevices[deviceAddr].expected_packets) * 100).toFixed(2) + '%',
			time_series: raw_time_series
		};
		return concat_obj;
	};

	const get_write_buffer_size = (firmware) => {
		return 30;
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
			"sampling_rate": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Set Sampling Frequency",
					"main_caption": "Determines the data acquisition speed, defined as the number of samples taken per second (Hz) during an AC current measurement cycle. Higher rates provide more granular data for accurate peak and RMS calculations."
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 2,
					"generated": true
				},
				"options": {
					"0": "400Hz",
					"1": "800Hz",
					"2": "2048Hz"
				},
				"html_id": "sampling_frequency_87"
			},
			"max_time_domain_length": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Set Time Domain Length",
					"main_caption": "Defines the maximum payload size (in bytes) for a single Time-Domain data transmission."
				},
				"default_value": 3,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 3,
					"generated": true
				},
				"options": {
					"0": "55 Bytes",
					"1": "100 Bytes",
					"2": "150 Bytes",
					"3": "180 Bytes"
				},
				"html_id": "raw_length_87"
			},
			"current_calibration": {
				"read_index": 27,
				"write_index": 16,
				"descriptions": {
					"title": "Set Current Calibration",
					"main_caption": "Specifies the internal multiplier used to calibrate the AC current readings. Adjust this constant to fine-tune the sensor's accuracy against a known, verified baseline measurement."
				},
				"default_value": 950,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"html_id": "ct_constant_87"
			},
			"deadband": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Set Dead Band",
					"main_caption": "Establishes a baseline noise filter. Any AC current reading below this threshold (in mA) is ignored and reported as 0"
				},
				"default_value": 100,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				},
				"html_id": "deadband_87"
			},
			"sync_interval": {
				"read_index": 33,
				"write_index": 22,
				"descriptions": {
					"title": "Set Sync Interval",
					"main_caption": "Sets the interval (in minutes) for the sensor to broadcast a sync report. During this transmission, the device reports its current settings and temporarily enters into configuration sync mode to accept new settings."
				},
				"default_value": 3600,
				"validator": {
					"type": "uint16be",
					"min": 1,
					"max": 65535
				},
				"html_id": "sync_interval_87"
			},
			"sync_timeout": {
				"read_index": 35,
				"write_index": 24,
				"descriptions": {
					"title": "Set Sync Timeout",
					"main_caption": "Determines how long (in seconds) the configuration mode remains open following a sync transmission. If no new configuration command is received within this timeframe, the device resumes normal operation."
				},
				"default_value": 2,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255
				},
				"html_id": "sync_timeout_87"
			},
			"auto_check_interval": {
				"read_index": 36,
				"write_index": 25,
				"descriptions": {
					"title": "Set Auto Check Interval",
					"main_caption": "Defines how frequently (in seconds) the sensor wakes up specifically to compare the live AC current against your configured Auto Check Percentage. If the current meets the percentage change criteria, it triggers an immediate data transmission, overriding the standard reporting schedule."
				},
				"default_value": 0,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				},
				"html_id": "auto_check_interval_87"
			},
			"auto_check_percent": {
				"read_index": 38,
				"write_index": 27,
				"descriptions": {
					"title": "Set Auto Check Percentage",
					"main_caption": "Sets the sensitivity for event-based reporting. The sensor will trigger an immediate push transmission if the difference between the live AC current reading and the last transmitted reading meets or exceeds this percentage threshold."
				},
				"default_value": 10,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				},
				"html_id": "auto_check_percent_87"
			},
			"boot_up_time": {
				"read_index": 40,
				"write_index": 29,
				"descriptions": {
					"title": "Set Boot Up Time",
					"main_caption": "Specifies the hardware stabilization delay (in seconds). This is the required pause between the sensor waking from sleep mode and initiating its first AC current measurement to ensure stable readings."
				},
				"default_value": 6,
				"validator": {
					"type": "uint8",
					"min": 2,
					"max": 20
				},
				"html_id": "boot_up_time_87"
			},
			"ct_probe_range": {
				"read_index": 41,
				"descriptions": {
					"title": "",
					"main_caption": ""
				},
				"default_value": 0,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"read_only": true
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
			'sampling_rate': frame[16] + 'Hz',
			'current_calibration': (frame.slice(17, 21).reduce(msbLsb)) * 10,
			'deadband': frame.slice(21, 23).reduce(msbLsb) + 'mA',
			'max_supported_ct': frame.slice(23, 27).reduce(msbLsb),
			'hardware_id': frame.slice(27, 30),
			'report_rate': frame.slice(30, 34).reduce(msbLsb) + "sec",
			'tx_life_counter': frame.slice(34, 38).reduce(msbLsb),
			'machine_values': {
				'firmware': frame[2],
				'sampling_rate': frame[16],
				'current_calibration': frame.slice(17, 21),
				'deadband': frame.slice(21, 23),
				'max_supported_ct': frame.slice(23, 27),
				'hardware_id': frame.slice(27, 30),
				'report_rate': frame.slice(30, 34),
				'tx_life_counter': frame.slice(34, 38)
			}
		}
	};

	const parse = (payload, parsed, mac) => {
		let reserved = payload[7];
		let mode = ((reserved >> 1) & 0x01);
		mode = mode ? 'raw':'processed';
		
		if(mode == 'raw'){ // Time-domain
			// const channel = (reserved >> 2) & 0x07;
			var deviceAddr = mac;
			var expected_packets = msbLsb(payload[8], payload[9]);
			var current_packet = msbLsb(payload[10], payload[11]);
			var sdata_start = 14;

			if (globalDevices.hasOwnProperty(deviceAddr) || expected_packets == 1) {
				if (expected_packets != 1) {
					if (globalDevices[deviceAddr].last_packet_counter == current_packet) {
						console.log('Duplicated message');
						return;
					}
					if (current_packet == 1 || (globalDevices[deviceAddr].last_packet_counter > current_packet)) {
						console.log('Recovering bad packet');
						clear_globalDevices_stream(deviceAddr);
						init_globalDevices_stream(deviceAddr, payload, expected_packets, parsed);
						globalDevices[deviceAddr].last_packet_counter = current_packet;
						globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						return;
					}
					else {
						globalDevices[deviceAddr].last_packet_counter = current_packet;
						globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
					}
				}
				else {
					clear_globalDevices_stream(deviceAddr);
					init_globalDevices_stream(deviceAddr, payload, expected_packets, parsed);
					globalDevices[deviceAddr].last_packet_counter = current_packet;
					globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
				}
			}
			else {
				clear_globalDevices_stream(deviceAddr);
				init_globalDevices_stream(deviceAddr, payload, expected_packets, parsed);
				globalDevices[deviceAddr].last_packet_counter = current_packet;
				globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
			}
			if (current_packet == expected_packets) {
				sensor_data = concat_data(deviceAddr, mode);
				clear_globalDevices_stream(deviceAddr);
				return sensor_data;
			}
			else {
				return;
			}
		}else {
			return {
				mode: 'processed',
				ct1_rms: payload.slice(8, 12).reduce(msbLsb),
				ct1_peak_1_freq: payload.slice(12, 14).reduce(msbLsb),
				ct1_peak_2_freq: payload.slice(14, 16).reduce(msbLsb),
				ct1_peak_3_freq: payload.slice(16, 18).reduce(msbLsb)
			};
		}
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 87,
		name: 'Gen 4 One Channel Wireless Current Sensor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly
	};
};