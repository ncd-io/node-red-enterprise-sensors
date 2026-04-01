const { toMac, signInt, msbLsb } = require('../utils');

// --- 1. DEFINE LOCAL FUNCTIONS ---
// These are defined as local variables so they can call each other easily.
module.exports = (globalDevices) => {

const get_write_buffer_size = (firmware) => {
    return 22;
}
const get_config_map = (firmware) => {
    console.log('Generating sync map for firmware version', firmware);
    
    return {
      "core_version": {
        "read_index": 3,
        "descriptions": {
          "title": "Core Version",
          "main_caption": "The version of the core communication stack."
        },
        "validator": {
          "type": "uint8"
        },
        "tags": [
          "system"
        ]
      },
      "firmware_version": {
        "read_index": 4,
        "descriptions": {
          "title": "Firmware Version",
          "main_caption": "The application-specific firmware version."
        },
        "validator": {
          "type": "uint8"
        },
        "tags": [
          "system"
        ]
      },
      "sensor_type": {
        "read_index": 5,
        "descriptions": {
          "title": "Sensor Type",
          "main_caption": "The hardware identifier for the specific sensor model."
        },
        "validator": {
          "type": "uint16be"
        },
        "tags": [
          "system"
        ]
      },
      "tx_lifetime_counter": {
        "read_index": 7,
        "descriptions": {
          "title": "Sampling Interval",
          "main_caption": "Set how often will the sensor transmit measurement data. Note: For this sensor, this value functions as the sampling interval rather than a traditional delay.",
          "sub_caption": "Default value: 20 milliseconds."
        },
        "validator": {
          "type": "uint32be"
        },
        "tags": [
          "diagnostics"
        ]
      },
      "hardware_id": {
        "read_index": 11,
        "length": 3,
        "descriptions": {
          "title": "Hardware ID",
          "main_caption": "A unique 3-byte hardware identifier."
        },
        "validator": {
          "type": "buffer"
        },
        "tags": [
          "system"
        ]
      },
      "network_id": {
        "read_index": 14,
        "write_index": 3,
        "length": 2,
        "descriptions": {
          "title": "Network ID",
          "main_caption": ""
        },
        "default_value": "7fff",
        "validator": {
          "type": "hex",
          "length": 4
        },
        "html_id": "pan_id",
        "tags": [
          "communications"
        ]
      },
      "destination_address": {
        "read_index": 16,
        "write_index": 5,
        "length": 4,
        "descriptions": {
          "title": "Destination Address",
          "main_caption": ""
        },
        "default_value": "0000ffff",
        "validator": {
          "type": "mac",
          "length": 8
        },
        "html_id": "destination",
        "tags": [
          "communications"
        ]
      },
      "node_id": {
        "read_index": 20,
        "write_index": 9,
        "descriptions": {
          "title": "Node ID",
          "main_caption": ""
        },
        "default_value": "0",
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 255,
          "generated": true
        },
        "html_id": "node_id",
        "tags": [
          "generic"
        ]
      },
      "gyro_sample_rate": {
        "read_index": 21,
        "write_index": 10,
        "descriptions": {
          "title": "Set Gyroscope ODR",
          "main_caption": ""
        },
        "default_value": 3,
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 3,
          "generated": true
        },
        "options": {
          "0": "125Hz",
          "1": "250Hz",
          "2": "500Hz",
          "3": "1000Hz"
        },
        "html_id": "output_data_rate_103"
      },
      "acc_sample_rate": {
        "read_index": 22,
        "write_index": 11,
        "descriptions": {
          "title": "Set Accelerometer ODR",
          "main_caption": ""
        },
        "default_value": 2,
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 4,
          "generated": true
        },
        "options": {
          "0": "8000Hz",
          "1": "4000Hz",
          "2": "1000Hz",
          "3": "100Hz",
          "4": "250Hz"
        },
        "html_id": "acc_output_data_rate_103"
      },
      "sampling_duration": {
        "read_index": 23,
        "write_index": 12,
        "descriptions": {
          "title": "Set Sampling Duration",
          "main_caption": "Set the sampling duration in milliseconds, Example: a value of 1 = 50msec, 2 = 100msec, 100 = 5000msec"
        },
        "default_value": 1,
        "validator": {
          "type": "uint8",
          "min": 1,
          "max": 255,
          "generated": true
        },
        "html_id": "sampling_duration_103"
      },
      "hpf_cutoff": {
        "read_index": 24,
        "write_index": 13,
        "descriptions": {
          "title": "Set HP Filter Cutoff",
          "main_caption": "This setting will set the High Pass Filter freq to Sample Rate multiply by Selected Valu, Example: Sample Rate = 125 and Filter Coefficient = 0.00247 HPF freq (Hz) = 125 * 0.00247"
        },
        "default_value": 0,
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 6,
          "generated": true
        },
        "options": {
          "0": "Disabled",
          "1": "0.00247",
          "2": "0.00062084",
          "3": "0.00015545",
          "4": "0.00003862",
          "5": "0.00000954",
          "6": "0.00000238"
        },
        "html_id": "enable_hp_filter_cutoff_103"
      },
      "acc_fsr": {
        "read_index": 25,
        "write_index": 14,
        "descriptions": {
          "title": "Set Accelerometer FSR",
          "main_caption": ""
        },
        "default_value": 0,
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 2,
          "generated": true
        },
        "options": {
          "0": "15g",
          "1": "30g",
          "2": "60g"
        },
        "html_id": "adxl_fsr_103"
      },
      "gyro_fsr": {
        "read_index": 26,
        "write_index": 15,
        "descriptions": {
          "title": "Set Gyroscope FSR",
          "main_caption": ""
        },
        "default_value": 0,
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 3,
          "generated": true
        },
        "options": {
          "0": "250dsp",
          "1": "500dps",
          "2": "1000dps",
          "3": "3000dps"
        },
        "html_id": "gyro_fsr_103"
      },
      "axis_enabled": {
        "read_index": 27,
        "write_index": 16,
        "descriptions": {
          "title": "Axes Enabled",
          "main_caption": "New Command"
        },
        "validator": {
          "type": "uint8"
        },
        "read_only": true,
      },
      "sampling_interval": {
        "read_index": 28,
        "write_index": 17,
        "descriptions": {
          "title": "Sampling Interval",
          "main_caption": "Set how often will the sensor transmit measurement data."
        },
        "default_value": 1,
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 7,
          "generated": true
        },
        "options": {
          "0": "5 Minutes",
          "1": "10 Minutes",
          "2": "15 Minutes",
          "3": "20 Minutes",
          "4": "30 Minutes",
          "5": "60 Minutes",
          "6": "120 Minutes",
          "7": "180 Minutes"
        },
        "html_id": "sampling_interval_101"
      },
      "accelerometer_threshold": {
        "read_index": 29,
        "write_index": 18,
        "descriptions": {
          "title": "Set Acceleration Threshold",
          "main_caption": "Set a motion detection threshold for the sensor to trigger a data transmission. This is an interrupt-based configuration."
        },
        "default_value": 1,
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 255,
          "generated": true
        },
        "html_id": "acc_threshold_103"
      },
      "enabled_sensors": {
        "read_index": 30,
        "write_index": 19,
        "descriptions": {
          "title": "Enable Sensor",
          "main_caption": ""
        },
        "default_value": 2,
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 2,
          "generated": true
        },
        "options": {
          "0": "Accelerometer only",
          "1": "Gyroscope only",
          "2": "Both enabled"
        },
        "html_id": "enable_sensor_103"
      },
      "max_num_of_motion_tx_per_interval": {
        "read_index": 31,
        "write_index": 20,
        "descriptions": {
          "title": "Set Max Number Motion Tx Per Interval",
          "main_caption": "Set Number of times it will send data due to motion triggers."
        },
        "default_value": 2,
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 255,
          "generated": true
        },
      },
      "send_raw_status": {
        "read_index": 32,
        "write_index": 21,
        "descriptions": {
          "title": "Set Raw On Motion Only",
          "main_caption": ""
        },
        "validator": {
          "type": "uint8",
          "min": 0,
          "max": 1,
          "generated": true
        },
        "default_value": 0,
        "html_id": "send_raw_on_motion_only_103"
      },
      "rtc": {
        "read_index": 33,
        "descriptions": {
          "title": "Set RTC",
          "main_caption": "Set the value for the Internal Real Time Clock."
        },
        "read_only": true,
      }
    };
};

const sync_parse = (rep_buffer) => {
    let response = {};
    
    // Get the map based on the sensor type byte
    const sync_map = get_config_map(rep_buffer[4]);

    for (const [key, config] of Object.entries(sync_map)) {
        // Destructure 'type' from inside 'validator' and rename 'read_index' to 'idx'
        const { read_index: idx, length, validator: { type } = {} } = config;

        // If for some reason a config doesn't have a validator/type, skip it
        if (!type) continue;

        switch (type) {
            case 'uint8': 
                response[key] = rep_buffer[idx]; 
                break;
            case 'uint16be': 
                response[key] = rep_buffer.readUInt16BE(idx); 
                break;
            case 'uint32be': 
                response[key] = rep_buffer.readUInt32BE(idx); 
                break;
            case 'buffer': 
                response[key] = rep_buffer.subarray(idx, idx + length); 
                break;
            case 'hex': 
                response[key] = rep_buffer.subarray(idx, idx + length).toString('hex'); 
                break;
            case 'mac': 
                response[key] = rep_buffer.subarray(idx, idx + length).toString('hex'); 
                break;
        }
    }
    if(Object.hasOwn(response, 'destination_address') && response.destination_address.toLowerCase() === '00000000') {
        console.log('##############################');
        console.log('#########Dest Override########');
        console.log('##############################');
        response.destination_address = "0000ffff";
        response.auto_raw_destination_address = "0000ffff";
    };
    return response;
};

const parse_fly = (frame) => {
    let firmware = frame[2];
    if(firmware > 1){
        let frame_data = {};
        switch(frame[12]){
            case 0:
                frame_data.gyro_odr = 125;
                break;
            case 1:
                frame_data.gyro_odr = 250;
                break;
            case 2:
                frame_data.gyro_odr = 500;
                break;
            case 3:
                frame_data.gyro_odr = 1000;
                break;
        }
        switch(frame[13]){
            case 0:
                frame_data.acc_odr = 8000;
                break;
            case 1:
                frame_data.acc_odr = 4000;
                break;
            case 2:
                frame_data.acc_odr = 2000;
                break;
            case 3:
                frame_data.acc_odr = 1000;
                break;
            case 4:
                frame_data.acc_odr = 100;
                break;
        }
        switch(frame[15]){
            case 0:
                frame_data.hpf_cutoff = false;
                break;
            case 1:
                frame_data.hpf_cutoff = 0.00247;
                break;
            case 2:
                frame_data.hpf_cutoff = 0.00062084;
                break;
            case 3:
                frame_data.hpf_cutoff = 0.00015545;
                break;
            case 4:
                frame_data.hpf_cutoff = 0.00003862;
                break;
            case 5:
                frame_data.hpf_cutoff = 0.00000954;
                break;
            case 6:
                frame_data.hpf_cutoff = 0.00000238;
                break;
        }
        switch(frame[16]){
            case 0:
                frame_data.fsr_acc = "15g";
                break;
            case 1:
                frame_data.fsr_acc = "30g";
                break;
            case 2:
                frame_data.fsr_acc = "60g";
                break;
        }
        switch(frame[17]){
            case 0:
                frame_data.fsr_gyro = "250dps";
                break;
            case 1:
                frame_data.fsr_gyro = "500dps";
                break;
            case 2:
                frame_data.fsr_gyro = "1000dps";
                break;
            case 3:
                frame_data.fsr_gyro = "2000dps";
                break;
        }
        switch(frame[18]){
            case 1:
                frame_data.en_axis = "X Axis";
                break;
            case 2:
                frame_data.en_axis = "Y Axis";
                break;
            case 3:
                frame_data.en_axis = "X-Y Axes";
                break;
            case 4:
                frame_data.en_axis = "Z Axis";
                break;
            case 5:
                frame_data.en_axis = "X-Z Axes";
                break;
            case 6:
                frame_data.en_axis = "Y-Z Axes";
                break;
            case 7:
                frame_data.en_axis = "All Axes";
                break;
        }
        switch(frame[19]){
            case 0:
                frame_data.sampling_interval = 5;
                break;
            case 1:
                frame_data.sampling_interval = 10;
                break;
            case 2:
                frame_data.sampling_interval = 15;
                break;
            case 3:
                frame_data.sampling_interval = 20;
                break;
            case 4:
                frame_data.sampling_interval = 30;
                break;
            case 5:
                frame_data.sampling_interval = 60;
                break;
            case 6:
                frame_data.sampling_interval = 120;
                break;
            case 7:
                frame_data.sampling_interval = 180;
                break;
        }
        switch(frame[21]){
            case 0:
                frame_data.en_sensors = "acc_only";
                break;
            case 1:
                frame_data.en_sensors = "gyro_only";
                break;
            case 2:
                frame_data.en_sensors = "both_enabled";
                break;
        }
        frame_data.hpf_cutoff = (frame_data.hpf_cutoff)?((frame_data.hpf_cutoff * frame_data.acc_odr).toFixed(2) + 'Hz'):'disabled';
        return {
            'firmware': firmware,
            'gyro_sample_rate': frame_data.gyro_odr + 'Hz',
            'acc_sample_rate': frame_data.acc_odr + 'Hz',
            'sampling_duration': (frame[14]* 50) + 'msec',
            'hpf_cutoff': frame_data.hpf_cutoff,
            'acc_fsr': frame_data.fsr_acc,
            'gyro_fsr': frame_data.fsr_gyro,
            'axis_enabled': frame_data.en_axis,
            'sampling_interval': frame_data.sampling_interval + 'min',
            'accelerometer_threshold': (frame[20]* 32) + "mg",
            'enabled_sensors': frame_data.en_sensors,
            'max_num_of_motion_tx_per_interval': frame[22],
            'rtc': [
                String(frame[23]).padStart(2, '0'),
                String(frame[24]).padStart(2, '0'),
                String(frame[25]).padStart(2, '0')
            ].join(':'),
            'hardware_id': frame.slice(26, 29),
            'report_rate': frame.slice(29, 33).reduce(msbLsb),
            'tx_life_counter': frame.slice(33, 37).reduce(msbLsb),
            'machine_values': {
                'firmware': frame[2],
                'gyro_sample_rate': frame[12],
                'acc_sample_rate': frame[13],
                'sampling_duration': frame[14],
                'hpf_cutoff': frame[15],
                'acc_fsr': frame[16],
                'gyro_fsr': frame[17],
                'axis_enabled': frame[18],
                'sampling_interval': frame[19],
                'accelerometer_threshold': frame[20],
                'enabled_sensors': frame[21],
                'max_num_of_motion_tx_per_interval': frame[22],
                'hour': frame[23],
                'minute': frame[24],
                'second': frame[25],
                'hardware_id': frame.slice(26, 29),
                'report_rate': frame.slice(29, 33),
                'tx_life_counter': frame.slice(33, 37)
            }
        }
    }else{
        let frame_data = {};
        switch(frame[12]){
            case 0:
                frame_data.odr = 125;
                break;
            case 1:
                frame_data.odr = 250;
                break;
            case 2:
                frame_data.odr = 500;
                break;
            case 3:
                frame_data.odr = 1000;
                break;
        }
        switch(frame[15]){
            case 0:
                frame_data.fsr_acc = "10g";
                break;
            case 1:
                frame_data.fsr_acc = "20g";
                break;
            case 2:
                frame_data.fsr_acc = "40g";
                break;
        }
        switch(frame[16]){
            case 0:
                frame_data.fsr_gyro = "250dps";
                break;
            case 1:
                frame_data.fsr_gyro = "500dps";
                break;
            case 2:
                frame_data.fsr_gyro = "1000dps";
                break;
            case 3:
                frame_data.fsr_gyro = "2000dps";
                break;
        }
        switch(frame[17]){
            case 7:
                frame_data.en_axis = "all";
                break;
        }
        switch(frame[20]){
            case 1:
                frame_data.en_sensors = "gyro_only";
                break;
            case 2:
                frame_data.en_sensors = "accel_only";
                break;
            case 3:
                frame_data.en_sensors = "all_enabled";
                break;
        }
        switch(frame[18]){
            case 0:
                frame_data.sampling_interval = 5;
                break;
            case 1:
                frame_data.sampling_interval = 10;
                break;
            case 2:
                frame_data.sampling_interval = 15;
                break;
            case 3:
                frame_data.sampling_interval = 20;
                break;
            case 4:
                frame_data.sampling_interval = 30;
                break;
            case 5:
                frame_data.sampling_interval = 60;
                break;
            case 6:
                frame_data.sampling_interval = 120;
                break;
            case 7:
                frame_data.sampling_interval = 180;
                break;
        }
        switch(frame[14]){
            case 0:
                frame_data.hpf_cutoff = 0.00247;
                break;
            case 1:
                frame_data.hpf_cutoff = 0.00062084;
                break;
            case 2:
                frame_data.hpf_cutoff = 0.00015545;
                break;
            case 3:
                frame_data.hpf_cutoff = 0.00003862;
                break;
            case 4:
                frame_data.hpf_cutoff = 0.00000954;
                break;
            case 5:
                frame_data.hpf_cutoff = 0.00000238;
                break;
        }
        return {
            'firmware': firmware,
            'sample_rate': frame_data.odr + 'Hz',
            'sampling_duration': (frame[13]* 50) + 'msec',
            'hpf_cutoff': (frame_data.hpf_cutoff * frame_data.odr).toFixed(2) + 'Hz',
            'acc_fsr': frame_data.fsr_acc,
            'gyro_fsr': frame_data.fsr_gyro,
            'axis_enabled': frame_data.en_axis,
            'sampling_interval': frame_data.sampling_interval + 'min',
            'accelerometer_threshold': (frame[19]* 32) + "mg",
            'enabled_sensors': frame_data.en_sensors,
            'rtc': [
                String(frame[21]).padStart(2, '0'),
                String(frame[22]).padStart(2, '0'),
                String(frame[23]).padStart(2, '0')
            ].join(':'),
            'hardware_id': frame.slice(24, 27),
            'report_rate': frame.slice(27, 31).reduce(msbLsb),
            'tx_life_counter': frame.slice(31, 35).reduce(msbLsb),
            'machine_values': {
                'firmware': frame[2],
                'odr': frame[12],
                'sampling_duration': frame[13],
                'hpf_cutoff': frame[14],
                'acc_fsr': frame[15],
                'gyro_fsr': frame[16],
                'axis_enabled': frame[17],
                'sampling_interval': frame[18],
                'accelerometer_threshold': frame[19],
                'enabled_sensors': frame[20],
                'hour': frame[21],
                'minute': frame[22],
                'second': frame[23],
                'hardware_id': frame.slice(24, 27),
                'report_rate': frame.slice(27, 31),
                'tx_life_counter': frame.slice(31, 35)
            }
        }
    }
}

const parse = (payload, parsed, mac) => {
    if(payload[9] === 0){ // mode raw
        var sensor_type = payload[8];
        var deviceAddr = mac;
        var data = {};
        switch(sensor_type){
            case 1:
                data.sensor_type = 'Accel';
                switch(payload[11]){ // for ADXL382
                    case 0:
                        // data.odr = '8000Hz';
                        data.odr = 8000;
                        break;
                    case 1:
                        // data.odr = '4000Hz';
                        data.odr = 4000;
                        break;
                    case 2:
                        // data.odr = '2000Hz';
                        data.odr = 1000;
                        break;
                    case 3:
                        // data.odr = '1000Hz';
                        data.odr = 100;
                        break;
                    case 4:
                        // data.odr = '100Hz';
                        data.odr = 250;
                        break;
                }
            break;
            case 2:
                data.sensor_type = 'gyro';
                switch(payload[11]){
                    case 0:
                        data.odr = '125Hz';
                        break;
                    case 1:
                        data.odr = '250Hz';
                        break;
                    case 2:
                        data.odr = '500Hz';
                        break;
                    case 3:
                        data.odr = '1000Hz';
                        break;
                }
            break;
        }
        switch(payload[10]){
            case 1:
                data.event_type = 'report';
                break;
            case 2:
                data.event_type = 'motion';
                break;
        }

        var mode = payload[9];
        var odr = data.odr;
        var en_axis = payload[12] & 7;
        var fsr = payload[12] >> 3;
        var hour = payload[13];
        var minute = payload[14];
        var device_temp = payload.slice(15, 17).reduce(msbLsb) / 100;
        var external_temperature = payload.slice(17, 19).reduce(msbLsb) / 100;
        var expected_packets =  payload.slice(19, 21).reduce(msbLsb);
        var current_packet = payload.slice(21, 23).reduce(msbLsb);
        var data_start = 23;

        if(globalDevices.hasOwnProperty(deviceAddr) || expected_packets == 1){
            if(expected_packets != 1){
                // if current packet is equal to last one (duplicated data). This does not apply to the last package
                if (globalDevices[deviceAddr].last_packet_counter == current_packet){
                    console.log('Duplicated message')
                    return;
                }
                // if current packet is equal to 1 or last packet counter is higher thant current packet
                if(current_packet == 1 || (globalDevices[deviceAddr].last_packet_counter > current_packet)){
                    // clear stream
                    delete globalDevices[deviceAddr];
                    // create new stream
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
                        external_temp: external_temperature
                    }
                    globalDevices[deviceAddr].last_packet_counter = current_packet;
                    globalDevices[deviceAddr].data[current_packet] = payload.slice(data_start);
                    return;
                }
                else{
                    globalDevices[deviceAddr].last_packet_counter = current_packet;
                    globalDevices[deviceAddr].data[current_packet] = payload.slice(data_start);
                }
            }
            else{
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
                    external_temp: external_temperature
                }
                globalDevices[deviceAddr].last_packet_counter = current_packet;
                globalDevices[deviceAddr].data[current_packet] = payload.slice(data_start);
            }
        }
        else{

            globalDevices[deviceAddr] = {
                data: {},
                odr: odr,
                mo: mode,
                en_axis: en_axis,
                fsr: fsr,
                hour: hour,
                minute: minute,
                device_temp: device_temp,
                external_temp: external_temperature
            }
            globalDevices[deviceAddr].last_packet_counter = current_packet;
            globalDevices[deviceAddr].data[current_packet] = payload.slice(data_start);
        }
        if(current_packet == expected_packets){
            var raw_data = new Array();
            for(const packet in globalDevices[deviceAddr].data){
                raw_data = raw_data.concat(globalDevices[deviceAddr].data[packet]);
            }
            var label = 0;

            var fft = new Array();
            var fft_concat = {};

            var en_axis_data = {};
            en_axis_data.x_offset = 0;
            en_axis_data.y_offset = 2;
            en_axis_data.z_offset = 4;
            en_axis_data.increment = 6;
            fft_concat = {x: [], y: [], z: []};

            /* Evaluate sensor type */
            if(payload[8] == 1){ // accelerometer
                var fsr_mult = 0.00732;
                var fsr_text = "";
                switch(globalDevices[deviceAddr].fsr){
                    case 0:
                        fsr_mult = 0.00732;
                        break;
                    case 1:
                        fsr_mult = 0.01464;
                        break;
                    case 2:
                        fsr_mult = 0.02929;
                        break;
                }
                switch(globalDevices[deviceAddr].fsr){
                    case 0:
                        // fsr_text = "15g";
                        fsr_text = 15;
                        break;
                    case 1:
                        // fsr_text = "30g";
                        fsr_text = 30;
                        break;
                    case 2:
                        // fsr_text = "60g";
                        fsr_text = 60;
                        break;
                }
            }else{ // gyro
                var fsr_mult = 0.0076;
                var fsr_text = "";
                switch(globalDevices[deviceAddr].fsr){
                    case 0:
                        fsr_mult = 0.0076;
                        break;
                    case 1:
                        fsr_mult = 0.015;
                        break;
                    case 2:
                        fsr_mult = 0.0305;
                        break;
                    case 3:
                        fsr_mult = 0.061;
                        break;
                }
                switch(globalDevices[deviceAddr].fsr){
                    case 0:
                        fsr_text = "250dps";
                        break;
                    case 1:
                        fsr_text = "500dps";
                        break;
                    case 2:
                        fsr_text = "1000dps";
                        break;
                    case 3:
                        fsr_text = "2000dps";
                        break;
                }
            }

            for(var i = 0; i < raw_data.length; i+=en_axis_data.increment){
                label++;

                if('x_offset' in en_axis_data){
                    fft_concat.x.push(parseFloat((signInt(((raw_data[i+en_axis_data.x_offset]<<8)+(raw_data[i+en_axis_data.x_offset+1])), 16)*fsr_mult).toFixed(5)));
                }
                if('y_offset' in en_axis_data){
                    fft_concat.y.push(parseFloat((signInt(((raw_data[i+en_axis_data.y_offset]<<8)+(raw_data[i+en_axis_data.y_offset+1])), 16)*fsr_mult).toFixed(5)));
                }
                if('z_offset' in en_axis_data){
                    fft_concat.z.push(parseFloat((signInt(((raw_data[i+en_axis_data.z_offset]<<8)+(raw_data[i+en_axis_data.z_offset+1])), 16)*fsr_mult).toFixed(5)));
                }
            }
            var fft_concat_obj = {
                mode: mode,
                sensor_type: 103,
                probe_type: data.sensor_type,
                msg_type: data.event_type,
                time_id: globalDevices[deviceAddr].hour +':'+ globalDevices[deviceAddr].minute,
                mac_address: deviceAddr,
                en_axis: globalDevices[deviceAddr].en_axis,
                fsr: fsr_text,
                odr: globalDevices[deviceAddr].odr,
                device_temp: globalDevices[deviceAddr].device_temp,
                external_temp: globalDevices[deviceAddr].external_temp,
                total_samples: label,
                fft_confidence : ((Object.keys(globalDevices[deviceAddr].data).length / expected_packets) * 100).toFixed(2) + '%',
                data: fft_concat,
                raw_data: raw_data
            };
            sensor_data = fft_concat_obj;
            delete globalDevices[deviceAddr];
            return sensor_data;
        }
        else{
            return;
        }
    }
}

// --- 2. EXPORT THE MODULE ---
  return {
    type: 103,
    name: 'Custom Wireless Accelerometer Sensor',
    parse,
    get_write_buffer_size,
    get_config_map,
    sync_parse,
    parse_fly,
  };
};