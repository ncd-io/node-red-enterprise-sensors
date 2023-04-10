const events = require('events');
const Queue = require('promise-queue');
globalDevices = {};
module.exports = class WirelessSensor{
	constructor(digi){
		this.mac;
		this.digi = digi;
		this.send = digi.send;
		this._emitter = new events.EventEmitter();
		this.sensor_pool = {};
		this.sensor_types = sensor_types(this);
		this.queue = new Queue(1);
		this.payloadType = {
			'122': 'power_up',
			'124': 'config_ack',
			'125': 'config_error',
			'127': 'sensor_data'
		};

		var that = this;
		function receiver(frame){
			try{
				that.parse(frame);
			}catch(e){
				console.log(frame);
				console.log('unable to parse frame');
				console.log(e);
			}
		}
		this.digi.on('receive_packet', receiver);
		this.on('close', () => {
			//console.log('removing listener');
			this.digi._emitter.removeListener('receive_packet', receiver);
		});
	}
	send_control(type, mac, msg){
		if(this.sensor_types[type] && typeof this.sensor_types[type].control != 'undefined'){
			return this.control_send(mac, [249, ...this.sensor_types[type].control(msg)]);
		}else{
			return new Promise((f,r)=>{r('Unknown sensor type');});
		}
	}
	send_arbitrary(mac, data){
		return this.control_send(mac,msg);
	}
	close(cb){
		this._emitter.emit('close');
		this.digi.close();
	}
	parse(frame){
		var type = this.payloadType[frame.data[0]];
		if(typeof this[type] == 'function'){
			var data = this[type](frame.data.slice(1), frame);
			if(typeof data == 'undefined'){
				return;
			}
			data.type = type;
			data.addr = frame.mac;
			data.received = Date.now();
			data.original = frame;
			var is_new = typeof this.sensor_pool[frame.mac] == 'undefined';
			var new_mode = is_new;
			var mode = (type == 'power_up') ? data.mode : ((type == 'sensor_data') ? 'RUN' : ((type == 'config_ack') ? 'ACK' : 'PGM'));
			// #OTF
			var otf_devices = [80,81,82,84,101,102,519,520];
			var device_type = msbLsb(frame.data[6], frame.data[7]);
			// var device_type = frame.data[7];

			if(mode == "RUN"){
				if(frame.data[9] == 70 && frame.data[10] == 76 && frame.data[11] == 89) {
					var broadcast_otf_devices = [101,102];
					mode = "FLY";
				}
			}
			if(mode == 'ACK'){
				data.firmware_version = frame.data[5];
				if(data.firmware_version == 0){
					data.sensor_type = frame.data[3];
				}else{
					data.sensor_type = msbLsb(frame.data[3], frame.data[4]);
				}
				if(frame.data[7] == 79 && frame.data[8] == 84 && frame.data[9] == 78){
					mode = "OTN";
				}
				else if(frame.data[7] == 79 && frame.data[8] == 84 && frame.data[9] == 70){
					mode = "OTF";
				}
			}

			// If it is not a new sensor
			if(!is_new){
				// If mode == RUN and type is not 'power_up' don't send RUN
				// sensor_data emitter sets status of UI anyay
				if(mode == 'RUN' && type != 'power_up'){
					new_mode = false;
				} else if(mode == 'RUN' && type == 'power_up'){
					new_mode = true;
				}else{
					new_mode = this.sensor_pool[frame.mac].mode != mode;
				}
			};

			this.sensor_pool[frame.mac] = {
				mac: frame.mac,
				type: data.sensor_type,
				nodeId: data.nodeId,
				mode: mode,
				lastHeard: data.received
			};

			if(mode === 'FLY' && frame.data.length > 12 && typeof this.sensor_types[data.sensor_type].parse_fly == 'function'){
				this.sensor_pool[frame.mac].reported_config = this.sensor_types[data.sensor_type].parse_fly(frame.data);
			}else if(mode === 'OTF' && frame.data.length > 12 && typeof this.sensor_types[data.sensor_type].parse_fly == 'function'){
				// restructure and add dead bytes to match FLY message so we only need one parser.
				// If we ever need to add any of the additional information of this packet we will need to rebuild to match
				frame.data.splice(2,0,frame.data[5],0);
				this.sensor_pool[frame.mac].reported_config = this.sensor_types[data.sensor_type].parse_fly(frame.data);
			}
			var that = this;

			if(is_new){
				that._emitter.emit('found_sensor', that.sensor_pool[frame.mac]);
			}
			// mode === 'ACK' check added to allow multiple configs through front end gateway input
			if(new_mode || mode === 'ACK'){
				that._emitter.emit('sensor_mode', that.sensor_pool[frame.mac]);
				that._emitter.emit('sensor_mode-'+frame.mac, that.sensor_pool[frame.mac]);
			}
			if(mode != 'FLY'){
				var send_events = function(){
					that._emitter.emit(type, data);
					that._emitter.emit(type+'-'+data.sensor_type, data);
					that._emitter.emit(type+'-'+frame.mac, data);
					// MARK FLY CONFIG DATA
				};
				if(typeof frame.rssi == 'undefined') send_events();
				else frame.rssi.then((v) => {
					data.rssi = v.data[0];
					send_events();
				}).catch(console.log);
			}
		}else{
			this._emitter.emit(frame.type+'-'+frame.mac.toUpperCase(), data);
			var data = {};
			data.addr = frame.mac;
			data.data = frame.data;
			this._emitter.emit(frame.type+'-'+'unknown_device', data);
		}
	}
	power_up(payload){
		return {
			nodeId: payload[0],
			sensor_type: msbLsb(payload[2], payload[3]),
			mode: String.fromCharCode(...payload.slice(6, 9))
		};
	}
	config_ack(payload){
		return {
			nodeId: payload[0],
			counter: payload[1],
			sensor_type: msbLsb(payload[2], payload[3]),
			data: payload.slice(6)
		};
	}
	config_error(payload){
		var errors = [
			'Unknown',
			'Invalid Command',
			'Sensor Type Mismatch',
			'Node ID Mismatch',
			'Apply change command failed',
			'Invalid API Packet Command Response Received After Apply Change Command',
			'Write command failed',
			'Invalid API Packet Command Response Received After Write Command',
			'Parameter Change Command Failed',
			'Invalid Parameter Change Command Response Received After Write Command',
			'Invalid/Incomplete Packet Received',
			'Unknown',
			'Unknown',
			'Unknown',
			'Unknown',
			'Invalid Parameter for Setup/Saving'
		];
		return {
			nodeId: payload[0],
			sensor_type: msbLsb(payload[2], payload[3]),
			error: payload[6],
			error_message: errors[payload[6]],
			last_sent: this.digi.lastSent
		};
	}
	sensor_data(payload, frame){
		var parsed = {
			nodeId: payload[0],
			firmware: payload[1],
			battery: (msbLsb(payload[2], payload[3]) * 0.00322).toFixed(2),
			//	battery_percent: (msbLsb(payload[2], payload[3]) * 0.537 - 449.9).toFixed(2),
			battery_percent:  ((msbLsb(payload[2], payload[3]) * 0.361) - 269.66).toFixed(2),
			counter: payload[4],
			sensor_type: msbLsb(payload[5], payload[6]),
		};

		// #OTF
		var otf_devices = [80,81,82,84,101,102,519,520];
		if(otf_devices.includes(parsed.sensor_type)){
			// If the message says FLY and there is not FLY timer in progress.
			if(payload[8] == 70 && payload[9] == 76 && payload[10] == 89) {
				parsed.payload = "Fly command";
				return parsed;
			}
		}

		// Sensor type 515 has a unique OTF that is indicated by a reserve byte value with MSb of 1
		if(parsed.sensor_type == 515){
			// If first bit in reserve is 1 AND current bank equals total banks
			if(payload[7] & 1 && payload[8] == payload[9]){
				this._emitter.emit('set_destination_address'+frame.mac, frame.mac);
				this._emitter.emit('set_destination_address'+parsed.sensor_type, frame.mac);
				parsed.otf_515 = true;
			} else{
				parsed.otf_515 = false;
			}
		}

		if(parsed.sensor_type == 101){
			// If the message says FLY and there is not FLY timer in progress.
			// if(payload[8] == 70 && payload[9] == 76 && payload[10] == 89 && !this.hasOwnProperty('fly_101_in_progress')) {
			// 	this.fly_101_in_progress = true;
			// 	setTimeout(() => {this.config_set_rtc_101('00:00:00:00:00:00:FF:FF')}, 1000);
			// 	return;
			// }

			var deviceAddr = frame.mac;
			var firmware = payload[1];
			var hour = payload[11];
			var minute = payload[12];
			if(firmware == 0){
				var expected_packets = payload[15];
				var current_packet = payload[16];
				var sdata_start = 17;
			}
			else{
				// Added external temp in firmware 1 inserted at item 15
				var expected_packets = payload[17];
				var current_packet = payload[18];
				var sdata_start = 19;
			}


			if(globalDevices.hasOwnProperty(deviceAddr)){
				// if a packet is already stored with the same packet ID, or if packet ID is 1, or if current packet ID is not one more than last packet ID
				if(current_packet == 1 && expected_packets != 1) {
					if(current_packet in globalDevices[deviceAddr].data || !(((current_packet&127)-1) in globalDevices[deviceAddr].data)) {
						console.log('bad packet breakdown, deleting stream. Current packet:');
						console.log(current_packet);
						console.log('Total Expected Packets:');
						console.log(expected_packets);
						// console.log(current_packet in globalDevices[deviceAddr].data);
						// console.log(current_packet == 1);
						// console.log(!((current_packet-1) in globalDevices[deviceAddr].data));
						if(this.hasOwnProperty('failure_no')){
							this.failure_no = this.failure_no + 1;
						}
						else{
							this.failure_no = 1;
						}
						if(this.hasOwnProperty('failure_no')){
							console.log('####falure no');
							console.log(this.failure_no);
						}
						// console.log(globalDevices[deviceAddr].data);
						delete globalDevices[deviceAddr];
						if(current_packet != 1){
							return;
						} else{
							this.build_101_data(payload, deviceAddr, hour, minute, sdata_start, current_packet, firmware);
							return;
						}
					}
				}
				if(expected_packets == 1){
					this.build_101_data(payload, deviceAddr, hour, minute, sdata_start, current_packet, firmware);
				} else{
					globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
				}

				// Date Folder
				// CSV File date_macaddress.csv
				// Configuration
				// sensor wakes up even if not in config mode
				// time update needs to be sent as broadcast
				// sensors stay awake for two seconds
				// sensor request for current time has the word fly in it.
				// create functions node to split data out for graphing (group by x,y,x).

				// Function node to allow graphing
				// Auto Configure including time when fly request received
				// Try new fft - DOES NOT WORK. It is expecting a serial input from a particular device
				// Create Account on NCD so Bhaskar can tag in posts about added config functionality
				// Clever way to parse dependent on x/y/z axis enable


				if(Object.keys(globalDevices[deviceAddr].data).length == expected_packets){
					var raw_data = new Array();
					for(const packet in globalDevices[deviceAddr].data){
						raw_data = raw_data.concat(globalDevices[deviceAddr].data[packet]);
					}
					var label = 0;
					// var fft = {
					// 	data: new Array()
					// 	// test: new Array()
					// };
					var fft = new Array();
					var fft_concat = {};

					var en_axis_data = {};
					switch (globalDevices[deviceAddr].en_axis){
						case 1:
							en_axis_data.x_offset = 0;
							en_axis_data.increment = 2;
							break;
						case 2:
							en_axis_data.y_offset = 0;
							en_axis_data.increment = 2;
							break;
						case 3:
							en_axis_data.x_offset = 0;
							en_axis_data.y_offset = 2;
							en_axis_data.increment = 4;
							break;
						case 4:
							en_axis_data.z_offset = 0;
							en_axis_data.increment = 2;
							break;
						case 5:
							en_axis_data.x_offset = 0;
							en_axis_data.z_offset = 2;
							en_axis_data.increment = 4;
							break;
						case 6:
							en_axis_data.y_offset = 0;
							en_axis_data.z_offset = 2;
							en_axis_data.increment = 4;
							break;
						case 7:
							en_axis_data.x_offset = 0;
							en_axis_data.y_offset = 2;
							en_axis_data.z_offset = 4;
							en_axis_data.increment = 6;
							break;
						default:
							en_axis_data.increment = 0;
					}
					var fsr_mult = .00006;
					var fsr_text = "";
					switch(globalDevices[deviceAddr].fsr){
						case 0:
							fsr_mult = 0.00003;
							break;
						case 1:
							fsr_mult = 0.0006;
							break;
						case 2:
							fsr_mult = 0.00012;
							break;
					}
					switch(globalDevices[deviceAddr].fsr){
						case 0:
							fsr_text = "10g";
							break;
						case 1:
							fsr_text = "20g";
							break;
						case 2:
							fsr_text = "40g";
							break;
					}
					for(var i = 0; i < raw_data.length; i+=en_axis_data.increment){
						label++;
						// var fft_data = {
						// 	time_id: globalDevices[deviceAddr].hour +':'+ globalDevices[deviceAddr].minute,
						// 	reading: label,
						// 	odr: globalDevices[deviceAddr].odr,
						// 	temperature: globalDevices[deviceAddr].temperature,
						// 	en_axis: globalDevices[deviceAddr].en_axis,
						// 	mac_address: deviceAddr,
						// }
						// var fft_data = {};
						fft_concat[label] = {};

						if('x_offset' in en_axis_data){
							fft_concat[label].x = parseFloat((signInt(((raw_data[i+en_axis_data.x_offset]<<8)+(raw_data[i+en_axis_data.x_offset+1])), 16)*.00006).toFixed(5));
						}
						if('y_offset' in en_axis_data){
							fft_concat[label].y = parseFloat((signInt(((raw_data[i+en_axis_data.y_offset]<<8)+(raw_data[i+en_axis_data.y_offset+1])), 16)*.00006).toFixed(5));
						}
						if('z_offset' in en_axis_data){
							fft_concat[label].z = parseFloat((signInt(((raw_data[i+en_axis_data.z_offset]<<8)+(raw_data[i+en_axis_data.z_offset+1])), 16)*.00006).toFixed(5));
						}


						// fft.push(fft_data);
						// if(label< 40){
						// fft_concat[label] = {
						// 	// label: label,
						// 	x: parseFloat((signInt(((raw_data[i]<<8)+(raw_data[i+1]&255)), 16)*.00006).toFixed(5)),
						// 	y: parseFloat((signInt(((raw_data[i+2]<<8)+(raw_data[i+3]&255)), 16)*.00006).toFixed(5)),
						// 	z: parseFloat((signInt(((raw_data[i+4]<<8)+(raw_data[i+5]&255)), 16)*.00006).toFixed(5)),
						// };
						// }

					}
					var fft_concat_obj = {
						time_id: globalDevices[deviceAddr].hour +':'+ globalDevices[deviceAddr].minute,
						mac_address: deviceAddr,
						en_axis: globalDevices[deviceAddr].en_axis,
						odr: globalDevices[deviceAddr].odr,
						device_temp: globalDevices[deviceAddr].device_temp,
						data: fft_concat
					};
					if(firmware > 0){
						fft_concat_obj.probe_temp = globalDevices[deviceAddr].probe_temp;
					}
					parsed.sensor_data = fft_concat_obj;
					parsed.raw_packets = globalDevices[deviceAddr].data;
					parsed.raw_data = raw_data;
					delete globalDevices[deviceAddr];
					if(this.hasOwnProperty('failure_no')){
						console.log('####falure no');
						console.log(this.failure_no);
					}

					return parsed;
				}
				else{
					return;
				}
			}else{
				this.build_101_data(payload, deviceAddr, hour, minute, sdata_start, current_packet, firmware);
				return;
			}
		}

		if(parsed.sensor_type == 102){
			// If the message says FLY and there is not FLY timer in progress.
			// if(payload[8] == 70 && payload[9] == 76 && payload[10] == 89 && !this.hasOwnProperty('fly_101_in_progress')) {
			// 	this.fly_101_in_progress = true;
			// 	this.sensor_pool[frame.mac].mode = "FLY";
			// 	this._emitter.emit('sensor_mode-'+frame.mac, this.sensor_pool[frame.mac]);
			// 	// setTimeout(() => {this.config_set_rtc_101('00:00:00:00:00:00:FF:FF')}, 1000);
			// 	setTimeout(() => {this.config_set_rtc_101(frame.mac)}, 1000);
			//
			// 	return;
			// }

			var deviceAddr = frame.mac;
			var firmware = payload[1];
			var hour = payload[9];
			var minute = payload[10];
			var expected_packets = payload[15];
			var current_packet = payload[16];
			var sdata_start = 17;

			if(globalDevices.hasOwnProperty(deviceAddr) || expected_packets == 1){
				// if(expected_packets == 1){
				// 	this.build_102_data(payload, deviceAddr, hour, minute, sdata_start, current_packet, firmware);
				// }

				// if a packet is already stored with the same packet ID,
				 // or if packet ID is 1,
				 // or if current packet ID is not one more than last packet ID
				if(current_packet == 1 && expected_packets != 1) {
					if(current_packet in globalDevices[deviceAddr].data || !(((current_packet&127)-1) in globalDevices[deviceAddr].data)) {
						console.log('bad packet breakdown, deleting stream. Current packet:');
						console.log(current_packet);
						console.log('Total Expected Packets:');
						console.log(expected_packets);
						// console.log(current_packet in globalDevices[deviceAddr].data && current_packet == 1 && expected_packets != 1);
						// console.log(current_packet == 1);
						// console.log(!((current_packet-1) in globalDevices[deviceAddr].data));
						if(this.hasOwnProperty('failure_no')){
							this.failure_no = this.failure_no + 1;
						}
						else{
							this.failure_no = 1;
						}
						if(this.hasOwnProperty('failure_no')){
							console.log('####falure no');
							console.log(this.failure_no);
						}
						delete globalDevices[deviceAddr];
						if(current_packet != 1){
							return;
						} else{
							this.build_102_data(payload, deviceAddr, hour, minute, sdata_start, current_packet, firmware);
							return;
						}
					}
				}
				if(expected_packets == 1){
					this.build_102_data(payload, deviceAddr, hour, minute, sdata_start, current_packet, firmware);
				} else{
					globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
				}
				if(Object.keys(globalDevices[deviceAddr].data).length == expected_packets){
					var raw_data = new Array();
					for(const packet in globalDevices[deviceAddr].data){
						raw_data = raw_data.concat(globalDevices[deviceAddr].data[packet]);
					}
					var label = 0;
					// var fft = {
					// 	data: new Array()
					// 	// test: new Array()
					// };
					var fft = new Array();
					var fft_concat = {};

					for(var i = 0; i < raw_data.length; i+=2){
						label++;
						fft_concat[label] = {'v': parseFloat((signInt(((raw_data[i]<<8)+(raw_data[i+1])), 16)*.00322).toFixed(5))};
					}
					var fft_concat_obj = {
						time_id: globalDevices[deviceAddr].hour +':'+ globalDevices[deviceAddr].minute,
						mac_address: deviceAddr,
						// en_axis: globalDevices[deviceAddr].en_axis,
						odr: globalDevices[deviceAddr].odr,
						device_temp: globalDevices[deviceAddr].device_temp,
						probe_temp: globalDevices[deviceAddr].probe_temp,
						data: fft_concat
					};
					parsed.sensor_data = fft_concat_obj;
					// parsed.sensor_data = fft;
					parsed.raw_packets = globalDevices[deviceAddr].data;
					parsed.raw_data = raw_data;
					// var data = globalDevices[deviceAddr];
					delete globalDevices[deviceAddr];
					if(this.hasOwnProperty('failure_no')){
						console.log('####falure no');
						console.log(this.failure_no);
					}

					return parsed;
				}
				else{
					return;
				}

			}else{
				this.build_102_data(payload, deviceAddr, hour, minute, sdata_start, current_packet, firmware);
				return;
			}
		}


		if(payload.length == 179){
			if(msbLsb(payload[2], payload[3]) == 40){
				delete parsed.firmware;
				delete parsed.battery;
				delete parsed.battery_percent;
				delete parsed.counter;
				// parsed.frame_id = payload[1];
				parsed.sensor_type = msbLsb(payload[2], payload[3]);
				var odr;
				switch(payload[4]){
					case 5:
						odr = 400;
						break;
					case 6:
						odr = 800;
						break;
					case 7:
						odr = 1600;
						break;
					case 12:
						odr = 3200;
						break;
					case 13:
						odr = 6400;
						break;
					case 14:
						odr = 12800;
						break;
					case 15:
						odr = 25600;
						break;
					default:
						odr = 0;
				}
				// parsed.sensor_data = {data_type: 'FFT', data: payload.slice(5)};
				var deviceAddr = frame.mac;
				if(deviceAddr in globalDevices){
					globalDevices[deviceAddr] = globalDevices[deviceAddr].concat(payload.slice(5));
					if(globalDevices[deviceAddr].length == 2088){
						var label = 1;
						var fft = {};
						fft['odr'] = odr;
						fft['data_type'] = 'FFT';
						for(var i = 0; i < 2064; i+=6){
							var xLabel = 'x'+label;
							var yLabel = 'y'+label;
							var zLabel = 'z'+label;
							label++;
							fft[xLabel] = ((globalDevices[deviceAddr][i]<<8)+(globalDevices[deviceAddr][i+1]&255))/2048;
							fft[yLabel] = ((globalDevices[deviceAddr][i+2]<<8)+(globalDevices[deviceAddr][i+3]&255))/2048;
							fft[zLabel] = ((globalDevices[deviceAddr][i+4]<<8)+(globalDevices[deviceAddr][i+5]&255))/2048;
						}
						parsed.sensor_data = fft;
						parsed.sensor_data.xbee_data = globalDevices[deviceAddr];
						delete globalDevices[deviceAddr];
						return parsed;
					}else{
						return;
					}
				}else{
					globalDevices[deviceAddr] = payload.slice(5);
					return;
				}
			}
		}else{
			if(typeof this.sensor_types[parsed.sensor_type] == 'undefined'){
				parsed.sensor_data = {
					type: 'unknown',
					data: payload.slice(8)
				};
				// #OTF
			}else if(parsed.sensor_type == 80 ||  parsed.sensor_type == 81 || parsed.sensor_type == 82 || parsed.sensor_type == 84 || parsed.sensor_type == 515 || parsed.sensor_type == 519){
				parsed.sensor_data = this.sensor_types[parsed.sensor_type].parse(payload, parsed, frame.mac);
				if(!parsed.sensor_data){
					return;
				}
				parsed.sensor_name = this.sensor_types[parsed.sensor_type].name;
			}
			else{
				parsed.sensor_data = this.sensor_types[parsed.sensor_type].parse(payload.slice(8), payload);
				parsed.sensor_name = this.sensor_types[parsed.sensor_type].name;
			}
		}
		return parsed;
	}
	config_reboot_sensor(sensor_mac){
		console.log('config_reboot_sensor: '+sensor_mac)
		var packet = [247, 64, 0, 0, 0];
		return this.config_send(sensor_mac, packet);
	}
	config_set_broadcast(sensor_mac){
		return config_set_destination(sensor_mac, 0x0000FFFF);
	}
	config_set_destination(sensor_mac, modem_mac){
		var packet = [247, 3, 0, 0, 0];
		var bytes = int2Bytes(modem_mac, 4);
		packet.push(...bytes);
		return this.config_send(sensor_mac, packet);
	}
	config_set_id_delay(sensor_mac, node_id, delay_s){
		var packet = [247, 2, 0, 0, 0, node_id];
		var delay_b = int2Bytes(delay_s, 3);
		packet.push(...delay_b);
		return this.config_send(sensor_mac, packet);
	}
	config_set_power(sensor_mac, pwr){
		var packet = [247, 4, 0, 0, 0, pwr];
		return this.config_send(sensor_mac, packet);
	}
	config_set_pan_id(sensor_mac, pan_id){
		var packet = [247, 5, 0, 0, 0];
		packet.push(...int2Bytes(pan_id, 2));
		return this.config_send(sensor_mac, packet);
	}
	config_set_retries(sensor_mac, retries){
		var packet = [247, 6, 0, 0, 0, retries];
		return this.config_send(sensor_mac, packet);
	}
	config_set_change_detection(sensor_mac, enabled, perc, interval){
		if(!perc) perc = 0;
		if(!interval) interval = 0;
		var packet = [247, 7, 0, 0, 0, enabled, perc, interval >> 16, (interval >> 8) & 255, interval & 255];
		return this.config_send(sensor_mac, packet);
	}
	config_set_cm_calibration(sensor_mac, calib){
		var cal = parseInt(calib * 100);
		var packet = [244, 1, 0, 0, 0, cal >> 8, cal & 255];
		return this.config_send(sensor_mac, packet);
	}
	config_set_bp_altitude(sensor_mac, alt){
		var packet = [244, 1, 0, 0, 0, alt >> 8, alt & 255];
		return this.config_send(sensor_mac, packet);
	}
	config_set_bp_pressure(sensor_mac, press){
		var packet = [244, 4, 0, 0, 0, press >> 8, press & 255];
		return this.config_send(sensor_mac, packet);
	}
	config_set_bp_temp_precision(sensor_mac, prec){
		var packet = [244, 2, 0, 0, 0, prec];
		return this.config_send(sensor_mac, packet);
	}
	config_set_bp_press_precision(sensor_mac, prec){
		var packet = [244, 3, 0, 0, 0, prec];
		return this.config_send(sensor_mac, packet);
	}
	config_set_amgt_accel(sensor_mac, range){
		var packet = [244, 1, 0, 0, 0, range];
		return this.config_send(sensor_mac, packet);
	}
	config_set_amgt_magnet(sensor_mac, gain){
		var packet = [244, 2, 0, 0, 0, gain];
		return this.config_send(sensor_mac, packet);
	}
	config_set_amgt_gyro(sensor_mac, scale){
		var packet = [244, 3, 0, 0, 0, scale];
		return this.config_send(sensor_mac, packet);
	}
	config_set_impact_accel(sensor_mac, range){
		var packet = [244, 1, 0, 0, 0, range];
		return this.config_send(sensor_mac, packet);
	}
	config_set_impact_data_rate(sensor_mac, rate){
		var packet = [244, 2, 0, 0, 0, rate];
		return this.config_send(sensor_mac, packet);
	}
	config_set_impact_threshold(sensor_mac, threshold){
		var packet = [244, 3, 0, 0, 0, threshold];
		return this.config_send(sensor_mac, packet);
	}
	config_set_impact_duration(sensor_mac, duration){
		var packet = [244, 4, 0, 0, 0, duration];
		return this.config_send(sensor_mac, packet);
	}
	config_set_filtering(sensor_mac, enable){
		var packet = [244, 2, 0, 0, 0, enable];
		return this.config_send(sensor_mac, packet);
	}
	config_set_data_rate(sensor_mac, data_rate){
		var packet = [244, 3, 0, 0, 0, data_rate];
		return this.config_send(sensor_mac, packet);
	}
	config_set_time_series(sensor_mac, time_series){
		var packet = [244, 8, 0, 0, 0, time_series];
		return this.config_send(sensor_mac, packet);
	}
	config_set_reading_type(sensor_mac, reading_type){
		var packet = [244, 4, 0, 0, 0, reading_type];
		return this.config_send(sensor_mac, packet);
	}

	config_set_sensor_forced_calibration(sensor_mac, value){
		var packet = [244, 31, 0, 0, 0];
		var cal_val = int2Bytes(value, 2);
		packet.push(...cal_val);
		return this.config_send(sensor_mac, packet);
	}
	config_set_output_data_rate_p2_81(sensor_mac, output_rate){
		console.log('config_set_output_data_rate_p2_81');
		var packet = [244, 79, 0, 0, 101, 36, output_rate];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_sampling_duration_p2_81(sensor_mac, sampling_duration){
		console.log('config_set_sampling_duration_p2_81');
		var packet = [244, 79, 0, 0, 101, 38, sampling_duration];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_output_data_rate_101(sensor_mac, output_rate){
		console.log('config_set_output_data_rate_101');
		var packet = [244, 79, 0, 0, 101, 0, output_rate];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_get_output_data_rate_101(sensor_mac, output_rate){
		console.log('config_get_output_data_rate_101');
		var packet = [244, 79, 0, 0, 101, 1];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_sampling_duration_101(sensor_mac, sampling_duration){
		console.log('config_set_sampling_duration_101');
		var packet = [244, 79, 0, 0, 101, 2, sampling_duration];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_get_sampling_duration_101(sensor_mac, sampling_duration){
		console.log('config_get_sampling_duration_101');
		var packet = [244, 79, 0, 0, 101, 3];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_axis_enabled_101(sensor_mac, x_axis, y_axis, z_axis){
		var axis_value = 0;
		console.log('config_set_axis_enabled_101');
		if(x_axis){
			axis_value+=1;
		}
		if(y_axis){
			axis_value+=2;
		}
		if(z_axis){
			axis_value+=4;
		}
		var packet = [244, 79, 0, 0, 101, 4, axis_value];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_get_axis_enabled_101(sensor_mac, x_axis, y_axis, z_axis){
		var axis_value = x_axis+y_axis+z_axis;
		console.log('config_get_axis_enabled_101');
		var packet = [244, 79, 0, 0, 101, 5];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_sampling_interval_101(sensor_mac, sampling_interval){
		console.log('config_set_sampling_interval_101');
		var packet = [244, 79, 0, 0, 101, 6, sampling_interval];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_get_sampling_interval_101(sensor_mac, sampling_interval){
		console.log('config_get_sampling_interval_101');
		var packet = [244, 79, 0, 0, 101, 7];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_full_scale_range_101(sensor_mac, range){
		console.log('config_set_full_scale_range_101');
		var packet = [244, 79, 0, 0, 101, 11, range];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_get_full_scale_range_101(sensor_mac, range){
		console.log('config_get_full_scale_range_101');
		var packet = [244, 79, 0, 0, 101, 12];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}

	config_set_operation_mode_80(sensor_mac, mode){
		console.log('config_set_operation_mode');
		console.log(mode);
		var packet = [244, 79, 0, 0, 0, 9, mode];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_filters_80(sensor_mac, filter){
		console.log('config_set_filters_80');
		var packet = [244, 79, 0, 0, 0, 13, filter];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_low_pass_filter_80(sensor_mac, lp_filter){
		console.log('config_set_low_pass_filters_80');
		var packet = [244, 79, 0, 0, 80, 52, lp_filter];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_high_pass_filter_80(sensor_mac, hp_filter){
		console.log('config_set_high_pass_filters_80');
		var packet = [244, 79, 0, 0, 80, 54, hp_filter];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_low_pass_filter_81_p2(sensor_mac, lp_filter){
		console.log('config_set_low_pass_filter_81_p2');
		var packet = [244, 79, 0, 0, 80, 56, lp_filter];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_high_pass_filter_81_p2(sensor_mac, hp_filter){
		console.log('config_set_high_pass_filter_81_p2');
		var packet = [244, 79, 0, 0, 80, 58, hp_filter];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_measurement_mode_80(sensor_mac, mode){
		console.log('config_set_measurement_mode_80');
		var packet = [244, 79, 0, 0, 0, 15, mode];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_on_request_timeout_80(sensor_mac, timeout){
		console.log('config_set_on_request_timeout_80');
		var packet = [244, 79, 0, 0, 0, 17, timeout];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_deadband_80(sensor_mac, timeout){
		console.log('config_set_deadband_80');
		var packet = [244, 79, 0, 0, 0, 40, timeout];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_current_calibration_individual_80(sensor_mac, value, channel_target){
		console.log('config_set_current_calibration_individual_82');
		var packet = [244, channel_target, 0, 0, 13];
		var cal_val = int2Bytes((value*100), 2);
		packet.push(...cal_val);
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_current_calibration_82(sensor_mac, value){
		console.log('current_calibration_82');
		var packet = [244, 79, 0, 0, 0, 34];
		var cal_val = int2Bytes(value, 4);
		packet.push(...cal_val);
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_led_alert_mode_84(sensor_mac, value){
		console.log('config_set_led_alert_mode_84');
		var packet = [244, 79, 0, 0, 0, 66, value];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_led_accelerometer_threshold_84(sensor_mac, value){
		console.log('config_set_led_accelerometer_threshold_84');
		var packet = [244, 79, 0, 0, 0, 62, value];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_led_velocity_threshold_84(sensor_mac, value){
		console.log('config_set_led_velocity_threshold_84');
		var packet = [244, 79, 0, 0, 0, 64, value];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_acceleration_interrupt_threshold_84(sensor_mac, value){
		console.log('config_set_acceleration_interrupt_threshold_84');
		var packet = [244, 79, 0, 0, 0, 60, value];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_get_sampling_interval_101(sensor_mac, sampling_interval){
		console.log('config_get_sampling_interval_101');
		var packet = [244, 79, 0, 0, 101, 7];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_full_scale_range_101(sensor_mac, range){
		console.log('config_set_full_scale_range_101');
		var packet = [244, 79, 0, 0, 101, 11, range];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_get_full_scale_range_101(sensor_mac, range){
		console.log('config_get_full_scale_range_101');
		var packet = [244, 79, 0, 0, 101, 12];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_rtc_101(sensor_mac){
		console.log('config_set_rtc_101');
		console.log(sensor_mac);
		var date = new Date();
		var packet = [244, 79, 0, 0, 101, 8, date.getHours(), date.getMinutes(), date.getSeconds()];
		console.log(packet);
		delete this.fly_101_in_progress;
		return this.config_send(sensor_mac, packet);
	}
	config_set_roll_threshold_47(sensor_mac, threshold){
		console.log('config_set_pitch_threshold_47');
		var packet = [244, 1, 0, 0, 47, 0, threshold];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_pitch_threshold_47(sensor_mac, threshold){
		console.log('config_set_pitch_threshold_47');
		var packet = [244, 3, 0, 0, 47, 0, threshold];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_sensor_boot_time_420ma(sensor_mac, value){
		console.log('sensor_boot_time_420ma');
		var packet = [244, 68, 0, 0, 45, value];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_payload_length_80(sensor_mac, value){
		console.log('config_set_payload_length_80');
		var packet = [244, 79, 0, 0, 80, 68, value];
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}
	config_set_counter_threshold_35(sensor_mac, value){
		console.log('config_set_counter_threshold_35');
		let packet = [244, 1, 0, 0, 23];
		let threshold = int2Bytes((value), 2);
		packet.push(...threshold);
		console.log(packet);
		return this.config_send(sensor_mac, packet);
	}

	config_get_delay(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [247, 21, 0, 0, 0]).then((res) => {
				fulfill({
					nodeId: res.nodeId,
					delay: res.data.slice(0, 3).reduce(msbLsb)
				});
			}).catch(reject);
		});
	}
	config_get_power(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [247, 22, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_get_retries(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [247, 23, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_get_destination(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [247, 24, 0, 0, 0]).then((res) => {
				fulfill(toMac(res.data.slice(0, 4)));
			}).catch(reject);
		});
	}
	config_get_pan_id(sensor_mac, node_id, sensor_type){

		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [247, 25, 0, 0, 0]).then((res) => {
				fulfill(res.data.slice(0, 2).reduce(msbLsb));
			}).catch(reject);
		});
	}
	config_get_change_detection(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [247, 26, 0, 0, 0]).then((res) => {
				fulfill({
					enabled: res[0],
					threshold: res[1],
					interval: res.data.slice(2, 5).reduce(msbLsb)
				});
			}).catch(reject);
		});
	}
	config_get_cm_calibration(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [244, 2, 0, 0, 0]).then((res) => {
				fulfill(res.data.slice(0, 2).reduce(msbLsb) / 100);
			}).catch(reject);
		});
	}
	config_get_bp_altitude(sensor_mac){
		this.config_send(sensor_mac, [244, 5, 0, 0, 0]).then((res) => {
			fulfill(res.data.slice(0, 2).reduce(msbLsb));
		}).catch(reject);
	}
	config_get_bp_pressure(sensor_mac){
		this.config_send(sensor_mac, [244, 8, 0, 0, 0]).then((res) => {
			fulfill(res.data.slice(0, 2).reduce(msbLsb));
		}).catch(reject);
	}
	config_get_bp_temp_precision(sensor_mac){
		return this.config_send(sensor_mac, [244, 6, 0, 0, 0]);
	}
	config_get_bp_press_precision(sensor_mac){
		return this.config_send(sensor_mac, [244, 7, 0, 0, 0]);
	}
	config_get_amgt_accel(sensor_mac){
		return this.config_send(sensor_mac, [244, 4, 0, 0, 0]);
	}
	config_get_amgt_magnet(sensor_mac){
		return this.config_send(sensor_mac, [244, 5, 0, 0, 0]);
	}
	config_get_amgt_gyro(sensor_mac){
		return this.config_send(sensor_mac, [244, 6, 0, 0, 0]);
	}
	config_get_impact_accel(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [244, 5, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_get_impact_data_rate(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [244, 6, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_get_impact_threshold(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [244, 7, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_get_impact_duration(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [244, 8, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_get_activ_interr(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [244, 10, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_get_filtering(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [244, 5, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_get_data_rate(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [244, 6, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_get_time_series(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [244, 9, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_get_reading_type(sensor_mac){
		return new Promise((fulfill, reject) => {
			this.config_send(sensor_mac, [244, 7, 0, 0, 0]).then((res) => {
				fulfill(res.data[0]);
			}).catch(reject);
		});
	}
	config_enable_encryption(sensor_mac){
		return this.config_send(sensor_mac, [242, 1, 0, 0, 0]);
	}
	config_enter_otn_mode(sensor_mac){
		console.log('config_enter_otn_mode');
		// F4 4F 00 00 65 32
		// This command is used for OTF on types 53, 80,81,82,83,84, 101, 102 , 518,519
		return this.config_send(sensor_mac, [244, 79, 0, 0, 101, 50]);
		// return this.config_send('00:00:00:00:00:00:FF:FF', [244, 79, 0, 0, 101, 50]);
	}
	config_exit_otn_mode(sensor_mac){
		console.log('config_exit_otn_mode');
		// F4 4F 00 00 65 33
		// This command is used for OTF on types 53, 80,81,82,83,84, 101, 102 , 518,519
		return this.config_send(sensor_mac, [244, 79, 0, 0, 101, 51]);
		// return this.config_send('00:00:00:00:00:00:FF:FF', [244, 79, 0, 0, 101, 50]);
	}
	config_enter_otn_mode_common(sensor_mac){
		console.log('config_enter_otn_mode_common');
		return this.config_send(sensor_mac, [247, 54, 0, 0, 0]);
		// return this.config_send('00:00:00:00:00:00:FF:FF', [244, 79, 0, 0, 101, 50]);
	}
	config_exit_otn_mode_common(sensor_mac){
		console.log('config_exit_otn_mode_common');
		return this.config_send(sensor_mac, [247, 55, 0, 0, 0]);
		// return this.config_send('00:00:00:00:00:00:FF:FF', [244, 79, 0, 0, 101, 50]);
	}
	config_disable_encryption(sensor_mac){
		return this.config_send(sensor_mac, [242, 2, 0, 0, 0]);
	}
	config_set_encryption(sensor_mac, ...key){
		if(key[0].constructor == Array) key = key[0];
		var packet = [242, 1];
		packet.push(...key);
		return this.config_send(sensor_mac, packet);
	}
	config_powered_device(sensor_mac, param, ...data){
		var params = {
			destination: 0,
			network_id: 1,
			power: 2,
			retries: 3,
			node_id: 4,
			delay: 5
		};
		return this.config_send(sensor_mac, [(data ? 247 : 248), params[param], ...data]);
	}
	config_send(sensor_mac, data, opts){
		var that = this;
		return new Promise((fulfill, reject) => {
			that.queue.add(() => {
				return new Promise((f, r) => {
					var tout;
					function fail(packet){
						that._emitter.removeListener('config_ack-'+sensor_mac, pass);
						clearTimeout(tout);
						reject({
							err: packet,
							sent: [mac2bytes(sensor_mac), data, opts]
						});
						f();
					}
					function pass(packet){
						clearTimeout(tout);
						that._emitter.removeListener('config_error-'+sensor_mac, fail);
						fulfill(packet);
						f();
					};

					that._emitter.once('config_ack-'+sensor_mac, pass);
					that._emitter.once('config_error-'+sensor_mac, fail);
					tout = setTimeout(() => {
						that._emitter.removeListener('config_error-'+sensor_mac, fail);
						that._emitter.removeListener('config_ack-'+sensor_mac, pass);
						//console.log(data, packet);
						if(sensor_mac == '00:00:00:00:00:00:FF:FF'){
							reject({
								res: 'Broadcast mode, no target device',
								sent: [mac2bytes(sensor_mac), data, opts]
							});
						}else{
							reject({
								err: 'No config err or ack, timeout',
								sent: [mac2bytes(sensor_mac), data, opts]
							});
						}

						f();
					}, 1500);
					that.send.transmit_request(mac2bytes(sensor_mac), data, opts).then().catch((err) => {
						that._emitter.removeListener('config_error-'+sensor_mac, fail);
						that._emitter.removeListener('config_ack-'+sensor_mac, pass);
						reject({
							err: err,
							sent: [mac2bytes(sensor_mac), data, opts]
						});
						f();
					}).then();
				});
			});
			this.queue.add(() => {
				return new Promise((f, r) => {
					setTimeout(f, 500);
				});
			});
		});
	}
	build_102_data(payload, deviceAddr, hour, minute, sdata_start, current_packet, firmware){
		if(current_packet != 1){
			console.log('bad packet cleanup');
			return;
		}
		// var odr;
		var odr = payload[8];
		var device_temp = msbLsb(payload[11], payload[12])/100;
		var probe_temp = msbLsb(payload[13], payload[14])/100;

		switch(odr){
			case 6:
				odr = 50;
				break;
			case 7:
				odr = 100;
				break;
			case 8:
				odr = 200;
				break;
			case 9:
				odr = 400;
				break;
			case 10:
				odr = 800;
				break;
			case 11:
				odr = 1600;
				break;
			default:
				odr = 0;
		}
		globalDevices[deviceAddr] = {
			// stream_size: expected_packets,
			data: {},
			odr: odr,
			// mo: payload[8],
			// en_axis: en_axis,
			hour: hour,
			minute: minute,
			device_temp: device_temp,
			probe_temp: probe_temp
		}
		globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);

		return;
	}
	build_101_data(payload, deviceAddr, hour, minute, sdata_start, current_packet, firmware){
		if(current_packet != 1){
			console.log('bad packet cleanup');
			return;
		}
		var mode = payload[8];
		var odr = payload[9];
		var en_axis = payload[10] & 7;
		var fsr = payload[10] >> 5;
		var device_temp = msbLsb(payload[13], payload[14])/100;
		switch(odr){
			case 0:
				odr = 4000;
				break;
			case 1:
				odr = 2000;
				break;
			case 2:
				odr = 1000;
				break;
			case 3:
				odr = 500;
				break;
			case 4:
				odr = 250;
				break;
			case 5:
				odr = 125;
				break;
			case 6:
				odr = 62.5;
				break;
			case 7:
				odr = 31.25;
				break;
			case 8:
				odr = 15.625;
				break;
			case 9:
				odr = 7.813;
				break;
			case 10:
				odr = 3.906;
				break;
			default:
				odr = 0;
		}
		globalDevices[deviceAddr] = {
			// stream_size: expected_packets,
			data: {},
			odr: odr,
			mo: mode,
			fsr: fsr,
			en_axis: en_axis,
			hour: hour,
			minute: minute,
			device_temp: device_temp,
		}
		if(firmware > 0){
			var probe_temp = msbLsb(payload[15], payload[16])/100;
			globalDevices[deviceAddr].probe_temp = probe_temp;
		}
		globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);

		return;
	}
	control_send(sensor_mac, data, opts){
		var that = this;
		return new Promise((fulfill, reject) => {
			that.queue.add(() => {
				return new Promise((f, r) => {
					var failed = false;
					var retries = 0;
					var tO;
					function fail(packet){
						failed = true;
						clearTimeout(tO);
						that._emitter.removeListener('receive_packet-'+sensor_mac, pass);
						that._emitter.removeListener('transmit_status-'+sensor_mac, pass);
						reject({
							err: packet,
							sent: [sensor_mac, data]
						});
						r();
					}
					function pass(packet){
						if(failed) return;
						clearTimeout(tO);
						fulfill(packet);
						f();
					};

					function send(){
						that.send.transmit_request(mac2bytes(sensor_mac), data, opts).then(function(frame){
							if(frame.delivery_status == 'Success'){
								pass(frame);
							}else{
								tO = setTimeout(() => {
									if(retries < 1){
										retries++;
										send();
									}else{
										fail('Control response timeout');
									}
								}, 1000);
							}
						}).catch(fail);
					}
					send();
				});
			});
		});
	}
	on(e,cb){this._emitter.on(e,cb);}
};

function sensor_types(parent){
	var types = {
		'1': {
			name: 'Temperature/Humidity',
			parse: (d) => {
				return {
					humidity: msbLsb(d[0], d[1])/100,
					temperature: signInt((msbLsb(d[2], d[3])), 16)/100
				};
			}
		},
		'2': {
			name: '2 Channel Push Notification',
			parse: (d) => {
				return {
					input_1: d[0],
					input_2: d[1]
				};
			}
		},
		'3': {
			name: 'ADC',
			parse: (d) => {
				return {
					input_1: msbLsb(d[0], d[1]),
					input_2: msbLsb(d[2], d[3])
				};
			}
		},
		'4': {
			name: 'Thermocouple',
			parse: (d) => {
				return {
					temperature: signInt(d.slice(0, 4).reduce(msbLsb), 32)/100,
				};
			}
		},
		'5': {
			name: 'Gyro/Magneto/Temperature',
			parse: (d) => {
				return {
					accel_x: signInt(d.slice(0, 3).reduce(msbLsb), 24)/100,
					accel_y: signInt(d.slice(3, 6).reduce(msbLsb), 24)/100,
					accel_z: signInt(d.slice(6, 9).reduce(msbLsb), 24)/100,
					magneto_x: signInt(d.slice(9, 12).reduce(msbLsb), 24)/100,
					magneto_y: signInt(d.slice(12, 15).reduce(msbLsb), 24)/100,
					magneto_z: signInt(d.slice(15, 18).reduce(msbLsb), 24)/100,
					gyro_x: signInt(d.slice(18, 21).reduce(msbLsb), 24),
					gyro_y: signInt(d.slice(21, 24).reduce(msbLsb), 24),
					gyro_z: signInt(d.slice(24, 27).reduce(msbLsb), 24),
					temperature: signInt(msbLsb(d[27], d[28]), 16)
				};
			}
		},
		'6': {
			name: 'Temperature/Barometeric Pressure',
			parse: (d) => {
				return {
					temperature: signInt(msbLsb(d[0], d[1]), 16),
					absolute_pressure: msbLsb(d[2], d[3])/1000,
					relative_pressure: signInt(msbLsb(d[4], d[5]), 16)/1000,
					altitude_change: signInt(msbLsb(d[6], d[7]), 16)/100
				};
			}
		},
		'7': {
			name: 'Impact Detection',
			parse: (d) => {
				return {
					acc_x1: signInt(d.slice(0, 2).reduce(msbLsb), 16),
					acc_x2: signInt(d.slice(2, 4).reduce(msbLsb), 16),
					acc_x: signInt(d.slice(4, 6).reduce(msbLsb), 16),
					acc_y1: signInt(d.slice(6, 8).reduce(msbLsb), 16),
					acc_y2: signInt(d.slice(8, 10).reduce(msbLsb), 16),
					acc_y: signInt(d.slice(10, 12).reduce(msbLsb), 16),
					acc_z1: signInt(d.slice(12, 14).reduce(msbLsb), 16),
					acc_z2: signInt(d.slice(14, 16).reduce(msbLsb), 16),
					acc_z: signInt(d.slice(16, 18).reduce(msbLsb), 16),
					temp_change: signInt(d.slice(18, 20).reduce(msbLsb), 16)
				};
			}
		},
		'8': {
			name: 'Vibration',
			parse: (d) => {
				return {
					rms_x: signInt(d.slice(0, 3).reduce(msbLsb), 24)/100,
					rms_y: signInt(d.slice(3, 6).reduce(msbLsb), 24)/100,
					rms_z: signInt(d.slice(6, 9).reduce(msbLsb), 24)/100,
					max_x: signInt(d.slice(9, 12).reduce(msbLsb), 24)/100,
					max_y: signInt(d.slice(12, 15).reduce(msbLsb), 24)/100,
					max_z: signInt(d.slice(15, 18).reduce(msbLsb), 24)/100,
					min_x: signInt(d.slice(18, 21).reduce(msbLsb), 24)/100,
					min_y: signInt(d.slice(21, 24).reduce(msbLsb), 24)/100,
					min_z: signInt(d.slice(24, 27).reduce(msbLsb), 24)/100,
					temperature: signInt(msbLsb(d[27], d[28]), 16)
				};
			}
		},
		'9': {
			name: 'Proximity',
			parse: (d) => {
				return {
					proximity: msbLsb(d[0], d[1]),
					lux: msbLsb(d[2], d[3]) * .25
				};
			}
		},
		'10': {
			name: 'Light',
			parse: (d) => {
				return {
					lux: d.slice(0, 3).reduce(msbLsb)
				};
			}
		},
		'12': {
			name: '3-Channel Thermocouple',
			parse: (d) => {
				return {
					channel_1: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					channel_2: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
					channel_3: signInt(d.slice(8, 12).reduce(msbLsb), 32) / 100
				};
			}
		},
		'13': {
			name: 'Current Monitor',
			parse: (d) => {
				return {
					amps: d.slice(0, 3).reduce(msbLsb)/1000
				};
			}
		},
		'14': {
			name: '10-Bit 1-Channel 4-20mA',
			parse: (d) => {
				var adc = d.slice(0, 2).reduce(msbLsb);
				return {
					adc: adc,
					mA: adc * 20 / 998
				};
			}
		},
		'15': {
			name: '10-Bit 1-Channel ADC',
			parse: (d) => {
				var adc = d.slice(0, 2).reduce(msbLsb);
				return {
					adc: adc,
					voltage: adc * 0.00322265625
				};
			}
		},
		'16': {
			name: 'Soil Moisture Sensor',
			parse: (d) => {
				var adc1 = d.slice(0, 2).reduce(msbLsb);
				var adc2 = d.slice(2, 4).reduce(msbLsb);
				return {
					adc1: adc1,
					adc2: adc2,
					voltage1: adc1 * 0.00322265625,
					voltage2: adc2 * 0.00322265625,
					percentage: adc1 > 870 ? 100 : Math.round(adc1 / 870 * 100)
				};
			}
		},
		'17': {
			name: '24-Bit AC Voltage Monitor',
			parse: (d) => {
				return {
					voltage: d.slice(0, 3).reduce(msbLsb) / 1000
				};
			}
		},
		'18': {
			name: 'Pulse/Frequency Meter',
			parse: (d) => {
				return {
					frequency: d.slice(0, 3).reduce(msbLsb) / 1000,
					duty_cycle: d.slice(3, 5).reduce(msbLsb) / 100
				};
			}
		},
		'19': {
			name: '2-channel 24-bit Current Monitor',
			parse: (d) => {
				return {
					channel_1: d.slice(0, 3).reduce(msbLsb),
					channel_2: d.slice(4, 7).reduce(msbLsb),
				};
			}
		},
		'20': {
			name: 'Precision Pressure & Temperature (pA)',
			parse: (d) => {
				return {
					pressure: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 1000,
					temperature: signInt(d.slice(4, 6).reduce(msbLsb), 16) / 100
				};
			}
		},
		'21': {
			name: 'AMS Pressure & Temperature',
			parse: (d) => {
				return {
					pressure: signInt(d.slice(0, 2).reduce(msbLsb), 16) / 100,
					temperature: signInt(d.slice(2, 4).reduce(msbLsb), 16) / 100,
				};
			}
		},
		'22': {
			name: 'Voltage Detection Input',
			parse: (d) => {
				return {
					input: d[0]
				};
			}
		},
		'23': {
			name: '2-Channel Thermocouple',
			parse: (d) => {
				return {
					channel_1: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					channel_2: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
				};
			}
		},
		'24': {
			name: 'Activity Detection',
			parse: (d) => {
				return {
					acc_x: signInt(d.slice(0, 2).reduce(msbLsb), 16),
					acc_y: signInt(d.slice(2, 4).reduce(msbLsb), 16),
					acc_z: signInt(d.slice(4, 6).reduce(msbLsb), 16),
					temp_change: signInt(d.slice(6, 8).reduce(msbLsb), 16),
				};
			}
		},
		'25': {
			name: 'Asset Monitor',
			parse: (d) => {
				return {
					acc_x: signInt(d.slice(0, 2).reduce(msbLsb), 16),
					acc_y: signInt(d.slice(2, 4).reduce(msbLsb), 16),
					acc_z: signInt(d.slice(4, 6).reduce(msbLsb), 16),
					temp_change: signInt(d.slice(6, 8).reduce(msbLsb), 16),
				};
			}
		},
		'26': {
			name: 'Pressure & Temperature Sensor (PSI)',
			parse: (d) => {
				return {
					pressure: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					temperature: signInt(d.slice(4, 6).reduce(msbLsb), 16) / 100
				};
			}
		},
		'27': {
			name: 'Environmental',
			parse: (d) => {
				return {
					temperature: signInt(d.slice(0, 2).reduce(msbLsb), 16) / 100,
					pressure: d.slice(2, 6).reduce(msbLsb) / 100,
					humidity: d.slice(6, 10).reduce(msbLsb) / 1000,
					gas_resistance: d.slice(10, 14).reduce(msbLsb),
					iaq: d.slice(14, 16).reduce(msbLsb)

				};
			}
		},
		'28': {
			'name': '24-Bit 3-Channel Current Monitor',
			parse: (d) => {
				return {
					channel_1: d.slice(0, 3).reduce(msbLsb),
					channel_2: d.slice(4, 7).reduce(msbLsb),
					channel_3: d.slice(8, 11).reduce(msbLsb)
				};
			}
		},
		'29': {
			'name': 'Linear Displacement Sensor',
			parse: (d) => {
				var adc = d.slice(0, 2).reduce(msbLsb);
				return {
					adc: adc,
					position: adc/1023*100,
				};
			}
		},
		'30': {
			'name': 'Structural Monitoring Sensor',
			parse: (d) => {
				var adc = d.slice(0, 2).reduce(msbLsb);
				return {
					adc: adc,
					position: adc/1023*100,
				};
			}
		},
		'31': {
			name: 'Temperature/Humidity VOC Sensor',
			parse: (d) => {
				return {
					humidity: 		d.slice(0, 2).reduce(msbLsb) / 100,
					temperature: 	signInt(d.slice(2, 4).reduce(msbLsb), 16) / 100,
					voc: 			d.slice(4, 6).reduce(msbLsb)
				};
			}
		},
		'32': {
			'name': 'Particulate Matter Sensor',
			parse: (d) => {
				return {
					mass_concentration_1_0:    d.slice(0, 4).reduce(msbLsb)/100,
					mass_concentration_2_5:    d.slice(4, 8).reduce(msbLsb)/100,
					mass_concentration_4_0:    d.slice(8, 12).reduce(msbLsb)/100,
					mass_concentration_10_0:   d.slice(12, 16).reduce(msbLsb)/100,
					number_concentration_0_5:  d.slice(16, 20).reduce(msbLsb)/100,
					number_concentration_1_0:  d.slice(20, 24).reduce(msbLsb)/100,
					number_concentration_2_5:  d.slice(24, 28).reduce(msbLsb)/100,
					number_concentration_4_0:  d.slice(28, 32).reduce(msbLsb)/100,
					number_concentration_10_0: d.slice(32, 36).reduce(msbLsb)/100,
					typical_size:              d.slice(36, 40).reduce(msbLsb)/100,
					Humidity:              d.slice(40, 42).reduce(msbLsb)/100,
					Temperature:              d.slice(42, 44).reduce(msbLsb)/100

				};
			}
		},
		'33': {
			name: 'AC Current Detect Sensor',
			parse: (d) => {
				return {
					input_1: d[0]
				};
			}
		},
		'34': {
			name: 'Tank Level Sensor',
			parse: (d) => {
				return {
					level: msbLsb(d[0], d[1])
				};
			}
		},
		'35': {
			name: 'One Channel Counter',
			parse: (d) => {
				return {
					counts: d.slice(0, 4).reduce(msbLsb)
				};
			}
		},
		'36': {
			name: 'Two Channel Counter',
			parse: (d) => {
				return {
					counts_1: msbLsb(d[0], d[1]),
					counts_2: msbLsb(d[2], d[3])
				};
			}
		},
		'37': {
			name: '7 Channel Push Notification',
			parse: (d) => {
				return {
					input_1: d[0] & 1 ? 1 : 0,
					input_2: d[0] & 2 ? 1 : 0,
					input_3: d[0] & 4 ? 1 : 0,
					input_4: d[0] & 8 ? 1 : 0,
					input_5: d[0] & 16 ? 1 : 0,
					input_6: d[0] & 32 ? 1 : 0,
					input_7: d[0] & 64 ? 1 : 0,
					adc_1: msbLsb(d[1], d[2]),
					adc_2: msbLsb(d[3], d[4]),
				};
			}
		},
		'39': {
			name: 'RTD Temperature Sensor',
			parse: (d) => {
				return {
					temperature: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100
				};
			}
		},
		'40': {
			name: 'Vibration w/Time Domain (partial support)',
			parse: (d, full) => {
				var status = {
					0: 'Valid',
					63: 'Invalid Argument',
					62: 'Internal Sensor Communication Failure',
					61: 'Invalid Sensor Discovery',
					60: 'Invalid Length',
					59: 'ASIC Test Failure',
					58: 'Device Initialization Failure',
					57: 'Soft Reset Failure'
				};
				return {
					status: status[full[7] >> 2],
					reserve: full[7],
					data_type: ['unknown', 'Acceleration', 'Velocity', 'Time Domain'][full[7] & 3],
					rms_x: signInt(d.slice(0, 3).reduce(msbLsb), 24)/100,
					rms_y: signInt(d.slice(3, 6).reduce(msbLsb), 24)/100,
					rms_z: signInt(d.slice(6, 9).reduce(msbLsb), 24)/100,
					max_x: signInt(d.slice(9, 12).reduce(msbLsb), 24)/100,
					max_y: signInt(d.slice(12, 15).reduce(msbLsb), 24)/100,
					max_z: signInt(d.slice(15, 18).reduce(msbLsb), 24)/100,
					min_x: signInt(d.slice(18, 21).reduce(msbLsb), 24)/100,
					min_y: signInt(d.slice(21, 24).reduce(msbLsb), 24)/100,
					min_z: signInt(d.slice(24, 27).reduce(msbLsb), 24)/100,
					temperature: signInt(msbLsb(d[27], d[28]), 16)
				};
			}
		},
		'41': {
			name: 'RPM',
			parse: (d) => {
				return {
					proximity: msbLsb(d[0], d[1]),
					rpm: msbLsb(d[2], d[3]) * .25
				};
			}
		},
		'42': {
			name: '0-24VDC Voltage Monitor',
			parse: (d) => {
				var adc = d.slice(0, 2).reduce(msbLsb);
				return {
					adc: adc,
					voltage: adc * 0.00122265625
				};
			}
		},
		'44': {
			name: 'Wireless CO2 Gas Sensor',
			parse: (d) => {
				return {
					CO2:    d.slice(0, 4).reduce(msbLsb)/100,
					humidity: msbLsb(d[4], d[5])/100,
					temperature: signInt((msbLsb(d[6], d[7])), 16)/100
				};
			}
		},
		'45': {
			name: '16-Bit 1-Channel Passive 4-20mA Current Receiver',
			parse: (d) => {
				return {
					adc: signInt(d.slice(0, 2).reduce(msbLsb), 16),
					mA: signInt(d.slice(2, 4).reduce(msbLsb), 16)/100
					};
			}
		},
		'46': {
			name: 'Motion Detection Sensor',
			parse: (d) => {
				return {
					input_1: d[0]
				};
			}
		},
		'47': {
			name: 'Wireless Tilt Sensor',
			parse: (d) => {
				return {
					Roll: signInt(d.slice(0, 2).reduce(msbLsb), 16) / 100,
					Pitch: signInt(d.slice(2, 4).reduce(msbLsb), 16) / 100
				};
			}
		},
		'48': {
			name: '16-Bit 1-Channel Active 4-20mA Current Loop Receiver',
			parse: (d) => {
				return {
					adc: signInt(d.slice(0, 2).reduce(msbLsb), 16),
					mA: signInt(d.slice(2, 4).reduce(msbLsb), 16)/100
					};
			}
		},
		'49': {
			name: '6-Channel Thermocouple',
			parse: (d) => {
				return {
					channel_1: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					channel_2: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
					channel_3: signInt(d.slice(8, 12).reduce(msbLsb), 32) / 100,
					channel_4: signInt(d.slice(12, 16).reduce(msbLsb), 32) / 100,
					channel_5: signInt(d.slice(16, 20).reduce(msbLsb), 32) / 100,
					channel_6: signInt(d.slice(20, 24).reduce(msbLsb), 32) / 100
				};
			}
		},
		'50': {
			name: 'Predictive Maintenance Sensor',
			parse: (d) => {
				return {
					rms_x: signInt(d.slice(0, 3).reduce(msbLsb), 24)/100,
					rms_y: signInt(d.slice(3, 6).reduce(msbLsb), 24)/100,
					rms_z: signInt(d.slice(6, 9).reduce(msbLsb), 24)/100,
					max_x: signInt(d.slice(9, 12).reduce(msbLsb), 24)/100,
					max_y: signInt(d.slice(12, 15).reduce(msbLsb), 24)/100,
					max_z: signInt(d.slice(15, 18).reduce(msbLsb), 24)/100,
					min_x: signInt(d.slice(18, 21).reduce(msbLsb), 24)/100,
					min_y: signInt(d.slice(21, 24).reduce(msbLsb), 24)/100,
					min_z: signInt(d.slice(24, 27).reduce(msbLsb), 24)/100,
					vibration_temperature: signInt(msbLsb(d[27], d[28]), 16),
					thermocouple_temperature: signInt(d.slice(29, 33).reduce(msbLsb), 32) / 100,
					current: signInt(d.slice(33, 36).reduce(msbLsb), 24) / 1000
				};
			}
		},
		'51': {
			'name': '24-Bit 6-Channel Current Monitor',
			parse: (d) => {
				return {
					channel_1: d.slice(0, 3).reduce(msbLsb),
					channel_2: d.slice(4, 7).reduce(msbLsb),
					channel_3: d.slice(8, 11).reduce(msbLsb),
					channel_1: d.slice(12, 15).reduce(msbLsb),
					channel_2: d.slice(16, 19).reduce(msbLsb),
					channel_3: d.slice(20, 23).reduce(msbLsb)
				};
			}
		},
		'52': {
			name: '16-Bit 2-Channel 4-20mA',
			parse: (d) => {
				var adc1 = signInt(d.slice(0, 2).reduce(msbLsb));
				var adc2 = signInt(d.slice(2, 4).reduce(msbLsb));
				return {
					adc1: adc1,
					adc2: adc2,
					mA1: adc1 * 0.0006863,
					mA2: adc2 * 0.0006863,
					byteOne: d[0],
					byteTwo: d[1],
					byteThree: d[2],
					byteFour: d[3]
				};
			}
		},
		'53': {
			'name': 'Air Quality CO2 and Particulate Matter Sensor',
			parse: (d) => {
				return {
					mass_concentration_1_0:    d.slice(0, 4).reduce(msbLsb)/100,
					mass_concentration_2_5:    d.slice(4, 8).reduce(msbLsb)/100,
					mass_concentration_4_0:    d.slice(8, 12).reduce(msbLsb)/100,
					mass_concentration_10_0:   d.slice(12, 16).reduce(msbLsb)/100,
					number_concentration_0_5:  d.slice(16, 20).reduce(msbLsb)/100,
					number_concentration_1_0:  d.slice(20, 24).reduce(msbLsb)/100,
					number_concentration_2_5:  d.slice(24, 28).reduce(msbLsb)/100,
					number_concentration_4_0:  d.slice(28, 32).reduce(msbLsb)/100,
					number_concentration_10_0: d.slice(32, 36).reduce(msbLsb)/100,
					typical_size:              d.slice(36, 40).reduce(msbLsb)/100,
					Humidity:              d.slice(40, 42).reduce(msbLsb)/100,
					Temperature:              d.slice(42, 44).reduce(msbLsb)/100,
					CO2:              d.slice(44, 48).reduce(msbLsb)/100

				};
			}
		},
		'54': {
			name: '3 Channel RTD',
			parse: (d) => {
				return {
					temperature_1: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					temperature_2: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
					temperature_3: signInt(d.slice(8, 12).reduce(msbLsb), 32) / 100
				};
			}
		},
		'56': {
			name: '2 Channel 0-10VDC Receiver',
			parse: (d) => {
				var adc1 = signInt(d.slice(0, 2).reduce(msbLsb));
				var adc2 = signInt(d.slice(2, 4).reduce(msbLsb));
				return {
					adc1: adc1,
					adc2: adc2,
					VDC1: adc1 * 0.00034122,
					VDC2: adc2 * 0.00034122,
					byteOne: d[0],
					byteTwo: d[1],
					byteThree: d[2],
					byteFour: d[3]
				};
			}
		},
		'60': {
			name: 'Air Velocity and Precision Pressure & Temperature Sensor',
			parse: (d) => {
				return {
					pressure: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 1000,
					temperature: signInt(d.slice(4, 6).reduce(msbLsb), 16) / 100,
					Air_Velocity: signInt(d.slice(6, 8).reduce(msbLsb), 16) / 1000
				};
			}
		},

		'61': {
			name: 'pH and Temperature Sensor',
			parse: (d) => {
				return {
					pH: signInt(d.slice(0, 2).reduce(msbLsb), 16) / 100,
					Temp: signInt(d.slice(2, 4).reduce(msbLsb),16) / 100
				};
			}
		},
		'62': {
			name: 'ORP and Temperature Sensor',
			parse: (d) => {
				return {
					ORP: signInt(d.slice(0, 2).reduce(msbLsb), 16) / 100,
					Temp: signInt(d.slice(2, 4).reduce(msbLsb),16) / 100
				};
			}
		},
		'63': {
			name: 'ORP, pH and Temperature Sensor',
			parse: (d) => {
				return {
					ORP: signInt(d.slice(0, 2).reduce(msbLsb), 16) / 100,
					Temp: signInt(d.slice(2, 4).reduce(msbLsb),16) / 100,
					pH: signInt(d.slice(4, 6).reduce(msbLsb), 16) / 100,
					Temp: signInt(d.slice(6, 8).reduce(msbLsb),16) / 100
				};
			}
		},
		'64': {
			name: 'EC Salinity TDS and Temperature Sensor',
			parse: (d) => {
				return {
					EC: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					TDS: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
					Salinity: signInt(d.slice(8, 12).reduce(msbLsb), 32) / 100,
					Temp: signInt(d.slice(12, 14).reduce(msbLsb),16) / 100
				};
			}
		},

		'65': {
			name: 'Dissolved Oxygen and Temperature Sensor',
			parse: (d) => {
				return {
					DO: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					DO_Saturation: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
					Temp: signInt(d.slice(8, 10).reduce(msbLsb),16) / 100
				};
			}
		},

		'66': {
			name: 'EC and Dissolved Oxygen and Temperature Sensor',
			parse: (d) => {
				return {
					EC: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					TDS: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
					Salinity: signInt(d.slice(8, 12).reduce(msbLsb), 32) / 100,
					Temp: signInt(d.slice(12, 14).reduce(msbLsb),16) / 100,
					DO: signInt(d.slice(14, 18).reduce(msbLsb), 32) / 100,
					DO_Saturation: signInt(d.slice(18, 22).reduce(msbLsb), 32) / 100,
					Temp_DO: signInt(d.slice(22, 24).reduce(msbLsb),16) / 100
				};
			}
		},

		'67': {
			name: 'PAR Sensor',
			parse: (d) => {
				return {
					PAR: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100
				};
			}
		},
		'69': {
			name: 'Soil Moisture Temperature EC Sensor',
			parse: (d) => {
				return {
					Moisture: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					Temperature: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
					EC: signInt(d.slice(8, 12).reduce(msbLsb), 32) / 100
				};
			}
		},

		'71': {
			name: '3 Channel Soil Moisture Temperature and EC Sensor',
			parse: (d) => {
				return {
					Moisture1: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					Temperature1: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
					EC1: signInt(d.slice(8, 12).reduce(msbLsb), 32) / 100,
					Salinity1: signInt(d.slice(12, 16).reduce(msbLsb), 32) / 100,

					Moisture2: signInt(d.slice(16, 20).reduce(msbLsb), 32) / 100,
					Temperature2: signInt(d.slice(20, 24).reduce(msbLsb), 32) / 100,
					EC2: signInt(d.slice(24, 28).reduce(msbLsb), 32) / 100,
					Salinity2: signInt(d.slice(28, 32).reduce(msbLsb), 32) / 100,

					Moisture3: signInt(d.slice(32, 36).reduce(msbLsb), 32) / 100,
					Temperature3: signInt(d.slice(36, 40).reduce(msbLsb), 32) / 100,
					EC3: signInt(d.slice(40, 44).reduce(msbLsb), 32) / 100,
					Salinity3: signInt(d.slice(44, 48).reduce(msbLsb), 32) / 100
				};
			}
		},

		'72': {
			name: 'SDI-12 Wireelss',
			parse: (d) => {
				return {
					Temperature: signInt(d.slice(0, 2).reduce(msbLsb), 16)/100,
					Soil_Moisture: signInt(d.slice(2, 4).reduce(msbLsb), 16)/100,
					Bulk_EC: signInt(d.slice(4, 6).reduce(msbLsb), 16),
					Pore_EC: signInt(d.slice(6, 8).reduce(msbLsb), 16),
					Permittivity: signInt(d.slice(8, 10).reduce(msbLsb), 16)/100,
				};
			}
		},
		'75': {
			name: 'Siemens Air Velocity Probe',
			parse: (d) => {
				return {
					adc: signInt(d.slice(0, 2).reduce(msbLsb), 16),
					mA: signInt(d.slice(2, 4).reduce(msbLsb), 16)/100,
					Velocity: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100
				};
			}
		},
		'76': {
			name: 'Wireless CO Sensor',
			parse: (d) => {
				return {
					CO_ppm: signInt(d.slice(0, 2).reduce(msbLsb), 16) / 100
				};
			}
		},

		'77': {
			name: '3 Channel SDI-12 Wireelss',
			parse: (d) => {
				return {
					Temperature_1: signInt(d.slice(0, 2).reduce(msbLsb), 16)/100,
					Soil_Moisture_1: signInt(d.slice(2, 4).reduce(msbLsb), 16)/100,
					Bulk_EC_1: signInt(d.slice(4, 6).reduce(msbLsb), 16),
					Pore_EC_1: signInt(d.slice(6, 8).reduce(msbLsb), 16),
					Permittivity_1: signInt(d.slice(8, 10).reduce(msbLsb), 16)/100,
					Temperature_2: signInt(d.slice(10, 12).reduce(msbLsb), 16)/100,
					Soil_Moisture_2: signInt(d.slice(12, 14).reduce(msbLsb), 16)/100,
					Bulk_EC_2: signInt(d.slice(14, 16).reduce(msbLsb), 16),
					Pore_EC_2: signInt(d.slice(16, 18).reduce(msbLsb), 16),
					Permittivity_2: signInt(d.slice(18, 20).reduce(msbLsb), 16)/100,
					Temperature_3: signInt(d.slice(20, 22).reduce(msbLsb), 16)/100,
					Soil_Moisture_3: signInt(d.slice(22, 24).reduce(msbLsb), 16)/100,
					Bulk_EC_3: signInt(d.slice(24, 26).reduce(msbLsb), 16),
					Pore_EC_3: signInt(d.slice(26, 28).reduce(msbLsb), 16),
					Permittivity_3: signInt(d.slice(28, 30).reduce(msbLsb), 16)/100
				};
			}
		},
		'79': {
			name: 'Oil Analysis Sensor',
			parse: (d) => {
				return {
					dynamic_viscosity: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					density: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
					dialectric_constant: signInt(d.slice(8, 12).reduce(msbLsb), 32) / 100,
					temperature: signInt(d.slice(12, 16).reduce(msbLsb), 32) / 100,
					saturability: signInt(d.slice(16, 20).reduce(msbLsb), 32) / 100,
					water_content: signInt(d.slice(20, 24).reduce(msbLsb), 32) / 100,
					moisture_content: signInt(d.slice(24, 28).reduce(msbLsb), 32) / 100,
					kinematic_viscosity_40c: signInt(d.slice(28, 32).reduce(msbLsb), 32) / 100,
					kinematic_viscosity_100c: signInt(d.slice(32, 36).reduce(msbLsb), 32) / 100
				};
			}
		},
		'80': {
			name: 'One Channel Vibration Plus',
			parse: (payload, parsed, mac) => {
				if(payload[7] >> 1 != 0){
					console.log('Error found');
					parsed.data = {error: 'Error found, Sensor Probe may be unattached'};
					return parsed;
				}

				if(payload[8] === 1){
					var deviceAddr = mac;
					var firmware = payload[1];
					var hour = payload[11];
					var minute = payload[12];
					var expected_packets = payload[15];
					var current_packet = payload[16];
					var sdata_start = 17;




					if(globalDevices.hasOwnProperty(deviceAddr)){
						// if a packet is already stored with the same packet ID, or if packet ID is 1, or if current packet ID is not one more than last packet ID
						if(current_packet in globalDevices[deviceAddr].data || current_packet == 1 || !(((current_packet&127)-1) in globalDevices[deviceAddr].data)) {
							console.log('-----');
							console.log('bad packet breakdown deleting stream');
							console.log(current_packet);
							console.log(expected_packets);
							console.log(current_packet in globalDevices[deviceAddr].data);
							console.log(current_packet == 1);
							console.log(!((current_packet-1) in globalDevices[deviceAddr].data));
							if(this.hasOwnProperty('failure_no')){
								this.failure_no = this.failure_no + 1;
							}
							else{
								this.failure_no = 1;
							}
							if(this.hasOwnProperty('failure_no')){
								console.log('####falure no');
								console.log(this.failure_no);
							}
							// console.log(globalDevices[deviceAddr].data);
							delete globalDevices[deviceAddr];
							if(current_packet != 1){
								return;
							} else{

								var mode = payload[8];
								var odr = payload[9];
								var en_axis = payload[10] & 7;
								var fsr = payload[10] >> 5;
								var device_temp = msbLsb(payload[13], payload[14])/100;


								switch(odr){
									case 6:
										odr = 50;
										break;
									case 7:
										odr = 100;
										break;
									case 8:
										odr = 200;
										break;
									case 9:
										odr = 400;
										break;
									case 10:
										odr = 800;
										break;
									case 11:
										odr = 1600;
										break;
									case 12:
										odr = 3200;
										break;
									case 13:
										odr = 6400;
										break;
									case 14:
										odr = 12800;
										break;
									case 15:
										odr = 25600;
										break;
									default:
										odr = 0;
								}

								globalDevices[deviceAddr] = {
									// stream_size: expected_packets,
									data: {},
									odr: odr,
									mo: mode,
									en_axis: en_axis,
									fsr: fsr,
									hour: hour,
									minute: minute,
									device_temp: device_temp,
								}
								globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
								return;
							}
						}
						else{
							globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						}

						if(Object.keys(globalDevices[deviceAddr].data).length == expected_packets){
							var raw_data = new Array();
							for(const packet in globalDevices[deviceAddr].data){
								raw_data = raw_data.concat(globalDevices[deviceAddr].data[packet]);
							}
							var label = 0;

							var fft = new Array();
							var fft_concat = {};

							var en_axis_data = {};
							switch (globalDevices[deviceAddr].en_axis){
								case 1:
									en_axis_data.x_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 2:
									en_axis_data.y_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 3:
									en_axis_data.x_offset = 0;
									en_axis_data.y_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 4:
									en_axis_data.z_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 5:
									en_axis_data.x_offset = 0;
									en_axis_data.z_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 6:
									en_axis_data.y_offset = 0;
									en_axis_data.z_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 7:
									en_axis_data.x_offset = 0;
									en_axis_data.y_offset = 2;
									en_axis_data.z_offset = 4;
									en_axis_data.increment = 6;
									break;
								default:
									en_axis_data.increment = 0;
							}

							var fsr_mult = .00006;
							var fsr_text = "";
							switch(globalDevices[deviceAddr].fsr){
								case 0:
									fsr_mult = 0.00006;
									break;
								case 1:
									fsr_mult = 0.00012;
									break;
								case 2:
									fsr_mult = 0.00024;
									break;
								case 3:
									fsr_mult = 0.00049;
									break;
							}
							switch(globalDevices[deviceAddr].fsr){
								case 0:
									fsr_text = "2g";
									break;
								case 1:
									fsr_text = "4g";
									break;
								case 2:
									fsr_text = "8g";
									break;
								case 3:
									fsr_text = "16g";
									break;
							}

							for(var i = 0; i < raw_data.length; i+=en_axis_data.increment){
								label++;

								fft_concat[label] = {};

								if('x_offset' in en_axis_data){
									fft_concat[label].x = parseFloat((signInt(((raw_data[i+en_axis_data.x_offset]<<8)+(raw_data[i+en_axis_data.x_offset+1])), 16)*fsr_mult).toFixed(5));
								}
								if('y_offset' in en_axis_data){
									fft_concat[label].y = parseFloat((signInt(((raw_data[i+en_axis_data.y_offset]<<8)+(raw_data[i+en_axis_data.y_offset+1])), 16)*fsr_mult).toFixed(5));
								}
								if('z_offset' in en_axis_data){
									fft_concat[label].z = parseFloat((signInt(((raw_data[i+en_axis_data.z_offset]<<8)+(raw_data[i+en_axis_data.z_offset+1])), 16)*fsr_mult).toFixed(5));
								}
							}
							var fft_concat_obj = {
								time_id: globalDevices[deviceAddr].hour +':'+ globalDevices[deviceAddr].minute,
								mac_address: deviceAddr,
								en_axis: globalDevices[deviceAddr].en_axis,
								fsr: fsr_text,
								odr: globalDevices[deviceAddr].odr,
								device_temp: globalDevices[deviceAddr].device_temp,
								data: fft_concat
							};
							sensor_data = fft_concat_obj;
							delete globalDevices[deviceAddr];
							if(this.hasOwnProperty('failure_no')){
								console.log('####falure no');
								console.log(this.failure_no);
							}

							return sensor_data;
						}
						else{
							return;
						}
					}else{

						var mode = payload[8];
						var odr = payload[9];
						var en_axis = payload[10] & 7;
						var fsr = payload[10] >> 5;
						var device_temp = msbLsb(payload[13], payload[14])/100;


						switch(odr){
							case 6:
								odr = 50;
								break;
							case 7:
								odr = 100;
								break;
							case 8:
								odr = 200;
								break;
							case 9:
								odr = 400;
								break;
							case 10:
								odr = 800;
								break;
							case 11:
								odr = 1600;
								break;
							case 12:
								odr = 3200;
								break;
							case 13:
								odr = 6400;
								break;
							case 14:
								odr = 12800;
								break;
							case 15:
								odr = 25600;
								break;
							default:
								odr = 0;
						}

						globalDevices[deviceAddr] = {
							// stream_size: expected_packets,
							data: {},
							odr: odr,
							mo: mode,
							en_axis: en_axis,
							fsr: fsr,
							hour: hour,
							minute: minute,
							device_temp: device_temp,
						}
						globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						return;
					}
				}
				else{
					// mode byte most significant bit will indicate fft data.
					// console.log(d);
					var odr;
					switch(payload[9]){
						case 6:
							odr = "50Hz"
							break;
						case 7:
							odr = "100Hz";
							break;
						case 8:
							odr = "200Hz";
							break;
						case 9:
							odr = "400Hz";
							break;
						case 10:
							odr = "800Hz";
							break;
						case 11:
							odr = "1600Hz";
							break;
						case 12:
							odr = "3200Hz";
							break;
						case 13:
							odr = "6400Hz";
							break;
						case 14:
							odr = "12800Hz";
							break;
						case 15:
							odr = "25600Hz";
							break;
					}
					return {
						mode: payload[8],

						odr: odr,
						temperature: signInt(payload.slice(10, 12).reduce(msbLsb), 16) / 100,

						x_rms_ACC_G: payload.slice(12, 14).reduce(msbLsb)/1000,
						x_max_ACC_G: payload.slice(14, 16).reduce(msbLsb)/1000,
						x_velocity_mm_sec: payload.slice(16, 18).reduce(msbLsb) / 100,
						x_displacement_mm: payload.slice(18, 20).reduce(msbLsb) / 100,
						x_peak_one_Hz: payload.slice(20, 22).reduce(msbLsb),
						x_peak_two_Hz: payload.slice(22, 24).reduce(msbLsb),
						x_peak_three_Hz: payload.slice(24, 26).reduce(msbLsb),

						y_rms_ACC_G: payload.slice(26, 28).reduce(msbLsb)/1000,
						y_max_ACC_G: payload.slice(28, 30).reduce(msbLsb)/1000,
						y_velocity_mm_sec: payload.slice(30, 32).reduce(msbLsb) / 100,
						y_displacement_mm: payload.slice(32, 34).reduce(msbLsb) / 100,
						y_peak_one_Hz: payload.slice(34, 36).reduce(msbLsb),
						y_peak_two_Hz: payload.slice(36, 38).reduce(msbLsb),
						y_peak_three_Hz: payload.slice(38, 40).reduce(msbLsb),

						z_rms_ACC_G: payload.slice(40, 42).reduce(msbLsb)/1000,
						z_max_ACC_G: payload.slice(42, 44).reduce(msbLsb)/1000,
						z_velocity_mm_sec: payload.slice(44, 46).reduce(msbLsb) / 100,
						z_displacement_mm: payload.slice(46, 48).reduce(msbLsb) / 100,
						z_peak_one_Hz: payload.slice(48, 50).reduce(msbLsb),
						z_peak_two_Hz: payload.slice(50, 52).reduce(msbLsb),
						z_peak_three_Hz: payload.slice(52, 54).reduce(msbLsb),
					};
				}
			},
			'parse_fly': (frame) => {
				let frame_data = {};
				switch(frame[16]){
					case 0:
						frame_data.mode = "Processed";
						break;
					case 1:
						frame_data.mode = "Raw";
						break;
					case 2:
						frame_data.mode = "Processed + Raw on demand";
						break;
				}
				switch(frame[17]){
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
				frame_data.sampling_duration_1 = frame[19]*50 + "ms";
				switch(frame[21]){
					case 0:
						frame_data.filter_status = "Disabled";
						break;
					case 1:
						frame_data.filter_status = "Enabled";
						break;
				}
				switch(frame[22]){
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
				switch(frame[24]){
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
				switch(frame[26]){
					case 0:
						frame_data.sampling_interval = "5 Minutes";
						break;
					case 1:
						frame_data.sampling_interval = "10 Minutes";
						break;
					case 2:
						frame_data.sampling_interval = "15 Minutes";
						break;
					case 2:
						frame_data.sampling_interval = "20 Minutes";
						break;
					case 4:
						frame_data.sampling_interval = "30 Minutes";
						break;
					case 5:
						frame_data.sampling_interval = "60 Minutes";
						break;
					case 6:
						frame_data.sampling_interval = "120 Minutes";
						break;
					case 7:
						frame_data.sampling_interval = "180 Minutes";
						break;
					case 8:
						frame_data.sampling_interval = "1 Minute";
						break;
				}
				frame_data.on_request_timeout = frame[27] + " Seconds";
				frame_data.deadband = frame[28] + "mg";

				switch(frame[29]){
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

				return {
					'firmware': frame[2],
					'destination_address': toMac(frame.slice(12, 16)),
					'mode': frame_data.mode,
					'odr_1': frame_data.odr_1+'Hz',
					'sampling_duration_1': frame_data.sampling_duration_1,
					'sampling_duration_2': frame_data.sampling_duration_2,
					'filter_status': frame_data.filter_status,
					'lpf_coeff_1': frame_data.lpf_coeff_1,
					'lpf_freq_1': frame_data.lpf_freq_1+'Hz',
					'hpf_coeff_1': frame_data.hpf_coeff_1,
					'hpf_freq_1': frame_data.hpf_freq_1+'Hz',
					'sampling_interval': frame_data.sampling_interval,
					'on_request_timeout': frame_data.on_request_timeout,
					'deadband': frame_data.deadband,
					'payload_length': frame_data.payload_length,
					'machine_values': {
						'firmware': frame[2],
						'destination_address': toMac(frame.slice(12, 16), false),
						'mode': frame[16],
						'odr_1': frame[17],
						'sampling_duration_1': frame[19],
						'sampling_duration_2': frame[20],
						'filter_status': frame[21],
						'lpf_coeff_1': frame[22],
						'hpf_coeff_1': frame[24],
						'sampling_interval': frame[26],
						'on_request_timeout': frame[27],
						'deadband': frame[28],
						'payload_length': frame[29]
					}
				}
			}
		},
		'81': {
			name: 'Two Channel Vibration Plus',
			parse: (payload, parsed, mac) => {
				parsed.data = {};
				if(payload[7] & 2){
					parsed.data['probe_1_error'] = true;
				}
				if(payload[7] & 4){
					parsed.data['probe_2_error'] = true;
				}
				if(payload[7] & 2 && payload[7] & 4){
					return parsed;
				}

				if(payload[8] === 1){
					var deviceAddr = mac;
					var firmware = payload[1];
					var hour = payload[11];
					var minute = payload[12];
					var expected_packets = payload[15];
					var current_packet = payload[16];
					var sdata_start = 17;

					if(globalDevices.hasOwnProperty(deviceAddr)){
						// if a packet is already stored with the same packet ID, or if packet ID is 1, or if current packet ID is not one more than last packet ID
						if(current_packet in globalDevices[deviceAddr].data || current_packet == 1 || !(((current_packet&127)-1) in globalDevices[deviceAddr].data)) {
							console.log('-----');
							console.log('bad packet breakdown deleting stream');
							console.log(current_packet);
							console.log(expected_packets);
							console.log(current_packet in globalDevices[deviceAddr].data);
							console.log(current_packet == 1);
							console.log(!((current_packet-1) in globalDevices[deviceAddr].data));
							if(this.hasOwnProperty('failure_no')){
								this.failure_no = this.failure_no + 1;
							}
							else{
								this.failure_no = 1;
							}
							if(this.hasOwnProperty('failure_no')){
								console.log('####falure no');
								console.log(this.failure_no);
							}
							// console.log(globalDevices[deviceAddr].data);
							delete globalDevices[deviceAddr];
							if(current_packet != 1){
								return;
							} else{

								var mode = payload[8];
								var odr = payload[9];
								var en_axis = payload[10] & 7;
								var fsr = payload[10] >> 5;
								var device_temp = msbLsb(payload[13], payload[14])/100;


								switch(odr){
									case 6:
										odr = 50;
										break;
									case 7:
										odr = 100;
										break;
									case 8:
										odr = 200;
										break;
									case 9:
										odr = 400;
										break;
									case 10:
										odr = 800;
										break;
									case 11:
										odr = 1600;
										break;
									case 12:
										odr = 3200;
										break;
									case 13:
										odr = 6400;
										break;
									case 14:
										odr = 12800;
										break;
									case 15:
										odr = 25600;
										break;
									default:
										odr = 0;
								}

								globalDevices[deviceAddr] = {
									// stream_size: expected_packets,
									data: {},
									odr: odr,
									mo: mode,
									en_axis: en_axis,
									fsr: fsr,
									hour: hour,
									minute: minute,
									device_temp: device_temp,
								}
								globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
								return;
							}
						}
						else{
							globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						}

						if(Object.keys(globalDevices[deviceAddr].data).length == expected_packets){
							var raw_data = new Array();

							for(const packet in globalDevices[deviceAddr].data){
								raw_data = raw_data.concat(globalDevices[deviceAddr].data[packet]);
							}
							var label = 0;

							var fft = new Array();
							var fft_concat = {};

							var en_axis_data = {};
							switch (globalDevices[deviceAddr].en_axis){
								case 1:
									en_axis_data.x_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 2:
									en_axis_data.y_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 3:
									en_axis_data.x_offset = 0;
									en_axis_data.y_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 4:
									en_axis_data.z_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 5:
									en_axis_data.x_offset = 0;
									en_axis_data.z_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 6:
									en_axis_data.y_offset = 0;
									en_axis_data.z_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 7:
									en_axis_data.x_offset = 0;
									en_axis_data.y_offset = 2;
									en_axis_data.z_offset = 4;
									en_axis_data.increment = 6;
									break;
								default:
									en_axis_data.increment = 0;
							}

							var fsr_mult = .00006;
							var fsr_text = "";
							switch(globalDevices[deviceAddr].fsr){
								case 0:
									fsr_mult = 0.00006;
									break;
								case 1:
									fsr_mult = 0.00012;
									break;
								case 2:
									fsr_mult = 0.00024;
									break;
								case 3:
									fsr_mult = 0.00049;
									break;
							}
							switch(globalDevices[deviceAddr].fsr){
								case 0:
									fsr_text = "2g";
									break;
								case 1:
									fsr_text = "4g";
									break;
								case 2:
									fsr_text = "8g";
									break;
								case 3:
									fsr_text = "16g";
									break;
							}

							for(var i = 0; i < raw_data.length; i+=en_axis_data.increment){
								label++;

								fft_concat[label] = {};

								if('x_offset' in en_axis_data){
									fft_concat[label].x = parseFloat((signInt(((raw_data[i+en_axis_data.x_offset]<<8)+(raw_data[i+en_axis_data.x_offset+1])), 16)*fsr_mult).toFixed(5));
								}
								if('y_offset' in en_axis_data){
									fft_concat[label].y = parseFloat((signInt(((raw_data[i+en_axis_data.y_offset]<<8)+(raw_data[i+en_axis_data.y_offset+1])), 16)*fsr_mult).toFixed(5));
								}
								if('z_offset' in en_axis_data){
									fft_concat[label].z = parseFloat((signInt(((raw_data[i+en_axis_data.z_offset]<<8)+(raw_data[i+en_axis_data.z_offset+1])), 16)*fsr_mult).toFixed(5));
								}
							}

							// If 4th bit is 1 the packet is from the second probe, if 0 from the first
							var probe = '';
							if(payload[7] & 8){
								probe = '2';
							}
							else{
								probe = '1';
							}

							var fft_concat_obj = {
								probe: probe,
								time_id: globalDevices[deviceAddr].hour +':'+ globalDevices[deviceAddr].minute,
								probe: probe,
								mac_address: deviceAddr,
								en_axis: globalDevices[deviceAddr].en_axis,
								fsr: fsr_text,
								odr: globalDevices[deviceAddr].odr,
								device_temp: globalDevices[deviceAddr].device_temp,
								data: fft_concat
							};
							sensor_data = fft_concat_obj;
							delete globalDevices[deviceAddr];
							if(this.hasOwnProperty('failure_no')){
								console.log('####falure no');
								console.log(this.failure_no);
							}

							return sensor_data;
						}
						else{
							return;
						}
					}else{

						var mode = payload[8];
						var odr = payload[9];
						var en_axis = payload[10] & 7;
						var fsr = payload[10] >> 5;
						var device_temp = msbLsb(payload[13], payload[14])/100;


						switch(odr){
							case 6:
								odr = 50;
								break;
							case 7:
								odr = 100;
								break;
							case 8:
								odr = 200;
								break;
							case 9:
								odr = 400;
								break;
							case 10:
								odr = 800;
								break;
							case 11:
								odr = 1600;
								break;
							case 12:
								odr = 3200;
								break;
							case 13:
								odr = 6400;
								break;
							case 14:
								odr = 12800;
								break;
							case 15:
								odr = 25600;
								break;
							default:
								odr = 0;
						}

						globalDevices[deviceAddr] = {
							// stream_size: expected_packets,
							data: {},
							odr: odr,
							mo: mode,
							en_axis: en_axis,
							fsr: fsr,
							hour: hour,
							minute: minute,
							device_temp: device_temp,
						}
						globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						return;
					}
				}
				else{
					// mode byte most significant bit will indicate fft data.
					// console.log(d);
					var odr1;
					switch(payload[9]){
						case 6:
							odr1 = "50Hz"
							break;
						case 7:
							odr1 = "100Hz";
							break;
						case 8:
							odr1 = "200Hz";
							break;
						case 9:
							odr1 = "400Hz";
							break;
						case 10:
							odr1 = "800Hz";
							break;
						case 11:
							odr1 = "1600Hz";
							break;
						case 12:
							odr1 = "3200Hz";
							break;
						case 13:
							odr1 = "6400Hz";
							break;
						case 14:
							odr1 = "12800Hz";
							break;
						case 15:
							odr1 = "25600Hz";
							break;
					}
					var odr2;
					switch(payload[54]){
						case 6:
							odr2 = "50Hz"
							break;
						case 7:
							odr2 = "100Hz";
							break;
						case 8:
							odr2 = "200Hz";
							break;
						case 9:
							odr2 = "400Hz";
							break;
						case 10:
							odr2 = "800Hz";
							break;
						case 11:
							odr2 = "1600Hz";
							break;
						case 12:
							odr2 = "3200Hz";
							break;
						case 13:
							odr2 = "6400Hz";
							break;
						case 14:
							odr2 = "12800Hz";
							break;
						case 15:
							odr2 = "25600Hz";
							break;
					}

					// If 4th bit is 1 the packet is from the second probe, if 0 from the first
					// var probe = '';
					// if(payload[7] & 8){
					// 	probe = '2';
					// }
					// else{
					// 	probe = '1';
					// }

					return {
						mode: payload[8],

						s1_odr: odr1,
						s1_temperature: signInt(payload.slice(10, 12).reduce(msbLsb), 16) / 100,

						x1_rms_ACC_G: payload.slice(12, 14).reduce(msbLsb)/1000,
						x1_max_ACC_G: payload.slice(14, 16).reduce(msbLsb)/1000,
						x1_velocity_mm_sec: payload.slice(16, 18).reduce(msbLsb) / 100,
						x1_displacement_mm: payload.slice(18, 20).reduce(msbLsb) / 100,
						x1_peak_one_Hz: payload.slice(20, 22).reduce(msbLsb),
						x1_peak_two_Hz: payload.slice(22, 24).reduce(msbLsb),
						x1_peak_three_Hz: payload.slice(24, 26).reduce(msbLsb),

						y1_rms_ACC_G: payload.slice(26, 28).reduce(msbLsb)/1000,
						y1_max_ACC_G: payload.slice(28, 30).reduce(msbLsb)/1000,
						y1_velocity_mm_sec: payload.slice(30, 32).reduce(msbLsb) / 100,
						y1_displacement_mm: payload.slice(32, 34).reduce(msbLsb) / 100,
						y1_peak_one_Hz: payload.slice(34, 36).reduce(msbLsb),
						y1_peak_two_Hz: payload.slice(36, 38).reduce(msbLsb),
						y1_peak_three_Hz: payload.slice(38, 40).reduce(msbLsb),

						z1_rms_ACC_G: payload.slice(40, 42).reduce(msbLsb)/1000,
						z1_max_ACC_G: payload.slice(42, 44).reduce(msbLsb)/1000,
						z1_velocity_mm_sec: payload.slice(44, 46).reduce(msbLsb) / 100,
						z1_displacement_mm: payload.slice(46, 48).reduce(msbLsb) / 100,
						z1_peak_one_Hz: payload.slice(48, 50).reduce(msbLsb),
						z1_peak_two_Hz: payload.slice(50, 52).reduce(msbLsb),
						z1_peak_three_Hz: payload.slice(52, 54).reduce(msbLsb),

						s2_odr: odr2,
						s2_temperature: signInt(payload.slice(55, 57).reduce(msbLsb), 16) / 100,

						x2_rms_ACC_G: payload.slice(57, 59).reduce(msbLsb)/1000,
						x2_max_ACC_G: payload.slice(59, 61).reduce(msbLsb)/1000,
						x2_velocity_mm_sec: payload.slice(61, 63).reduce(msbLsb) / 100,
						x2_displacement_mm: payload.slice(63, 65).reduce(msbLsb) / 100,
						x2_peak_one_Hz: payload.slice(65, 67).reduce(msbLsb),
						x2_peak_two_Hz: payload.slice(67, 69).reduce(msbLsb),
						x2_peak_three_Hz: payload.slice(69, 71).reduce(msbLsb),

						y2_rms_ACC_G: payload.slice(71, 73).reduce(msbLsb)/1000,
						y2_max_ACC_G: payload.slice(73, 75).reduce(msbLsb)/1000,
						y2_velocity_mm_sec: payload.slice(75, 77).reduce(msbLsb) / 100,
						y2_displacement_mm: payload.slice(77, 79).reduce(msbLsb) / 100,
						y2_peak_one_Hz: payload.slice(79, 81).reduce(msbLsb),
						y2_peak_two_Hz: payload.slice(81, 83).reduce(msbLsb),
						y2_peak_three_Hz: payload.slice(83, 85).reduce(msbLsb),

						z2_rms_ACC_G: payload.slice(85, 87).reduce(msbLsb)/1000,
						z2_max_ACC_G: payload.slice(87, 89).reduce(msbLsb)/1000,
						z2_velocity_mm_sec: payload.slice(89, 91).reduce(msbLsb) / 100,
						z2_displacement_mm: payload.slice(91, 93).reduce(msbLsb) / 100,
						z2_peak_one_Hz: payload.slice(93, 95).reduce(msbLsb),
						z2_peak_two_Hz: payload.slice(95, 97).reduce(msbLsb),
						z2_peak_three_Hz: payload.slice(97, 99).reduce(msbLsb)
					};
				}
			},
			'parse_fly': (frame) => {
				let frame_data = {};
				switch(frame[16]){
					case 0:
						frame_data.mode = "Processed";
						break;
					case 1:
						frame_data.mode = "Raw";
						break;
					case 2:
						frame_data.mode = "Processed + Raw on demand";
						break;
				}
				switch(frame[17]){
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
				switch(frame[18]){
					case 6:
						frame_data.odr_2 = 50;
						break;
					case 7:
						frame_data.odr_2 = 100;
						break;
					case 8:
						frame_data.odr_2 = 200;
						break;
					case 9:
						frame_data.odr_2 = 400;
						break;
					case 10:
						frame_data.odr_2 = 800;
						break;
					case 11:
						frame_data.odr_2 = 1600;
						break;
					case 12:
						frame_data.odr_2 = 3200;
						break;
					case 13:
						frame_data.odr_2 = 6400;
						break;
					case 14:
						frame_data.odr_2 = 12800;
						break;
					case 15:
						frame_data.odr_2 = 25600;
						break;
				}
				frame_data.sampling_duration_1 = frame[19]*50 + "ms";
				frame_data.sampling_duration_2 = frame[20]*50 + "ms";
				switch(frame[21]){
					case 0:
						frame_data.filter_status = "Disabled";
						break;
					case 1:
						frame_data.filter_status = "Enabled";
						break;
				}
				switch(frame[22]){
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
				switch(frame[23]){
					case 0:
						frame_data.lpf_coeff_2 = 4;
						break;
					case 1:
						frame_data.lpf_coeff_2 = 8;
						break;
					case 2:
						frame_data.lpf_coeff_2 = 16;
						break;
					case 2:
						frame_data.lpf_coeff_2 = 32;
						break;
					case 4:
						frame_data.lpf_coeff_2 = 64;
						break;
					case 5:
						frame_data.lpf_coeff_2 = 128;
						break;
					case 6:
						frame_data.lpf_coeff_2 = 256;
						break;
					case 7:
						frame_data.lpf_coeff_2 = 512;
						break;
					case 8:
						frame_data.lpf_coeff_2 = 1024;
						break;
					case 9:
						frame_data.lpf_coeff_2 = 2048;
						break;
				}
				frame_data.lpf_freq_2 = frame_data.odr_2 / frame_data.lpf_coeff_2;
				switch(frame[24]){
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
				switch(frame[25]){
					case 0:
						frame_data.hpf_coeff_2 = 4;
						break;
					case 1:
						frame_data.hpf_coeff_2 = 8;
						break;
					case 2:
						frame_data.hpf_coeff_2 = 16;
						break;
					case 2:
						frame_data.hpf_coeff_2 = 32;
						break;
					case 4:
						frame_data.hpf_coeff_2 = 64;
						break;
					case 5:
						frame_data.hpf_coeff_2 = 128;
						break;
					case 6:
						frame_data.hpf_coeff_2 = 256;
						break;
					case 7:
						frame_data.hpf_coeff_2 = 512;
						break;
					case 8:
						frame_data.hpf_coeff_2 = 1024;
						break;
					case 9:
						frame_data.hpf_coeff_2 = 2048;
						break;
				}
				frame_data.hpf_freq_2 = frame_data.odr_2 / frame_data.hpf_coeff_2;
				switch(frame[26]){
					case 0:
						frame_data.sampling_interval = "5 Minutes";
						break;
					case 1:
						frame_data.sampling_interval = "10 Minutes";
						break;
					case 2:
						frame_data.sampling_interval = "15 Minutes";
						break;
					case 2:
						frame_data.sampling_interval = "20 Minutes";
						break;
					case 4:
						frame_data.sampling_interval = "30 Minutes";
						break;
					case 5:
						frame_data.sampling_interval = "60 Minutes";
						break;
					case 6:
						frame_data.sampling_interval = "120 Minutes";
						break;
					case 7:
						frame_data.sampling_interval = "180 Minutes";
						break;
					case 8:
						frame_data.sampling_interval = "1 Minute";
						break;
				}
				frame_data.on_request_timeout = frame[27] + " Seconds";
				frame_data.deadband = frame[28] + "mg";

				switch(frame[29]){
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

				return {
					'firmware': frame[2],
					'destination_address': toMac(frame.slice(12, 16)),
					'mode': frame_data.mode,
					'odr_1': frame_data.odr_1+'Hz',
					'odr_2': frame_data.odr_2+'Hz',
					'sampling_duration_1': frame_data.sampling_duration_1,
					'sampling_duration_2': frame_data.sampling_duration_2,
					'filter_status': frame_data.filter_status,
					'lpf_coeff_1': frame_data.lpf_coeff_1,
					'lpf_freq_1': frame_data.lpf_freq_1+'Hz',
					'lpf_coeff_2': frame_data.lpf_coeff_2,
					'lpf_freq_2': frame_data.lpf_freq_2+'Hz',
					'hpf_coeff_1': frame_data.hpf_coeff_1,
					'hpf_freq_1': frame_data.hpf_freq_1+'Hz',
					'hpf_coeff_2': frame_data.hpf_coeff_2,
					'hpf_freq_2': frame_data.hpf_freq_2+'Hz',
					'sampling_interval': frame_data.sampling_interval,
					'on_request_timeout': frame_data.on_request_timeout,
					'deadband': frame_data.deadband,
					'payload_length': frame_data.payload_length,
					'machine_values': {
						'firmware': frame[2],
						'destination_address': toMac(frame.slice(12, 16), false),
						'mode': frame[16],
						'odr_1': frame[17],
						'odr_2': frame[18],
						'sampling_duration_1': frame[19],
						'sampling_duration_2': frame[20],
						'filter_status': frame[21],
						'lpf_coeff_1': frame[22],
						'lpf_coeff_2': frame[23],
						'hpf_coeff_1': frame[24],
						'hpf_coeff_2': frame[25],
						'sampling_interval': frame[26],
						'on_request_timeout': frame[27],
						'deadband': frame[28],
						'payload_length': frame[29]
					}
				}
			}
		},

		'82': {
			name: 'Condition Based/Predictive Maintenance Sensor',
			parse: (payload, parsed, mac) => {
				if(payload[7] >> 1 != 0){
					console.log('Error found');
					console.log(payload[7]);
					parsed.data = {error: 'Error found, Sensor Probe may be unattached'};
					return parsed;
				}

				if(payload[8] === 1){
					var deviceAddr = mac;
					var firmware = payload[1];
					var hour = payload[11];
					var minute = payload[12];
					var expected_packets = payload[15];
					var current_packet = payload[16];
					var sdata_start = 17;

					if(globalDevices.hasOwnProperty(deviceAddr)){
						// if a packet is already stored with the same packet ID, or if packet ID is 1, or if current packet ID is not one more than last packet ID
						if(current_packet in globalDevices[deviceAddr].data || current_packet == 1 || !(((current_packet&127)-1) in globalDevices[deviceAddr].data)) {
							console.log('-----');
							console.log('bad packet breakdown deleting stream');
							console.log(current_packet);
							console.log(expected_packets);
							console.log(current_packet in globalDevices[deviceAddr].data);
							console.log(current_packet == 1);
							console.log(!((current_packet-1) in globalDevices[deviceAddr].data));
							if(this.hasOwnProperty('failure_no')){
								this.failure_no = this.failure_no + 1;
							}
							else{
								this.failure_no = 1;
							}
							if(this.hasOwnProperty('failure_no')){
								console.log('####falure no');
								console.log(this.failure_no);
							}
							// console.log(globalDevices[deviceAddr].data);
							delete globalDevices[deviceAddr];
							if(current_packet != 1){
								return;
							} else{

								var mode = payload[8];
								var odr = payload[9];
								var en_axis = payload[10] & 7;
								var fsr = payload[10] >> 5;
								var device_temp = msbLsb(payload[13], payload[14])/100;


								switch(odr){
									case 6:
										odr = 50;
										break;
									case 7:
										odr = 100;
										break;
									case 8:
										odr = 200;
										break;
									case 9:
										odr = 400;
										break;
									case 10:
										odr = 800;
										break;
									case 11:
										odr = 1600;
										break;
									case 12:
										odr = 3200;
										break;
									case 13:
										odr = 6400;
										break;
									case 14:
										odr = 12800;
										break;
									case 15:
										odr = 25600;
										break;
									default:
										odr = 0;
								}

								globalDevices[deviceAddr] = {
									// stream_size: expected_packets,
									data: {},
									odr: odr,
									mo: mode,
									en_axis: en_axis,
									fsr: fsr,
									hour: hour,
									minute: minute,
									device_temp: device_temp,
								}
								globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
								return;
							}
						}
						else{
							globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						}

						if(Object.keys(globalDevices[deviceAddr].data).length == expected_packets){
							var raw_data = new Array();
							for(const packet in globalDevices[deviceAddr].data){
								raw_data = raw_data.concat(globalDevices[deviceAddr].data[packet]);
							}
							var label = 0;

							var fft = new Array();
							var fft_concat = {};

							var en_axis_data = {};
							switch (globalDevices[deviceAddr].en_axis){
								case 1:
									en_axis_data.x_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 2:
									en_axis_data.y_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 3:
									en_axis_data.x_offset = 0;
									en_axis_data.y_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 4:
									en_axis_data.z_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 5:
									en_axis_data.x_offset = 0;
									en_axis_data.z_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 6:
									en_axis_data.y_offset = 0;
									en_axis_data.z_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 7:
									en_axis_data.x_offset = 0;
									en_axis_data.y_offset = 2;
									en_axis_data.z_offset = 4;
									en_axis_data.increment = 6;
									break;
								default:
									en_axis_data.increment = 0;
							}

							var fsr_mult = .00006;
							var fsr_text = "";
							switch(globalDevices[deviceAddr].fsr){
								case 0:
									fsr_mult = 0.00006;
									break;
								case 1:
									fsr_mult = 0.00012;
									break;
								case 2:
									fsr_mult = 0.00024;
									break;
								case 3:
									fsr_mult = 0.00049;
									break;
							}
							switch(globalDevices[deviceAddr].fsr){
								case 0:
									fsr_text = "2g";
									break;
								case 1:
									fsr_text = "4g";
									break;
								case 2:
									fsr_text = "8g";
									break;
								case 3:
									fsr_text = "16g";
									break;
							}

							for(var i = 0; i < raw_data.length; i+=en_axis_data.increment){
								label++;

								fft_concat[label] = {};

								if('x_offset' in en_axis_data){
									fft_concat[label].x = parseFloat((signInt(((raw_data[i+en_axis_data.x_offset]<<8)+(raw_data[i+en_axis_data.x_offset+1])), 16)*fsr_mult).toFixed(5));
								}
								if('y_offset' in en_axis_data){
									fft_concat[label].y = parseFloat((signInt(((raw_data[i+en_axis_data.y_offset]<<8)+(raw_data[i+en_axis_data.y_offset+1])), 16)*fsr_mult).toFixed(5));
								}
								if('z_offset' in en_axis_data){
									fft_concat[label].z = parseFloat((signInt(((raw_data[i+en_axis_data.z_offset]<<8)+(raw_data[i+en_axis_data.z_offset+1])), 16)*fsr_mult).toFixed(5));
								}
							}
							var fft_concat_obj = {
								time_id: globalDevices[deviceAddr].hour +':'+ globalDevices[deviceAddr].minute,
								mac_address: deviceAddr,
								en_axis: globalDevices[deviceAddr].en_axis,
								fsr: fsr_text,
								odr: globalDevices[deviceAddr].odr,
								device_temp: globalDevices[deviceAddr].device_temp,
								data: fft_concat
							};
							// console.log(globalDevices[deviceAddr].data);
							// console.log(raw_data);
							sensor_data = fft_concat_obj;
							// parsed.raw_packets = globalDevices[deviceAddr].data;
							// parsed.raw_data = raw_data;
							delete globalDevices[deviceAddr];
							if(this.hasOwnProperty('failure_no')){
								console.log('####falure no');
								console.log(this.failure_no);
							}

							return sensor_data;
						}
						else{
							return;
						}
					}else{

						var mode = payload[8];
						var odr = payload[9];
						var en_axis = payload[10] & 7;
						var fsr = payload[10] >> 5;
						var device_temp = msbLsb(payload[13], payload[14])/100;


						switch(odr){
							case 6:
								odr = 50;
								break;
							case 7:
								odr = 100;
								break;
							case 8:
								odr = 200;
								break;
							case 9:
								odr = 400;
								break;
							case 10:
								odr = 800;
								break;
							case 11:
								odr = 1600;
								break;
							case 12:
								odr = 3200;
								break;
							case 13:
								odr = 6400;
								break;
							case 14:
								odr = 12800;
								break;
							case 15:
								odr = 25600;
								break;
							default:
								odr = 0;
						}

						globalDevices[deviceAddr] = {
							// stream_size: expected_packets,
							data: {},
							odr: odr,
							mo: mode,
							en_axis: en_axis,
							fsr: fsr,
							hour: hour,
							minute: minute,
							device_temp: device_temp,
						}
						globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						return;
					}
				}
				else{
					// mode byte most significant bit will indicate fft data.
					// console.log(d);
					var odr;
					switch(payload[9]){
						case 6:
							odr = "50Hz"
							break;
						case 7:
							odr = "100Hz";
							break;
						case 8:
							odr = "200Hz";
							break;
						case 9:
							odr = "400Hz";
							break;
						case 10:
							odr = "800Hz";
							break;
						case 11:
							odr = "1600Hz";
							break;
						case 12:
							odr = "3200Hz";
							break;
						case 13:
							odr = "6400Hz";
							break;
						case 14:
							odr = "12800Hz";
							break;
						case 15:
							odr = "25600Hz";
							break;
					}
					return {
						mode: payload[8],

						odr: odr,
						temperature: signInt(payload.slice(10, 12).reduce(msbLsb), 16) / 100,
						Ext_temperature: signInt(payload.slice(12, 16).reduce(msbLsb), 32) / 100,
						Current: signInt(payload.slice(16, 20).reduce(msbLsb), 32) / 1000,
						x_rms_ACC_G: payload.slice(20, 22).reduce(msbLsb)/1000,
						x_max_ACC_G: payload.slice(22, 24).reduce(msbLsb)/1000,
						x_velocity_mm_sec: payload.slice(24, 26).reduce(msbLsb) / 100,
						x_displacement_mm: payload.slice(26, 28).reduce(msbLsb) / 100,
						x_peak_one_Hz: payload.slice(28, 30).reduce(msbLsb),
						x_peak_two_Hz: payload.slice(30, 32).reduce(msbLsb),
						x_peak_three_Hz: payload.slice(32, 34).reduce(msbLsb),

						y_rms_ACC_G: payload.slice(34, 36).reduce(msbLsb)/1000,
						y_max_ACC_G: payload.slice(36, 38).reduce(msbLsb)/1000,
						y_velocity_mm_sec: payload.slice(38, 40).reduce(msbLsb) / 100,
						y_displacement_mm: payload.slice(40, 42).reduce(msbLsb) / 100,
						y_peak_one_Hz: payload.slice(42, 44).reduce(msbLsb),
						y_peak_two_Hz: payload.slice(44, 46).reduce(msbLsb),
						y_peak_three_Hz: payload.slice(46, 48).reduce(msbLsb),

						z_rms_ACC_G: payload.slice(48, 50).reduce(msbLsb)/1000,
						z_max_ACC_G: payload.slice(50, 52).reduce(msbLsb)/1000,
						z_velocity_mm_sec: payload.slice(52, 54).reduce(msbLsb) / 100,
						z_displacement_mm: payload.slice(54, 56).reduce(msbLsb) / 100,
						z_peak_one_Hz: payload.slice(56, 58).reduce(msbLsb),
						z_peak_two_Hz: payload.slice(58, 60).reduce(msbLsb),
						z_peak_three_Hz: payload.slice(60, 62).reduce(msbLsb),
					};
				}
			},
			'parse_fly': (frame) => {
				let frame_data = {};
				switch(frame[16]){
					case 0:
						frame_data.mode = "Processed";
						break;
					case 1:
						frame_data.mode = "Raw";
						break;
					case 2:
						frame_data.mode = "Processed + Raw on demand";
						break;
				}
				switch(frame[17]){
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
				frame_data.sampling_duration_1 = frame[19]*50 + "ms";
				switch(frame[21]){
					case 0:
						frame_data.filter_status = "Disabled";
						break;
					case 1:
						frame_data.filter_status = "Enabled";
						break;
				}
				switch(frame[22]){
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
				switch(frame[24]){
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
				switch(frame[26]){
					case 0:
						frame_data.sampling_interval = "5 Minutes";
						break;
					case 1:
						frame_data.sampling_interval = "10 Minutes";
						break;
					case 2:
						frame_data.sampling_interval = "15 Minutes";
						break;
					case 2:
						frame_data.sampling_interval = "20 Minutes";
						break;
					case 4:
						frame_data.sampling_interval = "30 Minutes";
						break;
					case 5:
						frame_data.sampling_interval = "60 Minutes";
						break;
					case 6:
						frame_data.sampling_interval = "120 Minutes";
						break;
					case 7:
						frame_data.sampling_interval = "180 Minutes";
						break;
					case 8:
						frame_data.sampling_interval = "1 Minute";
						break;
				}
				frame_data.on_request_timeout = frame[27] + " Seconds";
				frame_data.deadband = frame[28] + "mg";

				switch(frame[29]){
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

				return {
					'firmware': frame[2],
					'destination_address': toMac(frame.slice(12, 16)),
					'mode': frame_data.mode,
					'odr_1': frame_data.odr_1+'Hz',
					'sampling_duration_1': frame_data.sampling_duration_1,
					'sampling_duration_2': frame_data.sampling_duration_2,
					'filter_status': frame_data.filter_status,
					'lpf_coeff_1': frame_data.lpf_coeff_1,
					'lpf_freq_1': frame_data.lpf_freq_1+'Hz',
					'hpf_coeff_1': frame_data.hpf_coeff_1,
					'hpf_freq_1': frame_data.hpf_freq_1+'Hz',
					'sampling_interval': frame_data.sampling_interval,
					'on_request_timeout': frame_data.on_request_timeout,
					'deadband': frame_data.deadband,
					'payload_length': frame_data.payload_length,
					'machine_values': {
						'firmware': frame[2],
						'destination_address': toMac(frame.slice(12, 16), false),
						'mode': frame[16],
						'odr_1': frame[17],
						'sampling_duration_1': frame[19],
						'sampling_duration_2': frame[20],
						'filter_status': frame[21],
						'lpf_coeff_1': frame[22],
						'hpf_coeff_1': frame[24],
						'sampling_interval': frame[26],
						'on_request_timeout': frame[27],
						'deadband': frame[28],
						'payload_length': frame[29]
					}
				}
			}
		},

		'84': {
			name: 'Type 84 - Vibration on a stick',
			parse: (payload, parsed, mac) => {
				if(payload[7] >> 1 != 0){
					console.log('Error found');
					parsed.data = {error: 'Error found, Sensor Probe may be unattached'};
					return parsed;
				}

				if(payload[8] === 1){
					var deviceAddr = mac;
					var firmware = payload[1];
					var hour = payload[11];
					var minute = payload[12];
					var expected_packets = payload[15];
					var current_packet = payload[16];
					var sdata_start = 17;




					if(globalDevices.hasOwnProperty(deviceAddr)){
						// if a packet is already stored with the same packet ID, or if packet ID is 1, or if current packet ID is not one more than last packet ID
						if(current_packet in globalDevices[deviceAddr].data || current_packet == 1 || !(((current_packet&127)-1) in globalDevices[deviceAddr].data)) {
							console.log('-----');
							console.log('bad packet breakdown deleting stream');
							console.log(current_packet);
							console.log(expected_packets);
							console.log(current_packet in globalDevices[deviceAddr].data);
							console.log(current_packet == 1);
							console.log(!((current_packet-1) in globalDevices[deviceAddr].data));
							if(this.hasOwnProperty('failure_no')){
								this.failure_no = this.failure_no + 1;
							}
							else{
								this.failure_no = 1;
							}
							if(this.hasOwnProperty('failure_no')){
								console.log('####falure no');
								console.log(this.failure_no);
							}
							// console.log(globalDevices[deviceAddr].data);
							delete globalDevices[deviceAddr];
							if(current_packet != 1){
								return;
							} else{

								var mode = payload[8];
								var odr = payload[9];
								var en_axis = payload[10] & 7;
								var fsr = payload[10] >> 5;
								var device_temp = msbLsb(payload[13], payload[14])/100;


								switch(odr){
									case 6:
										odr = 50;
										break;
									case 7:
										odr = 100;
										break;
									case 8:
										odr = 200;
										break;
									case 9:
										odr = 400;
										break;
									case 10:
										odr = 800;
										break;
									case 11:
										odr = 1600;
										break;
									case 12:
										odr = 3200;
										break;
									case 13:
										odr = 6400;
										break;
									case 14:
										odr = 12800;
										break;
									case 15:
										odr = 25600;
										break;
									default:
										odr = 0;
								}

								globalDevices[deviceAddr] = {
									// stream_size: expected_packets,
									data: {},
									odr: odr,
									mo: mode,
									en_axis: en_axis,
									fsr: fsr,
									hour: hour,
									minute: minute,
									device_temp: device_temp,
								}
								globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
								return;
							}
						}
						else{
							globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						}

						if(Object.keys(globalDevices[deviceAddr].data).length == expected_packets){
							var raw_data = new Array();
							for(const packet in globalDevices[deviceAddr].data){
								raw_data = raw_data.concat(globalDevices[deviceAddr].data[packet]);
							}
							var label = 0;

							var fft = new Array();
							var fft_concat = {};

							var en_axis_data = {};
							switch (globalDevices[deviceAddr].en_axis){
								case 1:
									en_axis_data.x_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 2:
									en_axis_data.y_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 3:
									en_axis_data.x_offset = 0;
									en_axis_data.y_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 4:
									en_axis_data.z_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 5:
									en_axis_data.x_offset = 0;
									en_axis_data.z_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 6:
									en_axis_data.y_offset = 0;
									en_axis_data.z_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 7:
									en_axis_data.x_offset = 0;
									en_axis_data.y_offset = 2;
									en_axis_data.z_offset = 4;
									en_axis_data.increment = 6;
									break;
								default:
									en_axis_data.increment = 0;
							}

							var fsr_mult = .00006;
							var fsr_text = "";
							switch(globalDevices[deviceAddr].fsr){
								case 0:
									fsr_mult = 0.00006;
									break;
								case 1:
									fsr_mult = 0.00012;
									break;
								case 2:
									fsr_mult = 0.00024;
									break;
								case 3:
									fsr_mult = 0.00049;
									break;
							}
							switch(globalDevices[deviceAddr].fsr){
								case 0:
									fsr_text = "2g";
									break;
								case 1:
									fsr_text = "4g";
									break;
								case 2:
									fsr_text = "8g";
									break;
								case 3:
									fsr_text = "16g";
									break;
							}

							for(var i = 0; i < raw_data.length; i+=en_axis_data.increment){
								label++;

								fft_concat[label] = {};

								if('x_offset' in en_axis_data){
									fft_concat[label].x = parseFloat((signInt(((raw_data[i+en_axis_data.x_offset]<<8)+(raw_data[i+en_axis_data.x_offset+1])), 16)*fsr_mult).toFixed(5));
								}
								if('y_offset' in en_axis_data){
									fft_concat[label].y = parseFloat((signInt(((raw_data[i+en_axis_data.y_offset]<<8)+(raw_data[i+en_axis_data.y_offset+1])), 16)*fsr_mult).toFixed(5));
								}
								if('z_offset' in en_axis_data){
									fft_concat[label].z = parseFloat((signInt(((raw_data[i+en_axis_data.z_offset]<<8)+(raw_data[i+en_axis_data.z_offset+1])), 16)*fsr_mult).toFixed(5));
								}
							}
							var fft_concat_obj = {
								time_id: globalDevices[deviceAddr].hour +':'+ globalDevices[deviceAddr].minute,
								mac_address: deviceAddr,
								en_axis: globalDevices[deviceAddr].en_axis,
								fsr: fsr_text,
								odr: globalDevices[deviceAddr].odr,
								device_temp: globalDevices[deviceAddr].device_temp,
								data: fft_concat
							};
							sensor_data = fft_concat_obj;
							delete globalDevices[deviceAddr];
							if(this.hasOwnProperty('failure_no')){
								console.log('####falure no');
								console.log(this.failure_no);
							}

							return sensor_data;
						}
						else{
							return;
						}
					}else{

						var mode = payload[8];
						var odr = payload[9];
						var en_axis = payload[10] & 7;
						var fsr = payload[10] >> 5;
						var device_temp = msbLsb(payload[13], payload[14])/100;


						switch(odr){
							case 6:
								odr = 50;
								break;
							case 7:
								odr = 100;
								break;
							case 8:
								odr = 200;
								break;
							case 9:
								odr = 400;
								break;
							case 10:
								odr = 800;
								break;
							case 11:
								odr = 1600;
								break;
							case 12:
								odr = 3200;
								break;
							case 13:
								odr = 6400;
								break;
							case 14:
								odr = 12800;
								break;
							case 15:
								odr = 25600;
								break;
							default:
								odr = 0;
						}

						globalDevices[deviceAddr] = {
							// stream_size: expected_packets,
							data: {},
							odr: odr,
							mo: mode,
							en_axis: en_axis,
							fsr: fsr,
							hour: hour,
							minute: minute,
							device_temp: device_temp,
						}
						globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						return;
					}
				}
				else{
					// mode byte most significant bit will indicate fft data.
					// console.log(d);
					var odr;
					switch(payload[9]){
						case 6:
							odr = "50Hz"
							break;
						case 7:
							odr = "100Hz";
							break;
						case 8:
							odr = "200Hz";
							break;
						case 9:
							odr = "400Hz";
							break;
						case 10:
							odr = "800Hz";
							break;
						case 11:
							odr = "1600Hz";
							break;
						case 12:
							odr = "3200Hz";
							break;
						case 13:
							odr = "6400Hz";
							break;
						case 14:
							odr = "12800Hz";
							break;
						case 15:
							odr = "25600Hz";
							break;
					}
					return {
						mode: payload[8],

						odr: odr,
						temperature: signInt(payload.slice(10, 12).reduce(msbLsb), 16) / 100,

						x_rms_ACC_G: payload.slice(12, 14).reduce(msbLsb)/1000,
						x_max_ACC_G: payload.slice(14, 16).reduce(msbLsb)/1000,
						x_velocity_mm_sec: payload.slice(16, 18).reduce(msbLsb) / 100,
						x_displacement_mm: payload.slice(18, 20).reduce(msbLsb) / 100,
						x_peak_one_Hz: payload.slice(20, 22).reduce(msbLsb),
						x_peak_two_Hz: payload.slice(22, 24).reduce(msbLsb),
						x_peak_three_Hz: payload.slice(24, 26).reduce(msbLsb),

						y_rms_ACC_G: payload.slice(26, 28).reduce(msbLsb)/1000,
						y_max_ACC_G: payload.slice(28, 30).reduce(msbLsb)/1000,
						y_velocity_mm_sec: payload.slice(30, 32).reduce(msbLsb) / 100,
						y_displacement_mm: payload.slice(32, 34).reduce(msbLsb) / 100,
						y_peak_one_Hz: payload.slice(34, 36).reduce(msbLsb),
						y_peak_two_Hz: payload.slice(36, 38).reduce(msbLsb),
						y_peak_three_Hz: payload.slice(38, 40).reduce(msbLsb),

						z_rms_ACC_G: payload.slice(40, 42).reduce(msbLsb)/1000,
						z_max_ACC_G: payload.slice(42, 44).reduce(msbLsb)/1000,
						z_velocity_mm_sec: payload.slice(44, 46).reduce(msbLsb) / 100,
						z_displacement_mm: payload.slice(46, 48).reduce(msbLsb) / 100,
						z_peak_one_Hz: payload.slice(48, 50).reduce(msbLsb),
						z_peak_two_Hz: payload.slice(50, 52).reduce(msbLsb),
						z_peak_three_Hz: payload.slice(52, 54).reduce(msbLsb),
					};
				}
			},
			'parse_fly': (frame) => {
				let frame_data = {};
				switch(frame[16]){
					case 0:
						frame_data.mode = "Processed";
						break;
					case 1:
						frame_data.mode = "Raw";
						break;
					case 2:
						frame_data.mode = "Processed + Raw on demand";
						break;
				}
				switch(frame[17]){
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
				frame_data.sampling_duration_1 = frame[19]*50 + "ms";
				switch(frame[21]){
					case 0:
						frame_data.filter_status = "Disabled";
						break;
					case 1:
						frame_data.filter_status = "Enabled";
						break;
				}
				switch(frame[22]){
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
				switch(frame[24]){
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
				switch(frame[26]){
					case 0:
						frame_data.sampling_interval = "5 Minutes";
						break;
					case 1:
						frame_data.sampling_interval = "10 Minutes";
						break;
					case 2:
						frame_data.sampling_interval = "15 Minutes";
						break;
					case 2:
						frame_data.sampling_interval = "20 Minutes";
						break;
					case 4:
						frame_data.sampling_interval = "30 Minutes";
						break;
					case 5:
						frame_data.sampling_interval = "60 Minutes";
						break;
					case 6:
						frame_data.sampling_interval = "120 Minutes";
						break;
					case 7:
						frame_data.sampling_interval = "180 Minutes";
						break;
					case 8:
						frame_data.sampling_interval = "1 Minute";
						break;
				}
				frame_data.on_request_timeout = frame[27] + " Seconds";
				frame_data.deadband = frame[28] + "mg";

				switch(frame[29]){
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

				return {
					'firmware': frame[2],
					'destination_address': toMac(frame.slice(12, 16)),
					'mode': frame_data.mode,
					'odr_1': frame_data.odr_1+'Hz',
					'sampling_duration_1': frame_data.sampling_duration_1,
					'sampling_duration_2': frame_data.sampling_duration_2,
					'filter_status': frame_data.filter_status,
					'lpf_coeff_1': frame_data.lpf_coeff_1,
					'lpf_freq_1': frame_data.lpf_freq_1+'Hz',
					'hpf_coeff_1': frame_data.hpf_coeff_1,
					'hpf_freq_1': frame_data.hpf_freq_1+'Hz',
					'sampling_interval': frame_data.sampling_interval,
					'on_request_timeout': frame_data.on_request_timeout,
					'deadband': frame_data.deadband,
					'payload_length': frame_data.payload_length,
					'machine_values': {
						'firmware': frame[2],
						'destination_address': toMac(frame.slice(12, 16), false),
						'mode': frame[16],
						'odr_1': frame[17],
						'sampling_duration_1': frame[19],
						'sampling_duration_2': frame[20],
						'filter_status': frame[21],
						'lpf_coeff_1': frame[22],
						'hpf_coeff_1': frame[24],
						'sampling_interval': frame[26],
						'on_request_timeout': frame[27],
						'deadband': frame[28],
						'payload_length': frame[29]
					}
				}
			}
		},

		'101':{
			name: 'Pro Vibration',
			parse: (d, full)=>{
				return{
					mode: full[7] == 1? "raw" : "normal"
				};
			}
		},
		'200': {
			name: '4-20mA Pass Through',
			parse: (d) => {
				var adc1 = signInt(d.slice(0, 2).reduce(msbLsb));
				var adc2 = signInt(d.slice(2, 4).reduce(msbLsb));
				var dac1 = signInt(d.slice(4, 6).reduce(msbLsb));
				return {
					adc1: adc1,
					adc2: adc2,
					dac1: dac1,
					mA1: adc1/100.00,
					raw_adc: adc2,
					raw_dac: dac1,
					byteOne: d[0],
					byteTwo: d[1],
					byteThree: d[2],
					byteFour: d[3],
					byteFive: d[4],
					byteSix: d[5]
				};
			}
		},

		'202': {
			name: 'Wireless Weather Station',
			parse: (d) => {
				return {
					Temp: signInt(d.slice(0, 4).reduce(msbLsb), 32) / 100,
					Humid: signInt(d.slice(4, 8).reduce(msbLsb), 32) / 100,
					Pressure: signInt(d.slice(8, 12).reduce(msbLsb), 32) / 100,
					WindSpd: signInt(d.slice(12, 16).reduce(msbLsb),32) / 100,
					WindDir: signInt(d.slice(16, 20).reduce(msbLsb),32) / 100

				};
			}
		},
		'502': {
			name: 'Custom Environmental Sensor',
			parse: (d, full) => {
				reserve = full[7];
				if (reserve == 0xAA){
					var obj = {};
					for(i = 0; i < 18; i++){
						var label = 'sound'+i;
						obj[label] = d[i];
					}
					return obj;
				}else{
					return {

						temperature: signInt(d.slice(0, 2).reduce(msbLsb), 16) / 100,
						pressure: d.slice(2, 6).reduce(msbLsb) / 100,
						humidity: d.slice(6, 10).reduce(msbLsb) / 1000,
						gas_resistance: d.slice(10, 14).reduce(msbLsb),
						iaq: d.slice(14, 16).reduce(msbLsb),
						light: d.slice(16, 18).reduce(msbLsb),
						sound: d[18]
					};
				}
			}
		},

		'505': {
			'name': 'Custom SAP 1-Channel Current Monitor',
			parse: (d) => {
				return {
					channel_1_rms: d.slice(0, 3).reduce(msbLsb),
					channel_1_max: d.slice(4, 7).reduce(msbLsb),
					channel_1_min: d.slice(8, 11).reduce(msbLsb)
				};
			}
		},

		'506': {
			'name': 'Custom SAP 3-Channel Current Monitor',
			parse: (d) => {
				return {
					channel_1_rms: d.slice(0, 3).reduce(msbLsb),
					channel_1_max: d.slice(4, 7).reduce(msbLsb),
					channel_1_min: d.slice(8, 11).reduce(msbLsb),
					channel_2_rms: d.slice(12, 15).reduce(msbLsb),
					channel_2_max: d.slice(16, 19).reduce(msbLsb),
					channel_2_min: d.slice(20, 23).reduce(msbLsb),
					channel_3_rms: d.slice(24, 27).reduce(msbLsb),
					channel_3_max: d.slice(28, 31).reduce(msbLsb),
					channel_3_min: d.slice(32, 35).reduce(msbLsb)
				};
			}
		},

		'507': {
			'name': 'Custom SAP 7-Channel Current Monitor',
			parse: (d) => {
				return {
					channel_1_rms: d.slice(0, 3).reduce(msbLsb),
					channel_1_max: d.slice(4, 7).reduce(msbLsb),
					channel_1_min: d.slice(8, 11).reduce(msbLsb),
					channel_2_rms: d.slice(12, 15).reduce(msbLsb),
					channel_2_max: d.slice(16, 19).reduce(msbLsb),
					channel_2_min: d.slice(20, 23).reduce(msbLsb),
					channel_3_rms: d.slice(24, 27).reduce(msbLsb),
					channel_3_max: d.slice(28, 31).reduce(msbLsb),
					channel_3_min: d.slice(32, 35).reduce(msbLsb),
					channel_4_rms: d.slice(36, 39).reduce(msbLsb),
					channel_4_max: d.slice(40, 43).reduce(msbLsb),
					channel_4_min: d.slice(44, 47).reduce(msbLsb),
					channel_5_rms: d.slice(48, 51).reduce(msbLsb),
					channel_5_max: d.slice(52, 55).reduce(msbLsb),
					channel_5_min: d.slice(56, 59).reduce(msbLsb),
					channel_6_rms: d.slice(60, 63).reduce(msbLsb),
					channel_6_max: d.slice(64, 67).reduce(msbLsb),
					channel_6_min: d.slice(68, 71).reduce(msbLsb),
					channel_7_rms: d.slice(72, 75).reduce(msbLsb),
					channel_7_max: d.slice(76, 79).reduce(msbLsb),
					channel_7_min: d.slice(80, 83).reduce(msbLsb)



				};
			}
		},
		'510': {
			name: 'GreenLight',
			parse: (d) => {
				var adc = d.slice(0, 2).reduce(msbLsb);
				return {
					mA: adc /100.00
				};
			}
		},
		'515': {
			name: 'Multi-Channel Current Sensor',
			parse: (d, parsed, mac) => {
				let bank = d[9];
				let bank_total = d[8];

				// reserve byte is d[4]
				// reserve byte errors and meaning
				// 0x00(Success + no OTF) ,
				// 0x01 (Success + OTF) ,
				// 0x02 (Error + no OTF),
				// 0x03 (Error + OTF)
				if(d[7]>1){
					console.log('!-----!');
					console.log('515 Error Detected');
					console.log(d[7]);
					console.log('!-----!');
				}

				// Set the last packet counter context default to 280 as this is out of range
				// 280 will never be true
				if(!globalDevices.hasOwnProperty('last_packet_counter')){
					globalDevices['last_packet_counter'] = {};
				}
				if(!globalDevices['last_packet_counter'].hasOwnProperty(mac)){
					globalDevices['last_packet_counter'][mac] = 280;
				}

				// If there is no memory buffer for this device the create one
				if(!globalDevices.hasOwnProperty(mac)) {
					globalDevices[mac] = {};
					globalDevices[mac].data = {};
				}else{
					// If we can detect that this packet is part of a new packet,
					// send old mem buffer and restart
					// object.forEach loops through all and does not allow breaks
					// ideally we can switch to
					let stream_keys = Object.keys(globalDevices[mac].data);
					let less_than = (element) => bank < element;
					if(stream_keys.some(less_than)){
						let sensor_data = {};
						let sensor_payload_length = 54;
						for(let current_bank = 1; current_bank<=bank_total; current_bank++){
							for(let bindex = 0; bindex < sensor_payload_length; bindex+=9){
								// if the packet for a bank exists translate the data
								if(globalDevices[mac].data.hasOwnProperty(current_bank)){
									sensor_data[(bindex/9+6*(current_bank-1))+1] = {
										rms: globalDevices[mac].data[current_bank].slice(bindex, bindex+3).reduce(msbLsb),
										max: globalDevices[mac].data[current_bank].slice(bindex+3, bindex+6).reduce(msbLsb),
										min: globalDevices[mac].data[current_bank].slice(bindex+6, bindex+9).reduce(msbLsb)
									}
								}else{
									// If the buffer does not have this bank's packet
									// set default values of -1
									sensor_data[(bindex/9+6*(current_bank-1))+1] = {
										rms: -1,
										max: -1,
										min: -1
									}
								}
							}
						}

						// let sensor_data = this.build_515_data(bank, bank_total, mac);

						// Removed as not doing anything due to packet recovery attempt
						// delete globalDevices[mac];
						// globalDevices[mac] = {};
						// globalDevices[mac].data = {};

						// If we can only recover the last item in a bank
						// just consider the stream lost
						// to recover the last bank we would need to async call
						// this method again and it is not worth the complexity
						// unless this is absolutely necessary
						if(bank != bank_total){
							delete globalDevices[mac];
							globalDevices[mac] = {};
							globalDevices[mac].data = {};
							globalDevices[mac].data[bank] = d.slice(10,64);
						}else{
							delete globalDevices[mac];
						}
						return sensor_data;
					}
				}
				globalDevices[mac].data[bank] = d.slice(10,64);
				if(bank == bank_total && globalDevices['last_packet_counter'][mac] != d[4]){
					let sensor_data = {};
					let sensor_payload_length = 54;
					for(let current_bank = 1; current_bank<=bank_total; current_bank++){
						for(let bindex = 0; bindex < sensor_payload_length; bindex+=9){
							// if the packet for a bank exists translate the data
							if(globalDevices[mac].data.hasOwnProperty(current_bank)){
								sensor_data[(bindex/9+6*(current_bank-1))+1] = {
									rms: globalDevices[mac].data[current_bank].slice(bindex, bindex+3).reduce(msbLsb),
									max: globalDevices[mac].data[current_bank].slice(bindex+3, bindex+6).reduce(msbLsb),
									min: globalDevices[mac].data[current_bank].slice(bindex+6, bindex+9).reduce(msbLsb)
								}
							}else{
								// If the buffer does not have this bank's packet
								// set default values of -1
								sensor_data[(bindex/9+6*(current_bank-1))+1] = {
									rms: -1,
									max: -1,
									min: -1
								}
							}
						}
					}
					globalDevices['last_packet_counter'][mac] = d[4];
					delete globalDevices[mac];
					return sensor_data;
				}else if(bank == bank_total && globalDevices['last_packet_counter'][mac] == d[4]){
					// This section of code was added to combat mystery repeat packet for last bank.
					delete globalDevices[mac];
				}
			}
		},
		'519': {
			name: 'Type 519 - Vibration',
			parse: (payload, parsed, mac) => {
				if(payload[7] >> 1 != 0){
					console.log('Error found');
					parsed.data = {error: 'Error found, Sensor Probe may be unattached'};
					return parsed;
				}

				if(payload[8] === 1){
					var deviceAddr = mac;
					var firmware = payload[1];
					var hour = payload[11];
					var minute = payload[12];
					var expected_packets = payload[19];
					var current_packet = payload[20];
					var sdata_start = 21;




					if(globalDevices.hasOwnProperty(deviceAddr)){
						// if a packet is already stored with the same packet ID, or if packet ID is 1, or if current packet ID is not one more than last packet ID
						if(current_packet in globalDevices[deviceAddr].data || current_packet == 1 || !(((current_packet&127)-1) in globalDevices[deviceAddr].data)) {
							console.log('-----');
							console.log('bad packet breakdown deleting stream');
							console.log(current_packet);
							console.log(expected_packets);
							console.log(current_packet in globalDevices[deviceAddr].data);
							console.log(current_packet == 1);
							console.log(!((current_packet-1) in globalDevices[deviceAddr].data));
							if(this.hasOwnProperty('failure_no')){
								this.failure_no = this.failure_no + 1;
							}
							else{
								this.failure_no = 1;
							}
							if(this.hasOwnProperty('failure_no')){
								console.log('####falure no');
								console.log(this.failure_no);
							}
							// console.log(globalDevices[deviceAddr].data);
							delete globalDevices[deviceAddr];
							if(current_packet != 1){
								return;
							} else{

								var mode = payload[8];
								var odr = payload[9];
								var en_axis = payload[10] & 7;
								var fsr = payload[10] >> 5;
								var device_temp = signInt(msbLsb(payload[13], payload[14]))/100;
								var adc_1_raw = msbLsb(payload[15], payload[16]);
								var adc_2_raw = msbLsb(payload[17], payload[18]);


								switch(odr){
									case 6:
										odr = 50;
										break;
									case 7:
										odr = 100;
										break;
									case 8:
										odr = 200;
										break;
									case 9:
										odr = 400;
										break;
									case 10:
										odr = 800;
										break;
									case 11:
										odr = 1600;
										break;
									case 12:
										odr = 3200;
										break;
									case 13:
										odr = 6400;
										break;
									case 14:
										odr = 12800;
										break;
									case 15:
										odr = 25600;
										break;
									default:
										odr = 0;
								}

								globalDevices[deviceAddr] = {
									// stream_size: expected_packets,
									data: {},
									odr: odr,
									mo: mode,
									en_axis: en_axis,
									fsr: fsr,
									hour: hour,
									minute: minute,
									adc_1_raw: adc_1_raw,
									adc_2_raw: adc_2_raw,
									device_temp: device_temp,
								}
								globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
								return;
							}
						}
						else{
							globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						}

						if(Object.keys(globalDevices[deviceAddr].data).length == expected_packets){
							var raw_data = new Array();
							for(const packet in globalDevices[deviceAddr].data){
								raw_data = raw_data.concat(globalDevices[deviceAddr].data[packet]);
							}
							var label = 0;

							var fft = new Array();
							var fft_concat = {};

							var en_axis_data = {};
							switch (globalDevices[deviceAddr].en_axis){
								case 1:
									en_axis_data.x_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 2:
									en_axis_data.y_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 3:
									en_axis_data.x_offset = 0;
									en_axis_data.y_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 4:
									en_axis_data.z_offset = 0;
									en_axis_data.increment = 2;
									break;
								case 5:
									en_axis_data.x_offset = 0;
									en_axis_data.z_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 6:
									en_axis_data.y_offset = 0;
									en_axis_data.z_offset = 2;
									en_axis_data.increment = 4;
									break;
								case 7:
									en_axis_data.x_offset = 0;
									en_axis_data.y_offset = 2;
									en_axis_data.z_offset = 4;
									en_axis_data.increment = 6;
									break;
								default:
									en_axis_data.increment = 0;
							}

							var fsr_mult = .00006;
							var fsr_text = "";
							switch(globalDevices[deviceAddr].fsr){
								case 0:
									fsr_mult = 0.00006;
									break;
								case 1:
									fsr_mult = 0.00012;
									break;
								case 2:
									fsr_mult = 0.00024;
									break;
								case 3:
									fsr_mult = 0.00049;
									break;
							}
							switch(globalDevices[deviceAddr].fsr){
								case 0:
									fsr_text = "2g";
									break;
								case 1:
									fsr_text = "4g";
									break;
								case 2:
									fsr_text = "8g";
									break;
								case 3:
									fsr_text = "16g";
									break;
							}

							for(var i = 0; i < raw_data.length; i+=en_axis_data.increment){
								label++;

								fft_concat[label] = {};

								if('x_offset' in en_axis_data){
									fft_concat[label].x = parseFloat((signInt(((raw_data[i+en_axis_data.x_offset]<<8)+(raw_data[i+en_axis_data.x_offset+1])), 16)*fsr_mult).toFixed(5));
								}
								if('y_offset' in en_axis_data){
									fft_concat[label].y = parseFloat((signInt(((raw_data[i+en_axis_data.y_offset]<<8)+(raw_data[i+en_axis_data.y_offset+1])), 16)*fsr_mult).toFixed(5));
								}
								if('z_offset' in en_axis_data){
									fft_concat[label].z = parseFloat((signInt(((raw_data[i+en_axis_data.z_offset]<<8)+(raw_data[i+en_axis_data.z_offset+1])), 16)*fsr_mult).toFixed(5));
								}
							}
							var fft_concat_obj = {
								time_id: globalDevices[deviceAddr].hour +':'+ globalDevices[deviceAddr].minute,
								mac_address: deviceAddr,
								en_axis: globalDevices[deviceAddr].en_axis,
								fsr: fsr_text,
								odr: globalDevices[deviceAddr].odr,
								device_temp: globalDevices[deviceAddr].device_temp,
								data: fft_concat
							};
							sensor_data = fft_concat_obj;
							delete globalDevices[deviceAddr];
							if(this.hasOwnProperty('failure_no')){
								console.log('####falure no');
								console.log(this.failure_no);
							}

							return sensor_data;
						}
						else{
							return;
						}
					}else{

						var mode = payload[8];
						var odr = payload[9];
						var en_axis = payload[10] & 7;
						var fsr = payload[10] >> 5;
						var device_temp = signInt(msbLsb(payload[13], payload[14]))/100;
						var adc_1_raw = msbLsb(payload[15], payload[16]);
						var adc_2_raw = msbLsb(payload[17], payload[18]);


						switch(odr){
							case 6:
								odr = 50;
								break;
							case 7:
								odr = 100;
								break;
							case 8:
								odr = 200;
								break;
							case 9:
								odr = 400;
								break;
							case 10:
								odr = 800;
								break;
							case 11:
								odr = 1600;
								break;
							case 12:
								odr = 3200;
								break;
							case 13:
								odr = 6400;
								break;
							case 14:
								odr = 12800;
								break;
							case 15:
								odr = 25600;
								break;
							default:
								odr = 0;
						}

						globalDevices[deviceAddr] = {
							// stream_size: expected_packets,
							data: {},
							odr: odr,
							mo: mode,
							en_axis: en_axis,
							fsr: fsr,
							hour: hour,
							minute: minute,
							adc_1_raw: adc_1_raw,
							adc_2_raw: adc_2_raw,
							device_temp: device_temp,
						}
						globalDevices[deviceAddr].data[current_packet] = payload.slice(sdata_start);
						return;
					}
				}
				else{
					// mode byte most significant bit will indicate fft data.
					// console.log(d);
					var odr;
					switch(payload[9]){
						case 6:
							odr = "50Hz"
							break;
						case 7:
							odr = "100Hz";
							break;
						case 8:
							odr = "200Hz";
							break;
						case 9:
							odr = "400Hz";
							break;
						case 10:
							odr = "800Hz";
							break;
						case 11:
							odr = "1600Hz";
							break;
						case 12:
							odr = "3200Hz";
							break;
						case 13:
							odr = "6400Hz";
							break;
						case 14:
							odr = "12800Hz";
							break;
						case 15:
							odr = "25600Hz";
							break;
					}
					return {
						mode: payload[8],

						odr: odr,
						temperature: signInt(payload.slice(10, 12).reduce(msbLsb), 16) / 100,

						adc_1_raw: payload.slice(12, 14).reduce(msbLsb),
						adc_2_raw: payload.slice(14, 16).reduce(msbLsb),

						x_rms_ACC_G: payload.slice(16, 18).reduce(msbLsb)/1000,
						x_max_ACC_G: payload.slice(18, 20).reduce(msbLsb)/1000,
						x_velocity_mm_sec: payload.slice(20, 22).reduce(msbLsb) / 100,
						x_displacement_mm: payload.slice(22, 24).reduce(msbLsb) / 100,
						x_peak_one_Hz: payload.slice(24, 26).reduce(msbLsb),
						x_peak_two_Hz: payload.slice(26, 28).reduce(msbLsb),
						x_peak_three_Hz: payload.slice(28, 30).reduce(msbLsb),

						y_rms_ACC_G: payload.slice(30, 32).reduce(msbLsb)/1000,
						y_max_ACC_G: payload.slice(32, 34).reduce(msbLsb)/1000,
						y_velocity_mm_sec: payload.slice(34, 36).reduce(msbLsb) / 100,
						y_displacement_mm: payload.slice(36, 38).reduce(msbLsb) / 100,
						y_peak_one_Hz: payload.slice(38, 40).reduce(msbLsb),
						y_peak_two_Hz: payload.slice(40, 42).reduce(msbLsb),
						y_peak_three_Hz: payload.slice(42, 44).reduce(msbLsb),

						z_rms_ACC_G: payload.slice(44, 46).reduce(msbLsb)/1000,
						z_max_ACC_G: payload.slice(46, 48).reduce(msbLsb)/1000,
						z_velocity_mm_sec: payload.slice(48, 50).reduce(msbLsb) / 100,
						z_displacement_mm: payload.slice(50,52).reduce(msbLsb) / 100,
						z_peak_one_Hz: payload.slice(52, 54).reduce(msbLsb),
						z_peak_two_Hz: payload.slice(54, 56).reduce(msbLsb),
						z_peak_three_Hz: payload.slice(56, 58).reduce(msbLsb),
					};
				}
			},
			'parse_fly': (frame) => {
				let frame_data = {};
				switch(frame[16]){
					case 0:
						frame_data.mode = "Processed";
						break;
					case 1:
						frame_data.mode = "Raw";
						break;
					case 2:
						frame_data.mode = "Processed + Raw on demand";
						break;
				}
				switch(frame[17]){
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
				frame_data.sampling_duration_1 = frame[19]*50 + "ms";
				switch(frame[21]){
					case 0:
						frame_data.filter_status = "Disabled";
						break;
					case 1:
						frame_data.filter_status = "Enabled";
						break;
				}
				switch(frame[22]){
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
				switch(frame[24]){
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
				switch(frame[26]){
					case 0:
						frame_data.sampling_interval = "5 Minutes";
						break;
					case 1:
						frame_data.sampling_interval = "10 Minutes";
						break;
					case 2:
						frame_data.sampling_interval = "15 Minutes";
						break;
					case 2:
						frame_data.sampling_interval = "20 Minutes";
						break;
					case 4:
						frame_data.sampling_interval = "30 Minutes";
						break;
					case 5:
						frame_data.sampling_interval = "60 Minutes";
						break;
					case 6:
						frame_data.sampling_interval = "120 Minutes";
						break;
					case 7:
						frame_data.sampling_interval = "180 Minutes";
						break;
					case 8:
						frame_data.sampling_interval = "1 Minute";
						break;
				}
				frame_data.on_request_timeout = frame[27] + " Seconds";
				frame_data.deadband = frame[28] + "mg";

				switch(frame[29]){
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

				return {
					'firmware': frame[2],
					'destination_address': toMac(frame.slice(12, 16)),
					'mode': frame_data.mode,
					'odr_1': frame_data.odr_1+'Hz',
					'sampling_duration_1': frame_data.sampling_duration_1,
					'sampling_duration_2': frame_data.sampling_duration_2,
					'filter_status': frame_data.filter_status,
					'lpf_coeff_1': frame_data.lpf_coeff_1,
					'lpf_freq_1': frame_data.lpf_freq_1+'Hz',
					'hpf_coeff_1': frame_data.hpf_coeff_1,
					'hpf_freq_1': frame_data.hpf_freq_1+'Hz',
					'sampling_interval': frame_data.sampling_interval,
					'on_request_timeout': frame_data.on_request_timeout,
					'deadband': frame_data.deadband,
					'payload_length': frame_data.payload_length,
					'machine_values': {
						'firmware': frame[2],
						'destination_address': toMac(frame.slice(12, 16), false),
						'mode': frame[16],
						'odr_1': frame[17],
						'sampling_duration_1': frame[19],
						'sampling_duration_2': frame[20],
						'filter_status': frame[21],
						'lpf_coeff_1': frame[22],
						'hpf_coeff_1': frame[24],
						'sampling_interval': frame[26],
						'on_request_timeout': frame[27],
						'deadband': frame[28],
						'payload_length': frame[29]
					}
				}
			}
		},
		'520': {
			name: 'Type 520 - 6 Channel Current Temperature and Humidity',
			parse: (payload, parsed) => {
				return {
					current_1_ma: payload.slice(0, 4).reduce(msbLsb),
					frequency_1: payload.slice(4, 6).reduce(msbLsb),
					current_2_ma: payload.slice(6, 10).reduce(msbLsb),
					frequency_2: payload.slice(10, 12).reduce(msbLsb),
					current_3_ma: payload.slice(12, 16).reduce(msbLsb),
					frequency_3: payload.slice(16, 18).reduce(msbLsb),
					current_4_ma: payload.slice(18, 22).reduce(msbLsb),
					frequency_4: payload.slice(22, 24).reduce(msbLsb),
					current_5_ma: payload.slice(24, 28).reduce(msbLsb),
					frequency_5: payload.slice(28, 30).reduce(msbLsb),
					current_6_ma: payload.slice(30, 34).reduce(msbLsb),
					frequency_6: payload.slice(34, 36).reduce(msbLsb),
					humidity: payload.slice(36, 38).reduce(msbLsb) / 100,
					temperature: signInt(payload.slice(38, 40).reduce(msbLsb), 16) / 100,
				}
			},
			'parse_fly': (frame) => {
				let frame_data = {};
				return {
					'firmware': frame[2],
					'destination_address': toMac(frame.slice(12, 16)),
					'machine_values': {
						'firmware': frame[2],
						'destination_address': toMac(frame.slice(12, 16), false),
						'frame': frame
					}
				}
			}
		},
		'10000': {
			name: '4-Relay',
			parse: (d) => {
				return {
					relay_1: d[0] & 1 ? 1 : 0,
					relay_2: d[0] & 2 ? 1 : 0,
					relay_3: d[0] & 4 ? 1 : 0,
					relay_4: d[0] & 8 ? 1 : 0
				};
			},
			control: (msg) => {
				switch(msg.topic){
					case 'all':
						return [3, parseInt(msg.payload)];
					case 'get_status':
						return [2];
					default:
						return [parseInt(msg.payload), parseInt(msg.topic.split('_').pop())];
				}
			}
		},
		'10006':{
			name: '4-Channel 4-20 mA Input',
			parse: (d) => {
				var readings = {};
				for(var i=0;i++;i<4) readings[`channel_${i+1}`] = d.slice((i*2), 1+(i*2)).reduce(msbLsb) / 100;
				return readings;
			}
		},
		'10007':{
			name: '4-Channel Current Monitor',
			parse: (d) => {
				var readings = {};
				for(var i=0;i++;i<4) readings[`channel_${i+1}`] = d.slice((i*3), 2+(i*3)).reduce(msbLsb) / 1000;
				return readings;
			}
		},
		'10012':{
			name: '2-Relay + 2-Input',
			parse: (d) => {
				return {
					relay_1: d[0] & 1 ? 1 : 0,
					relay_2: d[0] & 2 ? 1 : 0,
					input_1: d[1] & 1 ? 1 : 0,
					input_2: d[1] & 2 ? 1 : 0
				};
			},
			control: (msg) => {

				switch(msg.topic){
					case 'all':
						return [3, parseInt(msg.payload)];
					case 'get_status':
						return [2];
					default:
						return [parseInt(msg.payload), parseInt(msg.topic.split('_').pop())];
				}
			}
		},
	};
	return types;
}
function chunkString1(str, len) {
	var _length = str.length,
		_size = Math.ceil(_length/len),
		_ret  = [];
	for(var _i=0; _i<_length; _i+=len) {
		_ret.push(str.substring(_i, _i + len));
	}
	return _ret;
}
function mac2bytes(mac){
	return mac.split(':').map((v) => parseInt(v, 16));
}
function msbLsb(m,l){return (m<<8)+l;}
function toHex(n){return ('00' + n.toString(16)).substr(-2);}

function toMac(arr, add_colon = true){
	if(add_colon){
		return arr.reduce((h,c,i) => {return (i==1?toHex(h):h)+':'+toHex(c);});
	}else{
		return arr.reduce((h,c,i) => {return (i==1?toHex(h):h)+toHex(c);});
	}
}
function byte2mac(h,c,i){return h.constructor == Array ? h.reduce(byte2mac) : (i==1?h.toHex():h)+':'+c.toHex();}
function int2Bytes(i, l){
	var bits = i.toString(2);
	if(bits.length % 8) bits = ('00000000' + bits).substr(bits.length % 8);
	var bytes = chunkString1(bits, 8).map((v) => parseInt(v, 2));
	if(bytes.length < l){
		while(bytes.length < l){
			bytes.unshift(0);
		}
	}
	return bytes;
}
function signInt(i, b){
	if(i.toString(2).length != b) return i;
	return -(((~i) & ((1 << (b-1))-1))+1);
}

//signInt=(d,b) => d>1<<(b-2)?0-((1<<b)-d):d;
