const { toMac, signInt, msbLsb } = require('../utils');

module.exports = (globalDevices, emitter) => {

	const clear_globalDevices_stream = (deviceAddr) => {
		if (Object.hasOwn(globalDevices, deviceAddr)) {
			if (Object.hasOwn(globalDevices[deviceAddr], 'packet_stream_timeout')) {
				clearTimeout(globalDevices[deviceAddr].packet_stream_timeout);
			}
			delete globalDevices[deviceAddr];
		}
	};

	const init_globalDevices_stream = (deviceAddr, payload, expected_packets, parsed, msg_type) => {
		globalDevices[deviceAddr] = {
			data: {},
			odr: msbLsb(payload[9], payload[10]),
			mo: payload[8],
			fsr: payload[11] >> 5,
			hour: payload[12],
			minute: payload[13],
			temperature: msbLsb(payload[14], payload[15]) / 100,
			expected_packets: expected_packets
		};
		globalDevices[deviceAddr].packet_stream_timeout = setTimeout(() => {
			// Calling sibling function directly
			parsed.sensor_data = concat_fft_data(deviceAddr, payload[8], msg_type);
			parsed.sensor_data.error = 'Time Series Data Stream Timeout - incomplete data received';

			console.log('&&&&&&&&&&&&&&&&&&&&&&&&&&');
			console.log('&&&&&&&&&&&&&&&&&&&&&&&&&&');
			console.log('&&&&&&&&&&&&&&&&&&&&&&&&&&');

			emitter.emit('sensor_data', parsed);
			emitter.emit('sensor_data-114', parsed);
			emitter.emit('sensor_data' + '-' + deviceAddr, parsed);
		}, 6000);
	};

	const concat_fft_data = (deviceAddr, mode, msg_type) => {
		var raw_data = new Array();
		for (const packet in globalDevices[deviceAddr].data) {
			raw_data = raw_data.concat(globalDevices[deviceAddr].data[packet]);
		}
		var label = 0;
		var fft_concat = { x: [], y: [], z: [] };

		var en_axis_data = {};
		en_axis_data.x_offset = 0;
		en_axis_data.y_offset = 2;
		en_axis_data.z_offset = 4;
		en_axis_data.increment = 6;

		var fsr_mult = .00006;
		var fsr_text = "";

		switch (globalDevices[deviceAddr].fsr) {
			case 0: fsr_mult = 0.00006; break;
			case 1: fsr_mult = 0.00012; break;
			case 2: fsr_mult = 0.00024; break;
			case 3: fsr_mult = 0.00049; break;
		}
		switch (globalDevices[deviceAddr].fsr) {
			case 0: fsr_text = "2g"; break;
			case 1: fsr_text = "4g"; break;
			case 2: fsr_text = "8g"; break;
			case 3: fsr_text = "16g"; break;
		}

		for (var i = 0; i < raw_data.length; i += en_axis_data.increment) {
			label++;
			if ('x_offset' in en_axis_data) {
				fft_concat.x.push(parseFloat((signInt(((raw_data[i + en_axis_data.x_offset] << 8) + (raw_data[i + en_axis_data.x_offset + 1])), 16) * fsr_mult).toFixed(3)));
			}
			if ('y_offset' in en_axis_data) {
				fft_concat.y.push(parseFloat((signInt(((raw_data[i + en_axis_data.y_offset] << 8) + (raw_data[i + en_axis_data.y_offset + 1])), 16) * fsr_mult).toFixed(3)));
			}
			if ('z_offset' in en_axis_data) {
				fft_concat.z.push(parseFloat((signInt(((raw_data[i + en_axis_data.z_offset] << 8) + (raw_data[i + en_axis_data.z_offset + 1])), 16) * fsr_mult).toFixed(3)));
			}
		}
		var fft_concat_obj = {
			mode: mode,
			msg_type: msg_type,
			time_id: [
				String(globalDevices[deviceAddr].hour).padStart(2, '0'),
				String(globalDevices[deviceAddr].minute).padStart(2, '0'),
			].join(':'),
			mac_address: deviceAddr,
			fsr: fsr_text,
			odr: globalDevices[deviceAddr].odr,
			temperature: globalDevices[deviceAddr].temperature,
			total_samples: label,
			fft_confidence: ((Object.keys(globalDevices[deviceAddr].data).length / globalDevices[deviceAddr].expected_packets) * 100).toFixed(2) + '%',
			data: fft_concat
		};
		return fft_concat_obj;
	};
	const get_write_buffer_size = (firmware) => {
		return 41;
	}
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
					"Communications"
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
					"Communications"
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
				],
				"tags": [
					"Communications"
				]
			},
			"odr": {
				"read_index": 21,
				"write_index": 10,
				"descriptions": {
					"title": "Probe 1: Output Data Rate",
					"main_caption": "<p>This would determine how many samples the output data has...</p>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 7,
					"max": 15,
					"generated": true
				},
				"options": {
					"7": "100Hz",
					"8": "200Hz",
					"9": "400Hz",
					"10": "800Hz",
					"11": "1600Hz",
					"12": "3200Hz",
					"13": "6400Hz",
					"14": "12800Hz",
					"15": "25600Hz"
				},
				"tags": [
					"Vibration Sampling"
				],
				"html_id": "odr_p1_110"
			},
			"sampling_duration": {
				"read_index": 22,
				"write_index": 11,
				"descriptions": {
					"title": "Probe 1: Sampling Duration",
					"main_caption": "<p>Set the amount of time which the samples are taken...</p>"
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 100,
					"generated": true
				},
				"tags": [
					"Vibration Sampling"
				],
				"html_id": "sampling_duration_p1_110"
			},
			"lpf_coefficient": {
				"read_index": 23,
				"write_index": 12,
				"descriptions": {
					"title": "Probe 1: Set Low Pass Filter",
					"main_caption": "<p>This setting will set the LPF freq to ODR divided by Selected Value...</p>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 9,
					"generated": true
				},
				"options": {
					"0": "4",
					"1": "8",
					"2": "16",
					"3": "32",
					"4": "64",
					"5": "128",
					"6": "256",
					"7": "512",
					"8": "1024",
					"9": "2048"
				},
				"html_id": "low_pass_filter_p1_110"
			},
			"hpf_coefficient": {
				"read_index": 24,
				"write_index": 13,
				"descriptions": {
					"title": "Probe 1: Set High Pass Filter",
					"main_caption": "<p>This setting will set the HPF freq to ODR divided by Selected Value...</p>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 9,
					"generated": true
				},
				"options": {
					"0": "4",
					"1": "8",
					"2": "16",
					"3": "32",
					"4": "64",
					"5": "128",
					"6": "256",
					"7": "512",
					"8": "1024",
					"9": "2048"
				},
				"html_id": "high_pass_filter_p1_110"
			},
			"full_scale_range": {
				"read_index": 25,
				"write_index": 14,
				"descriptions": {
					"title": "Full Scale Range",
					"main_caption": "<p>Set how large of a range the device can measure acceleration in.</p>"
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 5,
					"generated": true
				},
				"options": {
					"0": "+/- 2g",
					"1": "+/- 4g",
					"2": "+/- 8g",
					"3": "+/- 16g",
					"4": "+/- 32g",
					"5": "+/- 64g"
				},
				"tags": [
					"Vibration Sampling"
				],
				"html_id": "full_scale_range_101"
			},
			"axes_enabled": {
				"read_index": 26,
				"write_index": 15,
				"descriptions": {
					"title": "Axes Enabled",
					"main_caption": "New Command"
				},
				"validator": {
					"type": "uint8"
				},
				"read_only": true,
			},
			"sampling_interval": {
				"read_index": 27,
				"write_index": 16,
				"descriptions": {
					"title": "Sampling Interval",
					"main_caption": "<p>Set how often will the sensor transmit measurement data.</p>"
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 8,
					"generated": true
				},
				"options": {
					"0": "5 Minutes",
					"1": "10 Minutes",
					"2": "15 Minutes",
					"3": "20 Minutes",
					"4": "30 Minutes",
					"5": "60 Minutes",
					"6": "120 Minutes",
					"7": "180 Minutes",
					"8": "1 Minute"
				},
				"tags": [
					"Communications"
				],
				"html_id": "sampling_interval_110"
			},
			"filter_status": {
				"read_index": 28,
				"write_index": 17,
				"descriptions": {
					"title": "Set Filtering",
					"main_caption": "<p>Enable/Disable built-in filters</p>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "Enabled",
					"1": "Disabled"
				},
				"html_id": "enable_filtering_110"
			},
			"operation_mode": {
				"read_index": 29,
				"write_index": 18,
				"descriptions": {
					"title": "Mode",
					"main_caption": "<p>• <strong>Processed:</strong> FFT is performed...</p>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 3,
					"generated": true
				},
				"options": {
					"0": "Processed",
					"1": "Raw",
					"2": "Processed + Raw on demand",
					"3": "Smart"
				},
				"html_id": "mode_110"
			},
			"measurement_mode": {
				"read_index": 30,
				"write_index": 19,
				"descriptions": {
					"title": "Measurement Mode",
					"main_caption": "Changing this value does not do anything. Only give one option."
				},
				"validator": {
					"type": "uint8"
				},
				"read_only": true
			},
			"on_request_timeout": {
				"read_index": 31,
				"write_index": 20,
				"descriptions": {
					"title": "Set On Request Timeout",
					"main_caption": "<p>Set how long device will stay awake...</p>"
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 10,
					"generated": true
				},
				"depends_on": {
					"operation_mode": [
						2,
						3
					]
				},
				"html_id": "on_request_timeout_80"
			},
			"deadband": {
				"read_index": 32,
				"write_index": 21,
				"descriptions": {
					"title": "Set Dead Band in mg",
					"main_caption": "<p>Filters out acceleration values below the dead band threshold...</p>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"html_id": "deadband_80"
			},
			"motion_detection_threshold": {
				"read_index": 33,
				"write_index": 22,
				"descriptions": {
					"title": "Probe 1: Set Acceleration Wake/Interrupt Threshold",
					"main_caption": "<div><p>Set a breakpoint for sensor to wake up...</p></div>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 40,
					"generated": true
				},
				"html_id": "motion_detect_threshold_p1_110"
			},
			"led_acceleration_alert_threshold": {
				"read_index": 34,
				"write_index": 23,
				"descriptions": {
					"title": "LED Accelerometer Threshold",
					"main_caption": "<div><p>Set the minimum acceleration value...</p></div>"
				},
				"default_value": 10,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"depends_on": {
					"led_alert_mode": 0
				},
				"html_id": "led_accelerometer_threshold_84"
			},
			"led_velocity_alert_threshold": {
				"read_index": 35,
				"write_index": 24,
				"descriptions": {
					"title": "LED Velocity Threshold",
					"main_caption": "<div><p>Set the minimum velocity value...</p></div>"
				},
				"default_value": 10,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"depends_on": {
					"led_alert_mode": 1
				},
				"html_id": "led_velocity_threshold_84"
			},
			"smart_accelerometer_threshold": {
				"read_index": 36,
				"write_index": 25,
				"descriptions": {
					"title": "Probe 1: Set Smart Mode Threshold",
					"main_caption": "<p>If RMS acceleration is above this in any axis...</p>"
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 40
				},
				"depends_on": {
					"operation_mode": 3
				},
				"html_id": "smart_threshold_110"
			},
			"led_alert_mode": {
				"read_index": 37,
				"write_index": 26,
				"descriptions": {
					"title": "LED Alert Mode",
					"main_caption": "<p>Choose whether the LED indicator should be based on Acceleration or Velocity</p>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 1,
					"generated": true
				},
				"options": {
					"0": "Acceleration",
					"1": "Velocity"
				},
				"html_id": "led_alert_mode_84"
			},
			"raw_packet_length": {
				"read_index": 38,
				"write_index": 27,
				"descriptions": {
					"title": "Payload Length",
					"main_caption": "<p>Set the size of the data payload...</p>",
					"sub_caption": "<p class=\"caption\"><i>Note: For the 2.4GHz version you need to operate with a 55 Byte payload.</i></p>"
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
				"tags": [
					"Communications"
				],
				"html_id": "payload_length_80"
			},
			"auto_raw_interval": {
				"read_index": 39,
				"write_index": 28,
				"descriptions": {
					"title": "Set Auto Raw Interval",
					"main_caption": "<p>Set the Auto Time Domain (Raw) data transmission Interval...</p>",
					"sub_caption": "<p class=\"caption\"><i>Note: Auto Raw Transmission is disabled by default.</i></p>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"depends_on": {
					"operation_mode": 3
				},
				"tags": [
					"Communications"
				],
				"html_id": "auto_raw_interval_110"
			},
			"auto_raw_destination_address": {
				"read_index": 40,
				"write_index": 29,
				"length": 4,
				"descriptions": {
					"title": "Set Auto Raw Destination Address",
					"main_caption": "<p>Set the address where the Auto Time Domain (Raw) data will be transmitted...</p>",
					"sub_caption": "<p class=\"caption\">Default value: 0000FFFF for Broadcast Mode</p>"
				},
				"default_value": "0000FFFF",
				"validator": {
					"type": "mac",
					"length": 8,
					"generated": true
				},
				"depends_on": {
					"operation_mode": 3
				},
				"html_id": "auto_raw_destination_110"
			},
			"smart_mode_skip_count": {
				"read_index": 44,
				"write_index": 33,
				"descriptions": {
					"title": "Set Smart Mode Skip Interval",
					"main_caption": "<p>Sensor will skip sending data this many times if vibration is below the smart threshold.</p>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"depends_on": {
					"operation_mode": 3
				},
				"html_id": "smart_interval_110"
			},
			"sync_interval": {
				"read_index": 45,
				"write_index": 34,
				"descriptions": {
					"title": "Set FLY Interval",
					"main_caption": "<p>Set the interval at which the sensor will transmit FLY packets...</p>"
				},
				"default_value": 60,
				"validator": {
					"type": "uint16be",
					"min": 0,
					"max": 1440,
					"generated": true
				},
				"options": {
					"60": "1 Hour",
					"120": "2 Hours",
					"240": "4 Hours",
					"480": "8 Hours",
					"720": "12 Hours",
					"1080": "18 Hours",
					"1440": "24 Hours"
				},
				"tags": [
					"Communications"
				],
				"html_id": "fly_interval_110"
			},
			"rpm_compute_status": {
				"read_index": 47,
				"write_index": 36,
				"descriptions": {
					"title": "RPM Calculate Status",
					"main_caption": "<p>Enable/Disable Revolutions Per Minute Calculate Status</p>"
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
				"html_id": "enable_rpm_calculate_status_110"
			},
			"max_raw_samples": {
				"read_index": 48,
				"write_index": 37,
				"descriptions": {
					"title": "Set Max Raw Sample",
					"main_caption": "<p>Set the maximum number of samples...</p>"
				},
				"default_value": 0,
				"validator": {
					"type": "uint16be",
					"min": 1024,
					"max": 8100
				},
				"options": {
					"1024": "1024 Samples",
					"2048": "2048 Samples",
					"4096": "4096 Samples",
					"6400": "6400 Samples",
					"8100": "8100 Samples"
				},
				"html_id": "max_raw_sample_110"
			},
			"motion_to_sampling_delay": {
				"read_index": 50,
				"write_index": 39,
				"descriptions": {
					"title": "Set Motion to Sampling Delay",
					"main_caption": "<p>Once motion is detected, the sensor will wait...</p>"
				},
				"default_value": 100,
				"validator": {
					"type": "uint8",
					"min": 0,
					"max": 255,
					"generated": true
				},
				"html_id": "motion_to_sampling_delay_110"
			},
			"max_motion_tx_per_interval": {
				"read_index": 51,
				"write_index": 40,
				"descriptions": {
					"title": "Set Max Number Motion Tx Per Interval",
					"main_caption": "<p>Set Number of times it will send data due to motion triggers.</p>"
				},
				"default_value": 1,
				"validator": {
					"type": "uint8",
					"min": 1,
					"max": 255,
					"generated": true
				},
				"html_id": "max_num_motion_tx_delay_110"
			}
		};
	};

	const sync_parse = (rep_buffer) => {
		let response = {};

		// Get the map based on the sensor type byte
		const sync_map = get_config_map(rep_buffer[4]);

		for (const [key, config] of Object.entries(sync_map)) {
			// Destructure 'type' from inside 'validator' and rename 'read_index' to 'idx'
			const { read_index: idx, length, validator: { type } = {} } = config;

			// If for some reason a config doesn't have a validator/type, skip it
			if (!type) continue;

			switch (type) {
				case 'uint8':
					response[key] = rep_buffer[idx];
					break;
				case 'uint16be':
					response[key] = rep_buffer.readUInt16BE(idx);
					break;
				case 'uint32be':
					response[key] = rep_buffer.readUInt32BE(idx);
					break;
				case 'buffer':
					response[key] = rep_buffer.subarray(idx, idx + length);
					break;
				case 'hex':
					response[key] = rep_buffer.subarray(idx, idx + length).toString('hex');
					break;
				case 'mac':
					response[key] = rep_buffer.subarray(idx, idx + length).toString('hex');
					break;
			}
		}
		if (Object.hasOwn(response, 'destination_address') && response.destination_address.toLowerCase() === '00000000') {
			console.log('##############################');
			console.log('#########Dest Override########');
			console.log('##############################');
			response.destination_address = "0000ffff";
			response.auto_raw_destination_address = "0000ffff";
		};
		return response;
	};

	const parse_fly = (frame) => {
		let frame_data = {};
		switch (frame[16]) {
			case 0:
				frame_data.mode = "Processed";
				break;
			case 1:
				frame_data.mode = "Raw";
				break;
			case 2:
				frame_data.mode = "Processed + Raw on demand";
				break;
			case 3:
				frame_data.mode = "Smart";
				break;
		}
		switch (frame[17]) {
			case 6:
				frame_data.odr_1 = 50;
				break;
			case 7:
				frame_data.odr_1 = 100;
				break;
			case 8:
				frame_data.odr_1 = 200;
				break;
			case 9:
				frame_data.odr_1 = 400;
				break;
			case 10:
				frame_data.odr_1 = 800;
				break;
			case 11:
				frame_data.odr_1 = 1600;
				break;
			case 12:
				frame_data.odr_1 = 3200;
				break;
			case 13:
				frame_data.odr_1 = 6400;
				break;
			case 14:
				frame_data.odr_1 = 12800;
				break;
			case 15:
				frame_data.odr_1 = 25600;
				break;
		}
		frame_data.sampling_duration_1 = frame[18] * 50 + "ms";
		switch (frame[19]) {
			case 0:
				frame_data.filter_status = "Disabled";
				break;
			case 1:
				frame_data.filter_status = "Enabled";
				break;
		}
		switch (frame[20]) {
			case 0:
				frame_data.lpf_coeff_1 = 4;
				break;
			case 1:
				frame_data.lpf_coeff_1 = 8;
				break;
			case 2:
				frame_data.lpf_coeff_1 = 16;
				break;
			case 2:
				frame_data.lpf_coeff_1 = 32;
				break;
			case 4:
				frame_data.lpf_coeff_1 = 64;
				break;
			case 5:
				frame_data.lpf_coeff_1 = 128;
				break;
			case 6:
				frame_data.lpf_coeff_1 = 256;
				break;
			case 7:
				frame_data.lpf_coeff_1 = 512;
				break;
			case 8:
				frame_data.lpf_coeff_1 = 1024;
				break;
			case 9:
				frame_data.lpf_coeff_1 = 2048;
				break;
		}
		frame_data.lpf_freq_1 = frame_data.odr_1 / frame_data.lpf_coeff_1;
		switch (frame[21]) {
			case 0:
				frame_data.hpf_coeff_1 = 4;
				break;
			case 1:
				frame_data.hpf_coeff_1 = 8;
				break;
			case 2:
				frame_data.hpf_coeff_1 = 16;
				break;
			case 2:
				frame_data.hpf_coeff_1 = 32;
				break;
			case 4:
				frame_data.hpf_coeff_1 = 64;
				break;
			case 5:
				frame_data.hpf_coeff_1 = 128;
				break;
			case 6:
				frame_data.hpf_coeff_1 = 256;
				break;
			case 7:
				frame_data.hpf_coeff_1 = 512;
				break;
			case 8:
				frame_data.hpf_coeff_1 = 1024;
				break;
			case 9:
				frame_data.hpf_coeff_1 = 2048;
				break;
		}
		frame_data.hpf_freq_1 = frame_data.odr_1 / frame_data.hpf_coeff_1;
		switch (frame[22]) {
			case 0:
				frame_data.sampling_interval = "5 Minutes";
				frame_data.sampling_interval_number = 5;
				break;
			case 1:
				frame_data.sampling_interval = "10 Minutes";
				frame_data.sampling_interval_number = 10;
				break;
			case 2:
				frame_data.sampling_interval = "15 Minutes";
				frame_data.sampling_interval_number = 15;
				break;
			case 2:
				frame_data.sampling_interval = "20 Minutes";
				frame_data.sampling_interval_number = 20;
				break;
			case 4:
				frame_data.sampling_interval = "30 Minutes";
				frame_data.sampling_interval_number = 30;
				break;
			case 5:
				frame_data.sampling_interval = "60 Minutes";
				frame_data.sampling_interval_number = 60;
				break;
			case 6:
				frame_data.sampling_interval = "120 Minutes";
				frame_data.sampling_interval_number = 120;
				break;
			case 7:
				frame_data.sampling_interval = "180 Minutes";
				frame_data.sampling_interval_number = 180;
				break;
			case 8:
				frame_data.sampling_interval = "1 Minute";
				frame_data.sampling_interval_number = 1;
				break;
		}
		frame_data.on_request_timeout = frame[23] + " Seconds";
		frame_data.deadband = frame[24] + "mg";

		switch (frame[25]) {
			case 0:
				frame_data.payload_length = "50 Bytes";
				break;
			case 1:
				frame_data.payload_length = "100 Bytes";
				break;
			case 2:
				frame_data.payload_length = "150 Bytes";
				break;
			case 3:
				frame_data.payload_length = "180 Bytes";
				break;
		}
		switch (frame[26]) {
			case 0:
				frame_data.fsr_text = "2g";
				break;
			case 1:
				frame_data.fsr_text = "4g";
				break;
			case 2:
				frame_data.fsr_text = "8g";
				break;
			case 3:
				frame_data.fsr_text = "16g";
				break;
		}
		frame_data.rpm_status = frame[27] ? 'Enabled' : 'Disabled';
		frame_data.auto_raw_interval = frame[32] * frame_data.sampling_interval_number || 'disabled';
		frame_data.auto_raw_interval = typeof frame_data.auto_raw_interval === 'number' ? frame_data.auto_raw_interval + 'min' : frame_data.auto_raw_interval;
		frame_data.smart_mode_threshold = frame[34] * 50;
		if (frame[2] > 6) { // for Firmware v7 and above
			frame_data.motion_to_delay = frame[41] * 50;
			return {
				'firmware': frame[2],
				'destination_address': toMac(frame.slice(12, 16)),
				'mode': frame_data.mode,
				'odr': frame_data.odr_1 + 'Hz',
				'sampling_duration': frame_data.sampling_duration_1,
				'filter_status': frame_data.filter_status,
				'lpf_coeff': frame_data.lpf_coeff_1,
				'lpf_freq': frame_data.lpf_freq_1 + 'Hz',
				'hpf_coeff': frame_data.hpf_coeff_1,
				'hpf_freq': frame_data.hpf_freq_1 + 'Hz',
				'sampling_interval': frame_data.sampling_interval,
				'on_request_timeout': frame_data.on_request_timeout,
				'deadband': frame_data.deadband,
				'payload_length': frame_data.payload_length,
				'fsr': frame_data.fsr_text,
				'rpm_compute_status': frame_data.rpm_status,
				'auto_raw_destination_address': toMac(frame.slice(28, 32)),
				'auto_raw_interval': frame_data.auto_raw_interval,
				'smart_mode_skip_count': frame[33],
				'smart_mode_acc_threshold': frame_data.smart_mode_threshold + 'mg',
				'uptime_counter': frame.slice(35, 39).reduce(msbLsb) + 'sec',
				'max_tx_raw_samples': frame.slice(39, 41).reduce(msbLsb),
				'motion_to_sampling_delay': frame_data.motion_to_delay + 'msec',
				'max_num_of_motion_tx_per_interval': frame[42],
				'hardware_id': frame.slice(43, 46),
				'reserved': frame.slice(46, 50),
				'tx_lifetime_counter': frame.slice(50, 54).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'destination_address': toMac(frame.slice(12, 16), false),
					'mode': frame[16],
					'odr': frame[17],
					'sampling_duration': frame[18],
					'filter_status': frame[19],
					'lpf_coeff': frame[20],
					'hpf_coeff': frame[21],
					'sampling_interval': frame[22],
					'on_request_timeout': frame[23],
					'deadband': frame[24],
					'payload_length': frame[25],
					'fsr': frame[26],
					'rpm_compute_status': frame[27],
					'auto_raw_destination_address': toMac(frame.slice(28, 32), false),
					'auto_raw_interval': frame[32],
					'smart_mode_skip_count': frame[33],
					'smart_mode_acc_threshold': frame[34],
					'uptime_counter': frame.slice(35, 39),
					'max_tx_raw_samples': frame.slice(39, 41),
					'motion_to_sampling_delay': frame[41],
					'max_num_of_motion_tx_per_interval': frame[42],
					'hardware_id': frame.slice(43, 46),
					'reserved': frame.slice(46, 50),
					'tx_lifetime_counter': frame.slice(50, 54)
				}
			}
		} else if (frame[2] > 5) { // for Firmware v6
			frame_data.motion_to_delay = frame[41] * 50;
			return {
				'firmware': frame[2],
				'destination_address': toMac(frame.slice(12, 16)),
				'mode': frame_data.mode,
				'odr': frame_data.odr_1 + 'Hz',
				'sampling_duration': frame_data.sampling_duration_1,
				'filter_status': frame_data.filter_status,
				'lpf_coeff': frame_data.lpf_coeff_1,
				'lpf_freq': frame_data.lpf_freq_1 + 'Hz',
				'hpf_coeff': frame_data.hpf_coeff_1,
				'hpf_freq': frame_data.hpf_freq_1 + 'Hz',
				'sampling_interval': frame_data.sampling_interval,
				'on_request_timeout': frame_data.on_request_timeout,
				'deadband': frame_data.deadband,
				'payload_length': frame_data.payload_length,
				'fsr': frame_data.fsr_text,
				'rpm_compute_status': frame_data.rpm_status,
				'auto_raw_destination_address': toMac(frame.slice(28, 32)),
				'auto_raw_interval': frame_data.auto_raw_interval,
				'smart_mode_skip_count': frame[33],
				'smart_mode_acc_threshold': frame_data.smart_mode_threshold + 'mg',
				'uptime_counter': frame.slice(35, 39).reduce(msbLsb) + 'sec',
				'max_tx_raw_samples': frame.slice(39, 41).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'destination_address': toMac(frame.slice(12, 16), false),
					'mode': frame[16],
					'odr': frame[17],
					'sampling_duration': frame[18],
					'filter_status': frame[19],
					'lpf_coeff': frame[20],
					'hpf_coeff': frame[21],
					'sampling_interval': frame[22],
					'on_request_timeout': frame[23],
					'deadband': frame[24],
					'payload_length': frame[25],
					'fsr': frame[26],
					'rpm_compute_status': frame[27],
					'auto_raw_destination_address': toMac(frame.slice(28, 32), false),
					'auto_raw_interval': frame[32],
					'smart_mode_skip_count': frame[33],
					'smart_mode_acc_threshold': frame[34],
					'uptime_counter': frame.slice(35, 39),
					'max_tx_raw_samples': frame.slice(39, 41)
				}
			}
		} else if (frame[2] > 4) { // for Firmware v5 and above
			return {
				'firmware': frame[2],
				'destination_address': toMac(frame.slice(12, 16)),
				'mode': frame_data.mode,
				'odr': frame_data.odr_1 + 'Hz',
				'sampling_duration': frame_data.sampling_duration_1,
				'filter_status': frame_data.filter_status,
				'lpf_coeff': frame_data.lpf_coeff_1,
				'lpf_freq': frame_data.lpf_freq_1 + 'Hz',
				'hpf_coeff': frame_data.hpf_coeff_1,
				'hpf_freq': frame_data.hpf_freq_1 + 'Hz',
				'sampling_interval': frame_data.sampling_interval,
				'on_request_timeout': frame_data.on_request_timeout,
				'deadband': frame_data.deadband,
				'payload_length': frame_data.payload_length,
				'fsr': frame_data.fsr_text,
				'rpm_compute_status': frame_data.rpm_status,
				'auto_raw_destination_address': toMac(frame.slice(28, 32)),
				'auto_raw_interval': frame_data.auto_raw_interval,
				'smart_mode_skip_count': frame[33],
				'smart_mode_acc_threshold': frame_data.smart_mode_threshold + 'mg',
				'uptime_counter': frame.slice(35, 39).reduce(msbLsb) + 'sec',
				'max_tx_raw_samples': frame.slice(39, 41).reduce(msbLsb),
				'hardware_id': frame.slice(41, 44),
				'reserved': frame.slice(44, 48),
				'tx_lifetime_counter': frame.slice(48, 52).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'destination_address': toMac(frame.slice(12, 16), false),
					'mode': frame[16],
					'odr': frame[17],
					'sampling_duration': frame[18],
					'filter_status': frame[19],
					'lpf_coeff': frame[20],
					'hpf_coeff': frame[21],
					'sampling_interval': frame[22],
					'on_request_timeout': frame[23],
					'deadband': frame[24],
					'payload_length': frame[25],
					'fsr': frame[26],
					'rpm_compute_status': frame[27],
					'auto_raw_destination_address': toMac(frame.slice(28, 32), false),
					'auto_raw_interval': frame[32],
					'smart_mode_skip_count': frame[33],
					'smart_mode_acc_threshold': frame[34],
					'uptime_counter': frame.slice(35, 39),
					'max_tx_raw_samples': frame.slice(39, 41),
					'hardware_id': frame.slice(41, 44),
					'reserved': frame.slice(44, 48),
					'tx_lifetime_counter': frame.slice(48, 52)
				}
			}
		} else {
			return {
				'firmware': frame[2],
				'destination_address': toMac(frame.slice(12, 16)),
				'mode': frame_data.mode,
				'odr': frame_data.odr_1 + 'Hz',
				'sampling_duration': frame_data.sampling_duration_1,
				'filter_status': frame_data.filter_status,
				'lpf_coeff': frame_data.lpf_coeff_1,
				'lpf_freq': frame_data.lpf_freq_1 + 'Hz',
				'hpf_coeff': frame_data.hpf_coeff_1,
				'hpf_freq': frame_data.hpf_freq_1 + 'Hz',
				'sampling_interval': frame_data.sampling_interval,
				'on_request_timeout': frame_data.on_request_timeout,
				'deadband': frame_data.deadband,
				'payload_length': frame_data.payload_length,
				'fsr': frame_data.fsr_text,
				'rpm_compute_status': frame_data.rpm_status,
				'auto_raw_destination_address': toMac(frame.slice(28, 32)),
				'auto_raw_interval': frame_data.auto_raw_interval,
				'smart_mode_skip_count': frame[33],
				'smart_mode_acc_threshold': frame_data.smart_mode_threshold + 'mg',
				'uptime_counter': frame.slice(35, 39).reduce(msbLsb) + 'sec',
				'hardware_id': frame.slice(39, 42),
				'reserved': frame.slice(42, 46),
				'tx_lifetime_counter': frame.slice(46, 50).reduce(msbLsb),
				'machine_values': {
					'firmware': frame[2],
					'destination_address': toMac(frame.slice(12, 16), false),
					'mode': frame[16],
					'odr': frame[17],
					'sampling_duration': frame[18],
					'filter_status': frame[19],
					'lpf_coeff': frame[20],
					'hpf_coeff': frame[21],
					'sampling_interval': frame[22],
					'on_request_timeout': frame[23],
					'deadband': frame[24],
					'payload_length': frame[25],
					'fsr': frame[26],
					'rpm_compute_status': frame[27],
					'auto_raw_destination_address': toMac(frame.slice(28, 32), false),
					'auto_raw_interval': frame[32],
					'smart_mode_skip_count': frame[33],
					'smart_mode_acc_threshold': frame[34],
					'uptime_counter': frame.slice(35, 39),
					'hardware_id': frame.slice(39, 42),
					'reserved': frame.slice(42, 46),
					'tx_lifetime_counter': frame.slice(46, 50)
				}
			}
		}
	}

	const parse = (payload, parsed, mac) => {
		if (payload[7] & 2) {
			console.log('Error found');
			parsed.data = { error: 'Error found, Sensor Probe may be unattached' };
			return parsed;
		}
		let msg_type = (payload[7] & 16) ? 'motion' : 'regular';
		if (payload[8] === 1) {

			var deviceAddr = mac;
			var expected_packets = msbLsb(payload[16], payload[17]);
			var current_packet = msbLsb(payload[18], payload[19]);
			var sdata_start = 20;

			if (globalDevices.hasOwnProperty(deviceAddr) || expected_packets == 1) {
				if (expected_packets != 1) {
					if (globalDevices[deviceAddr].last_packet_counter == current_packet) {
						console.log('Duplicated message');
						return;
					}
					if (current_packet == 1 || (globalDevices[deviceAddr].last_packet_counter > current_packet)) {
						console.log('Recovering bad packet');
						clear_globalDevices_stream(deviceAddr);
						init_globalDevices_stream(deviceAddr, payload, expected_packets, parsed, msg_type);
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
					init_globalDevices_stream(deviceAddr, payload, expected_packets, parsed, msg_type);
					globalDevices[deviceAddr].last_packet_counter = current_packet;
					globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
				}
			}
			else {
				clear_globalDevices_stream(deviceAddr);
				init_globalDevices_stream(deviceAddr, payload, expected_packets, parsed, msg_type);
				globalDevices[deviceAddr].last_packet_counter = current_packet;
				globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
			}
			if (current_packet == expected_packets) {
				sensor_data = concat_fft_data(deviceAddr, payload[8], msg_type);
				clear_globalDevices_stream(deviceAddr);
				return sensor_data;
			}
			else {
				return;
			}
		}
		else if (payload[8] === 0 || payload[8] === 2 || payload[8] === 3) {
			var odr;
			switch (payload[9]) {
				case 6: odr = "50Hz"; break;
				case 7: odr = "100Hz"; break;
				case 8: odr = "200Hz"; break;
				case 9: odr = "400Hz"; break;
				case 10: odr = "800Hz"; break;
				case 11: odr = "1600Hz"; break;
				case 12: odr = "3200Hz"; break;
				case 13: odr = "6400Hz"; break;
				case 14: odr = "12800Hz"; break;
				case 15: odr = "25600Hz"; break;
			}
			return {
				mode: payload[8],
				msg_type: msg_type,
				odr: odr,
				temperature: signInt(payload.slice(10, 12).reduce(msbLsb), 16) / 100,
				x_rms_ACC_G: payload.slice(12, 14).reduce(msbLsb) / 1000,
				x_max_ACC_G: payload.slice(14, 16).reduce(msbLsb) / 1000,
				x_velocity_mm_sec: payload.slice(16, 18).reduce(msbLsb) / 100,
				x_displacement_mm: payload.slice(18, 20).reduce(msbLsb) / 100,
				x_peak_one_Hz: payload.slice(20, 22).reduce(msbLsb),
				x_peak_two_Hz: payload.slice(22, 24).reduce(msbLsb),
				x_peak_three_Hz: payload.slice(24, 26).reduce(msbLsb),
				y_rms_ACC_G: payload.slice(26, 28).reduce(msbLsb) / 1000,
				y_max_ACC_G: payload.slice(28, 30).reduce(msbLsb) / 1000,
				y_velocity_mm_sec: payload.slice(30, 32).reduce(msbLsb) / 100,
				y_displacement_mm: payload.slice(32, 34).reduce(msbLsb) / 100,
				y_peak_one_Hz: payload.slice(34, 36).reduce(msbLsb),
				y_peak_two_Hz: payload.slice(36, 38).reduce(msbLsb),
				y_peak_three_Hz: payload.slice(38, 40).reduce(msbLsb),
				z_rms_ACC_G: payload.slice(40, 42).reduce(msbLsb) / 1000,
				z_max_ACC_G: payload.slice(42, 44).reduce(msbLsb) / 1000,
				z_velocity_mm_sec: payload.slice(44, 46).reduce(msbLsb) / 100,
				z_displacement_mm: payload.slice(46, 48).reduce(msbLsb) / 100,
				z_peak_one_Hz: payload.slice(48, 50).reduce(msbLsb),
				z_peak_two_Hz: payload.slice(50, 52).reduce(msbLsb),
				z_peak_three_Hz: payload.slice(52, 54).reduce(msbLsb),
				rpm: payload.slice(54, 56).reduce(msbLsb)
			};
		}
	};


	// Export the module with all the necessary functions and properties 
	// that need to be called from outside the scrip
	return {
		type: 114,
		name: 'Standalone Smart Vibration Sensor v4',
		parse,
		get_write_buffer_size,
		get_config_map,
		sync_parse,
		parse_fly,
	};
};