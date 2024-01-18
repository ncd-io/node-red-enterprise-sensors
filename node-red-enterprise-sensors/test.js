const NCD = require('./index.js');
const comm = require('ncd-red-comm');

const Queue = require('promise-queue');

var serial = new comm.NcdSerial('/dev/tty.usbserial-AL00EXTB', 115200);
var modem = new NCD.Modem(serial);

var gateway = new NCD.Gateway(modem);

// modem.send.at_command('ID').then((res) => {
// 	console.log('Network ID: '+res.data.map((v) => v.toString(16)).join(''))
// 	modem.send.at_command('HP').then((res) => {
// 		console.log(res);
// 		//console.log('Network ID: '+res.data.map((v) => v.toString(16)).join(''));
// 	});
// });

function toHex(n){return ('00' + n.toString(16)).substr(-2);}

function toMac(arr){
	return arr.reduce((h,c,i) => {return (i==1?toHex(h):h)+':'+toHex(c);});
}
function mac2bytes(mac){
	return mac.split(':').map((v) => parseInt(v, 16));
}

//gateway.control_send("00:00:00:00:00:00:FF:FF", [247, 4, 2]).then(console.log).catch(console.log);

//gateway.control_send("00:00:00:00:00:00:FF:FF", [247, 0, ...mac2bytes("00:00:00:00:00:00:FF:FF")]).then(console.log).catch(console.log);
//gateway.control_send("00:00:00:00:00:00:FF:FF", [248, 0]).then(console.log).catch(console.log);

gateway.control_send("00:00:00:00:00:00:FF:FF", [247, 1, 0x7F, 0xFF]).then(console.log).catch(console.log);
//modem.send.at_command("ID", [0x7BCD >> 8, 0x7BCD & 255]).then(console.log).catch(console.log);
// gateway.control_send("00:00:00:00:00:00:FF:FF", [248, 0]).then(console.log).catch(console.log);
// modem.send.at_command('WR').then((res) => {
// 	console.log(res);
// 	//var SH = res;
// 	// modem.send.at_command('SL').then((res) => {
// 	// 	var
// 	// })
// });


gateway.on('sensor_data', (d) => {
	console.log(d);
});
// 	var type;
// 	if(typeof gateway.sensor_types[d.sensor_type] == 'undefined'){
// 		type = 'unknown';
// 		console.log(d);
// 	}
// 	else type = gateway.sensor_types[d.sensor_type].name;
// 	console.log('Incoming data -------------------');
// 	console.log('Type: '+type);
// 	console.log('Address: '+d.addr);
// 	console.log('Readings: ');
// 	for(var i in d.sensor_data) console.log(`	${i}: ${d.sensor_data[i]}`);
// 	console.log('---------------------------------')
// });
// var config_queue = new Queue(1);
// gateway.on('sensor_mode', (sensor) => {
// 	var mac = sensor.mac;
// 	console.log(sensor);
// 	if(sensor.mode == 'PGM'){
// 		config_queue.add(() => {
// 			return new Promise((fulfill) => {
// 				setTimeout(fulfill, 1000);
// 			});
// 		});
// 		config_queue.add(() => {
// 			return new Promise((fulfill, reject) => {
// 				console.log('Getting Destination:');
// 				gateway.config_get_destination(mac).then((res) => {
// 					console.log(res);
// 				}).catch((err) => {
// 					console.log(err);
// 				}).then(fulfill);
// 			});
// 		});
// 		config_queue.add(() => {
// 			return new Promise((fulfill, reject) => {
// 				console.log('Getting Delay:');
// 				gateway.config_get_delay(mac).then((res) => {
// 					console.log(res);
// 				}).catch((err) => {
// 					console.log(err);
// 				}).then(fulfill);
// 			});
// 		});
// 		config_queue.add(() => {
// 			return new Promise((fulfill, reject) => {
// 				console.log('Getting Power:');
// 				gateway.config_get_power(mac).then((res) => {
// 					console.log(res);
// 				}).catch((err) => {
// 					console.log(err);
// 				}).then(fulfill);
// 			});
// 		});
// 		config_queue.add(() => {
// 			return new Promise((fulfill, reject) => {
// 				console.log('Getting Retries:');
// 				gateway.config_get_retries(mac).then((res) => {
// 					console.log(res);
// 				}).catch((err) => {
// 					console.log(err);
// 				}).then(fulfill);
// 			});
// 		});
// 		config_queue.add(() => {
// 			return new Promise((fulfill, reject) => {
// 				console.log('Getting Network ID:');
// 				gateway.config_get_pan_id(mac).then((res) => {
// 					console.log(res);
// 				}).catch((err) => {
// 					console.log(err);
// 				}).then(fulfill);
// 			});
// 		});
// 	}
// });
