const wireless = require("./index.js");
const comms = require('ncd-red-comm');
const sp = require('serialport');
const Queue = require("promise-queue");
const events = require("events");
const fs = require('fs');
const path = require('path');
const home_dir = require('os').homedir
const { isDeepStrictEqual } = require('util');


module.exports = function(RED) {
	var gateway_pool = {};
	function NcdGatewayConfig(config){
		RED.nodes.createNode(this,config);

		this.port = config.comm_type == 'serial' ? config.port : config.tcp_port;
		this.baudRate = parseInt(config.baudRate);

		this.listeners = [];
		this.sensor_pool = [];
		// TODO sensor_list is a temporary property, should be combined with sensor_pool
		this.sensor_list = {};
		this._emitter = new events.EventEmitter();
		this.on = (e,c) => this._emitter.on(e, c);
		
		const config_file_location = home_dir()+'/.node-red/node_modules/@ncd-io/node-red-enterprise-sensors/data/sensor_configs.json';
		const configuration_map_location = home_dir()+'/.node-red/node_modules/@ncd-io/node-red-enterprise-sensors/data/configuration_map.json';
		const sensor_type_map_location = home_dir()+'/.node-red/node_modules/@ncd-io/node-red-enterprise-sensors/data/sensor_type_map.json';

		this.config_node_capable = [114];

		// comms_timer object var added to clear the time to prevent issues with rapid redeploy
		this.comms_timer;

		// this.sensor_configs = {};
		try {
			this.sensor_configs = JSON.parse(fs.readFileSync(config_file_location,));
		} catch(err){
			this.sensor_configs = {};
		};

		try {
			this.configuration_map = JSON.parse(fs.readFileSync(configuration_map_location,));	
		} catch(err){
			this.configuration_map = {};
			console.log('Error reading configuration list');
		};

		try {
			this.sensor_type_map = JSON.parse(fs.readFileSync(sensor_type_map_location,));	
		} catch(err){
			this.sensor_type_map = {};
			console.log('Error reading sensor type map file');
		};



		if(config.comm_type == 'serial'){
			this.key = config.port;
		}
		else{
			this.key = config.ip_address+":"+config.tcp_port;
		}

		this.store_sensor_configs = function(sensor_configs){
			fs.writeFile(config_file_location, sensor_configs, function(err){
				if(err){
					return err;
				}else{
					return true;
				}
			});
		};

		var node = this;

		node.is_config = 3;
		node.open_comms = function(cb){
			if(typeof gateway_pool[this.key] == 'undefined'){
				if(config.comm_type == 'serial'){
					var comm = new comms.NcdSerial(this.port, this.baudRate);
					comm._emitter.on('error', (err) => {
						console.log('gateway config serial error', err);
					});
				}else{
					if(!config.ip_address){
						return;
					}
					if(!config.tcp_inactive_timeout){
						config.tcp_inactive_timeout = 1200;
					}
					if(config.tcp_inactive_timeout_active){
						var comm = new comms.NcdTCP(config.ip_address, this.port, false, parseInt(config.tcp_inactive_timeout));
					}else{
						var comm = new comms.NcdTCP(config.ip_address, this.port, false, false);
					}
					comm._emitter.on('error', (err) => {
						console.log('tcp init error', err);
					});
				}
				var modem = new wireless.Modem(comm);
				gateway_pool[this.key] = new wireless.Gateway(modem);
				gateway_pool[this.key].pan_id = false;

				this.gateway = gateway_pool[this.key];
				this.gateway.digi.report_rssi = config.rssi;

				if(config.comm_type == 'serial'){
					if(config.port !== ''){
						this.comms_timer = setTimeout(()=>{node.gateway.digi.serial.setupSerial()}, 5000);
					}else{
						node.warn('No Port Selected for Serial Communications.')
					}
				}else{
					if(config.tcp_port === '' || config.ip_address === ''){
						node.warn('TCP Socket not configured for Network Communications. Please enter a Port and IP Address.');
					}else{
						this.comms_timer = setTimeout(()=>{node.gateway.digi.serial.setupClient()}, 5000);
					}
				}
				node.gateway.digi.serial.on('ready', () => {
					node.gateway.digi.send.at_command('SL').then((res) => {
						node.gateway.modem_mac = '00:13:A2:00:'+toMac(res.data);
					}).catch((err) => {
						console.log(err);
						node.gateway.digi.serial.reconnect();
					}).then(node.check_mode((mode) => {
						var pan_id = parseInt(config.pan_id, 16);
						// if(!mode && node.gateway.pan_id != pan_id){
						if(node.gateway.pan_id != pan_id){
							node.gateway.digi.send.at_command("ID", [pan_id >> 8, pan_id & 255]).then((res) => {
								node.gateway.pan_id = pan_id;
							}).catch((err) => {
								console.log(err);
								node.gateway.digi.serial.reconnect();
							});
						}
						// Event listener to make sure this only triggers once no matter how many gateway nodes there are
						node.gateway.on('sensor_mode', (d) => {
							if(d.mode == "FLY" || d.mode == "OTF"){
								if(Object.hasOwn(node.sensor_list, d.mac) && Object.hasOwn(node.sensor_list[d.mac], 'update_request') && d.mode == "FLY"){
									node.request_manifest(d.mac);
								}else if(node.config_node_capable.includes(d.type)){
									// API CONFIGURATION NODE
									let values = d.reported_config.machine_values;
									if(Object.hasOwn(values, 'uptime_counter')) delete values.uptime_counter;
									if(Object.hasOwn(values, 'tx_lifetime_counter')) delete values.tx_lifetime_counter;
									if(Object.hasOwn(values, 'reserved')) delete values.reserved;

									let store_flag = false;
									// hardware_id we might remove as well, it is useful though.
									if(!Object.hasOwn(node.sensor_configs, d.mac)){
										node.sensor_configs[d.mac] = {};
										store_flag = true;
									}
									// Store hardware_id outside of reported_configs
									if(!Object.hasOwn(node.sensor_configs[d.mac], 'hardware_id') && Object.hasOwn(values, 'hardware_id')){
										node.sensor_configs[d.mac].hardware_id = values.hardware_id;
										store_flag = true;
									}
									if(Object.hasOwn(values, 'hardware_id')) delete values.hardware_id;
									
									if(!Object.hasOwn(node.sensor_configs[d.mac], 'reported_configs')){
										node.sensor_configs[d.mac].reported_configs = {};
										store_flag = true;
									}
									if(!Object.hasOwn(node.sensor_configs[d.mac], 'desired_configs')){
										node.sensor_configs[d.mac].desired_configs = values;
										store_flag = true;
									}
									
									if(!Object.hasOwn(node.sensor_configs[d.mac], 'type')){
										node.sensor_configs[d.mac].type = d.type;
										store_flag = true;
									}else if(node.sensor_configs[d.mac].type != d.type){
										// TODO this node can't send messages, need to emit event and have API node listen for it
										// node.send({topic: 'sensor_type_error', payload: {'error': "Sensor type used for desired configs does not match sensor type reported by sensor. Deleting desired configs0"}, time: Date.now()});
										delete node.sensor_configs[d.mac].desired_configs;
										node.sensor_configs[d.mac].type = d.type;
										// node.store_sensor_configs(JSON.stringify(node.sensor_configs));
										node._emitter.emit('config_node_error', {topic: 'sensor_type_error', payload: {'error': "Sensor type used for desired configs does not match sensor type reported by sensor. Deleting desired configs"}, addr: d.mac, time: Date.now()});
										store_flag = true;
									}
									if(!isDeepStrictEqual(node.sensor_configs[d.mac].reported_configs, values)){
										// Values are different, update the stored configs and write to file
										node.sensor_configs[d.mac].reported_configs = values;
										// node.store_sensor_configs(JSON.stringify(node.sensor_configs));
										// TODO this node can't send messages, need to emit event and have API node listen for it
										store_flag = true;
										node._emitter.emit('config_node_msg', {topic: 'sensor_configs_update', payload: node.sensor_configs[d.mac], addr: d.mac, time: Date.now()});
										// node.send({topic: 'sensor_configs_update', payload: node.sensor_configs[d.mac], time: Date.now()});
									}

									if(Object.hasOwn(node.sensor_configs[d.mac], 'desired_configs') && d.mode != "OTF"){
										let required_configs = this.get_required_configs(node.sensor_configs[d.mac].desired_configs, node.sensor_configs[d.mac].reported_configs);
										if(Object.keys(required_configs).length !== 0){
											node.sensor_configs[d.mac].temp_required_configs = required_configs;
											store_flag = true;
											var tout = setTimeout(() => {
												this._send_otn_request(d);
											}, 100);
										}
									}
									if(store_flag){
										node.store_sensor_configs(JSON.stringify(node.sensor_configs));
									}
								}
							}else if(d.mode == "OTN" && Object.hasOwn(node.sensor_configs, d.mac) && Object.hasOwn(node.sensor_configs[d.mac], 'temp_required_configs')){
								node.configure(d);
							}
						});
						node.gateway.on('manifest_received', (manifest_data) => {
							// read manifest length is 37. Could use the same event for both
							if(Object.hasOwn(node.sensor_list, manifest_data.addr) && Object.hasOwn(node.sensor_list[manifest_data.addr], 'update_request')){
								// TODO check manifest data and start update process
							}
							manifest_data.data = node._parse_manifest_read(manifest_data.data);
							node._emitter.emit('send_manifest', manifest_data);
							let firmware_data = node._compare_manifest(manifest_data);
							if(!firmware_data){
								delete node.sensor_list[manifest_data.addr].update_request;
								return;
							}

							// TODO Right now assume everything is good
							// node.gateway.firmware_set_to_ota_mode(manifest_data.addr);

							setTimeout(() => {
								var tout = setTimeout(() => {
									console.log('Start OTA Timed Out');
								}, 10000);

								var promises = {};
								promises.firmware_set_to_ota_mode = node.gateway.firmware_set_to_ota_mode(manifest_data.addr);
								promises.finish = new Promise((fulfill, reject) => {
									node.gateway.queue.add(() => {
										return new Promise((f, r) => {
											clearTimeout(tout);
											// node.status(modes.FLY);
											fulfill();
											f();
										});
									});
								});
								for(var i in promises){
									(function(name){
										promises[name].then((res) => {
											if(name != 'finish'){
												// IF we receive an FON message with success
												if(Object.hasOwn(res, 'data') && res.data[0] == 70 && res.data[1] == 79 && res.data[2] == 78 && res.result == 255){
													manifest_data.enter_ota_fota_version = res.original.data[5];
													manifest_data.enter_ota_success = true;
													console.log(res);
												}else{
													manifest_data.enter_ota_success = false;
												}
												console.log(name);
											} else{
												if(manifest_data.enter_ota_success){
													// enter ota mode
													node.gateway.digi.send.at_command("ID", [0x7a, 0xaa]).then().catch().then(() => {
														console.log(manifest_data);
														if(manifest_data.enter_ota_fota_version > 16){
															console.log('V17 PROCESS');
															console.log(manifest_data);
															node.start_firmware_update_v17(manifest_data, firmware_data);
														}else if(manifest_data.enter_ota_fota_version > 12){
															console.log('V13 PROCESS');
															console.log(manifest_data);
															node.start_firmware_update_v13(manifest_data, firmware_data);
														}else{
															console.log('OLD PROCESSS');
															console.log(manifest_data);
															node.start_firmware_update(manifest_data, firmware_data);
														}
													});
												}
											}
										}).catch((err) => {
											console.log(err);
											// msg[name] = err;
										});
									})(i);
								};
							});
						});
					}));
				});
				node.gateway.digi.serial.on('closed_comms', () => {
					node.is_config = 3;
					node._emitter.emit('mode_change', node.is_config);
				});
			}
		};






		this.get_required_configs = function(desired_configs, reported_configs){
			const mismatched = {};
			for (const key in desired_configs) {
				if (reported_configs.hasOwnProperty(key)) {					
					if (!isDeepStrictEqual(desired_configs[key], reported_configs[key])) {
					// if (desired_configs[key] !== reported_configs[key]) {
							mismatched[key] = desired_configs[key];
					};
				};
			};
			return mismatched;
		};

		// TODO consider adding logic for if only 1 config to go out, skip OTN request
		this.configure = function(sensor){
			return new Promise((top_fulfill, top_reject) => {
				var success = {};
				setTimeout(() => {
					var tout = setTimeout(() => {
						// TODO handle timeout and send emitters
						node._emitter.emit('config_node_msg', {topic: 'Config Results', payload: success, addr: sensor.mac, time: Date.now()});
						// node.status(modes.PGM_ERR);
						// node.send({topic: 'Config Results', payload: success, time: Date.now(), addr: sensor.mac});
					}, 60000);
					// node.status(modes.PGM_NOW);
					var mac = sensor.mac;
					var promises = {};
					var reboot = false;
					
					let configs = node.sensor_configs[sensor.mac].temp_required_configs;
					for (const key in configs) {
						let config_obj = node.configuration_map[node.sensor_type_map[sensor.type].configs[key]];
						if(Object.hasOwn(config_obj, 'translate')){
							switch(config_obj.translate){
								case 'uint16':
									promises[key] = node.gateway[config_obj.call](sensor.mac, parseInt(configs[key], 16));
									break;
							}
						}else{
							promises[key] = node.gateway[config_obj.call](sensor.mac, parseInt(configs[key]));
						}
					}

					// These sensors listed in original_otf_devices use a different OTF code.
					let original_otf_devices = [53, 80, 81, 82, 83, 84, 87, 101, 102, 103, 110, 111, 112, 114, 117, 180, 181, 518, 519, 520, 538];
					// If we changed the network ID reboot the sensor to take effect.
					// TODO if we add the encryption key command to node-red we need to reboot for it as well.
					if(reboot){
						promises.reboot_sensor = node.gateway.config_reboot_sensor(mac);
					} else {
						if(original_otf_devices.includes(sensor.type)){
							promises.exit_otn_mode = node.gateway.config_exit_otn_mode(mac);
						}else{
							promises.config_exit_otn_mode_common = node.gateway.config_exit_otn_mode_common(mac);
						}
					}
					promises.finish = new Promise((fulfill, reject) => {
						node.gateway.queue.add(() => {
							return new Promise((f, r) => {
								clearTimeout(tout);
								// node.status(modes.READY);
								fulfill();
								f();
							});
						});
					});
					for(var i in promises){
						(function(name){
							promises[name].then((f) => {
								if(name != 'finish'){
									if(Object.hasOwn(f, 'result')){
										switch(f.result){
											case 255:
												success[name] = true;
												delete node.sensor_configs[mac].temp_required_configs[name];
												break;
											default:
												success[name] = {
													res: "Bad Response",
													result: f.result,
													sent: f.sent
												};
										}
									}else{
										success[name] = {
											res: "no result",
											result: null,
											sent: f.sent
										}
									}
								} else{
									// #OTF
									// Check if sensor responded with true for each config sent, if so delete from temp_required_configs
									// we could auto reboot sensor, but this could lead to boot cycle for bad configs/cmds
									if(Object.keys(node.sensor_configs[mac].temp_required_configs).length === 0){
										delete node.sensor_configs[mac].temp_required_configs;
									}
									// TODO turn into event emitter.
									node._emitter.emit('config_node_msg', {topic: 'Config Results', payload: success, addr: mac, time: Date.now()});
									// node.send({topic: 'Config Results', payload: success, time: Date.now(), addr: mac});
									top_fulfill(success);
								}
							}).catch((err) => {
								success[name] = err;
							});
						})(i);
					}
				}, 1000);
			});
		};

		this._send_otn_request = function(sensor){
			return new Promise((top_fulfill, top_reject) => {
				var msg = {};
				setTimeout(() => {
					var tout = setTimeout(() => {
						node.status(modes.PGM_ERR);
						node.send({topic: 'OTN Request Results', payload: msg, time: Date.now()});
					}, 10000);

					var promises = {};
					    // This command is used for OTF on types 53, 80,81,82,83,84, 101, 102, 110, 111, 518, 519
					const original_otf_devices = [53, 80, 81, 82, 83, 84, 87, 101, 102, 103, 110, 111, 112, 114, 117, 180, 181, 518, 519, 520, 538];
					if(original_otf_devices.includes(sensor.type)){
						// This command is used for OTF on types 53, 80, 81, 82, 83, 84, 101, 102, 110, 111, 518, 519
						promises.config_enter_otn_mode = node.gateway.config_enter_otn_mode(sensor.mac);
					}else{
						// This command is used for OTF on types not 53, 80, 81, 82, 83, 84, 101, 102, 110, 111, 518, 519
						promises.config_enter_otn_mode = node.gateway.config_enter_otn_mode_common(sensor.mac);
					}

					promises.finish = new Promise((fulfill, reject) => {
						node.gateway.queue.add(() => {
							return new Promise((f, r) => {
								clearTimeout(tout);
								// TODO emitter to set status on config nodes.
								// node.status(modes.FLY);
								fulfill();
								f();
							});
						});
					});
					for(var i in promises){
						(function(name){
							promises[name].then((f) => {
								if(name != 'finish') msg[name] = true;
								else{
									// #OTF
									node.warn('OTN Request Finished');
									// node.send({topic: 'OTN Request Results', payload: msg, time: Date.now()});
									top_fulfill(msg);
								}
							}).catch((err) => {
								if(Object.hasOwn(node.sensor_configs[sensor.mac], 'temp_required_configs')){
									delete node.sensor_configs[sensor.mac].temp_required_configs;
								}
								node.warn('Error entering OTN mode');
								msg[name] = err;
							});
						})(i);
					}
				});
			});
		};

		






		node.check_mode = function(cb){
			node.gateway.digi.send.at_command("ID").then((res) => {
				var pan_id = (res.data[0] << 8) | res.data[1];
				if(pan_id == 0x7BCD && parseInt(config.pan_id, 16) != 0x7BCD){
					node.is_config = 1;
				}else{
					node.gateway.pan_id = pan_id;
					node.is_config = 0;
				}
				if(cb) cb(node.is_config);
				return node.is_config;
			}).catch((err) => {
				console.log(err);
				node.is_config = 2;
				node.gateway.digi.serial.reconnect();
				if(cb) cb(node.is_config);
				return node.is_config;
			}).then((mode) => {
				node._emitter.emit('mode_change', mode);
			});
		};
		node.start_firmware_update = function(manifest_data, firmware_data){
			return new Promise((top_fulfill, top_reject) => {
				var success = {};

				setTimeout(() => {
					let chunk_size = 128;
					let image_start = firmware_data.firmware.slice(1, 5).reduce(msbLsb)+6;

					var promises = {};
					promises.manifest = node.gateway.firmware_send_manifest(manifest_data.addr, firmware_data.firmware.slice(5, image_start-1));
					firmware_data.firmware = firmware_data.firmware.slice(image_start+4);

					var index = 0;
					if(Object.hasOwn(node.sensor_list[manifest_data.addr], 'last_chunk_success')){
						index = node.sensor_list[manifest_data.addr].last_chunk_success;
					}
					var temp_count = 0;
					while(index*chunk_size < firmware_data.manifest.image_size){
						let offset = index*chunk_size;
						// console.log(index);
						// let packet = [254, 59, 0, 0, 0];
						let offset_bytes = int2Bytes(offset, 4);
						let firmware_chunk = firmware_data.firmware.slice(index*chunk_size, index*chunk_size+chunk_size);
						temp_count += 1;
						// packet = packet.concat(offset_bytes, firmware_chunk);
						promises[index] = node.gateway.firmware_send_chunk(manifest_data.addr, offset_bytes, firmware_chunk);
						index++;
					}

					promises.reboot = node.gateway.config_reboot_sensor(manifest_data.addr);

					for(var i in promises){
						(function(name){
							promises[name].then((f) => {
								if(name == 'manifest'){
									// delete node.sensor_list[manifest_data.addr].promises[name];
									node.sensor_list[manifest_data.addr].test_check = {name: true};
									node.sensor_list[manifest_data.addr].update_in_progress = true;
								}else {
									success[name] = true;
									node.sensor_list[manifest_data.addr].test_check[name] = true;
									node.sensor_list[manifest_data.addr].last_chunk_success = name;
									// delete node.sensor_list[manifest_data.addr].promises[name];
								}
							}).catch((err) => {
								if(name != 'reboot'){
									node.gateway.clear_queue();
									success[name] = err;
								}else{
									delete node.sensor_list[manifest_data.addr].last_chunk_success;
									delete node.sensor_list[manifest_data.addr].update_request;
									node._emitter.emit('send_firmware_stats', {state: success, addr: manifest_data.addr});
									// #OTF
									// node.send({topic: 'Config Results', payload: success, time: Date.now(), addr: manifest_data.addr});
									top_fulfill(success);
								}
								node._emitter.emit('send_firmware_stats', {state: success, addr: manifest_data.addr});
								node.resume_normal_operation();
							});
						})(i);
					}
				}, 1000);
			});
		};
		node.start_firmware_update_v13 = function(manifest_data, firmware_data){
			console.log('V13');
			return new Promise((top_fulfill, top_reject) => {
				var success = {successes:{}, failures:{}};

				let chunk_size = 128;
				let image_start = firmware_data.firmware.slice(1, 5).reduce(msbLsb)+6;

				var promises = {
					manifest: node.gateway.firmware_send_manifest(manifest_data.addr, firmware_data.firmware.slice(5, image_start-1))
				};
				// promises.manifest = node.gateway.firmware_send_manifest(manifest_data.addr, firmware_data.firmware.slice(5, image_start-1));
				firmware_data.firmware = firmware_data.firmware.slice(image_start+4);

				var index = 0;
				if(Object.hasOwn(node.sensor_list[manifest_data.addr], 'last_chunk_success')){
					index = node.sensor_list[manifest_data.addr].last_chunk_success;
				}
				while(index*chunk_size < firmware_data.manifest.image_size){
					let offset = index*chunk_size;
					let offset_bytes = int2Bytes(offset, 4);
					let firmware_chunk = firmware_data.firmware.slice(index*chunk_size, index*chunk_size+chunk_size);
					promises[index] = node.gateway.firmware_send_chunk_v13(manifest_data.addr, offset_bytes, firmware_chunk);
					if(((index + 1) % 50) == 0 || (index+1)*chunk_size >= firmware_data.manifest.image_size){
						promises[index+'_check'] = node.gateway.firmware_read_last_chunk_segment(manifest_data.addr);
					};
					index++;
				}
				console.log('Update Started');
				console.log(Object.keys(promises).length);
				console.log(Date.now());
				promises.reboot = node.gateway.config_reboot_sensor(manifest_data.addr);
				var firmware_continue = true;
				for(var i in promises){
					(function(name){
						let retryCount = 0;
						const maxRetries = 3; // Set the maximum number of retries

						function attemptPromise() {
							console.log(name);
							promises[name].then((status_frame) => {
								if(name == 'manifest'){
									console.log('MANIFEST SUCCESFULLY SENT');
									node.sensor_list[manifest_data.addr].test_check = {name: true};
									node.sensor_list[manifest_data.addr].update_in_progress = true;
								}
								else if(name.includes('_check')){
									console.log(name);
									console.log(parseInt(name.split('_')[0]) * chunk_size);
									let last_chunk = status_frame.data.reduce(msbLsb);
									console.log(last_chunk);
									if(last_chunk != (parseInt(name.split('_')[0]) * chunk_size)){
										console.log('ERROR DETECTED IN OTA UPDATE');
										success.failures[name] = {chunk: last_chunk, last_transmit: (parseInt(name.split('_')[0]) * chunk_size), last_report: last_chunk};
										// node.gateway.clear_queue_except_last();
										node.gateway.clear_queue();
										node.resume_normal_operation();
									} else {
										success.successes[name] = {chunk: last_chunk};
									}
								}
								else {
									success[name] = true;
									node.sensor_list[manifest_data.addr].test_check[name] = true;
									node.sensor_list[manifest_data.addr].last_chunk_success = name;
								}
							}).catch((err) => {
								console.log(name);
								console.log(err);
								if(name != 'reboot'){
									node.gateway.clear_queue();
									success[name] = err;
								} else {
									delete node.sensor_list[manifest_data.addr].last_chunk_success;
									delete node.sensor_list[manifest_data.addr].update_request;
									node._emitter.emit('send_firmware_stats', {state: success, addr: manifest_data.addr});
									top_fulfill(success);
								}
								console.log('Update Finished')
								console.log(Date.now());
								node._emitter.emit('send_firmware_stats', {state: success, addr: manifest_data.addr});
								node.resume_normal_operation();
							});
						}
						attemptPromise(); // Start the initial attempt
					})(i);
				}
			});
		};
		node.start_firmware_update_v17 = function(manifest_data, firmware_data){
			console.log('V17 Update Start');
			var start_offset = 0;
			setTimeout(() => {
				if(Object.hasOwn(node.sensor_list[manifest_data.addr], 'last_chunk_success')){
					node.gateway.firmware_read_last_chunk_segment(manifest_data.addr).then((status_frame) => {
						console.log('Last Chunk Segment Read');
						console.log(status_frame);
						start_offset = status_frame.data.slice(4,8).reduce(msbLsb);
						node.queue_firmware_update_v17(manifest_data, firmware_data, start_offset);
					}).catch((err) => {
						// TODO FOTA EMIT ERROR FOTA
						console.log('Error reading last chunk segment');
						node.resume_normal_operation();
					});
				}else{
					node.queue_firmware_update_v17(manifest_data, firmware_data, start_offset);
				};
			}, 1000);
		};
		node.queue_firmware_update_v17 = function(manifest_data, firmware_data, start_offset){
			console.log('V17 Queue Update Start');
			console.log('Start Offset: '+start_offset);
			return new Promise((top_fulfill, top_reject) => {
				var success = {successes:{}, failures:{}};

				let chunk_size = 128;
				let image_start = firmware_data.firmware.slice(1, 5).reduce(msbLsb)+6;
				var promises = {};
				if(start_offset == 0){
					promises.manifest = node.gateway.firmware_send_manifest(manifest_data.addr, firmware_data.firmware.slice(5, image_start-1));
				};
				// promises.manifest = node.gateway.firmware_send_manifest(manifest_data.addr, firmware_data.firmware.slice(5, image_start-1));
				firmware_data.firmware = firmware_data.firmware.slice(image_start+4);

				// if(Object.hasOwn(node.sensor_list[manifest_data.addr], 'last_chunk_success')){
				// 	index = node.sensor_list[manifest_data.addr].last_chunk_success;
				// }

				// reverse calculate index based on start_offset.
				var index = parseInt(start_offset / chunk_size);
				console.log('Index: '+index);
				while(index*chunk_size < firmware_data.manifest.image_size){
					let offset = index*chunk_size;
					let offset_bytes = int2Bytes(offset, 4);
					let firmware_chunk = firmware_data.firmware.slice(index*chunk_size, index*chunk_size+chunk_size);
					promises[index] = node.gateway.firmware_send_chunk_v13(manifest_data.addr, offset_bytes, firmware_chunk);
					if(((index + 1) % 50) == 0 || (index+1)*chunk_size >= firmware_data.manifest.image_size){
						promises[index+'_check'] = node.gateway.firmware_read_last_chunk_segment(manifest_data.addr);
					};
					index++;
				}
				console.log('Update Started');
				console.log(Object.keys(promises).length);
				console.log(Date.now());
				promises.reboot = node.gateway.config_reboot_sensor(manifest_data.addr);
				var firmware_continue = true;
				for(var i in promises){
					(function(name){
						let retryCount = 0;
						const maxRetries = 3; // Set the maximum number of retries

						function attemptPromise() {
							console.log(name);
							promises[name].then((status_frame) => {
								if(name == 'manifest'){
									console.log('MANIFEST SUCCESFULLY SENT');
									node.sensor_list[manifest_data.addr].test_check = {name: true};
									node.sensor_list[manifest_data.addr].update_in_progress = true;
								}
								else if(name.includes('_check')){
									console.log(name);
									console.log(parseInt(name.split('_')[0]) * chunk_size);
									let last_chunk = status_frame.data.slice(0,4).reduce(msbLsb);
									console.log(last_chunk);
									if(last_chunk != (parseInt(name.split('_')[0]) * chunk_size)){
										console.log('ERROR DETECTED IN OTA UPDATE');
										success.failures[name] = {chunk: last_chunk, last_transmit: (parseInt(name.split('_')[0]) * chunk_size), last_report: last_chunk};
										// node.gateway.clear_queue_except_last();
										node.gateway.clear_queue();
										node.resume_normal_operation();
									} else {
										success.successes[name] = {chunk: last_chunk};
									}
								}
								else {
									success[name] = true;
									node.sensor_list[manifest_data.addr].test_check[name] = true;
									node.sensor_list[manifest_data.addr].last_chunk_success = name;
								}
							}).catch((err) => {
								console.log(name);
								console.log(err);
								if(name != 'reboot'){
									node.gateway.clear_queue();
									success[name] = err;
								} else {
									delete node.sensor_list[manifest_data.addr].last_chunk_success;
									delete node.sensor_list[manifest_data.addr].update_request;
									node._emitter.emit('send_firmware_stats', {state: success, addr: manifest_data.addr});
									top_fulfill(success);
								}
								console.log('Update Finished')
								console.log(Date.now());
								node._emitter.emit('send_firmware_stats', {state: success, addr: manifest_data.addr});
								node.resume_normal_operation();
							});
						}
						attemptPromise(); // Start the initial attempt
					})(i);
				}
			});
		}
		node.resume_normal_operation = function(){
			let pan_id = parseInt(config.pan_id, 16);
			node.gateway.digi.send.at_command("ID", [pan_id >> 8, pan_id & 255]).then().catch().then(() => {
				console.log('Set Pan ID to: '+pan_id);
			});
		}

		node.request_manifest = function(sensor_addr){
			// Request Manifest
			node.gateway.firmware_request_manifest(sensor_addr);
		};

		node.close_comms = function(){
			// node.gateway._emitter.removeAllListeners('sensor_data');
			if(typeof gateway_pool[this.key] != 'undefined'){
				if(config.comm_type == 'serial'){
					node.gateway.digi.serial.close();
					clearTimeout(this.comms_timer);
					// node.gateway.digi.serial.close(() => {
					delete gateway_pool[this.key];
					// });
				}else{
					node.gateway.digi.serial.close();
					clearTimeout(this.comms_timer);
					// node.gateway.digi.serial.close(() => {
					delete gateway_pool[this.key];
					// });
				}
			}
		}
		node._compare_manifest = function(sensor_manifest){
			let firmware_dir = home_dir()+'/.node-red/node_modules/@ncd-io/node-red-enterprise-sensors/firmware_files';
			let filename = '/' + sensor_manifest.data.device_type + '-' + sensor_manifest.data.hardware_id[0] + '_' + sensor_manifest.data.hardware_id[1] + '_' + sensor_manifest.data.hardware_id[2] + '.ncd';

			try {
				let firmware_file = fs.readFileSync(firmware_dir+filename,)
				let stored_manifest = node._parse_manifest(firmware_file);
				if(stored_manifest.firmware_version === sensor_manifest.data.firmware_version){
					console.log('firmware versions SAME');
					return false;
				}

				if(stored_manifest.max_image_size < sensor_manifest.data.image_size){
					console.log('firmware image too large');
					return false;
				}
				return {manifest: stored_manifest, firmware: firmware_file};
			} catch(err){
				console.log(err);
				return err;
			}
		}
		node._parse_manifest = function(bin_data){
			return {
				manifest_check: bin_data[0] == 0x01,
				manifest_size: bin_data.slice(1, 5).reduce(msbLsb),
				firmware_version: bin_data[5],
				image_start_address: bin_data.slice(6, 10).reduce(msbLsb),
				image_size: bin_data.slice(10, 14).reduce(msbLsb),
				max_image_size: bin_data.slice(14, 18).reduce(msbLsb),
				image_digest: bin_data.slice(18, 34),
				device_type: bin_data.slice(34, 36).reduce(msbLsb),
				hardware_id: bin_data.slice(36, 39),
				reserve_bytes: bin_data.slice(39, 42)
			}
		};
		node._parse_manifest_read = function(bin_data){
			return {
				// manifest_size: bin_data.slice(0,4).reduce(msbLsb),
				firmware_version: bin_data[0],
				image_start_address: bin_data.slice(1, 5).reduce(msbLsb),
				image_size: bin_data.slice(5, 9).reduce(msbLsb),
				max_image_size: bin_data.slice(9, 13).reduce(msbLsb),
				image_digest: bin_data.slice(13, 29),
				device_type: bin_data.slice(29, 31).reduce(msbLsb),
				hardware_id: bin_data.slice(31, 34),
				reserve_bytes: bin_data.slice(34, 37)
			}
		}
	}

	RED.nodes.registerType("ncd-gateway-config", NcdGatewayConfig);

	function NcdGatewayNode(config){
		RED.nodes.createNode(this,config);

		this._gateway_node = RED.nodes.getNode(config.connection);

		this._gateway_node.open_comms();
		this.gateway = this._gateway_node.gateway;




		var node = this;

		node.on('close', function(){
			this._gateway_node.close_comms();
			this._gateway_node._emitter.removeAllListeners('send_manifest');
			this._gateway_node._emitter.removeAllListeners('send_firmware_stats');
			this._gateway_node._emitter.removeAllListeners('mode_change');
			this.gateway._emitter.removeAllListeners('ncd_error');
			this.gateway._emitter.removeAllListeners('sensor_data');
			this.gateway._emitter.removeAllListeners('sensor_mode');
			this.gateway._emitter.removeAllListeners('receive_packet-unknown_device');
			this.gateway._emitter.removeAllListeners('route_info');
			this.gateway._emitter.removeAllListeners('link_info');
			this.gateway._emitter.removeAllListeners('converter_response');
			this.gateway._emitter.removeAllListeners('manifest_received');
			console.log(this.gateway._emitter.eventNames());
		});

		node.is_config = false;
		var statuses =[
			{fill:"green",shape:"dot",text:"Ready"},
			{fill:"yellow",shape:"ring",text:"Configuring"},
			{fill:"red",shape:"dot",text:"Failed to Connect"},
			{fill:"green",shape:"ring",text:"Connecting..."}
		];

		node.set_status = function(){
			node.status(statuses[node._gateway_node.is_config]);
		};
		node.temp_send_1024 = function(frame){
			console.log('node.temp_send_1024 TODO - Move to Emitter');
			node.send({
				topic: "remote_at_response",
				payload: frame,
				time: Date.now()
			});
		}
		node.temp_send_local = function(frame){
			console.log('node.temp_send_local TODO - Move to Emitter');
			node.send({
				topic: "local_at_response",
				payload: frame,
				time: Date.now()
			});
		}

		node._gateway_node.on('send_manifest', (manifest_data) => {
			node.send({
				topic: 'sensor_manifest',
				payload: {
					addr: manifest_data.addr,
					sensor_type: manifest_data.sensor_type,
					manifest: manifest_data.data
				},
				time: Date.now()
			});
		});
		// node.on('input', function(msg){
		// 	switch(msg.topic){
		// 		case "route_trace":
		// 			var opts = {trace:1};
		// 			node.gateway.route_discover(msg.payload.address,opts).then().catch(console.log);
		// 			break;
		// 		case "link_test":
		// 			node.gateway.link_test(msg.payload.source_address,msg.payload.destination_address,msg.payload.options);
		// 			break;
		// 		case "fft_request":
		// 			break;
		// 		case "fidelity_test":
		// 			break;
		// 		default:
		// 			const byteArrayToHexString = byteArray => Array.from(msg.payload.address, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
		// 			node.gateway.control_send(msg.payload.address, msg.payload.data, msg.payload.options).then().catch(console.log);
		// 	}
			// console.log("input triggered, topic:"+msg.topic);
			// if(msg.topic == "transmit"){
			// 	const byteArrayToHexString = byteArray => Array.from(msg.payload.address, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
			// 	node.gateway.control_send(msg.payload.address, msg.payload.data, msg.payload.options).then().catch(console.log);
			// }
			// if(msg.topic == "route_trace"){
			// 	var opts = {trace:1};
			// 	node.gateway.route_discover(msg.payload.address,opts).then().catch(console.log);
			// }
			// if(msg.topic == "link_test"){
			// 	node.gateway.link_test(msg.payload.source_address,msg.payload.destination_address,msg.payload.options);
			// }
			// if(msg.topic == "fft_request"){

			// }
			// if(msg.topic == "fidelity_test"){
			// }
		// });
		node._gateway_node.on('send_firmware_stats', (data) => {
			node.send({
				topic: 'update_stats',
				payload: data.state,
				addr: data.addr,
				time: Date.now()
			});
		});
		node.on('input', function(msg){
			switch(msg.topic){
				case "route_trace":
					var opts = {trace:1};
					node.gateway.route_discover(msg.payload.address,opts).then().catch(console.log);
					break;
				case "link_test":
					node.gateway.link_test(msg.payload.source_address,msg.payload.destination_address,msg.payload.options);
					break;
				case "fidelity_test":
					break;
				case "converter_send_single":
					// Example message:
					// msg.topic = 'rs485_single';
					// msg.payload.address = "00:13:a2:00:42:37:3e:e2";
					// msg.payload.data = [0x01, 0x03, 0x00, 0x15, 0x00, 0x01, 0x95, 0xCE];
					// msg.payload.meta = {
					// 	'command_id': 'query_water_levels',
					// 	'description': 'Query water levels in mm/cm',
					// 	'target_parser': 'parse_water_levels'
					// }
					if(!Object.hasOwn(msg.payload, 'timeout')){
						msg.payload.timeout = 1500;
					}
					if(msg.payload.hasOwnProperty('meta')){
						node.gateway.queue_bridge_query(msg.payload.address, msg.payload.command, msg.payload.meta, msg.payload.timeout);
					}else{
						node.gateway.queue_bridge_query(msg.payload.address, msg.payload.command, null, msg.payload.timeout);
					}
					break;
				case "converter_send_multiple":
					// Example message:
					// msg.topic = 'converter_send_multiple';
					// msg.payload.address = "00:13:a2:00:42:37:3e:e2";
					// msg.payload.commands = [
					// 	{
					// 		'command': [0x01, 0x03, 0x00, 0x15, 0x00, 0x01, 0x95, 0xCE],
					// 		'meta': {
					// 			'command_id': 'command_1',
					// 			'description': 'Example Command 1',
					// 			'target_parser': 'parse_water_levels'
					// 		}
					// 	},
					// 	{
					// 		'command': [0x01, 0x03, 0x00, 0x15, 0x00, 0x01, 0x95, 0xCE],
					// 		'meta': {
					// 			'command_id': 'command_2',
					// 			'description': 'Example Command 2',
					// 			'target_parser': 'parse_temperature'
					// 		}
					// 	}
					// ];
					if(!Object.hasOwn(msg.payload, 'timeout')){
						msg.payload.timeout = 1500;
					}
					node.gateway.prepare_bridge_query(msg.payload.address, msg.payload.commands, msg.payload.timeout);
					break;
				case "start_luber":
					// msg = {
					// 'topic': start_luber,
					// 'payload': {
					// 	'address': '00:13:a2:00:42:37:87:0a', //REQUIRED
					// 	duration: 3, //REQUIRED valid values 1-255
					// 	channel: 2 //OPTIONAL default value of 1
					// }
					// }
					if(!Object.hasOwn(msg.payload, 'duration')){
						console.log('ERROR: No duration specified, please specify duration in msg.payload.duration');
						break;
					}
					if(msg.payload.duration < 1 || msg.payload.duration > 255){
						console.log('ERROR: Duration out of bounds. Duration');
						break;
					}
					var cmd_promise;
					if(Object.hasOwn(msg.payload, 'channel')){
						node.gateway.control_start_luber(msg.payload.address, msg.payload.channel, msg.payload.duration).then((f) => {
							node.send({
								topic: 'command_results',
								payload: {
									res: 'Automatic Luber '+msg.payload.channel+' Activation Complete',
									address: msg.payload.address,
									channel: msg.payload.channel,
									duration: msg.payload.duration
								},
								time: Date.now(),
								addr: msg.payload.address
							});
						}).catch((err) => {
							node.send({
								topic: 'command_error',
								payload: {
									res: err,
									address: msg.payload.address,
									channel: msg.payload.channel,
									duration: msg.payload.duration
								},
								time: Date.now(),
								addr: msg.payload.address
							});
							// node.send({topic: 'Command Error', payload: err});
						});
					}else{
						node.gateway.control_start_luber(msg.payload.address, 1, msg.payload.duration).then((f) => {
							node.send({
								topic: 'Command Results',
								payload: {
									res: 'Automatic Luber 1 Activation Complete',
									address: msg.payload.address,
									channel: 1,
									duration: msg.payload.duration
								},
								time: Date.now(),
								addr: msg.payload.address
							});
						}).catch((err) => {
							node.send({
								topic: 'Command Results',
								payload: {
									res: 'Automatic Luber 1 Activation Complete',
									address: msg.payload.address,
									channel: 1,
									duration: msg.payload.duration
								},
								time: Date.now(),
								addr: msg.payload.address
							});
							node.send({topic: 'Command Error', payload: err});
						});
					}
					break;
				case "add_firmware_file":
					// Parse Manifest to grab information and store it for later use
					// msg.payload = [0x01, 0x00, ...]
					let new_msg = {
						topic: 'add_firmware_file_response',
						payload: node._gateway_node._parse_manifest(msg.payload)
					}
					let firmware_dir = home_dir()+'/.node-red/node_modules/@ncd-io/node-red-enterprise-sensors/firmware_files';
					if (!fs.existsSync(firmware_dir)) {
						fs.mkdirSync(firmware_dir);
					};
					let filename = '/' + new_msg.payload.device_type + '-' + new_msg.payload.hardware_id[0] + '_' + new_msg.payload.hardware_id[1] + '_' + new_msg.payload.hardware_id[2] + '.ncd';
					fs.writeFile(firmware_dir+filename, msg.payload, function(err){
						if(err){
							console.log(err);
						};
						console.log('Success');
					});
					node.send(new_msg);
					break;
				// case "get_firmware_file":
				// Commented out as I'd rather use a flow to request the file. More robust. Maybe more complicated, wait for feedback.
				// 	// This input makes a request to the specified url and downloads a firmware file at that location
				// 	// msg.payload = "https://github.com/ncd-io/WiFi_MQTT_Temperature_Firmware/raw/main/v1.0.3/firmware.bin"

				case "check_firmware_file":
					// Read file that should be at location and spit out the binary
					// Example msg.payload
					// msg.payload = {
					// 	device_type: 80,
					// 	hardware_id: [88, 88, 88]
					// }
					let fw_dir = home_dir()+'/.node-red/node_modules/@ncd-io/node-red-enterprise-sensors/firmware_files';
					fs.readdir(fw_dir, (err, files) => {
						if (err) {
							node.error('Error reading firmware directory: ' + err);
							return;
						}
						
						// Create firmware files array
						const firmwareFiles = files
						.filter(file => file.endsWith('.ncd'))
						.map((file) => {
							const stats = fs.statSync(path.join(fw_dir, file));
							const file_info = file.split("-");
							return {
								file_name: file,
								download_date: stats.mtime,
								for_sensor_type: Number(file_info[0]),
								for_hardware_id: file_info[1].substring(0, file_info[1].length - 4)
							};
						});
						// Send firmware files list
						node.send({
							topic: 'check_firmware_file_response',
							payload: firmwareFiles
						});
					});
					break;
				case "ota_firmware_update_single":
					// msg.payload = {
					// 	'address': "00:13:a2:00:42:2c:d2:aa"
					// }
					if(!Object.hasOwn(node._gateway_node.sensor_list, msg.payload)){
						node._gateway_node.sensor_list[msg.payload] = {};
					};
					if(!Object.hasOwn(node._gateway_node.sensor_list[msg.payload], 'update_request')){
						node._gateway_node.sensor_list[msg.payload].update_request = true;
					};
					break;
				case "ota_firmware_update_multiple":
					// set the devices user wants to upload new firmware to
					// msg.payload = {
					// 	'addresses': [
					// 		"00:13:a2:00:42:2c:d2:aa",
					// 		"00:13:a2:00:42:2c:d2:ab"
					// 	];
					// }
					// TODO unfinished
					msg.payload.addresses.forEach((address) => {
						if(!Object.hasOwn(node._gateway_node.sensor_list, address)){
							node._gateway_node.sensor_list[address] = {};
						};
						if(!Object.hasOwn(node._gateway_node.sensor_list[address], 'update_request')){
							node._gateway_node.sensor_list[address].update_request = true;
						};
					});
					break;
				case "get_manifest":
					// Allows user to request manifest from one or more devices
					// Primarily envisioned used for troubleshooting or engineer determination
					// msg.payload = {
					// 	'addresses': [
					// 		"00:13:a2:00:42:2c:d2:aa",
					// 		"00:13:a2:00:42:2c:d2:ab"
					// 	];
					// }
					// OR
					// msg.payload = {
					// 	'address': "00:13:a2:00:42:2c:d2:aa"
					// }
					break;
				case "remote_at_send":
					if(!Object.hasOwn(msg.payload, 'value')){
						msg.payload.value = undefined;
					}else if(typeof msg.payload.value === 'string' ){
						msg.payload.value = Array.from(string2HexArray(msg.payload.value));
					}
					node.gateway.remote_at_send(msg.payload.address, msg.payload.parameter, msg.payload.value, msg.payload.options).then(node.temp_send_1024, console.log).catch(console.log);
					break;
				case "local_at_send":
					// If there is no value then its a read command and the DigiParser is expecting an undefined
					if(!Object.hasOwn(msg.payload, 'value')){
						msg.payload.value = undefined;
					}else if(typeof msg.payload.value === 'string' ){
						// break into byte array. Primarily used for NID and Encryption
						msg.payload.value = Array.from(string2HexArray(msg.payload.value));
					}else if(msg.payload.value !== undefined){
						// The DigiParser checks the constructor and not all Arrays are the same
						msg.payload.value = Array.from(msg.payload.value);
					}
					node.gateway.local_at_send(msg.payload.parameter, msg.payload.value).then(node.temp_send_local, console.log).catch(console.log);
					break;
				default:
					const byteArrayToHexString = byteArray => Array.from(msg.payload.address, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
					node.gateway.control_send(msg.payload.address, msg.payload.data, msg.payload.options).then().catch(console.log);
			}


			// console.log("input triggered, topic:"+msg.topic);
			// if(msg.topic == "transmit"){
			// 	const byteArrayToHexString = byteArray => Array.from(msg.payload.address, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
			// 	node.gateway.control_send(msg.payload.address, msg.payload.data, msg.payload.options).then().catch(console.log);
			// }
			// if(msg.topic == "route_trace"){
			// 	var opts = {trace:1};
			// 	node.gateway.route_discover(msg.payload.address,opts).then().catch(console.log);
			// }
			// if(msg.topic == "link_test"){
			// 	node.gateway.link_test(msg.payload.source_address,msg.payload.destination_address,msg.payload.options);
			// }
			// if(msg.topic == "fft_request"){

			// }
			// if(msg.topic == "fidelity_test"){
			// }
		});
		node.gateway.on('ncd_error', (data) => {
			node.send({
				topic: 'ncd_error',
				data: data,
				payload: data.error,
				time: Date.now()
			});
		});
		node.gateway.on('sensor_data', (d) => {
			node.set_status();
			node.send({topic: 'sensor_data', payload: d, time: Date.now()});
		});
		node.gateway.on('sensor_mode', (d) => {
			node.set_status();
			node.send({topic: 'sensor_mode', payload: d, time: Date.now()});
		});
		node.gateway.on('receive_packet-unknown_device',(d)=>{
			node.set_status();
			msg1 = {topic:'somethingTopic',payload:"something"};
			node.send([null,{topic: 'unknown_data', payload:d, time: Date.now()}]);
		});
		node.gateway.on("route_info",(d)=>{
			msg1 = {topic:"route_info",payload:d};
			node.send(msg1);
		});
		node.gateway.on("link_info",(d)=>{
			msg1 = {topic:"link_info",payload:d};
			node.send(msg1);
		});
		node.gateway.on('converter_response', (d) => {
			node.set_status();
			d.topic = 'converter_response';
			d.time = Date.now();
			node.send(d);
		});

		node.set_status();
		node._gateway_node.on('mode_change', (mode) => {
			node.set_status();
			if(this.gateway.modem_mac && this._gateway_node.is_config == 0 || this.gateway.modem_mac && this._gateway_node.is_config == 1){
				node.send({topic: 'modem_mac', payload: this.gateway.modem_mac, time: Date.now()});
			}else{
				node.send({topic: 'error', payload: {code: 1, description: 'Wireless module did not respond'}, time: Date.now()});
			}
		});
	}
	RED.nodes.registerType("ncd-gateway-node", NcdGatewayNode);


	function NcdWirelessNode(config){
		RED.nodes.createNode(this,config);
		this.gateway_node = RED.nodes.getNode(config.connection);
		this.gateway_node.open_comms();
		this.gateway = this.gateway_node.gateway;
		var dedicated_config = false;
		this.config_gateway = this.gateway;

		if(config.config_comm){
			this.config_gateway_node = RED.nodes.getNode(config.config_comm);
			this.config_gateway_node.open_comms();
			this.config_gateway = this.config_gateway_node.gateway;
			dedicated_config = true;
		}
		// this.queue = new Queue(1);
		var node = this;
		var modes = {
			PGM: {fill:"red",shape:"dot",text:"Config Mode"},
			PGM_NOW: {fill:"red",shape:"dot",text:"Configuring..."},
			READY: {fill: "green", shape: "ring", text:"Config Complete"},
			PGM_ERR: {fill:"red", shape:"ring", text:"Config Error"},
			RUN: {fill:"green",shape:"dot",text:"Running"},
			PUM: {fill:"yellow",shape:"ring",text:"Module was factory reset"},
			ACK: {fill:"green",shape:"ring",text:"Configuration Acknowledged"},
			STREAM_ERR: {fill:"red",shape:"ring",text:"Multi-Packet Stream Error"},
			// FLY: {fill:"yellow",shape:"ring",text:"FLY notification received"},
			// OTN: {fill:"yellow",shape:"ring",text:"OTN Received, OTF Configuration Initiated"},
			// OFF: {fill:"green",shape:"dot",text:"OFF Recieved, OTF Configuration Completed"}
			FLY: {fill:"yellow",shape:"ring",text:"FLY"},
			OTN: {fill:"yellow",shape:"ring",text:"OTN Received, Config Entered"},
			OTF: {fill:"green",shape:"dot",text:"OTF Received, Config Complete"},
			UPTHWRN: {fill:"yellow",shape:"ring",text:"Threshold is low"}
		};
		var events = {};
		var pgm_events = {};
		this.gtw_on = (event, cb) => {
			events[event] = cb;
			this.gateway.on(event, cb);
		};
		this.pgm_on = (event, cb) => {
			events[event] = cb;
			this.config_gateway.on(event, cb);
		};
		function _send_otn_request(sensor){
			return new Promise((top_fulfill, top_reject) => {
				var msg = {};
				setTimeout(() => {
					var tout = setTimeout(() => {
						node.status(modes.PGM_ERR);
						node.send({topic: 'OTN Request Results', payload: msg, time: Date.now()});
					}, 10000);

					var promises = {};
					    // This command is used for OTF on types 53, 80,81,82,83,84, 101, 102, 110, 111, 518, 519
					let original_otf_devices = [53, 80, 81, 82, 83, 84, 87, 101, 102, 103, 110, 111, 112, 114, 117, 180, 181, 518, 519, 520, 538];
					if(original_otf_devices.includes(sensor.type)){
						// This command is used for OTF on types 53, 80, 81, 82, 83, 84, 101, 102, 110, 111, 518, 519
						promises.config_enter_otn_mode = node.config_gateway.config_enter_otn_mode(sensor.mac);
					}else{
						// This command is used for OTF on types not 53, 80, 81, 82, 83, 84, 101, 102, 110, 111, 518, 519
						promises.config_enter_otn_mode = node.config_gateway.config_enter_otn_mode_common(sensor.mac);
					}
					promises.finish = new Promise((fulfill, reject) => {
						node.config_gateway.queue.add(() => {
							return new Promise((f, r) => {
								clearTimeout(tout);
								node.status(modes.FLY);
								fulfill();
								f();
							});
						});
					});
					for(var i in promises){
						(function(name){
							promises[name].then((f) => {
								if(name != 'finish') msg[name] = true;
								else{
									// #OTF
									node.send({topic: 'OTN Request Results', payload: msg, time: Date.now()});
									top_fulfill(msg);
								}
							}).catch((err) => {
								msg[name] = err;
							});
						})(i);
					}
				});
			});
		};
		function _broadcast_rtc(sensor){
			return new Promise((top_fulfill, top_reject) => {
				var msg = {};
				setTimeout(() => {
					var tout = setTimeout(() => {
						node.status(modes.PGM_ERR);
						node.send({topic: 'RTC Broadcast', payload: msg, time: Date.now()});
					}, 10000);

					var promises = {};

					promises.broadcast_rtc = node.config_gateway.config_set_rtc_101('00:00:00:00:00:00:FF:FF');
					promises.broadcast_rtc_202 = node.config_gateway.config_set_rtc_202('00:00:00:00:00:00:FF:FF');

					promises.finish = new Promise((fulfill, reject) => {
						node.config_gateway.queue.add(() => {
							return new Promise((f, r) => {
								clearTimeout(tout);
								node.status(modes.FLY);
								fulfill();
								f();
							});
						});
					});
					for(var i in promises){
						(function(name){
							promises[name].then((f) => {
								if(name != 'finish') msg[name] = true;
								else{
									// #OTF
									this.gateway.fly_101_in_progress = false;
									node.send({topic: 'RTC Broadcast', payload: msg, time: Date.now()});
									top_fulfill(msg);
								}
							}).catch((err) => {
								msg[name] = err;
							});
						})(i);
					}
				});
			});
		}
		function _config(sensor, otf = false){
			return new Promise((top_fulfill, top_reject) => {
				var success = {};
				setTimeout(() => {
					var tout = setTimeout(() => {
						node.status(modes.PGM_ERR);
						node.send({topic: 'Config Results', payload: success, time: Date.now(), addr: sensor.mac});
					}, 60000);
					node.status(modes.PGM_NOW);
					if(parseInt(config.sensor_type) >= 10000){
						if(sensor) return;
						var dest = parseInt(config.destination, 16);
						if(dest == 65535){
							dest = [0,0,0,0,0,0,255,255];
						}else{
							dest = [0, 0x13, 0xa2, 0, ...int2Bytes(dest, 4)];
						}
						var promises = {
							destination: node.gateway.config_powered_device(config.addr, 'destination', ...dest),
							network_id: node.gateway.config_powered_device(config.addr, 'network_id', ...int2Bytes(parseInt(config.pan_id, 16), 2)),
							power: node.gateway.config_powered_device(config.addr, 'power', parseInt(config.power)),
							retries: node.gateway.config_powered_device(config.addr, 'retries', parseInt(config.retries)),
							node_id: node.gateway.config_powered_device(config.addr, 'node_id', parseInt(config.node_id)),
							delay: node.gateway.config_powered_device(config.addr, 'delay', ...int2Bytes(parseInt(config.delay), 2))
						};
					}else{
						var mac = sensor.mac;
						var promises = {};
						var reboot = false;
						if(config.form_network){
							promises.establish_config_network_1 = node.config_gateway.config_get_pan_id('00:00:00:00:00:00:FF:FF');
							promises.establish_config_network_2 = node.config_gateway.config_get_pan_id('00:00:00:00:00:00:FF:FF');
							promises.establish_config_network_3 = node.config_gateway.config_get_pan_id('00:00:00:00:00:00:FF:FF');
						}
						if(config.destination_active){
							promises.destination = node.config_gateway.config_set_destination(mac, parseInt(config.destination, 16));
						}
						if(config.pan_id_active){
							reboot = true;
							promises.network_id = node.config_gateway.config_set_pan_id(mac, parseInt(config.pan_id, 16));
						}
						// var promises = {
						// 	// NOTE: establish_config_network_x commands added to force XBee network to form before sending commands.
						// 	establish_config_network_1: node.config_gateway.config_get_pan_id('00:00:00:00:00:00:FF:FF'),
						// 	establish_config_network_2: node.config_gateway.config_get_pan_id('00:00:00:00:00:00:FF:FF'),
						// 	establish_config_network_3: node.config_gateway.config_get_pan_id('00:00:00:00:00:00:FF:FF'),
						//
						// 	destination: node.config_gateway.config_set_destination(mac, parseInt(config.destination, 16)),
						// 	network_id: node.config_gateway.config_set_pan_id(mac, parseInt(config.pan_id, 16))
						// };
						if(config.node_id_delay_active){
							promises.id_and_delay = node.config_gateway.config_set_id_delay(mac, parseInt(config.node_id), parseInt(config.delay));
						}
						if(config.power_active){
							promises.power = node.config_gateway.config_set_power(mac, parseInt(config.power));
						}
						if(config.retries_active){
							promises.retries = node.config_gateway.config_set_retries(mac, parseInt(config.retries));
						}

						switch(sensor.type){
							case 2:
								if(config.debounce_time_2_active){
									promises.debounce_time_2 = node.config_gateway.config_set_debounce_time_2(mac, parseInt(config.debounce_time_2));
								}
								break;
							case 3:
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.change_detection_t3_active){
									promises.change_detection = node.config_gateway.config_set_change_detection(mac, config.change_enabled ? 1 : 0, parseInt(config.change_pr), parseInt(config.change_interval));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 4:
								if(config.thermocouple_type_23_active){
									promises.thermocouple_type_4 = node.config_gateway.config_set_thermocouple_type_23(mac, parseInt(config.thermocouple_type_23));
								}
								if(config.filter_thermocouple_active){
									promises.filter_thermocouple_4 = node.config_gateway.config_set_filter_thermocouple(mac, parseInt(config.filter_thermocouple));
								}
								if(config.cold_junction_thermocouple_active){
									promises.cold_junction_thermocouple_4 = node.config_gateway.config_set_cold_junction_thermocouple(mac, parseInt(config.cold_junction_thermocouple));
								}
								if(config.sample_resolution_thermocouple_active){
									promises.sample_resolution_thermocouple_4 = node.config_gateway.config_set_sample_resolution_thermocouple(mac, parseInt(config.sample_resolution_thermocouple));
								}
								if(config.number_of_samples_thermocouple_active){
									promises.number_of_samples_thermocouple_4 = node.config_gateway.config_set_number_of_samples_thermocouple(mac, parseInt(config.number_of_samples_thermocouple));
								}
								if(config.measurement_type_thermocouple_active){
									promises.measurement_type_thermocouple_4 = node.config_gateway.config_set_measurement_type_thermocouple(mac, parseInt(config.measurement_type_thermocouple));
								}
								break;
							case 5:
								promises.acceleration_range = node.config_gateway.config_set_amgt_accel(mac, parseInt(config.amgt_accel));
								promises.magnetometer_gain = node.config_gateway.config_set_amgt_magnet(mac, parseInt(config.amgt_mag));
								promises.gyroscope_scale = node.config_gateway.config_set_amgt_gyro(mac, parseInt(config.amgt_gyro));
								break;
							case 6:
								promises.altitude = node.config_gateway.config_set_bp_altitude(mac, parseInt(config.bp_altitude));
								promises.pressure = node.config_gateway.config_set_bp_pressure(mac, parseInt(config.bp_pressure));
								promises.temp_precision = node.config_gateway.config_set_bp_temp_precision(mac, parseInt(config.bp_temp_prec));
								promises.pressure_precision = node.config_gateway.config_set_bp_press_precision(mac, parseInt(config.bp_press_prec));
								break;
							case 7:
								if(config.impact_accel_active){
									promises.impact_accel = node.config_gateway.config_set_acceleration_range_24(mac, parseInt(config.impact_accel));
								}
								if(config.impact_data_rate_active){
									promises.impact_data_rate = node.config_gateway.config_set_data_rate_24(mac, parseInt(config.impact_data_rate));
								}
								if(config.impact_threshold_active){
									promises.impact_threshold = node.config_gateway.config_set_threshold_24(mac, parseInt(config.impact_threshold));
								}
								if(config.impact_duration_active){
									promises.impact_duration = node.config_gateway.config_set_duration_24(mac, parseInt(config.impact_duration));
								}
								// promises.acceleration_range = node.config_gateway.config_set_impact_accel(mac, parseInt(config.impact_accel));
								// promises.data_rate = node.config_gateway.config_set_impact_data_rate(mac, parseInt(config.impact_data_rate));
								// promises.impact_threshold = node.config_gateway.config_set_impact_threshold(mac, parseInt(config.impact_threshold));
								// promises.impact_duration = node.config_gateway.config_set_impact_duration(mac, parseInt(config.impact_duration));
								break;
							case 10:
								if(config.change_detection_t3_active){
									promises.change_detection = node.config_gateway.config_set_change_detection(mac, config.change_enabled ? 1 : 0, parseInt(config.change_pr), parseInt(config.change_interval));
								}
								break;
							case 12:
								if(config.thermocouple_type_23_active){
									promises.thermocouple_type_12 = node.config_gateway.config_set_thermocouple_type_23(mac, parseInt(config.thermocouple_type_23));
								}
								if(config.filter_thermocouple_active){
									promises.filter_thermocouple_12 = node.config_gateway.config_set_filter_thermocouple(mac, parseInt(config.filter_thermocouple));
								}
								if(config.cold_junction_thermocouple_active){
									promises.cold_junction_thermocouple_12 = node.config_gateway.config_set_cold_junction_thermocouple(mac, parseInt(config.cold_junction_thermocouple));
								}
								if(config.sample_resolution_thermocouple_active){
									promises.sample_resolution_thermocouple_12 = node.config_gateway.config_set_sample_resolution_thermocouple(mac, parseInt(config.sample_resolution_thermocouple));
								}
								if(config.number_of_samples_thermocouple_active){
									promises.number_of_samples_thermocouple_12 = node.config_gateway.config_set_number_of_samples_thermocouple(mac, parseInt(config.number_of_samples_thermocouple));
								}
								if(config.measurement_type_thermocouple_active){
									promises.measurement_type_thermocouple_12 = node.config_gateway.config_set_measurement_type_thermocouple(mac, parseInt(config.measurement_type_thermocouple));
								}
								break;
							case 13:
								if(config.current_calibration_13_active){
									var cali = parseInt(config.current_calibration_13);
									if(cali != 0){
										promises.current_calibration_13 = node.config_gateway.config_set_current_calibration_13(mac, cali);
									}
								}
								// if(config.current_calibration_13_dep_active){
								// 	var cali = parseInt(config.current_calibration_13_dep);
								// 	if(cali != 0){
								// 		promises.current_calibration_13_dep = node.config_gateway.config_set_current_calibration_13_dep(mac, cali);
								// 	}
								// }
								if(config.change_detection_t3_active){
									promises.change_detection = node.config_gateway.config_set_change_detection(mac, config.change_enabled ? 1 : 0, parseInt(config.change_pr), parseInt(config.change_interval));
								}
								break;
							case 14:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 15:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 19:
								if(config.current_calibration_13_active){
									var cali = parseInt(config.current_calibration_13);
									if(cali != 0){
										promises.current_calibration_13 = node.config_gateway.config_set_current_calibration_13(mac, cali);
									}
								}
								if(config.current_calibration_ch2_19_active){
									var cali = parseInt(config.current_calibration_ch2_19);
									if(cali != 0){
										promises.current_calibration_ch2_19 = node.config_gateway.config_set_current_calibration_ch2_19(mac, cali);
									}
								}
								// if(config.current_calibration_13_dep_active){
								// 	var cali = parseInt(config.current_calibration_13_dep);
								// 	if(cali != 0){
								// 		promises.current_calibration_13_dep = node.config_gateway.config_set_current_calibration_13_dep(mac, cali);
								// 	}
								// }
								// if(config.current_calibration_ch2_19_dep_active){
								// 	var cali = parseInt(config.current_calibration_ch2_19_dep);
								// 	if(cali != 0){
								// 		promises.current_calibration_ch2_19_dep = node.config_gateway.config_set_current_calibration_ch2_19_dep(mac, cali);
								// 	}
								// }
								if(config.change_detection_t3_active){
									promises.change_detection = node.config_gateway.config_set_change_detection(mac, config.change_enabled ? 1 : 0, parseInt(config.change_pr), parseInt(config.change_interval));
								}
								if(config.change_detection_ch2_active){
									promises.change_detection_ch2 = node.config_gateway.config_set_change_detection_ch2(mac, config.change_enabled_ch2 ? 1 : 0, parseInt(config.change_pr_ch2), parseInt(config.change_interval_ch2));
								}
								break;
							case 21:
								if(config.pressure_sensor_type_21_active){
									promises.pressure_sensor_type_21 = node.config_gateway.config_set_pressure_sensor_type_21(mac, parseInt(config.pressure_sensor_type_21));
								}
								if(config.pressure_sensor_range_AMS5812_21_active){
									promises.pressure_sensor_range_AMS5812_21 = node.config_gateway.config_set_pressure_sensor_range_21(mac, parseInt(config.pressure_sensor_range_AMS5812_21));
								}
								if(config.pressure_sensor_range_AMS5915_21_active){
									promises.pressure_sensor_range_AMS5915_21 = node.config_gateway.config_set_pressure_sensor_range_21(mac, parseInt(config.pressure_sensor_range_AMS5915_21));
								}
								break;
							case 23:
								if(config.thermocouple_type_23_active){
									promises.thermocouple_type_23 = node.config_gateway.config_set_thermocouple_type_23(mac, parseInt(config.thermocouple_type_23));
								}
								if(config.filter_thermocouple_active){
									promises.filter_thermocouple_23 = node.config_gateway.config_set_filter_thermocouple(mac, parseInt(config.filter_thermocouple));
								}
								if(config.cold_junction_thermocouple_active){
									promises.cold_junction_thermocouple_23 = node.config_gateway.config_set_cold_junction_thermocouple(mac, parseInt(config.cold_junction_thermocouple));
								}
								if(config.sample_resolution_thermocouple_active){
									promises.sample_resolution_thermocouple_23 = node.config_gateway.config_set_sample_resolution_thermocouple(mac, parseInt(config.sample_resolution_thermocouple));
								}
								if(config.number_of_samples_thermocouple_active){
									promises.number_of_samples_thermocouple_23 = node.config_gateway.config_set_number_of_samples_thermocouple(mac, parseInt(config.number_of_samples_thermocouple));
								}
								if(config.measurement_type_thermocouple_active){
									promises.measurement_type_thermocouple_23 = node.config_gateway.config_set_measurement_type_thermocouple(mac, parseInt(config.measurement_type_thermocouple));
								}
								break;
							case 24:
								if(config.impact_accel_active){
									promises.impact_accel = node.config_gateway.config_set_acceleration_range_24(mac, parseInt(config.impact_accel));
								}
								if(config.impact_data_rate_active){
									promises.impact_data_rate = node.config_gateway.config_set_data_rate_24(mac, parseInt(config.impact_data_rate));
								}
								if(config.impact_threshold_active){
									promises.impact_threshold = node.config_gateway.config_set_threshold_24(mac, parseInt(config.impact_threshold));
								}
								if(config.impact_duration_active){
									promises.impact_duration = node.config_gateway.config_set_duration_24(mac, parseInt(config.impact_duration));
								}
								var interr = parseInt(config.activ_interr_x) | parseInt(config.activ_interr_y) | parseInt(config.activ_interr_z) | parseInt(config.activ_interr_op);
								promises.activity_interrupt = node.config_gateway.config_set_interrupt_24(mac, interr);
								break;
							case 25:
								if(config.impact_accel_active){
									promises.impact_accel = node.config_gateway.config_set_acceleration_range_24(mac, parseInt(config.impact_accel));
								}
								if(config.impact_data_rate_active){
									promises.impact_data_rate = node.config_gateway.config_set_data_rate_24(mac, parseInt(config.impact_data_rate));
								}
								if(config.impact_threshold_active){
									promises.impact_threshold = node.config_gateway.config_set_threshold_24(mac, parseInt(config.impact_threshold));
								}
								if(config.impact_duration_active){
									promises.impact_duration = node.config_gateway.config_set_duration_24(mac, parseInt(config.impact_duration));
								}
								var interr = parseInt(config.activ_interr_x) | parseInt(config.activ_interr_y) | parseInt(config.activ_interr_z) | parseInt(config.activ_interr_op);
								promises.activity_interrupt = node.config_gateway.config_set_interrupt_24(mac, interr);
								break;
							case 26:
								if(config.pressure_limit_26_active){
									promises.pressure_limit_26 = node.config_gateway.config_set_pressure_limit_26(mac, parseInt(config.pressure_limit_26));
								}
								if(config.auto_pressure_check_26_active){
									promises.auto_pressure_check_26 = node.config_gateway.config_set_auto_pressure_check_26(mac, parseInt(config.auto_pressure_check_26));
								}
								break;
							case 28:
								if(config.current_calibration_13_active){
									var cali = parseInt(config.current_calibration_13);
									if(cali != 0){
										promises.current_calibration_13 = node.config_gateway.config_set_current_calibration_13(mac, cali);
									}
								}
								if(config.current_calibration_ch2_19_active){
									var cali = parseInt(config.current_calibration_ch2_19);
									if(cali != 0){
										promises.current_calibration_ch2_19 = node.config_gateway.config_set_current_calibration_ch2_19(mac, cali);
									}
								}
								if(config.current_calibration_ch3_28_active){
									var cali = parseInt(config.current_calibration_ch3_28);
									if(cali != 0){
										promises.current_calibration_ch3_28 = node.config_gateway.config_set_current_calibration_ch3_28(mac, cali);
									}
								}
								// if(config.current_calibration_13_dep_active){
								// 	var cali = parseInt(config.current_calibration_13_dep);
								// 	if(cali != 0){
								// 		promises.current_calibration_13_dep = node.config_gateway.config_set_current_calibration_13_dep(mac, cali);
								// 	}
								// }
								// if(config.current_calibration_ch2_19_dep_active){
								// 	var cali = parseInt(config.current_calibration_ch2_19_dep);
								// 	if(cali != 0){
								// 		promises.current_calibration_ch2_19_dep = node.config_gateway.config_set_current_calibration_ch2_19_dep(mac, cali);
								// 	}
								// }
								// if(config.current_calibration_ch3_28_dep_active){
								// 	var cali = parseInt(config.current_calibration_ch3_28_dep);
								// 	if(cali != 0){
								// 		promises.current_calibration_ch3_28_dep = node.config_gateway.config_set_current_calibration_ch3_28_dep(mac, cali);
								// 	}
								// }
								if(config.change_detection_t3_active){
									promises.change_detection = node.config_gateway.config_set_change_detection(mac, config.change_enabled ? 1 : 0, parseInt(config.change_pr), parseInt(config.change_interval));
								}
								if(config.change_detection_ch2_active){
									promises.change_detection_ch2 = node.config_gateway.config_set_change_detection_ch2(mac, config.change_enabled_ch2 ? 1 : 0, parseInt(config.change_pr_ch2), parseInt(config.change_interval_ch2));
								}
								if(config.change_detection_ch3_active){
									promises.change_detection_ch3 = node.config_gateway.config_set_change_detection_ch3(mac, config.change_enabled_ch3 ? 1 : 0, parseInt(config.change_pr_ch3), parseInt(config.change_interval_ch3));
								}
								break;
							case 32:
								if(config.sps_skip_samples_32_active){
									promises.sps_skip_samples_32 = node.config_gateway.config_set_sps_skip_samples_32(mac, parseInt(config.sps_skip_samples_32));
								}
								if(config.change_otf_interval_active){
									promises.change_otf_interval = node.config_gateway.config_set_change_otf_interval(mac, parseInt(config.change_otf_interval));
								}
								if(config.sampling_rate_duration_active){
									promises.sampling_rate_duration = node.config_gateway.config_set_sampling_rate_duration(mac, parseInt(config.sampling_rate_duration));
								}
								break;
							case 33:
								if(config.clear_counter_33){
									promises.clear_counter_33 = node.config_gateway.config_set_clear_counter_33(mac);
								}
								if(config.input_two_33_active){
									promises.input_two_33 = node.config_gateway.config_set_input_two_108(mac, parseInt(config.input_two_33));
								}
								if(config.counter_threshold_108_active){
									promises.counter_threshold_108 = node.config_gateway.config_set_counter_threshold_108(mac, parseInt(config.counter_threshold_108));
								}
								if(config.debounce_time_108_active){
									promises.debounce_time_108 = node.config_gateway.config_set_debounce_time_108(mac, parseInt(config.debounce_time_108));
								}
								if(config.push_notification_33_active){
									promises.push_notification_33 = node.config_gateway.config_set_push_notification_33(mac, parseInt(config.push_notification_33));
								}
							    break;
							case 35:
								if(config.counter_threshold_35_active){
									promises.config_set_counter_threshold_35 = node.config_gateway.config_set_counter_threshold_35(mac, parseInt(config.counter_threshold_35));
								}
								if(config.debounce_time_2_active){
									promises.config_set_debounce_time_35 = node.config_gateway.config_set_debounce_time_35(mac, parseInt(config.debounce_time_2));
								}
								break;
							case 36:
								if(config.counter_threshold_35_active){
									promises.config_set_counter_threshold_35 = node.config_gateway.config_set_counter_threshold_35(mac, parseInt(config.counter_threshold_35));
								}
								if(config.debounce_time_2_active){
									promises.config_set_debounce_time_35 = node.config_gateway.config_set_debounce_time_35(mac, parseInt(config.debounce_time_2));
								}
								break;
							case 39:
								if(config.rtd_type_39_active){
									promises.rtd_type_39 = node.config_gateway.config_set_rtd_type_39(mac, parseInt(config.rtd_type_39));
								}
								if(config.rtd_range_39_active){
									promises.rtd_range_39 = node.config_gateway.config_set_rtd_range_39(mac, parseInt(config.rtd_range_39));
								}
								break;
							case 40:
								promises.filtering = node.config_gateway.config_set_filtering(mac, parseInt(config.filtering));
								promises.data_rate = node.config_gateway.config_set_data_rate(mac, parseInt(config.data_rate));
								promises.time_series = node.config_gateway.config_set_time_series(mac, parseInt(config.time_series));
								promises.reading_type = node.config_gateway.config_set_reading_type(mac, parseInt(config.reading_type));
								break;
							case 44:
								if(config.force_calibration_co2_auto_config){
									promises.sensor_forced_calibration = node.config_gateway.config_set_sensor_forced_calibration(mac, parseInt(config.force_calibration_co2));
								}
								if(config.temperature_offset_44_active){
									promises.temperature_offset_44 = node.config_gateway.config_set_sensor_temperature_offset_44(mac, parseInt(config.temperature_offset_44));
								}
								if(config.scd_skip_samples_44_active){
									promises.scd_skip_samples_44 = node.config_gateway.config_set_scd_skip_samples_44(mac, parseInt(config.scd_skip_samples_44));
								}
								if(config.change_otf_interval_active){
									promises.change_otf_interval = node.config_gateway.config_set_change_otf_interval(mac, parseInt(config.change_otf_interval));
								}
								if(config.sampling_rate_duration_active){
									promises.sampling_rate_duration = node.config_gateway.config_set_sampling_rate_duration(mac, parseInt(config.sampling_rate_duration));
								}
								break;
							case 45:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 46:
								if(config.motion_threshold_46_active){
									promises.motion_threshold_46 = node.config_gateway.config_set_motion_threshold_46(mac, parseInt(config.motion_threshold_46));
								}
								break;
							case 47:
								if(config.roll_angle_threshold_47_active){
									promises.roll_angle_threshold_47 = node.config_gateway.config_set_roll_threshold_47(mac, parseInt(config.roll_angle_threshold_47));
								}
								if(config.pitch_angle_threshold_47_active){
									promises.pitch_angle_threshold_47 = node.config_gateway.config_set_pitch_threshold_47(mac, parseInt(config.pitch_angle_threshold_47));
								}
								break;
							case 48:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 52:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 53:
								if(config.scd_skip_samples_44_active){
									promises.scd_skip_samples_44 = node.config_gateway.config_set_scd_skip_samples_44(mac, parseInt(config.scd_skip_samples_44));
								}
								if(config.change_otf_interval_active){
									promises.change_otf_interval = node.config_gateway.config_set_change_otf_interval(mac, parseInt(config.change_otf_interval));
								}
								if(config.sampling_rate_duration_active){
									promises.sampling_rate_duration = node.config_gateway.config_set_sampling_rate_duration(mac, parseInt(config.sampling_rate_duration));
								}
								if(config.start_sps30_fan_cleaning_53){
									promises.start_sps30_fan_cleaning_53 = node.config_gateway.config_set_start_sps30_fan_cleaning_53(mac);
								}
								break;
							case 56:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 58:
								if(config.calibration_58){
									promises.calibration_58 = node.config_gateway.config_set_calibration_58(mac);
								}
								if(config.factory_reset_tank_probe_58){
									promises.factory_reset_tank_probe_58 = node.config_gateway.config_set_factory_reset_tank_probe_58(mac);
								}
								if(config.set_max_range_58_active){
									promises.set_max_range_58 = node.config_gateway.config_set_max_range_58(mac, parseInt(config.set_max_range_58));
								}
								break;
							case 75:
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								break;
							case 76:
								if(config.periodic_check_rate_76_active){
									promises.periodic_check_rate_76 = node.config_gateway.config_set_periodic_check_rate_76(mac, parseInt(config.periodic_check_rate_76));
								}
								if(config.sensor_boot_time_76_active){
									promises.sensor_boot_time_76 = node.config_gateway.config_set_sensor_boot_time_76(mac, parseInt(config.sensor_boot_time_76));
								}
								if(config.ppm_threshold_76_active){
									promises.ppm_threshold_76 = node.config_gateway.config_set_ppm_threshold_76(mac, parseInt(config.ppm_threshold_76));
								}
								if(config.alert_duration_76_active){
									promises.alert_duration_76 = node.config_gateway.config_set_alert_duration_76(mac, parseInt(config.alert_duration_76));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								break;
							case 78:
								if(config.sensor_boot_time_78_active){
									promises.sensor_boot_time_78 = node.config_gateway.config_set_sensor_boot_time_78(mac, parseInt(config.sensor_boot_time_78));
								}
								break;
							case 79:
								if(config.sensor_boot_time_78_active){
									promises.sensor_boot_time_78 = node.config_gateway.config_set_sensor_boot_time_78(mac, parseInt(config.sensor_boot_time_78));
								}
								break;
							case 80:
								if(config.output_data_rate_101_active){
									promises.output_data_rate_101 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_101));
								}
								if(config.sampling_duration_101_active){
									promises.sampling_duration_101 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_101));
								}
								if(config.x_axis_101 || config.y_axis_101 || config.z_axis_101){
									promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								}
								if(config.sampling_interval_80_active){
									promises.sampling_interval = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_80));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_80_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_80));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_80_active){
									promises.low_pass_filter = node.config_gateway.config_set_low_pass_filter_80(mac, parseInt(config.low_pass_filter_80));
								}
								if(config.high_pass_filter_80_active){
									promises.high_pass_filter = node.config_gateway.config_set_high_pass_filter_80(mac, parseInt(config.high_pass_filter_80));
								}
								if(config.measurement_mode_80_active){
									promises.measurement_mode = node.config_gateway.config_set_measurement_mode_80(mac, parseInt(config.measurement_mode_80));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								break;
							case 81:
								if(config.output_data_rate_p1_81_active){
									promises.output_data_rate_p1_81 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_p1_81));
								}
								if(config.output_data_rate_p2_81_active){
									promises.output_data_rate_p2_81 = node.config_gateway.config_set_output_data_rate_p2_81(mac, parseInt(config.output_data_rate_p2_81));
								}
								if(config.sampling_duration_p1_81_active){
									promises.sampling_duration_p1_81 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_p1_81));
								}
								if(config.sampling_duration_p2_81_active){
									promises.sampling_duration_p2_81 = node.config_gateway.config_set_sampling_duration_p2_81(mac, parseInt(config.sampling_duration_p2_81));
								}
								if(config.x_axis_101 || config.y_axis_101 || config.z_axis_101){
									promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								}
								if(config.sampling_interval_80_active){
									promises.sampling_interval = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_80));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_80_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_80));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_80_active){
									promises.low_pass_filter = node.config_gateway.config_set_low_pass_filter_80(mac, parseInt(config.low_pass_filter_80));
								}
								if(config.high_pass_filter_80_active){
									promises.high_pass_filter = node.config_gateway.config_set_high_pass_filter_80(mac, parseInt(config.high_pass_filter_80));
								}
								if(config.low_pass_filter_81_p2_active){
									promises.low_pass_filter_p2 = node.config_gateway.config_set_low_pass_filter_81_p2(mac, parseInt(config.low_pass_filter_81_p2));
								}
								if(config.high_pass_filter_81_p2_active){
									promises.high_pass_filter_p2 = node.config_gateway.config_set_high_pass_filter_81_p2(mac, parseInt(config.high_pass_filter_81_p2));
								}
								if(config.measurement_mode_80_active){
									promises.measurement_mode = node.config_gateway.config_set_measurement_mode_80(mac, parseInt(config.measurement_mode_80));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								break;
							case 82:
								if(config.current_calibration_82_active){
									promises.current_calibration_82 = node.config_gateway.config_set_current_calibration_82(mac, parseInt(config.current_calibration_82));
								}
								if(config.output_data_rate_101_active){
									promises.output_data_rate_101 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_101));
								}
								if(config.sampling_duration_101_active){
									promises.sampling_duration_101 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_101));
								}
								if(config.x_axis_101 || config.y_axis_101 || config.z_axis_101){
									promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								}
								if(config.sampling_interval_80_active){
									promises.sampling_interval = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_80));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_80_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_80));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_80_active){
									promises.low_pass_filter = node.config_gateway.config_set_low_pass_filter_80(mac, parseInt(config.low_pass_filter_80));
								}
								if(config.high_pass_filter_80_active){
									promises.high_pass_filter = node.config_gateway.config_set_high_pass_filter_80(mac, parseInt(config.high_pass_filter_80));
								}
								if(config.measurement_mode_80_active){
									promises.measurement_mode = node.config_gateway.config_set_measurement_mode_80(mac, parseInt(config.measurement_mode_80));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								break;
							case 84:
								if(config.output_data_rate_101_active){
									promises.output_data_rate_101 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_101));
								}
								if(config.sampling_duration_101_active){
									promises.sampling_duration_101 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_101));
								}
								if(config.x_axis_101 || config.y_axis_101 || config.z_axis_101){
									promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								}
								if(config.sampling_interval_80_active){
									promises.sampling_interval = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_80));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_80_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_80));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_80_active){
									promises.low_pass_filter = node.config_gateway.config_set_low_pass_filter_80(mac, parseInt(config.low_pass_filter_80));
								}
								if(config.high_pass_filter_80_active){
									promises.high_pass_filter = node.config_gateway.config_set_high_pass_filter_80(mac, parseInt(config.high_pass_filter_80));
								}
								if(config.measurement_mode_80_active){
									promises.measurement_mode = node.config_gateway.config_set_measurement_mode_80(mac, parseInt(config.measurement_mode_80));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.led_alert_mode_84_active){
									promises.led_alert_mode_84 = node.config_gateway.config_set_led_alert_mode_84(mac, parseInt(config.led_alert_mode_84));
								}
								if(config.led_accelerometer_threshold_84_active){
									promises.led_accelerometer_threshold_84 = node.config_gateway.config_set_led_accelerometer_threshold_84(mac, parseInt(config.led_accelerometer_threshold_84));
								}
								if(config.led_velocity_threshold_84_active){
									promises.led_velocity_threshold_84 = node.config_gateway.config_set_led_velocity_threshold_84(mac, parseInt(config.led_velocity_threshold_84));
								}
								if(config.acceleration_interrupt_threshold_84_active){
									promises.acceleration_interrupt_threshold_84 = node.config_gateway.config_set_acceleration_interrupt_threshold_84(mac, parseInt(config.acceleration_interrupt_threshold_84));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								break;
							case 85:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 87:
								if(config.ct_constant_87_active){
									promises.ct_constant_87 = node.config_gateway.config_set_ct_constant_87(mac, parseInt(config.ct_constant_87));
								}
								if(config.deadband_87_active){
									promises.deadband_87 = node.config_gateway.config_set_deadband_87(mac, parseInt(config.deadband_87));
								}
								if(config.sampling_frequency_87_active){
									promises.sampling_frequency_87 = node.config_gateway.config_set_sampling_frequency_87(mac, parseInt(config.sampling_frequency_87));
								}
								if(config.raw_length_87_active){
									promises.raw_length_87 = node.config_gateway.config_set_raw_length_87(mac, parseInt(config.raw_length_87));
								}
								if(config.stay_on_mode_539_active){
									promises.stay_on_mode_87 = node.config_gateway.config_set_stay_on_mode_539(mac, parseInt(config.stay_on_mode_539));
								}
								if(config.quality_of_service_121_active){
									promises.quality_of_service_87 = node.config_gateway.config_set_quality_of_service_121(mac, parseInt(config.quality_of_service_121));
								}
								break;
							case 88:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 89:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 90:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 91:
								if(config.sensor_boot_time_78_active){
									promises.sensor_boot_time_78 = node.config_gateway.config_set_sensor_boot_time_78(mac, parseInt(config.sensor_boot_time_78));
								}
								break;
							case 95:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 96:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 97:
								if(config.raw_length_97_active){
									promises.raw_length_97 = node.config_gateway.config_set_raw_length_97(mac, parseInt(config.raw_length_97));
								}
								if(config.raw_timeout_97_active){
									promises.raw_timeout_97 = node.config_gateway.config_set_raw_timeout_97(mac, parseInt(config.raw_timeout_97));
								}
								if(config.fly_rate_97_active){
									promises.fly_rate_97 = node.config_gateway.config_set_fly_rate_97(mac, parseInt(config.fly_rate_97));
								}
								if(config.boot_up_time_97_active){
									promises.boot_up_time_97 = node.config_gateway.config_set_boot_up_time_97(mac, parseInt(config.boot_up_time_97));
								}
								if(config.mode_97_active){
									promises.mode = node.config_gateway.config_set_mode_97(mac, parseInt(config.mode_97));
								}
								break;
							case 98:
								if(config.raw_length_97_active){
									promises.raw_length_97 = node.config_gateway.config_set_raw_length_97(mac, parseInt(config.raw_length_97));
								}
								if(config.raw_timeout_97_active){
									promises.raw_timeout_97 = node.config_gateway.config_set_raw_timeout_97(mac, parseInt(config.raw_timeout_97));
								}
								if(config.fly_rate_97_active){
									promises.fly_rate_97 = node.config_gateway.config_set_fly_rate_97(mac, parseInt(config.fly_rate_97));
								}
								if(config.boot_up_time_97_active){
									promises.boot_up_time_97 = node.config_gateway.config_set_boot_up_time_97(mac, parseInt(config.boot_up_time_97));
								}
								if(config.mode_97_active){
									promises.mode = node.config_gateway.config_set_mode_97(mac, parseInt(config.mode_97));
								}
								// if(config.sensor_boot_time_420ma_active){
								// 	promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								// }
								// if(config.low_calibration_420ma_active){
								// 	promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								// }
								// if(config.mid_calibration_420ma_active){
								// 	promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								// }
								// if(config.high_calibration_420ma_active){
								// 	promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								// }
								// if(config.auto_check_interval_88_active){
								// 	promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								// }
								// if(config.auto_check_threshold_88_active){
								// 	promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								// }
								break;
							case 101:
								if(config.output_data_rate_101_m2_active){
									promises.output_data_rate_101_m2 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_101_m2));
								}
								if(config.sampling_duration_101_active){
									promises.sampling_duration_101 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_101));
								}
								if(config.x_axis_101 || config.y_axis_101 || config.z_axis_101){
									promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								}
								if(config.sampling_interval_101_active){
									promises.sampling_interval_101 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_101));
								}
								if(config.full_scale_range_101_m2_active){
									promises.full_scale_range_101_m2 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101_m2));
								}
								// promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								break;
							case 102:
								if(config.output_data_rate_101_active){
									promises.output_data_rate_101 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_101));
								}
								if(config.sampling_duration_101_active){
									promises.sampling_duration_101 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_101));
								}

								// promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								if(config.sampling_interval_101_active){
									promises.sampling_interval_101 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_101));
								}
								// if(config.full_scale_range_101_active){
								// 	promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								// }
								// promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								break;
							case 103:
								if(config.output_data_rate_103_active){
									promises.output_data_rate_103 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_103));
								}
								if(config.sampling_interval_101_active){
									promises.sampling_interval_103 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_101));
								}
								if(config.acc_threshold_103_active){
									promises.acc_threshold_103 = node.config_gateway.config_set_acc_threshold_103(mac, parseInt(config.acc_threshold_103));
								}
								if(config.enable_sensor_103_active){
									promises.enable_sensor_103 = node.config_gateway.config_set_enable_sensor_103(mac, parseInt(config.enable_sensor_103));
								}
								if(config.enable_hp_filter_cutoff_103_active){
									promises.enable_hp_filter_cutoff_103 = node.config_gateway.config_set_enable_hp_filter_cutoff_103(mac, parseInt(config.enable_hp_filter_cutoff_103));
								}
								if(config.gyro_fsr_103_active){
									promises.gyro_fsr_103 = node.config_gateway.config_set_gyro_fsr_103(mac, parseInt(config.gyro_fsr_103));
								}
								if(config.adxl_fsr_103_active){
									promises.adxl_fsr_103 = node.config_gateway.config_set_adxl_fsr_103(mac, parseInt(config.adxl_fsr_103));
								}
								if(config.sampling_duration_103_active){
									promises.sampling_duration_103 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_103));
								}
								if(config.set_rtc_101){
									promises.set_rtc_103 = node.config_gateway.config_set_rtc_101(mac);
								}
								break;
							case 105:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 106:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 107:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 108:
								if(config.accelerometer_state_108_active){
									promises.accelerometer_state_108 = node.config_gateway.config_set_accelerometer_state_108(mac, parseInt(config.accelerometer_state_108));
								}
								if(config.clear_timers_108_active){
									promises.clear_timers_108 = node.config_gateway.config_set_clear_timers_108(mac, parseInt(config.clear_timers_108));
								}
								if(config.accelerometer_threshold_108_active){
									promises.accelerometer_threshold_108 = node.config_gateway.config_set_accelerometer_threshold_108(mac, parseInt(config.accelerometer_threshold_108));
								}
								if(config.debounce_time_108_active){
									promises.debounce_time_108 = node.config_gateway.config_set_debounce_time_108(mac, parseInt(config.debounce_time_108));
								}
								if(config.debounce_time_v10_108_active){
									promises.debounce_time_v10_108 = node.config_gateway.config_set_debounce_time_v10_108(mac, parseInt(config.debounce_time_v10_108));
								}
								if(config.input_one_108_active){
									promises.input_one_108 = node.config_gateway.config_set_input_one_108(mac, parseInt(config.input_one_108));
								}
								if(config.input_two_108_active){
									promises.input_two_108 = node.config_gateway.config_set_input_two_108(mac, parseInt(config.input_two_108));
								}
								if(config.input_three_108_active){
									promises.input_three_108 = node.config_gateway.config_set_input_three_108(mac, parseInt(config.input_three_108));
								}
								if(config.counter_threshold_108_active){
									promises.counter_threshold_108 = node.config_gateway.config_set_counter_threshold_108(mac, parseInt(config.counter_threshold_108));
								}
								if(config.push_notification_108_active){
									promises.push_notification_108 = node.config_gateway.config_set_push_notification_108(mac, parseInt(config.push_notification_108));
								}
								if(config.deactivate_activate_accelero_108_active){
									promises.deactivate_activate_accelero_108 = node.config_gateway.config_set_deactivate_activate_accelero_108(mac, parseInt(config.deactivate_activate_accelero_108));
								}
								if(config.reset_timeout_108_active){
									promises.reset_timeout_108 = node.config_gateway.config_set_reset_timeout_108(mac, parseInt(config.reset_timeout_108));
								}
								if(config.reset_mode_to_disabled_108_active){
									promises.reset_mode_to_disabled_108 = node.config_gateway.config_set_reset_mode_to_disabled_108(mac, parseInt(config.reset_mode_to_disabled_108));
								}
								if(config.rtc_108){
									promises.rtc_108 = node.config_gateway.config_set_rtc_108(mac);
								}
								if(config.transmission_interval_108_active){
									promises.transmission_interval_108 = node.config_gateway.config_set_transmission_interval_108(mac, parseInt(config.transmission_interval_108));
								}
								if(config.shift_one_108_active){
									promises.shift_time1 = node.config_gateway.config_set_shift_one_108(mac, parseInt(config.shift_one_hours_108), parseInt(config.shift_one_minutes_108));
								}
								if(config.shift_two_108_active){
									promises.shift_time2 = node.config_gateway.config_set_shift_two_108(mac, parseInt(config.shift_two_hours_108), parseInt(config.shift_two_minutes_108));
								}
								if(config.shift_three_108_active){
									promises.shift_time3 = node.config_gateway.config_set_shift_three_108(mac, parseInt(config.shift_three_hours_108), parseInt(config.shift_three_minutes_108));
								}
								if(config.shift_four_108_active){
									promises.shift_time4 = node.config_gateway.config_set_shift_four_108(mac, parseInt(config.shift_four_hours_108), parseInt(config.shift_four_minutes_108));
								}
								if(config.quality_of_service_108_active){
									promises.quality_of_service_108 = node.config_gateway.config_set_quality_of_service_108(mac, parseInt(config.quality_of_service_108));
								}
								if(config.fly_interval_108_active){
									promises.fly_interval_108 = node.config_gateway.config_set_fly_interval_108(mac, parseInt(config.fly_interval_108));
								}
								if(config.sample_rate_108_active){
									promises.sample_rate_108 = node.config_gateway.config_set_sample_rate_108(mac, parseInt(config.sample_rate_108));
								}
								if(config.interrupt_timeout_108_active){
									promises.interrupt_timeout_108 = node.config_gateway.config_set_interrupt_timeout_108(mac, parseInt(config.interrupt_timeout_108));
								}
								if(config.screen_control_108_active){
									promises.screen_control_108 = node.config_gateway.config_set_screen_control_108(mac, parseInt(config.screen_control_108));
								}
								if(config.screen_on_time_108_active){
									promises.screen_on_time_108 = node.config_gateway.config_set_screen_on_time_108(mac, parseInt(config.screen_on_time_108));
								}
								break;
							case 110:
								if(config.odr_p1_110_active){
									promises.odr_p1_110 = node.config_gateway.config_set_odr_p1_110(mac, parseInt(config.odr_p1_110));
								}
								if(config.enable_filtering_110_active){
									promises.enable_filtering_110 = node.config_gateway.config_set_enable_filtering_110(mac, parseInt(config.enable_filtering_110));
								}
								if(config.sampling_duration_p1_110_active){
									promises.sampling_duration_p1_110 = node.config_gateway.config_set_sampling_duration_p1_110(mac, parseInt(config.sampling_duration_p1_110));
								}
								if(config.sampling_interval_110_active){
									promises.sampling_interval_110 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_110));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_110_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_110));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_p1_110_active){
									promises.low_pass_filter_p1_110 = node.config_gateway.config_set_low_pass_filter_p1_110(mac, parseInt(config.low_pass_filter_p1_110));
								}
								if(config.high_pass_filter_p1_110_active){
									promises.high_pass_filter_p1_110 = node.config_gateway.config_set_high_pass_filter_p1_110(mac, parseInt(config.high_pass_filter_p1_110));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								if(config.auto_raw_interval_110_active){
									promises.auto_raw_interval_110 = node.config_gateway.config_set_auto_raw_interval_110(mac, parseInt(config.auto_raw_interval_110));
								}
								if(config.auto_raw_destination_110_active){
									promises.auto_raw_destination_110 = node.config_gateway.config_set_auto_raw_destination_110(mac, parseInt(config.auto_raw_destination_110, 16));
								}
								if(config.clear_probe_uptimers_110){
									promises.clear_probe_uptimers = node.config_gateway.config_set_clear_probe_uptimers_110(mac);
								}
								if(config.smart_interval_110_active){
									promises.smart_interval_110 = node.config_gateway.config_set_smart_interval_110(mac, parseInt(config.smart_interval_110));
								}
								if(config.smart_threshold_110_active){
									promises.smart_threshold_110 = node.config_gateway.config_set_smart_threshold_110(mac, parseInt(config.smart_threshold_110));
								}
								if(config.fly_interval_110_active){
									promises.fly_interval_110 = node.config_gateway.config_set_fly_interval_110(mac, parseInt(config.fly_interval_110));
								}
								if(config.motion_detect_threshold_p1_110_active){
									promises.motion_detect_threshold_p1_110 = node.config_gateway.config_set_motion_detect_threshold_p1_110(mac, parseInt(config.motion_detect_threshold_p1_110));
								}
								if(config.enable_rpm_calculate_status_110_active){
									promises.enable_rpm_calculate_status_110 = node.config_gateway.config_set_enable_rpm_calculate_status_110(mac, parseInt(config.enable_rpm_calculate_status_110));
								}
								if(config.max_raw_sample_110_active){
									promises.max_raw_sample_110 = node.config_gateway.config_set_max_raw_sample_110(mac, parseInt(config.max_raw_sample_110));
								}
								if(config.motion_to_sampling_delay_110_active){
									promises.motion_to_sampling_delay_110 = node.config_gateway.config_set_motion_to_sampling_delay_110(mac, parseInt(config.motion_to_sampling_delay_110));
								}
								if(config.max_num_motion_tx_delay_110_active){
									promises.max_num_motion_tx_delay_110 = node.config_gateway.config_set_max_num_motion_tx_delay_110(mac, parseInt(config.max_num_motion_tx_delay_110));
								}
								break;
							case 111:
								if(config.odr_p1_110_active){
									promises.odr_p1_111 = node.config_gateway.config_set_odr_p1_110(mac, parseInt(config.odr_p1_110));
								}
								if(config.enable_filtering_110_active){
									promises.enable_filtering_111 = node.config_gateway.config_set_enable_filtering_110(mac, parseInt(config.enable_filtering_110));
								}
								if(config.sampling_duration_p1_110_active){
									promises.sampling_duration_p1_111 = node.config_gateway.config_set_sampling_duration_p1_110(mac, parseInt(config.sampling_duration_p1_110));
								}
								if(config.odr_p2_110_active){
									promises.odr_p2_111 = node.config_gateway.config_set_odr_p2_110(mac, parseInt(config.odr_p2_110));
								}
								if(config.sampling_duration_p2_110_active){
									promises.sampling_duration_p2_111 = node.config_gateway.config_set_sampling_duration_p2_110(mac, parseInt(config.sampling_duration_p2_110));
								}
								if(config.sampling_interval_110_active){
									promises.sampling_interval_110 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_110));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_110_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_110));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_p1_110_active){
									promises.low_pass_filter_p1_111 = node.config_gateway.config_set_low_pass_filter_p1_110(mac, parseInt(config.low_pass_filter_p1_110));
								}
								if(config.high_pass_filter_p1_110_active){
									promises.high_pass_filter_p1_111 = node.config_gateway.config_set_high_pass_filter_p1_110(mac, parseInt(config.high_pass_filter_p1_110));
								}
								if(config.low_pass_filter_p2_110_active){
									promises.low_pass_filter_p2_111 = node.config_gateway.config_set_low_pass_filter_p2_110(mac, parseInt(config.low_pass_filter_p2_110));
								}
								if(config.high_pass_filter_p2_110_active){
									promises.high_pass_filter_p2_111 = node.config_gateway.config_set_high_pass_filter_p2_110(mac, parseInt(config.high_pass_filter_p2_110));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								if(config.auto_raw_interval_110_active){
									promises.auto_raw_interval_110 = node.config_gateway.config_set_auto_raw_interval_110(mac, parseInt(config.auto_raw_interval_110));
								}
								if(config.auto_raw_destination_110_active){
									promises.auto_raw_destination_110 = node.config_gateway.config_set_auto_raw_destination_110(mac, parseInt(config.auto_raw_destination_110, 16));
								}
								if(config.clear_probe_uptimers_110){
									promises.clear_probe_uptimers = node.config_gateway.config_set_clear_probe_uptimers_110(mac);
								}
								if(config.smart_interval_110_active){
									promises.smart_interval_110 = node.config_gateway.config_set_smart_interval_110(mac, parseInt(config.smart_interval_110));
								}
								if(config.smart_threshold_110_active){
									promises.smart_threshold_110 = node.config_gateway.config_set_smart_threshold_110(mac, parseInt(config.smart_threshold_110));
								}
								if(config.smart_threshold_p2_110_active){
									promises.smart_threshold_p2_110 = node.config_gateway.config_set_smart_threshold_p2_110(mac, parseInt(config.smart_threshold_p2_110));
								}
								if(config.fly_interval_110_active){
									promises.fly_interval_110 = node.config_gateway.config_set_fly_interval_110(mac, parseInt(config.fly_interval_110));
								}
								if(config.motion_detect_threshold_p1_110_active){
									promises.motion_detect_threshold_p1_111 = node.config_gateway.config_set_motion_detect_threshold_p1_110(mac, parseInt(config.motion_detect_threshold_p1_110));
								}
								if(config.motion_detect_threshold_p2_110_active){
									promises.motion_detect_threshold_p2_111 = node.config_gateway.config_set_motion_detect_threshold_p2_110(mac, parseInt(config.motion_detect_threshold_p2_110));
								}
								if(config.enable_rpm_calculate_status_110_active){
									promises.enable_rpm_calculate_status_111 = node.config_gateway.config_set_enable_rpm_calculate_status_110(mac, parseInt(config.enable_rpm_calculate_status_110));
								}
								if(config.max_raw_sample_110_active){
									promises.max_raw_sample_110 = node.config_gateway.config_set_max_raw_sample_110(mac, parseInt(config.max_raw_sample_110));
								}
								if(config.motion_to_sampling_delay_110_active){
									promises.motion_to_sampling_delay_111 = node.config_gateway.config_set_motion_to_sampling_delay_110(mac, parseInt(config.motion_to_sampling_delay_110));
								}
								if(config.max_num_motion_tx_delay_110_active){
									promises.max_num_motion_tx_delay_111 = node.config_gateway.config_set_max_num_motion_tx_delay_110(mac, parseInt(config.max_num_motion_tx_delay_110));
								}
								break;
							case 112:
								if(config.current_calibration_82_active){
									promises.current_calibration_82 = node.config_gateway.config_set_current_calibration_82(mac, parseInt(config.current_calibration_82));
								}
								if(config.odr_p1_110_active){
									promises.odr_p1_112 = node.config_gateway.config_set_odr_p1_110(mac, parseInt(config.odr_p1_110));
								}
								if(config.enable_filtering_110_active){
									promises.enable_filtering_112 = node.config_gateway.config_set_enable_filtering_110(mac, parseInt(config.enable_filtering_110));
								}
								if(config.sampling_duration_p1_110_active){
									promises.sampling_duration_p1_112 = node.config_gateway.config_set_sampling_duration_p1_110(mac, parseInt(config.sampling_duration_p1_110));
								}
								if(config.sampling_interval_110_active){
									promises.sampling_interval_110 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_110));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_110_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_110));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_p1_110_active){
									promises.low_pass_filter_p1_112 = node.config_gateway.config_set_low_pass_filter_p1_110(mac, parseInt(config.low_pass_filter_p1_110));
								}
								if(config.high_pass_filter_p1_110_active){
									promises.high_pass_filter_p1_112 = node.config_gateway.config_set_high_pass_filter_p1_110(mac, parseInt(config.high_pass_filter_p1_110));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								if(config.auto_raw_interval_110_active){
									promises.auto_raw_interval_110 = node.config_gateway.config_set_auto_raw_interval_110(mac, parseInt(config.auto_raw_interval_110));
								}
								if(config.auto_raw_destination_110_active){
									promises.auto_raw_destination_110 = node.config_gateway.config_set_auto_raw_destination_110(mac, parseInt(config.auto_raw_destination_110, 16));
								}
								if(config.clear_probe_uptimers_110){
									promises.clear_probe_uptimers = node.config_gateway.config_set_clear_probe_uptimers_110(mac);
								}
								if(config.smart_interval_110_active){
									promises.smart_interval_110 = node.config_gateway.config_set_smart_interval_110(mac, parseInt(config.smart_interval_110));
								}
								if(config.smart_threshold_110_active){
									promises.smart_threshold_110 = node.config_gateway.config_set_smart_threshold_110(mac, parseInt(config.smart_threshold_110));
								}
								if(config.fly_interval_110_active){
									promises.fly_interval_110 = node.config_gateway.config_set_fly_interval_110(mac, parseInt(config.fly_interval_110));
								}
								if(config.motion_detect_threshold_p1_110_active){
									promises.motion_detect_threshold_p1_112 = node.config_gateway.config_set_motion_detect_threshold_p1_110(mac, parseInt(config.motion_detect_threshold_p1_110));
								}
								if(config.thermocouple_type_112_active){
									promises.thermocouple_type_112 = node.config_gateway.config_set_thermocouple_type_112(mac, parseInt(config.thermocouple_type_112));
								}
								if(config.filter_thermocouple_112_active){
									promises.filter_thermocouple_112 = node.config_gateway.config_set_filter_thermocouple_112(mac, parseInt(config.filter_thermocouple_112));
								}
								if(config.cold_junction_thermocouple_112_active){
									promises.cold_junction_thermocouple_112 = node.config_gateway.config_set_cold_junction_thermocouple_112(mac, parseInt(config.cold_junction_thermocouple_112));
								}
								if(config.sample_resolution_thermocouple_112_active){
									promises.sample_resolution_thermocouple_112 = node.config_gateway.config_set_sample_resolution_thermocouple_112(mac, parseInt(config.sample_resolution_thermocouple_112));
								}
								if(config.number_of_samples_thermocouple_112_active){
									promises.number_of_samples_thermocouple_112 = node.config_gateway.config_set_number_of_samples_thermocouple_112(mac, parseInt(config.number_of_samples_thermocouple_112));
								}
								if(config.measurement_type_thermocouple_112_active){
									promises.measurement_type_thermocouple_112 = node.config_gateway.config_set_measurement_type_thermocouple_112(mac, parseInt(config.measurement_type_thermocouple_112));
								}
								if(config.operation_mode_thermocouple_112_active){
									promises.operation_mode_thermocouple_112 = node.config_gateway.config_set_operation_mode_thermocouple_112(mac, parseInt(config.operation_mode_thermocouple_112));
								}
								if(config.enable_rpm_calculate_status_110_active){
									promises.enable_rpm_calculate_status_112 = node.config_gateway.config_set_enable_rpm_calculate_status_110(mac, parseInt(config.enable_rpm_calculate_status_110));
								}
								if(config.max_raw_sample_110_active){
									promises.max_raw_sample_110 = node.config_gateway.config_set_max_raw_sample_110(mac, parseInt(config.max_raw_sample_110));
								}
								if(config.motion_to_sampling_delay_110_active){
									promises.motion_to_sampling_delay_112 = node.config_gateway.config_set_motion_to_sampling_delay_110(mac, parseInt(config.motion_to_sampling_delay_110));
								}
								if(config.max_num_motion_tx_delay_110_active){
									promises.max_num_motion_tx_delay_112 = node.config_gateway.config_set_max_num_motion_tx_delay_110(mac, parseInt(config.max_num_motion_tx_delay_110));
								}
								break;
							case 114:
								if(config.odr_p1_110_active){
									promises.odr_p1_114 = node.config_gateway.config_set_odr_p1_110(mac, parseInt(config.odr_p1_110));
								}
								if(config.enable_filtering_110_active){
									promises.enable_filtering_114 = node.config_gateway.config_set_enable_filtering_110(mac, parseInt(config.enable_filtering_110));
								}
								if(config.sampling_duration_p1_110_active){
									promises.sampling_duration_p1_114 = node.config_gateway.config_set_sampling_duration_p1_110(mac, parseInt(config.sampling_duration_p1_110));
								}
								if(config.sampling_interval_110_active){
									promises.sampling_interval_110 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_110));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_110_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_110));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_p1_110_active){
									promises.low_pass_filter_p1_114 = node.config_gateway.config_set_low_pass_filter_p1_110(mac, parseInt(config.low_pass_filter_p1_110));
								}
								if(config.high_pass_filter_p1_110_active){
									promises.high_pass_filter_p1_114 = node.config_gateway.config_set_high_pass_filter_p1_110(mac, parseInt(config.high_pass_filter_p1_110));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.led_alert_mode_84_active){
									promises.led_alert_mode_84 = node.config_gateway.config_set_led_alert_mode_84(mac, parseInt(config.led_alert_mode_84));
								}
								if(config.led_accelerometer_threshold_84_active){
									promises.led_accelerometer_threshold_84 = node.config_gateway.config_set_led_accelerometer_threshold_84(mac, parseInt(config.led_accelerometer_threshold_84));
								}
								if(config.led_velocity_threshold_84_active){
									promises.led_velocity_threshold_84 = node.config_gateway.config_set_led_velocity_threshold_84(mac, parseInt(config.led_velocity_threshold_84));
								}
								if(config.motion_detect_threshold_p1_110_active){
									promises.motion_detect_threshold_p1_114 = node.config_gateway.config_set_motion_detect_threshold_p1_110(mac, parseInt(config.motion_detect_threshold_p1_110));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								if(config.auto_raw_interval_110_active){
									promises.auto_raw_interval_110 = node.config_gateway.config_set_auto_raw_interval_110(mac, parseInt(config.auto_raw_interval_110));
								}
								if(config.auto_raw_destination_110_active){
									promises.auto_raw_destination_110 = node.config_gateway.config_set_auto_raw_destination_110(mac, parseInt(config.auto_raw_destination_110, 16));
								}
								if(config.clear_probe_uptimers_110){
									promises.clear_probe_uptimers = node.config_gateway.config_set_clear_probe_uptimers_110(mac);
								}
								if(config.smart_interval_110_active){
									promises.smart_interval_110 = node.config_gateway.config_set_smart_interval_110(mac, parseInt(config.smart_interval_110));
								}
								if(config.smart_threshold_110_active){
									promises.smart_threshold_110 = node.config_gateway.config_set_smart_threshold_110(mac, parseInt(config.smart_threshold_110));
								}
								if(config.fly_interval_110_active){
									promises.fly_interval_110 = node.config_gateway.config_set_fly_interval_110(mac, parseInt(config.fly_interval_110));
								}
								if(config.enable_rpm_calculate_status_110_active){
									promises.enable_rpm_calculate_status_110 = node.config_gateway.config_set_enable_rpm_calculate_status_110(mac, parseInt(config.enable_rpm_calculate_status_110));
								}
								if(config.max_raw_sample_110_active){
									promises.max_raw_sample_110 = node.config_gateway.config_set_max_raw_sample_110(mac, parseInt(config.max_raw_sample_110));
								}
								if(config.motion_to_sampling_delay_110_active){
									promises.motion_to_sampling_delay_114 = node.config_gateway.config_set_motion_to_sampling_delay_110(mac, parseInt(config.motion_to_sampling_delay_110));
								}
								if(config.max_num_motion_tx_delay_110_active){
									promises.max_num_motion_tx_delay_114 = node.config_gateway.config_set_max_num_motion_tx_delay_110(mac, parseInt(config.max_num_motion_tx_delay_110));
								}
								break;
							case 118:
								if(config.pressure_sensor_fs_ch1_118_active){
									promises.pressure_sensor_fs_ch1_118 = node.config_gateway.config_set_pressure_sensor_fs_ch1_118(mac, parseInt(config.pressure_sensor_fs_ch1_118));
								}
								if(config.pressure_sensor_fs_ch2_118_active){
									promises.pressure_sensor_fs_ch2_118 = node.config_gateway.config_set_pressure_sensor_fs_ch2_118(mac, parseInt(config.pressure_sensor_fs_ch2_118));
								}
								if(config.auto_check_interval_118_active){
									promises.auto_check_interval_118 = node.config_gateway.config_set_auto_check_interval_118(mac, parseInt(config.auto_check_interval_118));
								}
								if(config.press_auto_check_percent_118_active){
									promises.press_auto_check_percent_118 = node.config_gateway.config_set_press_auto_check_percent_118(mac, parseInt(config.press_auto_check_percent_118));
								}
								if(config.temp_auto_check_percent_118_active){
									promises.temp_auto_check_percent_118 = node.config_gateway.config_set_temp_auto_check_percent_118(mac, parseInt(config.temp_auto_check_percent_118));
								}
								break;
							case 120:
								if(config.stay_on_mode_539_active){
									promises.stay_on_mode_120 = node.config_gateway.config_set_stay_on_mode_539(mac, parseInt(config.stay_on_mode_539));
								}
								if(config.always_on_120){
									promises.always_on_120 = node.config_gateway.config_set_to_always_on_120(mac);
								}
								if(config.sensor_reset_120){
									promises.sensor_reset_120 = node.config_gateway.config_set_sensor_reset_120(mac);
								}
								if(config.sensor_calib_120){
									promises.sensor_calib_120 = node.config_gateway.config_set_sensor_calib_120(mac);
								}
								if(config.alert_threshold_120_active){
									promises.alert_threshold_120 = node.config_gateway.config_set_alert_threshold_120(mac, parseInt(config.alert_threshold_120));
								}
								break;
							case 121:
								if(config.wood_type_121_active){
									promises.wood_type_121 = node.config_gateway.config_set_wood_type_121(mac, parseInt(config.wood_type_121));
								}
								if(config.quality_of_service_121_active){
									promises.quality_of_service_121 = node.config_gateway.config_set_quality_of_service_121(mac, parseInt(config.quality_of_service_121));
								}
								break;
							case 122:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma_122 = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma_122 = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma_122 = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma_122 = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_122 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_122 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 123:
								if(config.clear_timers_123_active){
									promises.clear_timers_123 = node.config_gateway.config_set_clear_timers_108(mac, parseInt(config.clear_timers_123));
								}
								if(config.debounce_time_123_active){
									promises.debounce_time_123 = node.config_gateway.config_set_debounce_time_v10_108(mac, parseInt(config.debounce_time_123));
								}
								if(config.input_one_123_active){
									promises.input_one_123 = node.config_gateway.config_set_input_one_108(mac, parseInt(config.input_one_123));
								}
								if(config.input_two_123_active){
									promises.input_two_123 = node.config_gateway.config_set_input_two_108(mac, parseInt(config.input_two_123));
								}
								if(config.input_three_123_active){
									promises.input_three_123 = node.config_gateway.config_set_input_three_108(mac, parseInt(config.input_three_123));
								}
								if(config.counter_threshold_108_active){
									promises.counter_threshold_123 = node.config_gateway.config_set_counter_threshold_108(mac, parseInt(config.counter_threshold_108));
								}
								if(config.push_notification_123_active){
									promises.push_notification_123 = node.config_gateway.config_set_push_notification_108(mac, parseInt(config.push_notification_123));
								}
								if(config.reset_timeout_108_active){
									promises.reset_timeout_123 = node.config_gateway.config_set_reset_timeout_108(mac, parseInt(config.reset_timeout_108));
								}
								if(config.reset_mode_to_disabled_108_active){
									promises.reset_mode_123 = node.config_gateway.config_set_reset_mode_to_disabled_108(mac, parseInt(config.reset_mode_to_disabled_108));
								}
								if(config.rtc_108){
									promises.rtc_123 = node.config_gateway.config_set_rtc_108(mac);
								}
								if(config.transmission_interval_108_active){
									promises.transmission_interval_123 = node.config_gateway.config_set_transmission_interval_108(mac, parseInt(config.transmission_interval_108));
								}
								if(config.shift_one_108_active){
									promises.shift_time1_123 = node.config_gateway.config_set_shift_one_108(mac, parseInt(config.shift_one_hours_108), parseInt(config.shift_one_minutes_108));
								}
								if(config.shift_two_108_active){
									promises.shift_time2_123 = node.config_gateway.config_set_shift_two_108(mac, parseInt(config.shift_two_hours_108), parseInt(config.shift_two_minutes_108));
								}
								if(config.shift_three_108_active){
									promises.shift_time3_123 = node.config_gateway.config_set_shift_three_108(mac, parseInt(config.shift_three_hours_108), parseInt(config.shift_three_minutes_108));
								}
								if(config.shift_four_108_active){
									promises.shift_time4_123 = node.config_gateway.config_set_shift_four_108(mac, parseInt(config.shift_four_hours_108), parseInt(config.shift_four_minutes_108));
								}
								if(config.quality_of_service_108_active){
									promises.quality_of_service_123 = node.config_gateway.config_set_quality_of_service_108(mac, parseInt(config.quality_of_service_108));
								}
								if(config.fly_interval_108_active){
									promises.fly_interval_123 = node.config_gateway.config_set_fly_interval_108(mac, parseInt(config.fly_interval_108));
								}
								if(config.interrupt_timeout_108_active){
									promises.interrupt_timeout_123 = node.config_gateway.config_set_interrupt_timeout_108(mac, parseInt(config.interrupt_timeout_108));
								}
								break;
							case 124:
								if(config.volume_flow_unit_124_active){
									promises.volume_flow_unit_124 = node.config_gateway.config_set_volume_flow_unit_124(mac, parseInt(config.volume_flow_unit_124));
								}
								if(config.total_1_flow_unit_124_active){
									promises.total_1_flow_unit_124 = node.config_gateway.config_set_total_1_flow_unit_124(mac, parseInt(config.total_1_flow_unit_124));
								}
								if(config.total_2_flow_unit_124_active){
									promises.total_2_flow_unit_124 = node.config_gateway.config_set_total_2_flow_unit_124(mac, parseInt(config.total_2_flow_unit_124));
								}
								if(config.total_3_flow_unit_124_active){
									promises.total_3_flow_unit_124 = node.config_gateway.config_set_total_3_flow_unit_124(mac, parseInt(config.total_3_flow_unit_124));
								}
								if(config.pressure_unit_124_active){
									promises.pressure_unit_124 = node.config_gateway.config_set_pressure_unit_124(mac, parseInt(config.pressure_unit_124));
								}
								if(config.total_1_op_mode_124_active){
									promises.total_1_op_mode_124 = node.config_gateway.config_set_total_1_op_mode_124(mac, parseInt(config.total_1_op_mode_124));
								}
								if(config.total_2_op_mode_124_active){
									promises.total_2_op_mode_124 = node.config_gateway.config_set_total_2_op_mode_124(mac, parseInt(config.total_2_op_mode_124));
								}
								if(config.total_3_op_mode_124_active){
									promises.total_3_op_mode_124 = node.config_gateway.config_set_total_3_op_mode_124(mac, parseInt(config.total_3_op_mode_124));
								}
								if(config.conductivity_unit_124_active){
									promises.conductivity_unit_124 = node.config_gateway.config_set_conductivity_unit_124(mac, parseInt(config.conductivity_unit_124));
								}
								if(config.reset_all_totalizers_124){
									promises.reset_all_totalizers_124 = node.config_gateway.config_set_reset_all_totalizers_124(mac);
								}
								break;
							case 180:
								if(config.output_data_rate_101_active){
									promises.output_data_rate_101 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_101));
								}
								if(config.sampling_duration_101_active){
									promises.sampling_duration_101 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_101));
								}
								if(config.x_axis_101 || config.y_axis_101 || config.z_axis_101){
									promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								}
								if(config.sampling_interval_101_active){
									promises.sampling_interval_101 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_101));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_80_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_80));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_80_active){
									promises.low_pass_filter = node.config_gateway.config_set_low_pass_filter_80(mac, parseInt(config.low_pass_filter_80));
								}
								if(config.high_pass_filter_80_active){
									promises.high_pass_filter = node.config_gateway.config_set_high_pass_filter_80(mac, parseInt(config.high_pass_filter_80));
								}
								if(config.measurement_mode_80_active){
									promises.measurement_mode = node.config_gateway.config_set_measurement_mode_80(mac, parseInt(config.measurement_mode_80));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								break;
							case 181:
								if(config.output_data_rate_p1_81_active){
									promises.output_data_rate_p1_81 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_p1_81));
								}
								if(config.output_data_rate_p2_81_active){
									promises.output_data_rate_p2_81 = node.config_gateway.config_set_output_data_rate_p2_81(mac, parseInt(config.output_data_rate_p2_81));
								}
								if(config.sampling_duration_p1_81_active){
									promises.sampling_duration_p1_81 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_p1_81));
								}
								if(config.sampling_duration_p2_81_active){
									promises.sampling_duration_p2_81 = node.config_gateway.config_set_sampling_duration_p2_81(mac, parseInt(config.sampling_duration_p2_81));
								}
								if(config.x_axis_101 || config.y_axis_101 || config.z_axis_101){
									promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								}
								if(config.sampling_interval_101_active){
									promises.sampling_interval_101 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_101));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_80_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_80));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_80_active){
									promises.low_pass_filter = node.config_gateway.config_set_low_pass_filter_80(mac, parseInt(config.low_pass_filter_80));
								}
								if(config.high_pass_filter_80_active){
									promises.high_pass_filter = node.config_gateway.config_set_high_pass_filter_80(mac, parseInt(config.high_pass_filter_80));
								}
								if(config.low_pass_filter_81_p2_active){
									promises.low_pass_filter_p2 = node.config_gateway.config_set_low_pass_filter_81_p2(mac, parseInt(config.low_pass_filter_81_p2));
								}
								if(config.high_pass_filter_81_p2_active){
									promises.high_pass_filter_p2 = node.config_gateway.config_set_high_pass_filter_81_p2(mac, parseInt(config.high_pass_filter_81_p2));
								}
								if(config.measurement_mode_80_active){
									promises.measurement_mode = node.config_gateway.config_set_measurement_mode_80(mac, parseInt(config.measurement_mode_80));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								break;
							case 200:
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 202:
								if(config.sampling_interval_202_active){
									promises.sampling_interval_202 = node.config_gateway.config_set_sampling_interval_202(mac, parseInt(config.sampling_interval_202));
								}
								if(config.set_rtc_202){
									promises.set_rtc_202 = node.config_gateway.config_set_rtc_202(mac);
								}
								if(config.probe_boot_time_202_active){
									promises.probe_boot_time_202 = node.config_gateway.config_set_probe_boot_time_202(mac, parseInt(config.probe_boot_time_202));
								}
							    break;
							case 211:
								if(config.oxygen_rate_211_active){
									promises.oxygen_rate_211 = node.config_gateway.config_set_oxygen_rate_211(mac, parseInt(config.oxygen_rate_211));
								}
								if(config.oxygen_timeout_211_active){
									promises.oxygen_timeout_211 = node.config_gateway.config_set_oxygen_timeout_211(mac, parseInt(config.oxygen_timeout_211));
								}
								if(config.oxygen_threshold_211_active){
									promises.oxygen_threshold_211 = node.config_gateway.config_set_oxygen_threshold_211(mac, parseInt(config.oxygen_threshold_211));
								}
								break;
							case 217:
								if(config.tare_the_scale_217){
									promises.tare_the_scale_217 = node.config_gateway.config_set_tare_the_scale_217(mac);
								}
								if(config.weight_calib_217_active){
									promises.weight_calib_217 = node.config_gateway.config_set_weight_calib_217(mac, parseInt(config.weight_calib_217));
								}
								break;
							case 270:
								// if(config.do_read_rate_270_active){
								// 	promises.sensors_read_rate_270 = node.config_gateway.config_set_do_read_rate_270(mac, parseInt(config.do_read_rate_270));
								// }
								if(config.do_boot_time_270_active){
									promises.do_boot_time_270 = node.config_gateway.config_set_do_boot_time_270(mac, parseInt(config.do_boot_time_270));
								}
								if(config.do_dev_id_270_active){
									promises.do_dev_id_270 = node.config_gateway.config_set_do_dev_id_270(mac, parseInt(config.do_dev_id_1_270), parseInt(config.do_dev_id_2_270), parseInt(config.do_dev_id_3_270), parseInt(config.do_dev_id_4_270));
								}
								if(config.ec_boot_time_270_active){
									promises.ec_boot_time_270 = node.config_gateway.config_set_ec_boot_time_270(mac, parseInt(config.ec_boot_time_270));
								}
								if(config.ec_dev_id_270_active){
									promises.ec_dev_id_270 = node.config_gateway.config_set_ec_dev_id_270(mac, parseInt(config.ec_dev_id_1_270), parseInt(config.ec_dev_id_2_270), parseInt(config.ec_dev_id_3_270), parseInt(config.ec_dev_id_4_270));
								}
								break;
							case 505:
								if(config.current_calibration_c1_80_active){
									promises.current_calibration_c1_80_active = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c1_80), 1);
								}
								break;
							case 506:
								if(config.current_calibration_c1_80_active){
									promises.current_calibration_c1_80_active = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c1_80), 1);
								}
								if(config.current_calibration_c2_80_active){
									promises.current_calibration_c2_80 = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c2_80), 3);
								}
								if(config.current_calibration_c3_80_active){
									promises.current_calibration_c3_80 = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c3_80), 5);
								}
								break;
							case 519:
								if(config.output_data_rate_101_active){
									promises.output_data_rate_101 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_101));
								}
								if(config.sampling_duration_101_active){
									promises.sampling_duration_101 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_101));
								}
								if(config.x_axis_101 || config.y_axis_101 || config.z_axis_101){
									promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								}
								if(config.sampling_interval_101_active){
									promises.sampling_interval_101 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_101));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_80_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_80));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_80_active){
									promises.low_pass_filter = node.config_gateway.config_set_low_pass_filter_80(mac, parseInt(config.low_pass_filter_80));
								}
								if(config.high_pass_filter_80_active){
									promises.high_pass_filter = node.config_gateway.config_set_high_pass_filter_80(mac, parseInt(config.high_pass_filter_80));
								}
								if(config.measurement_mode_80_active){
									promises.measurement_mode = node.config_gateway.config_set_measurement_mode_80(mac, parseInt(config.measurement_mode_80));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.led_alert_mode_84_active){
									promises.led_alert_mode_84 = node.config_gateway.config_set_led_alert_mode_84(mac, parseInt(config.led_alert_mode_84));
								}
								if(config.led_accelerometer_threshold_84_active){
									promises.led_accelerometer_threshold_84 = node.config_gateway.config_set_led_accelerometer_threshold_84(mac, parseInt(config.led_accelerometer_threshold_84));
								}
								if(config.led_velocity_threshold_84_active){
									promises.led_velocity_threshold_84 = node.config_gateway.config_set_led_velocity_threshold_84(mac, parseInt(config.led_velocity_threshold_84));
								}
								if(config.acceleration_interrupt_threshold_84_active){
									promises.acceleration_interrupt_threshold_84 = node.config_gateway.config_set_acceleration_interrupt_threshold_84(mac, parseInt(config.acceleration_interrupt_threshold_84));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								break;
							case 531:
								if(config.mode_531_active){
									promises.mode_531 = node.config_gateway.config_set_operation_mode_531(mac, parseInt(config.mode_531));
								}
								break;
							case 535:
								if(config.force_calibration_co2_535_active){
									promises.force_calibration_co2_535 = node.config_gateway.config_set_sensor_forced_calibration_535(mac);
								}
								if(config.temperature_offset_44_active){
									promises.temperature_offset_44 = node.config_gateway.config_set_sensor_temperature_offset_44(mac, parseInt(config.temperature_offset_44));
								}
								break;
							case 536:
								if(config.oxygen_boot_time_536_active){
									promises.oxygen_boot_time_536 = node.config_gateway.config_set_oxygen_boot_time_536(mac, parseInt(config.oxygen_boot_time_536));
								}
								if(config.flow_boot_time_536_active){
									promises.flow_boot_time_536 = node.config_gateway.config_set_flow_boot_time_536(mac, parseInt(config.flow_boot_time_536));
								}
								if(config.oxygen_dev_addr_536_active){
									promises.oxygen_dev_addr_536 = node.config_gateway.config_set_oxygen_dev_addr_536(mac, parseInt(config.oxygen_addr_1_536), parseInt(config.oxygen_addr_2_536), parseInt(config.oxygen_addr_3_536), parseInt(config.oxygen_addr_4_536));
								}
								if(config.flow_dev_addr_536_active){
									promises.flow_dev_addr_536 = node.config_gateway.config_set_flow_dev_addr_536(mac, parseInt(config.flow_addr_1_536), parseInt(config.flow_addr_2_536), parseInt(config.flow_addr_3_536), parseInt(config.flow_addr_4_536));
								}
								if(config.oxygen_rate_536_active){
									promises.oxygen_rate_536 = node.config_gateway.config_set_oxygen_rate_536(mac, parseInt(config.oxygen_rate_536));
								}
								if(config.oxygen_timeout_536_active){
									promises.oxygen_timeout_536 = node.config_gateway.config_set_oxygen_timeout_536(mac, parseInt(config.oxygen_timeout_536));
								}
								if(config.oxygen_max_threshold_s1_536_active){
									promises.oxygen_max_threshold_s1_536 = node.config_gateway.config_set_oxygen_max_threshold_s1_536(mac, parseInt(config.oxygen_max_threshold_s1_536));
								}
								if(config.oxygen_max_threshold_s2_536_active){
									promises.oxygen_max_threshold_s2_536 = node.config_gateway.config_set_oxygen_max_threshold_s2_536(mac, parseInt(config.oxygen_max_threshold_s2_536));
								}
								if(config.oxygen_max_threshold_s3_536_active){
									promises.oxygen_max_threshold_s3_536 = node.config_gateway.config_set_oxygen_max_threshold_s3_536(mac, parseInt(config.oxygen_max_threshold_s3_536));
								}
								if(config.oxygen_max_threshold_s4_536_active){
									promises.oxygen_max_threshold_s4_536 = node.config_gateway.config_set_oxygen_max_threshold_s4_536(mac, parseInt(config.oxygen_max_threshold_s4_536));
								}
								if(config.oxygen_min_threshold_s1_536_active){
									promises.oxygen_min_threshold_s1_536 = node.config_gateway.config_set_oxygen_min_threshold_s1_536(mac, parseInt(config.oxygen_min_threshold_s1_536));
								}
								if(config.oxygen_min_threshold_s2_536_active){
									promises.oxygen_min_threshold_s2_536 = node.config_gateway.config_set_oxygen_min_threshold_s2_536(mac, parseInt(config.oxygen_min_threshold_s2_536));
								}
								if(config.oxygen_min_threshold_s3_536_active){
									promises.oxygen_min_threshold_s3_536 = node.config_gateway.config_set_oxygen_min_threshold_s3_536(mac, parseInt(config.oxygen_min_threshold_s3_536));
								}
								if(config.oxygen_min_threshold_s4_536_active){
									promises.oxygen_min_threshold_s4_536 = node.config_gateway.config_set_oxygen_min_threshold_s4_536(mac, parseInt(config.oxygen_min_threshold_s4_536));
								}
								break;
							case 537:
								if(config.output_data_rate_101_active){
									promises.output_data_rate_101 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_101));
								}
								if(config.sampling_duration_101_active){
									promises.sampling_duration_101 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_101));
								}
								if(config.x_axis_101 || config.y_axis_101 || config.z_axis_101){
									promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								}
								if(config.sampling_interval_101_active){
									promises.sampling_interval_101 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_101));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_80_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_80));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_80_active){
									promises.low_pass_filter = node.config_gateway.config_set_low_pass_filter_80(mac, parseInt(config.low_pass_filter_80));
								}
								if(config.high_pass_filter_80_active){
									promises.high_pass_filter = node.config_gateway.config_set_high_pass_filter_80(mac, parseInt(config.high_pass_filter_80));
								}
								if(config.measurement_mode_80_active){
									promises.measurement_mode = node.config_gateway.config_set_measurement_mode_80(mac, parseInt(config.measurement_mode_80));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.led_alert_mode_84_active){
									promises.led_alert_mode_84 = node.config_gateway.config_set_led_alert_mode_84(mac, parseInt(config.led_alert_mode_84));
								}
								if(config.led_accelerometer_threshold_84_active){
									promises.led_accelerometer_threshold_84 = node.config_gateway.config_set_led_accelerometer_threshold_84(mac, parseInt(config.led_accelerometer_threshold_84));
								}
								if(config.led_velocity_threshold_84_active){
									promises.led_velocity_threshold_84 = node.config_gateway.config_set_led_velocity_threshold_84(mac, parseInt(config.led_velocity_threshold_84));
								}
								if(config.acceleration_interrupt_threshold_84_active){
									promises.acceleration_interrupt_threshold_84 = node.config_gateway.config_set_acceleration_interrupt_threshold_84(mac, parseInt(config.acceleration_interrupt_threshold_84));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								break;
							case 538:
								if(config.output_data_rate_101_active){
									promises.output_data_rate_101 = node.config_gateway.config_set_output_data_rate_101(mac, parseInt(config.output_data_rate_101));
								}
								if(config.sampling_duration_101_active){
									promises.sampling_duration_101 = node.config_gateway.config_set_sampling_duration_101(mac, parseInt(config.sampling_duration_101));
								}
								if(config.x_axis_101 || config.y_axis_101 || config.z_axis_101){
									promises.axis_enabled_101 = node.config_gateway.config_set_axis_enabled_101(mac, config.x_axis_101, config.y_axis_101, config.z_axis_101);
								}
								if(config.sampling_interval_101_active){
									promises.sampling_interval_101 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_101));
								}
								if(config.full_scale_range_101_active){
									promises.full_scale_range_101 = node.config_gateway.config_set_full_scale_range_101(mac, parseInt(config.full_scale_range_101));
								}
								if(config.mode_80_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_80));
								}
								if(config.filter_80_active){
									promises.filter = node.config_gateway.config_set_filters_80(mac, parseInt(config.filter_80));
								}
								if(config.low_pass_filter_80_active){
									promises.low_pass_filter = node.config_gateway.config_set_low_pass_filter_80(mac, parseInt(config.low_pass_filter_80));
								}
								if(config.high_pass_filter_80_active){
									promises.high_pass_filter = node.config_gateway.config_set_high_pass_filter_80(mac, parseInt(config.high_pass_filter_80));
								}
								if(config.measurement_mode_80_active){
									promises.measurement_mode = node.config_gateway.config_set_measurement_mode_80(mac, parseInt(config.measurement_mode_80));
								}
								if(config.on_request_timeout_80_active){
									promises.on_request_timeout = node.config_gateway.config_set_on_request_timeout_80(mac, parseInt(config.on_request_timeout_80));
								}
								if(config.deadband_80_active){
									promises.deadband = node.config_gateway.config_set_deadband_80(mac, parseInt(config.deadband_80));
								}
								if(config.payload_length_80_active){
									promises.payload_length_80 = node.config_gateway.config_set_payload_length_80(mac, parseInt(config.payload_length_80));
								}
								if(config.set_rtc_101){
									promises.set_rtc_101 = node.config_gateway.config_set_rtc_101(mac);
								}
								break;
							case 539:
								if(config.stay_on_mode_539_active){
									promises.stay_on_mode_539 = node.config_gateway.config_set_stay_on_mode_539(mac, parseInt(config.stay_on_mode_539));
								}
								if(config.baudrate_539_active){
									promises.baudrate_539 = node.config_gateway.config_set_baudrate_539(mac, parseInt(config.baudrate_539));
								}
								if(config.stop_bit_1011_active){
									promises.stop_bit_1011 = node.config_gateway.config_set_stop_bit_1011(mac, parseInt(config.stop_bit_1011));
								}
								if(config.set_parity_1011_active){
									promises.set_parity_1011 = node.config_gateway.config_set_parity_1011(mac, parseInt(config.set_parity_1011));
								}
								if(config.rx_timeout_539_active){
									promises.rx_timeout_539 = node.config_gateway.config_set_rx_timeout_539(mac, parseInt(config.rx_timeout_539));
								}
								if(config.bootup_time_539_active){
									promises.bootup_time_539 = node.config_gateway.config_set_bootup_time_539(mac, parseInt(config.bootup_time_539));
								}
								if(config.sensor_add_539_active){
									promises.sensor_add_539 = node.config_gateway.config_set_sensor_add_539(mac, parseInt(config.sensor_add_539));
								}
								if(config.sub_device_type_539_active){
									promises.sub_device_type_539 = node.config_gateway.config_set_sub_device_type_539(mac, parseInt(config.sub_device_type_539));
								}
								if(config.number_of_read_retries_539_active){
									promises.number_of_read_retries_539 = node.config_gateway.config_set_number_of_read_retries_539(mac, parseInt(config.number_of_read_retries_539));
								}
								if(config.read_parameter_539_active){
									promises.read_parameter_539 = node.config_gateway.config_set_read_parameter_539(mac, parseInt(config.read_parameter_539));
								}
								if(config.number_of_regs_to_rd_539_active){
									let register_array = [];
									for(let ind = 0; ind < config.number_of_regs_to_rd_539; ind++){
										register_array.push(parseInt(config['register_value_'+ind+'_539']));
									}
									promises.config_set_all_register_data_539 = node.config_gateway.config_set_all_register_data_539(mac, parseInt(config.number_of_regs_to_rd_539), register_array);
								}
								break;
							case 540:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								break;
							case 541:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
								}
								if(config.low_calibration_420ma_active){
									promises.low_calibration_420ma = node.config_gateway.config_set_low_calibration_420ma(mac, parseInt(config.low_calibration_420ma));
								}
								if(config.mid_calibration_420ma_active){
									promises.mid_calibration_420ma = node.config_gateway.config_set_mid_calibration_420ma(mac, parseInt(config.mid_calibration_420ma));
								}
								if(config.high_calibration_420ma_active){
									promises.high_calibration_420ma = node.config_gateway.config_set_high_calibration_420ma(mac, parseInt(config.high_calibration_420ma));
								}
								if(config.auto_check_interval_88_active){
									promises.auto_check_interval_88 = node.config_gateway.config_set_auto_check_interval_88(mac, parseInt(config.auto_check_interval_88));
								}
								if(config.auto_check_threshold_88_active){
									promises.auto_check_threshold_88 = node.config_gateway.config_set_auto_check_threshold_88(mac, parseInt(config.auto_check_threshold_88));
								}
								if(config.fsr_420ma_active){
									promises.fsr_420ma = node.config_gateway.config_set_fsr_420ma(mac, parseInt(config.fsr_420ma));
								}
								if(config.always_on_420ma_active){
									promises.always_on_420ma = node.config_gateway.config_set_always_on_420ma(mac, parseInt(config.always_on_420ma));
								}
								if(config.max_flow_541_active){
									promises.max_flow_541 = node.config_gateway.config_set_max_flow_541(mac, parseInt(config.max_flow_541));
								}
								if(config.min_flow_541_active){
									promises.min_flow_541 = node.config_gateway.config_set_min_flow_541(mac, parseInt(config.min_flow_541));
								}
								break;
							case 1010:
								if(config.stay_on_mode_539_active){
									promises.stay_on_mode_539 = node.config_gateway.config_set_stay_on_mode_539(mac, parseInt(config.stay_on_mode_539));
								}
								if(config.baudrate_539_active){
									promises.baudrate_539 = node.config_gateway.config_set_baudrate_539(mac, parseInt(config.baudrate_539));
								}
								if(config.rx_timeout_539_active){
									promises.rx_timeout_539 = node.config_gateway.config_set_rx_timeout_539(mac, parseInt(config.rx_timeout_539));
								}
								if(config.stop_bit_1011_active){
									promises.stop_bit_1011 = node.config_gateway.config_set_stop_bit_1011(mac, parseInt(config.stop_bit_1011));
								}
								if(config.set_parity_1011_active){
									promises.set_parity_1011 = node.config_gateway.config_set_set_parity_1011(mac, parseInt(config.set_parity_1011));
								}
								if(config.reboot_1011){
									promises.reboot_1011 = node.config_gateway.config_set_reboot_1011(mac);
								}
								break;
							case 1011:
								if(config.stay_on_mode_539_active){
									promises.stay_on_mode_539 = node.config_gateway.config_set_stay_on_mode_539(mac, parseInt(config.stay_on_mode_539));
								}
								if(config.baudrate_539_active){
									promises.baudrate_539 = node.config_gateway.config_set_baudrate_539(mac, parseInt(config.baudrate_539));
								}
								if(config.rx485_timeout_1011_active){
									promises.rx485_timeout_1011 = node.config_gateway.config_set_rx485_timeout_1011(mac, parseInt(config.rx485_timeout_1011));
								}
								if(config.mode_1011_active){
									promises.mode_1011 = node.config_gateway.config_set_mode_1011(mac, parseInt(config.mode_1011));
								}
								if(config.auto_address_timeout_1011_active){
									promises.auto_address_timeout_1011 = node.config_gateway.config_set_auto_address_timeout_1011(mac, parseInt(config.auto_address_timeout_1011));
								}
								if(config.stop_bit_1011_active){
									promises.stop_bit_1011 = node.config_gateway.config_set_stop_bit_1011(mac, parseInt(config.stop_bit_1011));
								}
								if(config.set_parity_1011_active){
									promises.set_parity_1011 = node.config_gateway.config_set_parity_1011(mac, parseInt(config.set_parity_1011));
								}
								if(config.reboot_1011){
									promises.reboot_1011 = node.config_gateway.config_set_reboot_1011(mac);
								}
								break;
						}
					}
					// These sensors listed in original_otf_devices use a different OTF code.
					let original_otf_devices = [53, 80, 81, 82, 83, 84, 87, 101, 102, 103, 110, 111, 112, 114, 117, 180, 181, 518, 519, 520, 538];
					// If we changed the network ID reboot the sensor to take effect.
					// TODO if we add the encryption key command to node-red we need to reboot for it as well.
					if(reboot){
						promises.reboot_sensor = node.config_gateway.config_reboot_sensor(mac);
					} else if(otf){
						if(original_otf_devices.includes(sensor.type)){
							promises.exit_otn_mode = node.config_gateway.config_exit_otn_mode(mac);
						}else{
							promises.config_exit_otn_mode_common = node.config_gateway.config_exit_otn_mode_common(mac);
						}
					}
					promises.finish = new Promise((fulfill, reject) => {
						node.config_gateway.queue.add(() => {
							return new Promise((f, r) => {
								clearTimeout(tout);
								node.status(modes.READY);
								fulfill();
								f();
							});
						});
					});
					for(var i in promises){
						(function(name){
							promises[name].then((f) => {
								if(name != 'finish'){
									// console.log('IN PROMISE RESOLVE');
									// console.log(f);
									// success[name] = true;
									if(Object.hasOwn(f, 'result')){
										switch(f.result){
											case 255:
												success[name] = true;
												break;
											default:
												success[name] = {
													res: "Bad Response",
													result: f.result,
													sent: f.sent
												};
										}
									}else{
										success[name] = {
											res: "no result",
											result: null,
											sent: f.sent
										}
									}
								}
								else{
									// #OTF
									node.send({topic: 'Config Results', payload: success, time: Date.now(), addr: mac});
									top_fulfill(success);
								}
							}).catch((err) => {
								success[name] = err;
							});
						})(i);
					}
				}, 1000);
			});
		}
		node._sensor_config = _config;
		if(config.addr){
			config.addr = config.addr.toLowerCase();

			RED.nodes.getNode(config.connection).sensor_pool.push(config.addr);
			this.gtw_on('sensor_data-'+config.addr, (data) => {
				node.status(modes.RUN);
				data.modem_mac = this.gateway.modem_mac;
				node.send({
					topic: 'sensor_data',
					data: data,
					payload: data.sensor_data,
					time: Date.now()
				});
			});
			this.gtw_on('converter_response-'+config.addr, (data) => {
				node.status(modes.RUN);
				data.modem_mac = this.gateway.modem_mac;
				data.topic = 'converter_response';
				data.time = Date.now();
				node.send(data);
			});
			this.gtw_on('set_destination_address'+config.addr, (d) => {
				if(config.auto_config){
					node.warn('Setting destination address');
					return new Promise((top_fulfill, top_reject) => {
						var msg = {};
						setTimeout(() => {
							var tout = setTimeout(() => {
								node.status(modes.PGM_ERR);
								node.send({topic: 'FLY Set Destination Address', payload: msg, time: Date.now()});
							}, 10000);

							var promises = {};

							promises.config_dest_address_fly = node.config_gateway.config_set_destination(d, parseInt(config.destination, 16));

							promises.finish = new Promise((fulfill, reject) => {
								node.config_gateway.queue.add(() => {
									return new Promise((f, r) => {
										clearTimeout(tout);
										fulfill();
										f();
									});
								});
							});
							for(var i in promises){
								(function(name){
									promises[name].then((f) => {
										if(name != 'finish') msg[name] = true;
										else{
											node.send({topic: 'FLY Set Destination Address', payload: msg, time: Date.now()});
											top_fulfill(msg);
										}
									}).catch((err) => {
										msg[name] = err;
									});
								})(i);
							}
						});
					});
				}
			});
			this.pgm_on('sensor_mode-'+config.addr, (sensor) => {
				if(sensor.mode in modes){
					node.status(modes[sensor.mode]);
				}
				else{
					console.log('Error: unrecognized sensor mode packet');
				}
				if(config.auto_config && sensor.mode == "PGM"){
					_config(sensor);
				}else if(config.auto_config && config.on_the_fly_enable && sensor.mode == "FLY"){
					// _send_otn_request(sensor);
					// Sensors having issues seeing OTN request sent too quickly
					// Added timeout to fix issue
					if(config.sensor_type == 1010 || config.sensor_type == 1011){
						_config(sensor, true);
					}else if(!Object.hasOwn(node.gateway_node.sensor_configs, sensor.mac) || !Object.hasOwn(node.gateway_node.sensor_configs[sensor.mac], 'api_config_override')){
						// node.send({topic: "debug", payload: 'WIRELESS DEVICE NODE IS CONFIGURING SENSORS no mac!!!!!'});
						_config(sensor, true);
					}else{
						node.send({topic: 'warning', payload: {'warning': 'Wireless Device Node configurations overridden by API Configuration'}, addr: sensor.mac, time: Date.now()});
					}
				}else if(config.auto_config && config.on_the_fly_enable && sensor.mode == "OTN"){
					if(config.sensor_type == 101 || config.sensor_type == 102 || config.sensor_type == 202){
						if(this.gateway.hasOwnProperty('fly_101_in_progress') && this.gateway.fly_101_in_progress == false || !this.gateway.hasOwnProperty('fly_101_in_progress')){
							this.gateway.fly_101_in_progress = true;
							node.warn('Starting RTC Timer' + Date.now());
							node.warn('Sensor checked in for RTC: ' + sensor.mac + ' at ' + Date.now());
							var broadcast_tout = setTimeout(() => {
								node.warn('Sending RTC Broadcast ' + Date.now());
								_broadcast_rtc(sensor);
							}, 2000);
						}else{
							node.warn('Sensor checked in for RTC: ' + sensor.mac + ' at ' + Date.now());
						}

						if(config.auto_config && config.on_the_fly_enable){
							var tout = setTimeout(() => {
								node.warn('Proceeding with normal configs' + Date.now());
								_config(sensor, true);
							}, 3500);
						}
					}else if(!Object.hasOwn(node.gateway_node.sensor_configs, sensor.mac) || !Object.hasOwn(node.gateway_node.sensor_configs[sensor.mac], 'api_config_override')){
						// node.send({topic: "debug", payload: 'WIRELESS DEVICE NODE IS CONFIGURING SENSORS with mac!!!!!'});
						_config(sensor, true);
					}else{
						node.send({topic: 'warning', payload: {'warning': 'Wireless Device Node configurations overridden by API Configuration'}, addr: sensor.mac, time: Date.now()});
					};
				} else if(config.sensor_type == 101 && sensor.mode == "FLY" || config.sensor_type == 102 && sensor.mode == "FLY" || config.sensor_type == 202 && sensor.mode == "FLY"){
					if(this.gateway.hasOwnProperty('fly_101_in_progress') && this.gateway.fly_101_in_progress == false || !this.gateway.hasOwnProperty('fly_101_in_progress')){
						this.gateway.fly_101_in_progress = true;
						node.warn('Starting RTC Timer' + Date.now());
						node.warn('Sensor checked in for RTC: ' + sensor.mac + ' at ' + Date.now());
						var broadcast_tout = setTimeout(() => {
							node.warn('Sending RTC Broadcast ' + Date.now());
							_broadcast_rtc(sensor);
						}, 2000);
					}else{
						node.warn('Sensor checked in for RTC: ' + sensor.mac + ' at ' + Date.now());
					}
				}
			});
		}else if(config.sensor_type){
			this.gtw_on('sensor_data-'+config.sensor_type, (data) => {
				node.status(modes.RUN);
				data.modem_mac = this.gateway.modem_mac;
				node.send({
					topic: 'sensor_data',
					data: data,
					payload: data.sensor_data,
					time: Date.now()
				});
			});
			this.gtw_on('set_destination_address'+config.sensor_type, (d) => {
				if(config.auto_config){
					node.warn('Setting destination address');
					return new Promise((top_fulfill, top_reject) => {
						var msg = {};
						setTimeout(() => {
							var tout = setTimeout(() => {
								node.status(modes.PGM_ERR);
								node.send({topic: 'FLY Set Destination Address', payload: msg, time: Date.now()});
							}, 10000);

							var promises = {};

							promises.config_dest_address_fly = node.config_gateway.config_set_destination(d, parseInt(config.destination, 16));

							promises.finish = new Promise((fulfill, reject) => {
								node.config_gateway.queue.add(() => {
									return new Promise((f, r) => {
										clearTimeout(tout);
										fulfill();
										f();
									});
								});
							});
							for(var i in promises){
								(function(name){
									promises[name].then((f) => {
										if(name != 'finish') msg[name] = true;
										else{
											node.send({topic: 'FLY Set Destination Address', payload: msg, time: Date.now()});
											top_fulfill(msg);
										}
									}).catch((err) => {
										msg[name] = err;
									});
								})(i);
							}
						});
					});
				}
			});
			this.pgm_on('sensor_mode', (sensor) => {
				if(sensor.type == config.sensor_type){
					if(sensor.mode in modes){
						node.status(modes[sensor.mode]);
					}
					else{
						console.log('Error: unrecognized sensor mode packet');
					}
					if(config.auto_config && sensor.mode == 'PGM'){
						_config(sensor);
					}else if(config.auto_config && config.on_the_fly_enable && sensor.mode == "FLY"){
						// _send_otn_request(sensor);
						// Sensors having issues seeing OTN request sent too quickly
						// Added timeout to fix issue
						if(config.sensor_type == 1010 || config.sensor_type == 1011){
							_config(sensor, true);
						}else{
							var tout = setTimeout(() => {
								_send_otn_request(sensor);
							}, 100);
						}

					}else if(config.auto_config && config.on_the_fly_enable && sensor.mode == "OTN"){
						if(config.sensor_type == 101 || config.sensor_type == 102 || config.sensor_type == 202){
							if(this.gateway.hasOwnProperty('fly_101_in_progress') && this.gateway.fly_101_in_progress == false || !this.gateway.hasOwnProperty('fly_101_in_progress')){
								this.gateway.fly_101_in_progress = true;
								node.warn('Starting RTC Timer' + Date.now());
								node.warn('Sensor checked in for RTC: ' + sensor.mac + ' at ' + Date.now());
								var broadcast_tout = setTimeout(() => {
									node.warn('Sending RTC Broadcast ' + Date.now());
									_broadcast_rtc(sensor);
								}, 2000);
							}else{
								node.warn('Sensor checked in for RTC: ' + sensor.mac + ' at ' + Date.now());
							}
							if(config.auto_config && config.on_the_fly_enable){
								var tout = setTimeout(() => {
									node.warn('config timer expired' + Date.now());
									_config(sensor, true);
								}, 3500);
							}
						} else if(!Object.hasOwn(node.gateway_node.sensor_configs, sensor.mac) || !Object.hasOwn(node.gateway_node.sensor_configs[sensor.mac], 'desired_configs')){
							// node.send({topic: "debug", payload: 'WIRELESS DEVICE NODE IS CONFIGURING SENSORS no mac!!!!!'});
							_config(sensor, true);
						}else{
							node.send({topic: 'warning', payload: {'warning': 'Wireless Device Node configurations overridden by API Configuration'}, addr: sensor.mac, time: Date.now()});
						};

					}else if(sensor.mode == "FLY" && config.sensor_type == 101 || sensor.mode == "FLY" &&  config.sensor_type == 102 || sensor.mode == "FLY" &&  config.sensor_type == 202){
						if(this.gateway.hasOwnProperty('fly_101_in_progress') && this.gateway.fly_101_in_progress == false || !this.gateway.hasOwnProperty('fly_101_in_progress')){
							this.gateway.fly_101_in_progress = true;
							node.warn('Starting RTC Timer' + Date.now());
							node.warn('Sensor checked in for RTC: ' + sensor.mac + ' at ' + Date.now());
							var broadcast_tout = setTimeout(() => {
								node.warn('Sending RTC Broadcast ' + Date.now());
								_broadcast_rtc(sensor);
							}, 2000);
						}else{
							node.warn('Sensor checked in for RTC: ' + sensor.mac + ' at ' + Date.now());
						}
					}
				};

				// const config_node_capable = [114];
				// node.warn(sensor);
				// if(sensor.mode == "FLY" && config_node_capable.includes(config.sensor_type)){
				// 	node.warn(sensor);
				// }
			});
		}
		this.on('input', (msg) => {
			if(msg.topic == 'config'){
				_config();
			}else{
				node.gateway.send_arbitrary(config.addr, msg).then((m) => {
					console.log("complete");
				}).catch((err) => {
					console.log("error", err);
				});
			}
		});
		this.on('close', () => {
			for(var e in events){
				node.gateway._emitter.removeAllListeners(e);
			}
			for(var p in pgm_events){
				node.config_gateway._emitter.removeAllListeners(p);
			}

			node.gateway_node.close_comms();
			if(typeof node.config_gateway_node != 'undefined'){
				console.log(node.config_gateway_node.close_comms());
			}
		});
	}
	RED.nodes.registerType("ncd-wireless-node", NcdWirelessNode);

	RED.httpAdmin.post("/ncd/wireless/gateway/config/:id", RED.auth.needsPermission("serial.read"), function(req,res) {
		var node = RED.nodes.getNode(req.params.id);
		if (node != null) {
			try {
				var _pan = node._gateway_node.gateway.pan_id;
				var pan = node._gateway_node.is_config ? [_pan >> 8, _pan & 255] : [0x7b, 0xcd];
				var msgs = [
					'In listening mode',
					'In config mode',
					'Failed to connect'
				];
				node.gateway.digi.send.at_command("ID", pan).then().catch().then(() => {
					node._gateway_node.check_mode((m) => {
						node.set_status();
						res.send(msgs[m]);
					});
				});
			} catch(err) {
				console.log(err);
				res.sendStatus(500);
				node.error(RED._("gateway.update failed",{error:err.toString()}));
			}
		} else {
			res.sendStatus(404);
		}
	});

	RED.httpAdmin.get("/ncd/wireless/sensors/configure/:id", RED.auth.needsPermission('serial.read'), function(req,res) {
		var node = RED.nodes.getNode(req.params.id);
		if (node != null) {
			node._sensor_config().then((s) => {
				res.json(s);
			});
		}
	});

	RED.httpAdmin.get("/ncd/wireless/modems/list", RED.auth.needsPermission('serial.read'), function(req,res) {
		getSerialDevices(true, res);
	});
	RED.httpAdmin.get("/ncd/wireless/modem/info/:port/:baudRate", RED.auth.needsPermission('serial.read'), function(req,res) {
		var port = decodeURIComponent(req.params.port);
		if(typeof gateway_pool[port] == 'undefined'){
			var serial = new comms.NcdSerial(port, parseInt(req.params.baudRate));
			var modem = new wireless.Modem(serial);
			gateway_pool[port] = new wireless.Gateway(modem);
			serial.on('ready', ()=>{
				serial._emitter.removeAllListeners('ready');
				modem.send.at_command("ID").then((bytes) => {
					pan_id = (bytes.data[0] << 8) | bytes.data[1];
					serial.close();
					delete gateway_pool[port];
					res.json({pan_id: pan_id.toString(16)});
				}).catch((err) => {
					console.log(err);
					serial.close();
					delete gateway_pool[port];
					res.json(false);
				});
			});
		}else if(gateway_pool[port].pan_id){
			res.json({pan_id: gateway_pool[port].pan_id.toString(16)});
		}else{
			res.json({error: "no network ID"});
		}
	});
	RED.httpAdmin.get("/ncd/wireless/sensors/list/:id", RED.auth.needsPermission('serial.read'), function(req,res) {
		var node = RED.nodes.getNode(req.params.id);
		if (node != null) {
			try {
				var sensors = [];

				for(var i in node.gateway.sensor_pool){
					if(node.sensor_pool.indexOf(node.gateway.sensor_pool[i].mac) > -1) continue;
					sensors.push(node.gateway.sensor_pool[i]);
				}
				res.json(sensors);
			} catch(err) {
				res.sendStatus(500);
				node.error(RED._("sensor_list.failed",{error:err.toString()}));
			}
		} else {
			res.json({});
		}
	});
	RED.httpAdmin.get("/ncd/wireless/needs_input/:id", RED.auth.needsPermission('tcp.read'), function(req,res) {
		var node = RED.nodes.getNode(req.params.id);
		if (node != null) {
			res.json({needs_input: node.raw_input});
			// return {needs_input: node.raw_input};
		} else {
			res.json({needs_input: false});
		}
	});

	function NcdAPIConfigurationNode(config){
		RED.nodes.createNode(this,config);

		this._gateway_node = RED.nodes.getNode(config.connection);

		this._gateway_node.open_comms();
		this.gateway = this._gateway_node.gateway;
		console.log(this.gateway);

		var node = this;

		node.on('close', function(){
			this._gateway_node.close_comms();
		});

		var statuses =[
			{fill:"green",shape:"dot",text:"Ready"},
			{fill:"yellow",shape:"ring",text:"Configuring"},
			{fill:"red",shape:"dot",text:"Failed to Connect"},
			{fill:"green",shape:"ring",text:"Connecting..."}
		];

		// node.set_status = function(){
		// 	node.status(statuses[node._gateway_node.is_config]);
		// };

		node.on('input', function(msg, send, done){
			var response;
			switch(msg.topic){
				case 'set_desired_configs':
					response = this.set_desired_configs(msg.payload);
					send({topic: 'set_desired_configs_ack', payload: response, time: Date.now()});
					// this.set_desired_configs(msg.payload).then((result) => {
					// 	send({topic: 'set_desired_configs', payload: result, time: Date.now()});
					// }).catch((err) => {
					// 	send({topic: 'set_desired_configs', payload: {error: err}, time: Date.now()});
					// });
					break;
				case 'get_sensor_info':
					node.warn(msg);
					send(msg);
					console.log('get_sensor_info');
					break;
				case 'get_all_sensor_info':
					response = this.get_all_sensor_info();
					send({topic: 'get_all_sensor_info_ack', payload: response, time: Date.now()});
					break;
				case 'get_sensor_list':
					node.warn(msg);
					break;
				case 'reset_sensor_desired_configs':
					if(!Array.isArray(msg.payload)){
						done('Payload must be an array of sensor addresses to clear desired configs');
					}else{
						this.reset_desired_configs(msg.payload);
					}
					send({topic: 'reset_sensor_desired_configs_ack', payload: node._gateway_node.sensor_configs, time: Date.now()});
					break;
			case 'sensor_config_options':
				// TODO move logic to function
				if(typeof msg.payload == 'number' && Object.hasOwn(node._gateway_node.sensor_type_map, msg.payload)){
					let options = this.get_config_options(msg.payload);
					send({topic: 'sensor_config_options_ack', payload: options, time: Date.now()});
				}else{
					send({topic: "config_node_error", payload:'get_config_options error: Payload must be a valid sensor type number'});
				}
				break;
				default:
					console.log('DEFAULT');
			};
			done();
		});
		
		this.reset_desired_configs = function(sensor_array){
			let store_flag = false;
			for (let addr of sensor_array){
				addr = addr.toLowerCase();
				if(Object.hasOwn(node._gateway_node.sensor_configs, addr) && Object.hasOwn(node._gateway_node.sensor_configs[addr], 'desired_configs')){
					node._gateway_node.sensor_configs[addr].desired_configs = node._gateway_node.sensor_configs[addr].reported_configs;
					delete node._gateway_node.sensor_configs[addr].api_config_override;
					store_flag = true;
				}
			};
			if(store_flag) node._gateway_node.store_sensor_configs(JSON.stringify(node._gateway_node.sensor_configs));		
		};

		this.get_config_options = function(sensor_type){
			if(Object.hasOwn(node._gateway_node.sensor_type_map, sensor_type)){
				const config_list = node._gateway_node.sensor_type_map[sensor_type].configs;
				let response = {};
				for (const key in config_list){
					const info = node._gateway_node.configuration_map[config_list[key]];
					response[key] = {
						title: info.title,
						default_value: info.default_value,
					};
					if(Object.hasOwn(info, 'validator') && Object.hasOwn(info.validator, 'type')){
						response[key].value_type = info.validator.type;
					}
					if(Object.hasOwn(info, 'options')){
						response[key].options = info.options;
					}else{
						if(Object.hasOwn(info, 'validator') && Object.hasOwn(info.validator, 'min')){
							response[key].minimum_value = info.validator.min;
						}
						if(Object.hasOwn(info, 'validator') && Object.hasOwn(info.validator, 'max')){
							response[key].maximum_value = info.validator.max;
						}
					}
					// node.warn(info);
				}
				return response;
			}else{
				return 'Invalid sensor type';
			}
		};

		this.set_desired_configs = function(desired_configs){
			var _requires_file_update = false;
			var response = {};
			for (const sensor of desired_configs){
				// Force lowercase for consistency
				sensor.addr = sensor.addr.toLowerCase();

				// TODO validate sensor object
				// must have sensor.addr, sensor.type, sensor.configs
				// sensor.configs is an object with key value pairs of config name and desired value
				if(!Object.hasOwn(sensor, 'addr') || !Object.hasOwn(sensor, 'type') || !Object.hasOwn(sensor, 'configs')){
					// throw new Error('Invalid sensor object, must have addr, type, and configs properties');
					return {error: 'Invalid sensor object, must have addr, type, and configs properties'};
				};
				sensor.addr = sensor.addr.toLowerCase();
				if(!Object.hasOwn(node._gateway_node.sensor_configs, sensor.addr) || !Object.hasOwn(node._gateway_node.sensor_configs[sensor.addr], 'desired_configs')){
					node._gateway_node.sensor_configs[sensor.addr] = {
						desired_configs: {}
					};
				};
				if(Object.hasOwn(node._gateway_node.sensor_configs[sensor.addr], 'type')){
					// TODO validate that type matches
				}else{
					node._gateway_node.sensor_configs[sensor.addr].type = sensor.type;
					_requires_file_update = true;
				}
				// force everything lowercase for consistency
				for (const key in sensor.configs){
					if(typeof sensor.configs[key] == 'string'){
						sensor.configs[key] = sensor.configs[key].toLowerCase();
					}
				}
				let new_desired_configs = {...node._gateway_node.sensor_configs[sensor.addr].desired_configs, ...sensor.configs};

				

				// If the desired configs are different than what is already stored we need to update the file
				if(!isDeepStrictEqual(node._gateway_node.sensor_configs[sensor.addr].desired_configs, new_desired_configs)){
					console.log('Configs differ, updating desired configs');
					node._gateway_node.sensor_configs[sensor.addr].desired_configs = {...node._gateway_node.sensor_configs[sensor.addr].desired_configs, ...sensor.configs};
					_requires_file_update = true;
				}else{
					console.log('Configs the same, not updating desired configs');
				};
				if(!Object.hasOwn(node._gateway_node.sensor_configs[sensor.addr], 'api_config_override')){
					node._gateway_node.sensor_configs[sensor.addr].api_config_override = true;
					_requires_file_update = true;
				}
				response[sensor.addr] = node._gateway_node.sensor_configs[sensor.addr];
			}
			if(_requires_file_update){
				node._gateway_node.store_sensor_configs(JSON.stringify(node._gateway_node.sensor_configs));
			}
			return response;
			// return node._gateway_node.sensor_configs;
		};

		node.gateway.on('sensor_mode', (d) => {
			if(d.mode == 'FLY' && Object.hasOwn(node._gateway_node.sensor_configs, d.mac) && Object.hasOwn(node._gateway_node.sensor_configs[d.mac], 'api_config_override')){
				// node.send({topic: 'sensor_mode', payload: d, time: Date.now()});
				// if(){
				node.send({topic: 'sensor_report', payload: node._gateway_node.sensor_configs[d.mac], addr: d.mac, time: Date.now()});
				node.warn('TODO Should we output messages even if the API node is not in charge of the sensor?');
				// };
			};
			// if(d.mode == 'OTN'){
			// 	node.send({topic: 'sensor_mode', payload: d, time: Date.now()});
			// };
		});

		node._gateway_node.on('config_node_msg', (d) => {
			node.send(d);
		});
		node._gateway_node.on('config_node_error', (d) => {
			node.send(d);
		});

		node.on('close', (done) => {
			node._gateway_node.removeAllListeners('config_node_msg');
			node._gateway_node.removeAllListeners('config_node_error');
			node._gateway_node.removeAllListeners('sensor_mode');
			done();
		});

		
		this.get_all_sensor_info = function(){
			return node._gateway_node.sensor_configs;
		};

		// node.gateway.on('sensor_data', (d) => {
		// 	node.set_status();
		// 	node.send({topic: 'sensor_data', payload: d, time: Date.now()});
		// });
		// node.gateway.on('sensor_mode', (d) => {
		// 	node.set_status();
		// 	node.send({topic: 'sensor_mode', payload: d, time: Date.now()});
		// });
		// node.gateway.on('receive_packet-unknown_device',(d)=>{
		// 	node.set_status();
		// 	msg1 = {topic:'somethingTopic',payload:"something"};
		// 	node.send([null,{topic: 'unknown_data', payload:d, time: Date.now()}]);
		// });
		// node._gateway_node.on('mode_change', (mode) => {
		// 	node.set_status();
		// 	if(this.gateway.modem_mac && this._gateway_node.is_config == 0 || this.gateway.modem_mac && this._gateway_node.is_config == 1){
		// 		node.send({topic: 'modem_mac', payload: this.gateway.modem_mac, time: Date.now()});
		// 	}else{
		// 		node.send({topic: 'error', payload: {code: 1, description: 'Wireless module did not respond'}, time: Date.now()});
		// 	}
		// });
	};
	// register a new node called ncd-api-config
	RED.nodes.registerType("ncd-api-configuration-node", NcdAPIConfigurationNode);
};
function getSerialDevices(ftdi, res){
	var busses = [];
	sp.list().then((ports) => {
		ports.forEach((p) => {
			busses.push(p.path);
		});
	}).catch((err) => {

	}).then(() => {
		res.json(busses);
	});
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
function string2HexArray(hexString) {
	if (typeof hexString !== 'string') {
		console.error('Input must be a string.');
		return undefined;
	}

	const cleanedHexString = hexString.replace(/:/g, ''); //Remove colons.

	if (cleanedHexString.length % 2 !== 0) {
		console.error('Hex string length must be divisible by two.');
		return undefined;
	}

	let byteArray = [];
	for (let i = 0; i < cleanedHexString.length; i += 2) {
		const byte = cleanedHexString.substring(i, i + 2);
		const byteValue = parseInt(byte, 16);
		if (isNaN(byteValue)) {
			console.error("Invalid hex character in string");
			return undefined;
		}
		byteArray.push(byteValue);
	}
	return byteArray;
}
function toHex(n){return ('00' + n.toString(16)).substr(-2);}
function toMac(arr){
	return arr.reduce((h,c,i) => {return ((i==1?toHex(h):h)+':'+toHex(c)).toUpperCase();});
}
function msbLsb(m,l){return (m<<8)+l;};
