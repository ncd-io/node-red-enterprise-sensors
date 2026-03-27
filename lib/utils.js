// lib/utils.js

module.exports = {
	/**
	 * Converts a buffer or array to a colon-separated MAC string
	 */
	toMac: (data) => {
		// Ensure we are working with a Buffer for consistent hex conversion
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
		return buf.toString('hex').match(/.{1,2}/g).join(':');
	},

	/**
	 * Common bit-shifting for legacy MSB/LSB math if needed
	 */
	msbLsb: (msb, lsb) => (msb << 8) | lsb,

	/**
	 * Formats battery voltage from raw value
	 */
	formatBattery: (val) => (val / 100).toFixed(2) + 'V',

    signInt(i, b){
        if(i.toString(2).length != b) return i;
        return -(((~i) & ((1 << (b-1))-1))+1);
    }
};