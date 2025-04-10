const events = require('events');

module.exports = class APIConfig {
  constructor(gateway) {
    this.config = {};
    this.gateway = gateway;
    this.eventEmitter = new events.EventEmitter();
  }

  
  
  
  
  
  
  set(key, value) {
    this.config[key] = value;
    this.eventEmitter.emit('configChanged', key, value);
  }

  get(key) {
    return this.config[key];
  }

  onConfigChanged(callback) {
    this.eventEmitter.on('configChanged', callback);
  }
  getConfigFunctionMap() {
    return {
        universal: {
            destination: config_set_destination,
            network_id: config_set_pan_id,
            id_and_delay: config_set_id_delay,
            wireless_power: config_set_power,
            wireless_retries: config_set_retries,
        },
        // AI Gemini Generated, check for accuracy
        110: {
            odr: this.gateway.config_set_odr_p1_110,
            sample_duration: this.gateway.config_set_sampling_duration_p1_110,
            sample_interval: this.gateway.config_set_sampling_interval_101,
            fsr: this.gateway.config_set_full_scale_range_101,
            operation_mode: this.gateway.config_set_operation_mode_80,
            enable_filters: this.gateway.config_set_filters_80,
            low_pass_filter: this.gateway.config_set_low_pass_filter_p1_110,
            high_pass_filter: this.gateway.config_set_high_pass_filter_p1_110,
            measurement_mode: this.gateway.config_set_measurement_mode_80,
            request_timeout: this.gateway.config_set_on_request_timeout_80,
            deadband: this.gateway.config_set_deadband_80,
            payload_length: this.gateway.config_set_payload_length_80,
            rtc: this.gateway.config_set_rtc_101,
            auto_raw_interval: this.gateway.config_set_auto_raw_interval_110,
            auto_raw_destination: this.gateway.config_set_auto_raw_destination_110,
            clear_probe_uptimers: this.gateway.config_set_clear_probe_uptimers_110,
            // TODO this is a bad name for this property
            smart_interval: this.gateway.config_set_smart_interval_110,
            smart_threshold: this.gateway.config_set_smart_threshold_110,
            fly_interval: this.gateway.config_set_fly_interval_110,
            motion_detect_threshold: this.gateway.config_set_motion_detect_threshold_p1_110,
            // TODO this is a bad name for this property
            rpm_calculate_status: this.gateway.config_set_enable_rpm_calculate_status_110,
            max_raw_samples: this.gateway.config_set_max_raw_sample_110
        },
        // AI Gemini Generated, check for accuracy
        111: {
            odr_p1: this.gateway.config_set_odr_p1_110,
            sample_duration_p1: this.gateway.config_set_sampling_duration_p1_110,
            odr_p2: this.gateway.config_set_odr_p2_110,
            sample_duration_p2: this.gateway.config_set_sampling_duration_p2_110,
            sample_interval: this.gateway.config_set_sampling_interval_101,
            fsr: this.gateway.config_set_full_scale_range_101,
            operation_mode: this.gateway.config_set_operation_mode_80,
            enable_filters: this.gateway.config_set_filters_80,
            low_pass_filter_p1: this.gateway.config_set_low_pass_filter_p1_110,
            high_pass_filter_p1: this.gateway.config_set_high_pass_filter_p1_110,
            low_pass_filter_p2: this.gateway.config_set_low_pass_filter_p2_110,
            high_pass_filter_p2: this.gateway.config_set_high_pass_filter_p2_110,
            measurement_mode: this.gateway.config_set_measurement_mode_80,
            request_timeout: this.gateway.config_set_on_request_timeout_80,
            deadband: this.gateway.config_set_deadband_80,
            payload_length: this.gateway.config_set_payload_length_80,
            rtc: this.gateway.config_set_rtc_101,
            auto_raw_interval: this.gateway.config_set_auto_raw_interval_110,
            auto_raw_destination: this.gateway.config_set_auto_raw_destination_110,
            clear_probe_uptimers: this.gateway.config_set_clear_probe_uptimers_110,
            // TODO this is a bad name for this property
            smart_interval: this.gateway.config_set_smart_interval_110,
            smart_threshold: this.gateway.config_set_smart_threshold_110,
            smart_threshold_p2: this.gateway.config_set_smart_threshold_p2_110,
            fly_interval: this.gateway.config_set_fly_interval_110,
            motion_detect_threshold_p1: this.gateway.config_set_motion_detect_threshold_p1_110,
            motion_detect_threshold_p2: this.gateway.config_set_motion_detect_threshold_p2_110,
            // TODO this is a bad name for this property
            rpm_calculate_status: this.gateway.config_set_enable_rpm_calculate_status_110,
            max_raw_samples: this.gateway.config_set_max_raw_sample_110
        },
        114: {
            odr: this.gateway.config_set_odr_p1_110,
            sample_duration: this.gateway.config_set_sampling_duration_p1_110,
            
            sample_interval: this.gateway.config_set_sampling_interval_101,
            fsr: this.gateway.config_set_full_scale_range_101,
            operation_mode: this.gateway.config_set_operation_mode_80,
            enable_filters: this.gateway.config_set_filters_80,
            low_pass_filter: this.gateway.config_set_low_pass_filter_p1_110,
            high_pass_filter: this.gateway.config_set_high_pass_filter_p1_110,
            measurement_mode: this.gateway.config_set_measurement_mode_80,
            request_timeout: this.gateway.config_set_on_request_timeout_80,
            deadband: this.gateway.config_set_deadband_80,
            led_alert_mode: this.gateway.config_set_led_alert_mode_84,
            led_acceleromater_threshold: this.gateway.config_set_led_accelerometer_threshold_84,
            led_velocity_threshold: this.gateway.config_set_led_velocity_threshold_84,
            motion_detect_threshold: this.gateway.config_set_motion_detect_threshold_p1_110,
            payload_length: this.gateway.config_set_payload_length_80,
            rtc: this.gateway.config_set_rtc_101,
            auto_raw_interval: this.gateway.config_set_auto_raw_interval_110,
            auto_raw_destination: this.gateway.config_set_auto_raw_destination_110,
            clear_probe_uptimers: this.gateway.config_set_clear_probe_uptimers_110,
            // TODO this is a bad name for this property
            smart_interval: this.gateway.config_set_smart_interval_110,
            smart_threshold: this.gateway.config_set_smart_threshold_110,
            fly_interval: this.gateway.config_set_fly_interval_110,
            // TODO this is a bad name for this property
            rpm_calculate_status: this.gateway.config_set_enable_rpm_calculate_status_110,
            max_raw_samples: this.gateway.config_set_max_raw_sample_110
        }
    }
  }
}
// Usage example