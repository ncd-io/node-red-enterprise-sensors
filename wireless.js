const wireless = require("./index.js");
const comms = require('ncd-red-comm');
const sp = require('serialport');
const Queue = require("promise-queue");
const events = require("events");
const fs = require('fs');
const home_dir = require('os').homedir
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

		if(config.comm_type == 'serial'){
			this.key = config.port;
		}
		else{
			this.key = config.ip_address+":"+config.tcp_port;
		}

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
					var comm = new comms.NcdTCP(config.ip_address, this.port);
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
					setTimeout(()=>{node.gateway.digi.serial.setupSerial()}, 5000);
				}else{
					setTimeout(()=>{node.gateway.digi.serial.setupClient()}, 5000);
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
							if(d.mode == "FLY"){
								if(Object.hasOwn(node.sensor_list, d.mac) && Object.hasOwn(node.sensor_list[d.mac], 'update_request')){
									node.request_manifest(d.mac);
								};
							};
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
										promises[name].then((f) => {
											if(name != 'finish'){
												console.log(name);
											}
											else{
												// enter ota mode
												node.gateway.digi.send.at_command("ID", [0x7a, 0xaa]).then().catch().then(() => {
													node.start_firmware_update(manifest_data, firmware_data);
												});
											}
										}).catch((err) => {
											console.log(err);
											// msg[name] = err;
										});
									})(i);
								}
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
					// node.gateway.digi.serial.close(() => {
					delete gateway_pool[this.key];
					// });
				}else{
					node.gateway.digi.serial.close();
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
							node.send({topic: 'Command Results', payload: 'Automatic Luber '+msg.payload.channel+' Activation Complete', time: Date.now(), addr: msg.payload.address});
						}).catch((err) => {
							node.send({topic: 'Command Error', payload: err});
						});
					}else{
						node.gateway.control_start_luber(msg.payload.address, 1, msg.payload.duration).then((f) => {
							node.send({topic: 'Command Results', payload: 'Automatic Luber Activation Complete', time: Date.now(), addr: msg.payload.address});
						}).catch((err) => {
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
						if(!Object.hasOwn(node._gateway_node.sensor_list, msg.payload.address)){
							node._gateway_node.sensor_list[address] = {};
						};
						if(!Object.hasOwn(node._gateway_node.sensor_list[msg.payload.address], 'update_request')){
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
			OTF: {fill:"green",shape:"dot",text:"OTF Received, Config Complete"}
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
					let original_otf_devices = [53, 80, 81, 82, 83, 84, 101, 102, 180, 181, 518, 519, 520, 538];
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
						var change_detection = [13, 10, 3];
						if(change_detection.indexOf(sensor.type) > -1){
							promises.change_detection = node.config_gateway.config_set_change_detection(mac, config.change_enabled ? 1 : 0, parseInt(config.change_pr), parseInt(config.change_interval));
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
							case 13:
								var cali = parseFloat(config.cm_calibration);
								if(cali == 0) break;
								promises.calibration = node.config_gateway.config_set_cm_calibration(mac, cali);
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
								break;
							case 23:
								if(config.thermocouple_type_23_active){
									promises.thermocouple_type_23 = node.config_gateway.config_set_thermocouple_type_23(mac, parseInt(config.thermocouple_type_23));
								}
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
							case 35:
								if(config.counter_threshold_35_active){
									promises.config_set_counter_threshold_35 = node.config_gateway.config_set_counter_threshold_35(mac, parseInt(config.counter_threshold_35));
								}
								break;
							case 36:
								if(config.counter_threshold_35_active){
									promises.config_set_counter_threshold_35 = node.config_gateway.config_set_counter_threshold_35(mac, parseInt(config.counter_threshold_35));
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
								break;
							case 56:
								if(config.sensor_boot_time_420ma_active){
									promises.sensor_boot_time_420ma = node.config_gateway.config_set_sensor_boot_time_420ma(mac, parseInt(config.sensor_boot_time_420ma));
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
							case 78:
								if(config.sensor_boot_time_78_active){
									promises.sensor_boot_time_78 = node.config_gateway.config_set_sensor_boot_time_78(mac, parseInt(config.sensor_boot_time_78));
								}
							case 79:
								if(config.sensor_boot_time_78_active){
									promises.sensor_boot_time_78 = node.config_gateway.config_set_sensor_boot_time_78(mac, parseInt(config.sensor_boot_time_78));
								}
							case 80:
								if(config.current_calibration_c1_80_active){
									promises.current_calibration_c1_80 = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c1_80), 1);
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
							case 81:
								if(config.current_calibration_c1_80_active){
									promises.current_calibration_c1_80_active = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c1_80), 1);
								}
								if(config.current_calibration_c2_80_active){
									promises.current_calibration_c2_80 = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c2_80), 3);
								}
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
								break;
							case 91:
								if(config.sensor_boot_time_78_active){
									promises.sensor_boot_time_78 = node.config_gateway.config_set_sensor_boot_time_78(mac, parseInt(config.sensor_boot_time_78));
								}
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
								break;
							case 108:
								if(config.accelerometer_state_108_active){
									promises.accelerometer_state_108 = node.config_gateway.config_set_accelerometer_state_108(mac, parseInt(config.accelerometer_state_108));
								}
								if(config.clear_all_counters_108){
									promises.clear_all_counters_108 = node.config_gateway.config_clear_timers_108(mac);
								}
								if(config.accelerometer_threshold_108_active){
									promises.accelerometer_threshold_108 = node.config_gateway.config_set_accelerometer_threshold_108(mac, parseInt(config.accelerometer_threshold_108));
								}
								if(config.debounce_time_108_active){
									promises.debounce_time_108 = node.config_gateway.config_set_debounce_time_108(mac, parseInt(config.debounce_time_108));
								}
								break;
							case 110:
								if(config.current_calibration_c1_80_active){
									promises.current_calibration_c1_80 = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c1_80), 1);
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
								if(config.sampling_interval_101_active){
									promises.sampling_interval_101 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_101));
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
								if(config.auto_raw_interval_110_active){
									promises.auto_raw_interval_110 = node.config_gateway.config_set_auto_raw_interval_110(mac, parseInt(config.auto_raw_interval_110));
								}
								if(config.auto_raw_destination_110_active){
									promises.auto_raw_destination_110 = node.config_gateway.config_set_auto_raw_destination_110(mac, parseInt(config.auto_raw_destination_110));
								}
								if(config.clear_probe_uptimers_110_active){
									promises.clear_probe_uptimers_110 = node.config_gateway.config_set_clear_probe_uptimers_110(mac, parseInt(config.clear_probe_uptimers_110));
								}
								if(config.smart_interval_110_active){
									promises.smart_interval_110 = node.config_gateway.config_set_smart_interval_110(mac, parseInt(config.smart_interval_110));
								}
								if(config.smart_threshold_110_active){
									promises.smart_threshold_110 = node.config_gateway.config_set_smart_threshold_110(mac, parseInt(config.smart_threshold_110));
								}
								break;
							case 111:
								if(config.current_calibration_c1_80_active){
									promises.current_calibration_c1_80_active = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c1_80), 1);
								}
								if(config.current_calibration_c2_80_active){
									promises.current_calibration_c2_80 = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c2_80), 3);
								}
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
								if(config.mode_110_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_110));
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
								if(config.auto_raw_interval_110_active){
									promises.auto_raw_interval_110 = node.config_gateway.config_set_auto_raw_interval_110(mac, parseInt(config.auto_raw_interval_110));
								}
								if(config.auto_raw_destination_110_active){
									promises.auto_raw_destination_110 = node.config_gateway.config_set_auto_raw_destination_110(mac, parseInt(config.auto_raw_destination_110));
								}
								if(config.clear_probe_uptimers_110_active){
									promises.clear_probe_uptimers_110 = node.config_gateway.config_set_clear_probe_uptimers_110(mac, parseInt(config.clear_probe_uptimers_110));
								}
								if(config.smart_interval_110_active){
									promises.smart_interval_110 = node.config_gateway.config_set_smart_interval_110(mac, parseInt(config.smart_interval_110));
								}
								if(config.smart_threshold_110_active){
									promises.smart_threshold_110 = node.config_gateway.config_set_smart_threshold_110(mac, parseInt(config.smart_threshold_110));
								}
								break;
							case 112:
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
								if(config.sampling_interval_101_active){
									promises.sampling_interval_101 = node.config_gateway.config_set_sampling_interval_101(mac, parseInt(config.sampling_interval_101));
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
								if(config.auto_raw_interval_110_active){
									promises.auto_raw_interval_110 = node.config_gateway.config_set_auto_raw_interval_110(mac, parseInt(config.auto_raw_interval_110));
								}
								if(config.auto_raw_destination_110_active){
									promises.auto_raw_destination_110 = node.config_gateway.config_set_auto_raw_destination_110(mac, parseInt(config.auto_raw_destination_110));
								}
								if(config.clear_probe_uptimers_110_active){
									promises.clear_probe_uptimers_110 = node.config_gateway.config_set_clear_probe_uptimers_110(mac, parseInt(config.clear_probe_uptimers_110));
								}
								if(config.smart_interval_110_active){
									promises.smart_interval_110 = node.config_gateway.config_set_smart_interval_110(mac, parseInt(config.smart_interval_110));
								}
								if(config.smart_threshold_110_active){
									promises.smart_threshold_110 = node.config_gateway.config_set_smart_threshold_110(mac, parseInt(config.smart_threshold_110));
								}
								break;
							case 114:
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
								if(config.mode_110_active){
									promises.mode = node.config_gateway.config_set_operation_mode_80(mac, parseInt(config.mode_110));
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
								if(config.auto_raw_interval_110_active){
									promises.auto_raw_interval_110 = node.config_gateway.config_set_auto_raw_interval_110(mac, parseInt(config.auto_raw_interval_110));
								}
								if(config.auto_raw_destination_110_active){
									promises.auto_raw_destination_110 = node.config_gateway.config_set_auto_raw_destination_110(mac, parseInt(config.auto_raw_destination_110));
								}
								if(config.clear_probe_uptimers_110_active){
									promises.clear_probe_uptimers_110 = node.config_gateway.config_set_clear_probe_uptimers_110(mac, parseInt(config.clear_probe_uptimers_110));
								}
								if(config.smart_interval_110_active){
									promises.smart_interval_110 = node.config_gateway.config_set_smart_interval_110(mac, parseInt(config.smart_interval_110));
								}
								if(config.smart_threshold_110_active){
									promises.smart_threshold_110 = node.config_gateway.config_set_smart_threshold_110(mac, parseInt(config.smart_threshold_110));
								}
								break;
							case 180:
								if(config.current_calibration_c1_80_active){
									promises.current_calibration_c1_80 = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c1_80), 1);
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
								if(config.current_calibration_c1_80_active){
									promises.current_calibration_c1_80_active = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c1_80), 1);
								}
								if(config.current_calibration_c2_80_active){
									promises.current_calibration_c2_80 = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c2_80), 3);
								}
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
							case 535:
								if(config.force_calibration_co2_535_active){
									promises.force_calibration_co2_535 = node.config_gateway.config_set_sensor_forced_calibration_535(mac);
								}
								if(config.temperature_offset_44_active){
									promises.temperature_offset_44 = node.config_gateway.config_set_sensor_temperature_offset_44(mac, parseInt(config.temperature_offset_44));
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
								if(config.current_calibration_c1_80_active){
									promises.current_calibration_c1_80 = node.config_gateway.config_set_current_calibration_individual_80(mac, parseInt(config.current_calibration_c1_80), 1);
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
								break;
						}
					}
					// These sensors listed in original_otf_devices use a different OTF code.
					let original_otf_devices = [53, 80, 81, 82, 83, 84, 101, 102, 180, 181, 518, 519, 520, 538];
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
								if(name != 'finish') success[name] = true;
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
					var tout = setTimeout(() => {
						_send_otn_request(sensor);
					}, 100);
				}else if(config.auto_config && config.on_the_fly_enable && sensor.mode == "OTN"){
					if(config.sensor_type == 101 || config.sensor_type == 102){
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
					}else{
						_config(sensor, true);
					}
				} else if(config.sensor_type == 101 && sensor.mode == "FLY" || config.sensor_type == 102 && sensor.mode == "FLY"){
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
						var tout = setTimeout(() => {
							_send_otn_request(sensor);
						}, 100);
					}else if(config.auto_config && config.on_the_fly_enable && sensor.mode == "OTN"){
						if(config.sensor_type == 101 || config.sensor_type == 102){
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
						}else{
							_config(sensor, true);
						}

					}else if(sensor.mode == "FLY" && config.sensor_type == 101 || sensor.mode == "FLY" &&  config.sensor_type == 102){
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
				}
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
				node.config_gateway_node.close_comms();
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
function toHex(n){return ('00' + n.toString(16)).substr(-2);}
function toMac(arr){
	return arr.reduce((h,c,i) => {return ((i==1?toHex(h):h)+':'+toHex(c)).toUpperCase();});
}
function msbLsb(m,l){return (m<<8)+l;};
