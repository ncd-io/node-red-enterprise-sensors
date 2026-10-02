// node test/FirmwareUpdate.test.js
// Drives lib/FirmwareUpdate.js against a simulated sensor + modem.

const assert = require('assert');
const events = require('events');
const FirmwareUpdate = require('../lib/FirmwareUpdate.js');

const MAC = '00:13:a2:00:42:38:2d:92';
const HOME_PAN = 0x7FFF;

function int2Bytes(n, len){
	const out = [];
	for(let i = len - 1; i >= 0; i--) out.push(Math.floor(n / Math.pow(256, i)) & 255);
	return out;
}

// manifest(37): version, start(4), size(4), max(4), digest(16), type(2), hwid(3), reserve(3)
function manifestBytes({version, size, max = 0x38000, type = 114, hw = [0x63, 0x3d, 0x00]}){
	return [version].concat(int2Bytes(0x8000, 4), int2Bytes(size, 4), int2Bytes(max, 4),
		new Array(16).fill(0xab), int2Bytes(type, 2), hw, [0, 0, 0]);
}
function buildFile(opts){
	const image = [];
	for(let i = 0; i < opts.size; i++) image.push(i & 255);
	return Buffer.from([1].concat(int2Bytes(37, 4), manifestBytes(opts), [2], int2Bytes(opts.size, 4), image));
}

// A sensor on the far side of the radio. Records what it receives and can be
// told to misbehave.
function makeGateway(sensor){
	const emitter = new events.EventEmitter();
	let chain = Promise.resolve();
	const gw = {
		_emitter: emitter,
		pan_id: HOME_PAN,
		pans: [],
		received: new Map(),
		manifestSent: 0,
		rebooted: false,
		queue: {add(fn){ chain = chain.then(fn, fn); return chain; }},
		digi: {send: {at_command(cmd, p){
			if(cmd === 'ID') gw.pans.push((p[0] << 8) | p[1]);
			return Promise.resolve({status: 'OK'});
		}}},
		send: {transmit_request(addr, packet){
			if(sensor.dropAt !== undefined){
				const off = packet.slice(5, 9).reduce((a, b) => a * 256 + b, 0);
				if(off === sensor.dropAt){
					sensor.dropAt = undefined;
					return Promise.resolve({delivery_status: 'Network ACK failure'});
				}
			}
			const off = packet.slice(5, 9).reduce((a, b) => a * 256 + b, 0);
			// A sensor that loses a chunk silently: modem says Success, sensor never stores it.
			if(sensor.silentLoss === off){ sensor.silentLoss = undefined; return Promise.resolve({delivery_status: 'Success'}); }
			// The bootloader writes in order: a chunk past a gap is not stored.
			const next = sensor.lastOffset === undefined ? 0 : sensor.lastOffset + 128;
			if(off <= next){
				gw.received.set(off, packet.slice(9));
				sensor.lastOffset = off;
			}
			return Promise.resolve({delivery_status: 'Success'});
		}},
		firmware_request_manifest(mac){
			setTimeout(() => emitter.emit('manifest_received', {addr: mac, data: manifestBytes(sensor.manifest)}), 5);
			return Promise.resolve();
		},
		firmware_set_to_ota_mode(){
			if(sensor.refuseOta) return Promise.resolve({result: 0, data: [0, 0, 0], original: {data: []}});
			const data = [0, 0, 0, 0, 0, sensor.fota];
			return Promise.resolve({result: 255, data: [70, 79, 78], original: {data}});
		},
		firmware_send_manifest(){ gw.manifestSent++; return Promise.resolve({}); },
		firmware_send_chunk(mac, offset, chunk){
			const off = offset.reduce((a, b) => a * 256 + b, 0);
			gw.received.set(off, Array.from(chunk));
			return Promise.resolve({});
		},
		firmware_read_last_chunk_segment(){
			const last = sensor.lastOffset || 0;
			return Promise.resolve({data: sensor.fota > 16 ? int2Bytes(last, 4).concat(int2Bytes(last + 128, 4)) : int2Bytes(last, 4)});
		},
		config_reboot_sensor(){ gw.rebooted = true; return Promise.reject({err: 'No config err or ack, timeout'}); }
	};
	return gw;
}

function assembled(gw, size){
	const out = [];
	for(let off = 0; off < size; off += 128) out.push(...(gw.received.get(off) || []));
	return out;
}

const fast = {chunkDelay: 0, settleDelay: 0, manifestTimeout: 200};
const tests = [];
function test(name, fn){ tests.push({name, fn}); }

test('parseFirmwareFile reads the header and rejects truncation', () => {
	const f = FirmwareUpdate.parseFirmwareFile(buildFile({version: 18, size: 300}));
	assert.strictEqual(f.manifest.firmware_version, 18);
	assert.strictEqual(f.manifest.device_type, 114);
	assert.strictEqual(f.manifest.hardware_id_hex, '633d00');
	assert.strictEqual(f.image.length, 300);
	assert.strictEqual(f.manifest_bytes.length, 37);
	const bad = buildFile({version: 18, size: 300}).slice(0, 200);
	assert.throws(() => FirmwareUpdate.parseFirmwareFile(bad), /truncated/);
	assert.throws(() => FirmwareUpdate.parseFirmwareFile(Buffer.from('<html>not found</html>'.repeat(4))), /marker/);
});

test('checkCompatibility: hardware, type, size, same version; downgrade allowed', () => {
	const file = FirmwareUpdate.parseFirmwareFile(buildFile({version: 12, size: 300}));
	const sensor = (o) => FirmwareUpdate.parseManifestBytes(manifestBytes(Object.assign({version: 18, size: 1000}, o)));
	assert.strictEqual(FirmwareUpdate.checkCompatibility(sensor({}), file).ok, true, 'downgrade 18 -> 12');
	assert.strictEqual(FirmwareUpdate.checkCompatibility(sensor({hw: [0x55, 0x95, 0x0d]}), file).code, 'hardware_id_mismatch');
	assert.strictEqual(FirmwareUpdate.checkCompatibility(sensor({type: 110}), file).code, 'device_type_mismatch');
	assert.strictEqual(FirmwareUpdate.checkCompatibility(sensor({max: 200}), file).code, 'image_too_large');
	assert.strictEqual(FirmwareUpdate.checkCompatibility(sensor({version: 12}), file).code, 'same_version');
	assert.strictEqual(FirmwareUpdate.checkCompatibility(sensor({version: 12}), file, {allowSameVersion: true}).ok, true);
});

for(const [fota, protocol] of [[18, 'v17'], [13, 'v13'], [9, 'legacy']]){
	test('full update, '+protocol+' bootloader', async () => {
		const size = 128 * 120 + 45;	// crosses two checkpoints and ends on a partial chunk
		const sensor = {fota, manifest: {version: 11, size: 190000}};
		const gw = makeGateway(sensor);
		const fu = new FirmwareUpdate(gw, fast);
		const progress = [];
		fu.on('progress', (p) => progress.push(p.percent));
		const r = await fu.start(MAC, buildFile({version: 18, size}));
		assert.strictEqual(r.ok, true, r.error);
		assert.strictEqual(r.protocol, protocol);
		assert.strictEqual(r.from_version, 11);
		assert.strictEqual(r.target_version, 18);
		assert.deepStrictEqual(gw.pans, [0x7AAA, HOME_PAN]);
		assert.strictEqual(gw.rebooted, true);
		assert.strictEqual(gw.manifestSent, 1);
		const expected = FirmwareUpdate.parseFirmwareFile(buildFile({version: 18, size})).image;
		assert.deepStrictEqual(assembled(gw, size), expected);
		assert.strictEqual(progress[progress.length - 1], 100);
		assert.strictEqual(fu.busy, false);
	});
}

test('wrong hardware never enters OTA mode or touches the PAN', async () => {
	const gw = makeGateway({fota: 18, manifest: {version: 11, size: 1000, hw: [0x55, 0x95, 0x0d]}});
	const r = await new FirmwareUpdate(gw, fast).start(MAC, buildFile({version: 18, size: 300}));
	assert.strictEqual(r.ok, false);
	assert.strictEqual(r.code, 'hardware_id_mismatch');
	assert.deepStrictEqual(gw.pans, []);
	assert.strictEqual(gw.received.size, 0);
});

test('no manifest reply fails cleanly', async () => {
	const gw = makeGateway({fota: 18, manifest: {version: 11, size: 1000}});
	gw.firmware_request_manifest = () => Promise.resolve();
	const r = await new FirmwareUpdate(gw, fast).start(MAC, buildFile({version: 18, size: 300}));
	assert.strictEqual(r.ok, false);
	assert.strictEqual(r.stage, 'manifest');
	assert.deepStrictEqual(gw.pans, []);
});

test('sensor refusing OTA mode leaves the PAN alone', async () => {
	const gw = makeGateway({fota: 18, refuseOta: true, manifest: {version: 11, size: 1000}});
	const r = await new FirmwareUpdate(gw, fast).start(MAC, buildFile({version: 18, size: 300}));
	assert.strictEqual(r.ok, false);
	assert.strictEqual(r.stage, 'enter_ota');
	assert.deepStrictEqual(gw.pans, []);
});

test('a chunk that exhausts its retries fails the update and restores the PAN', async () => {
	const gw = makeGateway({fota: 18, manifest: {version: 11, size: 1000}});
	gw.send.transmit_request = () => Promise.resolve({delivery_status: 'Route not found'});
	const r = await new FirmwareUpdate(gw, fast).start(MAC, buildFile({version: 18, size: 1000}));
	assert.strictEqual(r.ok, false);
	assert.strictEqual(r.stage, 'transfer');
	assert.match(r.error, /Route not found/);
	assert.deepStrictEqual(gw.pans, [0x7AAA, HOME_PAN]);
	assert.strictEqual(gw.rebooted, false);
});

test('a single failed delivery is retried and the update completes', async () => {
	const sensor = {fota: 13, dropAt: 256, manifest: {version: 11, size: 1000}};
	const gw = makeGateway(sensor);
	const r = await new FirmwareUpdate(gw, fast).start(MAC, buildFile({version: 18, size: 1000}));
	assert.strictEqual(r.ok, true, r.error);
});

test('checkpoint catches a silently lost chunk; resume completes from the verified offset (v13)', async () => {
	const size = 128 * 120;
	const sensor = {fota: 13, silentLoss: 128 * 70, manifest: {version: 11, size: 190000}};
	const gw = makeGateway(sensor);
	const fu = new FirmwareUpdate(gw, fast);
	const r1 = await fu.start(MAC, buildFile({version: 18, size}));
	assert.strictEqual(r1.ok, false);
	assert.strictEqual(r1.verified_offset, 128 * 50, 'last good checkpoint');
	assert.deepStrictEqual(gw.pans, [0x7AAA, HOME_PAN]);
	const r2 = await fu.start(MAC, buildFile({version: 18, size}), {resumeOffset: r1.verified_offset});
	assert.strictEqual(r2.ok, true, r2.error);
	assert.strictEqual(gw.manifestSent, 2, 'v13 resends the manifest on resume');
	const expected = FirmwareUpdate.parseFirmwareFile(buildFile({version: 18, size})).image;
	assert.deepStrictEqual(assembled(gw, size), expected);
});

test('v17 resume asks the sensor where it got to and skips the manifest', async () => {
	const size = 128 * 120;
	const sensor = {fota: 18, manifest: {version: 11, size: 190000}};
	const gw = makeGateway(sensor);
	// the sensor already holds everything up to offset 128*79
	for(let off = 0; off < 128 * 80; off += 128) gw.received.set(off, FirmwareUpdate.parseFirmwareFile(buildFile({version: 18, size})).image.slice(off, off + 128));
	sensor.lastOffset = 128 * 79;
	const r = await new FirmwareUpdate(gw, fast).start(MAC, buildFile({version: 18, size}), {resumeOffset: 128 * 50});
	assert.strictEqual(r.ok, true, r.error);
	assert.strictEqual(gw.manifestSent, 0);
	const expected = FirmwareUpdate.parseFirmwareFile(buildFile({version: 18, size})).image;
	assert.deepStrictEqual(assembled(gw, size), expected);
});

test('a second start while busy is refused', async () => {
	const gw = makeGateway({fota: 18, manifest: {version: 11, size: 190000}});
	const fu = new FirmwareUpdate(gw, fast);
	const p = fu.start(MAC, buildFile({version: 18, size: 1000}));
	const r2 = await fu.start('00:13:a2:00:00:00:00:01', buildFile({version: 18, size: 1000}));
	assert.strictEqual(r2.stage, 'busy');
	assert.strictEqual((await p).ok, true);
});

test('updateOnWake: a missed manifest keeps the sensor armed (retry)', async () => {
	const gw = makeGateway({fota: 18, manifest: {version: 11, size: 1000}});
	gw.firmware_request_manifest = () => Promise.resolve(); // sensor went back to sleep
	let loaded = false;
	const r = await new FirmwareUpdate(gw, fast).updateOnWake(MAC, () => { loaded = true; return buildFile({version: 18, size: 300}); });
	assert.strictEqual(r.ok, false);
	assert.strictEqual(r.stage, 'manifest');
	assert.strictEqual(r.retry, true);
	assert.strictEqual(loaded, false, 'no file lookup without a manifest');
	assert.deepStrictEqual(gw.pans, []);
});

test('updateOnWake: a missing firmware file is not retried', async () => {
	const gw = makeGateway({fota: 18, manifest: {version: 11, size: 1000}});
	const r = await new FirmwareUpdate(gw, fast).updateOnWake(MAC, () => { throw new Error('No firmware file stored for sensor type 114'); });
	assert.strictEqual(r.stage, 'file');
	assert.strictEqual(r.retry, false);
	assert.match(r.error, /No firmware file/);
	assert.deepStrictEqual(gw.pans, [], 'never entered OTA mode');
});

test('updateOnWake: an invalid firmware file is not retried', async () => {
	const gw = makeGateway({fota: 18, manifest: {version: 11, size: 1000}});
	const r = await new FirmwareUpdate(gw, fast).updateOnWake(MAC, () => Buffer.from('<html>404</html>'.repeat(4)));
	assert.strictEqual(r.stage, 'file');
	assert.strictEqual(r.retry, false);
});

test('updateOnWake: an incompatible sensor is not retried', async () => {
	const gw = makeGateway({fota: 18, manifest: {version: 11, size: 1000, hw: [0x55, 0x95, 0x0d]}});
	const r = await new FirmwareUpdate(gw, fast).updateOnWake(MAC, () => buildFile({version: 18, size: 300}));
	assert.strictEqual(r.code, 'hardware_id_mismatch');
	assert.strictEqual(r.retry, false);
});

test('updateOnWake: an interrupted transfer is retried, then resumes', async () => {
	const size = 128 * 120;
	const sensor = {fota: 13, silentLoss: 128 * 70, manifest: {version: 11, size: 190000}};
	const gw = makeGateway(sensor);
	const fu = new FirmwareUpdate(gw, fast);
	const r1 = await fu.updateOnWake(MAC, () => buildFile({version: 18, size}));
	assert.strictEqual(r1.ok, false);
	assert.strictEqual(r1.retry, true);
	assert.strictEqual(r1.verified_offset, 128 * 50);
	const r2 = await fu.updateOnWake(MAC, () => buildFile({version: 18, size}), {resumeOffset: r1.verified_offset});
	assert.strictEqual(r2.ok, true, r2.error);
	assert.strictEqual(r2.retry, false);
});

test('updateOnWake: success clears the request', async () => {
	const gw = makeGateway({fota: 18, manifest: {version: 11, size: 190000}});
	const r = await new FirmwareUpdate(gw, fast).updateOnWake(MAC, (m) => {
		assert.strictEqual(m.hardware_id_hex, '633d00', 'loader gets the sensor manifest');
		return FirmwareUpdate.parseFirmwareFile(buildFile({version: 18, size: 1000}));
	});
	assert.strictEqual(r.ok, true, r.error);
	assert.strictEqual(r.retry, false);
});

(async () => {
	let failed = 0;
	for(const t of tests){
		try{
			await t.fn();
			console.log('  ok   '+t.name);
		}catch(e){
			failed++;
			console.log('  FAIL '+t.name+'\n       '+(e && e.message));
		}
	}
	console.log(failed ? failed+' failed' : 'all '+tests.length+' passed');
	process.exit(failed ? 1 : 0);
})();
