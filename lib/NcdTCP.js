const events = require("events");
const net = require("net");

module.exports = class NcdTCP{
	constructor(host, port, crypto, inactive_timeout = 900){
		// console.log('CONSTRUCTOR');
		this.port = port;
		this.host = host;
		this.inactive_timeout = inactive_timeout;
		this._emitter = new events.EventEmitter();
		this.crypto = typeof crypto == 'undefined' ? false : crypto;
		this.tout = null;
		this.tcpReconnectTime = 60;
		this._available = false;
		this._closing = false;
	}

	setCrypto(crypto){
		this.crypto = crypto;
	}

	reconnect(){
		// console.log('RECONNECT');
		var obj = this;
		if(this._available){
			this.close();
		}

		if(this.tout === null){
			// console.log('TOUT NULL');
			obj.tout = setTimeout(function() {
				// console.log('TOUT FIRED');
				obj.tout = null;
				if(!obj._available){
					obj.setupClient();
				}
			}, 1000);
		}
	}
	setupClient(){
		// console.log('SETUPCLIENT');
		var obj = this;
		obj._closing = false;
		if(Object.hasOwn(this, 'client')){
			this.client.destroy();
			// delete this.client;
		}
		this.client = new net.Socket();
		this.client.removeAllListeners('error');
		this.client.removeAllListeners('connect');
		this.client.removeAllListeners('end');
		this.client.removeAllListeners('data');
		this.client.removeAllListeners('close');
		this.client.removeAllListeners('timeout');
		this.client.setNoDelay();

		this.client.on('error', (err) => {
			console.log(err);
		});
		this.client.on('connect', () => {
			obj._closing = false;
			obj._available = true;
			if(obj.tout) clearTimeout(obj.tout);
			obj._emitter.emit('ready');
		});
		// this.client.on('timeout', function(err){
		// 	console.log(err);
		// });
		this.client.on('end', function(err){
			console.log(err);
		});
		this.client.on('data',function(d) {
			for (var z=0; z<d.length; z++) obj._emitter.emit('data',d[z]);
		});
		this.client.on('close', function(msg){
			if(msg){
				obj._available = false;
				obj._emitter.emit('closed_comms');
				obj.reconnect();

			}
		});
		this.buff = [];

		this.client.connect(this.port, this.host);
		this.client.setKeepAlive(true, 0);
		if(this.inactive_timeout){
			this.client.setTimeout(parseInt(this.inactive_timeout*1000));
			this.client.on('timeout', () => {
				console.log('SOCKET TIMED OUT ' + Date.now());
				this.reconnect();
			});
		}

		// TODO forcing a write of empty byte improves reactivity on at least macOS, but still not extremely fast and the method doesn't make a lot of sense.
		// Look to implement in future after additional testing if required.
		// The tcp keepalive interval in nodejs is set via the OS layer interaction following library may allow for this, but may not be worth incompatiblilities
		// https://www.npmjs.com/package/net-keepalive
		// console.log(5000);
		// if(!Object.hasOwn(this, 'test_write')){
		// 	console.log('TESTWRITE INIT SECTION')
		// 	var that = this;
		// 	console.log('-=-=-=-=-=-=-=-=-=-=-');
		// 	console.log(that.inactive_timeout);
		// 	this.test_write = setInterval(function(){
		// 		if(!that._available){
		// 			console.log("not available -----------");
		// 			// clearInterval(that.test_write);
		// 			// delete that.test_write;
		// 			// that.reconnect();
		// 		}
		// 		else{
		// 			// that.write([254]);
		// 			that.write([0]);
		// 			// that.write([]);
		// 			console.log('I guess its available');
		// 		}
		// 	}, that.inactive_timeout);
		// }
		// this.checkState();
	}
	on(a,b){ this._emitter.on(a,b); }
	close(cb){
		// console.log('CLOSE');
		this._closing = true;
		if(this._available){
			this.client.destroy();
			// this.client.resetAndDestroy();
		}
		if(this.tout) clearTimeout(this.tout);
		this._available = false;
	}
	write(m,cb){
		// console.log('WRITE');
		var obj = this;
		if(m.constructor == Array) m = Buffer.from(m);
		if(!this._available){
			this.reconnect();
			var tout = setTimeout(() => {
				this.reconnect();
			}, 500);
			this._emitter.once('ready', () => {
				clearTimeout(tout);
				obj.client.write(m, cb);
			});
		}else{
			obj.client.write(m, cb);
		}
	}
};
