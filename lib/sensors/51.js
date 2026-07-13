const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices, emitter) => {

	const clear_globalDevices_stream = (deviceAddr, probe) => {
		if (Object.hasOwn(globalDevices, deviceAddr) && Object.hasOwn(globalDevices[deviceAddr], probe)){
			if (Object.hasOwn(globalDevices[deviceAddr][probe], 'packet_stream_timeout')) {
				clearTimeout(globalDevices[deviceAddr][probe].packet_stream_timeout);
			}
			delete globalDevices[deviceAddr][probe];
		}
	};

	const init_globalDevices_stream = (deviceAddr, payload, expected_packets, parsed, probe) => {
		let mode = (payload[7] >> 1) & 0x01;

		globalDevices[deviceAddr][probe] = {
			data: {},
			odr: payload[8],
			ct_const: payload.slice(13, 17).reduce(msbLsb),
			expected_packets: expected_packets
		};
		globalDevices[deviceAddr][probe].packet_stream_timeout = setTimeout(() => {
			// Calling sibling function directly
			parsed.sensor_data = concat_data(deviceAddr, mode, probe);
			parsed.sensor_data.error = 'Time Series Data Stream Timeout - incomplete data received';

			emitter.emit('sensor_data', parsed);
			emitter.emit('sensor_data-86', parsed);
			emitter.emit('sensor_data' + '-' + deviceAddr, parsed);
		}, 60000);
	};

	const concat_data = (deviceAddr, mode, probe) => {
		var raw_data = new Array();
		for (const packet in globalDevices[deviceAddr][probe].data) {
			raw_data = raw_data.concat(globalDevices[deviceAddr][probe].data[packet]);
		}
		var label = 0;
		var raw_time_series = [];
		var increment = 2;

		switch (globalDevices[deviceAddr][probe].odr) {
			case 0: odr_text = "400Hz"; break;
			case 1: odr_text = "800Hz"; break;
			case 2: odr_text = "2048Hz"; break;
		}

		for (var i = 0; i < raw_data.length; i += increment) {
			label++;
			raw_time_series.push(parseFloat((signInt(((raw_data[i] << 8) + (raw_data[i + 1])), 16)).toFixed(3)));
		}

		var concat_obj = {
			mode: 'raw',
			channel: probe,
			mac_address: deviceAddr,
			odr: odr_text,
			ct_const: globalDevices[deviceAddr][probe].ct_const,
			total_samples: label,
			confidence: ((Object.keys(globalDevices[deviceAddr][probe].data).length / globalDevices[deviceAddr][probe].expected_packets) * 100).toFixed(2) + '%',
			time_series: raw_time_series
		};
		return concat_obj;
	};

	const get_write_buffer_size = (firmware) => {
		return 60;
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
			"current_calibration_ch1": {
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
			"current_calibration_ch2": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Set Current Calibration Channel 2",
					"main_caption": "Specifies the internal multiplier used to calibrate the AC current readings. Adjust this constant to fine-tune the sensor's accuracy against a known, verified baseline measurement."
				},
				"default_value": 950,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"html_id": "ct_constant_ch2_86"
			},
			"current_calibration_ch3": {
				"read_index": 35,
				"write_index": 24,
				"descriptions": {
					"title": "Set Current Calibration Channel 3",
					"main_caption": "Specifies the internal multiplier used to calibrate the AC current readings. Adjust this constant to fine-tune the sensor's accuracy against a known, verified baseline measurement."
				},
				"default_value": 950,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"html_id": "ct_constant_ch3_86"
			},
			"current_calibration_ch4": {
				"read_index": 39,
				"write_index": 28,
				"descriptions": {
					"title": "Set Current Calibration Channel 4",
					"main_caption": "Specifies the internal multiplier used to calibrate the AC current readings. Adjust this constant to fine-tune the sensor's accuracy against a known, verified baseline measurement."
				},
				"default_value": 950,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"html_id": "ct_constant_ch4_51"
			},
			"current_calibration_ch5": {
				"read_index": 43,
				"write_index": 32,
				"descriptions": {
					"title": "Set Current Calibration Channel 5",
					"main_caption": "Specifies the internal multiplier used to calibrate the AC current readings. Adjust this constant to fine-tune the sensor's accuracy against a known, verified baseline measurement."
				},
				"default_value": 950,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"html_id": "ct_constant_ch5_51"
			},
			"current_calibration_ch6": {
				"read_index": 47,
				"write_index": 36,
				"descriptions": {
					"title": "Set Current Calibration Channel 6",
					"main_caption": "Specifies the internal multiplier used to calibrate the AC current readings. Adjust this constant to fine-tune the sensor's accuracy against a known, verified baseline measurement."
				},
				"default_value": 950,
				"validator": {
					"type": "uint32be",
					"min": 0,
					"max": 4294967295
				},
				"html_id": "ct_constant_ch6_51"
			},
			"deadband_ch1": {
				"read_index": 51,
				"write_index": 40,
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
				"converter": {
					"units": "mA"
				},
				"html_id": "deadband_87"
			},
			"deadband_ch2": {
				"read_index": 53,
				"write_index": 42,
				"descriptions": {
					"title": "Set Dead Band Channel 2",
					"main_caption": "Establishes a baseline noise filter. Any AC current reading below this threshold (in mA) is ignored and reported as 0"
				},
				"default_value": 100,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				},
				"converter": {
					"units": "mA"
				},
				"html_id": "deadband_ch2_86"
			},
			"deadband_ch3": {
				"read_index": 55,
				"write_index": 44,
				"descriptions": {
					"title": "Set Dead Band Channel 3",
					"main_caption": "Establishes a baseline noise filter. Any AC current reading below this threshold (in mA) is ignored and reported as 0"
				},
				"default_value": 100,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				},
				"converter": {
					"units": "mA"
				},
				"html_id": "deadband_ch3_86"
			},
			"deadband_ch4": {
				"read_index": 57,
				"write_index": 46,
				"descriptions": {
					"title": "Set Dead Band Channel 4",
					"main_caption": "Establishes a baseline noise filter. Any AC current reading below this threshold (in mA) is ignored and reported as 0"
				},
				"default_value": 100,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				},
				"converter": {
					"units": "mA"
				},
				"html_id": "deadband_ch4_51"
			},
			"deadband_ch5": {
				"read_index": 59,
				"write_index": 48,
				"descriptions": {
					"title": "Set Dead Band Channel 5",
					"main_caption": "Establishes a baseline noise filter. Any AC current reading below this threshold (in mA) is ignored and reported as 0"
				},
				"default_value": 100,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				},
				"converter": {
					"units": "mA"
				},
				"html_id": "deadband_ch5_51"
			},
			"deadband_ch6": {
				"read_index": 61,
				"write_index": 50,
				"descriptions": {
					"title": "Set Dead Band Channel 6",
					"main_caption": "Establishes a baseline noise filter. Any AC current reading below this threshold (in mA) is ignored and reported as 0"
				},
				"default_value": 100,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 65535
				},
				"converter": {
					"units": "mA"
				},
				"html_id": "deadband_ch6_51"
			},
			"sync_interval": {
				"read_index": 63,
				"write_index": 52,
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
				"converter": {
					"units": "seconds"
				},
				"html_id": "sync_interval_87"
			},
			"sync_timeout": {
				"read_index": 65,
				"write_index": 54,
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
				"converter": {
					"units": "seconds"
				},
				"html_id": "sync_timeout_87"
			},
			"auto_check_interval": {
				"read_index": 66,
				"write_index": 55,
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
				"read_index": 68,
				"write_index": 57,
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
				"read_index": 70,
				"write_index": 59,
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
				"converter": {
					"units": "seconds"
				},
				"html_id": "boot_up_time_87"
			},
			"ct_probe_range": {
				"read_index": 71,
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
				"converter": {
					"units": "Amp."
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

	const parse = (payload, parsed, mac) => {
		let firmware = payload[1];

		if(firmware > 6){
			let reserved = payload[7];
			let mode = ((reserved >> 1) & 0x01);
			mode = mode ? 'raw':'processed';
			
			if(mode == 'raw'){ // Time-domain
				const probe = ((reserved >> 2) & 0x07);
				var deviceAddr = mac;
				var expected_packets = msbLsb(payload[9], payload[10]);
				var current_packet = msbLsb(payload[11], payload[12]);
				var sdata_start = 17;

				if(!Object.hasOwn(globalDevices, deviceAddr)){
					globalDevices[deviceAddr] = {};
				}

				if (globalDevices[deviceAddr].hasOwnProperty(probe) || expected_packets == 1) {
					if (expected_packets != 1) {
						if (globalDevices[deviceAddr][probe].last_packet_counter == current_packet) {
							console.log('Duplicated message');
							return;
						}
						if (current_packet == 1 || (globalDevices[deviceAddr][probe].last_packet_counter > current_packet)) {
							console.log('Recovering bad packet');
							clear_globalDevices_stream(deviceAddr, probe);
							init_globalDevices_stream(deviceAddr, payload, expected_packets, parsed, probe);
							globalDevices[deviceAddr][probe].last_packet_counter = current_packet;
							globalDevices[deviceAddr][probe].data[current_packet] = payload.slice(sdata_start);
							return;
						}
						else {
							globalDevices[deviceAddr][probe].last_packet_counter = current_packet;
							globalDevices[deviceAddr][probe].data[current_packet] = payload.slice(sdata_start);
						}
					}
					else {
						clear_globalDevices_stream(deviceAddr, probe);
						init_globalDevices_stream(deviceAddr, payload, expected_packets, parsed, probe);
						globalDevices[deviceAddr][probe].last_packet_counter = current_packet;
						globalDevices[deviceAddr][probe].data[current_packet] = payload.slice(sdata_start);
					}
				}
				else {
					clear_globalDevices_stream(deviceAddr, probe);
					init_globalDevices_stream(deviceAddr, payload, expected_packets, parsed, probe);
					globalDevices[deviceAddr][probe].last_packet_counter = current_packet;
					globalDevices[deviceAddr][probe].data[current_packet] = payload.slice(sdata_start);
				}
				if (current_packet == expected_packets) {
					sensor_data = concat_data(deviceAddr, mode, probe);
					clear_globalDevices_stream(deviceAddr, probe);
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
					ct1_peak_3_freq: payload.slice(16, 18).reduce(msbLsb),
					ct2_rms: payload.slice(18, 22).reduce(msbLsb),
					ct2_peak_1_freq: payload.slice(22, 24).reduce(msbLsb),
					ct2_peak_2_freq: payload.slice(24, 26).reduce(msbLsb),
					ct2_peak_3_freq: payload.slice(26, 28).reduce(msbLsb),
					ct3_rms: payload.slice(28, 32).reduce(msbLsb),
					ct3_peak_1_freq: payload.slice(32, 34).reduce(msbLsb),
					ct3_peak_2_freq: payload.slice(34, 36).reduce(msbLsb),
					ct3_peak_3_freq: payload.slice(36, 38).reduce(msbLsb),
					ct4_rms: payload.slice(38, 42).reduce(msbLsb),
					ct4_peak_1_freq: payload.slice(42, 44).reduce(msbLsb),
					ct4_peak_2_freq: payload.slice(44, 46).reduce(msbLsb),
					ct4_peak_3_freq: payload.slice(46, 48).reduce(msbLsb),
					ct5_rms: payload.slice(48, 52).reduce(msbLsb),
					ct5_peak_1_freq: payload.slice(52, 54).reduce(msbLsb),
					ct5_peak_2_freq: payload.slice(54, 56).reduce(msbLsb),
					ct5_peak_3_freq: payload.slice(56, 58).reduce(msbLsb),
					ct6_rms: payload.slice(58, 62).reduce(msbLsb),
					ct6_peak_1_freq: payload.slice(62, 64).reduce(msbLsb),
					ct6_peak_2_freq: payload.slice(64, 66).reduce(msbLsb),
					ct6_peak_3_freq: payload.slice(66, 68).reduce(msbLsb)
				};
			}
		}else {
			return {
				ct1_rms: payload.slice(8, 12).reduce(msbLsb),
				ct1_peak_1_freq: payload.slice(12, 14).reduce(msbLsb),
				ct1_peak_2_freq: payload.slice(14, 16).reduce(msbLsb),
				ct1_peak_3_freq: payload.slice(16, 18).reduce(msbLsb),
				ct2_rms: payload.slice(18, 22).reduce(msbLsb),
				ct2_peak_1_freq: payload.slice(22, 24).reduce(msbLsb),
				ct2_peak_2_freq: payload.slice(24, 26).reduce(msbLsb),
				ct2_peak_3_freq: payload.slice(26, 28).reduce(msbLsb),
				ct3_rms: payload.slice(28, 32).reduce(msbLsb),
				ct3_peak_1_freq: payload.slice(32, 34).reduce(msbLsb),
				ct3_peak_2_freq: payload.slice(34, 36).reduce(msbLsb),
				ct3_peak_3_freq: payload.slice(36, 38).reduce(msbLsb),
				ct4_rms: payload.slice(38, 42).reduce(msbLsb),
				ct4_peak_1_freq: payload.slice(42, 44).reduce(msbLsb),
				ct4_peak_2_freq: payload.slice(44, 46).reduce(msbLsb),
				ct4_peak_3_freq: payload.slice(46, 48).reduce(msbLsb),
				ct5_rms: payload.slice(48, 52).reduce(msbLsb),
				ct5_peak_1_freq: payload.slice(52, 54).reduce(msbLsb),
				ct5_peak_2_freq: payload.slice(54, 56).reduce(msbLsb),
				ct5_peak_3_freq: payload.slice(56, 58).reduce(msbLsb),
				ct6_rms: payload.slice(58, 62).reduce(msbLsb),
				ct6_peak_1_freq: payload.slice(62, 64).reduce(msbLsb),
				ct6_peak_2_freq: payload.slice(64, 66).reduce(msbLsb),
				ct6_peak_3_freq: payload.slice(66, 68).reduce(msbLsb)
			};
		}
	};

	// --- 2. EXPORT THE MODULE ---
	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 51,
		name: '24-Bit 6-Channel Current Monitor',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse
	};
};