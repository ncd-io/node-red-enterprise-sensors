// Over-the-air firmware update for NCD wireless sensors.
//
// Node-RED-free: takes a WirelessGateway instance and drives the whole update
// for one sensor, so the Node-RED gateway node and any standalone consumer
// (e.g. the Atrium ingest daemon) share one implementation.
//
// Sequence (the sensor must have just woken — call start() from its FLY or
// sync check-in, while it is still listening):
//   1. read the sensor's 37-byte manifest            [245,60]
//   2. check the .ncd file against it (type, hardware id, size)
//   3. put the sensor into OTA mode                  [245,56] → "FON" ack
//   4. move the gateway modem to the OTA PAN ID (0x7AAA)
//   5. send the file's manifest                      [245,58]
//   6. send the image in 128-byte chunks             [245,59, offset(4), data]
//      checking the sensor's received offset every 50 chunks [245,61]
//   7. reboot the sensor                             [247,64]
//   8. restore the gateway's PAN ID (always, including on failure)
//
// While an update runs the modem is on the OTA PAN and hears no other sensor,
// and every send goes through gateway.queue. The caller must not issue other
// radio traffic until start() settles.

const events = require('events');

const OTA_PAN_ID = 0x7AAA;
const CHUNK_SIZE = 128;
const CHECKPOINT_EVERY = 50;
const MANIFEST_LENGTH = 37;
const CHUNK_RETRIES = 3;
const CHUNK_WRITE_DELAY_MS = 140;	// sensor needs this to commit a chunk to flash

function be(bytes){
	let n = 0;
	for(let i = 0; i < bytes.length; i++) n = (n * 256) + bytes[i];
	return n;
}
function int2Bytes(n, len){
	const out = [];
	for(let i = len - 1; i >= 0; i--) out.push(Math.floor(n / Math.pow(256, i)) & 255);
	return out;
}
function hex(bytes){
	return Array.from(bytes, (b) => ('0' + b.toString(16)).slice(-2)).join('');
}
function delay(ms){
	return new Promise((f) => setTimeout(f, ms));
}

// The 37-byte manifest layout shared by the file header and the sensor's reply.
function parseManifestBytes(m){
	return {
		firmware_version: m[0],
		image_start_address: be(m.slice(1, 5)),
		image_size: be(m.slice(5, 9)),
		max_image_size: be(m.slice(9, 13)),
		image_digest: hex(m.slice(13, 29)),
		device_type: be(m.slice(29, 31)),
		hardware_id: Array.from(m.slice(31, 34)),
		hardware_id_hex: hex(m.slice(31, 34)),
		reserve: Array.from(m.slice(34, 37))
	};
}

// .ncd file:  [0x01][manifest_size(4)][manifest(37)][0x02][image_length(4)][image]
// Throws on anything that does not match that layout, so a truncated download
// or a non-firmware file never reaches a sensor.
function parseFirmwareFile(buf){
	const b = Array.prototype.slice.call(buf);
	if(b.length < 47) throw new Error('Firmware file too short');
	if(b[0] !== 0x01) throw new Error('Firmware file has no manifest marker');
	const manifest_size = be(b.slice(1, 5));
	if(manifest_size !== MANIFEST_LENGTH) throw new Error('Unexpected manifest size '+manifest_size);
	const sep = 5 + manifest_size;
	if(b[sep] !== 0x02) throw new Error('Firmware file has no image marker');
	const image_length = be(b.slice(sep + 1, sep + 5));
	const image = b.slice(sep + 5);
	const manifest_bytes = b.slice(5, sep);
	const manifest = parseManifestBytes(manifest_bytes);
	if(image.length !== image_length) throw new Error('Firmware image truncated: expected '+image_length+' bytes, got '+image.length);
	if(manifest.image_size !== image_length) throw new Error('Manifest image size '+manifest.image_size+' does not match image length '+image_length);
	return {manifest, manifest_bytes, image};
}

// Is this file safe to send to the sensor that reported this manifest?
// Different versions in either direction are allowed (downgrades are valid).
function checkCompatibility(sensor, file, opts = {}){
	const fm = file.manifest || file;
	if(fm.device_type !== sensor.device_type){
		return {ok: false, code: 'device_type_mismatch', reason: 'Firmware is for sensor type '+fm.device_type+'; sensor reports type '+sensor.device_type};
	}
	if(fm.hardware_id_hex !== sensor.hardware_id_hex){
		return {ok: false, code: 'hardware_id_mismatch', reason: 'Firmware is for hardware '+fm.hardware_id_hex+'; sensor reports hardware '+sensor.hardware_id_hex};
	}
	if(sensor.max_image_size && fm.image_size > sensor.max_image_size){
		return {ok: false, code: 'image_too_large', reason: 'Image is '+fm.image_size+' bytes; sensor accepts at most '+sensor.max_image_size};
	}
	if(fm.firmware_version === sensor.firmware_version && !opts.allowSameVersion){
		return {ok: false, code: 'same_version', reason: 'Sensor already runs firmware '+sensor.firmware_version};
	}
	return {ok: true};
}

// The sensor's bootloader generation, read from the FON ack, picks the transfer.
function protocolFor(fota_version){
	if(fota_version > 16) return 'v17';
	if(fota_version > 12) return 'v13';
	return 'legacy';
}

class FirmwareUpdate extends events.EventEmitter{
	// opts.panId: the PAN ID to restore afterwards (a number, or a function
	// returning one). Defaults to gateway.pan_id.
	constructor(gateway, opts = {}){
		super();
		this.gateway = gateway;
		this.opts = Object.assign({
			otaPanId: OTA_PAN_ID,
			manifestTimeout: 5000,
			chunkDelay: CHUNK_WRITE_DELAY_MS,
			settleDelay: 1000	// after the PAN switch, before the first send
		}, opts);
		this.active = null;
	}

	get busy(){ return this.active !== null; }

	// Resolves with the parsed manifest of the next 37-byte config_ack from mac.
	requestManifest(mac, timeout = this.opts.manifestTimeout){
		mac = mac.toLowerCase();
		return new Promise((fulfill, reject) => {
			const onManifest = (d) => {
				if((d.addr || '').toLowerCase() !== mac) return;
				clearTimeout(tout);
				this.gateway._emitter.removeListener('manifest_received', onManifest);
				fulfill(parseManifestBytes(d.data));
			};
			const tout = setTimeout(() => {
				this.gateway._emitter.removeListener('manifest_received', onManifest);
				reject(new Error('Sensor did not return its manifest'));
			}, timeout);
			this.gateway._emitter.on('manifest_received', onManifest);
			// The manifest arrives as a config_ack, which the listener above
			// catches; config_send's own promise is only a transport result.
			this.gateway.firmware_request_manifest(mac).catch(() => {});
		});
	}

	// Run a complete update. `firmware` is a Buffer/array of the .ncd file or
	// the result of parseFirmwareFile(). Resolves with a result object and
	// never rejects: failures come back as {ok:false, stage, error}.
	//
	// opts.resumeOffset  byte offset to resume from after an interrupted update —
	//                    pass a failed result's verified_offset
	// opts.allowSameVersion  reflash the version the sensor already runs
	// opts.sensorManifest    skip the manifest read (already have it)
	async start(mac, firmware, opts = {}){
		mac = mac.toLowerCase();
		if(this.active) return {ok: false, addr: mac, stage: 'busy', error: 'An update is already running for '+this.active};
		this.active = mac;
		const started = Date.now();
		const result = {ok: false, addr: mac, stage: 'manifest', started};
		let panChanged = false;
		const step = (stage, extra) => {
			result.stage = stage;
			this.emit('stage', Object.assign({addr: mac, stage}, extra));
		};
		try{
			const file = Array.isArray(firmware.image) ? firmware : parseFirmwareFile(firmware);
			result.target_version = file.manifest.firmware_version;
			result.total = file.image.length;

			step('manifest');
			const sensor = opts.sensorManifest || await this.requestManifest(mac);
			result.sensor_manifest = sensor;
			result.from_version = sensor.firmware_version;
			this.emit('manifest', {addr: mac, manifest: sensor});

			const compat = checkCompatibility(sensor, file, opts);
			if(!compat.ok){
				result.code = compat.code;
				throw new Error(compat.reason);
			}

			step('enter_ota');
			const fon = await this.gateway.firmware_set_to_ota_mode(mac);
			const d = fon && fon.data;
			if(!(d && d[0] === 70 && d[1] === 79 && d[2] === 78 && fon.result === 255)){
				throw new Error('Sensor did not enter OTA mode');
			}
			result.fota_version = fon.original.data[5];
			result.protocol = protocolFor(result.fota_version);

			await this._setPan(this.opts.otaPanId);
			panChanged = true;
			await delay(this.opts.settleDelay);

			let offset = opts.resumeOffset || 0;
			if(result.protocol === 'v17' && offset > 0){
				// v17 bootloaders report where they actually got to; trust that over ours.
				const seg = await this.gateway.firmware_read_last_chunk_segment(mac);
				offset = be(seg.data.slice(4, 8));
			}
			offset = offset - (offset % CHUNK_SIZE);
			if(offset >= file.image.length) offset = 0;

			if(!(result.protocol === 'v17' && offset > 0)){
				step('send_manifest');
				await this.gateway.firmware_send_manifest(mac, file.manifest_bytes);
			}

			step('transfer', {offset, total: result.total, protocol: result.protocol, from_version: result.from_version});
			result.offset = offset;
			result.verified_offset = offset;
			let index = offset / CHUNK_SIZE;
			while(index * CHUNK_SIZE < file.image.length){
				const chunk_offset = index * CHUNK_SIZE;
				const chunk = file.image.slice(chunk_offset, chunk_offset + CHUNK_SIZE);
				await this._sendChunk(mac, result.protocol, chunk_offset, chunk);
				const last = (index + 1) * CHUNK_SIZE >= file.image.length;
				result.offset = Math.min(chunk_offset + CHUNK_SIZE, file.image.length);
				if(result.protocol === 'legacy'){
					result.verified_offset = result.offset;	// every legacy chunk is acknowledged
				}else if(((index + 1) % CHECKPOINT_EVERY) === 0 || last){
					await this._checkpoint(mac, result.protocol, chunk_offset);
					result.verified_offset = result.offset;
				}
				this.emit('progress', {addr: mac, offset: result.offset, total: result.total, percent: Math.floor(100 * result.offset / result.total)});
				index++;
			}

			step('reboot');
			// The sensor reboots instead of acknowledging, so a timeout here is success.
			await this.gateway.config_reboot_sensor(mac).catch(() => {});
			result.ok = true;
			step('complete');
		}catch(err){
			result.error = (err && err.message) || (err && (err.err || err.error)) || String(err);
			if(typeof result.error !== 'string') result.error = JSON.stringify(result.error);
		}finally{
			if(panChanged){
				await this._setPan(this._homePan()).catch((e) => {
					result.pan_restore_error = (e && e.message) || String(e);
				});
			}
			result.duration_ms = Date.now() - started;
			this.active = null;
			this.emit('done', result);
		}
		return result;
	}

	_homePan(){
		// A function lets the caller change its operating PAN ID at runtime.
		if(typeof this.opts.panId === 'function') return this.opts.panId();
		if(typeof this.opts.panId === 'number') return this.opts.panId;
		if(typeof this.gateway.pan_id === 'number') return this.gateway.pan_id;
		return 0x7FFF;
	}

	_setPan(pan){
		return this.gateway.digi.send.at_command('ID', [pan >> 8, pan & 255]).then((res) => {
			if(res && res.status && res.status !== 'OK') throw new Error('Modem rejected PAN ID change: '+res.status);
			return res;
		});
	}

	_sendChunk(mac, protocol, offset, chunk){
		if(protocol === 'legacy'){
			// Legacy bootloaders acknowledge every chunk with a config_ack.
			return this.gateway.firmware_send_chunk(mac, int2Bytes(offset, 4), chunk);
		}
		return this._transmitChunk(mac, [245, 59, 0, 0, 0].concat(int2Bytes(offset, 4), Array.prototype.slice.call(chunk)));
	}

	// v13+ chunks get no sensor reply; the modem's transmit status is the only
	// per-chunk signal. Checks delivery status (frame byte 4), not the
	// route-discovery byte that DigiParser's hasError reports.
	_transmitChunk(mac, packet){
		const gw = this.gateway;
		const self = this;
		const addr = mac.split(':').map((h) => parseInt(h, 16));
		return new Promise((fulfill, reject) => {
			gw.queue.add(async () => {
				let lastErr;
				for(let attempt = 0; attempt <= CHUNK_RETRIES; attempt++){
					try{
						const status = await gw.send.transmit_request(addr, packet);
						if(status && status.delivery_status === 'Success'){
							lastErr = null;
							break;
						}
						lastErr = new Error('Chunk delivery failed: '+((status && status.delivery_status) || 'unknown status'));
					}catch(e){
						lastErr = new Error('Chunk transmit failed: '+((e && e.error) || e));
					}
				}
				await delay(self.opts.chunkDelay);
				if(lastErr) reject(lastErr);
				else fulfill();
			});
		});
	}

	async _checkpoint(mac, protocol, expected){
		const seg = await this.gateway.firmware_read_last_chunk_segment(mac);
		const reported = protocol === 'v17' ? be(seg.data.slice(0, 4)) : be(seg.data);
		if(reported !== expected){
			const e = new Error('Sensor reports offset '+reported+' but '+expected+' was sent');
			e.reported = reported;
			throw e;
		}
	}
}

FirmwareUpdate.OTA_PAN_ID = OTA_PAN_ID;
FirmwareUpdate.CHUNK_SIZE = CHUNK_SIZE;
FirmwareUpdate.parseFirmwareFile = parseFirmwareFile;
FirmwareUpdate.parseManifestBytes = parseManifestBytes;
FirmwareUpdate.checkCompatibility = checkCompatibility;
FirmwareUpdate.protocolFor = protocolFor;

module.exports = FirmwareUpdate;
