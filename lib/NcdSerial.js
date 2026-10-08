const events = require("events");
const { SerialPort } = require('serialport');

module.exports = class NcdSerial{
	constructor(port, baudRate){
		this.port = port;
		this.baudRate = baudRate;
		this._emitter = new events.EventEmitter();
		this.tout = null;
		this.serialReconnectTime = 5000;
		this._available = false;
		this._closing = false;
	}
	reconnect(){
		var obj = this;
		if(this._available){
			this.close();
		}else{
			if(this._closing == false){
				this.setupSerial();
			}
		}
	}
	setupSerial(){
		var obj = this;
		obj._closing = false;

		this.serial = new SerialPort({
			path: this.port,
			baudRate: this.baudRate,
			autoOpen: false
		});

		this.serial.on('error', function(err) {
			console.log(err);
		});
		this.serial.on('open',function() {
			obj._closing = false;
			obj._available = true;
			if (obj.tout) { clearTimeout(obj.tout); }
			obj._emitter.emit('ready');
		});
		this.serial.on('data',function(d) {
			for (var z=0; z<d.length; z++) {
				obj._emitter.emit('data',d[z]);
			}
		});
		this.serial.on('close', function(err){
			if(err){
				console.log(err);
				obj._available = false;
				obj._emitter.emit('closed_comms');
				obj.reconnect();
			}
		});
		this.serial.open((err) => {
			if(err){
				console.log(err);
				obj.tout = setTimeout(function() {
					obj.setupSerial();
				}, obj.serialReconnectTime);
			}
		});
	}
	static list(){
		return SerialPort.list();
	}
	on(a,b){ this._emitter.on(a,b); }
	close(cb){
		this._closing = true;
		if(this._available){
			this.serial.close();
		}
		this._available = false;
	}
	write(m,cb){
		var obj = this;
		if(!this._available){
			this.on('ready', () => {
				obj.serial.write(m, cb);
			});
		}else{
			this.serial.write(m, cb);
		}
	}
};
