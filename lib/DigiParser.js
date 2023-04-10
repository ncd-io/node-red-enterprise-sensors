const events = require("events");
module.exports = class DigiComm{
	constructor(serial){
		this.serial = serial;
		this._emitter = new events.EventEmitter();
		this.temp = [];
		this._idCount = 0;
		this._timoutLimit = 5000;
		this.report_rssi = false;
		var that = this;
		function receive(d){
			that.dataIn(d);
		}
		this.serial.on('data', receive);
		this.serial.on('error', (err) => {
			console.log(err);
		});
		this.on('close', () => {
			that._emitter.removeListener('data', receive);
		});
		this.send = new outgoingFrame(this);
		this.frame = new incomingFrame(this);
		this.lastSent = [];
		// this.modem_mac = this.send.at_command('SL');
	}
	close(){
		this._emitter.emit('close');
	}
	getId(){
		if(this._idCount == 255) this._idCount = 0;
		return ++this._idCount;
	}
	dataIn(d){
		if(!this.temp.length && d != 126) return;
		// if(this.temp.length == 0) console.log('starting new buffer');
		//Add incoming byte to buffer
		this.temp.push(d);
		//A valid packet can be no less than 6 bytes (delimiter, lengthMSB, lengthLSB, frameType, [...frame data], checksum);
		if(this.temp.length >= 6){

			//get the reported length and actual length of the frame
			var length = msbLsb(this.temp[1], this.temp[2]);
			var fLength = this.temp.length-4;

			//If the frame length is less than the actual length, we are still waiting for data
			if(length > fLength) return;

			//If the lengths match, we have a full packet
			if(length == fLength){

				//If the checksum matches, parse the packet
				if(this.checksum(this.temp.slice(3,-1)) == this.temp[this.temp.length-1]){
					var frame = this.frame.parse(this.temp);
					if(frame.mac) frame.mac = frame.mac.toLowerCase();
					//If the frame has an ID, send it as the event name since it's a response
					// console.log(frame);
					var event = typeof frame.id != 'undefined' ? 'digi-response:'+frame.id : frame.type;
					//Send out the incoming frame to anyone listening for specific event
					// console.log('event: '+event);
					// console.log(frame);
					this._emitter.emit(event, frame);
					// console.log('data frame: '+this.temp);
					// console.log(frame);
					//Send out the frame to everyone listening to a general call
					this._emitter.emit('digi_frame', frame);
					//If the checksum didn't match, emit an error
				}else{
					console.log('checksum error');
					this._emitter.emit('checksum_error', this.temp);
					//console.log({'checksum error': this.temp});
				}

				//If the buffer is longer than it should be, send an overflow error
			}else{
				this._emitter.emit('overflow_error', this.temp);
				console.log({'overflow error': this.temp});
			}
			//If we are here the buffer should be reset one way or another
			// console.log({
			// 	incoming_raw: this.temp
			// });
			//console.log(this.temp);
			this.temp = [];
		}
	}

	checksum(data){
		return (255 - (data.reduce((t, n) => t+n) & 255));
	}

	_send(frame, expected){
		// console.log('frame in _send function: '+frame);
		// console.log('frame length is: '+frame.length);
		var that = this;
		if(!expected) expected = 1;
		var awaiting = expected;
		return new Promise((fulfill, reject) => {
			var packet = [126, (frame.length >> 8), (frame.length & 255)];
			packet.push(...frame);
			packet.push(this.checksum(frame));
			var event = 'digi-response:'+frame[1];
			var response = [];
			var tOut = setTimeout(() => {
				that._emitter.removeAllListeners(event);
				reject({error: 'Request timed out without response', original: frame});
			}, that._timoutLimit);
			that.on(event, (frame) => {
				clearTimeout(tOut);
				awaiting -= 1;
				if(awaiting == 0) that._emitter.removeAllListeners(event);
				if(expected == 1) fulfill(frame);
				else{
					response.push(frame);
					fulfill(response);
				}
			});
			// These console.log entries are to display timing and raw packets
			// console.log('-------------------------------');
			// console.log('#otf: /lib/DigiParser.js');
			// console.log('send Frame', packet);
			// console.log('epoch', new Date().getTime());
			that.serial.write(packet, (err) => {
				that.lastSent = packet;
				if(err){
					console.log(err);
				}
			});
		});


		//send data!
	}
	on(a,b){ this._emitter.on(a,b); }
};
class outgoingFrame{
	constructor(master){
		this.master = master;
	}
	at_command(command, param, queue, expected){
		var frame = [queue ? 9 : 8, this.master.getId()];
		if(!expected) expected = 1;
		for(var i=0;i<command.length;i++) frame.push(command.charCodeAt(i));
		if(typeof param == 'undefined') return this.master._send(frame, expected);
		if(param.constructor != Array) param = [param];
		frame.push(...param);
		return this.master._send(frame, expected);
	}
	remote_at_command(mac, command, param, apply){
		var frame = [23, this.master.getId()];
		frame.push(...mac);
		frame.push(255, 254);
		frame.push(apply ? 2 : 0);
		for(var i=0;i<command.length;i++) frame.push(command.charCodeAt(i));
		if(typeof param == 'undefined') return this.master._send(frame);
		if(param.constructor != Array) param = [param];
		frame.push(...param);
		return this.master._send(frame);
	}
	//For broadcast, set mac to [0,0,0,0,0,0,255,255]
	transmit_request(mac, data, opts){
		var config = this.transmissionOptions(opts);
		var frame = [16, this.master.getId()];
		frame = frame.concat(mac);
		var conf = [255, 254, (config >> 8), (config & 255)];
		frame = frame.concat(conf);
		// if(data.constructor != Array) data = [data];
		frame = frame.concat(data);
		frame.length = 2+mac.length+conf.length+data.length;
		return this.master._send(frame);
	}
	explicit_addressing_command(mac, source, destination, cluster, profile, data, opts){
		var config = this.transmissionOptions(opts);
		var frame = [17, this.master.getId()];
		frame.push(...mac);
		frame.push([255, 254, source, destination, cluster[0], cluster[1], profile[0], profile[1], (config >> 8), (config & 255)]);
		if(data.constructor != Array) data = [data];
		frame.push(...data);
		return this.master._send(frame);
	}
	transmissionOptions(opts){
		var config = Object.assign({
			//Number of allowed hops, 0 = maximum
			rad: 0,
			//1 = Disable ACK
			ack: 0,
			//1 = Disable route discovery
			rd: 0,
			//Enable NACK messages
			nack: 0,
			//Enable Trace Route
			trace: 0,
			//Delivery method - 1 = point_multipoint, 2 = repeater_mode, 3 = digimesh
			method: 3
		}, opts);
		return (config.rad << 8) | (config.ack | (config.rd << 1) | (config.nack << 2) | (config.trace << 3) | (config.method << 6));

	}

}
class incomingFrame{
	constructor(parent){
		this.parent = parent;
		this.frameType = {
			"136": 'at_command_response',
			"138": 'modem_status',
			"139": 'transmit_status',
			"141": 'route_information_packet',
			"142": 'aggregate_addressing_update',
			"144": 'receive_packet',
			"145": 'explicit_rx_indicator',
			"146": 'io_data_sample_indicator',
			"149": 'node_identification_indicator',
			"151": 'remote_command_response'
		};
	}
	parse(data){
		var type = typeof this.frameType[data[3]] == 'undefined' ? 'unknown' : this.frameType[data[3]];
		if(typeof this[type] == 'function'){
			var frame = this[type](data.slice(4, -1));
			frame.type = type;
		}
		return frame;
	}

	//Parse frame methods
	at_command_response(frame){
		return {
			id: frame[0],
			command: String.fromCharCode(frame[1])+String.fromCharCode(frame[2]),
			status: (['OK', 'ERROR', 'Invalid Command', 'Invalid Parameter', 'Tx Failure'])[frame[3] & 7],
			data: frame.length > 4 ? frame.slice(4) : false,
			hasError: (frame[3] > 0)
		};
	}
	modem_status(frame){
		return ({"0":{type: "Hardware reset"}, "1": {type: "Watchdog timer reset"}, "11": {type: "Network woke up"}, "12": {type: "Network went to sleep"}})[frame[0]];
	}
	transmit_status(frame){
		return {
			id: frame[0],
			address: frame.slice(1, 3),
			retries: frame[3],
			delivery_status: this.deliveryStatus(frame[4]),
			discovery_status: frame[5] == 0 ? "No discovery overhead" : "Route discovery",
			hasError: (frame[5] != 0)
		};
	}
	route_information_packet(frame){
		return {
			source_event: frame[0] == 17 ? "NACK" : "Trace route",
			format: frame[1],
			timestamp: frame.slice(2, 6).reduce(msbLsb),
			ack_timouts: frame[6],
			tx_blocked: frame[7],
			destination_mac: toMac(frame.slice(9, 17)),
			source_mac: toMac(frame.slice(17, 25)),
			responder_mac: toMac(frame.slice(25, 33)),
			receiver_mac: toMac(frame.slice(33, 41)),
		};
	}
	aggregate_addressing_update(frame){
		return {
			format: frame[0],
			new_address: toMac(frame.slice(1, 9)),
			old_address: toMac(frame.slice(9, 17))
		};
	}
	receive_packet(frame){
		var ret = {
			mac: toMac(frame.slice(0, 8)),
			receive_options: this.receiveOptions(frame[10]),
			data: frame.slice(11)
		};
		if(this.parent.report_rssi) ret.rssi = this.parent.send.at_command('DB');
		return ret;
	}
	explicit_rx_indicator(frame){
		return {
			source_mac: toMac(frame.slice(0, 8)),
			source_endpoint: frame[10],
			destination_endpoint: frame[11],
			cluster_id: frame.slice(12, 14),
			profile_id: frame.slice(14, 16),
			receive_options: this.receiveOptions(frame[16]),
			data: frame.slice(17)
		};
	}
	io_data_sample_indicator(frame){
		return {
			source_mac: toMac(frame.slice(0, 8)),
			source_addr: frame.slice(8, 10).reduce(msbLsb),
			receive_options: this.receiveOptions(frame[10] & 3),
			sample_count: frame[11],
			digital_pins: frame.slice(12, 14).reduce(msbLsb),
			analog_pins: frame[14],
			digital_samples: frame.slice(15, 17).reduce(msbLsb),
			analog_samples: chunk(frame.slice(17), 2).map((i) => msbLsb(i[0], i[1]))
		};
	}
	node_identification_indicator(frame){
		var packet = {
			source_mac: toMac(frame.slice(0, 8)),
			receive_options: this.receiveOptions(frame[10]),
			remote_mac: toMac(frame.slice(13, 21)),
			node_id: frame.slice(21, 23),
			device_type: frame[25] ? (frame[25] == 1 ? "Normal Mode" : "End Device") : "Coordinator",
			source_event: frame[26],
			digi_profile: frame.slice(27, 29),
			digi_manufacturer: frame.slice(29, 31)
		};
		if(frame.length > 33) packet.digi_dd = frame.slice(31, 35);
		if(frame.length > 34) packet.rssi = frame[35];
		return packet;
	}
	remote_command_response(frame){
		return {
			id: frame[0],
			remote_mac: toMac(frame.slice(1, 9)),
			command: String.fromCharCode(frame[11])+String.fromCharCode(frame[12]),
			status: (['OK', 'ERROR', 'Invalid Command', 'Invalid Parameter', 'Tx Failure'])[frame[13] & 7],
			data: frame.slice(14)
		};
	}
	deliveryStatus(status){
		return ({
			"0": "Success",
			"1": "MAC ACK failure",
			"2": "Collision avoidance failure",
			"33": "Network ACK failure",
			"37": "Route not found",
			"49": "Internal resource error",
			"50": "Internal error",
			"116": "Payload too large",
			"117": "Indirect message requested"
		})[status];
	}
	receiveOptions(byte){
		return {
			ack: (byte & 1 == 1),
			broadcast: (byte & 2 == 2),
			type: (byte & 192 == 192) ? "DigiMesh" : ((byte & 128 == 128) ? "Repeater Mode" : ((byte & 64 == 64) ? "Point-Multipoint" :  ""))
		};
	}
}
function msbLsb(m,l){return (m<<8)+l;}
function toHex(n){return ("00" + n.toString(16)).substr(-2);}

function toMac(arr){
	return arr.reduce((h,c,i) => {return (i==1?toHex(h):h)+':'+toHex(c);});
}
function chunk(a, l){
	var arr = [];
	for(i=0;i<a.length;i+=l){
		arr.push(this.slice(i, i+l));
	}
	return arr;
}
